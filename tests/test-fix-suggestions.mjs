#!/usr/bin/env node
/**
 * Tests unitaires — lib/fix-suggestions.mjs
 */
import { FIX_SUGGESTIONS, getFixSuggestion } from '../lib/fix-suggestions.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

console.log('\n🧪 test-fix-suggestions.mjs\n');

// === Lookup exact ===
assert(getFixSuggestion('LINK_NO_TEXT')?.text.includes('aria-label'), 'LINK_NO_TEXT exact match');
assert(getFixSuggestion('SCHEMA_GPS_ZERO')?.example?.includes('GeoCoordinates'), 'SCHEMA_GPS_ZERO example');
assert(getFixSuggestion('IMG_BROKEN')?.impact === 'ux + seo', 'IMG_BROKEN impact');
assert(getFixSuggestion('A11Y_BUTTON_NAME')?.reference?.includes('axe/4.11/button-name'), 'A11Y_BUTTON_NAME reference');

// === Lookup wildcard pattern ===
// A11Y_* doit matcher les regles axe-core inconnues
const unknownA11y = getFixSuggestion('A11Y_COLOR_CONTRAST');
assert(unknownA11y !== null, 'A11Y_COLOR_CONTRAST → pattern A11Y_*');
assert(unknownA11y?.impact === 'a11y', 'A11Y_COLOR_CONTRAST → impact via wildcard');

// PHP_* doit matcher les niveaux d'erreur PHP inconnus
const unknownPhp = getFixSuggestion('PHP_E_DEPRECATED');
assert(unknownPhp !== null, 'PHP_E_DEPRECATED → pattern PHP_*');
assert(unknownPhp?.impact === 'qualite code serveur', 'PHP_E_DEPRECATED → impact via wildcard');

// MAIS exact match prioritaire sur wildcard
const exactPhp = getFixSuggestion('PHP_E_FATAL');
assert(exactPhp?.impact === 'critique', 'PHP_E_FATAL → exact match prioritaire (critique, pas qualite code serveur)');

// === Aucun match → null ===
assert(getFixSuggestion('UNKNOWN_ISSUE_XYZ') === null, 'ID inconnu → null');
assert(getFixSuggestion('') === null, 'string vide → null');
assert(getFixSuggestion(null) === null, 'null → null');
assert(getFixSuggestion(undefined) === null, 'undefined → null');
assert(getFixSuggestion(123) === null, 'non-string → null');

// === Structure : chaque entree doit avoir au moins un text ===
let entriesWithoutText = 0;
for (const [id, fix] of Object.entries(FIX_SUGGESTIONS)) {
  if (!fix.text || typeof fix.text !== 'string') entriesWithoutText++;
}
assert(entriesWithoutText === 0, `toutes les entrees ont un text (${entriesWithoutText} sans text)`);

// === Pas d'XSS dans les exemples (controle, ils sont statiques) ===
// On verifie qu'aucun example ne contient <script> qui pourrait s'evader si on oublie esc()
let unsafeExamples = 0;
for (const [id, fix] of Object.entries(FIX_SUGGESTIONS)) {
  if (fix.example && /<script\s/i.test(fix.example)) unsafeExamples++;
}
assert(unsafeExamples === 0, `aucun exemple ne contient <script> (${unsafeExamples} potentiellement risques)`);

// === Coverage : verifie qu'on couvre les ID les plus communs vus en audit ===
const COMMON_IDS = [
  'LINK_NO_TEXT', 'SCHEMA_GPS_ZERO', 'IMG_BROKEN', 'A11Y_BUTTON_NAME',
  'A11Y_IMAGE_ALT', 'PRIVACY_404', 'VIEWPORT_NO_SCALE', 'MAIL_EMPTY',
  'TITLE_TOO_SHORT', 'META_DESC_MISSING', 'PHP_E_WARNING', 'LINK_TEL_INVALID',
];
let missing = COMMON_IDS.filter(id => getFixSuggestion(id) === null);
assert(missing.length === 0, `IDs communs couverts (manquent: ${missing.join(', ') || 'aucun'})`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
