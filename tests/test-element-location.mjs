#!/usr/bin/env node
/**
 * Tests unitaires — lib/element-location.mjs
 *
 * Pure function : pas besoin de Playwright, on simule la chaine d'ancetres
 * que page.evaluate() retourne.
 */
import { classifyLocation } from '../lib/element-location.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got "${actual}", expected "${expected}"`); }
}

console.log('\n🧪 test-element-location.mjs\n');

// === Tag-based detection ===
assertEqual(classifyLocation([{ tag: 'header', classes: [] }]), 'header', 'tag <header> → header');
assertEqual(classifyLocation([{ tag: 'footer', classes: [] }]), 'footer', 'tag <footer> → footer');
assertEqual(classifyLocation([{ tag: 'nav', classes: [] }]), 'nav', 'tag <nav> → nav');
assertEqual(classifyLocation([{ tag: 'main', classes: [] }]), 'main', 'tag <main> → main');
assertEqual(classifyLocation([{ tag: 'aside', classes: [] }]), 'aside', 'tag <aside> → aside');
assertEqual(classifyLocation([{ tag: 'form', classes: [] }]), 'form', 'tag <form> → form');

// === Class-based detection ===
assertEqual(classifyLocation([{ tag: 'div', classes: ['site-header'] }]), 'header', 'class site-header → header');
assertEqual(classifyLocation([{ tag: 'div', classes: ['site-header__nav', 'flex'] }]), 'header', 'class site-header__nav (BEM) → header');
assertEqual(classifyLocation([{ tag: 'div', classes: ['main-header'] }]), 'header', 'class main-header → header');
assertEqual(classifyLocation([{ tag: 'div', classes: ['navbar'] }]), 'header', 'class navbar → header');

assertEqual(classifyLocation([{ tag: 'div', classes: ['site-footer'] }]), 'footer', 'class site-footer → footer');
assertEqual(classifyLocation([{ tag: 'div', classes: ['page-footer'] }]), 'footer', 'class page-footer → footer');

assertEqual(classifyLocation([{ tag: 'div', classes: ['hero'] }]), 'hero', 'class hero → hero');
assertEqual(classifyLocation([{ tag: 'div', classes: ['hero-banner'] }]), 'hero', 'class hero-banner → hero');
assertEqual(classifyLocation([{ tag: 'div', classes: ['diaporama'] }]), 'hero', 'class diaporama (AZKO) → hero');

assertEqual(classifyLocation([{ tag: 'div', classes: ['sidebar'] }]), 'aside', 'class sidebar → aside');
assertEqual(classifyLocation([{ tag: 'div', classes: ['main-content'] }]), 'main', 'class main-content → main');

// === Walk ancestors (closest match wins, but order priority enforced) ===
// Element dans le header, mais avec un div parent neutre → trouve le header en remontant
const chain1 = [
  { tag: 'a', classes: ['social-link'] },
  { tag: 'div', classes: ['wrapper'] },
  { tag: 'header', classes: ['site-header'] },
];
assertEqual(classifyLocation(chain1), 'header', 'walk: a > div > header → header');

// Element profond dans le footer
const chain2 = [
  { tag: 'span', classes: [] },
  { tag: 'a', classes: ['social-link'] },
  { tag: 'div', classes: ['social-icons'] },
  { tag: 'div', classes: ['footer-bottom'] },
  { tag: 'footer', classes: ['site-footer'] },
];
assertEqual(classifyLocation(chain2), 'footer', 'walk: span > a > div > div > footer → footer');

// Header gagne contre nav si plus proche (header detecte en premier dans le walk)
const chain3 = [
  { tag: 'nav', classes: [] },
  { tag: 'header', classes: ['site-header'] },
];
assertEqual(classifyLocation(chain3), 'nav', 'walk: nav-dans-header → nav (le plus proche gagne)');

// Hero gagne contre main si plus proche
const chain4 = [
  { tag: 'h1', classes: [] },
  { tag: 'div', classes: ['hero'] },
  { tag: 'main', classes: [] },
];
assertEqual(classifyLocation(chain4), 'hero', 'walk: h1 > .hero > main → hero (proche prio)');

// Form prioritaire dans un footer (cas formulaire newsletter en footer)
const chain5 = [
  { tag: 'input', classes: [] },
  { tag: 'form', classes: ['newsletter-form'] },
  { tag: 'footer', classes: [] },
];
assertEqual(classifyLocation(chain5), 'form', 'walk: input > form > footer → form (formulaire proche)');

// === Cas degenerees ===
assertEqual(classifyLocation([]), 'body', 'chaine vide → body');
assertEqual(classifyLocation(null), 'body', 'null → body');
assertEqual(classifyLocation(undefined), 'body', 'undefined → body');
assertEqual(classifyLocation('not an array'), 'body', 'non-array → body');
assertEqual(classifyLocation([null, undefined, 'foo']), 'body', 'entries invalides → body');

// === Pas de match dans une page neutre (div générique uniquement) ===
// Note : 'content' matche desormais → main (sprint 3.suite AZKO patterns).
// On utilise des classes vraiment generiques pour ce test.
const chainNoMatch = [
  { tag: 'span', classes: [] },
  { tag: 'div', classes: ['some-class'] },
  { tag: 'div', classes: ['wrapper'] },
];
assertEqual(classifyLocation(chainNoMatch), 'body', 'aucun ancetre matche → body');

// === Casse insensible ===
assertEqual(classifyLocation([{ tag: 'HEADER', classes: [] }]), 'header', 'tag uppercase → match');
assertEqual(classifyLocation([{ tag: 'div', classes: ['Site-Header'] }]), 'header', 'class casse mixte → match');

// === Securite : pas de regex DoS sur input pathologique ===
// Chaine tres longue (mais bornee a 10 par COLLECT_ANCESTOR_CHAIN_FN)
const longChain = Array.from({ length: 100 }, () => ({ tag: 'div', classes: ['x'] }));
assertEqual(classifyLocation(longChain), 'body', 'chaine longue → body (pas de match, pas de freeze)');

// === AZKO patterns (sprint 3.suite) ===
// Avant : images d'annonces tombaient sur 'body' faute de match wrapper
assertEqual(classifyLocation([{tag:'div',classes:['item','annonce_type_hebergement']},{tag:'div',classes:['annonces']}]), 'main', 'annonces (AZKO) → main');
assertEqual(classifyLocation([{tag:'div',classes:['pagestandard']}]), 'main', 'pagestandard (AZKO body class) → main');
assertEqual(classifyLocation([{tag:'div',classes:['mainContents']}]), 'main', 'mainContents (AZKO camelCase) → main');
assertEqual(classifyLocation([{tag:'div',classes:['module','module_actus']}]), 'main', 'module_actus → main');
assertEqual(classifyLocation([{tag:'div',classes:['content_diaporama']}]), 'main', 'content_diaporama → main');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
