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
import { classifyLocation, COLLECT_ANCESTOR_CHAIN_FN } from './element-location.mjs';
import { identifyExternalWidget, downgradeSeverity } from './external-widgets.mjs';

export async function runA11yChecks(baseUrl, pages) {
  const issues = [];

  // Échantillon : homepage + pages variées (max configurable)
  const sampled = selectSample(pages, A11Y.maxPages);

  const browser = await chromium.launch({
    headless: true, // axe-core n'a pas besoin de headed (pas de GSAP concern)
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // Compteur de violations par règle (pour dédup cross-pages)
  // Déclaré AVANT le try : utilisé après le finally pour générer les issues
  const violationsByRule = new Map();

  try { // try/finally pour garantir browser.close()

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

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
            element: null, // structuré : { selector, html, location } — rempli au 1er node
          });
        }

        const entry = violationsByRule.get(ruleId);
        entry.pages.push(p.name);

        // 1er noeud rencontré : on capture en structuré pour le rapport enrichi.
        // On évalue la location dans le DOM via Playwright (chaîne d'ancêtres).
        if (!entry.element && violation.nodes[0]) {
          const firstSelector = violation.nodes[0].target?.[0] || '';
          const firstHtml = (violation.nodes[0].html || '').substring(0, 200);
          let location = 'body';
          try {
            const chain = await page.evaluate(COLLECT_ANCESTOR_CHAIN_FN, firstSelector);
            location = classifyLocation(chain);
          } catch {
            // Si page.evaluate échoue (selector invalide, élément retiré), on garde 'body'
          }
          entry.element = { selector: firstSelector, html: firstHtml, location };
        }

        // Garder les 5 premiers exemples de noeuds touchés (texte, retro-compat detail)
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

    // Detection widget externe : si l'element appartient a un widget tiers
    // (Qualitelis, eSeason, Thelis...), on degrade la severite et on tag
    // l'issue. Justification : l'integrateur ne peut PAS corriger ces issues.
    const externalWidget = v.element ? identifyExternalWidget(v.element) : null;
    const finalSeverity = externalWidget ? downgradeSeverity(v.severity) : v.severity;
    const widgetNote = externalWidget
      ? ` ⚠️ Widget tiers détecté : ${externalWidget.vendor} (${externalWidget.name}) — hors de portée de l'intégrateur, à signaler au vendeur si récurrent.`
      : '';

    issues.push({
      severity: finalSeverity,
      id: v.id,
      page: pageInfo,
      title: v.title,
      detail: `${v.description}. `
        + (examples ? `Exemples : ${examples}. ` : '')
        + `Règle axe-core: ${v.axeId} — ${v.helpUrl}`
        + widgetNote,
      // Nouveau (Phase A) : info structurée pour rapport enrichi
      element: v.element || undefined,
      reference: v.helpUrl,
      externalWidget: externalWidget || undefined,
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
