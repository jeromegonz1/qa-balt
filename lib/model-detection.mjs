/**
 * Detection auto du modele BALT a partir du HTML preprod.
 *
 * Pattern recherche dans le code source brut :
 *   <div class="btn-catalogue">
 *     <a href="https://catalogue-{vertical}.azko.fr/formulaire-maquette.htm?modele={Model}" ...>
 *
 * Le widget est injecte par defaut sur les preprods AZKO :
 *   - Conserve (display:none via SCSS) → detection OK
 *   - Supprime du .tpl par l'integrateur → detection impossible (fallback ClickUp)
 *
 * Cascade dans qa.mjs : siteContext.model (manuel) prioritaire, sinon ce parser.
 * Si rien n'est trouve : pas d'erreur, modele reste inconnu (optionnel).
 */

const WIDGET_REGEX = /catalogue-([a-z-]+)\.azko\.fr\/formulaire-maquette\.htm\?modele=([A-Za-z0-9_-]+)/i;

const VERTICAL_NORMALIZE = {
  avocats: 'avocat',
  notaires: 'notaire',
  cdj: 'cdj',
  campings: 'camping',
  'domaines-residences-hotels': 'hospitality',
};

/**
 * Extrait le modele et le vertical depuis le HTML brut d'une page preprod.
 * @param {string} html
 * @returns {{name: string, id: string, vertical: string, verticalRaw: string} | null}
 */
export function extractModelFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(WIDGET_REGEX);
  if (!m) return null;
  const verticalRaw = m[1].toLowerCase();
  return {
    name: m[2],
    id: m[2].toLowerCase(),
    verticalRaw,
    vertical: VERTICAL_NORMALIZE[verticalRaw] || verticalRaw,
  };
}
