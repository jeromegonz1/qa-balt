/**
 * Générateur de rapport QA en Markdown — V3
 *
 * Améliorations V3 :
 * - Groupement intelligent par ID (plus de répétition)
 * - Structure par catégorie (TECHNIQUE, SEO, ACCESSIBILITE, UX, CONTENU, CMS)
 * - Synthèse sévérité en haut + détail par catégorie
 * - BLOQUANTS et CHECKLIST MEP restent en sections dédiées
 */
import { readFileSync } from 'fs';

// ═══════════════════════════════════════
// Catégorisation des issues par ID
// ═══════════════════════════════════════
const CATEGORY_RULES = [
  // ACCESSIBILITE — axe-core + labels formulaire
  { match: /^A11Y_/, category: 'ACCESSIBILITE' },
  { match: /^FORM_LABEL/, category: 'ACCESSIBILITE' },

  // UX — rendu visuel, responsive, interaction
  { match: /^OVERFLOW/, category: 'UX' },
  { match: /^FONT_TOO_SMALL$/, category: 'UX' },
  { match: /^HEADER_TOO_TALL$/, category: 'UX' },
  { match: /^HERO_TOO_TALL$/, category: 'UX' },
  { match: /^IMG_DISTORTED$/, category: 'UX' },
  { match: /^IMG_BROKEN$/, category: 'UX' },
  { match: /^BURGER_/, category: 'UX' },
  { match: /^PAGE_LOAD/, category: 'UX' },
  { match: /^RESOURCE_FAILED$/, category: 'UX' },

  // CONTENU — texte, données, contenu générique
  { match: /^LOREM/, category: 'CONTENU' },
  { match: /^PLACEHOLDER/, category: 'CONTENU' },
  { match: /^SAMPLE_DATA/, category: 'CONTENU' },
  { match: /^CONTENT_/, category: 'CONTENU' },
  { match: /^BLACKLISTED_NAME/, category: 'CONTENU' },
  { match: /^GENERIC_/, category: 'CONTENU' },
  { match: /^CONTENT_CHECK/, category: 'CONTENU' },

  // CMS — spécifique AZKO/BALT
  { match: /^EMAIL_BLACKLISTED/, category: 'CMS' },
  { match: /^EMAIL_NOT_CLICKABLE/, category: 'CMS' },
  { match: /^AZKO_/, category: 'CMS' },
  { match: /^CATALOGUE/, category: 'CMS' },
  { match: /^FAX_/, category: 'CMS' },
  { match: /^GMAP_/, category: 'CMS' },
  { match: /^LOGO_/, category: 'CMS' },
  { match: /^SOCIAL_/, category: 'CMS' },
  { match: /^DEFAULT_PAGE/, category: 'CMS' },
  { match: /^PREPROD/, category: 'CMS' },
  { match: /^BOOKING_/, category: 'CMS' },

  // SEO — référencement, meta, liens, images, performance
  { match: /^TITLE_/, category: 'SEO' },
  { match: /^META_DESC/, category: 'SEO' },
  { match: /^H1_/, category: 'SEO' },
  { match: /^HN_/, category: 'SEO' },
  { match: /^ALT_/, category: 'SEO' },
  { match: /^IMG_HEAVY/, category: 'SEO' },
  { match: /^IMG_NO_DIM/, category: 'SEO' },
  { match: /^IMG_NOT_WEBP/, category: 'SEO' },
  { match: /^FAVICON/, category: 'SEO' },
  { match: /^DUPLICATE/, category: 'SEO' },
  { match: /^ORPHAN/, category: 'SEO' },
  { match: /^OG_/, category: 'SEO' },
  { match: /^SCHEMA_/, category: 'SEO' },
  { match: /^LINK_/, category: 'SEO' },
  { match: /^URL_DIRTY/, category: 'SEO' },
  { match: /^CANONICAL/, category: 'SEO' },
  { match: /^PERF_/, category: 'SEO' },

  // TECHNIQUE — tout le reste (SSL, headers, robots, sitemap...)
  { match: /.*/, category: 'TECHNIQUE' },
];

const CATEGORY_LABELS = {
  TECHNIQUE: 'TECHNIQUE',
  SEO: 'SEO',
  ACCESSIBILITE: 'ACCESSIBILITÉ',
  UX: 'UX / RESPONSIVE',
  CONTENU: 'CONTENU',
  CMS: 'CMS / AZKO',
};

const CATEGORY_ORDER = ['TECHNIQUE', 'SEO', 'UX', 'ACCESSIBILITE', 'CONTENU', 'CMS'];

function categorize(issueId) {
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(issueId)) return rule.category;
  }
  return 'TECHNIQUE';
}

// ═══════════════════════════════════════
// Groupement intelligent des issues
// ═══════════════════════════════════════
function groupIssues(allIssues, totalPages) {
  const groups = new Map();

  for (const issue of allIssues) {
    const id = issue.id;
    if (!groups.has(id)) {
      groups.set(id, {
        severity: issue.severity,
        id,
        category: categorize(id),
        baseTitle: issue.title,
        pages: new Set(),
        details: [],
      });
    }
    const group = groups.get(id);
    if (issue.page) group.pages.add(issue.page);
    if (issue.detail) group.details.push(issue.detail);

    // Promouvoir la sévérité au max
    const order = ['MINEUR', 'CHECKLIST_MEP', 'IMPORTANT', 'BLOQUANT'];
    if (order.indexOf(issue.severity) > order.indexOf(group.severity)) {
      group.severity = issue.severity;
    }
  }

  const templateThreshold = Math.max(2, Math.floor(totalPages * 0.4));
  const result = [];

  for (const [, group] of groups) {
    const count = Math.max(1, group.pages.size || 1);
    const isTemplate = group.pages.size >= templateThreshold;
    const uniqueDetails = [...new Set(group.details)];

    // Titre groupé
    let title = group.baseTitle;
    if (count > 1) {
      title = `${group.baseTitle} (${isTemplate ? 'template — ' : ''}${count} pages)`;
    }

    // Détail groupé : exemples + liste de pages
    let detail = '';
    if (uniqueDetails.length <= 3) {
      detail = uniqueDetails.join('\n  ');
    } else {
      detail = uniqueDetails.slice(0, 3).join('\n  ') + `\n  … et ${uniqueDetails.length - 3} autres`;
    }

    // Ajouter la liste de pages si groupé (et pas trop long)
    if (count > 1 && count <= 10 && !isTemplate) {
      detail += `\n  Pages : ${[...group.pages].join(', ')}`;
    }

    result.push({
      severity: group.severity,
      id: group.id,
      category: group.category,
      title,
      detail,
      count,
      scope: isTemplate ? 'template' : null,
      pages: [...group.pages],
    });
  }

  return result;
}

// ═══════════════════════════════════════
// Rendu Markdown par catégorie
// ═══════════════════════════════════════
function renderCategorySection(category, issues) {
  if (issues.length === 0) return '';

  const label = CATEGORY_LABELS[category] || category;
  const importants = issues.filter(i => i.severity === 'IMPORTANT');
  const mineurs = issues.filter(i => i.severity === 'MINEUR');

  let md = `\n### ${label}`;
  const counts = [];
  if (importants.length) counts.push(`${importants.length} important${importants.length > 1 ? 's' : ''}`);
  if (mineurs.length) counts.push(`${mineurs.length} mineur${mineurs.length > 1 ? 's' : ''}`);
  if (counts.length) md += ` (${counts.join(', ')})`;
  md += '\n\n';

  for (const issue of [...importants, ...mineurs]) {
    const badge = issue.severity === 'IMPORTANT' ? '⚠️' : 'ℹ️';
    md += `${badge} **${issue.title}**\n`;
    if (issue.detail) {
      md += `  ${issue.detail.split('\n').join('\n  ')}\n`;
    }
    md += '\n';
  }

  return md;
}

// ═══════════════════════════════════════
// Générateur de rapport
// ═══════════════════════════════════════
export { groupIssues, categorize, CATEGORY_RULES, CATEGORY_LABELS, CATEGORY_ORDER };

export function generateReport(siteUrl, { techIssues, linkIssues = [], pageIssues = [], contentIssues = [], techInfo, visualIssues, a11yIssues = [], perfIssues = [], pages, screenshotPaths, siteContext = {} }) {
  const rawIssues = [...techIssues, ...linkIssues, ...pageIssues, ...contentIssues, ...visualIssues, ...a11yIssues, ...perfIssues];
  const allIssues = groupIssues(rawIssues, pages.length);

  const domain = new URL(siteUrl).hostname;
  const siteName = siteContext.title || domain.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const bloquants = allIssues.filter(i => i.severity === 'BLOQUANT');
  const checklistMep = allIssues.filter(i => i.severity === 'CHECKLIST_MEP');
  const importants = allIssues.filter(i => i.severity === 'IMPORTANT');
  const mineurs = allIssues.filter(i => i.severity === 'MINEUR');

  const rawCount = rawIssues.length;
  const groupedCount = allIssues.length;

  // ─── Header ───
  const ref = siteContext.modelRef;
  let md = `# QA Pre-Prod — ${siteName}\n\n`;
  md += `**URL** : ${siteUrl}\n`;
  if (siteContext.model) {
    md += ref?.demoUrl
      ? `**Modèle** : ${ref.name} ([démo](${ref.demoUrl}))\n`
      : `**Modèle** : ${siteContext.model}\n`;
  }
  if (siteContext.sector) md += `**Secteur** : ${siteContext.sector}\n`;
  if (siteContext.existingUrl) md += `**Site existant** : ${siteContext.existingUrl}\n`;
  if (ref?.languages?.length) md += `**Langues attendues** : ${ref.languages.map(l => l.toUpperCase()).join(', ')}\n`;
  if (ref?.modules?.length) md += `**Modules attendus** : ${ref.modules.join(', ')}\n`;
  md += `**Date** : ${date}\n`;
  md += `**Pages analysées** : ${pages.length}\n`;
  md += `**Méthode** : Analyse code source (curl) + Playwright Chrome + axe-core + SE Ranking\n`;

  md += `\n---\n\n## SYNTHÈSE\n\n`;
  md += `| Sévérité | Nombre |\n|----------|--------|\n`;
  md += `| 🔴 BLOQUANT | ${bloquants.length} |\n`;
  md += `| 🟡 CHECKLIST MEP | ${checklistMep.length} |\n`;
  md += `| 🟠 IMPORTANT | ${importants.length} |\n`;
  md += `| 🔵 MINEUR | ${mineurs.length} |\n`;
  md += `| **TOTAL** | **${groupedCount}** |\n\n`;
  md += `> ${rawCount} problèmes bruts → **${groupedCount} après groupement**\n\n`;
  md += `**Infos techniques** :\n`;
  md += `- Serveur : ${techInfo.server || 'non détecté'}\n`;
  md += `- robots.txt : ${techInfo.robotsTxt || 'non vérifié'}\n`;
  md += `- sitemap.xml : ${techInfo.sitemap || 'non vérifié'}\n`;

  md += `\n---\n`;

  // ─── BLOQUANTS (toujours en premier, hors catégories) ───
  if (bloquants.length) {
    md += `\n## 🔴 BLOQUANTS — À corriger avant mise en prod\n\n`;
    bloquants.forEach((issue, i) => {
      md += `### ${i + 1}. ${issue.title}\n`;
      if (issue.detail) md += `${issue.detail}\n`;
      md += '\n';
    });
    md += `---\n`;
  }

  // ─── CHECKLIST MEP ───
  if (checklistMep.length) {
    md += `\n## 🟡 CHECKLIST MEP — À vérifier au go-live\n\n`;
    md += `> Ces points sont **normaux en préprod** mais doivent être corrigés avant le passage en production.\n\n`;
    checklistMep.forEach((issue) => {
      md += `- [ ] **${issue.title}**\n`;
      if (issue.detail) md += `  ${issue.detail}\n`;
      md += '\n';
    });
    md += `---\n`;
  }

  // ─── PAR CATÉGORIE (IMPORTANT + MINEUR) ───
  const nonBloquants = allIssues.filter(i => i.severity !== 'BLOQUANT' && i.severity !== 'CHECKLIST_MEP');

  if (nonBloquants.length) {
    md += `\n## DÉTAIL PAR CATÉGORIE\n`;

    for (const cat of CATEGORY_ORDER) {
      const catIssues = nonBloquants.filter(i => i.category === cat);
      md += renderCategorySection(cat, catIssues);
    }

    md += `---\n`;
  }

  // ─── Résumé par page ───
  md += `\n## PAGES ANALYSÉES\n\n`;
  md += `| Page | Status | Problèmes |\n`;
  md += `|------|--------|-----------|\n`;
  for (const p of pages) {
    const pageIssuesList = allIssues.filter(i => i.pages.includes(p.name));
    const statusIcon = (p.status >= 200 && p.status < 400) ? '✅' : '❌';
    const count = pageIssuesList.length;
    md += `| ${p.name} | ${statusIcon} ${p.status} | ${count || '—'} |\n`;
  }

  // ─── Priorités d'action ───
  md += `\n---\n\n## PRIORITÉS D'ACTION\n\n`;

  if (bloquants.length) {
    md += `### 🔴 Avant mise en prod\n`;
    bloquants.forEach((issue, i) => {
      md += `${i + 1}. **${issue.title}**\n`;
    });
    md += '\n';
  }

  if (checklistMep.length) {
    md += `### 🟡 Checklist go-live\n`;
    checklistMep.forEach((issue, i) => {
      md += `${i + 1}. ${issue.title}\n`;
    });
    md += '\n';
  }

  if (importants.length) {
    md += `### 🟠 Rapidement après\n`;
    // Grouper par catégorie dans les priorités aussi
    for (const cat of CATEGORY_ORDER) {
      const catImportants = importants.filter(i => i.category === cat);
      if (catImportants.length === 0) continue;
      md += `**${CATEGORY_LABELS[cat]}** :\n`;
      catImportants.forEach(issue => {
        md += `- ${issue.title}\n`;
      });
    }
  }

  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  md += `\n---\n*Rapport généré automatiquement par qa-balt v${version}*\n`;

  return md;
}
