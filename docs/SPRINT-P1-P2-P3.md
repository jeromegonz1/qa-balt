# QA-BALT — Sprint Playwright v3

## Vision produit
Faire evoluer QA-BALT de **"outil qui detecte des problemes"** vers **"outil qui detecte, explique et documente les problemes"**.

Playwright passe de "navigateur telecommande" a **"moteur de preuve reproductible"**.

---

## Equipe

| Role | Responsabilite |
|------|---------------|
| **PO + QA** (Jerome) | Validation metier, tests sur panel sites, go/no-go par chantier |
| **Architecte** (Claude) | Conception technique, priorisation, review code, coherence pipeline |
| **Dev Expert** (Claude) | Implementation, tests, integration dans visual-checks.mjs |

---

## Pre-requis livres (v2.5.1)
- [x] IMG_BROKEN : detection images src vide (lazy load rate)
- [x] Permission prompt : `--disable-features=PrivateNetworkAccessPermissionPrompt`
- [x] Dialog auto-dismiss sur tous les contextes Playwright

---

## Sprint P1 — Fiabilisation (5 chantiers)

> **Objectif** : Playwright deterministe, 0 faux positif GSAP, diagnostic JS complet, pages chargees 2-3x plus vite.

### P1.1 — addInitScript GSAP Neutralizer
**Fichier** : `lib/visual-checks.mjs`
**Principe** : Injecter via `browserContext.addInitScript()` un script qui tourne AVANT tout `<script>` de la page.

**2 couches** :
1. **Stub GSAP** : `Object.defineProperty(window, 'gsap', ...)` intercepte `gsap.to/from/fromTo` → no-op. `registerPlugin(ScrollTrigger)` → swallowed. ScrollTrigger pre-defini comme stub.
2. **CSS !important** : `<style>` injecte tot — force `opacity:1`, `visibility:visible`, `overflow:visible`, `transform:none` sur tous les containers.

**Bonus** :
- Override `IntersectionObserver` → tout est "in viewport" → lazy loaders chargent immediatement
- Override `Element.setAttribute('loading', 'lazy')` → force `eager`
- `MutationObserver` de securite : corrige les styles GSAP appliques tardivement (auto-disconnect 10s)

**Impact** :
- Elimine `FORCE_VISIBLE_JS` post-load (lignes 24-66)
- Elimine la double injection desktop (lignes 630+645)
- Elimine les faux positifs "page vide"
- Elimine les race conditions timing GSAP

**Ce qu'on garde** : Le `FORCE_VISIBLE_JS` actuel en fallback post-load (ceinture et bretelles), mais il ne devrait plus etre necessaire.

**Test** : Valider sur les 6 sites du panel. Comparer nombre d'issues avant/apres. Zero regression.

### P1.2 — Collecte console.error + pageerror
**Fichier** : `lib/js-error-collector.mjs` (nouveau) + integration dans `visual-checks.mjs`

**4 nouveaux types d'issues** :

| ID | Source Playwright | Severite | Ce que ca attrape |
|----|-------------------|----------|-------------------|
| `JS_UNCAUGHT_ERROR` | `page.on('pageerror')` | IMPORTANT / BLOQUANT (>=3) | Exceptions non capturees (vrais bugs JS) |
| `JS_CONSOLE_ERROR` | `page.on('console')` type=error | MINEUR / IMPORTANT (>=5) | console.error() filtres (hors bruit) |
| `JS_CRITICAL_RESOURCE_HTTP` | `page.on('response')` 4xx/5xx | BLOQUANT | CSS/JS/Font en 404 = layout casse |
| `JS_CRITICAL_RESOURCE_NETWORK` | `page.on('requestfailed')` | BLOQUANT | Ressource critique injoignable |

**Filtrage bruit** (centralise dans `config.mjs > JS_ERRORS`) :
- Domaines tiers ignores (~30 domaines)
- Patterns ignores : GSAP warnings, deprecation, third-party cookies, passive event listener
- Extensions navigateur : `chrome-extension://`, `moz-extension://`
- Types non critiques : images (deja couvert par IMG_BROKEN), xhr/fetch analytics

**Pattern** :
```js
const collector = createJsErrorCollector(page);
// ... navigation + checks ...
const jsIssues = collector.getIssues(pageName);
issues.push(...jsIssues);
```

**Categorisation rapport** : `JS_*` → categorie TECHNIQUE (via CATEGORY_RULES dans report.mjs)

### P1.3 — route() Noise Blocker
**Fichier** : `lib/noise-blocker.mjs` (nouveau) + integration dans `visual-checks.mjs` et `a11y-checks.mjs`

**Domaines bloques** (8 categories, ~30 domaines) :
- **Analytics** : google-analytics, googletagmanager, matomo, plausible
- **Pub/pixels** : doubleclick, facebook.net, ads.linkedin, ads.twitter
- **Cookies** : axeptio, tarteaucitran, cookiebot, didomi
- **Chat** : crisp, tawk, zendesk, intercom
- **Heatmaps** : hotjar, clarity, mouseflow
- **Social embeds** : platform.instagram, platform.twitter, platform.linkedin
- **Reviews** : qualitelis, tripadvisor
- **A/B testing** : optimizely, abtasty

**Ne PAS bloquer** :
- Google Maps iframes (utiles pour QA adresse)
- Google Fonts (necessaires pour rendu visuel fidele)
- jQuery/CDN du site (ressources metier)

**Strategie** :
- `browserContext.route()` avec function matcher (1 seul handler, pas 30)
- `route.abort('blockedbyclient')` par defaut
- `route.fulfill()` avec stub JS pour Axeptio/Tarteaucitran (eviter ReferenceError)
- Stats : compteur requetes bloquees par domaine → section rapport optionnelle

**Simplification existante** : Le filtre regex `requestfailed` (ligne 114) remplace par `req.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT'`

**Gain estime** : 3-8 secondes par page, 90-480 secondes par audit complet.

### P1.4 — Burger menu via Locator
**Fichier** : `lib/visual-checks.mjs` (section burger, lignes 489-603)

**Avant** (actuel) :
```js
burgerBtn = await burgerPage.$(sel);  // querySelector brut
await burgerBtn.click();               // click brut
await burgerPage.waitForTimeout(800);  // attente fixe
```

**Apres** :
```js
const burger = burgerPage.locator('.menuBurger, .burger, .hamburger, [aria-label="Menu"]').first();
await burger.click();  // auto-wait visible + stable + receives events
await burgerPage.locator('nav, .nav, .navContents').first().waitFor({ state: 'visible', timeout: 3000 });
```

**Avantages** :
- Auto-waiting (plus de `waitForTimeout`)
- Retry automatique si element pas encore stable
- Meilleur reporting d'erreur (quel selecteur, pourquoi timeout)

### P1.5 — Optimisations mineures
**a) `networkidle` vs `waitForTimeout`** :
- Remplacer `waitForTimeout(2000)` apres `goto` par `waitUntil: 'networkidle'` avec timeout
- Fallback : si networkidle timeout, continuer quand meme (pas bloquant)

**b) Screenshots avec `mask`** :
- Masquer bandeau cookies (`#bandeauCookies-v2`)
- Masquer widgets maps instables
- Masquer carrousels (position aleatoire au moment du screenshot)

**Critere de validation P1** :
- [ ] Test E2E sur les 6 sites du panel (camping x2, avocat x3, hotel x1)
- [ ] Zero regression (meme nombre ou moins d'issues qu'avant, pas plus de faux positifs)
- [ ] Gain de vitesse mesurable (chronometrer avant/apres)
- [ ] Nouveaux types JS_* detectes la ou pertinent

---

## Sprint P2 — Preuve (3 chantiers)

> **Objectif** : Chaque bug BLOQUANT/IMPORTANT = une preuve exploitable (screenshot + trace + console).

### P2.1 — Traces conditionnelles
**Fichier** : `lib/trace-utils.mjs` (nouveau) + integration dans `visual-checks.mjs`

**Lifecycle** :
```
context.tracing.start({ screenshots: true, snapshots: true })
→ stopChunk()  // discard le chunk implicite de start()
Pour chaque page :
  → startChunk({ title: pageUrl })
  → goto + analyse + checks
  → Si issues BLOQUANT/IMPORTANT : stopChunk({ path }) → sauvegarde (2-8 MB)
  → Sinon : stopChunk() → discard (0 octets)
context.tracing.stop()  // cleanup
```

**Stockage** : `screenshots/{site}-{date}/traces/trace-{page-slug}.zip`
**Taille estimee** : 10-120 MB par audit (save conditionnel)
**Visualisation** : `npx playwright show-trace trace.zip` ou https://trace.playwright.dev/

### P2.2 — Objet Evidence par page
**Structure** :
```js
const evidence = {
  page: 'accueil',
  mobileScreenshot: 'screenshots/.../accueil-mobile.png',
  desktopScreenshot: 'screenshots/.../accueil-desktop.png',
  tracePath: 'screenshots/.../traces/trace-accueil.zip',  // null si pas d'issue
  consoleErrors: [...],   // collectes par P1.2
  pageErrors: [...],      // collectes par P1.2
  failedRequests: [...],  // collectes par P1.2
  timing: { loadMs: 2340, ttfb: 180 },
};
```

Chaque issue BLOQUANT/IMPORTANT pointe vers l'evidence de sa page.

### P2.3 — Lien artefacts dans rapport + ClickUp
**Rapport Markdown** : section "Preuves" avec liens vers traces
```markdown
### Preuves
- accueil : [trace](traces/trace-accueil.zip) | [mobile](accueil-mobile.png)
- contact : [trace](traces/trace-contact.zip) | [mobile](contact-mobile.png)
```

**ClickUp** : Liens de telechargement VPS (pas d'upload fichier, trop lourd)
**VPS** : Nginx sert les traces comme fichiers statiques (`/qa-traces/{site}/{date}/`)

**Critere de validation P2** :
- [ ] Traces generees uniquement pour pages avec issues BLOQUANT/IMPORTANT
- [ ] Trace visualisable dans trace.playwright.dev
- [ ] Evidence object complet pour chaque page auditee
- [ ] Liens fonctionnels dans le rapport et dans le commentaire ClickUp

---

## Sprint P3 — Rerun intelligent (2 chantiers)

> **Objectif** : Les pages suspectes sont automatiquement re-testees dans un contexte neuf pour une preuve propre.

### P3.1 — Detection pages suspectes
**Criteres de rerun automatique** :
- Issue BLOQUANT detectee
- Issue IMPORTANT visuel (IMG_BROKEN, HERO_TOO_TALL, BURGER_BROKEN, OVERFLOW)
- Faux positif suspect (CONTENT_CHECK_GSAP, timeout mobile)
- JS_UNCAUGHT_ERROR (confirmer dans un contexte propre)

### P3.2 — Rerun cible contexte neuf
**Process** :
1. Premier passage rapide (contexte mutualise, comme aujourd'hui)
2. Identification des pages suspectes (via P3.1)
3. Pour chaque page suspecte :
   - Nouveau `browser.newContext()` frais (0 contamination)
   - Tracing active des le depart
   - Memes checks que le premier passage
   - Comparaison resultats : si coherent → confirme le bug, si different → note l'ecart
4. Conservation de la meilleure preuve (premier passage vs rerun)

**Impact** : Pas de ralentissement du premier passage. Le rerun ne concerne que 3-5 pages en general.

**Critere de validation P3** :
- [ ] Rerun declenche automatiquement sur les bons criteres
- [ ] Contexte neuf = 0 contamination (cookies, localStorage, cache)
- [ ] Rapport indique "confirme par rerun" sur les issues validees
- [ ] Temps total acceptable (rerun ajoute < 30% au temps total)

---

## Versioning prevu

| Sprint | Version | Tag |
|--------|---------|-----|
| P1 — Fiabilisation | v3.0.0 | Majeure (breaking: addInitScript change le comportement Playwright) |
| P2 — Preuve | v3.1.0 | Mineure (ajout traces + evidence) |
| P3 — Rerun | v3.2.0 | Mineure (ajout rerun intelligent) |

---

## Panel de test

| Site | Secteur | Particularites |
|------|---------|---------------|
| camping-les-cinq-vallees.site.azko.fr | Camping | GSAP lourd, beaucoup de pages |
| camping-municipal-hippodrome.site.azko.fr | Camping | Template simple |
| camping-arquebuse.site.azko.fr | Camping | Images cassees, permission prompt, lazy load KO |
| lc-avocats.site.azko.fr | Avocat | 51 pages, hero trop haut, SSL expire |
| rousselavocat.azko.fr | Avocat | Template avocat standard |
| ordre-avocats-limoges.site.azko.fr | Avocat | Site institutionnel |
| hotel-lys-chablis.site.azko.fr | Hotel | Souvent en 503 (maintenance) |

**Regle** : Chaque chantier P1 est valide sur au minimum 3 sites (1 par secteur) avant merge.

---

*Document genere le 06 mars 2026 — QA-BALT v2.5.1*
