# QA-BALT — Instructions Claude Code

## Projet
Robot QA automatise pour sites AZKO/BALT (CMS Septeo). Node.js 22 ESM.
Version actuelle : **v2.5.1** — 109+ checks automatises.

## Architecture
- `qa.mjs` : orchestrateur CLI (flags: --tech-only, --visual-only, --model-url)
- `server.mjs` : webhook Express ClickUp (port 3847)
- `lib/config.mjs` : configuration centralisee (seuils, blacklists, patterns — extensible)
- `lib/models.mjs` : loader reference modeles AZKO (cache memoire, auto-decouverte)
- `lib/` : 12 modules (config, models, crawler, tech-checks, link-checks, page-checks, content-checks, visual-checks, a11y-checks, seranking-checks, report, clickup)
- `data/` : base de reference modeles JSON par vertical (models-camping, models-avocat, models-cdj, models-notaire)
- `docs/SPRINT-P1-P2-P3.md` : brief technique Sprint Playwright v3 (fiabilisation, preuve, rerun)

## Pipeline d'execution
```
URL → Crawl (sitemap+nav) → Status HTTP → tech-checks → link-checks → page-checks
→ content-checks → visual-checks (Playwright mobile+desktop) → a11y-checks (axe-core)
→ seranking-checks (CWV) → Dedup + Groupement V3 → Rapport .md
```

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
6. Tester sur `camping-les-cinq-vallees.site.azko.fr` ou `camping-arquebuse.site.azko.fr`

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

## Base de reference modeles (data/ + lib/models.mjs)
- 52 modeles AZKO indexes dans 4 fichiers JSON : `data/models-{camping,avocat,cdj,notaire}.json`
- Format : objet plat cle par ID modele → `{ "bellini": { id, name, demoUrl, pages, modules, ... } }`
- Loader `lib/models.mjs` : `findModel(id)` cherche dans tous les verticals, `getModel(vertical, id)`, `loadModels(vertical)`
- Cache memoire (1 lecture par vertical par execution), auto-decouverte via `data/models-*.json`
- Integration : `siteContext.modelRef = findModel(siteContext.model)` dans qa.mjs
- Rapport enrichi : demo URL cliquable, langues attendues, modules attendus (Phase 1 = informatif, pas de checks auto)
- Ajouter un modele = ajouter un objet dans le JSON, 0 code a modifier
- Champs communs : id, name, demoUrl, variants, pages, hero, sectionsAccueil, modules, social, languages, features
- Champs specifiques : camping (bookingEngine, qualitelis), avocat (competences, services, annoncesImmo), cdj (expertises, services, legatus), notaire (expertises, services, annoncesImmo)

## ClickUp integration (clickup.mjs)
- `extractSiteContext(task)` : extrait model, sector, title, existingUrl, phone, emails
- Gere dropdowns (type_config.options) et labels ClickUp
- siteContext passe dans pipeline : link-checks (cross-client) + report (header enrichi)
- `checkSocialProfileMatch()` dans link-checks : scrape og:title profil social, compare avec titre site

## Checks visuels (visual-checks.mjs)
- **Chrome args** : `--disable-features=PrivateNetworkAccessPermissionPrompt` (bloque popup reseau local)
- **Permissions** : `permissions: []` sur tous les contextes (refuse geoloc, reseau local, etc.)
- **Dialogs** : auto-dismiss (`page.on('dialog', d => d.dismiss())`) sur tous les contextes
- COUCHE 1 mobile (390px) : screenshots fiables + 7 checks DOM Sprint 2
  - OVERFLOW_HORIZONTAL, FONT_TOO_SMALL, HEADER_TOO_TALL, HERO_TOO_TALL, IMG_DISTORTED, FORM_LABEL_MISSING, FORM_LABEL_PLACEHOLDER_ONLY
  - IMG_BROKEN : detecte images `src=""` (lazy load rate) + images 404. Severite BLOQUANT si >=5
  - Menu burger : bloc separe apres la boucle (BURGER_MENU_BROKEN, BURGER_NOT_FOUND, BURGER_NAV_NOT_FOUND)
- COUCHE 2 desktop : injection JS (FORCE_VISIBLE_JS) pour contourner GSAP
- COUCHE 3 HTML brut : fallback ultime via page.content()

## Accessibilite (a11y-checks.mjs)
- axe-core WCAG 2.1 AA + best-practice sur echantillon 10 pages
- Mapping impact → severite : critical=BLOQUANT, serious=IMPORTANT, moderate/minor=MINEUR
- Dedup cross-pages, promotion severite automatique
- Regles desactivees : color-contrast (faux positifs GSAP), page-has-heading-one (doublon page-checks)

## Performance (seranking-checks.mjs)
- SE Ranking Site Audit API (2 credits/page, max 5 pages)
- Core Web Vitals Lighthouse : LCP, CLS, FCP, TBT avec seuils Google
- Health score global + temps de chargement > 3s
- Token via .env (SERANKING_API_TOKEN) — skip silencieux si absent

## Git workflow
- Branche `main` = prod (ce qui tourne sur le VPS)
- Feature branches : `feature/sprint-X` pour chaque sprint
- Tags : `vX.Y.Z` a chaque version
- Versioning semantique dans `package.json`
- PR obligatoire pour les sprints, commit direct sur main pour hotfixes

## Deploy VPS
- Remote : VPS 83.228.208.83 (alias vps-firesnake)
- Path : /home/ubuntu/qa-balt/
- Service : systemd qa-balt + Nginx reverse proxy (port 3847)
- Deploy : `git pull` + `npm install` + `sudo systemctl restart qa-balt`

## Tests de non-regression
- Runner : `tests/run-regression.mjs` — comparaison snapshot issue IDs vs baseline
- Baselines : `tests/baselines/{site}.json` — issue IDs + severite, commites dans git
- Sites de reference : camping-arquebuse (34 issues), lc-avocats (32 issues)
- Commandes :
  - `npm test` — lancer les tests (mode tech-only, ~2-3 min)
  - `npm run test:update` — regenerer les baselines apres changement volontaire
  - `node tests/run-regression.mjs --site camping-arquebuse` — un seul site
- Resultat : exit 0 si aucune regression, exit 1 si issues disparues
- Panel de 7 sites multi-secteurs pour tests manuels :
  - **Camping** : camping-les-cinq-vallees, camping-municipal-hippodrome, camping-arquebuse
  - **Avocat** : lc-avocats, rousselavocat, ordre-avocats-limoges
  - **Hotel** : hotel-lys-chablis

## Roadmap — Sprint Playwright v3 (docs/SPRINT-P1-P2-P3.md)
- **P1 Fiabilisation** (v3.0.0) : addInitScript GSAP, console/pageerror, route() noise blocker, burger locator, networkidle
- **P2 Preuve** (v3.1.0) : traces conditionnelles, evidence object, liens artefacts rapport
- **P3 Rerun** (v3.2.0) : detection pages suspectes, rerun contexte neuf

## Fichiers ignores par Git
- `node_modules/`, `.env`, `reports/`, `screenshots/`, `headed-*.png`, `.DS_Store`
