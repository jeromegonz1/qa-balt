#!/usr/bin/env node
/**
 * Tests unitaires — lib/report.mjs
 *
 * Couvre : groupIssues, categorize, generateReport structure
 */
import { groupIssues, categorize, CATEGORY_RULES, CATEGORY_LABELS, CATEGORY_ORDER, generateReport } from '../lib/report.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log('\n🧪 test-report.mjs\n');

// ═══════════════════════════════════════
// categorize
// ═══════════════════════════════════════
console.log('── categorize ──');

// Chaque prefix doit tomber dans la bonne categorie
const categoryTests = [
  ['A11Y_LINK_NAME', 'ACCESSIBILITE'],
  ['A11Y_IMAGE_ALT', 'ACCESSIBILITE'],
  ['FORM_LABEL_MISSING', 'ACCESSIBILITE'],
  ['OVERFLOW_HORIZONTAL', 'UX'],
  ['FONT_TOO_SMALL', 'UX'],
  ['IMG_BROKEN', 'UX'],
  ['BURGER_MENU_BROKEN', 'UX'],
  ['LOREM_IPSUM', 'CONTENU'],
  ['PLACEHOLDER_BRACKET', 'CONTENU'],
  ['GENERIC_AVOCAT_NAME', 'CONTENU'],
  ['CONTENT_NOT_PERSONALIZED', 'CONTENU'],
  ['BLACKLISTED_NAME', 'CONTENU'],
  ['BOOKING_DEMO_LINK', 'CMS'],
  ['LOGO_BAD_FORMAT', 'CMS'],
  ['SOCIAL_CROSS_CLIENT', 'CMS'],
  ['DEFAULT_PAGE_ACCESSIBLE', 'CMS'],
  ['TITLE_MISSING', 'SEO'],
  ['META_DESC_LONG', 'SEO'],
  ['H1_MISSING', 'SEO'],
  ['ALT_MISSING', 'SEO'],
  ['LINK_INTERNAL_BROKEN', 'SEO'],
  ['PERF_LCP', 'SEO'],
  ['URL_DIRTY', 'SEO'],
  ['SSL_EXPIRED', 'TECHNIQUE'],
  ['SITE_HTTP', 'TECHNIQUE'],
  ['PRIVACY_404', 'TECHNIQUE'],
  ['ROBOTS_DISALLOW_ALL', 'TECHNIQUE'],
];

for (const [id, expected] of categoryTests) {
  assertEqual(categorize(id), expected, `categorize(${id}) = ${expected}`);
}

// Fallback → TECHNIQUE pour IDs inconnus
assertEqual(categorize('UNKNOWN_CHECK'), 'TECHNIQUE', 'unknown ID falls back to TECHNIQUE');

// ═══════════════════════════════════════
// groupIssues
// ═══════════════════════════════════════
console.log('── groupIssues ──');

// Test basique : dedup par ID
const issues1 = [
  { id: 'TITLE_MISSING', severity: 'IMPORTANT', page: 'contact', title: 'Title manquant', detail: 'pas de title' },
  { id: 'TITLE_MISSING', severity: 'IMPORTANT', page: 'tarifs', title: 'Title manquant', detail: 'pas de title' },
  { id: 'SSL_EXPIRED', severity: 'BLOQUANT', title: 'SSL expire', detail: 'expire le...' },
];
const grouped1 = groupIssues(issues1, 10);

assertEqual(grouped1.length, 2, 'groupIssues dedup: 3 raw → 2 grouped');
const titleGroup = grouped1.find(g => g.id === 'TITLE_MISSING');
assert(titleGroup, 'TITLE_MISSING group exists');
assertEqual(titleGroup.count, 2, 'TITLE_MISSING count = 2');
assert(titleGroup.pages.includes('contact'), 'TITLE_MISSING includes contact');
assert(titleGroup.pages.includes('tarifs'), 'TITLE_MISSING includes tarifs');

// Test promotion severite
const issues2 = [
  { id: 'IMG_BROKEN', severity: 'IMPORTANT', page: 'p1', title: 'Image cassee', detail: '' },
  { id: 'IMG_BROKEN', severity: 'BLOQUANT', page: 'p2', title: 'Images cassees (5+)', detail: '' },
];
const grouped2 = groupIssues(issues2, 10);
const imgGroup = grouped2.find(g => g.id === 'IMG_BROKEN');
assertEqual(imgGroup.severity, 'BLOQUANT', 'severity promoted to BLOQUANT');

// Test scope template (>= 40% des pages)
const issuesTemplate = [];
for (let i = 0; i < 8; i++) {
  issuesTemplate.push({ id: 'LINK_EMPTY_ANCHOR', severity: 'MINEUR', page: `page${i}`, title: 'Ancre vide', detail: '' });
}
const groupedTemplate = groupIssues(issuesTemplate, 10);
const anchorGroup = groupedTemplate.find(g => g.id === 'LINK_EMPTY_ANCHOR');
assertEqual(anchorGroup.scope, 'template', '8/10 pages = template scope');

// Test non-template (< 40%)
const issuesNonTemplate = [
  { id: 'H1_MISSING', severity: 'IMPORTANT', page: 'p1', title: 'H1 manquant', detail: '' },
  { id: 'H1_MISSING', severity: 'IMPORTANT', page: 'p2', title: 'H1 manquant', detail: '' },
];
const groupedNonTemplate = groupIssues(issuesNonTemplate, 20);
const h1Group = groupedNonTemplate.find(g => g.id === 'H1_MISSING');
assertEqual(h1Group.scope, null, '2/20 pages = not template');

// Preservation des champs enrichis Phase A
const issuesEnriched = [
  {
    id: 'A11Y_BUTTON_NAME',
    severity: 'BLOQUANT',
    page: 'p1',
    title: 'Button must have name',
    detail: 'foo',
    element: { selector: '.btn', html: '<button>X</button>', location: 'header' },
    reference: 'https://docs.example/button-name',
  },
  // 2eme occurrence sur p2 — sans element (cas reel : axe-core ne capture qu'1 fois)
  {
    id: 'A11Y_BUTTON_NAME',
    severity: 'IMPORTANT',
    page: 'p2',
    title: 'Button must have name',
    detail: 'bar',
  },
];
const enrichedGroup = groupIssues(issuesEnriched, 10).find(g => g.id === 'A11Y_BUTTON_NAME');
assertEqual(enrichedGroup.element?.location, 'header', 'groupIssues preserve element.location depuis la 1re issue');
assertEqual(enrichedGroup.element?.selector, '.btn', 'groupIssues preserve element.selector');
assertEqual(enrichedGroup.reference, 'https://docs.example/button-name', 'groupIssues preserve reference');
assertEqual(enrichedGroup.severity, 'BLOQUANT', 'groupIssues promote severity au max (BLOQUANT > IMPORTANT)');

// Cas inverse : 1re issue sans element, 2eme avec → groupe recupere la 2eme
const issuesElementLater = [
  { id: 'X_TEST', severity: 'MINEUR', page: 'p1', title: 'foo', detail: '' },
  { id: 'X_TEST', severity: 'MINEUR', page: 'p2', title: 'foo', detail: '', element: { selector: '.late', location: 'footer' } },
];
const lateGroup = groupIssues(issuesElementLater, 10).find(g => g.id === 'X_TEST');
assertEqual(lateGroup.element?.location, 'footer', 'groupIssues recupere element si 1re issue sans, 2eme avec');

// ═══════════════════════════════════════
// generateReport structure
// ═══════════════════════════════════════
console.log('── generateReport ──');

const testIssues = [
  { id: 'SSL_EXPIRED', severity: 'BLOQUANT', title: 'SSL expire', detail: 'Test' },
  { id: 'NOINDEX', severity: 'CHECKLIST_MEP', title: 'Noindex', detail: 'Test' },
  { id: 'TITLE_MISSING', severity: 'IMPORTANT', page: 'contact', title: 'Title manquant', detail: 'Test' },
  { id: 'FAX_EMPTY', severity: 'MINEUR', title: 'Fax vide', detail: 'Test' },
];
const testPages = [
  { name: 'accueil', path: '/', status: 200 },
  { name: 'contact', path: '/contact.htm', status: 200 },
];

const report = generateReport('http://test.site.azko.fr', {
  techIssues: testIssues,
  linkIssues: [],
  pageIssues: [],
  contentIssues: [],
  techInfo: { server: 'nginx', robotsTxt: 'present', sitemap: 'present' },
  visualIssues: [],
  a11yIssues: [],
  perfIssues: [],
  pages: testPages,
  screenshotPaths: [],
  siteContext: {},
});

assert(report.includes('# QA Pre-Prod'), 'report has title');
assert(report.includes('SYNTHÈSE'), 'report has synthese section');
assert(report.includes('BLOQUANT'), 'report has BLOQUANT count');
assert(report.includes('CHECKLIST MEP'), 'report has CHECKLIST MEP count');
assert(report.includes('IMPORTANT'), 'report has IMPORTANT count');
assert(report.includes('MINEUR'), 'report has MINEUR count');
assert(report.includes('BLOQUANTS'), 'report has bloquants section');
assert(report.includes('CHECKLIST MEP'), 'report has checklist mep section');
assert(report.includes('PAGES ANALYSÉES'), 'report has pages section');
assert(report.includes("PRIORITÉS D'ACTION"), 'report has priorities section');
assert(report.includes('qa-balt v'), 'report has version footer');

// ═══════════════════════════════════════
// Constants exports
// ═══════════════════════════════════════
console.log('── constants ──');

assert(Array.isArray(CATEGORY_RULES), 'CATEGORY_RULES is array');
assert(CATEGORY_RULES.length > 10, 'CATEGORY_RULES has entries');
assert(typeof CATEGORY_LABELS === 'object', 'CATEGORY_LABELS is object');
assert(Array.isArray(CATEGORY_ORDER), 'CATEGORY_ORDER is array');
assertEqual(CATEGORY_ORDER.length, 6, '6 categories');

// ═══════════════════════════════════════
// Resume
// ═══════════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
