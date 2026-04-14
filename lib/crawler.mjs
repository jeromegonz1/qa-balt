/**
 * Crawler de pages AZKO
 * Découvre toutes les pages d'un site en parsant la navigation + sitemap
 */
import { safeCurl } from './utils.mjs';

export function crawlSite(baseUrl) {
  const pages = new Map();

  // 1. Tenter le sitemap
  try {
    const sitemap = safeCurl(`${baseUrl}/sitemap.xml`, { maxTime: 15 });
    if (!sitemap) throw new Error('sitemap fetch failed');
    const urlMatches = sitemap.matchAll(/<loc>([^<]+)<\/loc>/g);
    for (const m of urlMatches) {
      const url = m[1];
      const path = url.replace(baseUrl, '') || '/';
      const name = path.replace(/^\//, '').replace(/\.htm[l]?$/, '').replace(/\//g, '-') || 'accueil';
      pages.set(path, { name, path, source: 'sitemap' });
    }
  } catch (e) {
    // sitemap pas dispo, on continue
  }

  // 2. Parser les liens de la homepage
  try {
    const html = safeCurl(`${baseUrl}/`, { maxTime: 20 });
    if (!html) throw new Error('homepage fetch failed');

    // Extraire les liens internes .htm
    const hrefMatches = html.matchAll(/href="([^"]*\.htm[l]?[^"]*)"/g);
    for (const m of hrefMatches) {
      let href = m[1];
      // Ignorer les liens externes
      if (href.startsWith('http') && !href.startsWith(baseUrl)) continue;
      // Normaliser
      href = href.replace(baseUrl, '');
      if (!href.startsWith('/') && !href.startsWith('./')) href = '/' + href;
      href = href.replace('./', '/');

      const name = href.replace(/^\//, '').replace(/\.htm[l]?$/, '').replace(/\//g, '-') || 'accueil';

      if (!pages.has(href)) {
        pages.set(href, { name, path: href, source: 'navigation' });
      }
    }

    // Extraire les liens du menu principal (souvent en <nav> ou .navbar)
    const menuLinks = html.matchAll(/href="\.\/([^"]*\.htm[l]?)"/g);
    for (const m of menuLinks) {
      const path = '/' + m[1];
      const name = path.replace(/^\//, '').replace(/\.htm[l]?$/, '').replace(/\//g, '-');
      if (!pages.has(path)) {
        pages.set(path, { name, path, source: 'menu' });
      }
    }
  } catch (e) {
    // fallback
  }

  // 3. Toujours inclure la homepage
  if (!pages.has('/')) {
    pages.set('/', { name: 'accueil', path: '/', source: 'default' });
  }

  // Trier : accueil d'abord, puis alphabétique
  const sorted = [...pages.values()].sort((a, b) => {
    if (a.path === '/') return -1;
    if (b.path === '/') return 1;
    return a.path.localeCompare(b.path);
  });

  return sorted;
}

/**
 * Vérifie le status HTTP de chaque page
 */
export function checkPagesStatus(baseUrl, pages) {
  const results = [];

  for (const p of pages) {
    const status = safeCurl(`${baseUrl}${p.path}`, {
      maxTime: 10, outputDev: 'null', writeOut: '%{http_code}',
    });
    if (status) {
      results.push({ ...p, status: parseInt(status.trim()) });
    } else {
      results.push({ ...p, status: 0, error: 'timeout' });
    }
  }

  return results;
}
