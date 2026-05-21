/**
 * File d'attente FIFO pour audits qa-balt.
 *
 * Remplace le comportement actuel « 429 quand MAX atteint » par une queue
 * qui demarre automatiquement le job suivant des qu'un slot se libere.
 *
 * Usage cote serveur :
 *   const queue = new JobQueue({ maxConcurrent: 3, maxWaiting: 10 });
 *   const result = queue.enqueue({ jobId: 'stream-123', url: '...', type: 'sse' }, async (id) => {
 *     // ... lancer l'audit, le promise s'auto-cleanup sur fin
 *   });
 *   // result = { status: 'running'|'queued', position: 0|1|2..., jobId }
 *
 * Pour le SSE : subscribe(jobId, cb) recoit des updates `{ status, position }`
 * quand la position du job change (par ex. quand un job actif finit).
 *
 * Limites :
 *   - In-memory uniquement (perdu au restart). Acceptable pour QA : un
 *     restart ne perd que des audits en cours, l'integrateur relancera.
 *   - Pas de priorisation : pur FIFO.
 *   - Cleanup automatique des jobs actifs anciens (assume crashed) via
 *     cleanupStale() — a appeler dans un setInterval cote serveur.
 */

const DEFAULTS = Object.freeze({
  maxConcurrent: 3,
  maxWaiting: 10,
  staleAfterMs: 15 * 60 * 1000, // 15 min
});

export class JobQueue {
  constructor(options = {}) {
    const opts = { ...DEFAULTS, ...options };
    this.maxConcurrent = opts.maxConcurrent;
    this.maxWaiting = opts.maxWaiting;
    this.staleAfterMs = opts.staleAfterMs;

    this.active = new Map();    // jobId → { startedAt, addedAt, ...meta }
    this.waiting = [];           // [{ jobId, addedAt, runFn, ...meta }, ...]
    this.listeners = new Map();  // jobId → callback({ status, position })
  }

  /**
   * Ajoute un job. Lance immediatement si slot dispo, sinon mis en file.
   *
   * @param {Object} jobInfo — { jobId (obligatoire), url, type?, ...meta }
   * @param {Function} runFn — async function(jobId) → promise (l'audit lui-meme)
   * @returns {{ status: 'running'|'queued', position: number, jobId: string }}
   * @throws Error si jobId manquant, deja present, ou queue pleine
   */
  enqueue(jobInfo, runFn) {
    if (!jobInfo || !jobInfo.jobId) {
      throw new Error('jobId requis');
    }
    if (typeof runFn !== 'function') {
      throw new Error('runFn doit etre une fonction');
    }
    const { jobId } = jobInfo;
    if (this.active.has(jobId) || this.waiting.some(w => w.jobId === jobId)) {
      throw new Error(`jobId deja present : ${jobId}`);
    }

    const entry = {
      ...jobInfo,
      runFn,
      addedAt: Date.now(),
    };

    if (this.active.size < this.maxConcurrent) {
      this._start(entry);
      return { status: 'running', position: 0, jobId };
    }

    if (this.waiting.length >= this.maxWaiting) {
      throw new Error(`File pleine (max ${this.maxWaiting} en attente)`);
    }

    this.waiting.push(entry);
    return { status: 'queued', position: this.waiting.length, jobId };
  }

  /**
   * Demarre un job (depile -> active -> runFn -> cleanup au finally).
   * @private
   */
  _start(entry) {
    const startedAt = Date.now();
    this.active.set(entry.jobId, { ...entry, startedAt, runFn: undefined });

    // Notifier le subscriber : on passe en running
    this._notify(entry.jobId, { status: 'running', position: 0 });

    // Async run avec cleanup garanti
    Promise.resolve()
      .then(() => entry.runFn(entry.jobId))
      .catch((err) => {
        // Les erreurs sont logguees par le runFn lui-meme.
        // On absorbe ici pour ne pas casser la chaine.
      })
      .finally(() => {
        this.active.delete(entry.jobId);
        this.listeners.delete(entry.jobId);
        this._processNext();
      });
  }

  /**
   * Tente de demarrer le prochain job de la file (si slot dispo).
   * Notifie aussi les jobs restants en queue de leur nouvelle position.
   * @private
   */
  _processNext() {
    if (this.active.size >= this.maxConcurrent) return;
    if (this.waiting.length === 0) return;

    const next = this.waiting.shift();
    this._start(next);

    // Les jobs encore en queue avancent d'une position : notifier
    for (let i = 0; i < this.waiting.length; i++) {
      const w = this.waiting[i];
      this._notify(w.jobId, { status: 'queued', position: i + 1 });
    }
  }

  /**
   * Notifie le subscriber (s'il existe) d'un changement de statut/position.
   * @private
   */
  _notify(jobId, statusObj) {
    const cb = this.listeners.get(jobId);
    if (cb) {
      try { cb(statusObj); } catch { /* ignore listener errors */ }
    }
  }

  /**
   * Souscrit a une callback pour les changements de statut d'un job.
   * Utilise par /api/qa/stream pour envoyer des events SSE `queued, position N`.
   *
   * @param {string} jobId
   * @param {Function} callback — recoit { status: 'running'|'queued', position }
   */
  subscribe(jobId, callback) {
    if (typeof callback !== 'function') return;
    this.listeners.set(jobId, callback);
  }

  /**
   * Retourne le statut courant d'un job (running / queued / null si inconnu).
   *
   * @param {string} jobId
   * @returns {{ status: string, position: number } | null}
   */
  getStatus(jobId) {
    if (this.active.has(jobId)) return { status: 'running', position: 0 };
    const idx = this.waiting.findIndex(w => w.jobId === jobId);
    if (idx >= 0) return { status: 'queued', position: idx + 1 };
    return null;
  }

  /**
   * Annule un job en attente (pas un job en cours).
   * @returns {boolean} true si annule, false si non trouve / en cours
   */
  cancel(jobId) {
    const idx = this.waiting.findIndex(w => w.jobId === jobId);
    if (idx === -1) return false;
    this.waiting.splice(idx, 1);
    this.listeners.delete(jobId);
    // Repropager la position aux jobs restants apres ce point
    for (let i = idx; i < this.waiting.length; i++) {
      const w = this.waiting[i];
      this._notify(w.jobId, { status: 'queued', position: i + 1 });
    }
    return true;
  }

  /**
   * Snapshot pour endpoint /api/jobs.
   * Strip runFn / listeners pour avoir un JSON serialisable.
   */
  list() {
    const stripPrivate = (entry) => {
      const { runFn, ...rest } = entry;
      return rest;
    };
    return {
      maxConcurrent: this.maxConcurrent,
      maxWaiting: this.maxWaiting,
      running: [...this.active.values()].map(stripPrivate).map(j => ({
        ...j,
        startedAt: new Date(j.startedAt).toISOString(),
        addedAt: new Date(j.addedAt).toISOString(),
      })),
      waiting: this.waiting.map((w, i) => ({
        ...stripPrivate(w),
        position: i + 1,
        addedAt: new Date(w.addedAt).toISOString(),
      })),
    };
  }

  /**
   * Compte courant {active, waiting} — utile pour les tests + monitoring.
   */
  size() {
    return { active: this.active.size, waiting: this.waiting.length };
  }

  /**
   * Cleanup des jobs actifs juges périmes (subprocess crashed ou client
   * deconnecte sans cleanup). A appeler periodiquement cote serveur.
   *
   * @returns {string[]} liste des jobIds nettoyes
   */
  cleanupStale() {
    const now = Date.now();
    const cleaned = [];
    for (const [id, job] of this.active) {
      if (now - job.startedAt > this.staleAfterMs) {
        this.active.delete(id);
        this.listeners.delete(id);
        cleaned.push(id);
      }
    }
    if (cleaned.length > 0) this._processNext();
    return cleaned;
  }
}
