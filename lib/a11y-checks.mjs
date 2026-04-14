/**
 * Checks accessibilité via axe-core + Playwright
 *
 * Utilise @axe-core/playwright pour auditer un échantillon de pages
 * contre WCAG 2.1 AA. Les violations sont mappées vers le système
 * de sévérité QA-BALT (BLOQUANT / IMPORTANT / MINEUR).
 *
 * Complémentaire aux checks existants (page-checks, visual-checks).
 * axe-core détecte des problèmes structurels que nos checks manuels
 * ne couvrent pas (ARIA, rôles, focus, navigation clavier, etc.).
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { A11Y } from './config.mjs';

export async function runA11yChecks(baseUrl, pages) {
  const issues = [];

  // Échantillon : homepage + pages variées (max configurable)
  const sampled = selectSample(pages, A11Y.maxPages);

  const browser = await chromium.launch({
    headless: true, // axe-core n'a pas besoin de headed (pas de GSAP concern)
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try { // try/finally pour garantir browser.close()

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // Compteur de violations par règle (pour dédup cross-pages)
  const violationsByRule = new Map();

  for (const p of sampled) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${baseUrl}${p.path}`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1500); // Laisser le DOM se stabiliser

      // Masquer bandeau cookies (peut fausser l'audit)
      await page.evaluate(() => {
        const cb = document.getElementById('bandeauCookies-v2');
        if (cb) cb.style.display = 'none';
      });

      const results = await new AxeBuilder({ page })
        .withTags(A11Y.tags)
        .disableRules(A11Y.disabledRules)
        .analyze();

      for (const violation of results.violations) {
        const severity = A11Y.severityMap[violation.impact] || 'MINEUR';
        const ruleId = violation.id;

        // Accumuler pour dédup cross-pages
        if (!violationsByRule.has(ruleId)) {
          violationsByRule.set(ruleId, {
            severity,
            id: `A11Y_${ruleId.toUpperCase().replace(/-/g, '_')}`,
            axeId: ruleId,
            title: violation.help,
            description: violation.description,
            helpUrl: violation.helpUrl,
            pages: [],
            nodes: [],
          });
        }

        const entry = violationsByRule.get(ruleId);
        entry.pages.push(p.name);

        // Garder les 5 premiers exemples de noeuds touchés
        if (entry.nodes.length < 5) {
          for (const node of violation.nodes.slice(0, 3)) {
            const target = node.target?.[0] || '';
            const html = (node.html || '').substring(0, 80);
            entry.nodes.push({ page: p.name, target, html });
          }
        }

        // Promouvoir la sévérité si une page a un impact plus grave
        const severityOrder = ['MINEUR', 'IMPORTANT', 'BLOQUANT'];
        if (severityOrder.indexOf(severity) > severityOrder.indexOf(entry.severity)) {
          entry.severity = severity;
        }
      }
    } catch (err) {
      // Page timeout — non critique pour l'audit a11y
    }
    await page.close();
  }

  await ctx.close();

  } finally {
    await browser.close();
  }

  // Convertir les violations groupées en issues QA-BALT
  for (const [, v] of violationsByRule) {
    const uniquePages = [...new Set(v.pages)];
    const examples = v.nodes.slice(0, 3)
      .map(n => `\`${n.target}\` ${n.html ? `(${n.html})` : ''}`)
      .join(' | ');

    const pageInfo = uniquePages.length >= sampled.length * 0.4
      ? `template — ${uniquePages.length} pages`
      : uniquePages.join(', ');

    issues.push({
      severity: v.severity,
      id: v.id,
      page: pageInfo,
      title: v.title,
      detail: `${v.description}. `
        + (examples ? `Exemples : ${examples}. ` : '')
        + `Règle axe-core: ${v.axeId} — ${v.helpUrl}`,
    });
  }

  // Trier par sévérité
  const order = { BLOQUANT: 0, IMPORTANT: 1, MINEUR: 2 };
  issues.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

  return { issues, pagesAudited: sampled.length };
}

/**
 * Sélectionne un échantillon représentatif de pages :
 * - Toujours la homepage
 * - Pages variées (pas juste les premières du crawl)
 */
function selectSample(pages, max) {
  const valid = pages.filter(p => !p.status || p.status < 400);
  if (valid.length <= max) return valid;

  const sample = [];
  // Homepage en premier
  const home = valid.find(p => p.path === '/' || p.path === '/accueil.htm' || p.path === '/index.htm');
  if (home) sample.push(home);

  // Répartir uniformément sur le reste
  const remaining = valid.filter(p => !sample.includes(p));
  const step = Math.max(1, Math.floor(remaining.length / (max - sample.length)));
  for (let i = 0; i < remaining.length && sample.length < max; i += step) {
    sample.push(remaining[i]);
  }

  return sample;
}
