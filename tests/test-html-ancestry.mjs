#!/usr/bin/env node
/**
 * Tests unitaires — lib/html-ancestry.mjs
 */
import { getHtmlAncestryAt, buildHeuristicSelector, buildElementInfo } from '../lib/html-ancestry.mjs';
import { classifyLocation } from '../lib/element-location.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${a}, expected ${e}`); }
}

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

console.log('\n🧪 test-html-ancestry.mjs\n');

// ─── getHtmlAncestryAt ───────────────────────────────────────────────

// Cas simple : <a> dans un <header>
const simpleHtml = '<html><body><header class="site-header"><a href="/">link</a></header></body></html>';
const linkPos = simpleHtml.indexOf('<a ');
const chain1 = getHtmlAncestryAt(simpleHtml, linkPos);
assertEqual(chain1.length, 3, 'ancestry simple : 3 ancetres (header, body, html)');
assertEqual(chain1[0].tag, 'header', 'ancetre 0 = header (le plus proche)');
assertEqual(chain1[0].classes, ['site-header'], 'header.classes contient site-header');
assertEqual(chain1[1].tag, 'body', 'ancetre 1 = body');
assertEqual(chain1[2].tag, 'html', 'ancetre 2 = html (root)');

// Cas avec siblings fermes : <div></div><a> → ancetres ne contient PAS le div ferme
const siblings = '<body><div class="sibling">x</div><a href="/">link</a></body>';
const linkPos2 = siblings.indexOf('<a ');
const chain2 = getHtmlAncestryAt(siblings, linkPos2);
assertEqual(chain2.length, 1, 'siblings fermes ne sont pas dans la chaine');
assertEqual(chain2[0].tag, 'body', 'ancetre = body (sibling div ferme avant)');

// Cas avec void elements : <img> ne s'empile pas
const voidHtml = '<div class="wrapper"><img src="x"><a href="/">link</a></div>';
const linkPos3 = voidHtml.indexOf('<a ');
const chain3 = getHtmlAncestryAt(voidHtml, linkPos3);
assertEqual(chain3.length, 1, 'void <img> ne s\'empile pas');
assertEqual(chain3[0].tag, 'div', 'parent = div wrapper');

// Cas BEM AZKO realiste
const azkoHtml = `
<body>
<header class="site-header bodysiteid_20447">
  <div class="site-header__top">
    <div class="site-header__social-icons">
      <a href="https://facebook.com/x"><i class="fa fa-facebook"></i></a>
    </div>
  </div>
</header>
</body>`;
const fbPos = azkoHtml.indexOf('<a href="https://facebook');
const chain4 = getHtmlAncestryAt(azkoHtml, fbPos);
assert(chain4.length >= 4, 'AZKO BEM : au moins 4 ancetres (icons, top, header, body)');
assertEqual(chain4[0].tag, 'div', 'plus proche = div.site-header__social-icons');
assertEqual(chain4[0].classes[0], 'site-header__social-icons', 'BEM block element preserve');
assert(chain4.some(a => a.tag === 'header'), 'header dans la chaine');

// Cas avec id
const idHtml = '<div id="WidgetQualitelis"><button class="close">×</button></div>';
const btnPos = idHtml.indexOf('<button');
const chain5 = getHtmlAncestryAt(idHtml, btnPos);
assertEqual(chain5[0].id, 'WidgetQualitelis', 'id capture');

// Self-closing avec / : <input /> ne s'empile pas
const selfClosed = '<form><input type="text" /><a href="/">link</a></form>';
const linkPos5 = selfClosed.indexOf('<a ');
const chain6 = getHtmlAncestryAt(selfClosed, linkPos5);
assertEqual(chain6.length, 1, 'self-closing <input/> ne s\'empile pas');
assertEqual(chain6[0].tag, 'form', 'parent = form');

// Cas degenerees
assertEqual(getHtmlAncestryAt('', 0), [], 'HTML vide');
assertEqual(getHtmlAncestryAt(null, 0), [], 'null → []');
assertEqual(getHtmlAncestryAt('x', -1), [], 'position negative → []');
assertEqual(getHtmlAncestryAt('x', 100), [], 'position hors-bornes → []');

// ─── buildHeuristicSelector ─────────────────────────────────────────

assertEqual(buildHeuristicSelector([], 'a'), 'a', 'empty ancestry → just tag');
assertEqual(buildHeuristicSelector(null, 'a'), 'a', 'null ancestry → just tag');
assertEqual(buildHeuristicSelector([], ''), 'body', 'empty + no tag → body');

// Id prioritaire
const ancestryWithId = [{ tag: 'div', classes: ['close'], id: 'WidgetQualitelis' }];
assertEqual(buildHeuristicSelector(ancestryWithId, 'button'), '#WidgetQualitelis button', 'id prioritaire');

// Classe BEM prefere a non-BEM
const ancestryBEM = [{ tag: 'div', classes: ['flex', 'site-header__nav'] }];
assertEqual(buildHeuristicSelector(ancestryBEM, 'a'), '.site-header__nav a', 'classe BEM (avec __) preferee');

// Classe simple si pas de BEM
const ancestrySimple = [{ tag: 'header', classes: ['main-header'] }];
assertEqual(buildHeuristicSelector(ancestrySimple, 'a'), '.main-header a', 'classe simple si pas de BEM');

// Skip ancestor sans classes/id
const ancestryMixed = [
  { tag: 'span', classes: [], id: null },
  { tag: 'div', classes: ['parent'], id: null },
];
assertEqual(buildHeuristicSelector(ancestryMixed, 'i'), '.parent i', 'skip span vide, prend div parent');

// ─── buildElementInfo (integration avec classifyLocation) ───────────

const integrationHtml = '<header class="site-header"><a href="https://facebook.com" class="social"><i class="fa fa-facebook"></i></a></header>';
const aPos = integrationHtml.indexOf('<a ');
const info = buildElementInfo(
  integrationHtml,
  aPos,
  '<a href="https://facebook.com" class="social"><i class="fa fa-facebook"></i></a>',
  'a',
  classifyLocation,
);
assertEqual(info.location, 'header', 'integration : location header detectee');
assert(info.selector.includes('.site-header'), 'integration : selector contient .site-header');
assert(info.html.includes('facebook.com'), 'integration : html snippet preserve');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
