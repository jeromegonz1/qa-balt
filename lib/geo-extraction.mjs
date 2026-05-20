/**
 * Extraction de coordonnees GPS depuis le HTML brut.
 *
 * Couvre les formats Google Maps les plus courants sur les sites AZKO/BALT :
 *   - Embed iframe `?pb=...!2d{lng}!3d{lat}` (format standard maps.google.com/maps?pb=)
 *   - URL params `?q={lat},{lng}` / `?ll={lat},{lng}` / `?center={lat},{lng}`
 *   - Anchor `<a href="https://maps.google.com/?q=...">` (sans iframe)
 *   - Static Maps API `?markers=color:red|{lat},{lng}`
 *
 * Utilise pour :
 *   - Cross-check Schema.org GPS vs vraies coords iframe (cas typique :
 *     integrateur configure l'iframe visible mais oublie Schema.org)
 *
 * Ne valide pas la plausibilite geographique des coords — la donnee est
 * remontee telle que trouvee dans le HTML.
 */

import { safeCurl } from './utils.mjs';

// Pages prioritaires pour la recherche (contact = 99% des cas)
const CONTACT_PATH_CANDIDATES = [
  '/contact.htm',
  '/contact-2.htm',
  '/nous-contacter.htm',
  '/contact',
  '/acces.htm',
  '/plan-d-acces.htm',
];

/**
 * Extrait les coords d'une URL Google Maps embed `?pb=...!2d{lng}!3d{lat}`.
 * Format le plus commun (iframe genere par "Partager → Integrer une carte").
 * @param {string} html
 * @returns {{lat: number, lng: number, format: 'pb'} | null}
 */
function extractFromPbEmbed(html) {
  // !2d et !3d peuvent apparaitre dans differents ordres selon les versions
  // mais !2d est toujours lng et !3d est toujours lat
  const match = html.match(/google[^"' ]*maps[^"']*[?&]pb=[^"']*!2d(-?[\d.]+)[^"']*!3d(-?[\d.]+)/);
  if (!match) return null;
  const lng = parseFloat(match[1]);
  const lat = parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, format: 'pb' };
}

/**
 * Extrait les coords d'une URL Maps `?q={lat},{lng}` / `?ll=...` / `?center=...`
 * Utilise pour anchors `<a>` ou iframes legacy.
 * @param {string} html
 * @returns {{lat: number, lng: number, format: 'q'|'ll'|'center'} | null}
 */
function extractFromQueryParam(html) {
  // On match l'URL google.com/maps puis le param coords
  // Note : ?q peut contenir d'autres valeurs (texte d'adresse), on filtre numerique uniquement
  const match = html.match(/(?:google[^"' ]*\/maps|maps\.google[^"' ]*)[^"']*[?&](q|ll|center)=(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
  if (!match) return null;
  const lat = parseFloat(match[2]);
  const lng = parseFloat(match[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, format: match[1] };
}

/**
 * Tente d'extraire les coords reelles d'une page HTML.
 * Cascade : pb → q/ll/center. Filtre les coords nulles (0,0).
 * @param {string} html
 * @returns {{lat: number, lng: number, format: string} | null}
 */
export function extractMapsCoords(html) {
  if (!html || typeof html !== 'string') return null;
  const result = extractFromPbEmbed(html) || extractFromQueryParam(html);
  if (!result) return null;
  // On rejette les coords 0,0 (placeholder, pas une vraie position)
  if (result.lat === 0 && result.lng === 0) return null;
  return result;
}

/**
 * Detecte la presence d'un short link Google Maps dans le HTML.
 * Patterns couverts :
 *   - maps.app.goo.gl/<id>     (format mobile / "Partager" depuis l'app)
 *   - goo.gl/maps/<id>         (format historique)
 *   - g.page/<id>              (Google My Business)
 *
 * Ces URLs ne contiennent ni coords ni adresse (resolues par redirection Google
 * cote serveur). Leur PRESENCE indique que Maps est configure cote integrateur,
 * meme si Schema.org JSON-LD reste a 0,0 (cas typique : oubli intégrateur).
 *
 * Cote QA : transforme SCHEMA_GPS_ZERO d'un bloquant "rien fait" en suggestion
 * actionnable "Maps configure, reporter coords Schema.org".
 *
 * @param {string} html
 * @returns {string | null} le short link trouve, ou null
 */
export function extractMapsShortLink(html) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.page)\/[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

/**
 * Extrait l'adresse texte d'un iframe Embed API v1 (`/embed/v1/place?q={adresse}`).
 * Ce format ne contient pas de coords — Google les resout au render-time depuis
 * l'adresse. Utilise pour suggerer une adresse a geocoder cote integrateur.
 * @param {string} html
 * @returns {string | null} adresse decodee, ou null
 */
export function extractMapsAddress(html) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/google\.[a-z.]+\/maps\/embed\/v1\/(?:place|search|directions)[^"']*[?&]q=([^&"'\s]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1].replace(/\+/g, ' '));
    // Si l'adresse ressemble a des coords brutes (placeholder, edge case), on rejette
    if (/^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/.test(decoded.trim())) return null;
    return decoded.trim();
  } catch {
    return null;
  }
}

/**
 * Cherche une reference de localisation reelle dans les pages du site
 * (contact en priorite). Retourne le premier match :
 *   - `coords` (lat/lng numeriques) — extrait des formats pb / q / ll / center
 *   - `address` (texte) — extrait de l'Embed API v1
 *
 * Strategie de parcours :
 *   1. Paths classiques /contact.htm, /acces.htm, etc.
 *   2. Pages crawled dont le nom contient "contact" / "acces" / "adresse"
 *   3. Fallback : premieres pages OK du crawl (max 5)
 *
 * @param {string} baseUrl
 * @param {Array<{path: string, name?: string, status?: number}>} pages
 * @returns {{page: string, coords?: {lat, lng, format}, address?: string} | null}
 */
export function findMapReference(baseUrl, pages = []) {
  const tried = new Set();

  const tryPath = (path) => {
    if (tried.has(path)) return null;
    tried.add(path);
    const html = safeCurl(`${baseUrl}${path}`, { maxTime: 10 });
    if (!html) return null;
    const coords = extractMapsCoords(html);
    if (coords) return { page: path, coords };
    const address = extractMapsAddress(html);
    if (address) return { page: path, address };
    const shortLink = extractMapsShortLink(html);
    if (shortLink) return { page: path, shortLink };
    return null;
  };

  // 1. Paths classiques (contact, acces) — meme s'ils ne sont pas dans le crawl
  for (const p of CONTACT_PATH_CANDIDATES) {
    const r = tryPath(p);
    if (r) return r;
  }

  // 2. Pages crawled avec nom evocateur
  const contactPages = pages.filter(p => {
    if (p.status && p.status >= 400) return false;
    const n = (p.name || p.path || '').toLowerCase();
    return /contact|acces|adresse|location|venue|trouvez|nous/.test(n);
  });
  for (const p of contactPages) {
    const r = tryPath(p.path);
    if (r) return r;
  }

  // 3. Fallback : premieres pages OK du crawl (max 5)
  const others = pages.filter(p => !p.status || p.status < 400).slice(0, 5);
  for (const p of others) {
    const r = tryPath(p.path);
    if (r) return r;
  }

  return null;
}

// Alias retro-compat : findRealMapCoords retourne seulement les coords si presentes
export function findRealMapCoords(baseUrl, pages = []) {
  const ref = findMapReference(baseUrl, pages);
  return ref && ref.coords ? { ...ref.coords, page: ref.page } : null;
}
