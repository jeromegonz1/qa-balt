#!/usr/bin/env node
/**
 * Tests unitaires — lib/url-guard.mjs
 */
import { validateAuditUrl, validateModelUrl, _internals } from '../lib/url-guard.mjs';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function expectThrow(fn, expectedSubstr, label) {
  try {
    fn();
    failed++;
    console.error(`  FAIL: ${label} — expected throw, got success`);
  } catch (e) {
    if (expectedSubstr && !e.message.includes(expectedSubstr)) {
      failed++;
      console.error(`  FAIL: ${label} — throw "${e.message}", expected substring "${expectedSubstr}"`);
    } else {
      passed++;
    }
  }
}

function expectPass(fn, label) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${label} — unexpected throw "${e.message}"`);
  }
}

console.log('\n🧪 test-url-guard.mjs\n');

// ─── validateAuditUrl : whitelist stricte .azko.fr ───
expectPass(() => validateAuditUrl('https://camping-le-napoleon.site.azko.fr/'), 'preprod *.site.azko.fr OK');
expectPass(() => validateAuditUrl('https://rousselavocat.azko.fr/'), 'legacy *.azko.fr OK');
expectPass(() => validateAuditUrl('http://camping.site.azko.fr/path?q=1'), 'http + path + query OK');
expectPass(() => validateAuditUrl('https://A.B.AZKO.FR/'), 'casse mixte (sera lowercase) OK');

// Domaines REFUSES en audit
expectThrow(() => validateAuditUrl('https://google.com/'), 'non autorise', 'google.com bloque');
expectThrow(() => validateAuditUrl('https://example.com/'), 'non autorise', 'example.com bloque');
expectThrow(() => validateAuditUrl('https://www.septeo-digitalagency.fr/'), 'non autorise', 'septeo-digitalagency bloque en AUDIT (model only)');

// Attaque par suffixe
expectThrow(() => validateAuditUrl('https://evil.azko.fr.attacker.com/'), 'non autorise', 'suffix attack azko.fr.attacker.com bloque');
expectThrow(() => validateAuditUrl('https://fakeazko.fr/'), 'non autorise', 'fakeazko.fr (sans point) bloque');

// Root domain
expectThrow(() => validateAuditUrl('https://azko.fr/'), 'non autorise', 'azko.fr root bloque (pas un preprod)');

// Schemes
expectThrow(() => validateAuditUrl('file:///etc/passwd'), 'Scheme', 'file:// bloque');
expectThrow(() => validateAuditUrl('ftp://camping.site.azko.fr/'), 'Scheme', 'ftp:// bloque');
expectThrow(() => validateAuditUrl('javascript:alert(1)'), 'Scheme', 'javascript: bloque');
expectThrow(() => validateAuditUrl('data:text/html,<script>alert(1)</script>'), 'Scheme', 'data: bloque');

// Validation commune
expectThrow(() => validateAuditUrl(''), 'manquante', 'string vide');
expectThrow(() => validateAuditUrl(null), 'manquante', 'null');
expectThrow(() => validateAuditUrl(undefined), 'manquante', 'undefined');
expectThrow(() => validateAuditUrl(123), 'manquante', 'non-string');
expectThrow(() => validateAuditUrl('not a url'), 'malformee', 'URL malformee');

// Longueur
const longUrl = 'https://test.site.azko.fr/' + 'a'.repeat(_internals.MAX_URL_LENGTH);
expectThrow(() => validateAuditUrl(longUrl), 'trop longue', `URL > ${_internals.MAX_URL_LENGTH} chars`);

// Caracteres de controle (anti log-injection)
expectThrow(() => validateAuditUrl('https://test.site.azko.fr/\nINJECTED'), 'controle', 'newline injection bloquee');
expectThrow(() => validateAuditUrl('https://test.site.azko.fr/\r\nINJECTED'), 'controle', 'CRLF injection bloquee');
expectThrow(() => validateAuditUrl('https://test.site.azko.fr/\x00null'), 'controle', 'NUL byte bloque');
expectThrow(() => validateAuditUrl('https://test.site.azko.fr/\x1b[31mred\x1b[0m'), 'controle', 'ANSI escape bloque');

// ─── validateModelUrl : whitelist plus large ───
expectPass(() => validateModelUrl('https://faena.site.azko.fr/'), 'modele preprod *.azko.fr OK');
expectPass(() => validateModelUrl('https://euclase.septeo-digitalagency.fr/'), 'modele demo *.septeo-digitalagency.fr OK');
expectPass(() => validateModelUrl('https://catalogue-avocats.septeo-digitalagency.fr/catalogue.htm'), 'catalogue septeo OK');

expectThrow(() => validateModelUrl('https://github.com/'), 'non autorise', 'github bloque en MODEL');
expectThrow(() => validateModelUrl('https://evil.septeo-digitalagency.fr.bad.com/'), 'non autorise', 'suffix attack septeo bloque');

// Return value : URL parsee
const parsed = validateAuditUrl('https://camping.site.azko.fr/page?q=1');
assert(parsed instanceof URL, 'validateAuditUrl retourne une URL');
assert(parsed.hostname === 'camping.site.azko.fr', 'URL.hostname accessible');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
