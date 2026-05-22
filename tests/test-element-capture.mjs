#!/usr/bin/env node
/**
 * Tests unitaires — lib/element-capture.mjs
 *
 * Note : on ne teste PAS captureElement() en E2E (necessite un browser).
 * On teste juste les fonctions pures + les helpers (buildIssueScreenshotName).
 */
import { buildIssueScreenshotName, captureElement } from '../lib/element-capture.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

console.log('\n🧪 test-element-capture.mjs\n');

// ─── buildIssueScreenshotName ───
assertEqual(buildIssueScreenshotName('A11Y_BUTTON_NAME'), 'issue-a11y_button_name.png', 'a11y id basique');
assertEqual(buildIssueScreenshotName('SCHEMA_GPS_ZERO'), 'issue-schema_gps_zero.png', 'schema id');
assertEqual(buildIssueScreenshotName('IMG_BROKEN'), 'issue-img_broken.png', 'simple id');
assertEqual(buildIssueScreenshotName('LINK_NO_TEXT', 'home'), 'issue-link_no_text-home.png', 'avec suffixe');

// Caracteres speciaux nettoyes
assertEqual(buildIssueScreenshotName('A11Y/../etc/passwd'), 'issue-a11y----etc-passwd.png', 'path traversal sanitize');
assertEqual(buildIssueScreenshotName('foo bar baz'), 'issue-foo-bar-baz.png', 'spaces sanitize');
assertEqual(buildIssueScreenshotName('id with $%^& special'), 'issue-id-with------special.png', 'special chars');

// Edge cases
assertEqual(buildIssueScreenshotName(''), 'issue-unknown.png', 'string vide → unknown');
assertEqual(buildIssueScreenshotName(null), 'issue-unknown.png', 'null → unknown');
assertEqual(buildIssueScreenshotName(undefined), 'issue-unknown.png', 'undefined → unknown');

// Truncate
const longId = 'X'.repeat(100);
const result = buildIssueScreenshotName(longId);
assertEqual(result.length <= 80, true, 'id ultra-long → truncate raisonnable');

// ─── captureElement : guards seulement (pas de browser ici) ───
const r1 = await captureElement(null, '.x', '/tmp/x.png');
assertEqual(r1, null, 'captureElement : page null → null');

const r2 = await captureElement({ locator: () => ({}) }, null, '/tmp/x.png');
assertEqual(r2, null, 'captureElement : selector null → null');

const r3 = await captureElement({ locator: () => ({}) }, '.x', null);
assertEqual(r3, null, 'captureElement : outputPath null → null');

const r4 = await captureElement({ locator: () => ({}) }, '.x', '/tmp/x.jpg');
assertEqual(r4, null, 'captureElement : outputPath non-png → null');

const r5 = await captureElement({ locator: () => { throw new Error('boom'); } }, '.x', '/tmp/x.png');
assertEqual(r5, null, 'captureElement : locator throw → null (pas de crash)');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
