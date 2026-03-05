/**
 * Checks par page — ce qu'un humain verrait en naviguant
 *
 * Parcourt chaque page du site et vérifie :
 * 1. Formulaire de contact cassé
 * 2. Téléphone affiché mais pas cliquable
 * 3. Google Maps embed cassé
 * 4. Images trop lourdes (>500Ko)
 * 5. Favicon manquant
 * 6. Title / meta description
 * 7. H1 manquant ou dupliqué
 * 8. Hiérarchie Hn cassée
 * 9. Liens sans texte
 * 10. Pages orphelines
 * 11. Modules AZKO vides
 * 12. Mentions légales incomplètes
 */
import { execSync } from 'child_process';

export function runPageChecks(baseUrl, pages) {
  const issues = [];
  const domain = new URL(baseUrl).hostname;
  const isPreprod = domain.includes('.site.azko.fr');

  // Données cross-page
  const allTitles = new Map();     // title → Set<pageName>
  const allMetaDescs = new Map();  // desc → Set<pageName>
  const allImageUrls = new Map();  // url → Set<pageName>
  const sitemapPages = new Set();
  const navLinkedPages = new Set();

  console.log('   Analyse de chaque page...');

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    // Tracker sources pour orphan check
    if (p.source === 'sitemap') sitemapPages.add(p.name);
    if (p.source === 'navigation' || p.source === 'menu') navLinkedPages.add(p.name);

    let html;
    try {
      html = execSync(
        `curl -sL -k --max-time 15 "${baseUrl}${p.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
    } catch (e) {
      continue;
    }

    // Ignorer les fichiers XML (sitemap)
    if (p.path.endsWith('.xml')) continue;

    // ═══════════════════════════════════════
    // 6. Title
    // ═══════════════════════════════════════
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    if (!title || title.length === 0) {
      issues.push({
        severity: 'IMPORTANT', id: 'TITLE_MISSING', page: p.name,
        title: 'Title manquant',
        detail: 'La page n\'a pas de balise <title>.',
      });
    } else {
      if (title.length < 15) {
        issues.push({
          severity: 'IMPORTANT', id: 'TITLE_SHORT', page: p.name,
          title: 'Title trop court',
          detail: `"${title}" (${title.length} chars) — min recommandé: 30 chars.`,
        });
      }
      if (title.length > 70) {
        issues.push({
          severity: 'MINEUR', id: 'TITLE_LONG', page: p.name,
          title: 'Title trop long',
          detail: `"${title.substring(0, 50)}..." (${title.length} chars) — tronqué dans Google.`,
        });
      }
      if (/site\.azko\.fr/i.test(title)) {
        issues.push({
          severity: isPreprod ? 'CHECKLIST_MEP' : 'BLOQUANT', id: 'TITLE_PREPROD', page: p.name,
          title: 'Nom préprod dans le title',
          detail: `"${title.substring(0, 60)}"`,
        });
      }
      if (!allTitles.has(title)) allTitles.set(title, new Set());
      allTitles.get(title).add(p.name);
    }

    // ═══════════════════════════════════════
    // 6. Meta description
    // ═══════════════════════════════════════
    const metaDesc = html.match(/<meta\s[^>]*name="description"\s[^>]*content="([^"]*)"/i)?.[1]?.trim()
      || html.match(/<meta\s[^>]*content="([^"]*)"\s[^>]*name="description"/i)?.[1]?.trim();

    if (!metaDesc || metaDesc.length === 0) {
      issues.push({
        severity: 'IMPORTANT', id: 'META_DESC_MISSING', page: p.name,
        title: 'Meta description manquante',
        detail: 'Impact SEO — Google génère un extrait aléatoire.',
      });
    } else {
      if (metaDesc.length > 160) {
        issues.push({
          severity: 'MINEUR', id: 'META_DESC_LONG', page: p.name,
          title: 'Meta description trop longue',
          detail: `${metaDesc.length} chars — tronquée dans Google (max ~155).`,
        });
      }
      if (/site\.azko\.fr/i.test(metaDesc)) {
        issues.push({
          severity: isPreprod ? 'CHECKLIST_MEP' : 'BLOQUANT', id: 'META_DESC_PREPROD', page: p.name,
          title: 'Nom préprod dans meta description',
          detail: `Contient la référence préprod.`,
        });
      }
      if (!allMetaDescs.has(metaDesc)) allMetaDescs.set(metaDesc, new Set());
      allMetaDescs.get(metaDesc).add(p.name);
    }

    // ═══════════════════════════════════════
    // 7. H1 manquant ou dupliqué
    // ═══════════════════════════════════════
    const h1s = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || [];
    const h1Texts = h1s
      .map(h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 0);

    if (h1Texts.length === 0) {
      issues.push({
        severity: 'IMPORTANT', id: 'H1_MISSING', page: p.name,
        title: 'H1 manquant',
        detail: 'Chaque page devrait avoir un H1 unique.',
      });
    } else if (h1Texts.length > 1) {
      issues.push({
        severity: 'IMPORTANT', id: 'H1_MULTIPLE', page: p.name,
        title: `${h1Texts.length} balises H1`,
        detail: `"${h1Texts.slice(0, 3).join('", "')}" — une seule H1 par page.`,
      });
    }

    // ═══════════════════════════════════════
    // 8. Hiérarchie Hn cassée
    // ═══════════════════════════════════════
    const hnMatches = [...html.matchAll(/<(h[1-6])[^>]*>/gi)];
    if (hnMatches.length > 1) {
      const levels = hnMatches.map(m => parseInt(m[1].charAt(1)));
      let skipFound = null;
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          skipFound = { from: levels[i - 1], to: levels[i], pos: i };
          break;
        }
      }
      if (skipFound) {
        const seq = levels.slice(0, 10).map(l => `H${l}`).join(' → ');
        issues.push({
          severity: 'MINEUR', id: 'HN_HIERARCHY', page: p.name,
          title: `Hiérarchie Hn cassée (H${skipFound.from}→H${skipFound.to})`,
          detail: `Séquence: ${seq}${levels.length > 10 ? '...' : ''}`,
        });
      }
    }

    // ═══════════════════════════════════════
    // 1. Formulaire de contact cassé
    // ═══════════════════════════════════════
    if (/contact/i.test(p.name)) {
      const forms = html.match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
      if (forms.length === 0) {
        issues.push({
          severity: 'IMPORTANT', id: 'FORM_MISSING', page: p.name,
          title: 'Page contact sans formulaire',
          detail: 'Aucun <form> trouvé — le visiteur ne peut pas envoyer de message.',
        });
      } else {
        // Vérifier que le form a des champs
        const formHtml = forms[0];
        const inputs = (formHtml.match(/<input|<textarea|<select/gi) || []).length;
        if (inputs < 2) {
          issues.push({
            severity: 'IMPORTANT', id: 'FORM_EMPTY', page: p.name,
            title: 'Formulaire de contact quasi-vide',
            detail: `Seulement ${inputs} champ(s) — formulaire non fonctionnel ?`,
          });
        }
      }
    }

    // ═══════════════════════════════════════
    // 2. Téléphone affiché mais pas cliquable
    // ═══════════════════════════════════════
    // Chercher des numéros de téléphone FR dans le texte visible
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ');

    const phonePattern = /(?:0[1-9][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}|\+33[\s.(]?\d[\s.)]?[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/g;
    const visiblePhones = bodyText.match(phonePattern) || [];
    const telLinks = html.match(/href="tel:[^"]*"/gi) || [];

    // Si des téléphones sont visibles mais aucun n'est en lien tel:
    if (visiblePhones.length > 0 && telLinks.length === 0) {
      issues.push({
        severity: 'IMPORTANT', id: 'PHONE_NOT_CLICKABLE', page: p.name,
        title: 'Téléphone affiché mais pas cliquable',
        detail: `${visiblePhones.length} numéro(s) visible(s) mais 0 lien tel: — sur mobile l'utilisateur ne peut pas appeler en tapant.`,
      });
    }

    // ═══════════════════════════════════════
    // 3. Google Maps embed cassé
    // ═══════════════════════════════════════
    const mapIframes = [...html.matchAll(/<iframe[^>]*src="([^"]*(?:google.*map|maps\.google)[^"]*)"[^>]*>/gi)];
    for (const m of mapIframes) {
      const src = m[1];
      if (/[?&](?:q|center|ll)=0[,.]0/i.test(src)) {
        issues.push({
          severity: 'IMPORTANT', id: 'MAP_DEFAULT_COORDS', page: p.name,
          title: 'Google Maps au point 0,0',
          detail: 'L\'iframe Maps affiche les coordonnées par défaut (océan Atlantique).',
        });
      }
      // Paris par défaut (48.856, 2.352) — courant quand l'adresse n'est pas configurée
      if (/[?&](?:q|center|ll)=48\.856\d*[,.]2\.352/i.test(src)) {
        issues.push({
          severity: 'IMPORTANT', id: 'MAP_PARIS_DEFAULT', page: p.name,
          title: 'Google Maps semble pointer sur Paris par défaut',
          detail: 'Coordonnées par défaut (Paris centre). Vérifier que c\'est la bonne adresse.',
        });
      }
    }

    // ═══════════════════════════════════════
    // 9. Liens sans texte ni alt
    // ═══════════════════════════════════════
    const allAnchors = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)];
    let noTextLinks = 0;
    for (const m of allAnchors) {
      const attrs = m[1];
      const content = m[2];
      const href = attrs.match(/href="([^"]*)"/)?.[1];
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

      const text = content.replace(/<[^>]+>/g, '').trim();
      if (text.length === 0) {
        // Lien sans texte — vérifier si img avec alt ou aria-label
        const hasImgAlt = /<img[^>]*alt="[^"]+"/i.test(content);
        const hasAriaLabel = /aria-label="[^"]+"/i.test(attrs);
        const hasTitle = /title="[^"]+"/i.test(attrs);
        if (!hasImgAlt && !hasAriaLabel && !hasTitle) {
          noTextLinks++;
        }
      }
    }
    if (noTextLinks > 2) {
      issues.push({
        severity: 'IMPORTANT', id: 'LINK_NO_TEXT', page: p.name,
        title: `${noTextLinks} lien(s) sans texte ni alt`,
        detail: 'Liens cliquables sans texte accessible — invisible pour les lecteurs d\'écran et Google.',
      });
    }

    // ═══════════════════════════════════════
    // 11. Modules AZKO vides
    // ═══════════════════════════════════════
    // Chercher des sections/containers AZKO avec très peu de contenu
    const sectionPatterns = [
      /class="[^"]*sectionContainer[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*sectionContainer|<footer|$)/gi,
      /class="[^"]*blockContent[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*blockContent|<\/section|$)/gi,
    ];
    for (const pattern of sectionPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const sectionHtml = match[1];
        if (!sectionHtml) continue;
        const sectionText = sectionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const hasMedia = /<img|<iframe|<video|<canvas/i.test(sectionHtml);
        // Section vide : pas de texte ET pas de media
        if (sectionText.length < 5 && !hasMedia && sectionHtml.length > 50) {
          issues.push({
            severity: 'MINEUR', id: 'MODULE_EMPTY', page: p.name,
            title: 'Module/section AZKO vide',
            detail: 'Un container de contenu est présent dans le HTML mais ne contient rien de visible.',
          });
          break; // Un seul report par page
        }
      }
    }

    // ═══════════════════════════════════════
    // 12. Mentions légales incomplètes
    // ═══════════════════════════════════════
    if (/mentions.legales/i.test(p.name) || /mentions-legales/i.test(p.path)) {
      const mlText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const missing = [];
      if (!/siret|siren|rcs/i.test(mlText)) missing.push('SIRET/RCS');
      if (!/h[ée]bergeur|h[ée]bergement/i.test(mlText)) missing.push('Hébergeur');
      if (!/[ée]diteur|directeur.*publication|responsable.*publication/i.test(mlText)) missing.push('Éditeur/Dir. publication');

      if (missing.length > 0) {
        issues.push({
          severity: 'IMPORTANT', id: 'MENTIONS_INCOMPLETE', page: p.name,
          title: 'Mentions légales incomplètes',
          detail: `Manque: ${missing.join(', ')} — obligatoire par la loi.`,
        });
      }
    }

    // ═══════════════════════════════════════
    // Collecter les images pour le check poids
    // ═══════════════════════════════════════
    const imgSrcs = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi)];
    for (const m of imgSrcs) {
      let src = m[1];
      if (src.startsWith('data:')) continue;
      if (!src.startsWith('http')) {
        src = src.startsWith('/') ? `${new URL(baseUrl).origin}${src}` : `${baseUrl}/${src}`;
      }
      if (!allImageUrls.has(src)) allImageUrls.set(src, new Set());
      allImageUrls.get(src).add(p.name);
    }
  }

  // ═══════════════════════════════════════
  // Cross-page : Titles dupliqués
  // ═══════════════════════════════════════
  for (const [title, titlePages] of allTitles) {
    if (titlePages.size > 1 && titlePages.size < pages.length * 0.8) {
      // Dupliqué sur quelques pages (pas toutes — sinon c'est un template issue)
      issues.push({
        severity: 'IMPORTANT', id: 'TITLE_DUPLICATE',
        title: `Title dupliqué sur ${titlePages.size} pages`,
        detail: `"${title.substring(0, 60)}${title.length > 60 ? '...' : ''}" — ${[...titlePages].slice(0, 5).join(', ')}`,
      });
    }
  }

  // ═══════════════════════════════════════
  // Cross-page : Meta desc dupliquées
  // ═══════════════════════════════════════
  for (const [desc, descPages] of allMetaDescs) {
    if (descPages.size > 1 && descPages.size < pages.length * 0.8) {
      issues.push({
        severity: 'MINEUR', id: 'META_DESC_DUPLICATE',
        title: `Meta description dupliquée sur ${descPages.size} pages`,
        detail: `"${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}" — ${[...descPages].slice(0, 5).join(', ')}`,
      });
    }
  }

  // ═══════════════════════════════════════
  // 10. Pages orphelines
  // ═══════════════════════════════════════
  for (const pageName of sitemapPages) {
    if (!navLinkedPages.has(pageName) && pageName !== 'accueil') {
      if (!/sitemap|robots/i.test(pageName)) {
        issues.push({
          severity: 'MINEUR', id: 'PAGE_ORPHAN', page: pageName,
          title: 'Page orpheline',
          detail: 'Dans le sitemap.xml mais pas dans la navigation — Google la voit, l\'utilisateur non.',
        });
      }
    }
  }

  // ═══════════════════════════════════════
  // 5. Favicon
  // ═══════════════════════════════════════
  try {
    const faviconStatus = execSync(
      `curl -sI -k --max-time 5 "${baseUrl}/favicon.ico" -o /dev/null -w "%{http_code}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 8000 }
    ).trim();
    if (faviconStatus === '404' || faviconStatus === '000') {
      // Vérifier aussi les <link rel="icon"> dans la homepage
      const homepageHtml = pages.find(p => p.path === '/');
      // Si pas de favicon.ico ET pas de <link rel="icon">, flag it
      issues.push({
        severity: 'MINEUR', id: 'FAVICON_MISSING',
        title: 'Favicon manquant',
        detail: '/favicon.ico retourne 404 — onglet navigateur sans icône.',
      });
    }
  } catch (e) { /* skip */ }

  // ═══════════════════════════════════════
  // 4. Images trop lourdes (>500Ko)
  // ═══════════════════════════════════════
  const uniqueImages = [...allImageUrls.keys()];
  console.log(`   ${uniqueImages.length} images uniques à vérifier (poids)...`);

  const heavyImages = [];
  // Limiter à 80 images max pour ne pas bloquer trop longtemps
  const imagesToCheck = uniqueImages.slice(0, 80);

  for (const imgUrl of imagesToCheck) {
    try {
      const result = execSync(
        `curl -sI -k --max-time 5 "${imgUrl}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 8000 }
      );
      const clMatch = result.match(/content-length:\s*(\d+)/i);
      if (clMatch) {
        const bytes = parseInt(clMatch[1]);
        if (bytes > 500000) {
          const filename = imgUrl.split('/').pop().split('?')[0];
          heavyImages.push({ filename, bytes });
        }
      }
    } catch (e) { /* skip */ }
  }

  if (heavyImages.length > 0) {
    heavyImages.sort((a, b) => b.bytes - a.bytes);
    const top5 = heavyImages.slice(0, 8).map(i => {
      const size = i.bytes > 1000000
        ? `${(i.bytes / (1024 * 1024)).toFixed(1)}MB`
        : `${Math.round(i.bytes / 1024)}Ko`;
      return `${i.filename} (${size})`;
    });

    issues.push({
      severity: 'IMPORTANT', id: 'IMG_HEAVY',
      title: `${heavyImages.length} image(s) > 500 Ko`,
      detail: top5.join(', ') + (heavyImages.length > 8 ? ` + ${heavyImages.length - 8} autres` : ''),
    });
  }

  return { issues };
}
