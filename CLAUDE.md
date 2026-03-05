# QA-BALT — Instructions Claude Code

## Projet
Robot QA automatise pour sites AZKO/BALT (CMS Septeo). Node.js 22 ESM.

## Architecture
- `qa.mjs` : orchestrateur CLI (flags: --tech-only, --visual-only, --model-url)
- `server.mjs` : webhook Express ClickUp (port 3847)
- `lib/config.mjs` : configuration centralisee (seuils, blacklists, patterns — extensible)
- `lib/a11y-checks.mjs` : accessibilite axe-core (WCAG 2.1 AA, echantillon 10 pages)
- `lib/seranking-checks.mjs` : performance SE Ranking API (CWV Lighthouse, health score)
- `lib/` : 11 modules (config, crawler, tech-checks, link-checks, page-checks, content-checks, visual-checks, a11y-checks, seranking-checks, report, clickup)

## Conventions code
- ESM pur (`import`/`export`, pas de require)
- HTTP via `curl` + `execSync` (pas d'axios/fetch pour les checks)
- Playwright dans `visual-checks.mjs` (headed, GSAP) et `a11y-checks.mjs` (headless, axe-core)
- Chaque issue = `{ severity, id, title, detail, page? }`
- IDs en SCREAMING_SNAKE_CASE (ex: `SSL_EXPIRED`, `ALT_MISSING`)
- Severites : BLOQUANT, CHECKLIST_MEP, IMPORTANT, MINEUR
- Helper `preprodOrBloquant()` pour adapter la severite en preprod (.site.azko.fr)

## Ajout d'un nouveau check
1. Si configurable (seuil, blacklist, pattern) → ajouter dans `lib/config.mjs`
2. Identifier le module cible (tech-checks, page-checks, etc.)
3. Importer depuis config.mjs : `import { MA_CONFIG } from './config.mjs';`
4. Ajouter l'issue avec `issues.push({ severity, id, title, detail })`
5. Suivre le pattern existant du module
6. Tester sur `camping-les-cinq-vallees.site.azko.fr` (preprod) ou `camping-arquebuse.site.azko.fr`

## Ajout d'un nouveau module
1. Creer `lib/mon-module.mjs` avec `export function runMonModule(baseUrl, pages) { return { issues }; }`
2. Importer dans `qa.mjs`
3. Appeler dans la sequence avec le bon flag guard (!techOnly, !visualOnly)
4. Ajouter les issues dans le `generateReport()`

## Rapport V3 (report.mjs)
- Groupement intelligent : issues avec meme ID regroupees (N bruts → M groupes)
- 6 categories auto : TECHNIQUE, SEO, ACCESSIBILITE, UX, CONTENU, CMS
- CATEGORY_RULES : regex-based mapping issue ID → categorie (extensible, fallback → TECHNIQUE)
- Structure : BLOQUANTS → CHECKLIST MEP → DETAIL PAR CATEGORIE → PAGES → PRIORITES
- Template scope : >40% pages → "(template — N pages)"

## ClickUp integration (clickup.mjs)
- `extractSiteContext(task)` : extrait model, sector, title, existingUrl, phone, emails
- Gere dropdowns (type_config.options) et labels ClickUp
- siteContext passe dans pipeline : link-checks (cross-client) + report (header enrichi)
- `checkSocialProfileMatch()` dans link-checks : scrape og:title profil social, compare avec titre site

## Git workflow
- Branche `main` = prod (ce qui tourne sur le VPS)
- Feature branches : `feature/sprint-X` pour chaque sprint
- Tags : `vX.Y.Z` a chaque version
- Versioning semantique dans `package.json`

## Deploy VPS
- Remote : VPS 83.228.208.83 (alias vps-firesnake)
- Path : /home/ubuntu/qa-balt/
- Service : systemd qa-balt + Nginx reverse proxy (port 3847)
- Deploy : `git pull` + `npm install` + `sudo systemctl restart qa-balt`

## Checks visuels (visual-checks.mjs)
- COUCHE 1 mobile (390px) : screenshots fiables + 7 checks DOM Sprint 2
  - OVERFLOW_HORIZONTAL, FONT_TOO_SMALL, HEADER_TOO_TALL, HERO_TOO_TALL, IMG_DISTORTED, FORM_LABEL_MISSING, FORM_LABEL_PLACEHOLDER_ONLY
  - Menu burger : bloc separe apres la boucle (BURGER_MENU_BROKEN, BURGER_NOT_FOUND, BURGER_NAV_NOT_FOUND)
- COUCHE 2 desktop : injection JS (FORCE_VISIBLE_JS) pour contourner GSAP
- COUCHE 3 HTML brut : fallback ultime via page.content()

## Tests
- Pas de framework de test. Le robot EST un outil de test.
- Panel de sites multi-secteurs dans `config.mjs > TEST_SITES` :
  - **Camping** : camping-les-cinq-vallees, camping-municipal-hippodrome
  - **Avocat** : lc-avocats, rousselavocat, ordre-avocats-limoges
  - **Hotel** : hotel-lys-chablis
- Valider sur des sites reels : `node qa.mjs http://camping-les-cinq-vallees.site.azko.fr --tech-only`
- Varier les sites de test pour couvrir differents secteurs et templates

## Fichiers ignores par Git
- `node_modules/`, `.env`, `reports/`, `screenshots/`, `headed-*.png`, `.DS_Store`
