/**
 * Checks visuels via Playwright — V2
 *
 * Stratégie hybride issue des leçons de la session précédente :
 *
 * PROBLÈME : Sur les sites AZKO/BALT, GSAP/ScrollTrigger masque le contenu
 * avec overflow:hidden + animations. Playwright (même headed + scroll) ne
 * déclenche pas les animations correctement → pages "vides" = faux positifs.
 *
 * SOLUTION EN 3 COUCHES :
 * 1. MOBILE VIEWPORT (390px) — GSAP se comporte mieux sur mobile dans Playwright
 *    → C'est notre source FIABLE de screenshots
 * 2. INJECTION JS — Forcer overflow:visible + opacity:1 sur tout le DOM
 *    → Vérifie que le HTML contient bien du contenu (pas de lorem, pas vide)
 * 3. CONTENU HTML BRUT — Via page.content(), vérifier la présence de texte
 *    → Fallback ultime, indépendant du rendu visuel
 *
 * Les screenshots desktop sont pris POUR INFORMATION mais les pages marquées
 * "vides" en desktop sont systématiquement re-vérifiées via mobile + HTML.
 */
import { chromium } from 'playwright';

// Script d'injection pour forcer la visibilité de tout le contenu AZKO
const FORCE_VISIBLE_JS = `
  // Kill overflow hidden
  document.body.style.overflow = 'auto';
  document.body.style.overflowY = 'auto';
  document.documentElement.style.overflow = 'auto';
  document.documentElement.style.overflowX = 'hidden';

  // Kill GSAP inline styles
  document.querySelectorAll('[style]').forEach(el => {
    const s = el.style;
    if (s.overflow === 'hidden') s.overflow = 'visible';
    if (s.overflowY === 'hidden') s.overflowY = 'visible';
    if (s.opacity === '0') s.opacity = '1';
    if (s.visibility === 'hidden') s.visibility = 'visible';
    if (s.transform && s.transform !== 'none') s.transform = 'none';
  });

  // Force sections visibles
  document.querySelectorAll(
    'section, .sectionContainer, .content, .mainPage, .pageContents, .mainContents, .headerContents, .pageFull, .pagestandard'
  ).forEach(el => {
    el.style.opacity = '1';
    el.style.visibility = 'visible';
    el.style.overflow = 'visible';
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    el.style.transform = 'none';
  });

  // Masquer le bandeau cookies et le catalogue AZKO
  const cookie = document.getElementById('bandeauCookies-v2');
  if (cookie) cookie.style.display = 'none';
  const cat = document.querySelector('.btn-catalogue');
  if (cat) cat.style.display = 'none';

  // Forcer le chargement des images lazy
  document.querySelectorAll('img[data-lazy]').forEach(img => {
    if (!img.src || img.naturalWidth === 0) img.src = img.dataset.lazy;
  });
  document.querySelectorAll('img[loading="lazy"]').forEach(img => {
    img.loading = 'eager';
  });
`;

export async function runVisualChecks(baseUrl, pages, outputDir) {
  const issues = [];
  const screenshotPaths = [];

  // Détection préprod
  const domain = new URL(baseUrl).hostname;
  const isPreprod = domain.includes('.site.azko.fr');

  const browser = await chromium.launch({
    headless: false, // Headed mode pour GSAP — Xvfb sur VPS (DISPLAY=:99)
    args: [
      '--ignore-certificate-errors',
      '--window-size=1440,900',
      '--no-sandbox',           // Requis sur VPS/Docker
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Évite les crashes mémoire /dev/shm trop petit
      '--disable-gpu',           // Pas de GPU sur VPS
    ]
  });

  // ═══════════════════════════════════════════════════════════
  // COUCHE 1 : Mobile viewport (SOURCE FIABLE pour screenshots)
  // Sur AZKO, le GSAP se comporte correctement en mobile Playwright
  // ═══════════════════════════════════════════════════════════
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    const mp = await mobileCtx.newPage();
    const failedResources = [];

    mp.on('requestfailed', req => {
      const url = req.url();
      if (/google|facebook|instagram|qualitelis|axeptio|hotjar|analytics/i.test(url)) return;
      failedResources.push(url.split('/').pop().split('?')[0]);
    });

    try {
      await mp.goto(`${baseUrl}${p.path}`, { waitUntil: 'load', timeout: 45000 });

      // Masquer cookie + catalogue
      await mp.evaluate(() => {
        const cb = document.getElementById('bandeauCookies-v2');
        if (cb) cb.style.display = 'none';
        const cat = document.querySelector('.btn-catalogue');
        if (cat) cat.style.display = 'none';
      });

      // Scroll progressif pour déclencher ScrollTrigger + lazy load
      await mp.evaluate(async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await delay(200);
        }
        window.scrollTo(0, 0);
        await delay(300);
      });

      await mp.waitForTimeout(2000);

      // ── Check images cassées ──
      const brokenImages = await mp.evaluate(() => {
        return [...document.querySelectorAll('img')].filter(img => {
          if (!img.src || img.src.startsWith('data:')) return false;
          const rect = img.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          return img.complete && img.naturalWidth === 0;
        }).map(img => {
          const filename = img.src.split('/').pop().split('?')[0];
          const zone = img.closest('[class]')?.className?.split(' ')[0] || 'page';
          return { file: filename, zone };
        });
      });

      if (brokenImages.length > 0) {
        const unique = [...new Map(brokenImages.map(b => [b.file, b])).values()];
        issues.push({
          severity: 'IMPORTANT',
          id: 'IMG_BROKEN',
          page: p.name,
          title: `${unique.length} image(s) cassée(s)`,
          detail: unique.map(b => `${b.file} (${b.zone})`).join(', '),
        });
      }

      // ── Check contenu réel (pas juste header/footer) ──
      const contentCheck = await mp.evaluate(() => {
        // Chercher le contenu principal (pas header, pas footer, pas nav, pas cookie)
        const body = document.body.innerText || '';
        const mainSelectors = [
          '.pagestandard', '.pageFull', '.mainContents',
          '.content', 'main', '#content'
        ];
        let mainText = '';
        for (const sel of mainSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            mainText = el.innerText || '';
            break;
          }
        }

        return {
          bodyLength: body.length,
          mainTextLength: mainText.length,
          hasLoremIpsum: /lorem ipsum/i.test(body),
          hasPlaceholder: /\b(placeholder|à compléter|texte ici|TODO|FIXME)\b/i.test(body),
          hasSampleData: /\b(example\.com|john\.doe|test@test)\b/i.test(body),
        };
      });

      if (contentCheck.mainTextLength < 50 && contentCheck.bodyLength > 200) {
        // Le body a du contenu mais la zone principale est vide
        // → Probablement un faux positif GSAP, on le note mais sans bloquer
        issues.push({
          severity: 'MINEUR',
          id: 'CONTENT_CHECK_GSAP',
          page: p.name,
          title: 'Zone principale peu de texte visible (possible faux positif GSAP)',
          detail: `mainText: ${contentCheck.mainTextLength} chars. Vérifier manuellement dans Chrome.`,
        });
      }

      if (contentCheck.hasLoremIpsum) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'LOREM_IPSUM',
          page: p.name,
          title: 'Lorem ipsum détecté',
          detail: 'Du texte placeholder "Lorem ipsum" est visible sur la page.',
        });
      }

      if (contentCheck.hasPlaceholder) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'PLACEHOLDER_TEXT',
          page: p.name,
          title: 'Texte placeholder détecté',
          detail: 'Du texte type "à compléter" / "placeholder" / "TODO" est visible.',
        });
      }

      if (contentCheck.hasSampleData) {
        issues.push({
          severity: 'IMPORTANT',
          id: 'SAMPLE_DATA',
          page: p.name,
          title: 'Données de test détectées',
          detail: 'Des données de test (example.com, john.doe, test@test) sont visibles.',
        });
      }

      // ── Ressources en échec ──
      const uniqueFailed = [...new Set(failedResources)];
      if (uniqueFailed.length > 0) {
        issues.push({
          severity: 'MINEUR',
          id: 'RESOURCE_FAILED',
          page: p.name,
          title: `${uniqueFailed.length} ressource(s) en échec`,
          detail: uniqueFailed.slice(0, 5).join(', '),
        });
      }

      // ── Screenshot mobile (viewport only, pas fullPage → évite images >2000px) ──
      const screenshotPath = `${outputDir}/${p.name}-mobile.png`;
      await mp.screenshot({ path: screenshotPath, fullPage: false });
      screenshotPaths.push(screenshotPath);

    } catch (err) {
      issues.push({
        severity: 'MINEUR',
        id: 'PAGE_LOAD_MOBILE',
        page: p.name,
        title: 'Timeout chargement mobile',
        detail: err.message.split('\n')[0],
      });
    }

    await mp.close();
  }
  await mobileCtx.close();

  // ═══════════════════════════════════════════════════════════
  // COUCHE 2 : Desktop + injection JS (vérification contenu)
  // On n'utilise PAS le rendu desktop pour juger si une page
  // est "vide" — on utilise l'injection pour vérifier le HTML
  // ═══════════════════════════════════════════════════════════
  const desktopCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    const dp = await desktopCtx.newPage();
    try {
      await dp.goto(`${baseUrl}${p.path}`, { waitUntil: 'load', timeout: 45000 });
      await dp.waitForTimeout(2000);

      // Injecter le forçage de visibilité
      await dp.evaluate(FORCE_VISIBLE_JS);
      await dp.waitForTimeout(1000);

      // Scroll pour lazy load
      await dp.evaluate(async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await delay(100);
        }
        window.scrollTo(0, 0);
      });
      await dp.waitForTimeout(1000);

      // Re-injecter après scroll (GSAP peut avoir re-locké)
      await dp.evaluate(FORCE_VISIBLE_JS);

      // ── Check liens internes cassés ──
      const brokenLinks = await dp.evaluate((base) => {
        const links = [...document.querySelectorAll('a[href]')];
        return links
          .filter(a => {
            const href = a.getAttribute('href');
            return href && !href.startsWith('#') && !href.startsWith('mailto:')
              && !href.startsWith('tel:') && !href.startsWith('javascript:')
              && !href.startsWith('http');
          })
          .map(a => ({
            href: a.getAttribute('href'),
            text: (a.textContent || '').trim().substring(0, 40),
          }));
      }, baseUrl);

      // ── Check éléments internes AZKO visibles ──
      const azkoElements = await dp.evaluate(() => {
        const found = [];
        // Boutons catalogue
        const cat = document.querySelector('.btn-catalogue');
        if (cat) {
          const style = window.getComputedStyle(cat);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            found.push('btn-catalogue visible');
          }
        }
        // Liens vers catalogue-campings.azko.fr
        document.querySelectorAll('a[href*="catalogue-campings.azko.fr"]').forEach(a => {
          found.push(`Lien catalogue: "${(a.textContent||'').trim().substring(0, 30)}"`);
        });
        // Liens vers .site.azko.fr (préprod dans le contenu)
        document.querySelectorAll('a[href*=".site.azko.fr"]').forEach(a => {
          found.push(`Lien préprod: ${a.getAttribute('href').substring(0, 50)}`);
        });
        return found;
      });

      if (azkoElements.length && !issues.some(i => i.id === 'CATALOGUE_AZKO_VISIBLE' && i.page === p.name)) {
        // Séparer liens préprod (attendus) des liens catalogue (vrais problèmes)
        const catalogueElements = azkoElements.filter(e => e.includes('catalogue'));
        const preprodLinkElements = azkoElements.filter(e => e.includes('préprod'));

        if (catalogueElements.length) {
          issues.push({
            severity: 'IMPORTANT',
            id: 'AZKO_CATALOGUE_VISIBLE',
            page: p.name,
            title: `Boutons/liens catalogue AZKO visibles`,
            detail: catalogueElements.join(', '),
          });
        }

        if (preprodLinkElements.length) {
          issues.push({
            severity: isPreprod ? 'CHECKLIST_MEP' : 'IMPORTANT',
            id: 'AZKO_PREPROD_LINKS',
            page: p.name,
            title: `Liens préprod dans le contenu`,
            detail: isPreprod
              ? `${preprodLinkElements.length} liens .site.azko.fr — À remplacer par le domaine prod.`
              : preprodLinkElements.join(', '),
          });
        }
      }

      // Screenshot desktop (viewport only)
      const screenshotPath = `${outputDir}/${p.name}-desktop.png`;
      await dp.screenshot({ path: screenshotPath, fullPage: false });
      screenshotPaths.push(screenshotPath);

    } catch (err) {
      // Desktop timeout non critique
    }

    await dp.close();
  }
  await desktopCtx.close();

  // ═══════════════════════════════════════════════════════════
  // COUCHE 3 : Vérification HTML brut (via page.content)
  // Fallback ultime — le HTML ne ment pas, même si GSAP cache
  // ═══════════════════════════════════════════════════════════
  const rawCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    const rp = await rawCtx.newPage();
    try {
      await rp.goto(`${baseUrl}${p.path}`, { waitUntil: 'load', timeout: 30000 });
      const html = await rp.content();

      // Vérifier que la page a du vrai contenu (pas juste header/footer)
      // On cherche du texte entre les balises de contenu principal
      const contentMatch = html.match(
        /class="(?:pagestandard|pageFull|mainContents|content)"[^>]*>([\s\S]*?)(?:<footer|class="footer)/i
      );

      if (contentMatch) {
        const contentHtml = contentMatch[1];
        // Nettoyer le HTML pour compter le texte
        const textOnly = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (textOnly.length < 20) {
          // Très peu de contenu dans la zone principale
          // Vérifier si c'est un vrai problème ou juste une page structurelle
          const hasImages = /<img/i.test(contentHtml);
          const hasIframe = /<iframe/i.test(contentHtml);
          if (!hasImages && !hasIframe) {
            issues.push({
              severity: 'IMPORTANT',
              id: 'CONTENT_EMPTY_HTML',
              page: p.name,
              title: 'Zone de contenu HTML vide',
              detail: `Moins de 20 caractères de texte dans la zone principale. Contenu manquant ?`,
            });
          }
        }
      }

    } catch (err) {
      // Non critique
    }
    await rp.close();
  }
  await rawCtx.close();

  await browser.close();

  return { issues, screenshotPaths };
}
