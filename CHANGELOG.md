# Changelog

Toutes les modifications notables de QA-BALT sont documentees ici.
Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versioning semantique [SemVer](https://semver.org/lang/fr/).

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
