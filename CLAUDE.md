# QA-BALT — Instructions Claude Code

## Projet
Robot QA automatise pour sites AZKO/BALT (CMS Septeo). Node.js 22 ESM.
Version actuelle : **v2.8.0** — 112+ checks automatises.

## Architecture
- `qa.mjs` : orchestrateur CLI (flags: --tech-only, --visual-only, --model-url)
- `server.mjs` : serveur Express — webhook ClickUp + frontend QA + SSE streaming (port 3847)
- `public/index.html` : frontend vanilla HTML/CSS/JS (0 dependance npm)
- `lib/config.mjs` : configuration centralisee (seuils, blacklists, patterns — extensible)
- `lib/models.mjs` : loader reference modeles AZKO (cache memoire, auto-decouverte)
- `lib/utils.mjs` : securite (shellEscape, safeCurl, validatePublicUrl, isPrivateIp)
- `lib/` : 16 modules (config, models, utils, crawler, tech-checks, link-checks, page-checks, content-checks, visual-checks, a11y-checks, debuglog-checks, seranking-checks, model-detection, report, report-html, clickup)
- `data/` : base de reference modeles JSON par vertical (models-camping, models-avocat, models-cdj, models-notaire)
- `docs/SPRINT-P1-P2-P3.md` : brief technique Sprint Playwright v3 (fiabilisation, preuve, rerun)

## Pipeline d'execution
```
URL → Crawl → Status HTTP → detection modele auto (HTML widget) → tech-checks
→ link-checks → page-checks → content-checks → visual-checks (Playwright)
→ a11y-checks (axe-core) → debuglog-checks (PHP errors + meta AZKO)
→ seranking-checks (CWV) → Dedup + Groupement V3 → Rapport .md + .html
```

## Conventions code
- ESM pur (`import`/`export`, pas de require)
- HTTP via `safeCurl()` dans `lib/utils.mjs` (shell-escaped curl + execSync, pas d'axios/fetch)
- Protection SSRF : `validatePublicUrl()` bloque IPs privees/loopback/link-local + DNS rebinding
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
3. Ajouter un objet dans `MODULE_REGISTRY` (id, label, fn, guard, args, async)
4. Le try/catch, logging et aggregation sont automatiques

## Rapport V3 (report.mjs)
- Groupement intelligent : issues avec meme ID regroupees (N bruts → M groupes)
- 6 categories auto : TECHNIQUE, SEO, ACCESSIBILITE, UX, CONTENU, CMS
- CATEGORY_RULES : regex-based mapping issue ID → categorie (extensible, fallback → TECHNIQUE)
- Structure : BLOQUANTS → CHECKLIST MEP → DETAIL PAR CATEGORIE → PAGES → PRIORITES
- Exports partages : `groupIssues`, `categorize`, `CATEGORY_RULES`, `CATEGORY_LABELS`, `CATEGORY_ORDER`

## Rapport HTML (report-html.mjs)
- Generateur HTML self-contained (0 dep externe, pas de CDN/JS/font web)
- Importe `groupIssues` + constantes depuis `report.mjs` (memes donnees)
- Design : header navy #1B3A5C, badges severite colores, cartes synthese
- Categories collapsibles via `<details><summary>` natif (TECHNIQUE ouvert par defaut)
- Tableaux zebres, verdict visuel (OK/KO), `@media print`
- HTML escaping complet (helper `esc()`)
- Output : `reports/{slug}-{date}.html` a cote du `.md`

## Detection reservation demo (link-checks.mjs)
- `BOOKING_DEMO_PATTERNS` dans config.mjs : patterns extensibles par moteur (Thelis, eSeason, Ctoutvert, Amenitiz)
- Couche 6 dans link-checks : scanne liens `<a href>` + iframes/scripts pour les moteurs de resa demo
- Pattern principal : `camping=demosalons` dans les URLs Thelis (demo salon pro)
- Issues : `BOOKING_DEMO_LINK` (lien) + `BOOKING_DEMO_IFRAME` (iframe/script) — severite IMPORTANT
- Categorisees dans CMS/AZKO dans le rapport
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

## ClickUp integration (clickup.mjs + server.mjs)

### API ClickUp v2
- Base URL : `https://api.clickup.com/api/v2`
- Auth : `Authorization: pk_...` (personal token, PAS de prefixe "Bearer")
- Rate limits : 100 req/min (Free/Unlimited/Business), 1000 (Business+), 10000 (Enterprise)
- Endpoints utilises :
  - `GET /task/{taskId}` — details tache + custom_fields
  - `POST /task/{taskId}/comment` — poster rapport (comment_text = texte brut, max ~10000 chars)
  - `PUT /task/{taskId}` — changer statut (body: `{ status }`)

### Workspace AZKO (verifie mars 2026)
- Workspace ID : 2633453 ("AZKO's workspace")
- Space "Production" (4687363) → Folder "SITES" (901512264968) → Lists par annee (2026, 2025, ...)
- Statuts de tache : demande d'elements → stand-by → integration a venir → integration en cours → qa → recette → ...

### Custom fields ClickUp (noms reels)
| Champ ClickUp | Type | Variable extractee | Notes |
|---|---|---|---|
| **URL Integration** | short_text | `preprodUrl` | ⚠️ PAS "URL Preprod" — regex a adapter |
| **Modele** | drop_down (75 options) | `siteContext.model` | value = orderindex, resolu via type_config.options |
| **Client_type** | drop_down (20 options) | `siteContext.sector` | Avocats, Notaires, CDJ, Ordre, CRD, Societe... |
| **Site_type** | drop_down (3 options) | `siteContext.siteType` | Modele, Sur mesure, Essentiel |
| **Titre site** | text | `siteContext.title` | |
| **Telephone** | short_text | `siteContext.phone` | |
| **Email client** | email | `siteContext.clientEmail` | |
| **Email formulaire** | short_text | `siteContext.formEmail` | |
| **URL existante** | short_text | `siteContext.existingUrl` | Peut contenir "Non" |
| **Interlocuteur** | short_text | `siteContext.contact` | |
| **Produits site** | labels | — | IDs resolus via type_config.options (Integration, Multilingue, Annonce immo...) |
| **Pays** | drop_down | — | France, Belgique |
| **Nom Client** | short_text | — | |

### Dropdown : format value
- `value` = entier (orderindex dans type_config.options)
- `extractFieldValue()` resout via `options.find(o => o.orderindex === field.value)` → retourne le nom
- Modele dropdown : 75 modeles dont avocats (index 0-14), notaires (index 15-29), CDJ (index 30-46), camping (index 62-66), hotel (index 67+)

### Pipeline webhook complet
```
ClickUp automation (statut → "QA") → POST /api/qa { task_id }
  → server.mjs : getTask(taskId) → extractPreprodUrl(task) + extractModelUrl(task) + extractSiteContext(task)
  → spawn qa.mjs <url> --site-context '{"model":"muscat","sector":"Notaires",...}'
  → qa.mjs : findModel(siteContext.model) → siteContext.modelRef
  → audit 8 modules → rapport .md
  → server.mjs : postComment(taskId, rapport) + updateTaskStatus(taskId, "QA OK"/"QA KO")
```

### siteContext transmission (fix S1.1)
- server.mjs passe le contexte via `--site-context` (JSON serialise) au subprocess qa.mjs
- qa.mjs parse le flag et enrichit avec `findModel()` pour obtenir `modelRef`
- Utilise dans : link-checks (cross-client social), report (header enrichi modele/langues/modules)

### Flow ClickUp hybride (v2.6.0)
- `postSummaryComment()` : texte brut lisible avec resume severites + verdict (pas de markdown)
- `uploadAttachment()` : rapport HTML complet en piece jointe (multipart/form-data, Node 22 natif)
- Flow : resume texte → HTML attache → fallback markdown tronque si upload echoue
- `runQA()` retourne `{ markdown, htmlPath }` (breaking change interne, retrocompat /api/qa/direct)

### Bugs connus a corriger
- Base modeles : 52 modeles dans data/ vs 75 dans dropdown ClickUp (manque hotel + nouveaux)

### Setup ClickUp (automation webhook)
- Trigger : statut tache passe a "QA" (ou bouton manuel)
- Action : POST webhook vers `https://<domaine>/api/qa`
- Headers : `X-API-Key: <QA_BALT_API_KEY>` (si configure)
- Body : `{ "task_id": "{{task_id}}" }`

### Variables .env requises
```
CLICKUP_API_TOKEN=pk_xxx              # Token personnel ClickUp (obligatoire pour webhook)
QA_BALT_API_KEY=xxx                   # Protection endpoint webhook (optionnel, recommande)
CLICKUP_STATUS_QA_OK=qa ok            # Statut post-QA sans bloquant (optionnel)
CLICKUP_STATUS_QA_KO=qa ko            # Statut post-QA avec bloquant(s) (optionnel)
```

## Frontend QA (v2.8.0)

### Acces
- **Local** : `http://localhost:3847/`
- **Prod** : `http://qabalt.fire-snake-301.fr/`

### Endpoints frontend
| Endpoint | Description |
|---|---|
| `GET /` | Frontend HTML (formulaire d'audit) |
| `GET /api/qa/stream?url=...&model_url=...` | SSE streaming audit |
| `GET /reports` | Index des rapports disponibles |
| `GET /reports/:filename` | Telecharger un rapport (.md ou .html) |
| `GET /api/qa/last-sse` | Diagnostic derniere session SSE |

### SSE (Server-Sent Events)
- Le frontend se connecte via `EventSource` a `/api/qa/stream`
- Le serveur spawn `qa.mjs` en subprocess et pipe stdout/stderr en events SSE
- **Events** : `log` (lignes), `done` (rapport genere), `error` (erreur)
- **Heartbeat** : `: ping N t+Xs` toutes les 10s (comment SSE, ignore par EventSource)
- **Si le client deconnecte** : l'audit continue en background, rapport dispo via `/reports/`
- **Diagnostic** : `GET /api/qa/last-sse` retourne les metriques de la derniere session (heartbeats, timing, disconnect)

### Differences local vs VPS prod

| Aspect | Local (Mac) | VPS (83.228.208.83) |
|---|---|---|
| **URL** | `http://localhost:3847/` | `http://qabalt.fire-snake-301.fr/` |
| **Playwright** | Chrome visible (headed, ecran natif) | Chrome via Xvfb (display :99, headless virtuel) |
| **Proxy** | Direct (pas de proxy) | Cloudflare → Apache → Express:3847 |
| **SSE** | Connexion directe, pas de timeout | Cloudflare (100s idle) + Apache (`flushpackets=on` requis) |
| **Firewall** | Aucun | iptables (port 3847 ouvert) + Cloudflare WAF |
| **IP source audits** | IP Mac (`165.85.255.240`*) | IP VPS (`83.228.208.83`) |
| **Rapports** | `~/claude-code/qa-balt/reports/` | `/home/ubuntu/qa-balt/reports/` |
| **Logs** | stdout terminal | `sudo journalctl -u qa-balt -f` |

\* IP Mac variable (VPN, reseau)

### Config Apache VPS (critique pour SSE)
```apache
# /etc/apache2/sites-enabled/qabalt.fire-snake-301.fr.conf
<VirtualHost *:80>
    ServerName qabalt.fire-snake-301.fr
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3847/ flushpackets=on  # ← OBLIGATOIRE pour SSE
    ProxyPassReverse / http://127.0.0.1:3847/
    <Proxy *>
        Require all granted
    </Proxy>
</VirtualHost>
```
- **`flushpackets=on`** : force Apache a flusher chaque paquet SSE immediatement au lieu de bufferiser
  - Sans ca : les heartbeats sont retenus par Apache → Cloudflare ne les voit pas → timeout 100s → connexion coupee
  - Symptome : "Connexion perdue" dans le frontend apres ~100s de silence (pendant visual checks Playwright)

### Config Cloudflare
- DNS : `qabalt` → A record → `83.228.208.83` (Proxied, nuage orange)
- Domaine : `fire-snake-301.fr`
- Idle timeout Cloudflare : 100s (free plan) — le heartbeat 10s empeche la coupure

### IP whitelisting DSI Septeo
Les sites *.site.azko.fr ont un rate limiter/WAF cote Septeo. Si l'audit retourne des 429 sur la homepage, faire whitelister :
- `83.228.208.83` — IP VPS (obligatoire pour les audits en prod)
- IP Mac variable — optionnel pour les tests locaux

### Bugs connus frontend
- `VISUAL_THRESHOLDS is not defined` dans `visual-checks.mjs:page.evaluate()` — genere un MINEUR "Timeout chargement mobile" (pas bloquant)

## Securite (v2.8.0)
- **Shell injection** : tous les appels curl passent par `safeCurl()` (lib/utils.mjs) qui echappe les URLs via single-quote wrapping
- **SSRF** : `validatePublicUrl()` bloque localhost, IPs privees (RFC1918, link-local, loopback, IPv6 ULA) + DNS rebinding (resolution avant fetch)
- **Points d'entree proteges** : qa.mjs (CLI), server.mjs (/api/qa/direct + webhook ClickUp + /api/qa/stream)
- **Auth API** : `requireAuth` middleware sur /api/qa, /api/qa/direct et /api/jobs (via `QA_BALT_API_KEY`, bypass en dev)
- **Frontend** : pas d'auth (acces libre), restriction IP geree au niveau firewall/Cloudflare VPS
- **Path traversal** : `/reports/:filename` utilise `basename()` + whitelist `.md`/`.html`
- **Browser cleanup** : try/finally sur `browser.close()` dans visual-checks + a11y-checks (pas de fuite Chrome)

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
- Service : systemd qa-balt (`Environment=DISPLAY=:99`, `Requires=xvfb.service`)
- Proxy : Apache reverse proxy (`qabalt.fire-snake-301.fr` → `127.0.0.1:3847`, `flushpackets=on`)
- Xvfb : `/usr/bin/Xvfb :99 -screen 0 1440x900x24` (service systemd `xvfb.service`)
- DNS : `qabalt.fire-snake-301.fr` → Cloudflare (Proxied) → `83.228.208.83`
- Deploy : `git pull` + `sudo systemctl restart qa-balt` (npm install si nouvelles deps)
- Logs : `sudo journalctl -u qa-balt -f`

## Tests
- **Regression** : `tests/run-regression.mjs` — comparaison snapshot issue IDs vs baseline
  - Baselines : `tests/baselines/{site}.json` — issue IDs + severite, commites dans git
  - Sites de reference : camping-arquebuse (34 issues), lc-avocats (32 issues)
- **Unit tests** : `tests/test-utils.mjs` (39 tests) + `tests/test-report.mjs` (52 tests)
  - shellEscape, safeCurl, isPrivateIp, validatePublicUrl, categorize, groupIssues, generateReport
- Commandes :
  - `npm test` — regression tech-only (~2-3 min)
  - `npm run test:unit` — tests unitaires utils + report (~5 sec)
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
