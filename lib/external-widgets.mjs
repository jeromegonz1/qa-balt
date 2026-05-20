/**
 * Catalogue des widgets tiers integres sur les sites AZKO/BALT.
 *
 * Pourquoi : les retours QA (Julien — RETOURS QA) signalent que certains
 * BLOQUANTS a11y (button-name, image-alt, label) viennent de widgets externes
 * (Qualitelis, eSeason, Thelis, etc.) sur lesquels l'integrateur n'a PAS
 * la main — il ne peut rien corriger.
 *
 * Strategie : identifier ces widgets via leurs selectors / ids / classes
 * caracteristiques, et :
 *   1. Tagger l'issue comme `externalWidget: { vendor, name }` dans le rapport
 *   2. Degrader la severite (BLOQUANT → IMPORTANT, IMPORTANT → MINEUR)
 *   3. Adapter le fix-suggestion : « widget tiers, signaler au vendeur »
 *
 * Maintenance : ajouter des entrees au fur et a mesure que de nouveaux
 * widgets apparaissent dans les preprods auditees.
 */

/**
 * Liste des widgets connus. Chaque entree definit :
 *   - vendor : nom du fournisseur (affiche dans le rapport)
 *   - name : nom du widget (affiche)
 *   - matchers : selectors / patterns qui identifient le widget dans un
 *     element. On supporte 3 types :
 *       - selectorPrefix : prefixe d'id (ex: '#WidgetQualitelis')
 *       - classPrefix : prefixe de classe (ex: '.eseason-')
 *       - htmlContains : sous-chaine dans le HTML snippet (ex: 'thelisresa')
 *   - notes : contexte additionnel pour le rapport (optionnel)
 */
export const EXTERNAL_WIDGETS = Object.freeze([
  {
    vendor: 'Qualitelis',
    name: 'Widget avis Qualitelis',
    matchers: {
      selectorPrefix: ['#WidgetQualitelis', '#littleWidgetQualitelis'],
      htmlContains: ['qualitelis.com', 'WidgetQualitelis'],
    },
    notes: 'Widget d\'affichage des avis Qualitelis. Bugs accessibilite hors de portee de l\'integrateur — a remonter au vendeur si recurrents.',
  },
  {
    vendor: 'eSeason',
    name: 'Moteur de reservation eSeason',
    matchers: {
      selectorPrefix: ['#eseason-', '.eseason-'],
      classPrefix: ['eseason'],
      htmlContains: ['eseason.com', 'eseason.fr', 'data-eseason'],
    },
    notes: 'Moteur de reservation eSeason (campings). HTML genere par iframe ou widget externe — non modifiable cote integrateur.',
  },
  {
    vendor: 'Thelis',
    name: 'Moteur de reservation Thelis',
    matchers: {
      htmlContains: ['thelisresa.com', 'thelisresa.webcamp', 'thelis'],
      selectorPrefix: ['.thr-', '#thelis-'],
    },
    notes: 'Moteur de reservation Thelis Resa. Widget iframe externe.',
  },
  {
    vendor: 'Ctoutvert',
    name: 'Moteur de reservation Ctoutvert',
    matchers: {
      htmlContains: ['ctoutvert.com', 'ctoutvert'],
    },
    notes: 'Moteur de reservation Ctoutvert.',
  },
  {
    vendor: 'Amenitiz',
    name: 'Moteur de reservation Amenitiz',
    matchers: {
      htmlContains: ['amenitiz.io', 'amenitiz.com'],
    },
    notes: 'Moteur de reservation hotellerie Amenitiz.',
  },
  {
    vendor: 'MisterBooking',
    name: 'Moteur de reservation MisterBooking',
    matchers: {
      htmlContains: ['misterbooking.net', 'misterbooking'],
    },
    notes: 'Moteur de reservation MisterBooking.',
  },
  {
    vendor: 'Axeptio',
    name: 'Bandeau cookies Axeptio',
    matchers: {
      selectorPrefix: ['#axeptio_', '.axeptio_'],
      classPrefix: ['axeptio'],
      htmlContains: ['axeptio.eu'],
    },
    notes: 'Bandeau de consentement cookies Axeptio. Issues a11y du widget ne sont pas modifiables cote site.',
  },
  {
    vendor: 'Doctolib',
    name: 'Bouton RDV Doctolib',
    matchers: {
      htmlContains: ['doctolib.fr', 'doctolib.com'],
    },
    notes: 'Bouton de prise de RDV Doctolib (medecins, avocats).',
  },
  {
    vendor: 'Calendly',
    name: 'Bouton RDV Calendly',
    matchers: {
      htmlContains: ['calendly.com', 'calendly-inline'],
    },
    notes: 'Bouton de prise de RDV Calendly.',
  },
  {
    vendor: 'Google Maps',
    name: 'Iframe Google Maps',
    matchers: {
      htmlContains: ['google.com/maps/embed', 'maps.google'],
    },
    notes: 'Iframe Google Maps. Issues a11y/perf hors de portee.',
  },
]);

/**
 * Identifie si un element (via son selector + HTML snippet) appartient
 * a un widget externe connu.
 *
 * @param {Object} element — { selector?: string, html?: string }
 * @returns {{vendor: string, name: string, notes: string} | null}
 */
export function identifyExternalWidget(element) {
  if (!element || typeof element !== 'object') return null;
  const selector = (element.selector || '').toLowerCase();
  const html = (element.html || '').toLowerCase();

  for (const widget of EXTERNAL_WIDGETS) {
    const m = widget.matchers || {};

    // selectorPrefix : le selector contient ce prefixe (avec # ou .)
    if (Array.isArray(m.selectorPrefix)) {
      for (const p of m.selectorPrefix) {
        if (selector.includes(p.toLowerCase())) return pick(widget);
      }
    }

    // classPrefix : une classe quelconque dans le HTML commence par ce prefixe
    if (Array.isArray(m.classPrefix)) {
      for (const p of m.classPrefix) {
        // Cherche " classx" ou "classx" en debut, suivi de char non alphanum
        const re = new RegExp('\\bclass="[^"]*\\b' + p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&') + '[-_\\w]*', 'i');
        if (re.test(html)) return pick(widget);
      }
    }

    // htmlContains : la chaine apparait n'importe ou dans le HTML
    if (Array.isArray(m.htmlContains)) {
      for (const sub of m.htmlContains) {
        if (html.includes(sub.toLowerCase()) || selector.includes(sub.toLowerCase())) {
          return pick(widget);
        }
      }
    }
  }
  return null;
}

function pick(widget) {
  return { vendor: widget.vendor, name: widget.name, notes: widget.notes };
}

/**
 * Mapping severity → severity degradee pour issues issues de widgets externes.
 * BLOQUANT → IMPORTANT (toujours a signaler mais pas bloquant pour la MEP).
 * IMPORTANT → MINEUR.
 * MINEUR / CHECKLIST_MEP → inchanges (deja bas).
 */
export function downgradeSeverity(severity) {
  if (severity === 'BLOQUANT') return 'IMPORTANT';
  if (severity === 'IMPORTANT') return 'MINEUR';
  return severity;
}
