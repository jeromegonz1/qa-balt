/**
 * Crawler de pages AZKO
 * Découvre toutes les pages d'un site en parsant la navigation + sitemap
 */
import { execSync } from 'child_process';

export function crawlSite(baseUrl) {
  const pages = new Map();

  // 1. Tenter le sitemap
  try {
    const sitemap = execSync(
      `curl -sL -k --max-time 15 "${baseUrl}/sitemap.xml" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 20000 }
    );
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
    const html = execSync(
      `curl -sL -k --max-time 20 "${baseUrl}/" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 25000 }
    );

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
    try {
      const status = execSync(
        `curl -sL -k --max-time 10 -o /dev/null -w "%{http_code}" "${baseUrl}${p.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 15000 }
      ).trim();
      results.push({ ...p, status: parseInt(status) });
    } catch (e) {
      results.push({ ...p, status: 0, error: 'timeout' });
    }
  }

  return results;
}
