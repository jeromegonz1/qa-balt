/**
 * Détection de contenus génériques / non personnalisés
 *
 * Deux stratégies complémentaires :
 *
 * 1. PATTERNS GÉNÉRIQUES (sans modèle)
 *    Détecte les placeholders, textes templates, données par défaut
 *    qui n'ont clairement pas été remplacés.
 *
 * 2. COMPARAISON AVEC LE MODÈLE (si URL modèle dispo)
 *    Crawle le site modèle, compare le contenu texte page par page.
 *    Signale les pages où >70% du contenu est identique au modèle.
 */
import { execSync } from 'child_process';
import { BLACKLISTED_NAMES, CONTENT_THRESHOLDS } from './config.mjs';

const { maxModelPages, modelCrawlBudgetMs } = CONTENT_THRESHOLDS;

// ═══════════════════════════════════════
// Patterns génériques par secteur BALT
// ═══════════════════════════════════════

// Noms blacklistés → regex dynamique depuis config.mjs
const BLACKLISTED_NAMES_PATTERN = {
  regex: new RegExp(
    BLACKLISTED_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi'
  ),
  id: 'BLACKLISTED_NAME',
  label: 'Nom interne Septeo/AZKO détecté',
  severity: 'BLOQUANT',
};

// Patterns universels (tous secteurs)
const UNIVERSAL_PATTERNS = [
  // Placeholders entre crochets
  { regex: /\[(?:Nom|Prénom|Adresse|Téléphone|Email|Ville|Code postal|Société|Cabinet|Étude|Hôtel|Camping)[^\]]*\]/gi, id: 'PLACEHOLDER_BRACKET', label: 'Placeholder entre crochets' },
  // Placeholders entre accolades (hors variables CMS AZKO)
  { regex: /\{(?:NOM|PRENOM|ADRESSE|TELEPHONE|EMAIL|VILLE|CABINET|ETUDE)[^\}]*\}/g, id: 'PLACEHOLDER_BRACE', label: 'Placeholder entre accolades' },
  // "XXX" ou "xxx" comme placeholder
  { regex: /(?:^|\s)(?:XXX|xxx|XYZ|XXXXX)(?:\s|[.,;!?€]|$)/gm, id: 'PLACEHOLDER_XXX', label: 'Placeholder XXX' },
  // Prix placeholder
  { regex: /(?:à partir de |tarif[s]?\s*:?\s*)?(?:XX|xx|___)\s*€/gi, id: 'PLACEHOLDER_PRICE', label: 'Prix placeholder (XX €)' },
  // Numéro de téléphone placeholder
  { regex: /(?:0[1-9][\s.]?(?:00|XX|xx)[\s.]?(?:00|XX|xx)[\s.]?(?:00|XX|xx)[\s.]?(?:00|XX|xx)|\+33\s*X{2,})/g, id: 'PLACEHOLDER_PHONE', label: 'Téléphone placeholder' },
  // Email placeholder évident
  { regex: /(?:email|contact|info)@(?:exemple|example|votredomaine|votre-domaine|domaine|domain|cabinet|etude|hotel|camping)\.\w+/gi, id: 'PLACEHOLDER_EMAIL', label: 'Email placeholder' },
  // Adresse placeholder
  { regex: /(?:(?:\d+,?\s+)?rue\s+(?:de\s+)?(?:la\s+)?(?:exemple|template|demo|test)|(?:\d{5})\s+(?:Ville|VILLE))/gi, id: 'PLACEHOLDER_ADDRESS', label: 'Adresse placeholder' },
  // Noms internes Septeo/AZKO (config.mjs)
  BLACKLISTED_NAMES_PATTERN,
];

// Patterns spécifiques Avocats
const AVOCAT_PATTERNS = [
  // Noms de cabinets génériques
  { regex: /(?:cabinet|maître|me\.?)\s+(?:\[|\{|XXX|Nom|Prénom)/gi, id: 'GENERIC_AVOCAT_NAME', label: 'Nom de cabinet/avocat générique' },
  // Tarifs avocats clairement template
  { regex: /consultation\s*:?\s*(?:à partir de\s*)?(?:XX|___|\[)\s*€/gi, id: 'GENERIC_AVOCAT_TARIF', label: 'Tarif avocat placeholder' },
  // Barreaux placeholder
  { regex: /barreau\s+de\s+(?:\[Ville\]|Ville|XXX)/gi, id: 'GENERIC_BARREAU', label: 'Barreau placeholder' },
  // Compétences copier-coller typiques des templates (texte ultra-générique long)
  { regex: /notre\s+cabinet\s+(?:est\s+)?(?:spécialisé|expert|compétent)\s+(?:dans|en)\s+(?:de\s+)?nombreux\s+domaines/gi, id: 'GENERIC_COMPETENCE_TEXT', label: 'Texte compétences ultra-générique' },
  // CAPA/Serment date placeholder
  { regex: /(?:serment|CAPA|assermenté)\s+(?:en|le|depuis)\s+(?:\[|\{|XXXX|année)/gi, id: 'GENERIC_SERMENT_DATE', label: 'Date serment/CAPA placeholder' },
];

// Patterns spécifiques Notaires
const NOTAIRE_PATTERNS = [
  { regex: /(?:étude|office)\s+(?:notariale?\s+)?(?:de\s+)?(?:\[|\{|XXX|Nom|Maître)/gi, id: 'GENERIC_NOTAIRE_NAME', label: 'Nom étude notariale générique' },
  { regex: /(?:notaire|étude)\s+(?:à|de)\s+(?:\[Ville\]|Ville|XXX)/gi, id: 'GENERIC_NOTAIRE_VILLE', label: 'Ville notaire placeholder' },
];

// Patterns spécifiques Camping / Hôtel
const CAMPING_PATTERNS = [
  { regex: /(?:camping|hôtel|hotel|resort)\s+(?:\[|\{|XXX|Nom)/gi, id: 'GENERIC_CAMPING_NAME', label: 'Nom camping/hôtel générique' },
  { regex: /(?:nuit(?:ée)?|emplacement|mobile.?home)\s*:?\s*(?:à partir de\s*)?(?:XX|___|\[)\s*€/gi, id: 'GENERIC_CAMPING_TARIF', label: 'Tarif camping placeholder' },
  { regex: /(?:piscine|lac|mer|plage|rivière)\s+(?:à|de)\s+(?:\[|\{|XX|___)\s*(?:m|km|min)/gi, id: 'GENERIC_CAMPING_DISTANCE', label: 'Distance placeholder' },
];

// ═══════════════════════════════════════
// Textes "template" connus BALT
// (phrases qui apparaissent dans les modèles et doivent être remplacées)
// ═══════════════════════════════════════
const KNOWN_TEMPLATE_SENTENCES = [
  // Phrases ultra-génériques typiques des templates avocats
  'notre cabinet vous accompagne dans toutes vos démarches juridiques',
  'une équipe d\'avocats expérimentés à votre service',
  'nous mettons notre expertise au service de vos intérêts',
  'un accompagnement personnalisé pour chaque dossier',
  'des honoraires adaptés à votre situation',
  'premier rendez-vous gratuit et sans engagement',
  // Phrases template notaires
  'notre étude vous accueille pour tous vos actes notariés',
  'un service de proximité pour particuliers et professionnels',
  // Phrases template campings
  'profitez de vacances inoubliables au cœur de la nature',
  'des hébergements tout confort pour toute la famille',
  'un camping au bord de l\'eau pour des vacances réussies',
];

/**
 * Normalise le texte pour la comparaison
 * Supprime HTML, ponctuation excessive, normalise les espaces
 */
function normalizeText(html) {
  return html
    // Supprimer scripts et styles
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Supprimer les tags HTML
    .replace(/<[^>]+>/g, ' ')
    // Décoder les entités HTML courantes
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    // Normaliser les espaces
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extrait le contenu "body" principal (sans header/footer/nav)
 * Pour ne pas comparer les éléments de template communs
 */
function extractMainContent(html) {
  // Retirer header, nav, footer (communs au template, pas pertinents)
  let main = html
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Chercher un <main> ou un conteneur principal AZKO
  const mainMatch = main.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  const contentMatch = main.match(/class="[^"]*(?:sectionContainer|pageContent|mainContent)[^"]*"[^>]*>([\s\S]*)/i);
  if (contentMatch) return contentMatch[1];

  // Fallback : tout le body sans header/footer
  const bodyMatch = main.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  return main;
}

/**
 * Calcule la similarité de Jaccard entre deux textes (sur des trigrammes)
 * Retourne un score entre 0 (rien en commun) et 1 (identique)
 */
function textSimilarity(textA, textB) {
  if (!textA || !textB) return 0;

  const ngramSize = 4; // 4-grammes de mots
  const wordsA = textA.split(/\s+/).filter(w => w.length > 2);
  const wordsB = textB.split(/\s+/).filter(w => w.length > 2);

  // Si trop court, pas de comparaison fiable
  if (wordsA.length < 10 || wordsB.length < 10) return 0;

  function ngrams(words) {
    const set = new Set();
    for (let i = 0; i <= words.length - ngramSize; i++) {
      set.add(words.slice(i, i + ngramSize).join(' '));
    }
    return set;
  }

  const setA = ngrams(wordsA);
  const setB = ngrams(wordsB);

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Détecte le secteur du site (avocat, notaire, camping, hôtel, CDJ)
 * basé sur les contenus et la structure
 */
function detectSector(html, domain) {
  const text = normalizeText(html);
  const scores = {
    avocat: 0,
    notaire: 0,
    camping: 0,
  };

  // Mots-clés par secteur
  if (/avocat|cabinet|barreau|droit|juridique|plaidoirie|contentieux/i.test(text)) scores.avocat += 3;
  if (/notaire|notarial|acte\s+authentique|étude\s+notariale/i.test(text)) scores.notaire += 3;
  if (/camping|emplacement|mobile.?home|piscine|vacances|hébergement|nuitée/i.test(text)) scores.camping += 3;
  if (/hôtel|hotel|chambre|réservation|séjour/i.test(text)) scores.camping += 2;

  // Vérifier dans le domaine aussi
  if (/avocat|cabinet|law|droit/i.test(domain)) scores.avocat += 2;
  if (/notaire|etude|office/i.test(domain)) scores.notaire += 2;
  if (/camping|hotel|resort|vacance|glamping/i.test(domain)) scores.camping += 2;

  const max = Math.max(...Object.values(scores));
  if (max === 0) return 'general';

  return Object.entries(scores).find(([, v]) => v === max)[0];
}

/**
 * STRATÉGIE 1 : Détection de patterns génériques (sans modèle)
 */
function checkGenericPatterns(baseUrl, pages) {
  const issues = [];
  let homepageHtml = '';

  // Récupérer la homepage pour détecter le secteur
  try {
    homepageHtml = execSync(
      `curl -sL -k --max-time 15 "${baseUrl}/" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 20000 }
    );
  } catch (e) { /* fallback : pas de detection de secteur */ }

  const domain = new URL(baseUrl).hostname;
  const sector = detectSector(homepageHtml, domain);
  console.log(`   Secteur détecté : ${sector}`);

  // Choisir les patterns selon le secteur
  let sectorPatterns = [];
  if (sector === 'avocat') sectorPatterns = AVOCAT_PATTERNS;
  else if (sector === 'notaire') sectorPatterns = NOTAIRE_PATTERNS;
  else if (sector === 'camping') sectorPatterns = CAMPING_PATTERNS;

  const allPatterns = [...UNIVERSAL_PATTERNS, ...sectorPatterns];

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;
    if (p.path.endsWith('.xml')) continue;

    let html;
    try {
      html = execSync(
        `curl -sL -k --max-time 15 "${baseUrl}${p.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
    } catch (e) { continue; }

    const mainHtml = extractMainContent(html);
    const text = normalizeText(mainHtml);
    const rawText = mainHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // ── Vérifier les patterns regex ──
    for (const pattern of allPatterns) {
      // Reset le regex (flag g)
      pattern.regex.lastIndex = 0;
      const matches = rawText.match(pattern.regex);
      if (matches && matches.length > 0) {
        // Extraire un contexte autour du match
        const firstMatch = matches[0].trim();
        const matchIndex = rawText.indexOf(firstMatch);
        const context = rawText.substring(
          Math.max(0, matchIndex - 30),
          Math.min(rawText.length, matchIndex + firstMatch.length + 30)
        ).trim();

        issues.push({
          severity: pattern.severity || 'IMPORTANT',
          id: pattern.id,
          page: p.name,
          title: `Contenu générique : ${pattern.label}`,
          detail: `${matches.length} occurrence(s) — "...${context}..."`,
        });
      }
    }

    // ── Vérifier les phrases template connues ──
    const foundSentences = [];
    for (const sentence of KNOWN_TEMPLATE_SENTENCES) {
      if (text.includes(sentence.toLowerCase())) {
        foundSentences.push(sentence);
      }
    }
    if (foundSentences.length > 0) {
      issues.push({
        severity: 'IMPORTANT',
        id: 'TEMPLATE_SENTENCE',
        page: p.name,
        title: `${foundSentences.length} phrase(s) template non personnalisée(s)`,
        detail: foundSentences.map(s => `"${s}"`).join(' | '),
      });
    }

    // ── Pages clés à vérifier spécifiquement ──
    // /tarifs : vérifier qu'il y a de vrais montants
    if (/tarif/i.test(p.name) || /tarif/i.test(p.path)) {
      // Chercher des montants réels (pas des placeholders)
      const realPrices = rawText.match(/\d+(?:[.,]\d{2})?\s*€/g) || [];
      const placeholderPrices = rawText.match(/(?:XX|xx|___)\s*€/g) || [];

      if (realPrices.length === 0 && text.length > 100) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'TARIFS_NO_PRICES',
          page: p.name,
          title: 'Page tarifs sans prix réels',
          detail: 'Aucun montant en € trouvé — page probablement pas personnalisée.',
        });
      }
      if (placeholderPrices.length > 0) {
        issues.push({
          severity: 'BLOQUANT',
          id: 'TARIFS_PLACEHOLDER_PRICES',
          page: p.name,
          title: 'Prix placeholder sur la page tarifs',
          detail: `${placeholderPrices.length} prix non rempli(s) : ${placeholderPrices.slice(0, 5).join(', ')}`,
        });
      }
    }

    // Pages compétences avocat : vérifier la personnalisation
    if (sector === 'avocat' && /competence|expertise|domaine|pratique|droit/i.test(p.name)) {
      // Chercher des signes de non-personnalisation
      const words = text.split(/\s+/);
      if (words.length > 50) {
        // Si le texte ne mentionne aucun nom propre spécifique et reste très générique
        const hasSpecificName = /(?:me\.|maître|cabinet)\s+[A-ZÀ-Ü][a-zà-ü]/.test(rawText);
        const genericPhrases = [
          'nous intervenons', 'notre cabinet', 'nos avocats',
          'nous accompagnons', 'nous défendons', 'notre équipe',
        ];
        const genericCount = genericPhrases.filter(gp => text.includes(gp)).length;

        if (genericCount >= 3 && !hasSpecificName) {
          issues.push({
            severity: 'IMPORTANT',
            id: 'COMPETENCE_TOO_GENERIC',
            page: p.name,
            title: 'Page compétences très générique',
            detail: `Texte générique sans nom de cabinet/avocat spécifique. ${genericCount}/6 phrases génériques détectées. Probablement du contenu template.`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * STRATÉGIE 2 : Comparaison avec le site modèle
 */
function checkAgainstModel(baseUrl, modelUrl, pages) {
  const issues = [];
  const domain = new URL(baseUrl).hostname;

  console.log(`   Comparaison avec le modèle : ${modelUrl}`);

  // Construire la map du contenu du site client
  const clientContent = new Map();
  for (const p of pages) {
    if (p.status && p.status >= 400) continue;
    if (p.path.endsWith('.xml')) continue;

    try {
      const html = execSync(
        `curl -sL -k --max-time 15 "${baseUrl}${p.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
      const mainHtml = extractMainContent(html);
      const text = normalizeText(mainHtml);
      if (text.length > 50) {
        clientContent.set(p.path, { text, name: p.name, wordCount: text.split(/\s+/).length });
      }
    } catch (e) { continue; }
  }

  // Crawl le site modèle (même logic que le crawler, simplifié)
  console.log(`   Crawl du modèle...`);
  const modelContent = new Map();

  let modelPages = [];
  try {
    // Tenter sitemap du modèle
    const modelSitemap = execSync(
      `curl -sL -k --max-time 15 "${modelUrl}/sitemap.xml" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 20000 }
    );
    const urlMatches = [...modelSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)];
    for (const m of urlMatches) {
      const mUrl = m[1];
      const path = mUrl.replace(modelUrl, '') || '/';
      modelPages.push(path);
    }
  } catch (e) { /* pas de sitemap */ }

  // Fallback : parser les liens de la homepage du modèle
  if (modelPages.length === 0) {
    try {
      const modelHome = execSync(
        `curl -sL -k --max-time 15 "${modelUrl}/" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
      const hrefMatches = [...modelHome.matchAll(/href="([^"]*\.htm[l]?[^"]*)"/g)];
      for (const m of hrefMatches) {
        let href = m[1];
        if (href.startsWith('http') && !href.startsWith(modelUrl)) continue;
        href = href.replace(modelUrl, '');
        if (!href.startsWith('/') && !href.startsWith('./')) href = '/' + href;
        href = href.replace('./', '/');
        if (!modelPages.includes(href)) modelPages.push(href);
      }
    } catch (e) { /* skip */ }
  }

  // Toujours inclure /
  if (!modelPages.includes('/')) modelPages.unshift('/');

  // Limiter le nombre de pages modèle
  if (modelPages.length > maxModelPages) {
    console.log(`   ${modelPages.length} pages modèle trouvées — limité à ${maxModelPages}`);
    modelPages = modelPages.slice(0, maxModelPages);
  } else {
    console.log(`   ${modelPages.length} pages modèle trouvées`);
  }

  // Récupérer le contenu du modèle (avec budget temps)
  const crawlStart = Date.now();
  for (const path of modelPages) {
    if (Date.now() - crawlStart > modelCrawlBudgetMs) {
      console.log(`   ⏱️ Budget temps modèle épuisé (${modelCrawlBudgetMs / 1000}s) — ${modelContent.size} pages récupérées`);
      break;
    }
    try {
      const html = execSync(
        `curl -sL -k --max-time 15 "${modelUrl}${path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
      const mainHtml = extractMainContent(html);
      const text = normalizeText(mainHtml);
      if (text.length > 50) {
        modelContent.set(path, { text, wordCount: text.split(/\s+/).length });
      }
    } catch (e) { continue; }
  }

  console.log(`   ${modelContent.size} pages modèle avec contenu exploitable`);

  // Comparer page par page
  let pagesCompared = 0;
  let pagesIdentical = 0;

  for (const [path, client] of clientContent) {
    const model = modelContent.get(path);
    if (!model) continue;

    pagesCompared++;
    const similarity = textSimilarity(client.text, model.text);

    if (similarity > CONTENT_THRESHOLDS.modelSimilarity) {
      pagesIdentical++;
      const percent = Math.round(similarity * 100);
      const severity = similarity > 0.90 ? 'BLOQUANT' : 'IMPORTANT';

      issues.push({
        severity,
        id: 'CONTENT_NOT_PERSONALIZED',
        page: client.name,
        title: `Contenu ${percent}% identique au modèle`,
        detail: `Page "${path}" — ${client.wordCount} mots, ${percent}% identique au modèle. Le contenu n'a probablement pas été personnalisé.`,
      });
    } else if (similarity > 0.50) {
      issues.push({
        severity: 'MINEUR',
        id: 'CONTENT_PARTIALLY_PERSONALIZED',
        page: client.name,
        title: `Contenu ${Math.round(similarity * 100)}% similaire au modèle`,
        detail: `Page "${path}" — partiellement personnalisée. Vérifier que les textes importants ont été adaptés.`,
      });
    }
  }

  // Résumé global
  if (pagesCompared > 0) {
    console.log(`   ${pagesCompared} pages comparées, ${pagesIdentical} identiques au modèle`);
    if (pagesIdentical > 0) {
      issues.push({
        severity: 'IMPORTANT',
        id: 'MODEL_COMPARISON_SUMMARY',
        title: `${pagesIdentical}/${pagesCompared} pages non personnalisées`,
        detail: `Sur ${pagesCompared} pages comparables au modèle (${modelUrl}), ${pagesIdentical} ont un contenu >70% identique. Les contenus doivent être adaptés au client.`,
      });
    }
  }

  return issues;
}

/**
 * Point d'entrée principal
 *
 * @param {string} baseUrl - URL du site client
 * @param {Array} pages - Pages avec status
 * @param {string|null} modelUrl - URL du site modèle (optionnel)
 */
export function runContentChecks(baseUrl, pages, modelUrl = null) {
  const issues = [];

  // Stratégie 1 : toujours exécutée
  console.log('   Stratégie 1 : Détection de patterns génériques...');
  const patternIssues = checkGenericPatterns(baseUrl, pages);
  issues.push(...patternIssues);
  console.log(`   → ${patternIssues.length} problème(s) de contenu générique`);

  // Stratégie 2 : seulement si URL modèle dispo
  if (modelUrl) {
    console.log('   Stratégie 2 : Comparaison avec le modèle...');
    const modelIssues = checkAgainstModel(baseUrl, modelUrl, pages);
    issues.push(...modelIssues);
    console.log(`   → ${modelIssues.length} problème(s) vs modèle`);
  } else {
    console.log('   Stratégie 2 : Pas d\'URL modèle — comparaison ignorée');
    console.log('   💡 Ajouter --model-url <url> ou configurer dans ClickUp pour activer');
  }

  return { issues };
}
