/**
 * Checks de liens — comme un humain qui clique partout
 *
 * Parcourt TOUTES les pages crawlées, extrait TOUS les <a href>,
 * déduplique (header/footer = mêmes liens x28 pages), puis teste.
 *
 * 3 couches :
 * 1. Analyse HTML (0 requête) → ancres vides, javascript:, tel: mal formaté, mailto: vide
 * 2. Liens internes (HEAD) → 404, redirections, ancres vers ID inexistant
 * 3. Liens externes (HEAD, optionnel) → liens morts vers sites tiers
 */
import { execSync } from 'child_process';
import { DIRTY_URL_PATTERNS, SOCIAL_DOMAINS, SOCIAL_BLACKLIST_PATTERNS } from './config.mjs';

/**
 * Extrait tous les liens d'une page HTML
 */
function extractLinks(html, pageUrl) {
  const links = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1].trim();
    const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    links.push({ href, text: text.substring(0, 60), sourcePage: pageUrl });
  }

  return links;
}

/**
 * Classe un lien par type
 */
function classifyLink(href) {
  if (!href || href === '') return 'empty';
  if (href === '#') return 'anchor_empty';
  if (href.startsWith('#')) return 'anchor';
  if (href.startsWith('javascript:')) return 'javascript';
  if (href.startsWith('mailto:')) return 'mailto';
  if (href.startsWith('tel:')) return 'tel';
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) return 'external';
  return 'internal';
}

/**
 * Valide le format d'un lien tel:
 */
function validateTel(href) {
  const num = href.replace('tel:', '').trim();
  const issues = [];

  if (!num) {
    issues.push('Lien tel: vide');
    return issues;
  }

  // Espaces dans le tel: (navigateurs gèrent mais pas propre)
  if (/\s/.test(num)) {
    issues.push(`tel: avec espaces: "${num}" → utiliser tel:+33XXXXXXXXX`);
  }

  // Parenthèses
  if (/[()]/.test(num)) {
    issues.push(`tel: avec parenthèses: "${num}" → utiliser format international simple`);
  }

  // Format 0X XX XX XX XX (format local, pas international)
  if (/^0\d/.test(num.replace(/\s/g, ''))) {
    issues.push(`tel: en format local: "${num}" → préférer +33...`);
  }

  return issues;
}

/**
 * Valide le format d'un lien mailto:
 */
function validateMailto(href) {
  const email = href.replace('mailto:', '').split('?')[0].trim();

  if (!email) return 'Lien mailto: vide (pas d\'adresse email)';
  if (!email.includes('@')) return `mailto: invalide: "${email}"`;
  if (email.includes(' ')) return `mailto: avec espaces: "${email}"`;

  return null;
}

export function runLinkChecks(baseUrl, pages, siteContext = {}) {
  const issues = [];
  const domain = new URL(baseUrl).hostname;
  const isPreprod = domain.includes('.site.azko.fr');

  // ═══════════════════════════════════════
  // Collecter tous les liens de toutes les pages
  // ═══════════════════════════════════════
  const allLinks = [];     // Tous les liens bruts
  const linksByPage = {};  // Pour savoir d'où vient chaque lien

  console.log('   Extraction des liens...');

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    try {
      const html = execSync(
        `curl -sL -k --max-time 15 "${baseUrl}${p.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 20000 }
      );
      const links = extractLinks(html, p.name);
      linksByPage[p.name] = links;

      for (const link of links) {
        allLinks.push({ ...link, page: p.name });
      }
    } catch (e) {
      // Page inaccessible, déjà reporté par le crawler
    }
  }

  console.log(`   ${allLinks.length} liens bruts trouvés`);

  // ═══════════════════════════════════════
  // Dédupliquer par href (header/footer = mêmes liens x N pages)
  // ═══════════════════════════════════════
  const uniqueLinks = new Map(); // href → { link, pages: Set }

  for (const link of allLinks) {
    const key = link.href;
    if (!uniqueLinks.has(key)) {
      uniqueLinks.set(key, { link, pages: new Set() });
    }
    uniqueLinks.get(key).pages.add(link.page);
  }

  console.log(`   ${uniqueLinks.size} liens uniques après dédup`);

  // ═══════════════════════════════════════
  // COUCHE 1 : Analyse HTML (0 requête)
  // ═══════════════════════════════════════
  const emptyAnchors = [];
  const jsLinks = [];
  const telIssues = [];
  const mailtoIssues = [];

  for (const [href, { link, pages: linkPages }] of uniqueLinks) {
    const type = classifyLink(href);
    const pageCount = linkPages.size;
    const scope = pageCount >= Math.max(2, Math.floor(pages.length * 0.4)) ? 'template' : null;
    const pageLabel = scope ? `template — ${pageCount} pages` : [...linkPages].slice(0, 3).join(', ');

    switch (type) {
      case 'empty':
        emptyAnchors.push({ href, text: link.text, pageLabel, scope });
        break;

      case 'anchor_empty':
        // href="#" — souvent un JS handler, on le note seulement si le texte suggère un vrai lien
        if (link.text && !/menu|nav|toggle|burger|fermer|close/i.test(link.text)) {
          emptyAnchors.push({ href: '#', text: link.text, pageLabel, scope });
        }
        break;

      case 'javascript':
        if (!/void\(0\)|;$/.test(href) || (link.text && link.text.length > 2)) {
          jsLinks.push({ href, text: link.text, pageLabel, scope });
        }
        break;

      case 'tel': {
        const telProblems = validateTel(href);
        if (telProblems.length) {
          telIssues.push({ problems: telProblems, text: link.text, pageLabel, scope });
        }
        break;
      }

      case 'mailto': {
        const mailProblem = validateMailto(href);
        if (mailProblem) {
          mailtoIssues.push({ problem: mailProblem, text: link.text, pageLabel, scope });
        }
        break;
      }
    }
  }

  // Reporter les ancres vides
  if (emptyAnchors.length > 0) {
    const templateOnes = emptyAnchors.filter(a => a.scope === 'template');
    const pageOnes = emptyAnchors.filter(a => !a.scope);

    if (templateOnes.length) {
      issues.push({
        severity: 'MINEUR',
        id: 'LINK_EMPTY_ANCHOR',
        scope: 'template',
        title: `${templateOnes.length} lien(s) avec ancre vide (template — toutes les pages)`,
        detail: templateOnes.map(a => `"${a.text || '(vide)'}" → href="${a.href}"`).slice(0, 5).join(', '),
      });
    }
    if (pageOnes.length) {
      issues.push({
        severity: 'MINEUR',
        id: 'LINK_EMPTY_ANCHOR',
        title: `${pageOnes.length} lien(s) avec ancre vide`,
        detail: pageOnes.map(a => `"${a.text || '(vide)'}" → href="${a.href}" (${a.pageLabel})`).slice(0, 5).join(', '),
      });
    }
  }

  // Reporter javascript: links
  if (jsLinks.length > 0) {
    issues.push({
      severity: 'MINEUR',
      id: 'LINK_JAVASCRIPT',
      title: `${jsLinks.length} lien(s) javascript:`,
      detail: jsLinks.map(l => `"${l.text || '(vide)'}" (${l.pageLabel})`).slice(0, 5).join(', '),
    });
  }

  // Reporter tel: mal formaté
  for (const t of telIssues) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'LINK_TEL_FORMAT',
      title: 'Lien tel: mal formaté',
      detail: t.problems.join(' | ') + ` — texte: "${t.text}" (${t.pageLabel})`,
      scope: t.scope,
    });
  }

  // Reporter mailto: invalide — regrouper par même problème
  const mailtoByProblem = {};
  for (const m of mailtoIssues) {
    const key = `${m.problem}::${m.text}`;
    if (!mailtoByProblem[key]) {
      mailtoByProblem[key] = { ...m, count: 1, allPages: [m.pageLabel] };
    } else {
      mailtoByProblem[key].count++;
      mailtoByProblem[key].allPages.push(m.pageLabel);
    }
  }
  for (const group of Object.values(mailtoByProblem)) {
    const pageInfo = group.count > 1 ? `${group.count} pages` : group.pageLabel;
    issues.push({
      severity: 'IMPORTANT',
      id: 'LINK_MAILTO_INVALID',
      title: 'Lien mailto: invalide',
      detail: `${group.problem} — texte: "${group.text}" (${pageInfo})`,
      scope: group.scope,
    });
  }

  // ═══════════════════════════════════════
  // COUCHE 2 : Liens internes (HEAD)
  // ═══════════════════════════════════════
  console.log('   Test des liens internes...');

  const internalLinks = new Map();
  for (const [href, data] of uniqueLinks) {
    const type = classifyLink(href);
    if (type !== 'internal') continue;

    // Résoudre le chemin relatif
    let fullPath = href;
    if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
    // Retirer les ancres pour le test HTTP
    const pathOnly = fullPath.split('#')[0].split('?')[0];
    const anchor = fullPath.includes('#') ? fullPath.split('#')[1] : null;

    if (!internalLinks.has(pathOnly)) {
      internalLinks.set(pathOnly, { anchor, pages: data.pages, text: data.link.text, originalHref: href });
    }
  }

  console.log(`   ${internalLinks.size} liens internes uniques à tester`);
  let internal404 = 0;
  let internalRedirects = 0;

  for (const [path, data] of internalLinks) {
    try {
      // HEAD avec -w pour status + redirect URL
      const result = execSync(
        `curl -sI -k -L --max-time 8 -w "\\n%{http_code} %{url_effective}" "${baseUrl}${path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 12000 }
      );

      const lines = result.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const statusMatch = lastLine.match(/^(\d{3})\s+(.+)/);
      const finalStatus = statusMatch ? parseInt(statusMatch[1]) : 0;
      const finalUrl = statusMatch ? statusMatch[2] : '';

      const pageCount = data.pages.size;
      const scope = pageCount >= Math.max(2, Math.floor(pages.length * 0.4)) ? 'template' : null;
      const pageLabel = scope ? `template — ${pageCount} pages` : [...data.pages].slice(0, 3).join(', ');

      if (finalStatus >= 400) {
        internal404++;
        issues.push({
          severity: 'IMPORTANT',
          id: 'LINK_INTERNAL_BROKEN',
          title: `Lien interne cassé → ${finalStatus}`,
          detail: `"${data.text || '(vide)'}" → ${path} (HTTP ${finalStatus}) — (${pageLabel})`,
          scope,
        });
      } else if (finalStatus >= 300 && finalStatus < 400) {
        // Normalement curl -L suit les redirections, mais si on arrive ici c'est une boucle
        internalRedirects++;
        issues.push({
          severity: 'MINEUR',
          id: 'LINK_INTERNAL_REDIRECT_LOOP',
          title: `Lien interne en boucle de redirection`,
          detail: `"${data.text || '(vide)'}" → ${path} (HTTP ${finalStatus}) — (${pageLabel})`,
          scope,
        });
      } else {
        // 200 OK mais vérifions si l'URL finale est différente (redirection)
        const expectedUrl = `${baseUrl}${path}`;
        if (finalUrl && finalUrl !== expectedUrl && finalUrl !== expectedUrl + '/' && !finalUrl.includes(path)) {
          // Ignorer les redirections triviales ./ → / (pattern AZKO standard)
          const cleanPath = path.replace(/^\.\//, '/').replace(/\/\.\//, '/');
          const cleanFinal = finalUrl.replace(baseUrl, '');
          if (cleanPath === cleanFinal || cleanPath === cleanFinal + '/' || cleanFinal === cleanPath + '/') {
            // Redirection triviale ./ → /, on ignore
          } else {
            internalRedirects++;
            issues.push({
              severity: 'MINEUR',
              id: 'LINK_INTERNAL_REDIRECT',
              title: `Lien interne redirigé`,
              detail: `"${data.text || '(vide)'}" → ${path} redirige vers ${cleanFinal} — (${pageLabel})`,
              scope,
            });
          }
        }
      }
    } catch (e) {
      // Timeout ou erreur réseau
    }
  }

  console.log(`   ${internal404} cassés, ${internalRedirects} redirigés`);

  // ═══════════════════════════════════════
  // COUCHE 3 : Liens externes (HEAD)
  // ═══════════════════════════════════════
  console.log('   Test des liens externes...');

  const externalLinks = new Map();
  for (const [href, data] of uniqueLinks) {
    const type = classifyLink(href);
    if (type !== 'external') continue;

    // Ignorer les liens de tracking, partage social (changent tout le temps)
    if (/google-analytics|googletagmanager|facebook\.com\/sharer|twitter\.com\/share|x\.com\/share|linkedin\.com\/share|pinterest\.com\/pin/i.test(href)) continue;

    // Ignorer les liens préprod internes (déjà couvert par tech-checks)
    if (isPreprod && href.includes('.site.azko.fr')) continue;

    // Normaliser
    let url = href;
    if (url.startsWith('//')) url = 'https:' + url;

    if (!externalLinks.has(url)) {
      externalLinks.set(url, { pages: data.pages, text: data.link.text });
    }
  }

  console.log(`   ${externalLinks.size} liens externes uniques à tester`);
  let external404 = 0;

  for (const [url, data] of externalLinks) {
    try {
      const status = execSync(
        `curl -sI -k -L --max-time 8 -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 12000 }
      ).trim();

      const code = parseInt(status);
      const pageCount = data.pages.size;
      const scope = pageCount >= Math.max(2, Math.floor(pages.length * 0.4)) ? 'template' : null;
      const pageLabel = scope ? `template — ${pageCount} pages` : [...data.pages].slice(0, 3).join(', ');

      if (code >= 400 || code === 0) {
        external404++;
        // Extraire le domaine pour le titre
        let extDomain;
        try { extDomain = new URL(url).hostname; } catch { extDomain = url; }

        issues.push({
          severity: 'IMPORTANT',
          id: 'LINK_EXTERNAL_BROKEN',
          title: `Lien externe cassé → ${extDomain} (${code})`,
          detail: `"${data.text || '(vide)'}" → ${url.substring(0, 80)} (HTTP ${code}) — (${pageLabel})`,
          scope,
        });
      }
    } catch (e) {
      // Timeout — pas critique, le site tiers peut être lent
    }
  }

  console.log(`   ${external404} liens externes cassés`);

  // ═══════════════════════════════════════
  // COUCHE 4 : URL propres (analyse statique)
  //   Config : DIRTY_URL_PATTERNS dans config.mjs
  // ═══════════════════════════════════════
  const dirtyUrls = [];
  for (const [href] of uniqueLinks) {
    const type = classifyLink(href);
    if (type !== 'internal') continue;

    for (const dp of DIRTY_URL_PATTERNS) {
      if (dp.regex.test(href)) {
        dirtyUrls.push({ href, label: dp.label });
        break;
      }
    }
  }

  if (dirtyUrls.length > 0) {
    const examples = dirtyUrls.slice(0, 5).map(d => d.href.substring(0, 60));
    issues.push({
      severity: 'MINEUR',
      id: 'URL_DIRTY',
      title: `${dirtyUrls.length} URL(s) interne(s) non SEO-friendly`,
      detail: `Exemples : ${examples.join(', ')}. `
        + 'Les URLs avec paramètres (?id=, &p=) sont moins bien indexées.',
    });
  }

  // ═══════════════════════════════════════
  // COUCHE 5 : Liens réseaux sociaux
  //   Config : SOCIAL_DOMAINS, SOCIAL_BLACKLIST_PATTERNS dans config.mjs
  // ═══════════════════════════════════════
  const socialLinks = [];
  for (const [href, data] of uniqueLinks) {
    for (const sd of SOCIAL_DOMAINS) {
      if (href.includes(sd.domain)) {
        socialLinks.push({ href, name: sd.name, text: data.link.text, pages: data.pages });
        break;
      }
    }
  }

  for (const sl of socialLinks) {
    // Vérifier si c'est un profil AZKO/Septeo par défaut
    const isBlacklisted = SOCIAL_BLACKLIST_PATTERNS.some(p => p.test(sl.href));
    if (isBlacklisted) {
      issues.push({
        severity: 'IMPORTANT',
        id: 'SOCIAL_LINK_DEFAULT',
        title: `Lien ${sl.name} pointe vers un profil AZKO/Septeo`,
        detail: `${sl.href.substring(0, 80)} — remplacer par le profil du client.`,
      });
      continue;
    }

    // Tester que le lien est valide (HEAD) + cross-client
    try {
      // Récupérer le contenu de la page profil (pas juste HEAD) pour cross-check
      const curlResult = execSync(
        `curl -s -k -L --max-time 10 -w "\\n%{http_code}" "${sl.href}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 15000, maxBuffer: 512 * 1024 }
      );

      const lines = curlResult.split('\n');
      const code = parseInt(lines[lines.length - 1]) || 0;
      const body = lines.slice(0, -1).join('\n');

      // Facebook/Instagram retournent souvent 302 aux bots — accepter 200, 301, 302
      if (code >= 400 || code === 0) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'SOCIAL_LINK_BROKEN',
          title: `Lien ${sl.name} cassé (HTTP ${code})`,
          detail: `${sl.href.substring(0, 80)} — vérifier le lien.`,
        });
      } else if (siteContext.title && body.length > 100) {
        // Cross-client check : le profil correspond-il au site ?
        const crossCheck = checkSocialProfileMatch(sl, body, siteContext);
        if (crossCheck) {
          issues.push(crossCheck);
        }
      }
    } catch (e) {
      // Timeout — pas critique
    }
  }

  return { issues };
}

/**
 * Vérifie que le profil social correspond bien au site client.
 * Compare le nom/bio du profil avec le titre du site (ClickUp).
 * Détecte les cas cross-client (ex: profil notaire sur un site camping).
 */
function checkSocialProfileMatch(socialLink, profileHtml, siteContext) {
  const siteTitle = siteContext.title?.toLowerCase() || '';
  const siteSector = siteContext.sector?.toLowerCase() || '';
  if (!siteTitle || siteTitle.length < 3) return null;

  // Extraire le nom du profil depuis les meta tags
  const ogTitle = profileHtml.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1]
    || profileHtml.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i)?.[1]
    || '';
  const pageTitle = profileHtml.match(/<title[^>]*>([^<]+)</i)?.[1] || '';
  const ogDesc = profileHtml.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1]
    || profileHtml.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i)?.[1]
    || '';

  const profileText = `${ogTitle} ${pageTitle} ${ogDesc}`.toLowerCase();
  if (profileText.length < 10) return null; // Pas assez de contenu pour juger

  // Extraire les mots-clés significatifs du titre du site (>3 chars)
  const siteWords = siteTitle
    .replace(/[^a-zà-ÿ0-9\s]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 3);

  // Compter combien de mots du titre site apparaissent dans le profil
  const matchCount = siteWords.filter(w => profileText.includes(w)).length;
  const matchRatio = siteWords.length > 0 ? matchCount / siteWords.length : 0;

  // Si moins de 20% de correspondance, c'est suspect
  if (matchRatio < 0.2 && siteWords.length >= 2) {
    // Vérification supplémentaire : le profil mentionne-t-il un autre secteur ?
    const otherSectors = ['notaire', 'avocat', 'camping', 'hotel', 'hôtel', 'restaurant', 'cabinet'];
    const profileSector = otherSectors.find(s => profileText.includes(s));
    const mismatch = profileSector && siteSector && !siteSector.includes(profileSector);

    return {
      severity: mismatch ? 'BLOQUANT' : 'IMPORTANT',
      id: 'SOCIAL_CROSS_CLIENT',
      title: `Profil ${socialLink.name} ne correspond pas au site`,
      detail: `Le profil "${ogTitle || pageTitle}" ne semble pas correspondre à "${siteContext.title}". `
        + (mismatch ? `Secteur détecté sur le profil : ${profileSector} ≠ ${siteSector}. ` : '')
        + `Vérifier que le bon compte est lié. URL: ${socialLink.href.substring(0, 80)}`,
    };
  }

  return null;
}
