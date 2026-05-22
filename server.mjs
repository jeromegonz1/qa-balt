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
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import { validatePublicUrl } from './lib/utils.mjs';
import { validateAuditUrl, validateModelUrl } from './lib/url-guard.mjs';
import { JobQueue } from './lib/job-queue.mjs';
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

// File d'attente FIFO (sprint 2.a) — remplace activeJobs Map + 429 brut.
// Active : jobs en cours. Waiting : jobs en attente d'un slot libre.
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 3;
const MAX_WAITING_JOBS = parseInt(process.env.MAX_WAITING_JOBS) || 10;
const JOB_STALE_MS = 15 * 60 * 1000; // 15 min
const jobQueue = new JobQueue({
  maxConcurrent: MAX_CONCURRENT_JOBS,
  maxWaiting: MAX_WAITING_JOBS,
  staleAfterMs: JOB_STALE_MS,
});
// Cleanup des jobs perimes toutes les 2 min
setInterval(() => {
  const cleaned = jobQueue.cleanupStale();
  if (cleaned.length > 0) console.log(`🧹 Jobs perimes nettoyes : ${cleaned.join(', ')}`);
}, 120000).unref();

// ── Auth middleware (si QA_BALT_API_KEY défini) ──
const API_KEY = process.env.QA_BALT_API_KEY;
function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // pas de clé = pas d'auth (dev local)
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'API key invalide ou manquante (header X-API-Key)' });
}

// Compat backward : proxy minimal pour les .set() / .delete() residuels dans
// runQAForTask. La queue tracke deja l'etat, mais on accepte ces appels pour
// ne pas casser la chaine. set/delete deviennent des no-op.
const activeJobs = {
  has: (id) => jobQueue.getStatus(id) !== null,
  set: () => { /* no-op : la queue gere l'etat */ },
  delete: (id) => jobQueue.cancel(id),
  get size() { return jobQueue.size().active; },
  get(id) {
    const s = jobQueue.getStatus(id);
    return s ? { started: new Date().toISOString(), status: s.status } : undefined;
  },
};
function cleanupStaleJobs() { jobQueue.cleanupStale(); }

// ═══════════════════════════════════════
// Routes
// ═══════════════════════════════════════

// Health check
app.get('/health', (req, res) => {
  const counts = jobQueue.size();
  res.json({
    status: 'ok',
    version: pkg.version,
    activeJobs: counts.active,
    waitingJobs: counts.waiting,
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

  // Éviter les doublons (deja en cours ou en queue)
  const existingStatus = jobQueue.getStatus(taskId);
  if (existingStatus) {
    return res.status(409).json({
      error: `QA deja ${existingStatus.status === 'running' ? 'en cours' : 'en attente'} pour cette tache`,
      status: existingStatus.status,
      position: existingStatus.position,
    });
  }

  // Cleanup des jobs perimes
  jobQueue.cleanupStale();

  console.log(`\n📨 Webhook reçu — tâche ${taskId}`);

  // Enqueue : si la file est pleine → 503 ; sinon 202 (queue) ou 200 (lance direct)
  let enqResult;
  try {
    enqResult = jobQueue.enqueue(
      { jobId: taskId, type: 'clickup', startedAt: new Date().toISOString() },
      async () => {
        try { await runQAForTask(taskId); }
        catch (err) { console.error(`❌ Erreur QA tâche ${taskId}:`, err.message); }
      },
    );
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  // Reponse immediate (ClickUp timeout = 30s)
  if (enqResult.status === 'queued') {
    res.status(202).json({
      status: 'queued',
      task_id: taskId,
      position: enqResult.position,
      message: `QA en attente, position ${enqResult.position} dans la file.`,
    });
  } else {
    res.json({ status: 'accepted', task_id: taskId, message: 'QA lancé en background' });
  }
  return;
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
    validateAuditUrl(url);          // whitelist *.azko.fr + scheme + chars + length
    await validatePublicUrl(url);   // SSRF (IPs privees, DNS rebinding)
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const directModelUrl = req.body.model_url || req.body.modelUrl || null;
  if (directModelUrl) {
    try {
      validateModelUrl(directModelUrl);
      await validatePublicUrl(directModelUrl);
    } catch (err) {
      return res.status(400).json({ error: `model_url : ${err.message}` });
    }
  }
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
  const snapshot = jobQueue.list();
  // Backward compat : jobs[] = running uniquement (anciens clients)
  // Nouveau : on expose aussi waiting[] + maxConcurrent/maxWaiting
  res.json({
    jobs: snapshot.running.map(r => ({ taskId: r.jobId, ...r })),
    waiting: snapshot.waiting,
    maxConcurrent: snapshot.maxConcurrent,
    maxWaiting: snapshot.maxWaiting,
  });
});

// ── Dernier log SSE (diagnostic sans SSH) ──
let lastSseLog = null;

/**
 * GET /api/qa/last-sse — Diagnostic de la dernière session SSE
 */
app.get('/api/qa/last-sse', (req, res) => {
  if (!lastSseLog) return res.json({ message: 'Aucune session SSE enregistrée' });
  res.json(lastSseLog);
});

/**
 * GET /api/qa/stream — SSE streaming audit
 *
 * Query params : url (obligatoire), model_url (optionnel)
 * Envoie les logs en temps réel via Server-Sent Events
 */
app.get('/api/qa/stream', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'url manquant (query param)' });
  }
  try {
    validateAuditUrl(url);          // whitelist *.azko.fr + scheme + chars + length
    await validatePublicUrl(url);   // SSRF
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const modelUrl = req.query.model_url || null;
  if (modelUrl) {
    try {
      validateModelUrl(modelUrl);
      await validatePublicUrl(modelUrl);
    } catch (err) {
      return res.status(400).json({ error: `model_url : ${err.message}` });
    }
  }
  const jobId = `stream-${Date.now()}`;

  // ── SSE session log ──
  const sseStart = Date.now();
  const sseLog = {
    jobId,
    url,
    startedAt: new Date().toISOString(),
    heartbeatsSent: 0,
    dataEventsSent: 0,
    lastDataEventAt: null,
    lastHeartbeatAt: null,
    clientDisconnectedAt: null,
    disconnectAfterMs: null,
    childExitCode: null,
    childExitAt: null,
    reportGenerated: false,
    endReason: null, // 'done' | 'error' | 'client-disconnect-before-end'
  };
  lastSseLog = sseLog;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Flush immédiatement les headers (important pour Apache/proxy)
  res.flushHeaders();

  console.log(`\n🖥️  SSE audit demande pour ${url} [${jobId}]`);

  let buffer = { stdout: '', stderr: '' };
  let clientConnected = true;
  let activeChild = null; // reference au subprocess une fois lance (null pendant queue)

  // Helper write SSE-safe (ignore si client déconnecté)
  function safeWrite(data) {
    if (clientConnected) {
      try { res.write(data); } catch (_) { clientConnected = false; }
    }
  }

  // Heartbeat toutes les 10s (Cloudflare idle = 100s, on prend large)
  const heartbeat = setInterval(() => {
    sseLog.heartbeatsSent++;
    sseLog.lastHeartbeatAt = new Date().toISOString();
    safeWrite(`: ping ${sseLog.heartbeatsSent} t+${Math.round((Date.now() - sseStart) / 1000)}s\n\n`);
  }, 10000);

  function sendLines(stream, data) {
    buffer[stream] += data.toString();
    const lines = buffer[stream].split('\n');
    buffer[stream] = lines.pop(); // garder le fragment incomplet
    for (const line of lines) {
      if (line.trim()) {
        sseLog.dataEventsSent++;
        sseLog.lastDataEventAt = new Date().toISOString();
        safeWrite(`event: log\ndata: ${line}\n\n`);
      }
    }
  }

  // ─── Lancement effectif de l'audit (appele par le runFn de la queue) ───
  function startChildProcess() {
    const qaPath = new URL('./qa.mjs', import.meta.url).pathname;
    const qaArgs = [qaPath, url];
    if (modelUrl) qaArgs.push('--model-url', modelUrl);

    const child = spawn('node', qaArgs, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000,
    });
    activeChild = child;
    console.log(`   SSE audit lance (subprocess PID ${child.pid}) [${jobId}]`);
    return child;
  }

  // ─── Enqueue dans la file FIFO ───
  // Le runFn sera execute soit immediatement (slot dispo), soit quand un slot
  // se libere. Il retourne une promise qui se resout a la fin du subprocess.
  let resolveChildDone; // resolveur du runFn, appele par child.on('close')
  let enqueueResult;
  try {
    enqueueResult = jobQueue.enqueue(
      { jobId, url, type: 'sse', startedAt: new Date().toISOString() },
      () => new Promise((resolve) => {
        resolveChildDone = resolve;
        const child = startChildProcess();
        wireChildHandlers(child);
      }),
    );
  } catch (err) {
    // File pleine (max waiting atteint)
    safeWrite(`event: error\ndata: ${err.message}\n\n`);
    clearInterval(heartbeat);
    if (clientConnected) res.end();
    return;
  }

  // Subscribe aux updates de position pour informer le client en SSE
  jobQueue.subscribe(jobId, (status) => {
    if (status.status === 'queued') {
      safeWrite(`event: queued\ndata: ${JSON.stringify({ position: status.position })}\n\n`);
    } else if (status.status === 'running') {
      safeWrite(`event: starting\ndata: {}\n\n`);
    }
  });

  // Envoyer le statut initial immediatement
  if (enqueueResult.status === 'queued') {
    safeWrite(`event: queued\ndata: ${JSON.stringify({ position: enqueueResult.position })}\n\n`);
    console.log(`   SSE en attente [${jobId}] position ${enqueueResult.position}`);
  } else {
    safeWrite(`event: starting\ndata: {}\n\n`);
  }

  // Helpers : attache les listeners stdin/stdout + close au child
  function wireChildHandlers(child) {
    child.stdout.on('data', (d) => { process.stdout.write(d); sendLines('stdout', d); });
    child.stderr.on('data', (d) => { process.stderr.write(d); sendLines('stderr', d); });
    child.on('close', onChildClose);
    child.on('error', onChildError);
  }

  function onChildClose(code) {
    clearInterval(heartbeat);
    sseLog.childExitCode = code;
    sseLog.childExitAt = new Date().toISOString();

    // Flush remaining buffer
    for (const stream of ['stdout', 'stderr']) {
      if (buffer[stream].trim()) {
        sseLog.dataEventsSent++;
        safeWrite(`event: log\ndata: ${buffer[stream]}\n\n`);
      }
    }

    // Trouver les fichiers rapport
    try {
      const domain = new URL(url.replace(/\/$/, '')).hostname;
      const siteSlug = domain.split('.')[0];
      const timestamp = new Date().toISOString().slice(0, 10);
      const mdFile = `${siteSlug}-${timestamp}.md`;
      const htmlFile = `${siteSlug}-${timestamp}.html`;
      const reportsDir = resolve(__dirname, 'reports');
      const mdPath = resolve(reportsDir, mdFile);
      const htmlPath = resolve(reportsDir, htmlFile);

      if (existsSync(mdPath)) {
        const markdown = readFileSync(mdPath, 'utf-8');
        const hasBloquants = /BLOQUANT \| [1-9]\d*/.test(markdown);
        const data = { mdFile, hasBloquants };
        if (existsSync(htmlPath)) data.htmlFile = htmlFile;
        safeWrite(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
        sseLog.reportGenerated = true;
        sseLog.endReason = clientConnected ? 'done' : 'done-after-disconnect';
      } else {
        safeWrite(`event: error\ndata: QA termine (code ${code}) mais rapport introuvable\n\n`);
        sseLog.endReason = 'report-not-found';
      }
    } catch (err) {
      safeWrite(`event: error\ndata: ${err.message}\n\n`);
      sseLog.endReason = 'error';
    }

    if (clientConnected) res.end();
    const duration = Math.round((Date.now() - sseStart) / 1000);
    console.log(`   SSE terminé [${jobId}] — ${duration}s, ${sseLog.heartbeatsSent} pings, ${sseLog.dataEventsSent} events, client=${clientConnected ? 'connecté' : 'déconnecté'}, report=${sseLog.reportGenerated}`);
    if (resolveChildDone) resolveChildDone();
  }

  function onChildError(err) {
    clearInterval(heartbeat);
    sseLog.endReason = 'child-error';
    safeWrite(`event: error\ndata: ${err.message}\n\n`);
    if (clientConnected) res.end();
    if (resolveChildDone) resolveChildDone();
  }

  // Si le client déconnecte : on laisse l'audit aller au bout (s'il est lance)
  // Si le job est encore en queue (subprocess pas demarre), on l'annule.
  req.on('close', () => {
    const elapsed = Math.round((Date.now() - sseStart) / 1000);
    clientConnected = false;
    sseLog.clientDisconnectedAt = new Date().toISOString();
    sseLog.disconnectAfterMs = Date.now() - sseStart;
    if (!activeChild) {
      // Pas encore demarre : on annule (libere un slot pour les suivants)
      if (jobQueue.cancel(jobId)) {
        console.log(`   SSE client deconnecte [${jobId}] avant lancement (encore en queue) — annule`);
        sseLog.endReason = 'cancelled-while-queued';
      }
    } else if (activeChild.exitCode === null) {
      sseLog.endReason = 'client-disconnect-before-end';
      console.log(`   SSE client déconnecté [${jobId}] après ${elapsed}s (${sseLog.heartbeatsSent} pings envoyés, ${sseLog.dataEventsSent} events) — audit continue`);
    }
  });
});

/**
 * GET /reports — Index des rapports disponibles
 */
app.get('/reports', (req, res) => {
  const reportsDir = resolve(__dirname, 'reports');
  let files = [];
  try {
    files = readdirSync(reportsDir)
      .filter(f => /\.(md|html)$/.test(f))
      .map(f => {
        const stat = statSync(resolve(reportsDir, f));
        return { name: f, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    return res.status(500).send('Erreur lecture dossier reports');
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmtSize = (b) => b > 1024*1024 ? (b/1024/1024).toFixed(1)+' MB' : (b/1024).toFixed(1)+' KB';
  const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  const rows = files.map(f =>
    `<tr><td><a href="/reports/${esc(f.name)}">${esc(f.name)}</a></td><td>${fmtSize(f.size)}</td><td>${fmtDate(f.mtime)}</td></tr>`
  ).join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Rapports QA-BALT</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f6fa;color:#333;margin:0}
header{background:#1B3A5C;color:#fff;padding:1.2rem 2rem}
header h1{margin:0;font-size:1.4rem}
main{max-width:1000px;margin:2rem auto;padding:0 1rem}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:1.5rem}
table{width:100%;border-collapse:collapse}
th,td{padding:.6rem .8rem;text-align:left;border-bottom:1px solid #eee;font-size:.9rem}
th{background:#fafbfc;font-weight:600;color:#555}
a{color:#1B3A5C;text-decoration:none}
a:hover{text-decoration:underline}
.empty{color:#999;text-align:center;padding:2rem}
.back{display:inline-block;margin-bottom:1rem;font-size:.85rem}
</style></head><body>
<header><h1>QA-BALT — Rapports</h1></header>
<main>
<a href="/" class="back">&larr; Retour audit</a>
<div class="card">
${files.length === 0 ? '<div class="empty">Aucun rapport disponible</div>' : `<table><thead><tr><th>Fichier</th><th>Taille</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`}
</div>
</main></body></html>`);
});

/**
 * GET /reports/:filename — Servir les rapports générés
 *
 * Sécurité : basename only, extensions .md/.html uniquement
 */
app.get('/reports/:filename', (req, res) => {
  const filename = basename(req.params.filename);
  if (filename !== req.params.filename) {
    return res.status(400).json({ error: 'Nom de fichier invalide' });
  }
  if (!/\.(md|html)$/.test(filename)) {
    return res.status(400).json({ error: 'Extension non autorisée (md ou html uniquement)' });
  }
  const filePath = resolve(__dirname, 'reports', filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Rapport introuvable' });
  }
  const contentType = filename.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8';
  res.setHeader('Content-Type', contentType);
  res.send(readFileSync(filePath, 'utf-8'));
});

/**
 * GET /screenshots/:dir/:filename — Sert les screenshots Playwright des audits
 *
 * Securite :
 *   - basename() sur :dir ET :filename (anti path-traversal)
 *   - Whitelist extension PNG uniquement
 *   - Resolve absolu + verification que le path final est sous screenshotsDir
 *   - Lecture seule, immutable (les screenshots ne sont jamais modifies par le serveur)
 */
app.get('/screenshots/:dir/:filename', (req, res) => {
  const dir = basename(req.params.dir || '');
  const filename = basename(req.params.filename || '');
  if (!dir || !filename) return res.status(400).json({ error: 'Paramètre manquant' });
  if (dir !== req.params.dir || filename !== req.params.filename) {
    return res.status(400).json({ error: 'Nom invalide' });
  }
  if (!/\.png$/i.test(filename)) {
    return res.status(400).json({ error: 'Extension non autorisée (png uniquement)' });
  }
  const screenshotsDir = resolve(__dirname, 'screenshots');
  const filePath = resolve(screenshotsDir, dir, filename);
  // Defense en profondeur : verifier que le path final est sous screenshotsDir
  if (!filePath.startsWith(screenshotsDir + '/')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Screenshot introuvable' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h
  res.sendFile(filePath);
});

// ── Static frontend (après les routes API) ──
app.use(express.static(resolve(__dirname, 'public')));

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

  // Validation whitelist + SSRF sur l'URL preprod
  if (preprodUrl) {
    try {
      validateAuditUrl(preprodUrl);
      await validatePublicUrl(preprodUrl);
    } catch (err) {
      activeJobs.delete(taskId);
      console.error(`   URL bloquee : ${err.message}`);
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

  // Validation modelUrl (best-effort, on skip si invalide)
  if (modelUrl) {
    try {
      validateModelUrl(modelUrl);
      await validatePublicUrl(modelUrl);
    } catch (err) {
      console.warn(`   modelUrl invalide, ignore : ${err.message}`);
      modelUrl = null;
    }
  }

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
// Self-restart watcher (sprint 2.c)
//
// Libere periodiquement les leaks Playwright en quittant proprement quand
// l'instance est idle (aucun job en cours/en attente). systemd doit avoir
// `Restart=always` dans le unit file pour relancer apres exit 0.
//
// Conditions de restart (toutes doivent etre vraies) :
//   - uptime > QA_BALT_RESTART_AFTER_HOURS (default 72h = 3 jours)
//     OU RAM resident > QA_BALT_RESTART_RAM_MB (default 1024 MB)
//   - aucun job actif ni en attente (sinon on attend)
//
// Check toutes les 5 min. Skip total si QA_BALT_DISABLE_SELF_RESTART=1.
// ═══════════════════════════════════════
const RESTART_AFTER_HOURS = parseInt(process.env.QA_BALT_RESTART_AFTER_HOURS) || 72;
const RESTART_RAM_MB = parseInt(process.env.QA_BALT_RESTART_RAM_MB) || 1024;
const SELF_RESTART_DISABLED = process.env.QA_BALT_DISABLE_SELF_RESTART === '1';

if (!SELF_RESTART_DISABLED) {
  setInterval(() => {
    const uptimeHours = process.uptime() / 3600;
    const ramMB = process.memoryUsage().rss / 1024 / 1024;
    const { active, waiting } = jobQueue.size();
    const idle = active === 0 && waiting === 0;
    const shouldRestart = idle && (uptimeHours > RESTART_AFTER_HOURS || ramMB > RESTART_RAM_MB);
    if (shouldRestart) {
      console.log(`🔄 Self-restart : uptime=${uptimeHours.toFixed(1)}h, RAM=${ramMB.toFixed(0)}MB, idle. systemd va relancer (Restart=always).`);
      // Graceful : close server avant exit
      server.close(() => process.exit(0));
      // Failsafe : si server.close traine > 10s, force exit
      setTimeout(() => process.exit(0), 10000).unref();
    }
  }, 5 * 60 * 1000).unref();
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
║  GET  /              ← Frontend QA               ║
║  GET  /api/qa/stream ← SSE streaming audit       ║
║  POST /api/qa        ← Webhook ClickUp           ║
║  POST /api/qa/direct ← Test direct (url)         ║
║  GET  /api/jobs      ← Jobs en cours             ║
║  GET  /reports/:file ← Rapports (.md/.html)      ║
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
