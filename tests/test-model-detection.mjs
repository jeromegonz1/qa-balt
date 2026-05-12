#!/usr/bin/env node
/**
 * Tests unitaires — lib/model-detection.mjs
 */
import { extractModelFromHtml } from '../lib/model-detection.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — got ${a}, expected ${e}`);
  }
}

console.log('\n🧪 test-model-detection.mjs\n');

// Cas reel ordre-des-avocats-de-laon
const htmlAvocat = `
<div class="btn-catalogue">
    <a href="https://catalogue-avocats.azko.fr/formulaire-maquette.htm?modele=Alguazil" class="choisirCatalogue" target="_blank" title="Choisir">Choisir ce modele</a>
    <a href="https://catalogue-avocats.azko.fr/" class="retourCatalogue">Voir le catalogue</a>
</div>
`;
assertEqual(extractModelFromHtml(htmlAvocat), {
  name: 'Alguazil',
  id: 'alguazil',
  verticalRaw: 'avocats',
  vertical: 'avocat',
}, 'extract Alguazil/avocats');

// Cas reel modele Euclase (hospitality)
const htmlHotel = `<a href="https://catalogue-domaines-residences-hotels.azko.fr/formulaire-maquette.htm?modele=Euclase" class="choisirCatalogue">`;
assertEqual(extractModelFromHtml(htmlHotel), {
  name: 'Euclase',
  id: 'euclase',
  verticalRaw: 'domaines-residences-hotels',
  vertical: 'hospitality',
}, 'extract Euclase/domaines-residences-hotels → hospitality');

// Normalisation verticals
const verticals = [
  ['notaires', 'notaire', 'Muscat'],
  ['cdj', 'cdj', 'Legatus'],
  ['campings', 'camping', 'Bellini'],
];
for (const [raw, normalized, model] of verticals) {
  const html = `<a href="https://catalogue-${raw}.azko.fr/formulaire-maquette.htm?modele=${model}" class="choisirCatalogue">`;
  assertEqual(extractModelFromHtml(html)?.vertical, normalized, `vertical ${raw} → ${normalized}`);
}

// HTML sans widget (cas integrateur qui a supprime)
assertEqual(extractModelFromHtml('<html><body>no widget here</body></html>'), null, 'HTML sans widget → null');

// Edge cases
assertEqual(extractModelFromHtml(''), null, 'string vide → null');
assertEqual(extractModelFromHtml(null), null, 'null → null');
assertEqual(extractModelFromHtml(undefined), null, 'undefined → null');
assertEqual(extractModelFromHtml(123), null, 'non-string → null');

// Pattern dans autre attribut (toujours match — regex sur URL)
const htmlEmbedded = `<script>fetch("https://catalogue-avocats.azko.fr/formulaire-maquette.htm?modele=Bellini")</script>`;
assertEqual(extractModelFromHtml(htmlEmbedded)?.name, 'Bellini', 'pattern dans script tag → match (acceptable)');

// Casse mixte modele
const htmlMixed = `<a href="https://catalogue-avocats.azko.fr/formulaire-maquette.htm?modele=MonModele_2">`;
const r = extractModelFromHtml(htmlMixed);
assertEqual(r?.name, 'MonModele_2', 'preserve casse original dans .name');
assertEqual(r?.id, 'monmodele_2', 'lowercase dans .id');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
