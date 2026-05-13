# Changelog

Toutes les modifications notables de QA-BALT sont documentees ici.
Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versioning semantique [SemVer](https://semver.org/lang/fr/).

## [2.9.1] - 2026-05-13

### Fixed
- **`debuglog` issues remontees dans le rapport** : le module `debuglog-checks.mjs` (introduit en 2.9.0) calculait correctement les erreurs PHP serveur mais ses issues n'etaient pas mergees dans `rawIssues` du rapport (oubli dans `qa.mjs`, `lib/report.mjs`, `lib/report-html.mjs`). Decouvert via audit camping-le-napoleon : log indiquait « 2 erreur(s) PHP retenue(s) » mais aucune issue PHP_* dans le .md/.html. Fix : `debuglogIssues` ajoute dans toutes les chaines d'agregation.

### Added
- **Cross-check Schema.org GPS 0,0 ↔ iframe Maps** : quand `SCHEMA_GPS_ZERO` detecte, on cherche dans les pages contact une iframe Maps avec coords numeriques ou adresse texte (Embed API v1), enrichit le detail avec suggestion concrete. Nouveau module `lib/geo-extraction.mjs` (4 fonctions exportees, 20 tests). Couvre formats `?pb=...!2d!3d`, `?q=lat,lng`, `?ll=...`, `?center=...`, `/embed/v1/place?q=adresse`. Validation live : audit camping-le-napoleon retourne maintenant « 💡 Suggestion : l'iframe Maps de /contact.htm utilise l'adresse texte « 76 Rte de Grenoble N85, Domaine Napoleon, 05000 Gap » ».

## [2.9.0] - 2026-05-12

### Added
- **Detection automatique du modele BALT** (`lib/model-detection.mjs`) — extraction depuis le widget HTML `<div class="btn-catalogue">` (`?modele=X`) avec normalisation des verticals (avocats→avocat, etc.). Cascade : `siteContext.model` (ClickUp/CLI manuel) prioritaire, sinon fallback HTML widget. Tests : 13 cas unitaires. Validation live : `ordre-avocats-limoges` → modele Faena auto-detecte.
- **Module debuglog AZKO** (`lib/debuglog-checks.mjs`) — extrait `var oJsonFeedback` du HTML quand `?debuglog=<token>` est ajoute :
  - Erreurs PHP runtime (Undefined variable, Call to undefined, fatals) → issues IMPORTANT/BLOQUANT
  - Metadonnees site : ORGA / SITE / SKIN (id + nom) → enrichit `siteContext.azkoMeta`
  - Version code AZKO + version tpl skin → detection sites pas redeployes
  - Filtre du bruit infra (Kubernetes, fallback skin 404). Dedup par level+msg+file+line. Tests : 25 cas unitaires.
  - Token requis dans `.env` : `AZKO_DEBUG_TOKEN`. Skip silencieux si absent.
- **URL frontend pre-remplie** : `?url=...&model_url=...&auto=1` pour lancer un audit depuis un lien externe (ex. ClickUp formula field).
- **Chargement automatique de `.env` dans `qa.mjs`** (parite avec `server.mjs`) — utilisable en CLI direct sans variables d'environnement exportees.

### Fixed
- **GPS Schema.org detection** (`SCHEMA_GPS_ZERO`) — regex insensible a la casse, capture des guillemets optionnels, comparaison `parseFloat() === 0`. Couvre desormais : `0.0`, `0.000000`, `"0"`, `"0.0"`, `Latitude`/`LATITUDE` (manquait avant : decimales, quotes, casse).

## [2.8.1] - 2026-05-12

### Fixed
- **`lib/a11y-checks.mjs`** : `violationsByRule` declare hors du bloc try/finally. La Map etait piegee dans le scope du try (ajoute lors du fix browser leak) et levait `ReferenceError` apres le `finally`, avalee par le try/catch du module registry. Consequence : axe-core ne contribuait plus aux rapports depuis cette regression. Validation : audit `aeroport-hotel.site.azko.fr` produit 9 issues a11y (1 bloquant `button-name`, 5 importants, 3 mineurs).

## [2.8.0] - 2026-04-16

### Added — Frontend QA avec SSE streaming
- **`public/index.html`** : frontend vanilla HTML/CSS/JS (0 dependance npm, ~200 lignes)
  - Champ URL + champ optionnel URL modele (collapse)
  - Bouton "Analyser" avec spinner CSS, disabled pendant l'audit
  - Zone de logs temps reel (fond sombre, coloration auto par type)
  - Zone resultat : verdict (OK/KO) + boutons download .md/.html
  - Auto-scroll des logs, Enter pour lancer
- **`GET /api/qa/stream`** : endpoint SSE (Server-Sent Events)
  - Spawn `qa.mjs` en subprocess, pipe stdout/stderr ligne par ligne
  - Events SSE : `log` (lignes), `done` (rapport), `error` (erreur)
  - Heartbeat SSE toutes les 10s (`: ping` comment) pour maintenir la connexion a travers Cloudflare (idle timeout 100s) et Apache proxy
  - `res.flushHeaders()` pour forcer le flush immediat des headers HTTP
  - `safeWrite()` wrapper — ignore les ecritures si client deconnecte
  - Si le client deconnecte : l'audit continue en background (pas de kill subprocess), rapport dispo via `/reports/`
  - Rate limit : respecte `activeJobs` + `MAX_CONCURRENT_JOBS` existant
  - Validation URL via `validatePublicUrl()` (SSRF protection)
- **`GET /reports`** : page index listant tous les rapports disponibles
  - Trie par date de modification (plus recent en premier)
  - Affiche taille + date, liens de telechargement
- **`GET /reports/:filename`** : servir les rapports generes
  - Protection path traversal : `basename()` + whitelist extensions `.md` / `.html`
- **`GET /api/qa/last-sse`** : endpoint diagnostic derniere session SSE
  - Retourne : heartbeats envoyes, data events, timing deconnexion, exit code child, report generated
  - Consultable sans SSH pour debug la connexion SSE
- **`express.static('public')`** : frontend servi apres les routes API

### Fixed
- **SSE connection drop** : Apache proxy bufferisait les reponses SSE → Cloudflare ne recevait pas les heartbeats → timeout 100s → connexion coupee. Fix : `flushpackets=on` dans ProxyPass Apache + `res.flushHeaders()` cote Node
- **Subprocess kill premature** : `req.on('close')` tuait le subprocess `qa.mjs` quand la connexion SSE se fermait. Maintenant l'audit continue en background — le rapport est genere et dispo via `/reports/`

### Deploy VPS
- Vhost Apache cree : `/etc/apache2/sites-enabled/qabalt.fire-snake-301.fr.conf`
- DNS Cloudflare : `qabalt.fire-snake-301.fr` → A record → `83.228.208.83` (Proxied)
- ProxyPass avec `flushpackets=on` (critique pour SSE via Apache)
- Exclusion `/qa-balt` dans le vhost par defaut `000-juriwatch.conf`
- Port 3847 ouvert dans iptables (regle #20)

## [2.7.0] - 2026-04-14

### Security (P0)
- **Shell injection** : nouveau `lib/utils.mjs` avec `shellEscape()` + `safeCurl()` — tous les 23 appels `execSync(curl ...)` migres vers le helper securise (single-quote wrapping)
- **SSRF protection** : `validatePublicUrl()` + `isPrivateIp()` bloquent localhost, IPs privees (RFC1918, loopback, link-local, IPv6 ULA) et DNS rebinding. Integre dans qa.mjs (CLI) et server.mjs (webhook + direct)
- **Auth /api/jobs** : endpoint protege par `requireAuth` middleware (exposait les URLs preprod)

### Fixed (P1)
- **hasBloquants regex** : `/BLOQUANT \| [1-9]/` → `/BLOQUANT \| [1-9]\d*/` — un site avec 10+ bloquants etait marque "QA OK"
- **Browser leak** : `browser.close()` dans try/finally pour visual-checks et a11y-checks (fuite processus Chrome si crash hors try/catch page)
- **Double-fetch link-checks** : cache HTML couche 1 reutilise en couche 6 (booking demo detection) — elimine N requetes curl redondantes
- **Rapport partiel** : les 4 modules sync (tech, link, page, content) wrapes en try/catch — un module qui crash ne bloque plus l'audit complet

### Changed
- **Module registry** : `MODULE_REGISTRY` dans qa.mjs — ajouter un module = ajouter 1 objet. Try/catch, logging, aggregation automatiques
- **Tests unitaires** : 91 tests (39 utils + 52 report) via `npm run test:unit`
  - shellEscape, safeCurl, isPrivateIp, validatePublicUrl, categorize, groupIssues, generateReport

## [2.6.0] - 2026-04-14

### Fixed — Sprint 1 (correctifs critiques)
- **extractPreprodUrl()** : regex elargie pour matcher "URL Integration" (nom reel du champ ClickUp, avant seul "URL Preprod" etait reconnu)
- **SE Ranking apiCall()** : try/catch separe pour erreur curl vs JSON.parse malformed. Log des erreurs API (401, 429, HTML error pages) au lieu de crash silencieux
- **Model crawl budget** : limite a 15 pages max + timeout global 60s pour eviter les crawls infinis sur les modeles avec beaucoup de pages

### Added — Sprint 2 (rapport HTML)
- **`lib/report-html.mjs`** : generateur de rapport HTML self-contained (~250 lignes)
  - 0 dependance externe (pas de CDN, pas de font web, pas de JS)
  - Header navy #1B3A5C (charte Septeo), badges severite colores
  - Categories collapsibles via `<details><summary>` natif HTML
  - Tableaux zebres, cartes synthese, verdict visuel
  - `@media print` pour impression propre
  - HTML escaping complet (helper `esc()`)
- **Double output** : `qa.mjs` genere maintenant `.md` + `.html` en parallele
- **Exports report.mjs** : `groupIssues`, `categorize`, `CATEGORY_RULES`, `CATEGORY_LABELS`, `CATEGORY_ORDER` exportes pour reutilisation

### Added — Sprint 3 (integration ClickUp hybride)
- **`postSummaryComment()`** : commentaire texte brut lisible (pas de markdown) avec resume severites + verdict
- **`uploadAttachment()`** : upload du rapport HTML en piece jointe sur la tache ClickUp (multipart/form-data, Node 22 natif, 0 dep)
- **Flow hybride** : le webhook poste un resume texte + attache le HTML complet (fallback markdown si upload echoue)
- **Retrocompat** : `/api/qa/direct` fonctionne toujours, retourne `{ markdown, htmlPath }`

### Added — Detection reservation demo camping
- **`BOOKING_DEMO_PATTERNS`** : patterns configurables dans `config.mjs` (Thelis demosalons, eSeason demo, Ctoutvert demo, Amenitiz demo)
- **`BOOKING_DEMO_LINK`** : detection liens `<a href>` pointant vers un moteur de resa demo (IMPORTANT)
- **`BOOKING_DEMO_IFRAME`** : detection iframes/scripts de resa demo dans le HTML brut (IMPORTANT)
- **Categorie CMS** : issues `BOOKING_*` categorisees dans CMS/AZKO dans le rapport

### Changed
- `package.json` : version 2.5.1 → 2.6.0
- `config.mjs` : +`CONTENT_THRESHOLDS.maxModelPages` (15), +`CONTENT_THRESHOLDS.modelCrawlBudgetMs` (60000), +`BOOKING_DEMO_PATTERNS`
- `server.mjs` : `runQA()` retourne `{ markdown, htmlPath }` au lieu de `string`

## [2.5.1] - 2026-03-06

### Fixed
- **IMG_BROKEN** : detection images avec src vide (lazy load rate par GSAP/permission prompt)
  - Images visibles avec `src=""` sont maintenant detectees comme cassees
  - Severite BLOQUANT si >=5 images cassees sur une page
  - Teste sur camping-arquebuse : 43 images cassees correctement detectees
- **Permission prompt** : ajout Chrome flag `--disable-features=PrivateNetworkAccessPermissionPrompt`
  - Bloque la popup "acceder au reseau local" qui empechait le chargement des images
- **Dialog auto-dismiss** : tous les contextes Playwright (mobile + desktop) refusent automatiquement les dialogues navigateur
- **Permissions** : `permissions: []` sur tous les contextes pour refuser geoloc, reseau local, etc.

### Added
- `docs/SPRINT-P1-P2-P3.md` : brief technique Sprint Playwright v3 (P1 Fiabilisation, P2 Preuve, P3 Rerun)

## [2.5.0] - 2026-03-05

### Added — Sprint correctif : rapport V3, ClickUp enrichi, détection cross-client
- **Rapport V3** : groupement intelligent par ID (N bruts → M groupés) + catégorisation automatique
  - 6 catégories : TECHNIQUE, SEO, ACCESSIBILITÉ, UX/RESPONSIVE, CONTENU, CMS/AZKO
  - CATEGORY_RULES : regex-based mapping issue ID → catégorie (extensible)
  - Section BLOQUANTS et CHECKLIST MEP restent en haut, détail par catégorie en dessous
  - Template detection préservée (>40% pages → scope template)
- **ClickUp enrichi** : `extractSiteContext()` extrait modèle, secteur, titre, URL existante, téléphone, emails
  - Support dropdowns et labels ClickUp (type_config.options)
  - Header rapport enrichi avec infos ClickUp (modèle, secteur, site existant)
- **Détection cross-client réseaux sociaux** : `checkSocialProfileMatch()` dans link-checks
  - Scrape og:title du profil social, compare avec titre site ClickUp
  - Si profil d'un autre client → BLOQUANT (ex: Instagram notaire sur site camping)
  - Seuil : <20% correspondance mots + secteur différent

### Changed
- `report.mjs` : réécriture complète V3 (groupIssues + renderCategorySection)
- `link-checks.mjs` : social links testés en GET (plus HEAD) pour lire le profil
- `qa.mjs` : passage siteContext dans pipeline (link-checks + report)
- `clickup.mjs` : ajout extractSiteContext(), extractFieldValue(), normalizeUrl()

## [2.4.0] - 2026-03-05

### Added — Sprint 4 : SE Ranking Core Web Vitals
- `lib/seranking-checks.mjs` : nouveau module performance via SE Ranking Site Audit API
- Audit Standard automatique (2 credits/page, 5 pages max = 10 credits/audit)
- Core Web Vitals Lighthouse : LCP, CLS, FCP, TBT avec seuils Google
- Health score global SE Ranking avec seuils configurables
- Detection temps de chargement lent (> 3s)
- Polling automatique avec timeout 3 min
- Cleanup : suppression audit après extraction
- Token via .env (SERANKING_API_TOKEN) — skip silencieux si absent
- Config extensible : `config.mjs > SERANKING` (mode, maxPages, cwvThresholds, healthScore)

### Changed
- `qa.mjs` : section 8 (performance), sections renumerotees 9-10
- `report.mjs` : accepte `perfIssues` en parametre

## [2.3.0] - 2026-03-05

### Added — Sprint 3 : Accessibilité axe-core
- `lib/a11y-checks.mjs` : nouveau module accessibilité (WCAG 2.1 AA + best-practice)
- Audit axe-core sur échantillon représentatif (max 10 pages, configurable)
- Mapping automatique impact axe → sévérité QA-BALT (critical=BLOQUANT, serious=IMPORTANT, moderate/minor=MINEUR)
- Dédup cross-pages : violations identiques regroupées, promotion sévérité automatique
- Config extensible : tags, maxPages, severityMap, disabledRules dans `config.mjs > A11Y`
- Règles désactivées : color-contrast (faux positifs GSAP), page-has-heading-one (doublon page-checks)
- Intégration rapport : issues A11Y_ dans le flux standard de dédup + rendu Markdown
- Dépendance : `@axe-core/playwright` ajouté

### Changed
- `qa.mjs` : section 7 (a11y) ajoutée, section rapport renumerotée en 8
- `report.mjs` : accepte `a11yIssues` en paramètre
- 109 → 109+ checks (axe-core couvre ~80 règles WCAG dynamiquement)

## [2.2.0] - 2026-03-05

### Added — Sprint 2 : 7 checks Playwright DOM mobile
- **Debordement horizontal** : scrollWidth > viewport, identification element fautif (IMPORTANT)
- **Police minimale 14px** : detection textes < 14px hors nav/header/footer, filtre icons 0px (MINEUR)
- **Header trop haut** : > 18% viewport = IMPORTANT, > 25% = BLOQUANT
- **Hero trop haut** : > 90% viewport mobile, ignore les heros avec formulaire (IMPORTANT/BLOQUANT)
- **Images deformees** : ratio naturel vs affiche > 10%, ignore object-fit cover/contain (IMPORTANT)
- **Labels formulaire** : champs sans label (IMPORTANT) + placeholder-only (MINEUR)
- **Menu burger** : clic + verification navigation mobile, detection burger absent (BLOQUANT/IMPORTANT)

### Changed
- 102 → 109 checks automatises (+7)

## [2.1.0] - 2026-03-05

### Added — Sprint 1 : 14 quick wins
- `lib/config.mjs` : configuration centralisee (seuils, blacklists, patterns extensibles)
- **Emails blacklistes** : detection contact@azko.fr dans HTML + formulaires (BLOQUANT)
- **Noms blacklistes** : Olivier Gilles, Lison Guerin, etc. dans le contenu (BLOQUANT)
- **Logo format** : verification SVG/WebP obligatoire (IMPORTANT)
- **Favicon enrichi** : Content-Type, support `<link rel=icon>` (MINEUR)
- **Fax vide** : detection label "Fax :" sans numero (MINEUR)
- **Email non cliquable** : email visible sans mailto: (IMPORTANT)
- **Page 404 personnalisee** : detection template serveur par defaut (IMPORTANT)
- **Images WebP** : ratio images non-WebP avec exemples (MINEUR)
- **URL propres** : detection parametres laids ?id=, &p= (MINEUR)
- **Liens reseaux sociaux** : test URLs + detection profils AZKO par defaut (IMPORTANT)
- **Adresse GMAP Azko** : detection adresse siege Septeo dans iframes Maps (BLOQUANT)
- **Double seuil title** : 70 chars MINEUR + 150 chars IMPORTANT (etait 70 unique)
- **Double seuil meta desc** : 160 chars MINEUR + 320 chars IMPORTANT (etait 160 unique)

### Changed
- Refactored DEFAULT_CMS_PAGES vers config.mjs (plus hardcode dans tech-checks)
- Patterns content-checks supportent `severity` optionnel (backward compatible)
- 88 → 102 checks automatises (+14)

## [2.0.1] - 2026-03-05

### Changed
- Structuration projet : git init, .gitignore, README, CHANGELOG, CLAUDE.md
- Nettoyage racine : suppression scripts legacy (qa-check, qa-full, qa-headed) et screenshots debug
- Deplacement rapport QA-CAMPING-ARQUEBUSE.md dans reports/
- Ajout SERANKING_API_TOKEN dans .env.example

## [2.0.0] - 2026-02-13

### Added
- Architecture complete 5 modules (tech, liens, pages, contenu, visuel)
- 88 checks automatises
- Webhook ClickUp (POST /api/qa)
- Strategie 3 couches Playwright (mobile, desktop+injection GSAP, HTML brut)
- Detection contenu generique par secteur (avocat, notaire, camping)
- Comparaison modele par similarite Jaccard (--model-url)
- Deduplication automatique des issues template (>40% pages)
- Rapport Markdown structure par severite
- Deploy VPS systemd + Nginx + Xvfb

## [1.0.0] - 2026-02-12

### Added
- Crawl sitemap.xml + navigation homepage
- Checks techniques de base (SSL, meta, schema.org)
- Checks liens (internes, externes)
- Screenshots Playwright headed
- Premier audit : camping-arquebuse
