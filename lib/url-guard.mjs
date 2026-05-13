/**
 * Validation stricte des URLs acceptees par qa-balt.
 *
 * Defense en profondeur, en amont de validatePublicUrl (SSRF) :
 *   - Whitelist de domaines (qa-balt n'est PAS un scanner generique)
 *   - Whitelist de schemes (http / https uniquement)
 *   - Limite de longueur (anti-DoS / log pollution)
 *   - Refus des caracteres de controle (anti log-injection / header smuggling)
 *
 * Objectif : empecher l'usage de l'endpoint comme proxy d'audit pour
 * scanner des sites tiers (legalement risque, IP VPS apparait dans logs
 * des cibles).
 *
 * Deux niveaux de whitelist :
 *   - AUDIT : URL du site cible — strict, *.azko.fr uniquement (preprods)
 *   - MODEL : URL du modele de comparaison — un cran plus permissif
 *             (*.azko.fr + *.septeo-digitalagency.fr pour les demos)
 */

const MAX_URL_LENGTH = 2048;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Suffixes de hostname acceptes (compares via endsWith → resistant suffix attack)
const AUDIT_ALLOWED_SUFFIXES = Object.freeze(['.azko.fr']);
const MODEL_ALLOWED_SUFFIXES = Object.freeze(['.azko.fr', '.septeo-digitalagency.fr']);

/**
 * Verifie qu'un hostname matche au moins un suffixe autorise.
 * Resistant aux attaques par suffixe :
 *   'evil.azko.fr.attacker.com'.endsWith('.azko.fr') === false ✓
 * Resistant au matching du root :
 *   'azko.fr'.endsWith('.azko.fr') === false ✓ (le point de prefix)
 */
function hostnameMatches(hostname, suffixes) {
  const lc = hostname.toLowerCase();
  return suffixes.some(suffix => lc.endsWith(suffix));
}

/**
 * Validation commune : longueur, control chars, parsing, scheme.
 * @returns {URL} URL parsee
 * @throws Error avec message court (safe a renvoyer au client)
 */
function commonValidate(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('URL manquante');
  }
  if (urlStr.length > MAX_URL_LENGTH) {
    throw new Error(`URL trop longue (max ${MAX_URL_LENGTH} chars)`);
  }
  if (CONTROL_CHARS.test(urlStr)) {
    throw new Error('URL contient des caracteres de controle interdits');
  }
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('URL malformee');
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Scheme non autorise : ${parsed.protocol} (http ou https uniquement)`);
  }
  if (!parsed.hostname) {
    throw new Error('Hostname manquant dans l\'URL');
  }
  return parsed;
}

/**
 * Valide une URL d'audit (site preprod a auditer).
 * Whitelist STRICTE : *.azko.fr uniquement.
 *
 * @param {string} urlStr
 * @returns {URL} URL parsee si valide
 * @throws Error avec message court si invalide
 */
export function validateAuditUrl(urlStr) {
  const parsed = commonValidate(urlStr);
  if (!hostnameMatches(parsed.hostname, AUDIT_ALLOWED_SUFFIXES)) {
    throw new Error(
      `Domaine non autorise pour audit : ${parsed.hostname}. `
      + `Cibles acceptees : *.azko.fr (preprods uniquement).`
    );
  }
  return parsed;
}

/**
 * Valide une URL de modele (demo BALT pour comparaison contenu).
 * Whitelist PLUS LARGE : *.azko.fr + *.septeo-digitalagency.fr.
 *
 * @param {string} urlStr
 * @returns {URL} URL parsee si valide
 */
export function validateModelUrl(urlStr) {
  const parsed = commonValidate(urlStr);
  if (!hostnameMatches(parsed.hostname, MODEL_ALLOWED_SUFFIXES)) {
    throw new Error(
      `Domaine non autorise pour modele : ${parsed.hostname}. `
      + `Sources acceptees : *.azko.fr ou *.septeo-digitalagency.fr.`
    );
  }
  return parsed;
}

// Exposes pour les tests / la doc — modifier la whitelist = modifier le code.
export const _internals = Object.freeze({
  MAX_URL_LENGTH,
  AUDIT_ALLOWED_SUFFIXES,
  MODEL_ALLOWED_SUFFIXES,
});
