/**
 * Bibliotheque de suggestions de fix par ID d'issue.
 *
 * Chaque entree contient :
 *   - text       : explication concise du fix
 *   - example?   : snippet HTML/code copy-pastable
 *   - fileHint?  : ou trouver dans le code (tpl / scss / cms / data)
 *   - reference? : URL WCAG / MDN / docs externe
 *   - impact?    : a11y / seo / ux / rgpd / cms / perf — pour le tagging visuel
 *
 * Lookup : exact match d'abord, puis pattern match (wildcards `*`).
 * Si rien trouve : retourne null (le rapport ne montre pas la section "fix").
 *
 * Securite : les exemples sont statiques, controles par nous, pas d'injection.
 * Les chaines passent par l'helper esc() du rapport HTML avant rendering.
 *
 * Maintenance : ajouter de nouvelles entrees au fur et a mesure des audits.
 * Tester les ajouts via tests/test-fix-suggestions.mjs.
 */

export const FIX_SUGGESTIONS = {
  // ─── Accessibilite (axe-core + checks AZKO) ───────────────────────
  LINK_NO_TEXT: {
    text: 'Ajouter un texte accessible : alt="..." sur l\'image enfant, aria-label="..." sur le <a>, ou title="..." (moins recommande).',
    example: '<a href="https://facebook.com/..." aria-label="Page Facebook">\n  <i class="fa fa-facebook"></i>\n</a>',
    fileHint: 'header.tpl ou footer.tpl (liens template, social, logo)',
    reference: 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context',
    impact: 'a11y + seo',
  },
  A11Y_BUTTON_NAME: {
    text: 'Le <button> doit avoir un texte visible OU aria-label / aria-labelledby. Pour les boutons icones (×, ⓘ) : utiliser aria-label.',
    example: '<button class="close" aria-label="Fermer">\n  <span aria-hidden="true">×</span>\n</button>',
    fileHint: 'modules CMS (widget Qualitelis, popups Thelis)',
    reference: 'https://dequeuniversity.com/rules/axe/4.11/button-name',
    impact: 'a11y',
  },
  A11Y_SELECT_NAME: {
    text: 'Le <select> doit avoir un nom accessible : <label for> + id, ou aria-label, ou title.',
    example: '<label for="type-hebergement" class="visually-hidden">Type d\'hebergement</label>\n<select id="type-hebergement" name="type">...</select>',
    fileHint: 'formulaires CMS (reservation Thelis, contact)',
    reference: 'https://dequeuniversity.com/rules/axe/4.11/select-name',
    impact: 'a11y',
  },
  A11Y_IMAGE_ALT: {
    text: 'Chaque <img> non decoratif doit avoir un attribut alt descriptif. Si purement decoratif, utiliser alt="" (vide explicite) ou role="presentation".',
    example: '<img src="chalet.webp" alt="Chalet 4 personnes vue lac">\n<!-- decoratif : --> <img src="separator.svg" alt="">',
    fileHint: 'contenus CMS (annonces, gallerie), .tpl pour images statiques',
    reference: 'https://dequeuniversity.com/rules/axe/4.11/image-alt',
    impact: 'a11y + seo',
  },
  A11Y_LABEL: {
    text: 'Chaque champ formulaire (input, textarea, select) doit avoir un <label for="..."> associe.',
    example: '<label for="email">Adresse email</label>\n<input type="email" id="email" name="email">',
    fileHint: 'formulaires CMS, formulaire contact',
    reference: 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions',
    impact: 'a11y',
  },
  'A11Y_*': {
    text: 'Voir la regle axe-core (lien dans le detail) pour le fix specifique. La documentation Deque donne des exemples concrets pour chaque regle.',
    fileHint: 'depend de la regle (tpl / module CMS / contenu)',
    reference: 'https://www.deque.com/axe/core-documentation/api-documentation/',
    impact: 'a11y',
  },

  // ─── Images ───────────────────────────────────────────────────────
  IMG_BROKEN: {
    text: 'Image avec src="" (lazy load rate par GSAP/JS) ou URL 404. Verifier l\'init du lazy-loader, le data-src, et l\'existence du fichier image.',
    example: '<!-- AVANT (lazy GSAP foire) -->\n<img src="" data-src="medias/chalet.webp" alt="Chalet">\n<!-- APRES (fallback natif) -->\n<img src="medias/chalet.webp" loading="lazy" alt="Chalet">',
    fileHint: 'init.js / GSAP lazy loader, ou medias manquants dans CMS',
    impact: 'ux + seo',
  },
  IMG_NO_ALT: {
    text: 'Attribut alt obligatoire sur <img>. Vide accepte pour decoratif (alt="").',
    example: '<img src="..." alt="Description de l\'image">',
    fileHint: 'medias CMS sans alt saisi (admin AZKO)',
    impact: 'a11y + seo',
  },
  ALT_GENERIC: {
    text: 'L\'alt doit decrire le contenu specifique de l\'image, pas un libelle generique (Diaporama, Image, Photo).',
    example: '<!-- AVANT --> alt="Diaporama"\n<!-- APRES --> alt="Vue panoramique du camping en bord de mer"',
    fileHint: 'champs alt dans le CMS AZKO (diaporama)',
    impact: 'a11y + seo',
  },
  IMG_MISSING_DIMENSIONS: {
    text: 'Definir width et height en HTML evite les Layout Shifts (CLS) au chargement.',
    example: '<img src="hero.webp" width="1200" height="600" alt="...">',
    fileHint: 'template (.tpl) ou config CMS si genere',
    reference: 'https://web.dev/articles/optimize-cls',
    impact: 'perf (CWV)',
  },

  // ─── Schema.org / SEO local ───────────────────────────────────────
  SCHEMA_GPS_ZERO: {
    text: 'Saisir les vraies coordonnees GPS dans Schema.org JSON-LD via l\'admin AZKO (champs latitude / longitude de l\'organisation).',
    example: '"geo": {\n  "@type": "GeoCoordinates",\n  "latitude": 44.5676,\n  "longitude": 6.0806\n}',
    fileHint: 'CMS AZKO (BDD organisation, pas un fichier .tpl)',
    reference: 'https://schema.org/GeoCoordinates',
    impact: 'seo local',
  },
  SCHEMA_NAME_INTERNAL: {
    text: 'Le name Schema.org contient un code interne (ex: "Cabinet Dupont - A1234"). Retirer la partie code pour avoir un nom propre.',
    example: '"name": "Cabinet Dupont"  // sans le suffixe "- A1234"',
    fileHint: 'CMS AZKO (nom organisation)',
    impact: 'seo local',
  },

  // ─── Page meta / SEO on-page ──────────────────────────────────────
  TITLE_MISSING: {
    text: '<title> obligatoire dans chaque page. Recommande : 30-60 caracteres, contient le mot-cle principal + marque.',
    example: '<title>Camping U Pirellu - Camping 4 etoiles en Corse du Sud</title>',
    fileHint: 'CMS AZKO (champ Titre SEO par page)',
    reference: 'https://developers.google.com/search/docs/appearance/title-link',
    impact: 'seo',
  },
  TITLE_TOO_SHORT: {
    text: 'Title trop court (< 30 chars). Ajouter contexte : type d\'etablissement, localisation, mot-cle principal.',
    example: '<!-- AVANT --> <title>U PIRELLU</title>\n<!-- APRES --> <title>Camping U Pirellu - 4 etoiles Porto-Vecchio Corse</title>',
    fileHint: 'CMS AZKO (Titre SEO par page)',
    impact: 'seo',
  },
  TITLE_DUPLICATE: {
    text: 'Plusieurs pages partagent le meme title. Chaque page doit avoir un title unique reflétant son contenu.',
    fileHint: 'CMS AZKO (Titre SEO par page — completer les pages qui heritent du defaut)',
    impact: 'seo',
  },
  META_DESC_MISSING: {
    text: 'Meta description recommandee : 120-160 caracteres, resume engageant pour le snippet Google.',
    example: '<meta name="description" content="Reservez votre sejour au camping U Pirellu 4 etoiles a Porto-Vecchio. Mobil-homes, chalets et emplacements en bord de mer.">',
    fileHint: 'CMS AZKO (Description SEO par page)',
    impact: 'seo',
  },
  H1_MULTIPLE: {
    text: 'Une seule <h1> par page (W3C + bonne pratique SEO). Les autres titres : <h2>, <h3>...',
    fileHint: '.tpl si structure, sinon contenus CMS',
    impact: 'seo + a11y',
  },

  // ─── Liens ────────────────────────────────────────────────────────
  LINK_TEL_INVALID: {
    text: 'Format tel: doit etre international sans espaces ni parentheses : tel:+33XXXXXXXXX',
    example: '<!-- AVANT --> <a href="tel:+33 (0)4 95 70 23 44">\n<!-- APRES --> <a href="tel:+33495702344">',
    fileHint: 'CMS AZKO (champ telephone) ou .tpl si statique',
    reference: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a',
    impact: 'ux mobile',
  },
  LINK_MAILTO_INVALID: {
    text: 'Lien mailto: vide ou mal forme. Format correct : mailto:contact@domain.fr',
    example: '<a href="mailto:contact@domaine.fr">Nous ecrire</a>',
    fileHint: 'CMS AZKO (champ email contact)',
    impact: 'ux',
  },
  LINK_BROKEN: {
    text: 'Lien interne vers une page 404. Corriger la cible ou retirer le lien.',
    fileHint: 'contenu CMS (liens dans textes), ou .tpl si structurel',
    impact: 'seo + ux',
  },
  ANCHOR_EMPTY: {
    text: 'Lien avec href="" ou href="#" sans cible. Ajouter une vraie URL ou retirer si purement decoratif (utiliser <button>).',
    fileHint: 'menus langues, dropdowns CMS',
    impact: 'a11y + seo',
  },
  TARGET_BLANK_NO_NOOPENER: {
    text: 'target="_blank" sans rel="noopener" : risque securite (window.opener) sur anciens navigateurs. Ajouter rel="noopener noreferrer".',
    example: '<a href="https://..." target="_blank" rel="noopener noreferrer">Lien externe</a>',
    fileHint: '.tpl ou contenus CMS avec liens externes',
    reference: 'https://web.dev/articles/external-anchors-use-rel-noopener',
    impact: 'securite',
  },
  LINKS_PROTOCOL_RELATIVE: {
    text: 'URLs en //example.com sont anti-pattern. Utiliser https:// explicite.',
    example: '<!-- AVANT --> //example.com/foo\n<!-- APRES --> https://example.com/foo',
    fileHint: '.tpl ou contenus CMS',
    impact: 'securite + seo',
  },

  // ─── Erreurs PHP serveur (debuglog) ───────────────────────────────
  PHP_E_WARNING: {
    text: 'Erreur PHP runtime detectee. Le serveur AZKO loggue mais ne plante pas. A faire remonter a l\'equipe dev AZKO si recurrent.',
    fileHint: 'code AZKO (pas accessible cote integrateur). Joindre l\'URL + erreur a un ticket dev.',
    impact: 'qualite code serveur',
  },
  PHP_E_NOTICE: {
    text: 'Notice PHP runtime, generalement inoffensive mais signale du code a nettoyer. A remonter si recurrente.',
    fileHint: 'code AZKO',
    impact: 'qualite code serveur',
  },
  PHP_E_FATAL: {
    text: 'Erreur fatale PHP — la page ne se rend pas correctement. URGENT : remonter immediatement a l\'equipe dev AZKO.',
    fileHint: 'code AZKO',
    impact: 'critique',
  },
  'PHP_*': {
    text: 'Erreur PHP detectee dans le serveur AZKO. A remonter a l\'equipe dev avec l\'URL et le detail.',
    fileHint: 'code AZKO (cote serveur)',
    impact: 'qualite code serveur',
  },

  // ─── Visuels (Playwright) ─────────────────────────────────────────
  OVERFLOW_HORIZONTAL: {
    text: 'Element qui depasse la largeur du viewport mobile (overflow-x). Verifier les images sans max-width, tableaux fixes, embeds avec width="600", etc.',
    example: '/* SCSS */\nimg, iframe, table { max-width: 100%; }\nbody { overflow-x: hidden; } /* fix temporaire */',
    fileHint: '.scss du site, ou contenus CMS avec embeds fixes',
    reference: 'https://css-tricks.com/responsive-images-css/',
    impact: 'ux mobile',
  },
  FONT_TOO_SMALL: {
    text: 'Texte < 14px sur mobile : illisible. WCAG 1.4.12 recommande 16px minimum, jamais sous 12px.',
    example: '/* SCSS */ p { font-size: 1rem; } /* = 16px */',
    fileHint: '.scss du site',
    reference: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text',
    impact: 'a11y + ux mobile',
  },
  HEADER_TOO_TALL: {
    text: 'Header > 25% du viewport mobile : trop de scroll perdu avant le contenu. Reduire padding, masquer elements secondaires.',
    fileHint: '.scss du site (header)',
    impact: 'ux mobile',
  },
  HERO_TOO_TALL: {
    text: 'Section hero > 100% viewport mobile : l\'utilisateur ne voit pas qu\'il y a du contenu en dessous. Reduire hauteur ou ajouter indicateur scroll.',
    fileHint: '.scss du site (hero)',
    impact: 'ux mobile',
  },
  IMG_DISTORTED: {
    text: 'Image dont le ratio rendu diffère du ratio naturel (deformation). Utiliser object-fit ou ajuster les dimensions.',
    example: 'img.hero { width: 100%; height: 400px; object-fit: cover; }',
    fileHint: '.scss du site',
    impact: 'ux',
  },
  FORM_LABEL_MISSING: {
    text: 'Champ formulaire sans <label> associe. Ajouter un label ou aria-label.',
    example: '<label for="nom">Votre nom</label>\n<input type="text" id="nom" name="nom">',
    fileHint: 'formulaires CMS / Thelis',
    impact: 'a11y',
  },
  BURGER_NOT_FOUND: {
    text: 'Menu burger absent ou non clickable sur mobile. Verifier .menu-burger, .hamburger, l\'icone et son handler JS.',
    fileHint: '.tpl header + .js menu burger',
    impact: 'ux mobile critique',
  },
  BURGER_NAV_NOT_FOUND: {
    text: 'Le burger est present mais ne devoile pas de menu de navigation au clic. Verifier le toggle CSS class + le <nav>.',
    fileHint: '.tpl header + .js + .scss menu mobile',
    impact: 'ux mobile critique',
  },

  // ─── CMS / contenu AZKO ───────────────────────────────────────────
  AZKO_MODULE_EMPTY: {
    text: 'Container de module CMS present mais sans contenu. Verifier que tous les champs requis sont saisis pour ce module, ou retirer le module si non utilise.',
    fileHint: 'admin CMS AZKO (saisie de contenu)',
    impact: 'ux + maintenance',
  },
  AZKO_DEFAULT_ADDRESS: {
    text: 'Adresse par defaut AZKO (Labege, siege Septeo) toujours en place. Remplacer par l\'adresse client dans le CMS.',
    fileHint: 'CMS AZKO (organisation > adresse)',
    impact: 'critique pre-MEP',
  },
  AZKO_DEFAULT_PAGE: {
    text: 'Page par defaut AZKO (ex: /annonces) toujours accessible. Verifier qu\'elle est volontaire ou la supprimer.',
    fileHint: 'CMS AZKO (pages)',
    impact: 'qualite',
  },

  // ─── Securite / headers ───────────────────────────────────────────
  SECURITY_HEADERS_MISSING: {
    text: 'En-tetes de securite recommandes manquants. A ajouter cote serveur (nginx) ou via meta http-equiv pour CSP.',
    example: '# nginx\nadd_header X-Content-Type-Options "nosniff";\nadd_header X-Frame-Options "SAMEORIGIN";\nadd_header Referrer-Policy "strict-origin-when-cross-origin";',
    fileHint: 'config nginx AZKO (a remonter equipe dev)',
    reference: 'https://owasp.org/www-project-secure-headers/',
    impact: 'securite',
  },
  VIEWPORT_NO_SCALE: {
    text: 'user-scalable=no dans meta viewport : empeche le zoom mobile, violation WCAG 1.4.4. Retirer cette restriction.',
    example: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    fileHint: '.tpl header',
    reference: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text',
    impact: 'a11y + seo (Google penalise)',
  },

  // ─── RGPD ─────────────────────────────────────────────────────────
  PRIVACY_404: {
    text: 'Page politique de confidentialite obligatoire (RGPD) si formulaire de contact ou cookies. Creer la page et la lier.',
    fileHint: 'CMS AZKO (creer une page mentions / RGPD)',
    reference: 'https://www.cnil.fr/fr/comment-rediger-une-politique-de-confidentialite',
    impact: 'rgpd legal',
  },
  PRIVACY_IN_MENTIONS: {
    text: 'La politique de confidentialite est integree dans /mentions-legales.htm (probablement sous forme d\'accordeon). Verifier que le contenu est suffisant pour le RGPD : finalites du traitement, base legale, droits utilisateur, contact DPO, duree de conservation.',
    fileHint: 'CMS AZKO (section accordéon dans mentions legales)',
    reference: 'https://www.cnil.fr/fr/comment-rediger-une-politique-de-confidentialite',
    impact: 'rgpd legal',
  },
  MENTIONS_LEGALES_INCOMPLETE: {
    text: 'Mentions legales incompletes (manque souvent l\'hebergeur). Obligation legale en France (loi LCEN 2004).',
    fileHint: 'CMS AZKO (page mentions legales)',
    reference: 'https://www.economie.gouv.fr/entreprises/mentions-legales-internet',
    impact: 'legal',
  },

  // ─── Footer / email vide ──────────────────────────────────────────
  MAIL_EMPTY: {
    text: 'Le footer affiche "Mail :" sans adresse. Remplir le champ email contact dans le CMS, ou retirer le libelle.',
    fileHint: 'CMS AZKO (organisation > email)',
    impact: 'ux + image',
  },
};

/**
 * Recupere la suggestion de fix pour un ID d'issue.
 * Lookup en deux passes : exact match, puis pattern wildcard.
 *
 * @param {string} issueId
 * @returns {Object|null}
 */
export function getFixSuggestion(issueId) {
  if (!issueId || typeof issueId !== 'string') return null;

  // 1. Exact match (priorite)
  if (FIX_SUGGESTIONS[issueId]) return FIX_SUGGESTIONS[issueId];

  // 2. Pattern wildcard (ex: 'A11Y_*' matche 'A11Y_BUTTON_NAME')
  for (const key of Object.keys(FIX_SUGGESTIONS)) {
    if (!key.includes('*')) continue;
    // Echappe les caracteres regex sauf le `*`, puis remplace `*` par `.*`
    const re = new RegExp('^' + key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(issueId)) return FIX_SUGGESTIONS[key];
  }

  return null;
}
