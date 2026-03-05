# QA-BALT

Robot QA automatise pour sites AZKO/BALT (CMS Septeo). Audite les sites en preprod et prod, genere un rapport Markdown avec des issues classees par severite.

## Stack

- **Node.js 22** (ESM)
- **curl** + regex pour les checks techniques, liens, pages, contenu
- **Playwright** (Chromium) pour les checks visuels et DOM mobile
- **Express** pour le webhook ClickUp

## Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env  # Remplir les tokens
```

## Usage

```bash
# Audit complet
node qa.mjs https://mon-site.site.azko.fr

# Tech only (sans Playwright)
node qa.mjs https://mon-site.site.azko.fr --tech-only

# Visual only (Playwright uniquement)
node qa.mjs https://mon-site.site.azko.fr --visual-only

# Avec comparaison modele
node qa.mjs https://mon-site.site.azko.fr --model-url https://modele.site.azko.fr
```

## Architecture

```
qa.mjs              Orchestrateur CLI
server.mjs          Serveur webhook ClickUp (port 3847)

lib/
  crawler.mjs       Crawl sitemap + navigation
  tech-checks.mjs   29 checks curl/regex (SSL, meta, schema.org, headers...)
  link-checks.mjs    7 checks liens (internes, externes, tel, mailto)
  page-checks.mjs   22 checks par page (title, H1, forms, images, mentions...)
  content-checks.mjs 20 checks contenu (placeholders, generiques, Jaccard)
  visual-checks.mjs 10 checks Playwright (mobile, desktop, GSAP)
  report.mjs        Generateur rapport Markdown + deduplication
  clickup.mjs       Integration API ClickUp
```

## Pipeline

1. Crawl (sitemap.xml + liens homepage)
2. Check HTTP status de chaque page
3. Checks techniques (curl/regex)
4. Checks liens (HEAD requests)
5. Checks par page (title, H1, forms, images)
6. Detection contenu generique (patterns + Jaccard)
7. Checks visuels Playwright (mobile + desktop)
8. Generation rapport Markdown

## Severites

| Niveau | Signification |
|--------|--------------|
| BLOQUANT | Bloque la mise en prod |
| CHECKLIST_MEP | Normal en preprod, a verifier avant go-live |
| IMPORTANT | Impact UX/SEO |
| MINEUR | Nettoyage cosmetique |

## Deploy VPS

```bash
# Sur le VPS (systemd + Nginx)
cd /home/ubuntu/qa-balt
git pull origin main
npm install
sudo systemctl restart qa-balt
```

## Licence

Usage interne Septeo.
