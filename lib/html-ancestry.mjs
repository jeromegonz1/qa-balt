/**
 * Extraction d'ancestralite HTML par parsing string (sans DOM).
 *
 * Cas d'usage : les modules curl-based (page-checks, link-checks, tech-checks)
 * detectent des issues via regex sur le HTML brut. Pour enrichir ces issues
 * avec un `element: { selector, location }` comparable aux issues a11y (qui
 * ont nativement axe-core), on a besoin d'une ancestralite approximative.
 *
 * Approche : walk simplifie des tags depuis le debut jusqu'a la position du
 * match. On maintient une pile de tags ouverts. Quand on rencontre un tag
 * fermant, on depile jusqu'au matching tag. Ce qui reste dans la pile a la
 * position cible = la chaine d'ancetres.
 *
 * Limites connues :
 *   - Pas de gestion des CDATA / commentaires HTML (rare en AZKO)
 *   - Pas robuste sur HTML malforme (mais AZKO genere du HTML propre)
 *   - Tags `<` dans des attributs ou strings JS peuvent leurrer (rare)
 *   - Performance : O(n) par appel, acceptable pour une page de < 200KB
 *
 * Pour les cas pathologiques, on retourne au pire une ancestralite vide
 * (degrade vers location 'body' + selector generique).
 */

// Elements void HTML5 (self-closing par convention)
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Limite de tags scannes pour eviter freeze sur HTML gigantesque
const MAX_TAGS_SCANNED = 5000;

/**
 * Retourne la chaine d'ancetres ouverts au moment d'une position dans le HTML.
 *
 * @param {string} html — HTML complet du document
 * @param {number} position — index dans le string (typiquement match.index)
 * @returns {Array<{tag: string, classes: string[]}>} ancetres dans l'ordre
 *          proche-d'abord (du plus interne au plus externe — compatible avec
 *          classifyLocation de element-location.mjs)
 */
export function getHtmlAncestryAt(html, position) {
  if (typeof html !== 'string' || typeof position !== 'number') return [];
  if (position < 0 || position > html.length) return [];

  const before = html.substring(0, position);
  const stack = [];

  // Match toutes les balises (ouvrantes ou fermantes) avant la position.
  // Regex tolerant : nom de tag alphanum (+ ':' pour xmlns), attributs libres jusqu'a >.
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>/g;
  let m;
  let scanned = 0;

  while ((m = tagRe.exec(before)) !== null && scanned < MAX_TAGS_SCANNED) {
    scanned++;
    const isClose = m[1] === '/';
    const tagName = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClosing = m[4] === '/';

    if (isClose) {
      // Tag fermant : depile jusqu'au matching tag (s'il existe)
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tagName) {
          stack.splice(i);
          break;
        }
      }
    } else if (!VOID_ELEMENTS.has(tagName) && !selfClosing) {
      // Tag ouvrant non-void : empile
      const classMatch = attrs.match(/\bclass\s*=\s*"([^"]*)"/i);
      const idMatch = attrs.match(/\bid\s*=\s*"([^"]+)"/i);
      stack.push({
        tag: tagName,
        classes: classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [],
        id: idMatch ? idMatch[1] : null,
      });
    }
  }

  // Stack = ouvertes au moment de la position. On retourne dans l'ordre
  // proche-d'abord (innermost) pour matcher la signature classifyLocation.
  return stack.reverse();
}

/**
 * Construit un selector CSS heuristique a partir d'une chaine d'ancetres.
 * Strategie :
 *   1. Si l'ancetre direct (le plus proche) a un id : `#monid > elementTag`
 *   2. Sinon : prend la classe la plus specifique (BEM block du plus proche
 *      ancetre avec classes) : `.block elementTag` ou `.block`
 *   3. Si rien : retourne juste elementTag ou 'body'
 *
 * Ce n'est PAS un selector unique (peut matcher plusieurs elements) mais il
 * donne a l'integrateur une cle de recherche concrete dans son code.
 *
 * @param {Array<{tag, classes, id}>} ancestry — depuis getHtmlAncestryAt
 * @param {string} elementTag — le tag de l'element en cause (a, img, button...)
 * @returns {string} selector CSS heuristique
 */
export function buildHeuristicSelector(ancestry, elementTag) {
  const tag = (elementTag || '').toLowerCase();

  if (!Array.isArray(ancestry) || ancestry.length === 0) {
    return tag || 'body';
  }

  // 1. Cherche un id parmi les 3 plus proches ancetres
  for (let i = 0; i < Math.min(3, ancestry.length); i++) {
    if (ancestry[i].id) {
      return `#${ancestry[i].id}${tag ? ` ${tag}` : ''}`;
    }
  }

  // 2. Cherche la classe la plus specifique (1re des ancetres ayant des classes)
  for (const ancestor of ancestry) {
    if (ancestor.classes && ancestor.classes.length > 0) {
      // Prefere une classe BEM (avec __ ou --) si presente, sinon la 1re
      const bemCls = ancestor.classes.find(c => /__|--/.test(c));
      const cls = bemCls || ancestor.classes[0];
      return `.${cls}${tag ? ` ${tag}` : ''}`;
    }
  }

  // 3. Fallback : juste le tag
  return tag || 'body';
}

/**
 * Helper combine : construit un objet `element` complet pour une issue
 * curl-based, compatible avec le rendering enrichi du rapport.
 *
 * @param {string} html — HTML complet du document
 * @param {number} matchPosition — position du match dans le HTML
 * @param {string} matchedHtml — le snippet HTML de l'element en cause
 * @param {string} elementTag — tag de l'element (a, img, button...)
 * @param {Function} classifyLocationFn — fonction de element-location.mjs
 * @returns {{selector: string, html: string, location: string}}
 */
export function buildElementInfo(html, matchPosition, matchedHtml, elementTag, classifyLocationFn) {
  const ancestry = getHtmlAncestryAt(html, matchPosition);
  return {
    selector: buildHeuristicSelector(ancestry, elementTag),
    html: (matchedHtml || '').substring(0, 200),
    location: classifyLocationFn ? classifyLocationFn(ancestry) : 'body',
  };
}
