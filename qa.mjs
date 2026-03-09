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
import { runSeRankingChecks } from './lib/seranking-checks.mjs';
import { generateReport } from './lib/report.mjs';
import { findModel } from './lib/models.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

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

// Normaliser et valider l'URL
const baseUrl = url.replace(/\/$/, '');
try {
  new URL(baseUrl);
} catch {
  console.error(`❌ URL invalide : ${baseUrl}`);
  process.exit(1);
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

// Enrichir avec la référence modèle si détecté
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
console.log(`   Rapport → reports/${siteSlug}-${timestamp}.md`);
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
// 2. Checks techniques (curl-based)
// ═══════════════════════════════════════
let techIssues = [];
let techInfo = {};

if (!visualOnly) {
  console.log('\n🔧 Checks techniques...');
  const techResult = runTechChecks(baseUrl);
  techIssues = techResult.issues;
  techInfo = techResult.info;

  // Ajouter les pages 404 comme issues
  for (const p of koPages) {
    techIssues.push({
      severity: 'IMPORTANT',
      id: 'PAGE_404',
      page: p.name,
      title: `Page ${p.path} retourne ${p.status}`,
      detail: `HTTP ${p.status} — page inaccessible.`,
    });
  }

  const bloquants = techIssues.filter(i => i.severity === 'BLOQUANT').length;
  const importants = techIssues.filter(i => i.severity === 'IMPORTANT').length;
  const mineurs = techIssues.filter(i => i.severity === 'MINEUR').length;
  console.log(`   ${bloquants} bloquants, ${importants} importants, ${mineurs} mineurs`);
}

// ═══════════════════════════════════════
// 3. Checks de liens (comme un humain qui clique partout)
// ═══════════════════════════════════════
let linkIssues = [];

if (!visualOnly) {
  console.log('\n🔗 Checks des liens...');
  const linkResult = runLinkChecks(baseUrl, pagesWithStatus, siteContext);
  linkIssues = linkResult.issues;

  const linkBloquants = linkIssues.filter(i => i.severity === 'BLOQUANT').length;
  const linkImportants = linkIssues.filter(i => i.severity === 'IMPORTANT').length;
  const linkMineurs = linkIssues.filter(i => i.severity === 'MINEUR').length;
  console.log(`   ${linkImportants} importants, ${linkMineurs} mineurs`);
}

// ═══════════════════════════════════════
// 4. Checks par page (humain qui navigue)
// ═══════════════════════════════════════
let pageIssues = [];

if (!visualOnly) {
  console.log('\n👤 Checks par page (title, H1, formulaires, images, téléphone...)...');
  const pageResult = runPageChecks(baseUrl, pagesWithStatus);
  pageIssues = pageResult.issues;

  const pgImportants = pageIssues.filter(i => i.severity === 'IMPORTANT').length;
  const pgMineurs = pageIssues.filter(i => i.severity === 'MINEUR').length;
  console.log(`   ${pgImportants} importants, ${pgMineurs} mineurs`);
}

// ═══════════════════════════════════════
// 5. Détection de contenu générique
// ═══════════════════════════════════════
let contentIssues = [];

if (!visualOnly) {
  console.log('\n📄 Détection de contenu générique / non personnalisé...');
  const contentResult = runContentChecks(baseUrl, pagesWithStatus, modelUrl);
  contentIssues = contentResult.issues;

  const ctBloquants = contentIssues.filter(i => i.severity === 'BLOQUANT').length;
  const ctImportants = contentIssues.filter(i => i.severity === 'IMPORTANT').length;
  const ctMineurs = contentIssues.filter(i => i.severity === 'MINEUR').length;
  console.log(`   ${ctBloquants} bloquants, ${ctImportants} importants, ${ctMineurs} mineurs`);
}

// ═══════════════════════════════════════
// 6. Checks visuels (Playwright)
// ═══════════════════════════════════════
let visualIssues = [];
let screenshotPaths = [];

if (!techOnly) {
  console.log('\n🖥️  Checks visuels (Playwright)...');
  try {
    const visualResult = await runVisualChecks(baseUrl, okPages, screenshotsDir);
    visualIssues = visualResult.issues;
    screenshotPaths = visualResult.screenshotPaths;
    console.log(`   ${visualIssues.length} problèmes détectés, ${screenshotPaths.length} screenshots`);
  } catch (err) {
    console.log(`   ⚠️ Playwright error: ${err.message}`);
    console.log('   Les checks visuels sont ignorés. Les checks techniques restent valides.');
  }
}

// ═══════════════════════════════════════
// 7. Checks accessibilité (axe-core)
// ═══════════════════════════════════════
let a11yIssues = [];

if (!techOnly) {
  console.log('\n♿ Checks accessibilité (axe-core WCAG 2.1 AA)...');
  try {
    const a11yResult = await runA11yChecks(baseUrl, pagesWithStatus);
    a11yIssues = a11yResult.issues;
    const a11yBloquants = a11yIssues.filter(i => i.severity === 'BLOQUANT').length;
    const a11yImportants = a11yIssues.filter(i => i.severity === 'IMPORTANT').length;
    const a11yMineurs = a11yIssues.filter(i => i.severity === 'MINEUR').length;
    console.log(`   ${a11yResult.pagesAudited} pages auditées`);
    console.log(`   ${a11yBloquants} bloquants, ${a11yImportants} importants, ${a11yMineurs} mineurs`);
  } catch (err) {
    console.log(`   ⚠️ axe-core error: ${err.message}`);
    console.log('   Les checks accessibilité sont ignorés.');
  }
}

// ═══════════════════════════════════════
// 8. Performance SE Ranking (Core Web Vitals)
// ═══════════════════════════════════════
let perfIssues = [];

if (!techOnly && !visualOnly) {
  console.log('\n⚡ Checks performance (SE Ranking — Core Web Vitals)...');
  try {
    const perfResult = await runSeRankingChecks(baseUrl);
    if (perfResult.skipped) {
      console.log(`   ⏭️  Skippé : ${perfResult.reason}`);
    } else {
      perfIssues = perfResult.issues;
      const perfImportants = perfIssues.filter(i => i.severity === 'IMPORTANT').length;
      const perfMineurs = perfIssues.filter(i => i.severity === 'MINEUR').length;
      console.log(`   ${perfResult.totalPages} pages auditées (${perfResult.totalErrors} erreurs, ${perfResult.totalWarnings} warnings)`);
      console.log(`   ${perfImportants} importants, ${perfMineurs} mineurs`);
    }
  } catch (err) {
    console.log(`   ⚠️ SE Ranking error: ${err.message}`);
    console.log('   Les checks performance sont ignorés.');
  }
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
  pages: pagesWithStatus,
  screenshotPaths,
  siteContext,
});

const reportPath = resolve(reportsDir, `${siteSlug}-${timestamp}.md`);
writeFileSync(reportPath, report, 'utf-8');

// ═══════════════════════════════════════
// 10. Résumé final
// ═══════════════════════════════════════
const allIssues = [...techIssues, ...linkIssues, ...pageIssues, ...contentIssues, ...visualIssues, ...a11yIssues, ...perfIssues];
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
