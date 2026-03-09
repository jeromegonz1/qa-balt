/**
 * Loader de référence modèles AZKO
 *
 * Charge les fichiers data/models-{vertical}.json à la demande.
 * Cache mémoire : 1 lecture par vertical par exécution.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const cache = new Map();

/**
 * Charge tous les modèles d'un vertical (camping, avocat, cdj, notaire).
 * @param {string} vertical
 * @returns {Object|null} { id: modelObj, ... } ou null si fichier absent
 */
export function loadModels(vertical) {
  if (cache.has(vertical)) return cache.get(vertical);
  try {
    const raw = readFileSync(resolve(dataDir, `models-${vertical}.json`), 'utf-8');
    const data = JSON.parse(raw);
    cache.set(vertical, data);
    return data;
  } catch {
    cache.set(vertical, null);
    return null;
  }
}

/**
 * Retourne un modèle précis d'un vertical.
 * @param {string} vertical
 * @param {string} modelId
 * @returns {Object|null}
 */
export function getModel(vertical, modelId) {
  const models = loadModels(vertical);
  return models?.[modelId] || null;
}

/**
 * Cherche un modèle par ID dans tous les verticals.
 * @param {string} modelId
 * @returns {Object|null} modèle enrichi avec .vertical, ou null
 */
export function findModel(modelId) {
  const id = modelId.toLowerCase().trim();
  const verticals = discoverVerticals();
  for (const v of verticals) {
    const models = loadModels(v);
    if (models?.[id]) {
      return { ...models[id], vertical: v };
    }
  }
  return null;
}

/**
 * Auto-découverte des verticals via data/models-*.json
 */
function discoverVerticals() {
  try {
    return readdirSync(dataDir)
      .filter(f => /^models-\w+\.json$/.test(f))
      .map(f => basename(f, '.json').replace('models-', ''));
  } catch {
    return [];
  }
}
