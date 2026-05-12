/**
 * Module debuglog AZKO : extrait erreurs PHP runtime + metadonnees serveur.
 *
 * Le serveur AZKO injecte `var oJsonFeedback = [...]` inline dans le HTML
 * quand l'URL contient ?debuglog=<token>. Le JSON contient :
 *   - PHP errors / warnings (Undefined variable, etc.)
 *   - ORGA / SITE / SKIN (cross-ref ClickUp + identite site)
 *   - Version code AZKO + version tpl skin (detection sites pas redeployes)
 *
 * Requiert : AZKO_DEBUG_TOKEN dans .env (token fourni par l'equipe dev AZKO).
 * Skippe gracieusement si token absent ou non extractible.
 *
 * Le bruit infrastructurel (Kubernetes, fallback skin) est filtre via NOISE_REGEX.
 */

import { safeCurl } from './utils.mjs';

const FEEDBACK_REGEX = /var\s+oJsonFeedback\s*=\s*(\[[\s\S]*?\]);/;

// Bruit infrastructurel attendu en preprod AZKO : ne pas remonter
const NOISE_REGEX = [
  /\/var\/run\/secrets\/kubernetes\.io/,
  /Skin en ligne introuvable/,
  /skins\.azko\.fr\/[\s\S]{0,300}404 Not Found/i,
  /HTTP\/1\.1\s*404\s*Not\s*Found/i,
];

const FATAL_LEVELS = ['E_ERROR', 'E_PARSE', 'E_CORE_ERROR', 'E_RECOVERABLE_ERROR', 'E_USER_ERROR'];

/**
 * Extrait l'array oJsonFeedback du HTML brut.
 * @param {string} html
 * @returns {Array|null}
 */
export function extractFeedback(html) {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(FEEDBACK_REGEX);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * Extrait les metadonnees AZKO (orga, site, skin, version code).
 * @param {Array} feedback
 * @returns {{orgaId?, orgaName?, siteId?, skinId?, skinName?, codeCommit?, codeCommitDate?, skinTplDate?}}
 */
export function extractMetadata(feedback) {
  if (!Array.isArray(feedback)) return {};
  const meta = {};
  for (const item of feedback) {
    const c = (item && item.content) || '';

    const orga = c.match(/ORGA\s*:\s*(\d+)\s*\(([^)]+)\)/);
    const site = c.match(/SITE\s*:\s*(\d+)/);
    const skin = c.match(/SKIN\s*:\s*(\d+)\s*\(([^)]+)\)/);
    if (orga) { meta.orgaId = orga[1]; meta.orgaName = orga[2].trim(); }
    if (site) meta.siteId = site[1];
    if (skin) { meta.skinId = skin[1]; meta.skinName = skin[2].trim(); }

    const codeMatch = c.match(/Version du code[.\s:]*([a-f0-9]{7,})\s*\(commit du\s*([^)]+)\)/);
    if (codeMatch) {
      meta.codeCommit = codeMatch[1].substring(0, 7);
      meta.codeCommitDate = codeMatch[2].trim();
    }

    const tplMatch = c.match(/Version du tpl de skin[.\s:]*(\d{2}\/\d{2}\/\d{4}[^|\r\n]*)/);
    if (tplMatch) meta.skinTplDate = tplMatch[1].trim();
  }
  return meta;
}

/**
 * Extrait les erreurs PHP signifiantes (filtre le bruit infra + dedup).
 * @param {Array} feedback
 * @returns {Array<{level, msg, file, line}>}
 */
export function extractPhpIssues(feedback) {
  if (!Array.isArray(feedback)) return [];
  const seen = new Set();
  const issues = [];

  for (const item of feedback) {
    if (!item || item.type !== 'error') continue;
    const c = (item.content || '').trim();
    if (!c) continue;
    if (NOISE_REGEX.some(p => p.test(c))) continue;

    const level = (c.match(/E_\w+/) || [])[0] || 'PHP_ERROR';
    const msgMatch = c.match(/MSG\s*:\s*([^\r\n]+)/);
    const msg = (msgMatch ? msgMatch[1] : c.split('\n')[0]).trim();
    const fileMatch = c.match(/FILE\s*:\s*(\S+)/);
    const file = fileMatch ? fileMatch[1].trim() : null;
    const lineMatch = c.match(/LINE\s*:\s*(\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : null;

    const key = `${level}|${msg}|${file}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ level, msg: msg.substring(0, 240), file, line });
  }
  return issues;
}

/**
 * Module QA-BALT : audit AZKO via debug feedback (homepage uniquement).
 * @param {string} baseUrl
 * @param {Array} pages
 * @param {Object} siteContext (mute pour stocker azkoMeta)
 * @returns {{issues, metadata?, skipped?, reason?}}
 */
export function runDebuglogChecks(baseUrl, pages, siteContext) {
  const token = process.env.AZKO_DEBUG_TOKEN;
  if (!token) {
    return { issues: [], skipped: true, reason: 'AZKO_DEBUG_TOKEN absent du .env' };
  }

  const url = `${baseUrl}/?debuglog=${encodeURIComponent(token)}`;
  const html = safeCurl(url, { maxTime: 20 });
  if (!html) {
    return { issues: [], skipped: true, reason: 'fetch debuglog homepage failed' };
  }

  const feedback = extractFeedback(html);
  if (!feedback) {
    return { issues: [], skipped: true, reason: 'oJsonFeedback non trouve (token invalide ?)' };
  }

  const metadata = extractMetadata(feedback);
  const phpIssues = extractPhpIssues(feedback);

  // Enrichir siteContext pour le rapport
  if (siteContext && typeof siteContext === 'object') {
    siteContext.azkoMeta = metadata;
  }

  // Log inline (visible dans l'audit + SSE)
  if (metadata.orgaName) console.log(`   ORGA: ${metadata.orgaId} (${metadata.orgaName})`);
  if (metadata.siteId) console.log(`   SITE: ${metadata.siteId}`);
  if (metadata.skinName) console.log(`   SKIN: ${metadata.skinId} (${metadata.skinName})`);
  if (metadata.codeCommitDate) console.log(`   Version code: ${metadata.codeCommit} (${metadata.codeCommitDate})`);
  if (metadata.skinTplDate) console.log(`   Version tpl: ${metadata.skinTplDate}`);
  console.log(`   ${phpIssues.length} erreur(s) PHP retenue(s)`);

  const issues = phpIssues.map(p => ({
    severity: FATAL_LEVELS.includes(p.level) ? 'BLOQUANT' : 'IMPORTANT',
    id: `PHP_${p.level.replace(/^E_/, '')}`,
    title: `Erreur PHP serveur (${p.level})`,
    detail: `${p.msg}${p.file ? ` — ${p.file}${p.line ? ':' + p.line : ''}` : ''}`,
    page: '/',
  }));

  return { issues, metadata };
}
