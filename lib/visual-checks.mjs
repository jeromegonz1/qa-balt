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
      '--disable-features=PrivateNetworkAccessPermissionPrompt', // Block "accéder au réseau local" popup
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
    permissions: [], // Refuser toutes les permissions (géoloc, réseau local, etc.)
  });

  // Auto-deny les dialogues de permission du navigateur (réseau local, géoloc, etc.)
  mobileCtx.on('page', page => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  });

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    const mp = await mobileCtx.newPage();
    mp.on('dialog', dialog => dialog.dismiss().catch(() => {}));
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
      // Détecte : src vide (lazy load raté), src présent mais naturalWidth=0 (404/erreur)
      const brokenImages = await mp.evaluate(() => {
        return [...document.querySelectorAll('img')].filter(img => {
          if (img.src && img.src.startsWith('data:')) return false;
          const rect = img.getBoundingClientRect();
          // Ignorer les images invisibles (0x0)
          if (rect.width === 0 && rect.height === 0) return false;
          // Image sans src mais visible = lazy load raté
          if (!img.src || img.src === window.location.href) return rect.width > 10;
          // Image avec src mais pas chargée
          return img.complete && img.naturalWidth === 0;
        }).map(img => {
          const src = img.src || '';
          const filename = src ? src.split('/').pop().split('?')[0] : '(src vide)';
          const zone = img.closest('[class]')?.className?.split(' ')[0] || 'page';
          const alt = img.alt || '';
          return { file: filename, zone, alt };
        });
      });

      if (brokenImages.length > 0) {
        const noSrc = brokenImages.filter(b => b.file === '(src vide)');
        const withSrc = brokenImages.filter(b => b.file !== '(src vide)');
        const unique = [...new Map(withSrc.map(b => [b.file, b])).values()];
        const details = [];
        if (noSrc.length > 0) {
          details.push(`${noSrc.length} image(s) sans src (lazy load raté) — alt: "${noSrc[0].alt || '(vide)'}"`);
        }
        if (unique.length > 0) {
          details.push(unique.map(b => `${b.file} (${b.zone})`).join(', '));
        }
        const total = noSrc.length + unique.length;
        issues.push({
          severity: total >= 5 ? 'BLOQUANT' : 'IMPORTANT',
          id: 'IMG_BROKEN',
          page: p.name,
          title: `${total} image(s) cassée(s)`,
          detail: details.join(' | '),
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

      // ── Sprint 2 : Débordement horizontal ──
      const overflow = await mp.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (overflow.scrollW - overflow.clientW > 2) {
        // Identifier l'élément fautif
        const faultyEl = await mp.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          for (const el of document.body.querySelectorAll('*')) {
            if (el.scrollWidth > vw + 2 || el.offsetWidth > vw + 2) {
              const tag = el.tagName.toLowerCase();
              const cls = el.className?.toString().split(' ')[0] || '';
              return `${tag}${cls ? '.' + cls : ''}`;
            }
          }
          return null;
        });
        issues.push({
          severity: 'IMPORTANT',
          id: 'OVERFLOW_HORIZONTAL',
          page: p.name,
          title: 'Débordement horizontal mobile',
          detail: `scrollWidth (${overflow.scrollW}) > viewport (${overflow.clientW})`
            + (faultyEl ? ` — élément fautif probable : ${faultyEl}` : ''),
        });
      }

      // ── Sprint 2 : Police minimale 14px ──
      const smallFonts = await mp.evaluate(() => {
        const results = [];
        const nodes = document.querySelectorAll('p, span, li, td, a, div, label');
        for (const el of nodes) {
          // Ignorer les éléments cachés
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;
          // Ignorer nav/header/footer (souvent < 14px volontairement)
          if (el.closest('nav, header, footer, .header, .footer, .nav')) continue;
          // Ignorer <small>, <sub>, <sup>
          if (el.closest('small, sub, sup')) continue;

          const size = parseFloat(style.fontSize);
          if (size === 0) continue; // Texte remplacé par icône (font 0px)
          if (size < 14 && el.textContent.trim().length > 5) {
            const tag = el.tagName.toLowerCase();
            const cls = el.className?.toString().split(' ')[0] || '';
            const text = el.textContent.trim().substring(0, 30);
            results.push({ size: Math.round(size * 10) / 10, el: `${tag}${cls ? '.' + cls : ''}`, text });
            if (results.length >= 5) break;
          }
        }
        return results;
      });

      if (smallFonts.length > 0) {
        const examples = smallFonts.slice(0, 3).map(f => `${f.el} (${f.size}px: "${f.text}")`);
        issues.push({
          severity: 'MINEUR',
          id: 'FONT_TOO_SMALL',
          page: p.name,
          title: `${smallFonts.length} élément(s) avec police < 14px`,
          detail: examples.join(', '),
        });
      }

      // ── Sprint 2 : Hauteur header < 18% ──
      const headerInfo = await mp.evaluate(() => {
        const headerEl = document.querySelector('header, .header, #header, .headerContents');
        if (!headerEl) return null;
        const headerH = headerEl.offsetHeight;
        const viewportH = window.innerHeight;
        return { headerH, viewportH, pct: Math.round((headerH / viewportH) * 100) };
      });

      if (headerInfo && headerInfo.pct > 18) {
        issues.push({
          severity: headerInfo.pct > 25 ? 'BLOQUANT' : 'IMPORTANT',
          id: 'HEADER_TOO_TALL',
          page: p.name,
          title: `Header trop haut mobile (${headerInfo.pct}%)`,
          detail: `${headerInfo.headerH}px / ${headerInfo.viewportH}px = ${headerInfo.pct}% (max 18%). `
            + 'Le contenu est poussé trop bas sur mobile.',
        });
      }

      // ── Sprint 2 : Hero pas trop haut mobile ──
      const heroInfo = await mp.evaluate(() => {
        const selectors = ['.hero', '.slider', '.diaporama', '.bannerContents',
          '.sectionContainer:first-of-type', 'section:first-of-type'];
        let heroEl = null;
        for (const sel of selectors) {
          heroEl = document.querySelector(sel);
          if (heroEl) break;
        }
        if (!heroEl) return null;
        // Ignorer si le hero contient un formulaire (cas camping réservation = normal)
        if (heroEl.querySelector('form')) return null;
        const heroH = heroEl.offsetHeight;
        const viewportH = window.innerHeight;
        return { heroH, viewportH, pct: Math.round((heroH / viewportH) * 100) };
      });

      if (heroInfo && heroInfo.pct > 90) {
        issues.push({
          severity: heroInfo.pct > 120 ? 'BLOQUANT' : 'IMPORTANT',
          id: 'HERO_TOO_TALL',
          page: p.name,
          title: `Hero trop haut mobile (${heroInfo.pct}% du viewport)`,
          detail: `${heroInfo.heroH}px / ${heroInfo.viewportH}px — le visiteur ne voit pas qu'il y a du contenu en dessous.`,
        });
      }

      // ── Sprint 2 : Images déformées ──
      const distortedImages = await mp.evaluate(() => {
        const results = [];
        for (const img of document.querySelectorAll('img')) {
          if (!img.complete || img.naturalWidth === 0) continue;
          // Ignorer les icônes (< 32px)
          if (img.offsetWidth < 32 || img.offsetHeight < 32) continue;
          // Ignorer SVG (pas de ratio naturel fixe)
          if (img.src?.endsWith('.svg')) continue;
          // Ignorer object-fit: cover/contain (déformation gérée par CSS)
          const style = window.getComputedStyle(img);
          if (style.objectFit === 'cover' || style.objectFit === 'contain') continue;

          const naturalRatio = img.naturalWidth / img.naturalHeight;
          const displayRatio = img.offsetWidth / img.offsetHeight;
          const diff = Math.abs(naturalRatio - displayRatio) / naturalRatio;

          if (diff > 0.1) { // > 10% de distorsion
            const filename = img.src.split('/').pop()?.split('?')[0] || 'image';
            results.push({
              file: filename,
              natural: `${img.naturalWidth}x${img.naturalHeight}`,
              display: `${img.offsetWidth}x${img.offsetHeight}`,
              diff: Math.round(diff * 100),
            });
            if (results.length >= 5) break;
          }
        }
        return results;
      });

      if (distortedImages.length > 0) {
        const examples = distortedImages.map(d => `${d.file} (${d.natural} → ${d.display}, ${d.diff}% distorsion)`);
        issues.push({
          severity: 'IMPORTANT',
          id: 'IMG_DISTORTED',
          page: p.name,
          title: `${distortedImages.length} image(s) déformée(s)`,
          detail: examples.join(', '),
        });
      }

      // ── Sprint 2 : Labels formulaire ──
      const missingLabels = await mp.evaluate(() => {
        const forms = document.querySelectorAll('form');
        if (forms.length === 0) return [];
        const results = [];
        const fields = document.querySelectorAll('input, select, textarea');
        for (const field of fields) {
          const type = field.getAttribute('type') || 'text';
          if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
          if (field.offsetHeight === 0) continue; // Champ caché

          const id = field.id;
          const hasLabel = id && document.querySelector(`label[for="${id}"]`);
          const hasAriaLabel = field.getAttribute('aria-label');
          const hasAriaLabelledBy = field.getAttribute('aria-labelledby');
          const hasParentLabel = field.closest('label');
          const hasPlaceholder = field.getAttribute('placeholder');

          if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasParentLabel) {
            const name = field.getAttribute('name') || field.getAttribute('id') || type;
            results.push({ name, hasPlaceholder: !!hasPlaceholder });
          }
        }
        return results;
      });

      if (missingLabels.length > 0) {
        const withoutAnything = missingLabels.filter(l => !l.hasPlaceholder);
        const placeholderOnly = missingLabels.filter(l => l.hasPlaceholder);

        if (withoutAnything.length > 0) {
          issues.push({
            severity: 'IMPORTANT',
            id: 'FORM_LABEL_MISSING',
            page: p.name,
            title: `${withoutAnything.length} champ(s) sans label ni placeholder`,
            detail: `Champs : ${withoutAnything.map(l => l.name).join(', ')}. Inaccessible aux lecteurs d'écran.`,
          });
        }
        if (placeholderOnly.length > 0) {
          issues.push({
            severity: 'MINEUR',
            id: 'FORM_LABEL_PLACEHOLDER_ONLY',
            page: p.name,
            title: `${placeholderOnly.length} champ(s) avec placeholder mais sans label`,
            detail: `Champs : ${placeholderOnly.map(l => l.name).join(', ')}. Le placeholder disparaît à la saisie.`,
          });
        }
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

  // ── Sprint 2 : Menu burger fonctionnel (homepage uniquement) ──
  const burgerCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });

  const burgerPage = await burgerCtx.newPage();
  try {
    await burgerPage.goto(baseUrl, { waitUntil: 'load', timeout: 45000 });
    await burgerPage.waitForTimeout(2000);

    // Masquer bandeau cookies
    await burgerPage.evaluate(() => {
      const cb = document.getElementById('bandeauCookies-v2');
      if (cb) cb.style.display = 'none';
    });

    // Chercher le bouton burger
    const burgerSelectors = [
      '.menuBurger', '.burger', '.hamburger', '.navToggle', '.menu-toggle',
      '.nav-toggle', '.mobile-menu-btn', '[aria-label="Menu"]',
      'button.menu', '.headerContents .btn-menu',
    ];

    let burgerBtn = null;
    for (const sel of burgerSelectors) {
      burgerBtn = await burgerPage.$(sel);
      if (burgerBtn) break;
    }

    if (!burgerBtn) {
      // Essayer un sélecteur plus large : bouton/div dans le header avec 3 barres (span)
      burgerBtn = await burgerPage.$('header button, .header button, .headerContents button');
    }

    if (burgerBtn) {
      // Vérifier que le bouton est visible
      const isVisible = await burgerBtn.isVisible();
      if (isVisible) {
        // Capturer l'état de la nav AVANT clic
        const navBeforeClick = await burgerPage.evaluate(() => {
          const navSelectors = ['nav', '.nav', '.navContents', '.menuPrincipal', '.mainNav', '#nav', '.mobile-menu'];
          for (const sel of navSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const style = window.getComputedStyle(el);
              return {
                found: true,
                visible: style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0,
                height: el.offsetHeight,
              };
            }
          }
          return { found: false };
        });

        // Cliquer le burger
        await burgerBtn.click();
        await burgerPage.waitForTimeout(800);

        // Vérifier l'état de la nav APRÈS clic
        const navAfterClick = await burgerPage.evaluate(() => {
          const navSelectors = ['nav', '.nav', '.navContents', '.menuPrincipal', '.mainNav', '#nav', '.mobile-menu'];
          for (const sel of navSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const style = window.getComputedStyle(el);
              return {
                found: true,
                visible: style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0,
                height: el.offsetHeight,
              };
            }
          }
          return { found: false };
        });

        if (navAfterClick.found && !navAfterClick.visible) {
          issues.push({
            severity: 'BLOQUANT',
            id: 'BURGER_MENU_BROKEN',
            page: 'Accueil',
            title: 'Menu burger ne fonctionne pas',
            detail: 'Le clic sur le bouton burger ne fait pas apparaître la navigation mobile. '
              + 'Le menu reste caché après interaction.',
          });
        } else if (!navAfterClick.found) {
          issues.push({
            severity: 'IMPORTANT',
            id: 'BURGER_NAV_NOT_FOUND',
            page: 'Accueil',
            title: 'Navigation mobile introuvable après clic burger',
            detail: 'Le bouton burger est cliquable mais aucun élément nav n\'a été trouvé dans le DOM.',
          });
        }
        // Si navBeforeClick.visible === false et navAfterClick.visible === true → OK, le burger fonctionne
      }
    } else {
      // Pas de bouton burger trouvé en mobile → problème
      issues.push({
        severity: 'IMPORTANT',
        id: 'BURGER_NOT_FOUND',
        page: 'Accueil',
        title: 'Pas de menu burger trouvé en mobile',
        detail: 'Aucun bouton burger/hamburger détecté dans le viewport mobile (390px). '
          + 'La navigation mobile peut être inaccessible.',
      });
    }
  } catch (err) {
    // Non critique — ne pas bloquer le rapport
  }
  await burgerPage.close();
  await burgerCtx.close();

  // ═══════════════════════════════════════════════════════════
  // COUCHE 2 : Desktop + injection JS (vérification contenu)
  // On n'utilise PAS le rendu desktop pour juger si une page
  // est "vide" — on utilise l'injection pour vérifier le HTML
  // ═══════════════════════════════════════════════════════════
  const desktopCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    permissions: [],
  });

  desktopCtx.on('page', page => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  });

  for (const p of pages) {
    if (p.status && p.status >= 400) continue;

    const dp = await desktopCtx.newPage();
    dp.on('dialog', dialog => dialog.dismiss().catch(() => {}));
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
