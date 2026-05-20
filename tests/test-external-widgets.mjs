#!/usr/bin/env node
/**
 * Tests unitaires — lib/external-widgets.mjs
 */
import { identifyExternalWidget, downgradeSeverity, EXTERNAL_WIDGETS } from '../lib/external-widgets.mjs';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}
function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

console.log('\n🧪 test-external-widgets.mjs\n');

// ─── Qualitelis ────────────────────────────────────────────────────
const qualitelisById = { selector: '#WidgetQualitelis .close', html: '<button class="close"></button>' };
assertEqual(identifyExternalWidget(qualitelisById)?.vendor, 'Qualitelis', 'Qualitelis par id #WidgetQualitelis');

const qualitelisByHtml = { selector: '.close', html: '<div class="qualitelis-widget" data-src="qualitelis.com/...">' };
assertEqual(identifyExternalWidget(qualitelisByHtml)?.vendor, 'Qualitelis', 'Qualitelis par htmlContains');

// ─── eSeason ───────────────────────────────────────────────────────
const eseasonById = { selector: '#eseason-booking-widget', html: '<div></div>' };
assertEqual(identifyExternalWidget(eseasonById)?.vendor, 'eSeason', 'eSeason par #eseason-');

const eseasonByClass = { selector: '.foo', html: '<iframe class="eseason-iframe" src="..."></iframe>' };
assertEqual(identifyExternalWidget(eseasonByClass)?.vendor, 'eSeason', 'eSeason par class prefix');

// ─── Thelis ────────────────────────────────────────────────────────
const thelisByHtml = { selector: 'select', html: '<iframe src="https://thelisresa.webcamp.fr/..."></iframe>' };
assertEqual(identifyExternalWidget(thelisByHtml)?.vendor, 'Thelis', 'Thelis par htmlContains thelisresa.webcamp');

const thelisBySelector = { selector: 'div[ng-model] > .thr-select > select', html: '' };
assertEqual(identifyExternalWidget(thelisBySelector)?.vendor, 'Thelis', 'Thelis par selectorPrefix .thr-');

// ─── Doctolib / Calendly ───────────────────────────────────────────
const doctolib = { selector: 'a.cta-rdv', html: '<a href="https://www.doctolib.fr/avocat/...">' };
assertEqual(identifyExternalWidget(doctolib)?.vendor, 'Doctolib', 'Doctolib par URL');

const calendly = { selector: 'div', html: '<div class="calendly-inline-widget" data-url="..."></div>' };
assertEqual(identifyExternalWidget(calendly)?.vendor, 'Calendly', 'Calendly par htmlContains');

// ─── Google Maps ───────────────────────────────────────────────────
const gmap = { selector: 'iframe.map', html: '<iframe src="https://www.google.com/maps/embed?pb=..."></iframe>' };
assertEqual(identifyExternalWidget(gmap)?.vendor, 'Google Maps', 'Google Maps iframe');

// ─── Aucun match — site custom ──────────────────────────────────────
const customLink = { selector: '.site-header__nav a', html: '<a href="/contact"><i class="fa fa-phone"></i></a>' };
assertEqual(identifyExternalWidget(customLink), null, 'lien custom → null (pas un widget)');

const customLogo = { selector: '.logo a', html: '<a href="/"><img src="logo.png"></a>' };
assertEqual(identifyExternalWidget(customLogo), null, 'logo custom → null');

// ─── Edge cases ────────────────────────────────────────────────────
assertEqual(identifyExternalWidget(null), null, 'null → null');
assertEqual(identifyExternalWidget(undefined), null, 'undefined → null');
assertEqual(identifyExternalWidget('string'), null, 'string (non-object) → null');
assertEqual(identifyExternalWidget({}), null, 'objet vide → null');
assertEqual(identifyExternalWidget({ selector: '', html: '' }), null, 'fields vides → null');

// ─── downgradeSeverity ─────────────────────────────────────────────
assertEqual(downgradeSeverity('BLOQUANT'), 'IMPORTANT', 'BLOQUANT → IMPORTANT');
assertEqual(downgradeSeverity('IMPORTANT'), 'MINEUR', 'IMPORTANT → MINEUR');
assertEqual(downgradeSeverity('MINEUR'), 'MINEUR', 'MINEUR → MINEUR (inchange)');
assertEqual(downgradeSeverity('CHECKLIST_MEP'), 'CHECKLIST_MEP', 'CHECKLIST_MEP → CHECKLIST_MEP (inchange)');

// ─── Structure : tous les widgets ont vendor + name + matchers ────
let invalid = 0;
for (const w of EXTERNAL_WIDGETS) {
  if (!w.vendor || !w.name || !w.matchers) invalid++;
}
assertEqual(invalid, 0, 'tous les widgets ont vendor + name + matchers');

// ─── Casse insensible ──────────────────────────────────────────────
const upperCase = { selector: '#WIDGETQUALITELIS', html: '<div class="QUALITELIS-X">' };
assert(identifyExternalWidget(upperCase) !== null, 'casse uppercase → match');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
