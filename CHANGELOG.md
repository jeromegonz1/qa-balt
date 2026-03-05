# Changelog

Toutes les modifications notables de QA-BALT sont documentees ici.
Format base sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versioning semantique [SemVer](https://semver.org/lang/fr/).

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
