/**
 * Classification de la localisation d'un element dans la page.
 *
 * Walk ancestors → identifie la "zone" semantique :
 *   header / footer / hero / nav / form / aside / main / body
 *
 * Pure : prend une chaine d'ancetres (tag + classes), pas de DOM.
 * Testable sans Playwright.
 *
 * Pourquoi : aider l'integrateur a localiser visuellement et a deviner
 * le fichier .tpl ou retoucher. Ex : "header" → header.tpl.
 *
 * Strategie de detection : ordre des regles = prioritaire d'abord
 * (header > footer > hero > nav > form > aside > main > body).
 * On verifie chaque ancetre du plus proche au plus eloigne, en
 * remontant vers <body>.
 */

// Regles ordonnees par specificite : la 1re qui matche gagne.
// Chaque regle : { tag?: string, blocks?: string[], location: string }
// `blocks` = BEM block names a matcher (exact, __element, --modifier).
const LOCATION_RULES = [
  // Header — premier check car critique pour debug logo / nav top
  { tag: 'header', location: 'header' },
  { blocks: ['site-header', 'main-header', 'page-header', 'topbar', 'navbar'], location: 'header' },

  // Footer
  { tag: 'footer', location: 'footer' },
  { blocks: ['site-footer', 'main-footer', 'page-footer'], location: 'footer' },

  // Hero / banner — souvent juste en dessous du header
  { blocks: ['hero', 'banner', 'slider', 'carousel', 'diaporama'], location: 'hero' },

  // Nav (en dehors du header)
  { tag: 'nav', location: 'nav' },
  { blocks: ['main-nav', 'primary-nav', 'menu-principal'], location: 'nav' },

  // Form — utile pour les checks a11y formulaires
  { tag: 'form', location: 'form' },

  // Aside (sidebar)
  { tag: 'aside', location: 'aside' },
  { blocks: ['sidebar', 'aside'], location: 'aside' },

  // Main / contenu principal (en dernier car le plus large)
  { tag: 'main', location: 'main' },
  { blocks: ['main-content', 'page-content', 'site-content'], location: 'main' },

  // AZKO-specific (sprint 3.suite) : reconnait les containers AZKO classiques
  // pour ne plus tomber sur 'body' pour les annonces, modules de page, etc.
  { blocks: ['pagestandard', 'pagedefaut', 'pageFull', 'mainContents'], location: 'main' },
  { blocks: ['annonces', 'annonce', 'liste-annonces'], location: 'main' },
  { blocks: ['module', 'content'], location: 'main' }, // generique mais mieux que body
];

/**
 * Verifie si une liste de classes contient au moins un block matchant.
 * Match : exact, ou `block` suivi de `_`, `-` (BEM `__`, `--`, ou
 * hyphenation simple comme `hero-banner`).
 *
 * Ex : `hero` matche `hero`, `hero__title`, `hero--big`, `hero-banner`.
 *      Ne matche PAS `heros` (plural), `superhero` (suffix).
 *
 * @param {string[]} classes — liste de noms de classe d'un element
 * @param {string[]} blocks — blocks cherches (lowercase)
 * @returns {boolean}
 */
function classesMatchAnyBlock(classes, blocks) {
  for (const rawCls of classes) {
    const cls = rawCls.toLowerCase();
    for (const rawBlock of blocks) {
      const block = rawBlock.toLowerCase();
      if (cls === block) return true;
      if (cls.length > block.length && cls.startsWith(block)) {
        const next = cls.charAt(block.length);
        if (next === '_' || next === '-') return true;
      }
    }
  }
  return false;
}

/**
 * Classifie la localisation d'un element d'apres sa chaine d'ancetres.
 *
 * @param {Array<{tag?: string, classes?: string[]}>} ancestorChain
 *        Chaine du plus proche (l'element lui-meme) au plus eloigne.
 *        Chaque ancetre : { tag: 'div', classes: ['site-header__nav'] }
 * @returns {string} 'header' | 'footer' | 'hero' | 'nav' | 'form' | 'aside' | 'main' | 'body'
 */
export function classifyLocation(ancestorChain) {
  if (!Array.isArray(ancestorChain) || ancestorChain.length === 0) return 'body';

  for (const ancestor of ancestorChain) {
    if (!ancestor || typeof ancestor !== 'object') continue;
    const tag = (ancestor.tag || '').toLowerCase();
    const classes = Array.isArray(ancestor.classes) ? ancestor.classes : [];

    for (const rule of LOCATION_RULES) {
      if (rule.tag && tag === rule.tag) return rule.location;
      if (rule.blocks && classesMatchAnyBlock(classes, rule.blocks)) return rule.location;
    }
  }

  return 'body';
}

/**
 * Script Playwright a injecter via page.evaluate() pour collecter
 * la chaine d'ancetres au format attendu par classifyLocation().
 *
 * Securite : on caste les valeurs en string, on ne passe pas le selector
 * via concatenation de string (Playwright le passe en parametre serialise).
 * Limite : 10 ancetres max (evite chaines pathologiques sur DOM profond).
 */
export const COLLECT_ANCESTOR_CHAIN_FN = function collectAncestorChain(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const chain = [];
  let cur = el;
  let depth = 0;
  while (cur && cur !== document.body && cur !== document.documentElement && depth < 10) {
    chain.push({
      tag: cur.tagName ? cur.tagName.toLowerCase() : '',
      classes: (cur.getAttribute('class') || '').split(/\s+/).filter(Boolean),
    });
    cur = cur.parentElement;
    depth++;
  }
  return chain;
};
