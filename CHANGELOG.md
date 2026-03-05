# Changelog

Toutes les modifications notables de QA-BALT sont documentees ici.
Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versioning semantique [SemVer](https://semver.org/lang/fr/).

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
