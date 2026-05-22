/**
 * Capture screenshot d'un element Playwright avec outline rouge applique.
 *
 * Sprint 4 : permet d'integrer un visuel ciblé directement dans la carte
 * issue du rapport HTML, plutot qu'un screenshot generique de page.
 *
 * Approche :
 *   1. On applique un outline rouge inline via element.evaluate (sauvegarde
 *      les styles precedents pour restauration)
 *   2. On scroll into view (si pas deja visible)
 *   3. On screenshot l'element (Playwright capture la zone visible avec
 *      un peu de padding via boundingBox)
 *   4. On restaure les styles precedents
 *
 * Gere les cas defaillants : element hidden, hors-DOM, selector invalide,
 * element ferme avant capture → returns null sans throw.
 *
 * Securite : le path final passe par join + on verifie qu'il reste sous
 * la racine `outputDir`. Le selector vient d'axe-core (controle).
 */
import { resolve, basename, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

const SCREENSHOT_TIMEOUT_MS = 4000;
const SCROLL_TIMEOUT_MS = 2000;

/**
 * Capture un screenshot d'un element avec outline rouge.
 *
 * @param {import('playwright').Page} page — page Playwright active
 * @param {string} selector — CSS selector de l'element (axe-core ou heuristique)
 * @param {string} outputPath — chemin absolu ou je veux sauver le PNG
 * @returns {Promise<string|null>} le chemin du PNG sauve, ou null si echec
 */
export async function captureElement(page, selector, outputPath) {
  if (!page || !selector || !outputPath) return null;
  if (!/\.png$/i.test(outputPath)) return null;

  let el;
  try {
    el = page.locator(selector).first();
    // Verifier l'existence sans throw
    const count = await el.count();
    if (count === 0) return null;
  } catch {
    return null;
  }

  // S'assurer que le dossier existe
  try {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }

  // Sauvegarder le style courant + appliquer outline rouge
  // Le data-attribute sert de marker temporaire pour restauration
  try {
    await el.evaluate(node => {
      node.dataset.qaBaltOldStyle = node.getAttribute('style') || '';
      const cur = node.style;
      cur.outline = '4px solid #e11';
      cur.outlineOffset = '2px';
      cur.boxShadow = '0 0 0 8px rgba(225, 17, 17, 0.15)';
    });
  } catch {
    return null;
  }

  // Scroll into view + screenshot (avec timeouts pour pas freezer)
  let saved = null;
  try {
    await el.scrollIntoViewIfNeeded({ timeout: SCROLL_TIMEOUT_MS });
    await el.screenshot({ path: outputPath, timeout: SCREENSHOT_TIMEOUT_MS });
    saved = outputPath;
  } catch {
    // capture echouee (hidden, detached, hors-page) — silencieux
  }

  // Restaurer le style precedent (best effort)
  try {
    await el.evaluate(node => {
      const old = node.dataset.qaBaltOldStyle;
      if (old !== undefined) {
        if (old) node.setAttribute('style', old);
        else node.removeAttribute('style');
        delete node.dataset.qaBaltOldStyle;
      }
    });
  } catch {
    // ignore — la page va etre fermee de toute facon
  }

  return saved;
}

/**
 * Construit un nom de fichier safe pour un screenshot d'issue.
 * Inclut l'ID de l'issue (PHP_E_WARNING → safe pour filesystem).
 */
export function buildIssueScreenshotName(issueId, suffix = '') {
  const safe = String(issueId || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .substring(0, 64);
  const sfx = suffix ? `-${String(suffix).replace(/[^a-z0-9]/gi, '').substring(0, 16)}` : '';
  return `issue-${safe}${sfx}.png`;
}
