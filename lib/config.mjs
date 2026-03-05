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
