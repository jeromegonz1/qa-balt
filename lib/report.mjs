/**
 * Générateur de rapport QA en Markdown — V2 avec déduplication
 *
 * Les issues qui apparaissent sur >50% des pages sont considérées comme
 * des problèmes de "template" (header/footer) et reportées UNE SEULE FOIS.
 */

/**
 * Déduplique les issues :
 * - Issues sans page (globales tech) → telles quelles
 * - Issues avec page qui partagent le même id+title sur >50% des pages → groupées en 1
 * - Issues avec page uniques → telles quelles (spécifiques à la page)
 */
function deduplicateIssues(allIssues, totalPages) {
  const global = [];       // Issues sans page (tech checks)
  const perPage = [];      // Issues spécifiques à une page
  const templateMap = {};  // Issues candidates au regroupement template

  for (const issue of allIssues) {
    if (!issue.page) {
      global.push(issue);
      continue;
    }

    // Clé de regroupement : même id + même titre
    const key = `${issue.id}::${issue.title}`;
    if (!templateMap[key]) {
      templateMap[key] = { issue: { ...issue }, pages: new Set(), details: new Set() };
    }
    templateMap[key].pages.add(issue.page);
    if (issue.detail) templateMap[key].details.add(issue.detail);
  }

  const threshold = Math.max(2, Math.floor(totalPages * 0.4)); // 40% des pages ou min 2

  for (const [key, group] of Object.entries(templateMap)) {
    if (group.pages.size >= threshold) {
      // C'est un problème template → reporter une seule fois
      const mergedIssue = {
        ...group.issue,
        page: null,
        scope: 'template',
        title: `${group.issue.title} (template — ${group.pages.size} pages)`,
        detail: group.details.size <= 3
          ? [...group.details].join(' | ')
          : [...group.details].values().next().value, // Premier detail seulement
      };
      global.push(mergedIssue);
    } else {
      // Spécifique à quelques pages → garder per-page
      for (const pageName of group.pages) {
        perPage.push({
          ...group.issue,
          page: pageName,
        });
      }
    }
  }

  return [...global, ...perPage];
}

export function generateReport(siteUrl, { techIssues, linkIssues = [], pageIssues = [], contentIssues = [], techInfo, visualIssues, a11yIssues = [], perfIssues = [], pages, screenshotPaths }) {
  const rawIssues = [...techIssues, ...linkIssues, ...pageIssues, ...contentIssues, ...visualIssues, ...a11yIssues, ...perfIssues];
  const allIssues = deduplicateIssues(rawIssues, pages.length);

  const domain = new URL(siteUrl).hostname;
  const siteName = domain.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const bloquants = allIssues.filter(i => i.severity === 'BLOQUANT');
  const checklistMep = allIssues.filter(i => i.severity === 'CHECKLIST_MEP');
  const importants = allIssues.filter(i => i.severity === 'IMPORTANT');
  const mineurs = allIssues.filter(i => i.severity === 'MINEUR');

  // Stats dédup
  const rawCount = rawIssues.length;
  const dedupCount = allIssues.length;
  const templateCount = allIssues.filter(i => i.scope === 'template').length;

  let md = `# QA Pre-Prod — ${siteName}

**URL** : ${siteUrl}
**Date** : ${date}
**Pages analysées** : ${pages.length}
**Méthode** : Analyse code source (curl) + Playwright Chrome (mobile + desktop)

---

## SYNTHESE

| Sévérité | Nombre |
|----------|--------|
| BLOQUANT | ${bloquants.length} |
| CHECKLIST MEP | ${checklistMep.length} |
| IMPORTANT | ${importants.length} |
| MINEUR | ${mineurs.length} |
| **TOTAL** | **${dedupCount}** |

> ${rawCount} problèmes bruts → **${dedupCount} après déduplication** (${templateCount} issues template regroupées)

**Infos techniques** :
- Serveur : ${techInfo.server || 'non détecté'}
- robots.txt : ${techInfo.robotsTxt || 'non vérifié'}
- sitemap.xml : ${techInfo.sitemap || 'non vérifié'}

---
`;

  // ─── Bloquants ───
  if (bloquants.length) {
    md += `\n## BLOQUANTS — A corriger avant mise en prod\n\n`;
    bloquants.forEach((issue, i) => {
      md += `### ${i + 1}. ${issue.title}`;
      if (issue.page) md += ` — page: ${issue.page}`;
      md += `\n${issue.detail}\n\n`;
    });
    md += `---\n\n`;
  }

  // ─── Checklist MEP (préprod attendus — à vérifier avant go-live) ───
  if (checklistMep.length) {
    md += `\n## CHECKLIST MEP — A vérifier lors de la mise en prod\n\n`;
    md += `> Ces points sont **normaux en préprod** mais doivent être corrigés avant le passage en production.\n\n`;
    checklistMep.forEach((issue, i) => {
      md += `- [ ] **${issue.title}**`;
      if (issue.page) md += ` — page: ${issue.page}`;
      md += `\n  ${issue.detail}\n\n`;
    });
    md += `---\n\n`;
  }

  // ─── Importants : séparés en template vs spécifiques ───
  if (importants.length) {
    const templateIssues = importants.filter(i => i.scope === 'template');
    const pageIssues = importants.filter(i => !i.scope);

    md += `\n## IMPORTANTS — Impact UX/SEO\n\n`;

    if (templateIssues.length) {
      md += `### Problèmes de template (header/footer — toutes les pages)\n\n`;
      templateIssues.forEach((issue, i) => {
        md += `${i + 1}. **${issue.title}**\n`;
        md += `   ${issue.detail}\n\n`;
      });
    }

    if (pageIssues.length) {
      md += `### Problèmes spécifiques par page\n\n`;
      pageIssues.forEach((issue, i) => {
        md += `${i + 1}. **${issue.title}**`;
        if (issue.page) md += ` — page: \`${issue.page}\``;
        md += `\n   ${issue.detail}\n\n`;
      });
    }

    md += `---\n\n`;
  }

  // ─── Mineurs ───
  if (mineurs.length) {
    const templateMineurs = mineurs.filter(i => i.scope === 'template');
    const pageMineurs = mineurs.filter(i => !i.scope);

    md += `\n## MINEURS — Nettoyage\n\n`;

    for (const issue of templateMineurs) {
      md += `- **${issue.id}** : ${issue.title} — ${issue.detail}\n`;
    }
    for (const issue of pageMineurs) {
      md += `- **${issue.id}** : ${issue.title}`;
      if (issue.page) md += ` (\`${issue.page}\`)`;
      md += ` — ${issue.detail}\n`;
    }
    md += `\n---\n\n`;
  }

  // ─── Résumé par page ───
  md += `## PAGES ANALYSEES\n\n`;
  md += `| Page | Status | Problèmes spécifiques |\n`;
  md += `|------|--------|-----------------------|\n`;
  for (const p of pages) {
    // Ne montrer que les issues spécifiques à cette page (pas template)
    const pageSpecific = allIssues.filter(i => i.page === p.name && !i.scope);
    const statusIcon = (p.status >= 200 && p.status < 400) ? '✅' : '❌';
    const issueText = pageSpecific.length
      ? pageSpecific.map(i => i.title).join(', ')
      : '—';
    md += `| ${p.name} | ${statusIcon} ${p.status} | ${issueText} |\n`;
  }

  // ─── Priorités d'action ───
  md += `\n---\n\n## PRIORITES D'ACTION\n\n`;

  if (bloquants.length) {
    md += `### Avant mise en prod (BLOQUANTS)\n`;
    bloquants.forEach((issue, i) => {
      md += `${i + 1}. **${issue.title}**\n`;
    });
  }

  if (checklistMep.length) {
    md += `\n### Checklist go-live\n`;
    checklistMep.forEach((issue, i) => {
      md += `${i + 1}. ${issue.title}\n`;
    });
  }

  if (importants.length) {
    md += `\n### Rapidement après\n`;
    const dedupImportants = importants.filter(i => i.scope === 'template');
    const specificImportants = importants.filter(i => !i.scope);

    let n = 1;
    for (const issue of dedupImportants) {
      md += `${n++}. ${issue.title}\n`;
    }
    for (const issue of specificImportants) {
      md += `${n++}. ${issue.title}`;
      if (issue.page) md += ` (\`${issue.page}\`)`;
      md += `\n`;
    }
  }

  md += `\n---\n*Rapport généré automatiquement par qa-balt v2*\n`;

  return md;
}
