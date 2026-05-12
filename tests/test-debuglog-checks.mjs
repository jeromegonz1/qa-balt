#!/usr/bin/env node
/**
 * Tests unitaires — lib/debuglog-checks.mjs
 */
import { extractFeedback, extractMetadata, extractPhpIssues } from '../lib/debuglog-checks.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${a}, expected ${e}`); }
}

console.log('\n🧪 test-debuglog-checks.mjs\n');

// Sample HTML embedding oJsonFeedback (real-ish data)
const sampleHtml = `
<script>
var oJsonFeedback = [
  {"type":"mode","content":"INDEX"},
  {"type":"warn","content":"WS : azko-cms-86d974d8b-c8mkt | NS : septeods-azkocms-prod-front11 | ORGA : 10539 (ORDRE DES AVOCATS DE LIMOGES) | SITE : 20136 | SKIN : 13939 (ordre-avocats-limoges) | LG : fr"},
  {"type":"log","content":"Version du code .............. : fa2db280543be776 (commit du 11/05/2026 à 17:44:40 +02:00)"},
  {"type":"log","content":"Version du tpl de skin ....... : 09/12/2025 à 14:50:02 +01:00"},
  {"type":"error","content":"\\r\\nERREUR PHP : E_WARNING (2) \\r\\nMSG  : Undefined variable $bSlickModeGalerie \\r\\nFILE : /var/www/html/azkocms/front/lib/Modules/ModPageContent/PageContent.php \\r\\nLINE : 1942 "},
  {"type":"error","content":"\\r\\nERREUR PHP : E_WARNING (2) \\r\\nMSG  : Undefined variable $bSlickModeGalerie \\r\\nFILE : /var/www/html/azkocms/front/lib/Modules/ModPageContent/PageContent.php \\r\\nLINE : 1942 "},
  {"type":"error","content":"\\r\\nERREUR PHP : E_WARNING (2) \\r\\nMSG  : file_get_contents(/var/run/secrets/kubernetes.io/serviceaccount/namespace): Failed to open stream"},
  {"type":"error","content":"Skin en ligne introuvable... (ordre-avocats-limoges-fr.tpl)"},
  {"type":"error","content":"\\r\\nERREUR PHP : E_FATAL (1) \\r\\nMSG  : Call to undefined function nonexistent() \\r\\nFILE : /var/www/html/foo.php \\r\\nLINE : 42 "}
];
console.log(oJsonFeedback);
</script>
`;

// === extractFeedback ===
assertEqual(extractFeedback(null), null, 'extractFeedback null');
assertEqual(extractFeedback(''), null, 'extractFeedback empty');
assertEqual(extractFeedback('<html>no script</html>'), null, 'extractFeedback no marker');
assertEqual(extractFeedback(123), null, 'extractFeedback non-string');

const fb = extractFeedback(sampleHtml);
assertEqual(Array.isArray(fb), true, 'extractFeedback returns array');
assertEqual(fb?.length, 9, 'extractFeedback parsed 9 items');

// Malformed JSON
const bad = '<script>var oJsonFeedback = [not valid json];</script>';
assertEqual(extractFeedback(bad), null, 'extractFeedback malformed JSON');

// === extractMetadata ===
const meta = extractMetadata(fb);
assertEqual(meta.orgaId, '10539', 'orgaId');
assertEqual(meta.orgaName, 'ORDRE DES AVOCATS DE LIMOGES', 'orgaName');
assertEqual(meta.siteId, '20136', 'siteId');
assertEqual(meta.skinId, '13939', 'skinId');
assertEqual(meta.skinName, 'ordre-avocats-limoges', 'skinName');
assertEqual(meta.codeCommit, 'fa2db28', 'codeCommit (7 chars)');
assertEqual(meta.codeCommitDate, '11/05/2026 à 17:44:40 +02:00', 'codeCommitDate');
assertEqual(meta.skinTplDate, '09/12/2025 à 14:50:02 +01:00', 'skinTplDate');

assertEqual(extractMetadata(null), {}, 'extractMetadata null');
assertEqual(extractMetadata([]), {}, 'extractMetadata empty');

// === extractPhpIssues ===
const issues = extractPhpIssues(fb);
// Devrait retenir : Undefined variable (dedup → 1 fois) + Call to undefined function = 2 issues
// Filtre : kubernetes.io (noise), Skin en ligne introuvable (noise)
assertEqual(issues.length, 2, '2 issues retenues apres dedup + filter noise');

const undef = issues.find(i => i.msg.includes('Undefined variable'));
assertEqual(undef?.level, 'E_WARNING', 'undef variable level');
assertEqual(undef?.file, '/var/www/html/azkocms/front/lib/Modules/ModPageContent/PageContent.php', 'undef variable file');
assertEqual(undef?.line, 1942, 'undef variable line');

const fatal = issues.find(i => i.level === 'E_FATAL');
assertEqual(fatal?.msg, 'Call to undefined function nonexistent()', 'fatal msg');
assertEqual(fatal?.line, 42, 'fatal line');

assertEqual(extractPhpIssues(null), [], 'extractPhpIssues null');
assertEqual(extractPhpIssues([]), [], 'extractPhpIssues empty');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
