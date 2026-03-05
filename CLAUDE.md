# QA-BALT — Instructions Claude Code

## Projet
Robot QA automatise pour sites AZKO/BALT (CMS Septeo). Node.js 22 ESM.

## Architecture
- `qa.mjs` : orchestrateur CLI (flags: --tech-only, --visual-only, --model-url)
- `server.mjs` : webhook Express ClickUp (port 3847)
- `lib/config.mjs` : configuration centralisee (seuils, blacklists, patterns — extensible)
- `lib/` : 9 modules (config, crawler, tech-checks, link-checks, page-checks, content-checks, visual-checks, report, clickup)

## Conventions code
- ESM pur (`import`/`export`, pas de require)
- HTTP via `curl` + `execSync` (pas d'axios/fetch pour les checks)
- Playwright uniquement dans `visual-checks.mjs` (et futur `a11y-checks.mjs`)
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

## Tests
- Pas de framework de test. Le robot EST un outil de test.
- Valider sur des sites reels : `node qa.mjs http://camping-les-cinq-vallees.site.azko.fr --tech-only`

## Fichiers ignores par Git
- `node_modules/`, `.env`, `reports/`, `screenshots/`, `headed-*.png`, `.DS_Store`
