#!/usr/bin/env node
/**
 * QA-BALT — Tests de non-regression
 *
 * Compare les issue IDs detectes avec un baseline enregistre.
 * Detecte les regressions (issues manquantes) et les nouveaux problemes.
 *
 * Usage :
 *   node tests/run-regression.mjs                      # Run tous les sites
 *   node tests/run-regression.mjs --update             # Regenerer les baselines
 *   node tests/run-regression.mjs --site <url>         # Un seul site
 *   node tests/run-regression.mjs --site <url> --update
 */
import { crawlSite, checkPagesStatus } from '../lib/crawler.mjs';
import { runTechChecks } from '../lib/tech-checks.mjs';
import { runLinkChecks } from '../lib/link-checks.mjs';
import { runPageChecks } from '../lib/page-checks.mjs';
import { runContentChecks } from '../lib/content-checks.mjs';
import { findModel } from '../lib/models.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

const __dirname = import.meta.dirname;
const baselineDir = resolve(__dirname, 'baselines');

// ── Config ──
const TEST_SITES = [
  { url: 'http://camping-arquebuse.site.azko.fr', label: 'camping-arquebuse', model: 'bellini' },
  { url: 'http://lc-avocats.site.azko.fr', label: 'lc-avocats', model: null },
];

// ── Args ──
const args = process.argv.slice(2);
const updateMode = args.includes('--update');
const siteFilter = args.indexOf('--site') >= 0 ? args[args.indexOf('--site') + 1] : null;

// ── Couleurs terminal ──
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── Run checks tech-only pour un site ──
function runChecksForSite(siteUrl, model) {
  const baseUrl = siteUrl.replace(/\/$/, '');

  const siteContext = {};
  if (model) {
    siteContext.model = model;
    siteContext.modelRef = findModel(model);
  }

  console.log(`   Crawl...`);
  const pages = crawlSite(baseUrl);
  const pagesWithStatus = checkPagesStatus(baseUrl, pages);

  console.log(`   Tech checks (${pages.length} pages)...`);
  const techResult = runTechChecks(baseUrl);

  console.log(`   Link checks...`);
  const linkResult = runLinkChecks(baseUrl, pagesWithStatus, siteContext);

  console.log(`   Page checks...`);
  const pageResult = runPageChecks(baseUrl, pagesWithStatus);

  console.log(`   Content checks...`);
  const contentResult = runContentChecks(baseUrl, pagesWithStatus);

  const allIssues = [
    ...techResult.issues,
    ...linkResult.issues,
    ...pageResult.issues,
    ...contentResult.issues,
  ];

  // Extraire les tuples uniques (id + severity)
  // On ne compare pas par page car les pages peuvent varier
  const issueMap = new Map();
  for (const issue of allIssues) {
    const key = issue.id;
    if (!issueMap.has(key)) {
      issueMap.set(key, { id: issue.id, severity: issue.severity, count: 0 });
    }
    issueMap.get(key).count++;
  }

  return [...issueMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ── Comparer avec baseline ──
function compareWithBaseline(label, current) {
  const baselinePath = resolve(baselineDir, `${label}.json`);

  if (!existsSync(baselinePath)) {
    console.log(yellow(`   Pas de baseline pour ${label} — utiliser --update pour creer`));
    return { status: 'no-baseline', missing: [], added: [], changed: [] };
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
  const baselineIssues = baseline.issues;

  const baselineMap = new Map(baselineIssues.map(i => [i.id, i]));
  const currentMap = new Map(current.map(i => [i.id, i]));

  const missing = []; // dans baseline mais pas dans current = regression detection
  const added = [];   // dans current mais pas dans baseline = nouveau probleme ou faux positif
  const changed = []; // meme ID mais severite differente

  for (const [id, bIssue] of baselineMap) {
    if (!currentMap.has(id)) {
      missing.push(bIssue);
    } else if (currentMap.get(id).severity !== bIssue.severity) {
      changed.push({ id, was: bIssue.severity, now: currentMap.get(id).severity });
    }
  }

  for (const [id, cIssue] of currentMap) {
    if (!baselineMap.has(id)) {
      added.push(cIssue);
    }
  }

  const status = missing.length > 0 ? 'regression' : 'ok';
  return { status, missing, added, changed };
}

// ── Sauvegarder un baseline ──
function saveBaseline(label, siteUrl, issues) {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
  const data = {
    tool_version: pkg.version,
    site: siteUrl,
    mode: 'tech-only',
    date: new Date().toISOString().slice(0, 10),
    issues,
  };
  const path = resolve(baselineDir, `${label}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(green(`   Baseline sauvegarde → ${basename(path)} (${issues.length} issue IDs)`));
}

// ── Main ──
console.log(bold(`\n🧪 QA-BALT — Tests de non-regression\n`));

const sites = siteFilter
  ? TEST_SITES.filter(s => s.url.includes(siteFilter) || s.label.includes(siteFilter))
  : TEST_SITES;

if (sites.length === 0) {
  console.log(red(`Aucun site ne correspond a "${siteFilter}"`));
  console.log(`Sites disponibles : ${TEST_SITES.map(s => s.label).join(', ')}`);
  process.exit(1);
}

let totalMissing = 0;
let totalAdded = 0;
let totalChanged = 0;
let hasRegression = false;

for (const site of sites) {
  console.log(bold(`\n📋 ${site.label} (${site.url})`));

  const issues = runChecksForSite(site.url, site.model);
  console.log(`   ${issues.length} issue IDs detectes`);

  if (updateMode) {
    saveBaseline(site.label, site.url, issues);
    continue;
  }

  const result = compareWithBaseline(site.label, issues);

  if (result.status === 'no-baseline') continue;

  // Afficher les resultats
  if (result.missing.length === 0 && result.added.length === 0 && result.changed.length === 0) {
    console.log(green(`   ✅ Aucune regression — ${issues.length} issues identiques au baseline`));
  } else {
    if (result.missing.length > 0) {
      hasRegression = true;
      console.log(red(`\n   🔴 REGRESSIONS (${result.missing.length} issues disparues) :`));
      for (const m of result.missing) {
        console.log(red(`      - ${m.id} (${m.severity})`));
      }
    }

    if (result.added.length > 0) {
      console.log(yellow(`\n   🟡 NOUVEAUX (${result.added.length} nouvelles issues) :`));
      for (const a of result.added) {
        console.log(yellow(`      + ${a.id} (${a.severity}) x${a.count}`));
      }
    }

    if (result.changed.length > 0) {
      console.log(yellow(`\n   🟠 SEVERITE CHANGEE (${result.changed.length}) :`));
      for (const c of result.changed) {
        console.log(yellow(`      ~ ${c.id} : ${c.was} → ${c.now}`));
      }
    }
  }

  totalMissing += result.missing.length;
  totalAdded += result.added.length;
  totalChanged += result.changed.length;
}

// ── Resume ──
if (!updateMode) {
  console.log(bold(`\n${'═'.repeat(50)}`));
  console.log(bold(`RESUME`));
  console.log(`  Sites testes : ${sites.length}`);
  console.log(`  Regressions  : ${totalMissing > 0 ? red(totalMissing) : green('0')}`);
  console.log(`  Nouveaux     : ${totalAdded > 0 ? yellow(totalAdded) : green('0')}`);
  console.log(`  Changements  : ${totalChanged > 0 ? yellow(totalChanged) : green('0')}`);
  console.log(bold(`${'═'.repeat(50)}\n`));

  if (hasRegression) {
    console.log(red(`⛔ REGRESSIONS DETECTEES — Verifier les checks avant merge.\n`));
    process.exit(1);
  } else {
    console.log(green(`✅ Pas de regression.\n`));
    process.exit(0);
  }
} else {
  console.log(green(`\n✅ Baselines mis a jour pour ${sites.length} site(s).\n`));
}
