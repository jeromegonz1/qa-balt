/**
 * Configuration centralisée QA-BALT
 *
 * Toutes les valeurs configurables sont ici.
 * Ajouter une entrée = étendre un check, sans toucher à la logique.
 */

// ═══════════════════════════════════════
// Seuils SEO
// ═══════════════════════════════════════
export const SEO_THRESHOLDS = {
  title: {
    min: 15,           // En dessous → TITLE_SHORT (IMPORTANT)
    warnMax: 70,       // Au-dessus → TITLE_LONG (MINEUR) — tronqué dans Google
    errorMax: 150,     // Au-dessus → TITLE_EXCESSIVE (IMPORTANT) — anormalement long
  },
  metaDescription: {
    warnMax: 160,      // Au-dessus → META_DESC_LONG (MINEUR) — tronquée dans Google
    errorMax: 320,     // Au-dessus → META_DESC_EXCESSIVE (IMPORTANT)
  },
  image: {
    heavyBytes: 500000, // 500 Ko → IMG_HEAVY
  },
};

// ═══════════════════════════════════════
// Emails internes / par défaut (à ne jamais trouver en prod)
// ═══════════════════════════════════════
export const BLACKLISTED_EMAILS = [
  'contact@azko.fr',
  'contact@septeo.fr',
  'test@azko.fr',
  'demo@azko.fr',
];

// ═══════════════════════════════════════
// Noms internes Septeo/AZKO (données de test / maquette)
// ═══════════════════════════════════════
export const BLACKLISTED_NAMES = [
  'Olivier Gilles',
  'Lison Guérin',
  'Lison Guerin',
  'Olivier GUERIN',
  'Olivier Guérin',
  'Olivier Guerin',
];

// ═══════════════════════════════════════
// Pages CMS par défaut (générées automatiquement, doivent être bloquées)
// ═══════════════════════════════════════
export const DEFAULT_CMS_PAGES = [
  {
    path: '/annonces',
    label: 'Liste brute des annonces',
    realPages: '/locations.htm et /emplacements.htm',
  },
];

// ═══════════════════════════════════════
// Adresses par défaut (siège AZKO/Septeo)
// ═══════════════════════════════════════
export const DEFAULT_ADDRESSES = [
  // Siège Septeo / AZKO à Labège
  { pattern: /Lab[eè]ge/i, label: 'Labège (siège Septeo)' },
  { pattern: /31670/i, label: 'Code postal 31670 (Labège)' },
  { pattern: /rue\s+(?:de\s+)?Caulet/i, label: 'Rue de Caulet (siège Septeo)' },
  // Coordonnées Maps par défaut connues
  { pattern: /43\.5.*1\.5/i, label: 'Coordonnées GPS Labège' },
];

// ═══════════════════════════════════════
// URLs Google Maps "default" des demos BALT
// ═══════════════════════════════════════
// Detectees via scan des demos septeo-digitalagency.fr (mai 2026) :
// 10+ demos pointent sur ces URLs au lieu des coords client. L'integrateur
// doit les remplacer par le vrai lien Google Maps du client (clic droit
// sur l'adresse cliente dans Maps → Partager → Copier le lien).
//
// Pattern : URL exacte uniquement (pas de prefix match) car les short URLs
// Maps sont uniques par adresse.
export const BALT_DEFAULT_MAPS_URLS = [
  {
    url: 'maps.app.goo.gl/jMmZsvHsKJ4GzuAG9',
    source: 'demo BALT (principale — alguazil, alimon, muscat, euclase, faena, allegro, hemingway, etc.)',
  },
  {
    url: 'maps.app.goo.gl/MStNtP9D3eoitZ9V7',
    source: 'demo BALT (variante — bellini, cosmopolitan)',
  },
  {
    url: 'goo.gl/maps/Gbw5HAkXrUjFoJGK8',
    source: 'catalogues BALT (catalogue-avocats/notaires/cdj/campings/hotels)',
  },
];

// ═══════════════════════════════════════
// Formats acceptés
// ═══════════════════════════════════════
export const ACCEPTED_FORMATS = {
  logo: ['.svg', '.webp'],
  favicon: ['.svg', '.png', '.ico'],
};

// ═══════════════════════════════════════
// Sélecteurs DOM connus (templates AZKO/BALT)
// ═══════════════════════════════════════
export const SELECTORS = {
  logo: [
    'img[src*="logo"]',
    'img[class*="logo"]',
    '.logo img',
    '#logo img',
    '.headerLogo img',
    'a.logo img',
  ],
  favicon: [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ],
};

// ═══════════════════════════════════════
// Réseaux sociaux (domaines à tester)
// ═══════════════════════════════════════
export const SOCIAL_DOMAINS = [
  { domain: 'facebook.com', name: 'Facebook' },
  { domain: 'instagram.com', name: 'Instagram' },
  { domain: 'linkedin.com', name: 'LinkedIn' },
  { domain: 'twitter.com', name: 'Twitter' },
  { domain: 'x.com', name: 'X (Twitter)' },
  { domain: 'youtube.com', name: 'YouTube' },
  { domain: 'tiktok.com', name: 'TikTok' },
];

// Profils AZKO/Septeo par défaut (ne doivent pas apparaître sur un site client)
export const SOCIAL_BLACKLIST_PATTERNS = [
  /azko/i,
  /septeo/i,
  /facebook\.com\/azko/i,
  /instagram\.com\/azko/i,
];

// ═══════════════════════════════════════
// Signatures page 404 par défaut (serveur, pas CMS)
// ═══════════════════════════════════════
export const DEFAULT_404_SIGNATURES = [
  /<title>404 Not Found<\/title>/i,
  /<h1>Not Found<\/h1>/i,
  /nginx\//i,
  /Apache\/[\d.]+/i,
  /<title>404<\/title>/i,
  /The page you are looking for/i,
  /<center>nginx<\/center>/i,
];

// ═══════════════════════════════════════
// URL "propres" — patterns à signaler
// ═══════════════════════════════════════
export const DIRTY_URL_PATTERNS = [
  { regex: /[?&]id=\d+/i, label: 'Paramètre ?id= numérique' },
  { regex: /[?&]p=\d+/i, label: 'Paramètre ?p= numérique' },
  { regex: /[?&]PHPSESSID=/i, label: 'Session PHP dans l\'URL' },
  { regex: /[?&]sid=/i, label: 'Session ID dans l\'URL' },
  { regex: /[?&]action=\w+/i, label: 'Paramètre ?action=' },
  { regex: /index\.php\?/i, label: 'index.php avec paramètres' },
];

// ═══════════════════════════════════════
// Accessibilité (axe-core)
// ═══════════════════════════════════════
export const A11Y = {
  // WCAG 2.1 AA — standard minimum attendu
  tags: ['wcag2a', 'wcag2aa', 'best-practice'],
  // Nombre max de pages testées (axe est lent ~3-5s/page)
  maxPages: 10,
  // Mapping impact axe-core → sévérité QA-BALT
  severityMap: {
    critical: 'BLOQUANT',
    serious: 'IMPORTANT',
    moderate: 'MINEUR',
    minor: 'MINEUR',
  },
  // Règles à ignorer (déjà couvertes par d'autres modules ou faux positifs connus AZKO)
  disabledRules: [
    'color-contrast',  // Trop de faux positifs sur les sites AZKO (GSAP opacity, overlays)
    'page-has-heading-one', // Déjà couvert par page-checks H1_MISSING
  ],
};

// ═══════════════════════════════════════
// SE Ranking API (Core Web Vitals / Site Audit)
// ═══════════════════════════════════════
export const SERANKING = {
  baseUrl: 'https://api.seranking.com/v1',
  // Standard = 2 credits/page, Advanced = 20 credits/page (JS rendering)
  mode: 'standard',
  maxPages: 5,                 // Pages crawlées par audit (5 pages = 10 credits)
  pollIntervalMs: 5000,        // Intervalle de polling status
  pollTimeoutMs: 180000,       // Timeout max (3 min)
  cleanupAfter: true,          // Supprimer l'audit après extraction
  // Seuils Core Web Vitals (Google)
  cwvThresholds: {
    lcp:  { good: 2500, poor: 4000 },   // ms — Largest Contentful Paint
    cls:  { good: 0.1,  poor: 0.25 },   // score — Cumulative Layout Shift
    fcp:  { good: 1800, poor: 3000 },   // ms — First Contentful Paint
    tbt:  { good: 200,  poor: 500 },    // ms — Total Blocking Time
  },
  // Score santé global
  healthScore: {
    good: 80,     // >= 80 → pas d'issue
    warning: 60,  // 60-79 → MINEUR
    poor: 0,      // < 60 → IMPORTANT
  },
};

// ═══════════════════════════════════════
// Checks visuels — seuils Playwright
// ═══════════════════════════════════════
export const VISUAL_THRESHOLDS = {
  fontMinPx: 14,               // En dessous → FONT_TOO_SMALL
  headerMaxPercent: 18,         // Au-dessus → HEADER_TOO_TALL
  heroMaxPercent: 90,           // Au-dessus → HERO_TOO_TALL
  imgDistortionThreshold: 0.1,  // Ecart ratio → IMG_DISTORTED
  imgBrokenMax: 5,              // >=5 images broken → BLOQUANT
};

// ═══════════════════════════════════════
// Content checks — seuils comparaison modèle
// ═══════════════════════════════════════
export const CONTENT_THRESHOLDS = {
  modelSimilarity: 0.70,       // Similarité modèle → CONTENT_CHECK
  maxModelPages: 15,           // Max pages modèle à fetcher
  modelCrawlBudgetMs: 60000,   // Budget temps global pour le crawl modèle (60s)
};

// ═══════════════════════════════════════
// Moteurs de réservation — patterns démo à détecter
// ═══════════════════════════════════════
export const BOOKING_DEMO_PATTERNS = [
  // Thelis (thelisresa.webcamp.fr) — "demosalons" = compte démo salon pro
  { regex: /thelisresa\.webcamp\.fr\/[^"]*camping=demosalon/i, engine: 'Thelis', label: 'camping=demosalons (demo salon)' },
  // eSeason — patterns démo connus
  { regex: /eseason\.[^"]*\/demo/i, engine: 'eSeason', label: 'URL demo eSeason' },
  // Ctoutvert — patterns démo
  { regex: /ctoutvert\.[^"]*\/demo/i, engine: 'Ctoutvert', label: 'URL demo Ctoutvert' },
  // Amenitiz — patterns démo
  { regex: /amenitiz\.[^"]*\/demo/i, engine: 'Amenitiz', label: 'URL demo Amenitiz' },
];

// ═══════════════════════════════════════
// Sites de test (panel multi-secteurs pour valider les checks)
// ═══════════════════════════════════════
export const TEST_SITES = [
  { url: 'http://camping-les-cinq-vallees.site.azko.fr', sector: 'camping', label: 'Camping Les Cinq Vallées' },
  { url: 'http://camping-municipal-hippodrome.site.azko.fr', sector: 'camping', label: 'Camping Municipal Hippodrome' },
  { url: 'http://camping-arquebuse.site.azko.fr', sector: 'camping', label: 'Camping Arquebuse' },
  { url: 'http://lc-avocats.site.azko.fr', sector: 'avocat', label: 'LC Avocats' },
  { url: 'http://rousselavocat.site.azko.fr', sector: 'avocat', label: 'Roussel Avocat' },
  { url: 'http://ordre-avocats-limoges.site.azko.fr', sector: 'avocat', label: 'Ordre des Avocats de Limoges' },
  { url: 'http://hotel-lys-chablis.site.azko.fr', sector: 'hotel', label: 'Hôtel du Lys Chablis' },
];
