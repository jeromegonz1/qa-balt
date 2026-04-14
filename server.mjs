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
import { validatePublicUrl } from './lib/utils.mjs';
import {
  getTask,
  extractPreprodUrl,
  extractModelUrl,
  extractSiteContext,
  postComment,
  updateTaskStatus,
  formatReportForComment,
  postSummaryComment,
  uploadAttachment,
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
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 3;
const JOB_STALE_MS = 15 * 60 * 1000; // 15 min

// ── Auth middleware (si QA_BALT_API_KEY défini) ──
const API_KEY = process.env.QA_BALT_API_KEY;
function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // pas de clé = pas d'auth (dev local)
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'API key invalide ou manquante (header X-API-Key)' });
}

// ── Nettoyage des jobs périmés ──
function cleanupStaleJobs() {
  const now = Date.now();
  for (const [taskId, job] of activeJobs) {
    if (now - new Date(job.started).getTime() > JOB_STALE_MS) {
      console.log(`🧹 Job périmé supprimé : ${taskId} (lancé ${job.started})`);
      activeJobs.delete(taskId);
    }
  }
}

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
app.post('/api/qa', requireAuth, async (req, res) => {
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

  // Nettoyer les jobs périmés (>15 min)
  cleanupStaleJobs();

  // Rate limit : max N jobs simultanés
  if (activeJobs.size >= MAX_CONCURRENT_JOBS) {
    return res.status(429).json({
      error: `Limite atteinte (${MAX_CONCURRENT_JOBS} audits simultanés)`,
      activeJobs: activeJobs.size,
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
app.post('/api/qa/direct', requireAuth, async (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'url manquant' });
  }
  try {
    await validatePublicUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const directModelUrl = req.body.model_url || req.body.modelUrl || null;
  console.log(`\n🔍 QA direct demandé pour ${url}`);
  if (directModelUrl) console.log(`   Modèle: ${directModelUrl}`);
  res.json({ status: 'accepted', url, model_url: directModelUrl, message: 'QA lancé — rapport dans /reports' });

  try {
    const { markdown, htmlPath } = await runQA(url, directModelUrl);
    console.log(`✅ QA direct terminé pour ${url}`);
    if (htmlPath) console.log(`   Rapport HTML : ${htmlPath}`);
  } catch (err) {
    console.error(`❌ Erreur QA direct:`, err.message);
  }
});

/**
 * GET /api/jobs — Liste des jobs en cours
 */
app.get('/api/jobs', requireAuth, (req, res) => {
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

  // Validation SSRF sur l'URL preprod
  if (preprodUrl) {
    try {
      await validatePublicUrl(preprodUrl);
    } catch (err) {
      activeJobs.delete(taskId);
      console.error(`   SSRF bloque : ${err.message}`);
      try {
        await postComment(taskId, `⚠️ **QA automatique bloqué**\n\nURL non autorisée : ${err.message}`);
      } catch (e) { /* best effort */ }
      return;
    }
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
    const { markdown, htmlPath } = await runQA(preprodUrl, modelUrl, siteContext);

    // 4. Poster le résumé texte brut + attacher le rapport HTML
    const hasBloquants = /BLOQUANT \| [1-9]\d*/.test(markdown);

    // Extraire les stats depuis le rapport markdown (tableau SYNTHÈSE)
    const countMatch = (pattern) => {
      const m = markdown.match(pattern);
      return m ? parseInt(m[1]) : 0;
    };
    const stats = {
      siteName: siteContext.title || task.name || new URL(preprodUrl).hostname,
      siteUrl: preprodUrl,
      bloquants: countMatch(/BLOQUANT \| (\d+)/),
      checklistMep: countMatch(/CHECKLIST MEP \| (\d+)/),
      importants: countMatch(/IMPORTANT \| (\d+)/),
      mineurs: countMatch(/MINEUR \| (\d+)/),
      total: countMatch(/\*\*TOTAL\*\* \| \*\*(\d+)\*\*/),
    };

    await postSummaryComment(taskId, stats);
    console.log(`   ✅ Résumé posté sur la tâche ClickUp`);

    // Attacher le rapport HTML complet
    if (htmlPath) {
      try {
        const htmlFileName = htmlPath.split('/').pop();
        await uploadAttachment(taskId, htmlPath, htmlFileName);
        console.log(`   ✅ Rapport HTML attaché à la tâche`);
      } catch (attachErr) {
        console.error(`   ⚠️ Erreur upload HTML: ${attachErr.message}`);
        // Fallback : poster le rapport markdown tronqué en commentaire
        const comment = formatReportForComment(markdown, preprodUrl);
        await postComment(taskId, comment);
        console.log(`   ↩️ Fallback : rapport markdown posté en commentaire`);
      }
    }

    // 5. Optionnel : changer le statut de la tâche
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
      const htmlReportPath = new URL(`./reports/${siteSlug}-${timestamp}.html`, import.meta.url).pathname;

      try {
        const markdown = readFileSync(reportPath, 'utf-8');
        const htmlPath = existsSync(htmlReportPath) ? htmlReportPath : null;
        promiseResolve({ markdown, htmlPath });
      } catch (err) {
        reject(new Error(`QA terminé (code ${code}) mais rapport introuvable: ${reportPath}`));
      }
    });

    child.on('error', reject);
  });
}

// ═══════════════════════════════════════
// Start + Graceful shutdown
// ═══════════════════════════════════════
const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║       QA-BALT Server v${pkg.version.padEnd(27)}║
╠══════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(42)}║
║  Auth: ${API_KEY ? '🔒 API key active' : '⚠️  Pas de clé (dev)'}${' '.repeat(API_KEY ? 24 : 23)}║
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

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n🛑 ${signal} reçu — arrêt gracieux...`);
  if (activeJobs.size > 0) {
    console.log(`   ${activeJobs.size} job(s) en cours — attente de fin...`);
  }
  server.close(() => {
    console.log('   Serveur HTTP fermé.');
    // Les subprocess qa.mjs finiront naturellement
    // On attend un peu pour les commentaires ClickUp en cours
    setTimeout(() => {
      console.log('   Bye.');
      process.exit(0);
    }, activeJobs.size > 0 ? 5000 : 0);
  });
  // Force exit après 30s max
  setTimeout(() => {
    console.error('   ⚠️ Timeout — arrêt forcé.');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
