/**
 * Generateur de rapport QA en HTML — Self-contained
 *
 * Meme logique que report.mjs (Markdown V3) mais en HTML standalone :
 * - 0 dependance externe (pas de CDN, pas de font web, pas de JS)
 * - CSS inline complet
 * - <details> natif pour les categories (collapsible sans JS)
 * - @media print pour impression propre
 */
import { readFileSync } from 'fs';
import { groupIssues, CATEGORY_ORDER, CATEGORY_LABELS } from './report.mjs';
import { getFixSuggestion } from './fix-suggestions.mjs';

// ─── Bookmarklet « QA Highlight » ────────────────────────────────────
// Code minifie sur une ligne pour etre installable comme favori (drag-and-drop).
// Lit ?qa_highlight=<selector encode> dans l'URL courante, scroll a l'element
// et lui applique un outline rouge + un label fixe en haut a gauche.
// Securite : selector decode mais utilise UNIQUEMENT via document.querySelector
// (pas d'eval), donc impossible d'executer du JS arbitraire. Aucun reseau.
const BOOKMARKLET_JS = "javascript:(function(){try{var u=new URL(location.href);var s=u.searchParams.get('qa_highlight');if(!s){alert('QA-BALT: param ?qa_highlight= manquant dans l URL');return}s=decodeURIComponent(s);var el;try{el=document.querySelector(s)}catch(e){alert('QA-BALT: selector invalide: '+s);return}if(!el){alert('QA-BALT: element non trouve: '+s);return}el.scrollIntoView({behavior:'smooth',block:'center'});el.style.outline='4px dashed #e11';el.style.outlineOffset='4px';var l=document.createElement('div');l.textContent='QA: '+s;l.style.cssText='position:fixed;top:10px;left:10px;background:#e11;color:#fff;padding:8px 14px;font:14px sans-serif;border-radius:4px;z-index:999999;box-shadow:0 2px 6px rgba(0,0,0,.3)';document.body.appendChild(l);setTimeout(function(){if(l.parentNode)l.parentNode.removeChild(l)},6000)}catch(e){alert('QA-BALT bookmarklet error: '+e.message)}})()";

// ── HTML escaping ──
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Severity badge HTML ──
function severityBadge(severity) {
  const map = {
    BLOQUANT: { color: '#fff', bg: '#dc3545', label: 'BLOQUANT' },
    CHECKLIST_MEP: { color: '#212529', bg: '#ffc107', label: 'CHECKLIST MEP' },
    IMPORTANT: { color: '#fff', bg: '#fd7e14', label: 'IMPORTANT' },
    MINEUR: { color: '#fff', bg: '#17a2b8', label: 'MINEUR' },
  };
  const s = map[severity] || { color: '#fff', bg: '#6c757d', label: severity };
  return `<span class="badge" style="background:${s.bg};color:${s.color}">${esc(s.label)}</span>`;
}

// ── CSS ──
const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #212529;
  background: #f8f9fa;
  padding: 0;
}
.container { max-width: 960px; margin: 0 auto; padding: 20px; }
header {
  background: #1B3A5C;
  color: #fff;
  padding: 24px 32px;
  margin-bottom: 24px;
  border-radius: 8px;
}
header h1 { font-size: 22px; margin-bottom: 8px; }
header .meta { font-size: 13px; opacity: 0.85; line-height: 1.8; }
header .meta a { color: #8ec8f8; }
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  border-left: 4px solid #6c757d;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.card .count { font-size: 28px; font-weight: 700; }
.card .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; }
.card.bloquant { border-left-color: #dc3545; }
.card.bloquant .count { color: #dc3545; }
.card.checklist { border-left-color: #ffc107; }
.card.checklist .count { color: #856404; }
.card.important { border-left-color: #fd7e14; }
.card.important .count { color: #fd7e14; }
.card.mineur { border-left-color: #17a2b8; }
.card.mineur .count { color: #17a2b8; }
section { background: #fff; border-radius: 8px; padding: 20px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
section h2 { font-size: 18px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e9ecef; }
.bloquant-section h2 { color: #dc3545; border-bottom-color: #dc3545; }
.checklist-section h2 { color: #856404; border-bottom-color: #ffc107; }
.issue { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
.issue:last-child { border-bottom: none; }
.issue .title { font-weight: 600; margin-bottom: 4px; }
.issue .detail { font-size: 13px; color: #555; white-space: pre-line; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  vertical-align: middle;
  margin-right: 6px;
}
.checklist-item { padding: 6px 0; display: flex; align-items: flex-start; gap: 8px; }
.checklist-item::before { content: "\\2610"; font-size: 16px; flex-shrink: 0; }

/* ─── Issues enrichies (Phase A) ──────────────────────────────────── */
.issue-extras { margin-top: 8px; padding: 10px 12px; background: #fafbfc; border-left: 3px solid #e9ecef; border-radius: 0 4px 4px 0; font-size: 13px; }
.issue-extras > div + div { margin-top: 8px; }
.loc-badge { display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: 600; background: #e7f1ff; color: #084298; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
.issue-selector { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: #495057; word-break: break-all; }
.issue-selector code { background: #eef2f6; padding: 1px 5px; border-radius: 3px; }
.html-snippet, .fix-example { margin-top: 4px; padding: 8px 10px; background: #2d2d2d; color: #f8f8f2; border-radius: 4px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.fix-example { background: #1e3a2a; }
.issue-fix { padding: 8px 10px; background: #e8f5e9; border-left: 3px solid #4caf50; border-radius: 0 4px 4px 0; }
.issue-fix strong { color: #2e7d32; }
.fix-hint { margin-top: 4px; font-style: italic; color: #555; }
.fix-impact { display: inline-block; margin-top: 4px; padding: 1px 6px; font-size: 11px; background: #fff3cd; color: #856404; border-radius: 3px; }
.issue-ref { display: inline-block; margin-top: 6px; font-size: 12px; color: #0066cc; text-decoration: none; }
.issue-ref:hover { text-decoration: underline; }
.issue-live { display: inline-block; margin-top: 6px; margin-left: 12px; font-size: 12px; padding: 2px 8px; background: #fff; border: 1px solid #0066cc; color: #0066cc; border-radius: 3px; text-decoration: none; }
.issue-live:hover { background: #0066cc; color: #fff; }

/* ─── Widget externe (sprint 1.c) ─────────────────────────────────── */
.widget-external { padding: 8px 12px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 0 4px 4px 0; }
.widget-badge { display: inline-block; padding: 2px 8px; background: #ffc107; color: #555; font-size: 11px; font-weight: 600; border-radius: 3px; }
.widget-name { font-size: 13px; color: #6a4f00; margin-left: 8px; }
.widget-notes { margin-top: 6px; font-size: 12px; color: #555; font-style: italic; }

/* ─── Outils (bookmarklet) ────────────────────────────────────────── */
.tools-section { background: #fff8e1; border: 1px solid #ffe082; border-radius: 8px; margin-bottom: 16px; }
.tools-section summary { padding: 12px 20px; font-weight: 600; font-size: 14px; color: #6a4f00; cursor: pointer; list-style: none; }
.tools-section summary::before { content: "\\25B6"; font-size: 10px; margin-right: 8px; transition: transform 0.2s; }
.tools-section[open] summary::before { transform: rotate(90deg); }
.tools-body { padding: 0 20px 16px; font-size: 13px; color: #555; }
.bookmarklet-btn { display: inline-block; padding: 8px 16px; background: #1B3A5C; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 600; margin: 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: grab; }
.bookmarklet-btn:hover { background: #2a5689; }
.tools-body ol { margin: 8px 0 8px 24px; }
.tools-body code { background: #fff; padding: 1px 5px; border-radius: 3px; border: 1px solid #ffe082; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }

/* ─── Galerie screenshots des pages (sprint 4-pre) ────────────────── */
.screenshots-section { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 0; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.screenshots-section summary { padding: 14px 20px; font-weight: 600; font-size: 14px; cursor: pointer; list-style: none; color: #1B3A5C; }
.screenshots-section summary::before { content: "\\25B6"; font-size: 10px; margin-right: 8px; transition: transform 0.2s; }
.screenshots-section[open] summary::before { transform: rotate(90deg); }
.screenshots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; padding: 0 20px 16px; }
.screenshot-thumb { display: block; text-decoration: none; color: #555; font-size: 11px; text-align: center; transition: transform 0.15s; }
.screenshot-thumb:hover { transform: translateY(-2px); }
.screenshot-thumb img { width: 100%; height: auto; aspect-ratio: 4/3; object-fit: cover; object-position: top; border: 1px solid #ddd; border-radius: 4px; display: block; margin-bottom: 6px; background: #f8f9fa; }
.screenshot-thumb:hover img { border-color: #1B3A5C; box-shadow: 0 4px 10px rgba(27,58,92,0.2); }
.screenshot-thumb span { display: block; word-break: break-word; line-height: 1.3; }
@media print { .screenshots-section { display: none; } }
details { margin-bottom: 8px; }
details summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 15px;
  padding: 10px 0;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
details summary::before { content: "\\25B6"; font-size: 10px; transition: transform 0.2s; }
details[open] summary::before { transform: rotate(90deg); }
details summary .cat-count { font-weight: 400; font-size: 13px; color: #6c757d; }
details .cat-body { padding: 0 0 8px 18px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #f0f0f0; text-align: left; padding: 8px 10px; font-weight: 600; }
td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
tr:nth-child(even) td { background: #fafafa; }
.status-ok { color: #28a745; }
.status-ko { color: #dc3545; }
.verdict { text-align: center; padding: 16px; font-size: 16px; font-weight: 600; border-radius: 8px; margin-bottom: 16px; }
.verdict.ko { background: #f8d7da; color: #721c24; }
.verdict.ok { background: #d4edda; color: #155724; }
footer { text-align: center; font-size: 12px; color: #999; padding: 16px 0; }
@media print {
  body { background: #fff; font-size: 12px; }
  .container { max-width: 100%; padding: 0; }
  header { border-radius: 0; }
  section { box-shadow: none; break-inside: avoid; }
  details { open: true; }
  details[open] { break-inside: avoid; }
  .summary-cards { grid-template-columns: repeat(4, 1fr); }
}
`;

/**
 * Rend les champs enrichis d'une issue (element, fix, reference) en HTML.
 * Retourne '' si aucune donnee enrichie disponible.
 *
 * Securite : toutes les valeurs passent par esc() (anti-XSS).
 * Le selector est aussi encode pour le lien live (URL safe).
 *
 * @param {Object} issue — { id, element?, reference?, ... }
 * @param {string} siteUrl — base URL pour le lien live
 * @returns {string} HTML (peut etre vide)
 */
function renderIssueExtras(issue, siteUrl) {
  if (!issue) return '';
  const parts = [];

  // ─ Widget externe (sprint 1.c) : badge avant tout pour contexte ─
  if (issue.externalWidget) {
    const { vendor, name, notes } = issue.externalWidget;
    parts.push(
      `<div class="widget-external">`
      + `<span class="widget-badge">🧩 Widget tiers : ${esc(vendor)}</span> `
      + `<span class="widget-name">${esc(name)}</span>`
      + (notes ? `<div class="widget-notes">${esc(notes)}</div>` : '')
      + `</div>`
    );
  }

  // ─ Element structure (selector + html snippet + location) ─
  if (issue.element && (issue.element.selector || issue.element.html)) {
    const { selector, html: snippet, location } = issue.element;
    const liveUrl = selector
      ? `${siteUrl}/?qa_highlight=${encodeURIComponent(selector)}`
      : null;
    parts.push(
      '<div class="issue-element">'
      + (location ? `<span class="loc-badge">📍 ${esc(location)}</span> ` : '')
      + (selector ? `<span class="issue-selector">🎯 <code>${esc(selector)}</code></span>` : '')
      + (liveUrl ? ` <a class="issue-live" href="${esc(liveUrl)}" target="_blank" rel="noopener">👁 Voir en live</a>` : '')
      + (snippet ? `<pre class="html-snippet">${esc(snippet)}</pre>` : '')
      + '</div>'
    );
  }

  // ─ Fix suggestion (lookup par ID) ─
  const fix = getFixSuggestion(issue.id);
  if (fix) {
    let fixHtml = `<div class="issue-fix"><strong>💡 Fix :</strong> ${esc(fix.text)}`;
    if (fix.example) fixHtml += `<pre class="fix-example">${esc(fix.example)}</pre>`;
    if (fix.fileHint) fixHtml += `<div class="fix-hint">🛠 Fichier probable : ${esc(fix.fileHint)}</div>`;
    if (fix.impact) fixHtml += `<span class="fix-impact">Impact : ${esc(fix.impact)}</span>`;
    fixHtml += '</div>';
    parts.push(fixHtml);
  }

  // ─ Reference (du fix sinon de l'issue) ─
  const refUrl = (fix && fix.reference) || issue.reference;
  if (refUrl) {
    parts.push(`<a class="issue-ref" href="${esc(refUrl)}" target="_blank" rel="noopener">📚 Documentation / Reference</a>`);
  }

  return parts.length ? `<div class="issue-extras">${parts.join('')}</div>` : '';
}

/**
 * Genere un rapport HTML self-contained
 *
 * @param {string} siteUrl
 * @param {Object} data - Memes donnees que generateReport()
 * @returns {string} HTML complet
 */
export function generateHtmlReport(siteUrl, { techIssues, linkIssues = [], pageIssues = [], contentIssues = [], techInfo, visualIssues, a11yIssues = [], perfIssues = [], debuglogIssues = [], pages, screenshotPaths, siteContext = {} }) {
  const rawIssues = [...techIssues, ...linkIssues, ...pageIssues, ...contentIssues, ...visualIssues, ...a11yIssues, ...perfIssues, ...debuglogIssues];
  const allIssues = groupIssues(rawIssues, pages.length);

  const domain = new URL(siteUrl).hostname;
  const siteName = siteContext.title || domain.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const bloquants = allIssues.filter(i => i.severity === 'BLOQUANT');
  const checklistMep = allIssues.filter(i => i.severity === 'CHECKLIST_MEP');
  const importants = allIssues.filter(i => i.severity === 'IMPORTANT');
  const mineurs = allIssues.filter(i => i.severity === 'MINEUR');

  const hasBloquants = bloquants.length > 0;
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

  let html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Pre-Prod — ${esc(siteName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">
`;

  // ── Header ──
  html += `<header>
<h1>QA Pre-Prod — ${esc(siteName)}</h1>
<div class="meta">
<strong>URL</strong> : <a href="${esc(siteUrl)}">${esc(siteUrl)}</a><br>
`;
  if (siteContext.model) {
    const ref = siteContext.modelRef;
    html += ref?.demoUrl
      ? `<strong>Modele</strong> : ${esc(ref.name)} (<a href="${esc(ref.demoUrl)}">demo</a>)<br>\n`
      : `<strong>Modele</strong> : ${esc(siteContext.model)}<br>\n`;
  }
  if (siteContext.sector) html += `<strong>Secteur</strong> : ${esc(siteContext.sector)}<br>\n`;
  if (siteContext.existingUrl) html += `<strong>Site existant</strong> : ${esc(siteContext.existingUrl)}<br>\n`;
  html += `<strong>Date</strong> : ${esc(date)}<br>
<strong>Pages analysees</strong> : ${pages.length}<br>
<strong>Methode</strong> : Analyse code source (curl) + Playwright Chrome + axe-core + SE Ranking
</div>
</header>
`;

  // ── Verdict ──
  if (hasBloquants) {
    html += `<div class="verdict ko">${bloquants.length} BLOQUANT(S) — Le site n'est PAS pret pour la prod.</div>\n`;
  } else {
    html += `<div class="verdict ok">Aucun bloquant — Le site peut partir en prod (${importants.length} points a ameliorer).</div>\n`;
  }

  // ── Summary cards ──
  html += `<div class="summary-cards">
<div class="card bloquant"><div class="count">${bloquants.length}</div><div class="label">Bloquants</div></div>
<div class="card checklist"><div class="count">${checklistMep.length}</div><div class="label">Checklist MEP</div></div>
<div class="card important"><div class="count">${importants.length}</div><div class="label">Importants</div></div>
<div class="card mineur"><div class="count">${mineurs.length}</div><div class="label">Mineurs</div></div>
</div>
`;

  // ── Tools (bookmarklet) ──
  // Section repliee par defaut, ne pollue pas la lecture.
  // Le href est un javascript: URL — installable en glisser-deposer dans la barre de favoris.
  html += `<details class="tools-section">
<summary>🛠 Outils QA — Installation du bookmarklet "Voir en live"</summary>
<div class="tools-body">
<p>Glissez ce bouton dans votre <strong>barre de favoris</strong> (a installer 1× seulement) :</p>
<p><a class="bookmarklet-btn" href="${esc(BOOKMARKLET_JS)}" onclick="event.preventDefault();alert('Glissez ce bouton dans votre barre de favoris (drag-and-drop). Ne pas cliquer dessus.')">🐍 QA Highlight</a></p>
<p><strong>Utilisation :</strong></p>
<ol>
<li>Cliquez sur le lien <code>👁 Voir en live</code> d'une issue dans ce rapport — la page preprod s'ouvre dans un nouvel onglet avec <code>?qa_highlight=...</code> dans l'URL.</li>
<li>Sur cette page preprod, cliquez le favori <strong>QA Highlight</strong> dans votre barre de favoris.</li>
<li>L'element concerne par l'issue est encadre en rouge, et la page scroll automatiquement pour le rendre visible.</li>
</ol>
<p style="margin-top:8px;font-size:12px;color:#666"><em>Securite : le bookmarklet lit uniquement <code>?qa_highlight=</code> de l'URL, fait <code>document.querySelector()</code> et applique un style CSS. Aucun appel reseau, aucun stockage, aucune execution de code arbitraire.</em></p>
</div>
</details>
`;

  // ── Bloquants section ──
  if (bloquants.length) {
    html += `<section class="bloquant-section">
<h2>BLOQUANTS — A corriger avant mise en prod</h2>
`;
    for (const issue of bloquants) {
      html += `<div class="issue">
<div class="title">${severityBadge('BLOQUANT')} ${esc(issue.title)}</div>
${issue.detail ? `<div class="detail">${esc(issue.detail)}</div>` : ''}
${renderIssueExtras(issue, siteUrl)}
</div>\n`;
    }
    html += `</section>\n`;
  }

  // ── Checklist MEP ──
  if (checklistMep.length) {
    html += `<section class="checklist-section">
<h2>CHECKLIST MEP — A verifier au go-live</h2>
<p style="font-size:13px;color:#666;margin-bottom:12px">Ces points sont normaux en preprod mais doivent etre corriges avant le passage en production.</p>
`;
    for (const issue of checklistMep) {
      const extras = renderIssueExtras(issue, siteUrl);
      if (extras) {
        html += `<details class="issue">
<summary><strong>${esc(issue.title)}</strong></summary>
${issue.detail ? `<div class="detail">${esc(issue.detail)}</div>` : ''}
${extras}
</details>\n`;
      } else {
        html += `<div class="checklist-item">
<div><strong>${esc(issue.title)}</strong>${issue.detail ? `<br><span style="font-size:13px;color:#555">${esc(issue.detail)}</span>` : ''}</div>
</div>\n`;
      }
    }
    html += `</section>\n`;
  }

  // ── Detail par categorie ──
  const nonBloquants = allIssues.filter(i => i.severity !== 'BLOQUANT' && i.severity !== 'CHECKLIST_MEP');

  if (nonBloquants.length) {
    html += `<section>
<h2>DETAIL PAR CATEGORIE</h2>
`;
    for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
      const cat = CATEGORY_ORDER[ci];
      const catIssues = nonBloquants.filter(i => i.category === cat);
      if (catIssues.length === 0) continue;

      const label = CATEGORY_LABELS[cat] || cat;
      const catImportants = catIssues.filter(i => i.severity === 'IMPORTANT');
      const catMineurs = catIssues.filter(i => i.severity === 'MINEUR');
      const countParts = [];
      if (catImportants.length) countParts.push(`${catImportants.length} important${catImportants.length > 1 ? 's' : ''}`);
      if (catMineurs.length) countParts.push(`${catMineurs.length} mineur${catMineurs.length > 1 ? 's' : ''}`);

      // TECHNIQUE open by default (first category with issues)
      const isFirst = ci === CATEGORY_ORDER.indexOf(cat) && cat === 'TECHNIQUE';
      html += `<details${isFirst ? ' open' : ''}>
<summary>${esc(label)} <span class="cat-count">(${countParts.join(', ')})</span></summary>
<div class="cat-body">
`;
      for (const issue of [...catImportants, ...catMineurs]) {
        const extras = renderIssueExtras(issue, siteUrl);
        if (extras) {
          html += `<details class="issue">
<summary>${severityBadge(issue.severity)} ${esc(issue.title)}</summary>
${issue.detail ? `<div class="detail">${esc(issue.detail)}</div>` : ''}
${extras}
</details>\n`;
        } else {
          html += `<div class="issue">
<div class="title">${severityBadge(issue.severity)} ${esc(issue.title)}</div>
${issue.detail ? `<div class="detail">${esc(issue.detail)}</div>` : ''}
</div>\n`;
        }
      }
      html += `</div>
</details>\n`;
    }
    html += `</section>\n`;
  }

  // ── Pages analysees ──
  html += `<section>
<h2>PAGES ANALYSEES</h2>
<table>
<thead><tr><th>Page</th><th>Status</th><th>Problemes</th></tr></thead>
<tbody>
`;
  for (const p of pages) {
    const pageIssuesList = allIssues.filter(i => i.pages.includes(p.name));
    const isOk = p.status >= 200 && p.status < 400;
    const statusClass = isOk ? 'status-ok' : 'status-ko';
    const statusIcon = isOk ? '&#10003;' : '&#10007;';
    const count = pageIssuesList.length;
    html += `<tr><td>${esc(p.name)}</td><td class="${statusClass}">${statusIcon} ${p.status}</td><td>${count || '—'}</td></tr>\n`;
  }
  html += `</tbody></table>
</section>\n`;

  // ── Priorites d'action ──
  html += `<section>
<h2>PRIORITES D'ACTION</h2>
`;
  if (bloquants.length) {
    html += `<h3 style="color:#dc3545;margin:12px 0 8px">Avant mise en prod</h3>\n<ol>\n`;
    for (const issue of bloquants) {
      html += `<li><strong>${esc(issue.title)}</strong></li>\n`;
    }
    html += `</ol>\n`;
  }
  if (checklistMep.length) {
    html += `<h3 style="color:#856404;margin:12px 0 8px">Checklist go-live</h3>\n<ol>\n`;
    for (const issue of checklistMep) {
      html += `<li>${esc(issue.title)}</li>\n`;
    }
    html += `</ol>\n`;
  }
  if (importants.length) {
    html += `<h3 style="color:#fd7e14;margin:12px 0 8px">Rapidement apres</h3>\n`;
    for (const cat of CATEGORY_ORDER) {
      const catImportants = importants.filter(i => i.category === cat);
      if (catImportants.length === 0) continue;
      html += `<p style="font-weight:600;margin:8px 0 4px">${esc(CATEGORY_LABELS[cat])}</p>\n<ul>\n`;
      for (const issue of catImportants) {
        html += `<li>${esc(issue.title)}</li>\n`;
      }
      html += `</ul>\n`;
    }
  }
  html += `</section>\n`;

  // ── Galerie screenshots des pages (sprint 4-pre) ──
  if (Array.isArray(screenshotPaths) && screenshotPaths.length > 0) {
    // Les paths sont absolus du filesystem ; on extrait dir + filename
    // pour generer les URLs /screenshots/{dir}/{file}.
    const thumbs = screenshotPaths
      .map(p => {
        const parts = p.split('/');
        const file = parts.pop();
        const dir = parts.pop();
        if (!file || !dir || !/\.png$/i.test(file)) return null;
        return { dir, file, label: file.replace(/\.png$/i, '') };
      })
      .filter(Boolean);

    if (thumbs.length > 0) {
      html += `<details class="screenshots-section">
<summary>📸 Screenshots des pages (${thumbs.length} captures)</summary>
<div class="screenshots-grid">`;
      for (const t of thumbs) {
        const url = `/screenshots/${encodeURIComponent(t.dir)}/${encodeURIComponent(t.file)}`;
        html += `<a href="${esc(url)}" target="_blank" rel="noopener" class="screenshot-thumb">`
          + `<img src="${esc(url)}" loading="lazy" alt="${esc(t.label)}">`
          + `<span>${esc(t.label)}</span>`
          + `</a>`;
      }
      html += `</div>
</details>
`;
    }
  }

  // ── Footer ──
  html += `<footer>Rapport genere automatiquement par qa-balt v${esc(version)} — ${esc(date)}</footer>
</div>
</body>
</html>
`;

  return html;
}
