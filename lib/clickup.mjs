/**
 * ClickUp API helper
 *
 * Gère la communication avec ClickUp :
 * - Récupérer les détails d'une tâche (dont les champs custom)
 * - Poster un commentaire (rapport QA)
 * - Changer le statut d'une tâche (optionnel, post-QA)
 */

const CLICKUP_API = 'https://api.clickup.com/api/v2';

function getHeaders() {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error('CLICKUP_API_TOKEN manquant dans .env');
  return {
    'Authorization': token,
    'Content-Type': 'application/json',
  };
}

/**
 * Récupère les détails d'une tâche ClickUp
 */
export async function getTask(taskId) {
  const res = await fetch(`${CLICKUP_API}/task/${taskId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error(`ClickUp GET task ${taskId}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Extrait l'URL préprod depuis les champs custom d'une tâche
 * Cherche un champ nommé "URL Préprod", "URL Preprod", "url_preprod", etc.
 */
export function extractPreprodUrl(task) {
  const customFields = task.custom_fields || [];

  // Chercher par nom de champ (flexible)
  const urlField = customFields.find(f =>
    /url.*pr[eé]prod|pr[eé]prod.*url|site.*azko|url.*site/i.test(f.name)
  );

  if (urlField && urlField.value) {
    return urlField.value.toString().trim();
  }

  // Fallback : chercher une URL .site.azko.fr dans la description
  const descMatch = (task.description || '').match(/(https?:\/\/[^\s]*\.site\.azko\.fr[^\s]*)/i);
  if (descMatch) return descMatch[1];

  // Fallback : chercher dans le nom de la tâche
  const nameMatch = (task.name || '').match(/(https?:\/\/[^\s]*\.site\.azko\.fr[^\s]*)/i);
  if (nameMatch) return nameMatch[1];

  return null;
}

/**
 * Poste un commentaire sur une tâche ClickUp
 * Supporte le markdown (ClickUp le rend correctement)
 */
export async function postComment(taskId, markdownText) {
  // ClickUp comment API — on utilise comment_text pour du texte simple
  // Pour du markdown riche, on passe par comment_text qui est interprété
  const res = await fetch(`${CLICKUP_API}/task/${taskId}/comment`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      comment_text: markdownText,
      notify_all: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`ClickUp POST comment: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Met à jour le statut d'une tâche (optionnel — post-QA)
 * Ex: passer de "QA" à "QA OK" ou "QA KO"
 */
export async function updateTaskStatus(taskId, status) {
  const res = await fetch(`${CLICKUP_API}/task/${taskId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    throw new Error(`ClickUp PUT status: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Extrait l'URL du modèle/template depuis les champs custom d'une tâche
 * Cherche un champ nommé "Modèle", "Template", "URL Modèle", etc.
 */
export function extractModelUrl(task) {
  const customFields = task.custom_fields || [];

  // Chercher par nom de champ (flexible)
  const modelField = customFields.find(f =>
    /mod[eè]le|template|url.*mod[eè]le|mod[eè]le.*url/i.test(f.name)
  );

  if (modelField && modelField.value) {
    const val = modelField.value.toString().trim();
    // Si c'est une URL, la retourner directement
    if (val.startsWith('http')) return val;
    // Si c'est un nom de modèle, construire l'URL préprod AZKO
    // Les modèles BALT sont en général sur modele-xxx.site.azko.fr
    if (val.length > 2 && !val.includes(' ')) {
      return `http://${val}.site.azko.fr`;
    }
  }

  // Fallback : chercher dans la description un lien vers un modèle
  const descMatch = (task.description || '').match(
    /mod[eè]le\s*:?\s*(https?:\/\/[^\s]+)/i
  );
  if (descMatch) return descMatch[1];

  // Fallback : chercher "modèle : nom" dans la description
  const nameMatch = (task.description || '').match(
    /mod[eè]le\s*:?\s*([a-z0-9][-a-z0-9]+)/i
  );
  if (nameMatch) return `http://${nameMatch[1]}.site.azko.fr`;

  return null;
}

/**
 * Extrait le contexte complet du site depuis les champs custom ClickUp
 * Retourne un objet avec toutes les infos utiles pour le QA
 */
export function extractSiteContext(task) {
  const fields = task.custom_fields || [];
  const ctx = {};

  for (const f of fields) {
    const name = (f.name || '').toLowerCase().trim();
    // Valeur brute — gérer dropdown (type_config.options) vs texte
    const val = extractFieldValue(f);
    if (!val) continue;

    if (/^mod[eè]le$/.test(name)) ctx.model = val;
    if (/client.?type|type.?client/i.test(name)) ctx.sector = val;
    if (/site.?type|type.?site/i.test(name)) ctx.siteType = val;
    if (/titre.?site/i.test(name)) ctx.title = val;
    if (/url.?existante/i.test(name)) ctx.existingUrl = normalizeUrl(val);
    if (/interlocuteur/i.test(name)) ctx.contact = val;
    if (/t[eé]l[eé]phone/i.test(name)) ctx.phone = val;
    if (/email.?client/i.test(name)) ctx.clientEmail = val;
    if (/email.?formulaire/i.test(name)) ctx.formEmail = val;
  }

  return ctx;
}

/** Extrait la valeur d'un champ custom ClickUp (texte, dropdown, email, etc.) */
function extractFieldValue(field) {
  if (!field.value && field.value !== 0) return null;

  // Dropdown : la value est un index, la vraie valeur est dans type_config.options
  if (field.type === 'drop_down' && field.type_config?.options) {
    const selected = field.type_config.options.find(o => o.orderindex === field.value);
    return selected?.name || null;
  }

  // Labels (type labels) : value est un tableau d'IDs
  if (field.type === 'labels' && Array.isArray(field.value) && field.type_config?.options) {
    return field.value
      .map(id => field.type_config.options.find(o => o.id === id)?.label)
      .filter(Boolean)
      .join(', ');
  }

  return field.value.toString().trim();
}

/** Normalise une URL (ajoute http:// si manquant) */
function normalizeUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  return url.replace(/\/$/, '');
}

/**
 * Formate le rapport QA pour un commentaire ClickUp lisible
 * ClickUp a des limites sur la taille des commentaires, on tronque si besoin
 */
export function formatReportForComment(report, siteUrl) {
  const MAX_LENGTH = 10000; // Limite safe pour ClickUp

  let comment = report;

  // Si le rapport est trop long, garder la synthèse + bloquants + checklist + priorités
  if (comment.length > MAX_LENGTH) {
    const sections = comment.split('---');
    // Garder : header (0), synthèse (1), bloquants (2), checklist (3), priorités (dernière)
    const header = sections.slice(0, 4).join('---');
    const priorities = sections[sections.length - 1];
    comment = header + '\n---\n\n' +
      '> ⚠️ Rapport tronqué — voir le rapport complet dans le dossier reports/\n\n---\n' +
      priorities;
  }

  return comment;
}
