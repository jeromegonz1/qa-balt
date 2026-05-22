#!/usr/bin/env node
/**
 * QA-BALT — Agent QA automatisé pour sites AZKO/BALT
 *
 * Usage :
 *   node qa.mjs <url-preprod>
 *   node qa.mjs <url-preprod> --tech-only     (pas de Playwright)
 *   node qa.mjs <url-preprod> --visual-only   (Playwright uniquement)
 *   node qa.mjs <url-preprod> --model-url <url-modele>  (compare avec le template)
 *
 * Exemple :
 *   node qa.mjs http://camping-arquebuse.site.azko.fr
 *   node qa.mjs http://cabinet-dupont.site.azko.fr --model-url http://alimon.site.azko.fr
 */
import { crawlSite, checkPagesStatus } from './lib/crawler.mjs';
import { runTechChecks } from './lib/tech-checks.mjs';
import { runLinkChecks } from './lib/link-checks.mjs';
import { runPageChecks } from './lib/page-checks.mjs';
import { runContentChecks } from './lib/content-checks.mjs';
import { runVisualChecks } from './lib/visual-checks.mjs';
import { runA11yChecks } from './lib/a11y-checks.mjs';
import { runDebuglogChecks } from './lib/debuglog-checks.mjs';
import { runSeRankingChecks } from './lib/seranking-checks.mjs';
import { generateReport } from './lib/report.mjs';
import { generateHtmlReport } from './lib/report-html.mjs';
import { findModel } from './lib/models.mjs';
import { extractModelFromHtml } from './lib/model-detection.mjs';
import { validatePublicUrl, safeCurl } from './lib/utils.mjs';
import { validateAuditUrl, validateModelUrl } from './lib/url-guard.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// Charger .env (parite avec server.mjs) — utile quand qa.mjs est lance via CLI
const envPath = resolve(import.meta.dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

// ═══════════════════════════════════════
// Module registry — ajouter un module = ajouter un objet ici
// ═══════════════════════════════════════
// Pipeline en phases (sprint 2.b — parallelisation modules).
// Modules de la meme phase tournent en parallele via Promise.all.
// Phases tournent en sequence pour eviter de saturer le WAF Septeo.
//
//   A : curl leger 1 page (tech + debuglog)
//   B : curl multi-pages (link, page, content) — sequentiel, deja gros volume HTTP
//   C : Playwright (visual + a11y) — parallele, instances chromium independantes
//   D : API externe (seranking) — peut tourner pendant C (n'utilise pas le site cible)
const MODULE_REGISTRY = [
  {
    id: 'tech', phase: 'A',
    label: '🔧 Checks techniques',
    fn: runTechChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
  },
  {
    id: 'debuglog', phase: 'A',
    label: '🐘 Erreurs PHP serveur (debuglog AZKO)',
    fn: runDebuglogChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.siteContext],
  },
  {
    id: 'link', phase: 'B',
    label: '🔗 Checks des liens',
    fn: runLinkChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.siteContext],
  },
  {
    id: 'page', phase: 'B',
    label: '👤 Checks par page',
    fn: runPageChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
  },
  {
    id: 'content', phase: 'B',
    label: '📄 Détection de contenu',
    fn: runContentChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.modelUrl],
  },
  {
    id: 'visual', phase: 'C',
    label: '🖥️  Checks visuels (Playwright)',
    fn: runVisualChecks,
    guard: ({ techOnly }) => !techOnly,
    args: (ctx) => [ctx.baseUrl, ctx.okPages, ctx.screenshotsDir],
    async: true,
  },
  {
    id: 'a11y', phase: 'C',
    label: '♿ Checks accessibilité (axe-core)',
    fn: runA11yChecks,
    guard: ({ techOnly }) => !techOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
    async: true,
  },
  {
    id: 'perf', phase: 'C',
    label: '⚡ Checks performance (SE Ranking)',
    fn: runSeRankingChecks,
    guard: ({ techOnly, visualOnly }) => !techOnly && !visualOnly,
    args: (ctx) => [ctx.baseUrl],
    async: true,
  },
];

// ═══════════════════════════════════════
// Parsing des arguments
// ═══════════════════════════════════════
const args = process.argv.slice(2);
const url = args.find(a => a.startsWith('http'));
const techOnly = args.includes('--tech-only');
const visualOnly = args.includes('--visual-only');
const modelUrl = args.find(a => a.startsWith('--model-url='))?.split('=')[1]
  || (args.indexOf('--model-url') >= 0 ? args[args.indexOf('--model-url') + 1] : null);
const siteContextIdx = args.indexOf('--site-context');
const siteContextArg = siteContextIdx >= 0 ? args[siteContextIdx + 1] : null;

if (!url) {
  console.log(`
╔══════════════════════════════════════════════════╗
║          QA-BALT — Agent QA AZKO                 ║
╚══════════════════════════════════════════════════╝

Usage:
  node qa.mjs <url-preprod>                          # Audit complet
  node qa.mjs <url-preprod> --tech-only              # Checks techniques seuls
  node qa.mjs <url-preprod> --visual-only            # Checks visuels seuls
  node qa.mjs <url-preprod> --model-url <url>        # Compare avec le modèle
  node qa.mjs <url-preprod> --site-context '{...}'   # Contexte ClickUp (JSON)

Exemple:
  node qa.mjs http://camping-arquebuse.site.azko.fr
  node qa.mjs http://cabinet-x.site.azko.fr --model-url http://alimon.site.azko.fr
  node qa.mjs http://site.azko.fr --site-context '{"model":"bellini","sector":"camping"}'
`);
  process.exit(1);
}

// Normaliser et valider l'URL (whitelist *.azko.fr + SSRF)
const baseUrl = url.replace(/\/$/, '');
try {
  validateAuditUrl(baseUrl);
  await validatePublicUrl(baseUrl);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

// Valider modelUrl si present (whitelist + SSRF)
if (modelUrl) {
  try {
    validateModelUrl(modelUrl);
    await validatePublicUrl(modelUrl);
  } catch (err) {
    console.error(`❌ Model URL: ${err.message}`);
    process.exit(1);
  }
}

// Contexte site (enrichi par ClickUp via --site-context, vide en CLI)
let siteContext = {};
if (siteContextArg) {
  try {
    siteContext = JSON.parse(siteContextArg);
  } catch {
    console.warn('   ⚠️ --site-context JSON invalide, contexte ignoré');
  }
}
const domain = new URL(baseUrl).hostname;

// Cascade detection modele : saisie manuelle (ClickUp/CLI) prioritaire, sinon HTML widget
if (siteContext.model) {
  siteContext.modelDetectionSource = 'manual';
  console.log(`🎯 Modèle (saisie manuelle) : ${siteContext.model}`);
} else {
  const homepageHtml = safeCurl(`${baseUrl}/`, { maxTime: 15 });
  const detected = extractModelFromHtml(homepageHtml);
  if (detected) {
    siteContext.model = detected.id;
    siteContext.modelDetectionSource = 'html-widget';
    if (!siteContext.sector) siteContext.detectedVertical = detected.vertical;
    console.log(`🎯 Modèle (auto-détecté HTML widget) : ${detected.name} — vertical ${detected.vertical}`);
  } else {
    siteContext.modelDetectionSource = 'none';
    console.log(`🎯 Modèle : non spécifié, widget HTML absent — comparaison modèle désactivée`);
  }
}

// Enrichir avec la référence modèle si on en a un
if (siteContext.model) {
  siteContext.modelRef = findModel(siteContext.model);
}
const siteSlug = domain.split('.')[0];
const timestamp = new Date().toISOString().slice(0, 10);

// Dossiers de sortie
const reportsDir = resolve(import.meta.dirname, 'reports');
const screenshotsDir = resolve(import.meta.dirname, 'screenshots', `${siteSlug}-${timestamp}`);
mkdirSync(reportsDir, { recursive: true });
mkdirSync(screenshotsDir, { recursive: true });

console.log(`\n🔍 QA-BALT — Audit de ${baseUrl}`);
console.log(`   Rapport → reports/${siteSlug}-${timestamp}.md + .html`);
console.log(`   Screenshots → screenshots/${siteSlug}-${timestamp}/\n`);

// ═══════════════════════════════════════
// 1. Crawl des pages
// ═══════════════════════════════════════
console.log('📡 Crawl des pages...');
const pages = crawlSite(baseUrl);
console.log(`   ${pages.length} pages découvertes`);

// Vérifier le status HTTP de chaque page
console.log('🔗 Vérification des status HTTP...');
const pagesWithStatus = checkPagesStatus(baseUrl, pages);
const okPages = pagesWithStatus.filter(p => p.status >= 200 && p.status < 400);
const koPages = pagesWithStatus.filter(p => p.status >= 400 || p.status === 0);
console.log(`   ${okPages.length} OK / ${koPages.length} KO`);
if (koPages.length) {
  koPages.forEach(p => console.log(`   ❌ ${p.path} → ${p.status}`));
}

// ═══════════════════════════════════════
// 2. Exécution des modules via registry — par phases (sprint 2.b)
// ═══════════════════════════════════════
const ctx = { baseUrl, pagesWithStatus, okPages, siteContext, modelUrl, screenshotsDir };
const results = {};

/**
 * Lance un module : capture stdout/stderr du module dans un buffer pour
 * eviter l'entrelacement des logs entre modules paralleles, puis flush
 * a la fin (ordre lisible meme en parallele).
 *
 * Retourne une promise qui resout toujours (pas de reject) : un module
 * en echec ne casse pas la phase.
 */
async function runOneModule(mod, ctx, results) {
  const lines = [`\n${mod.label}...`];
  // Capture intercept simple : on prefere ne PAS rerouter console.log
  // globalement (race conditions avec modules synchrones). On laisse les
  // modules ecrire leur log natif et on ajoute juste un separateur clair.
  // Si l'entrelacement devient genant a l'usage on revisitera.
  console.log(`\n${mod.label}...`);
  try {
    const result = mod.async
      ? await mod.fn(...mod.args(ctx))
      : await Promise.resolve(mod.fn(...mod.args(ctx)));
    results[mod.id] = result;
    const issues = result.issues || [];
    const b = issues.filter(i => i.severity === 'BLOQUANT').length;
    const im = issues.filter(i => i.severity === 'IMPORTANT').length;
    const mi = issues.filter(i => i.severity === 'MINEUR').length;
    if (result.skipped) {
      console.log(`   ⏭️  Skippé (${mod.id}) : ${result.reason}`);
    } else if (result.screenshotPaths) {
      console.log(`   [${mod.id}] ${issues.length} problèmes détectés, ${result.screenshotPaths.length} screenshots`);
    } else if (result.pagesAudited != null) {
      console.log(`   [${mod.id}] ${result.pagesAudited} pages auditées — ${b} bloquants, ${im} importants, ${mi} mineurs`);
    } else {
      console.log(`   [${mod.id}] ${b} bloquants, ${im} importants, ${mi} mineurs`);
    }
  } catch (err) {
    console.error(`   ⚠️ ${mod.id} error: ${err.message}`);
    results[mod.id] = { issues: [] };
  }
}

// Grouper les modules par phase (ordre alphabetique des cles de phase)
const phaseMap = {};
for (const mod of MODULE_REGISTRY) {
  if (!mod.guard({ techOnly, visualOnly })) continue;
  const ph = mod.phase || 'X';
  if (!phaseMap[ph]) phaseMap[ph] = [];
  phaseMap[ph].push(mod);
}
const phasesOrdered = Object.keys(phaseMap).sort();

// Execute phase par phase (en sequence), modules en parallele dans la phase
const tPipelineStart = Date.now();
for (const ph of phasesOrdered) {
  const mods = phaseMap[ph];
  const tPhaseStart = Date.now();
  if (mods.length === 1) {
    await runOneModule(mods[0], ctx, results);
  } else {
    console.log(`\n━━━ Phase ${ph} : ${mods.length} modules en parallele (${mods.map(m => m.id).join(', ')}) ━━━`);
    await Promise.allSettled(mods.map(m => runOneModule(m, ctx, results)));
  }
  const phaseSec = ((Date.now() - tPhaseStart) / 1000).toFixed(1);
  if (mods.length > 1) console.log(`━━━ Phase ${ph} terminee en ${phaseSec}s ━━━`);
}
const pipelineSec = ((Date.now() - tPipelineStart) / 1000).toFixed(1);
console.log(`\n⏱  Pipeline modules : ${pipelineSec}s (parallelise par phase ${phasesOrdered.join('+')})`);

// Ajouter les pages 404 comme issues tech (hors registry, dépend du crawl)
const techIssues = results.tech?.issues || [];
if (!visualOnly) {
  for (const p of koPages) {
    techIssues.push({
      severity: 'IMPORTANT',
      id: 'PAGE_404',
      page: p.name,
      title: `Page ${p.path} retourne ${p.status}`,
      detail: `HTTP ${p.status} — page inaccessible.`,
    });
  }
}

// Extraire les résultats nommés pour le rapport
const techInfo = results.tech?.info || {};
const linkIssues = results.link?.issues || [];
const pageIssues = results.page?.issues || [];
const contentIssues = results.content?.issues || [];
const visualIssues = results.visual?.issues || [];
const a11yIssues = results.a11y?.issues || [];
const perfIssues = results.perf?.issues || [];
const debuglogIssues = results.debuglog?.issues || [];
// Sprint 4-pre : robustesse galerie — scanner le dossier filesystem plutot
// que de dependre du tableau retourne par visual-checks (qui est vide en cas
// de crash partiel du module). Tout PNG present sur disque est inclus.
let screenshotPaths = results.visual?.screenshotPaths || [];
try {
  if (existsSync(screenshotsDir)) {
    const filesOnDisk = readdirSync(screenshotsDir)
      .filter(f => /\.png$/i.test(f))
      .map(f => resolve(screenshotsDir, f));
    // Fusionne sans doublon (en cas ou les deux sources se chevauchent)
    const set = new Set([...screenshotPaths, ...filesOnDisk]);
    screenshotPaths = [...set];
  }
} catch (e) {
  // Si lecture dir echoue, on garde le tableau du module
}

// ═══════════════════════════════════════
// 9. Génération du rapport
// ═══════════════════════════════════════
console.log('\n📝 Génération du rapport...');
const report = generateReport(baseUrl, {
  techIssues,
  linkIssues,
  pageIssues,
  contentIssues,
  techInfo,
  visualIssues,
  a11yIssues,
  perfIssues,
  debuglogIssues,
  pages: pagesWithStatus,
  screenshotPaths,
  siteContext,
});

const reportPath = resolve(reportsDir, `${siteSlug}-${timestamp}.md`);
writeFileSync(reportPath, report, 'utf-8');

const reportData = {
  techIssues, linkIssues, pageIssues, contentIssues,
  techInfo, visualIssues, a11yIssues, perfIssues, debuglogIssues,
  pages: pagesWithStatus, screenshotPaths, siteContext,
};
const htmlReport = generateHtmlReport(baseUrl, reportData);
const htmlReportPath = resolve(reportsDir, `${siteSlug}-${timestamp}.html`);
writeFileSync(htmlReportPath, htmlReport, 'utf-8');

// ═══════════════════════════════════════
// 10. Résumé final
// ═══════════════════════════════════════
const allIssues = [...techIssues, ...linkIssues, ...pageIssues, ...contentIssues, ...visualIssues, ...a11yIssues, ...perfIssues, ...debuglogIssues];
const totalBloquants = allIssues.filter(i => i.severity === 'BLOQUANT').length;
const totalImportants = allIssues.filter(i => i.severity === 'IMPORTANT').length;

console.log(`
╔══════════════════════════════════════════════════╗
║  RÉSULTAT                                        ║
╠══════════════════════════════════════════════════╣
║  Pages : ${String(pages.length).padEnd(3)} découvertes, ${String(okPages.length).padEnd(3)} OK              ║
║  Bloquants : ${String(totalBloquants).padEnd(37)}║
║  Importants : ${String(totalImportants).padEnd(36)}║
║  Total : ${String(allIssues.length).padEnd(3)} problèmes                         ║
╠══════════════════════════════════════════════════╣
║  Rapport : ${reportPath.split('/').slice(-2).join('/').padEnd(38)}║
╚══════════════════════════════════════════════════╝
`);

if (totalBloquants > 0) {
  console.log(`⛔ ${totalBloquants} BLOQUANT(S) — Le site n'est PAS prêt pour la prod.\n`);
  process.exit(1);
} else {
  console.log(`✅ Aucun bloquant — Le site peut partir en prod (${totalImportants} points à améliorer).\n`);
  process.exit(0);
}
