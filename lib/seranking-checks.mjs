/**
 * Checks performance via SE Ranking Site Audit API
 *
 * Crée un audit Standard (2 credits/page), poll le status,
 * extrait les Core Web Vitals (Lighthouse lab data) et le health score.
 *
 * Requiert SERANKING_API_TOKEN dans .env ou process.env.
 * Si le token n'est pas défini, le module skip silencieusement.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { shellEscape } from './utils.mjs';
import { SERANKING } from './config.mjs';

// ── Lecture token depuis .env ──
function getToken() {
  if (process.env.SERANKING_API_TOKEN) return process.env.SERANKING_API_TOKEN;
  try {
    const envPath = resolve(import.meta.dirname, '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^SERANKING_API_TOKEN=(.+)$/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

// ── Helper fetch API (via curl pour rester cohérent avec le projet) ──
function apiCall(method, endpoint, token, body = null) {
  const url = `${SERANKING.baseUrl}${endpoint}`;
  const escapedUrl = shellEscape(url);
  const args = [
    'curl', '-s', '-X', method,
    '-H', shellEscape(`Authorization: Token ${token}`),
    '-H', shellEscape('Content-Type: application/json'),
  ];
  if (body) {
    args.push('-d', shellEscape(JSON.stringify(body)));
  }
  args.push(escapedUrl);

  let result;
  try {
    result = execSync(args.join(' '), { timeout: 30000, encoding: 'utf-8' });
  } catch (err) {
    console.error(`   SE Ranking API error (${method} ${endpoint}): ${err.message}`);
    return null;
  }

  try {
    return JSON.parse(result);
  } catch (err) {
    // Log truncated response for debugging (auth errors, rate limits, HTML error pages)
    const preview = (result || '').slice(0, 200);
    console.error(`   SE Ranking API malformed JSON (${method} ${endpoint}): ${preview}`);
    return null;
  }
}

// ── Polling avec timeout (async pour ne pas bloquer l'event loop) ──
async function waitForAudit(auditId, token) {
  const start = Date.now();
  while (Date.now() - start < SERANKING.pollTimeoutMs) {
    const status = apiCall('GET', `/site-audit/audits/status?audit_id=${auditId}`, token);
    if (!status) return null;

    if (status.status === 'finished') return status;
    if (status.status === 'cancelled' || status.status === 'expired') return null;

    // Attente non-bloquante avant prochain poll
    await new Promise(r => setTimeout(r, SERANKING.pollIntervalMs));
  }
  return null; // Timeout
}

// ── Parse valeur CWV depuis snippet (ex: "6.1 s", "0.23", "245 ms") ──
function parseCwvValue(snippet) {
  if (!snippet?.value) return null;
  const raw = snippet.value.toString().trim();

  // "6.1 s" → 6100 ms
  const secMatch = raw.match(/^([\d.]+)\s*s$/i);
  if (secMatch) return parseFloat(secMatch[1]) * 1000;

  // "245 ms" → 245 ms
  const msMatch = raw.match(/^([\d.]+)\s*ms$/i);
  if (msMatch) return parseFloat(msMatch[1]);

  // "0.23" (CLS, pas d'unité)
  const numMatch = raw.match(/^([\d.]+)$/);
  if (numMatch) return parseFloat(numMatch[1]);

  return null;
}

// ── Mapping code axe → métrique CWV ──
const CWV_CODES = {
  lighthouse_lcp: { metric: 'LCP', unit: 'ms', thresholdKey: 'lcp', label: 'Largest Contentful Paint' },
  lighthouse_cls: { metric: 'CLS', unit: '', thresholdKey: 'cls', label: 'Cumulative Layout Shift' },
  lighthouse_fcp: { metric: 'FCP', unit: 'ms', thresholdKey: 'fcp', label: 'First Contentful Paint' },
  lighthouse_tbt: { metric: 'TBT', unit: 'ms', thresholdKey: 'tbt', label: 'Total Blocking Time' },
};

export async function runSeRankingChecks(baseUrl) {
  const issues = [];
  const token = getToken();

  if (!token) {
    return { issues, skipped: true, reason: 'SERANKING_API_TOKEN non défini' };
  }

  // Extraire le domaine
  const domain = new URL(baseUrl).hostname;

  console.log(`   Création audit SE Ranking (${SERANKING.mode}, max ${SERANKING.maxPages} pages)...`);

  // 1. Créer l'audit
  const audit = apiCall('POST', `/site-audit/audits/${SERANKING.mode}`, token, {
    domain,
    title: `QA-BALT ${domain} ${new Date().toISOString().slice(0, 10)}`,
    settings: {
      max_pages: SERANKING.maxPages,
      max_depth: 3,
      source_site: 1,
      source_sitemap: 1,
      source_subdomain: 0,
    },
  });

  if (!audit?.id) {
    return { issues, skipped: true, reason: `Erreur création audit: ${JSON.stringify(audit)}` };
  }

  const auditId = audit.id;
  console.log(`   Audit #${auditId} créé — polling...`);

  // 2. Attendre la fin
  const status = await waitForAudit(auditId, token);
  if (!status) {
    cleanup(auditId, token);
    return { issues, skipped: true, reason: 'Audit timeout ou annulé' };
  }

  console.log(`   Audit terminé — ${status.total_pages} pages, ${status.total_errors} erreurs, ${status.total_warnings} warnings`);

  // 3. Récupérer le rapport global (health score)
  const report = apiCall('GET', `/site-audit/audits/report?audit_id=${auditId}`, token);

  if (report) {
    // Health score global
    const healthScore = extractHealthScore(report);
    if (healthScore !== null) {
      if (healthScore < SERANKING.healthScore.warning) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'PERF_HEALTH_SCORE',
          title: `Score santé SE Ranking : ${healthScore}/100`,
          detail: `Le score global est faible (< ${SERANKING.healthScore.warning}). `
            + `${status.total_errors} erreurs et ${status.total_warnings} warnings détectés sur ${status.total_pages} pages.`,
        });
      } else if (healthScore < SERANKING.healthScore.good) {
        issues.push({
          severity: 'MINEUR',
          id: 'PERF_HEALTH_SCORE',
          title: `Score santé SE Ranking : ${healthScore}/100`,
          detail: `Score correct mais améliorable (< ${SERANKING.healthScore.good}). `
            + `${status.total_errors} erreurs et ${status.total_warnings} warnings.`,
        });
      }
    }
  }

  // 4. Récupérer les pages crawlées
  const pagesData = apiCall('GET', `/site-audit/audits/pages?audit_id=${auditId}&limit=20`, token);

  if (pagesData?.data) {
    // 5. Pour chaque page, extraire les issues CWV
    for (const pageInfo of pagesData.data) {
      const pageUrl = pageInfo.url || '';
      const pageName = pageUrl.replace(baseUrl, '').replace(/^https?:\/\/[^/]+/, '') || '/';

      // Récupérer les issues de cette page
      const pageIssues = apiCall('GET',
        `/site-audit/audits/issues?audit_id=${auditId}&url=${encodeURIComponent(pageUrl)}`, token);

      if (!pageIssues?.issues) continue;

      // Filtrer les issues CWV
      for (const issue of pageIssues.issues) {
        const cwvDef = CWV_CODES[issue.code];
        if (!cwvDef) continue;

        const value = parseCwvValue(issue.snippet);
        if (value === null) continue;

        const thresholds = SERANKING.cwvThresholds[cwvDef.thresholdKey];
        if (!thresholds) continue;

        // Déterminer la sévérité selon les seuils Google
        let severity = null;
        let status_label = '';
        if (cwvDef.thresholdKey === 'cls') {
          // CLS : pas d'unité, valeur directe
          if (value > thresholds.poor) {
            severity = 'IMPORTANT';
            status_label = 'Poor';
          } else if (value > thresholds.good) {
            severity = 'MINEUR';
            status_label = 'Needs Improvement';
          }
        } else {
          // Métriques en ms
          if (value > thresholds.poor) {
            severity = 'IMPORTANT';
            status_label = 'Poor';
          } else if (value > thresholds.good) {
            severity = 'MINEUR';
            status_label = 'Needs Improvement';
          }
        }

        if (severity) {
          const displayValue = cwvDef.thresholdKey === 'cls'
            ? value.toFixed(2)
            : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

          issues.push({
            severity,
            id: `PERF_${cwvDef.metric}`,
            page: pageName,
            title: `${cwvDef.label} : ${displayValue} (${status_label})`,
            detail: `${cwvDef.metric} = ${displayValue} — seuil Good: ${formatThreshold(thresholds.good, cwvDef.thresholdKey)}, `
              + `Poor: ${formatThreshold(thresholds.poor, cwvDef.thresholdKey)}. `
              + `Source: SE Ranking Lighthouse (lab data).`,
          });
        }
      }

      // Loading speed from page data
      if (pageInfo.load_ms && pageInfo.load_ms > 3000) {
        issues.push({
          severity: pageInfo.load_ms > 5000 ? 'IMPORTANT' : 'MINEUR',
          id: 'PERF_SLOW_LOAD',
          page: pageName,
          title: `Temps de chargement lent : ${(pageInfo.load_ms / 1000).toFixed(1)}s`,
          detail: `La page met ${(pageInfo.load_ms / 1000).toFixed(1)}s à charger (seuil: 3s).`,
        });
      }
    }
  }

  // 6. Cleanup
  cleanup(auditId, token);

  return {
    issues,
    skipped: false,
    auditId,
    totalPages: status.total_pages,
    totalErrors: status.total_errors,
    totalWarnings: status.total_warnings,
  };
}

function cleanup(auditId, token) {
  if (SERANKING.cleanupAfter) {
    apiCall('DELETE', `/site-audit/audits?audit_id=${auditId}`, token);
  }
}

function extractHealthScore(report) {
  // Le health score est dans le rapport — chercher dans les sections
  if (typeof report.health_score === 'number') return report.health_score;
  if (report.score !== undefined) return report.score;
  // Parfois dans total_data
  if (report.total_data?.health_score !== undefined) return report.total_data.health_score;
  return null;
}

function formatThreshold(value, key) {
  if (key === 'cls') return value.toString();
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}
