#!/usr/bin/env node
/**
 * Tests unitaires — lib/geo-extraction.mjs
 *
 * Couvre les formats Google Maps les plus courants.
 * Note : findRealMapCoords() fait des appels reseau, non teste ici
 * (couvert par les tests E2E sur un vrai site).
 */
import { extractMapsCoords, extractMapsAddress } from '../lib/geo-extraction.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertCoords(actual, lat, lng, label) {
  const ok = actual && Math.abs(actual.lat - lat) < 0.0001 && Math.abs(actual.lng - lng) < 0.0001;
  if (ok) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected lat=${lat}, lng=${lng}`); }
}

console.log('\n🧪 test-geo-extraction.mjs\n');

// === Format ?pb= (embed iframe standard) ===
// Gap, France (camping-le-napoleon real coords)
const pbEmbed = `<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3137.4!2d6.0805694!3d44.5675778!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12c8eb1234567890%3A0xabcdef!2sDomaine+Napol%C3%A9on!5e0!3m2!1sfr!2sfr!4v1234567890!5m2!1sfr!2sfr"></iframe>`;
assertCoords(extractMapsCoords(pbEmbed), 44.5675778, 6.0805694, 'pb embed (Gap)');

// Coords negatives (Western longitude / southern hemisphere)
const pbNegative = `src="https://google.com/maps?pb=!2d-1.5567!3d-23.5505"`;
assertCoords(extractMapsCoords(pbNegative), -23.5505, -1.5567, 'pb negative coords (Sao Paulo-like)');

// === Format ?q= (anchor / iframe legacy) ===
const qAnchor = `<a href="https://maps.google.com/?q=48.8584,2.2945">Tour Eiffel</a>`;
assertCoords(extractMapsCoords(qAnchor), 48.8584, 2.2945, 'q anchor (Eiffel)');

// === Format ?ll= ===
const llIframe = `<iframe src="https://maps.google.com/maps?ll=43.2965,5.3698&z=12"></iframe>`;
assertCoords(extractMapsCoords(llIframe), 43.2965, 5.3698, 'll iframe (Marseille)');

// === Format ?center= ===
const centerEmbed = `<iframe src="https://www.google.com/maps?center=45.7640,4.8357&zoom=14"></iframe>`;
assertCoords(extractMapsCoords(centerEmbed), 45.7640, 4.8357, 'center param (Lyon)');

// === Filtrage 0,0 ===
const zeroPb = `src="https://google.com/maps?pb=!2d0!3d0!4f13"`;
assert(extractMapsCoords(zeroPb) === null, 'pb 0,0 → null (placeholder rejete)');

const zeroQ = `<a href="https://maps.google.com/?q=0,0">map</a>`;
assert(extractMapsCoords(zeroQ) === null, 'q 0,0 → null');

// === Cas degenerees ===
assert(extractMapsCoords(null) === null, 'null input → null');
assert(extractMapsCoords('') === null, 'empty → null');
assert(extractMapsCoords(123) === null, 'non-string → null');
assert(extractMapsCoords('<html>no map</html>') === null, 'no map → null');

// === Edge case : ?q= avec adresse texte (pas de coords) ===
const qText = `<a href="https://maps.google.com/?q=Tour+Eiffel+Paris">Eiffel</a>`;
assert(extractMapsCoords(qText) === null, 'q avec texte → null (regex exige decimal)');

// === Plusieurs iframes : extrait la premiere ===
// Plusieurs iframes : pb prioritaire dans la cascade (meme si pas en premiere position du HTML)
// Note pb : !2d = longitude, !3d = latitude
const multi = `<iframe src="https://maps.google.com/?ll=48.8,2.3"></iframe>
<iframe src="https://maps.google.com/maps?pb=!2d6.08!3d44.56"></iframe>`;
assertCoords(extractMapsCoords(multi), 44.56, 6.08, 'multiples iframes : pb prioritaire (lat=!3d, lng=!2d)');

// === Sanity : real-world camping-le-napoleon snippet ===
// Format exact d'apres ce que je vois sur les preprods AZKO (embed iframe v3)
const realWorldSample = `
<div class="googleMap">
  <iframe loading="lazy" allowfullscreen="" referrerpolicy="no-referrer-when-downgrade"
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2789.4567!2d6.08056944999!3d44.56757779999!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12c8e9e1234567a0%3A0x123abc!2sCamping+Le+Napol%C3%A9on!5e0!3m2!1sfr!2sfr!4v1715520000000!5m2!1sfr!2sfr"
          width="600" height="450" style="border:0;"></iframe>
</div>`;
assertCoords(extractMapsCoords(realWorldSample), 44.56757779999, 6.08056944999, 'real-world iframe AZKO (camping-le-napoleon-like)');

// === Format Embed API v1 (adresse texte, pas de coords) ===
const embedV1 = `<iframe src="https://www.google.com/maps/embed/v1/place?q=76+Rte+de+Grenoble+N85%2C+Domaine+Napol%C3%A9on%2C+05000+Gap&key=AIzaSyXXX"></iframe>`;
assert(extractMapsCoords(embedV1) === null, 'Embed API v1 : pas de coords numeriques');
assert(extractMapsAddress(embedV1) === '76 Rte de Grenoble N85, Domaine Napoléon, 05000 Gap', 'Embed API v1 : adresse decodee');

// Embed v1 avec search variant
const embedSearch = `<iframe src="https://www.google.com/maps/embed/v1/search?q=Camping+Marseille&key=X"></iframe>`;
assert(extractMapsAddress(embedSearch) === 'Camping Marseille', 'Embed API v1 search variant');

// Embed v1 avec coords brutes en q (edge case : on rejette, ce sont des coords pas une adresse)
const embedRawCoords = `<iframe src="https://www.google.com/maps/embed/v1/place?q=44.5675,6.0805&key=X"></iframe>`;
assert(extractMapsAddress(embedRawCoords) === null, 'Embed v1 avec coords brutes en q → null (pas une adresse)');

// extractMapsAddress edge cases
assert(extractMapsAddress(null) === null, 'extractMapsAddress null');
assert(extractMapsAddress('<html>no map</html>') === null, 'extractMapsAddress no embed');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
