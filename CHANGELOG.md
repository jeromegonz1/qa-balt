# Changelog

Toutes les modifications notables de QA-BALT sont documentees ici.
Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versioning semantique [SemVer](https://semver.org/lang/fr/).

## [2.13.0] - 2026-05-21

### Added — Sprint 2.a : file d'attente FIFO pour audits
Demande terrain : eviter le 429 brut quand plusieurs integrateurs lancent
des audits simultanes depuis ClickUp.

- **`lib/job-queue.mjs`** (nouveau) : classe JobQueue avec `maxConcurrent=3`
  + `maxWaiting=10` par defaut. `enqueue(jobInfo, runFn)` lance direct si
  slot dispo, sinon mis en file FIFO. Auto-progression quand un job finit.
  `subscribe(jobId, cb)` pour notifier les changements de position (utilise
  par SSE). `cancel(jobId)` pour les jobs en attente (utilise sur client
  disconnect). `cleanupStale()` toutes les 2 min (anti orphan).
- **Endpoints adaptes** (`server.mjs`) :
  - `POST /api/qa` (webhook ClickUp) : 202 + `{ status: 'queued', position }`
    quand saturated, 200 sinon. 409 si deja en cours/queue. 503 si maxWaiting.
  - `GET /api/qa/stream` : SSE garde la connexion ouverte meme en attente.
    Envoie event `queued` (avec position) puis `starting` quand le job devient
    actif. Cancel automatique si client disconnect avant lancement.
  - `GET /api/jobs` : retourne `{ jobs (running), waiting, maxConcurrent,
    maxWaiting }`. Backward compat sur `jobs[]`.
  - `GET /health` : ajoute `waitingJobs` au payload.
- **Frontend** (`public/index.html`) : nouveaux listeners SSE `queued`
  (affiche position + message d'attente) et `starting` (affiche « ▶️ Audit
  demarre »).
- **Tests** : 37 cas unitaires (test-job-queue.mjs) — enqueue, saturation,
  auto-progression, position updates, duplicate jobId, queue pleine, cancel,
  list() snapshot, cleanupStale, erreur dans runFn n'arrete pas la chaine.

### Added — Sprint 2.c : self-restart watcher (anti-leak Playwright)
Probleme observe : apres ~20h d'uptime, ~1.4 GB RAM peak et Playwright
echoue parfois a creer un onglet (logs camping-le-napoleon 21/05).

- **`server.mjs`** : check toutes les 5 min. Si idle (aucun job actif/queue)
  ET (uptime > 72h OU RAM > 1024 MB) → `server.close()` puis `exit(0)`.
  systemd doit avoir `Restart=always` dans le unit file pour relancer
  automatiquement. Configurable via env :
  - `QA_BALT_RESTART_AFTER_HOURS` (default 72)
  - `QA_BALT_RESTART_RAM_MB` (default 1024)
  - `QA_BALT_DISABLE_SELF_RESTART=1` pour desactiver

### Limites
- Queue in-memory (perdue au restart serveur, y compris self-restart).
  Acceptable : un restart se fait quand idle, donc 0 job perdu.
- Pas de priorisation (FIFO pur).

### Total tests
- 293 tests unitaires verts (test-utils + 52 + 13 + 25 + 27 + 17 + 31 + 31
  + 22 + 30 + 37).

## [2.12.0] - 2026-05-20

### Added — Sprint 3 partiel : enrichissement issues curl-based
Repond a la demande terrain « lesquelles images, ou ? » (RETOURS QA). Jusqu'ici
seules les issues a11y avaient un `element: { selector, html, location }`
(axe-core fournit la donnee). Les issues curl-based (regex sur HTML brut)
n'avaient PAS ce champ.

- **`lib/html-ancestry.mjs`** (nouveau, pure + testable sans Playwright) :
  - `getHtmlAncestryAt(html, position)` : walk simplifie des tags ouvrants
    avant une position, retourne la chaine d'ancetres dans l'ordre proche-
    d'abord. Bornee a 5000 tags scannes (anti DoS).
  - `buildHeuristicSelector(ancestry, tag)` : selector CSS heuristique via
    cascade — id (3 ancetres proches) > classe BEM > classe simple > tag.
  - `buildElementInfo(html, pos, matchedHtml, tag, classifyFn)` : helper
    combine retournant `{ selector, html (200 chars), location }`.

- **`lib/page-checks.mjs` `LINK_NO_TEXT`** : capture le 1er lien sans texte
  ni alt avec selector + location → l'integrateur sait OU chercher dans
  son code (header / footer / nav / hero).

- **`lib/tech-checks.mjs` `ALT_GENERIC` + `ALT_MISSING`** : same pattern
  pour les images alt generique (Diaporama, Image, Photo) et les images
  sans attribut alt.

### Limites
- Selector est heuristique (pas unique) — donne une cle de recherche
  concrete, pas un selector axe-core perfect. Suffisant pour ~80% des cas
  AZKO (BEM bien structure).
- Reste a etendre : MAIL_EMPTY, TITLE_TOO_SHORT, H1_MULTIPLE, IMG_MISSING_
  DIMENSIONS, TARGET_BLANK_NO_NOOPENER — pattern identique, ~10 min par
  check. Sera fait en v2.13.0 selon retours.

### Tests
- 30 cas unitaires (test-html-ancestry.mjs) : ancestralite simple, siblings
  fermes, void elements, BEM AZKO realiste, casse insensible, self-closing,
  edge cases. Integration buildElementInfo + classifyLocation.
- Total suite : 256+ tests verts (test-utils + 52 + 13 + 25 + 27 + 17 + 31
  + 31 + 22 + 30).

## [2.11.0] - 2026-05-20

### Fixed — Faux positifs identifies sur retours terrain (RETOURS QA — Julien)
- **`SCHEMA_GPS_ZERO` + short URLs Google Maps** (sprint 1.a) : nouvelle fonction `extractMapsShortLink(html)` detecte `maps.app.goo.gl/<id>`, `goo.gl/maps/<id>`, `g.page/<id>`. La suggestion devient « short URL Maps utilise sur /contact.htm, ouvrir pour recuperer coords » au lieu de bloquant sans piste actionnable.
- **`PRIVACY_404` avec politique RGPD en accordeon** (sprint 1.b) : si /politique-de-confidentialite.htm = 404 mais /mentions-legales.htm contient « politique de confidentialite | donnees personnelles | RGPD | GDPR », nouvelle issue `PRIVACY_IN_MENTIONS` en `CHECKLIST_MEP` (au lieu de bloquant) avec note « verifier que le contenu est suffisant ».
- **`IMG_BROKEN` bug lazy load AZKO** (sprint 1.d) : nouveau type `IMG_BROKEN_LAZY_CMS` quand la majorite des images cassees ont `src=""` (bug GSAP lazy loader hors portee integrateur). Severite tolerante (>=10 = BLOQUANT, sinon IMPORTANT) + note explicite « bug CMS, a remonter equipe dev AZKO ».

### Added — Widgets externes (sprint 1.c)
- **`lib/external-widgets.mjs`** : catalogue de 10 widgets tiers connus (Qualitelis, eSeason, Thelis, Ctoutvert, Amenitiz, MisterBooking, Axeptio, Doctolib, Calendly, Google Maps). `identifyExternalWidget(element)` detecte via 3 strategies (selectorPrefix, classPrefix, htmlContains).
- **`a11y-checks.mjs`** : quand une issue a11y touche un widget externe → severite degradee (BLOQUANT → IMPORTANT, IMPORTANT → MINEUR) + tag `externalWidget` dans le rapport + note « widget tiers, hors portee integrateur, signaler au vendeur ».
- **Rendu HTML enrichi** : badge jaune « 🧩 Widget tiers : <vendor> » en tete de l'issue.
- Tests : 22 cas (detection par id/class/url, casse insensible, downgrade severity).

### Internal
- 4 commits atomiques (1.a → 1.d).
- `lib/report.mjs` `groupIssues` propage `externalWidget` au groupement.
- CATEGORY_RULES `IMG_BROKEN` → prefixe `/^IMG_BROKEN/` pour couvrir aussi `IMG_BROKEN_LAZY_CMS`.
- Total suite : 226+ tests unitaires (test-utils + test-report 52 + test-model-detection 13 + test-debuglog 25 + test-geo-extraction 27 + test-fix-suggestions 17 + test-element-location 31 + test-url-guard 31 + test-external-widgets 22).

## [2.10.0] - 2026-05-13

### Security
- **Whitelist domaine `*.azko.fr`** sur tous les endpoints d'audit (`/api/qa`, `/api/qa/direct`, `/api/qa/stream`, CLI `qa.mjs`). Bloque l'usage de qa-balt comme scanner anonyme pour sites tiers. Nouveau module `lib/url-guard.mjs` :
  - `validateAuditUrl` : strict `*.azko.fr` (preprods uniquement).
  - `validateModelUrl` : plus permissif (`*.azko.fr` + `*.septeo-digitalagency.fr` pour catalogues/demos).
  - Schemes whitelist : `http`/`https` seulement (bloque `file://`, `javascript:`, `data:`, `ftp:`).
  - Longueur max 2048, caracteres de controle interdits (anti log-injection).
  - Suffix-attack resistant (`evil.azko.fr.attacker.com` bloque).
  - 31 tests unitaires.

### Added — Phase A : rapport enrichi (4 bricks)
- **`lib/fix-suggestions.mjs`** (Phase A 1/N) : 31 entrees mappent les IDs d'issue les plus courants vers texte de fix, snippet exemple, fichier probable (`.tpl`/SCSS/CMS), reference WCAG/MDN, impact tag (a11y/seo/securite/perf/rgpd). Lookup exact ou wildcard (`A11Y_*`, `PHP_*`). 17 tests.
- **`lib/element-location.mjs`** (Phase A 2/N) : `classifyLocation(ancestorChain)` categorise un element par sa zone semantique (header/footer/hero/nav/form/aside/main/body). Matching set-based BEM-aware (block, `block__elem`, `block--mod`, `block-suffix`). 31 tests.
- **a11y-checks.mjs enrichi** (Phase A 2/N) : chaque issue a11y porte desormais un `element: { selector, html (200 chars max), location }` + `reference` (axe helpUrl).
- **`lib/report.mjs` groupIssues** preserve maintenant `element` et `reference` au groupement (1re occurrence prioritaire, fallback si suivantes ont l'info).
- **`lib/report-html.mjs` rendu enrichi** (Phase A 3/N) : helper `renderIssueExtras(issue, siteUrl)` produit une carte enrichie sous chaque issue :
  - Badge location (📍 header, 📍 footer...) + selector monospace + lien live `?qa_highlight=...`.
  - Bloc fix (💡 texte + example code + fichier probable + impact).
  - Lien reference (📚) externe.
  - Layout hybride : BLOQUANTS deplies, IMPORTANT/MINEUR collapsibles via `<details>`.
- **Bookmarklet « QA Highlight »** (Phase A 4/N) : section repliable « 🛠 Outils QA » en tete de rapport HTML avec bouton drag-and-drop a installer en favori 1× seulement. Lit `?qa_highlight=` de l'URL preprod, scroll + outline rouge l'element. Pas d'eval, pas de reseau, pas de storage.

### Internal
- `tests/test-url-guard.mjs`, `tests/test-fix-suggestions.mjs`, `tests/test-element-location.mjs` ajoutes. Suite : 189+ tests unitaires.
- `package.json` `test:unit` inclut les nouveaux tests.

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
