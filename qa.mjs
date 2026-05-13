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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
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
const MODULE_REGISTRY = [
  {
    id: 'tech',
    label: '🔧 Checks techniques',
    fn: runTechChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
  },
  {
    id: 'link',
    label: '🔗 Checks des liens',
    fn: runLinkChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.siteContext],
  },
  {
    id: 'page',
    label: '👤 Checks par page',
    fn: runPageChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
  },
  {
    id: 'content',
    label: '📄 Détection de contenu',
    fn: runContentChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.modelUrl],
  },
  {
    id: 'visual',
    label: '🖥️  Checks visuels (Playwright)',
    fn: runVisualChecks,
    guard: ({ techOnly }) => !techOnly,
    args: (ctx) => [ctx.baseUrl, ctx.okPages, ctx.screenshotsDir],
    async: true,
  },
  {
    id: 'a11y',
    label: '♿ Checks accessibilité (axe-core)',
    fn: runA11yChecks,
    guard: ({ techOnly }) => !techOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus],
    async: true,
  },
  {
    id: 'debuglog',
    label: '🐘 Erreurs PHP serveur (debuglog AZKO)',
    fn: runDebuglogChecks,
    guard: ({ visualOnly }) => !visualOnly,
    args: (ctx) => [ctx.baseUrl, ctx.pagesWithStatus, ctx.siteContext],
  },
  {
    id: 'perf',
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

// Normaliser et valider l'URL (+ protection SSRF)
const baseUrl = url.replace(/\/$/, '');
try {
  await validatePublicUrl(baseUrl);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

// Valider modelUrl si present (SSRF)
if (modelUrl) {
  try {
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
// 2. Exécution des modules via registry
// ═══════════════════════════════════════
const ctx = { baseUrl, pagesWithStatus, okPages, siteContext, modelUrl, screenshotsDir };
const results = {};

for (const mod of MODULE_REGISTRY) {
  if (!mod.guard({ techOnly, visualOnly })) continue;
  console.log(`\n${mod.label}...`);
  try {
    const result = mod.async
      ? await mod.fn(...mod.args(ctx))
      : mod.fn(...mod.args(ctx));
    results[mod.id] = result;
    // Log résumé
    const issues = result.issues || [];
    const b = issues.filter(i => i.severity === 'BLOQUANT').length;
    const im = issues.filter(i => i.severity === 'IMPORTANT').length;
    const mi = issues.filter(i => i.severity === 'MINEUR').length;
    if (result.skipped) {
      console.log(`   ⏭️  Skippé : ${result.reason}`);
    } else if (result.screenshotPaths) {
      console.log(`   ${issues.length} problèmes détectés, ${result.screenshotPaths.length} screenshots`);
    } else if (result.pagesAudited != null) {
      console.log(`   ${result.pagesAudited} pages auditées`);
      console.log(`   ${b} bloquants, ${im} importants, ${mi} mineurs`);
    } else {
      console.log(`   ${b} bloquants, ${im} importants, ${mi} mineurs`);
    }
  } catch (err) {
    console.error(`   ⚠️ ${mod.id} error: ${err.message}`);
    results[mod.id] = { issues: [] };
  }
}

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
const screenshotPaths = results.visual?.screenshotPaths || [];

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
