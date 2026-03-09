#!/usr/bin/env node
/**
 * QA-BALT Webhook Server
 *
 * Reçoit les webhooks ClickUp et lance automatiquement l'audit QA.
 *
 * Flow :
 *   1. L'intégrateur clique "Lancer QA" dans ClickUp (automation manuelle)
 *   2. ClickUp POST → ce serveur avec le task_id
 *   3. On récupère l'URL préprod depuis le champ custom de la tâche
 *   4. On lance qa.mjs en background
 *   5. On poste le rapport en commentaire sur la tâche ClickUp
 *
 * Usage :
 *   node server.mjs                     # Port 3847 par défaut
 *   PORT=8080 node server.mjs           # Port custom
 *
 * Test local :
 *   curl -X POST http://localhost:3847/api/qa \
 *     -H "Content-Type: application/json" \
 *     -d '{"task_id":"abc123"}'
 *
 *   # Ou test direct sans ClickUp :
 *   curl -X POST http://localhost:3847/api/qa/direct \
 *     -H "Content-Type: application/json" \
 *     -d '{"url":"http://camping-arquebuse.site.azko.fr"}'
 */
import express from 'express';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  getTask,
  extractPreprodUrl,
  extractModelUrl,
  extractSiteContext,
  postComment,
  updateTaskStatus,
  formatReportForComment,
} from './lib/clickup.mjs';

// ═══════════════════════════════════════
// Config
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3847;
const __dirname = import.meta.dirname;
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// Charger .env manuellement (pas de dépendance dotenv)
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  const envLines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of envLines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const app = express();
app.use(express.json());

// Jobs en cours (pour éviter les doublons)
const activeJobs = new Map();

// ═══════════════════════════════════════
// Routes
// ═══════════════════════════════════════

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version,
    activeJobs: activeJobs.size,
    uptime: Math.round(process.uptime()),
  });
});

/**
 * POST /api/qa — Webhook ClickUp
 *
 * Payload attendu (template ClickUp) :
 * {
 *   "task_id": "abc123",      ← ID de tâche (variable ClickUp)
 *   "task_name": "Site ...",   ← Nom de la tâche (optionnel)
 * }
 */
app.post('/api/qa', async (req, res) => {
  const taskId = req.body.task_id || req.body.taskId;

  if (!taskId) {
    return res.status(400).json({ error: 'task_id manquant dans le payload' });
  }

  // Éviter les doublons
  if (activeJobs.has(taskId)) {
    return res.status(409).json({
      error: 'QA déjà en cours pour cette tâche',
      started: activeJobs.get(taskId).started,
    });
  }

  console.log(`\n📨 Webhook reçu — tâche ${taskId}`);

  // Répondre immédiatement (ClickUp timeout = 30s)
  res.json({ status: 'accepted', task_id: taskId, message: 'QA lancé en background' });

  // Lancer le QA en background
  try {
    await runQAForTask(taskId);
  } catch (err) {
    console.error(`❌ Erreur QA tâche ${taskId}:`, err.message);
  }
});

/**
 * POST /api/qa/direct — Test direct sans ClickUp
 *
 * Payload : { "url": "http://xxx.site.azko.fr" }
 * Retourne le rapport directement (bloquant)
 */
app.post('/api/qa/direct', async (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'url manquant' });
  }

  const directModelUrl = req.body.model_url || req.body.modelUrl || null;
  console.log(`\n🔍 QA direct demandé pour ${url}`);
  if (directModelUrl) console.log(`   Modèle: ${directModelUrl}`);
  res.json({ status: 'accepted', url, model_url: directModelUrl, message: 'QA lancé — rapport dans /reports' });

  try {
    const report = await runQA(url, directModelUrl);
    console.log(`✅ QA direct terminé pour ${url}`);
  } catch (err) {
    console.error(`❌ Erreur QA direct:`, err.message);
  }
});

/**
 * GET /api/jobs — Liste des jobs en cours
 */
app.get('/api/jobs', (req, res) => {
  const jobs = [];
  for (const [taskId, job] of activeJobs) {
    jobs.push({ taskId, ...job });
  }
  res.json({ jobs });
});

// ═══════════════════════════════════════
// Logique QA
// ═══════════════════════════════════════

/**
 * Lance le QA pour une tâche ClickUp
 */
async function runQAForTask(taskId) {
  activeJobs.set(taskId, { started: new Date().toISOString(), status: 'fetching_task' });

  // 1. Récupérer les détails de la tâche
  let task, preprodUrl, modelUrl, siteContext;
  try {
    task = await getTask(taskId);
    preprodUrl = extractPreprodUrl(task);
    modelUrl = extractModelUrl(task);
    siteContext = extractSiteContext(task);
  } catch (err) {
    activeJobs.delete(taskId);
    console.error(`   Impossible de récupérer la tâche ClickUp: ${err.message}`);

    // Si pas de token ClickUp, on log mais on ne crash pas
    if (err.message.includes('CLICKUP_API_TOKEN')) {
      console.error('   → Configurer CLICKUP_API_TOKEN dans .env');
    }
    return;
  }

  if (!preprodUrl) {
    activeJobs.delete(taskId);
    console.error(`   Pas d'URL préprod trouvée dans la tâche "${task.name}"`);
    // Poster un commentaire d'erreur
    try {
      await postComment(taskId,
        '⚠️ **QA automatique échoué**\n\n' +
        'Impossible de trouver l\'URL préprod.\n' +
        'Vérifier que le champ "URL Préprod" est rempli dans la tâche.'
      );
    } catch (e) { /* best effort */ }
    return;
  }

  console.log(`   Tâche: "${task.name}"`);
  console.log(`   URL: ${preprodUrl}`);
  if (modelUrl) console.log(`   Modèle: ${modelUrl}`);

  // 2. Poster un commentaire "QA en cours"
  activeJobs.set(taskId, { started: new Date().toISOString(), status: 'running', url: preprodUrl });
  try {
    await postComment(taskId, `🔍 **QA automatique lancé**\nAnalyse de ${preprodUrl} en cours...`);
  } catch (e) { /* best effort */ }

  // 3. Lancer le QA
  try {
    const report = await runQA(preprodUrl, modelUrl, siteContext);

    // 4. Poster le rapport
    const comment = formatReportForComment(report, preprodUrl);
    await postComment(taskId, comment);
    console.log(`   ✅ Rapport posté sur la tâche ClickUp`);

    // 5. Optionnel : changer le statut de la tâche
    const hasBloquants = /BLOQUANT \| [1-9]/.test(report);
    const statusPostQA = process.env.CLICKUP_STATUS_QA_OK;
    const statusPostQAKO = process.env.CLICKUP_STATUS_QA_KO;

    if (hasBloquants && statusPostQAKO) {
      await updateTaskStatus(taskId, statusPostQAKO);
      console.log(`   Statut → "${statusPostQAKO}"`);
    } else if (!hasBloquants && statusPostQA) {
      await updateTaskStatus(taskId, statusPostQA);
      console.log(`   Statut → "${statusPostQA}"`);
    }

  } catch (err) {
    console.error(`   Erreur pendant le QA: ${err.message}`);
    try {
      await postComment(taskId,
        `❌ **QA automatique échoué**\n\nErreur: ${err.message}\n\nRelancer manuellement si besoin.`
      );
    } catch (e) { /* best effort */ }
  }

  activeJobs.delete(taskId);
}

/**
 * Lance qa.mjs en subprocess et retourne le rapport
 */
function runQA(url, modelUrl = null, siteContext = {}) {
  return new Promise((promiseResolve, reject) => {
    const qaPath = new URL('./qa.mjs', import.meta.url).pathname;
    const qaArgs = [qaPath, url];
    if (modelUrl) qaArgs.push('--model-url', modelUrl);
    if (Object.keys(siteContext).length > 0) {
      qaArgs.push('--site-context', JSON.stringify(siteContext));
    }
    const child = spawn('node', qaArgs, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000, // 10 min max
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });

    child.on('close', (code) => {
      // Lire le rapport généré
      const domain = new URL(url.replace(/\/$/, '')).hostname;
      const siteSlug = domain.split('.')[0];
      const timestamp = new Date().toISOString().slice(0, 10);
      const reportPath = new URL(`./reports/${siteSlug}-${timestamp}.md`, import.meta.url).pathname;

      try {
        const report = readFileSync(reportPath, 'utf-8');
        promiseResolve(report);
      } catch (err) {
        reject(new Error(`QA terminé (code ${code}) mais rapport introuvable: ${reportPath}`));
      }
    });

    child.on('error', reject);
  });
}

// ═══════════════════════════════════════
// Start
// ═══════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║       QA-BALT Server v${pkg.version.padEnd(27)}║
╠══════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(42)}║
║  ClickUp: ${process.env.CLICKUP_API_TOKEN ? '✅ Token configuré' : '⚠️  Token manquant (.env)'}${' '.repeat(process.env.CLICKUP_API_TOKEN ? 23 : 18)}║
╠══════════════════════════════════════════════════╣
║  Endpoints:                                      ║
║  POST /api/qa        ← Webhook ClickUp           ║
║  POST /api/qa/direct ← Test direct (url)         ║
║  GET  /api/jobs      ← Jobs en cours             ║
║  GET  /health        ← Health check              ║
╚══════════════════════════════════════════════════╝
  `);
});
