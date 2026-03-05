# QA-BALT — Architecture & Fonctionnement

> Outil de QA automatisé pour sites AZKO/BALT en préprod.
> Objectif : détecter tout ce qu'un humain verrait en naviguant sur le site.

---

## 1. VUE D'ENSEMBLE

```
┌─────────────────────────────────────────────────────────────────┐
│                        QA-BALT v2                               │
│                                                                 │
│   "Un robot qui navigue le site comme un humain,                │
│    clique partout, et remonte tout ce qui cloche."              │
│                                                                 │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│  MODULE  │  MODULE  │  MODULE  │  MODULE  │      MODULE         │
│    1     │    2     │    3     │    4     │        5            │
│          │          │          │          │                     │
│  Tech    │  Liens   │  Pages   │ Contenu  │     Visuel          │
│  Checks  │  Checks  │  Checks  │  Checks  │     Checks          │
│          │          │          │          │                     │
│ curl     │ curl     │ curl     │ curl     │  Playwright         │
│ rapide   │ rapide   │ rapide   │ rapide   │  + Chrome           │
├──────────┴──────────┴──────────┴──────────┴─────────────────────┤
│                                                                 │
│                    RAPPORT MARKDOWN                              │
│           (avec déduplication intelligente)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. PIPELINE D'EXÉCUTION

```
   URL du site préprod
          │
          ▼
   ┌──────────────┐
   │  1. CRAWL    │  Découvre toutes les pages
   │              │  (sitemap.xml + liens navigation)
   │  28 pages    │
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐
   │  2. STATUS   │  HEAD request sur chaque page
   │              │  → sépare les OK (200) des KO (404, 500...)
   └──────┬───────┘
          │
          ├──── pages OK ────────────────────────────────┐
          │                                              │
          ▼                                              ▼
   ┌──────────────────────────────────────┐    ┌─────────────────┐
   │  CHECKS RAPIDES (curl)              │    │ CHECKS VISUELS  │
   │                                      │    │ (Playwright)    │
   │  3. Tech    → SSL, robots, headers   │    │                 │
   │  4. Liens   → 404, redirections      │    │ Chrome réel     │
   │  5. Pages   → SEO, forms, images     │    │ mobile + desktop│
   │  6. Contenu → générique, placeholders│    │ screenshots     │
   │                                      │    │ animations GSAP │
   └──────────────┬───────────────────────┘    └────────┬────────┘
                  │                                      │
                  └──────────────┬───────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────┐
                  │  7. DÉDUPLICATION        │
                  │                          │
                  │  "Ce bug est sur 25/28   │
                  │   pages ? C'est le       │
                  │   header → 1 seul issue" │
                  └────────────┬─────────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │  8. RAPPORT .md          │
                  │                          │
                  │  Trié par sévérité :     │
                  │  BLOQUANT > IMPORTANT    │
                  │  > CHECKLIST MEP > MINEUR│
                  └──────────────────────────┘
```

---

## 3. LES 5 MODULES EN DÉTAIL

### MODULE 1 — Tech Checks (global)

```
┌─────────────────────────────────────────────────────┐
│  TECH CHECKS — Vérifie l'infrastructure du site     │
│                                                     │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ SSL / HTTPS     │  │ Sécurité                 │  │
│  │                 │  │                          │  │
│  │ • Cert expiré?  │  │ • X-Frame-Options       │  │
│  │ • Cert valide?  │  │ • X-Content-Type        │  │
│  │ • HTTP → HTTPS? │  │ • CSP                   │  │
│  └─────────────────┘  │ • Referrer-Policy       │  │
│                        └──────────────────────────┘  │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ SEO fondamental │  │ Code source              │  │
│  │                 │  │                          │  │
│  │ • robots.txt   │  │ • <base href> préprod?   │  │
│  │ • sitemap.xml  │  │ • Canonical préprod?     │  │
│  │ • Noindex?     │  │ • OG tags préprod?       │  │
│  └─────────────────┘  │ • Images sans dimensions │  │
│                        │ • target=_blank sécurité │  │
│                        │ • Protocol-relative URLs │  │
│                        └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### MODULE 2 — Link Checks (tous les liens)

```
┌─────────────────────────────────────────────────────┐
│  LINK CHECKS — Clique sur TOUS les liens            │
│                                                     │
│  Étape 1 : Extraction                               │
│  ┌───────────────────────────────────────────────┐  │
│  │  Chaque page → récupère tous les <a href>     │  │
│  │  3305 liens bruts → 227 uniques (dédup)       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Étape 2 : Analyse HTML                             │
│  ┌───────────────────────────────────────────────┐  │
│  │  • Ancres vides (href="#" ou href="")          │  │
│  │  • javascript:void(0)                          │  │
│  │  • tel: mal formaté                            │  │
│  │  • mailto: vide                                │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Étape 3 : Liens internes (HEAD request)            │
│  ┌───────────────────────────────────────────────┐  │
│  │  • 404 → lien cassé                           │  │
│  │  • 301/302 → redirection (à corriger?)        │  │
│  │  • PDF cassés (fréquent!)                      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Étape 4 : Liens externes (HEAD request)            │
│  ┌───────────────────────────────────────────────┐  │
│  │  • Liens vers des sites tiers cassés           │  │
│  │  • Google Maps, réseaux sociaux, partenaires   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### MODULE 3 — Page Checks (navigation page par page)

```
┌──────────────────────────────────────────────────────┐
│  PAGE CHECKS — Ce qu'un humain voit en naviguant     │
│                                                      │
│  Sur CHAQUE page :                                   │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │  SEO par page                                  │  │
│  │  ├── Title manquant / trop court / trop long   │  │
│  │  ├── Title contient "site.azko.fr"             │  │
│  │  ├── Meta description manquante / longue       │  │
│  │  ├── H1 manquant ou multiple                   │  │
│  │  └── Hiérarchie Hn cassée (H2 → H4 = skip)    │  │
│  │                                                │  │
│  │  UX / Fonctionnel                              │  │
│  │  ├── Page contact sans formulaire              │  │
│  │  ├── Téléphone affiché mais pas cliquable      │  │
│  │  ├── Google Maps au point 0,0 (ou Paris)       │  │
│  │  ├── Liens sans texte ni alt                   │  │
│  │  └── Modules AZKO vides dans le HTML           │  │
│  │                                                │  │
│  │  Performance                                   │  │
│  │  └── Images > 500 Ko (top 8 listées)           │  │
│  │                                                │  │
│  │  Légal                                         │  │
│  │  └── Mentions légales : SIRET, hébergeur, édi. │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Cross-page (comparaison entre pages) :              │
│  ┌────────────────────────────────────────────────┐  │
│  │  • Titles dupliqués sur plusieurs pages         │  │
│  │  • Meta descriptions dupliquées                 │  │
│  │  • Pages orphelines (sitemap mais pas dans nav) │  │
│  │  • Favicon manquant                             │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### MODULE 4 — Content Checks (contenu générique)

```
┌──────────────────────────────────────────────────────┐
│  CONTENT CHECKS — Détecter le contenu non perso      │
│                                                      │
│  STRATÉGIE 1 : Patterns (toujours active)            │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │  Auto-détection du secteur :                   │  │
│  │  avocat | notaire | camping/hôtel              │  │
│  │                                                │  │
│  │  Universel :                                   │  │
│  │  ├── [Nom du cabinet], {ADRESSE}, XXX €        │  │
│  │  ├── Téléphones placeholder (01 00 00 00 00)   │  │
│  │  ├── Emails placeholder (contact@exemple.fr)   │  │
│  │  └── Adresses placeholder                      │  │
│  │                                                │  │
│  │  Avocats :                                     │  │
│  │  ├── "Cabinet [Nom]", "Maître [Nom]"           │  │
│  │  ├── "Barreau de [Ville]"                      │  │
│  │  ├── Tarifs consultation placeholder           │  │
│  │  └── Page compétences ultra-générique          │  │
│  │                                                │  │
│  │  Campings :                                    │  │
│  │  ├── "Camping [Nom]", tarif nuitée placeholder │  │
│  │  └── Distances placeholder                     │  │
│  │                                                │  │
│  │  Pages sensibles :                             │  │
│  │  ├── /tarifs → vérifie qu'il y a de vrais €    │  │
│  │  └── /competences → détecte texte générique    │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  STRATÉGIE 2 : Comparaison modèle (si URL dispo)    │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │  Site client          Site modèle              │  │
│  │  ┌──────────┐        ┌──────────┐             │  │
│  │  │ /tarifs  │───VS───│ /tarifs  │             │  │
│  │  │ 450 mots │        │ 450 mots │             │  │
│  │  └──────────┘        └──────────┘             │  │
│  │       │                    │                   │  │
│  │       └────────┬───────────┘                   │  │
│  │                ▼                               │  │
│  │         Similarité 95%                         │  │
│  │         → BLOQUANT !                           │  │
│  │         "Contenu pas personnalisé"             │  │
│  │                                                │  │
│  │  Seuils :                                      │  │
│  │  > 90% identique → BLOQUANT                   │  │
│  │  > 70% identique → IMPORTANT                  │  │
│  │  > 50% identique → MINEUR (à vérifier)        │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### MODULE 5 — Visual Checks (Playwright + Chrome)

```
┌──────────────────────────────────────────────────────┐
│  VISUAL CHECKS — Un vrai navigateur Chrome           │
│                                                      │
│  Pourquoi Chrome et pas juste curl ?                 │
│  → Les animations GSAP/ScrollTrigger ne se           │
│    déclenchent qu'avec un vrai navigateur.            │
│  → Certains bugs ne sont visibles qu'au rendu.       │
│                                                      │
│  ┌─ COUCHE 1 : Mobile (390px) ────────────────────┐  │
│  │                                                 │  │
│  │  📱 Screenshot de chaque page                   │  │
│  │  • Images cassées (naturalWidth === 0)          │  │
│  │  • Contenu suspect (lorem, placeholder, sample) │  │
│  │  • Ressources 404 (JS, CSS, images)             │  │
│  │                                                 │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌─ COUCHE 2 : Desktop + Force Visible ───────────┐  │
│  │                                                 │  │
│  │  🖥️  Injection JS pour révéler les éléments     │  │
│  │     cachés par GSAP (opacity:0, transform)      │  │
│  │                                                 │  │
│  │  • Boutons "Commander catalogue" visibles?      │  │
│  │  • Liens .site.azko.fr dans le contenu?         │  │
│  │  • Éléments internes AZKO restants?             │  │
│  │                                                 │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌─ COUCHE 3 : HTML brut ─────────────────────────┐  │
│  │                                                 │  │
│  │  📄 page.content() → vérifier que le HTML       │  │
│  │     contient réellement du contenu              │  │
│  │     (pas juste un squelette vide)               │  │
│  │                                                 │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## 4. SYSTÈME DE SÉVÉRITÉ

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  🔴 BLOQUANT         Empêche la mise en prod                   │
│  ──────────────────────────────────────────                     │
│  • SSL expiré / invalide                                        │
│  • Contenu 95% identique au modèle                              │
│  • Prix placeholder sur /tarifs                                  │
│                                                                 │
│  🟡 IMPORTANT        Impact UX / SEO — à corriger vite         │
│  ──────────────────────────────────────────                     │
│  • Liens 404, images >500Ko                                     │
│  • Title/H1 manquants, formulaire cassé                         │
│  • Contenu générique détecté                                    │
│  • Téléphone pas cliquable                                      │
│                                                                 │
│  🔵 CHECKLIST MEP    Normal en préprod, à vérifier au go-live  │
│  ──────────────────────────────────────────                     │
│  • Noindex (normal en préprod)                                  │
│  • robots.txt bloque tout (normal en préprod)                   │
│  • Canonical pointe vers .site.azko.fr                          │
│  • SSL partagé (normal en préprod)                              │
│                                                                 │
│  ⚪ MINEUR            Nettoyage / optimisation                  │
│  ──────────────────────────────────────────                     │
│  • Title trop long, meta desc longue                            │
│  • Hiérarchie Hn, pages orphelines                              │
│  • Security headers manquants                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. DÉDUPLICATION INTELLIGENTE

```
   AVANT dédup (250 issues brutes)          APRÈS dédup (105 issues)
   ─────────────────────────────            ────────────────────────

   BLANK_NO_NOOPENER — accueil              BLANK_NO_NOOPENER
   BLANK_NO_NOOPENER — tarifs                 (template — 25 pages)
   BLANK_NO_NOOPENER — contact                → 1 seul issue
   BLANK_NO_NOOPENER — equipe
   BLANK_NO_NOOPENER — page1               IMG_HEAVY
   BLANK_NO_NOOPENER — page2                 → page spécifique
   ... (x25 pages)
                                            FORM_MISSING — contact
   IMG_HEAVY — page3                          → page spécifique
     (spécifique à 1 page)

   FORM_MISSING — contact
     (spécifique à 1 page)

   ┌──────────────────────────────────────────────────────────┐
   │  Règle : si un même problème apparaît sur >40% des      │
   │  pages, c'est un problème de TEMPLATE (header/footer).   │
   │  → Regroupé en 1 seul issue avec mention "(template)"    │
   └──────────────────────────────────────────────────────────┘
```

---

## 6. INTÉGRATION CLICKUP

```
   ┌─────────────────────────────────────────────────────────┐
   │                      CLICKUP                             │
   │                                                         │
   │  Tâche : "Site Cabinet Dupont"                          │
   │  ├── Champ "URL Préprod" : http://dupont.site.azko.fr  │
   │  ├── Champ "Modèle" : alimon  (optionnel)              │
   │  │                                                      │
   │  │  ┌─────────────────────┐                             │
   │  │  │  🔘 Lancer QA      │ ← Bouton (Manual Trigger)   │
   │  │  └─────────┬───────────┘                             │
   │  └────────────┼─────────────────────────────────────────┘
                   │
                   │  POST /api/qa { task_id: "abc123" }
                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │                   VPS (83.228.208.83)                    │
   │                                                         │
   │   ┌─────────────┐    ┌─────────────────────────────┐   │
   │   │   NGINX     │───▶│   QA-BALT Server (port 3847)│   │
   │   │   reverse   │    │                             │   │
   │   │   proxy     │    │  1. Reçoit le webhook       │   │
   │   └─────────────┘    │  2. Récupère URL préprod    │   │
   │                       │     + URL modèle (ClickUp)  │   │
   │                       │  3. Lance qa.mjs            │   │
   │                       │  4. Poste le rapport        │   │
   │                       │     en commentaire ClickUp  │   │
   │                       │  5. Change le statut        │   │
   │                       │     (QA OK / QA KO)         │   │
   │                       └─────────────────────────────┘   │
   └─────────────────────────────────────────────────────────┘
                   │
                   │  POST /task/{id}/comment
                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │                      CLICKUP                             │
   │                                                         │
   │  Tâche : "Site Cabinet Dupont"                          │
   │  Statut : QA KO ← (automatique si bloquants)           │
   │                                                         │
   │  💬 Commentaire :                                       │
   │  ┌───────────────────────────────────────────────────┐  │
   │  │ # QA Pre-Prod — Cabinet Dupont                    │  │
   │  │                                                   │  │
   │  │ BLOQUANT : 2                                      │  │
   │  │ IMPORTANT : 8                                     │  │
   │  │ MINEUR : 5                                        │  │
   │  │                                                   │  │
   │  │ 1. Contenu 95% identique au modèle (tarifs)      │  │
   │  │ 2. SSL expiré                                     │  │
   │  │ ...                                               │  │
   │  └───────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────┘
```

---

## 7. COMMENT LANCER MANUELLEMENT

```bash
# Audit complet (tech + liens + pages + contenu + visuel)
node qa.mjs http://camping-arquebuse.site.azko.fr

# Tech seul (rapide, ~30 sec)
node qa.mjs http://camping-arquebuse.site.azko.fr --tech-only

# Visuel seul (Playwright, ~2-3 min)
node qa.mjs http://camping-arquebuse.site.azko.fr --visual-only

# Avec comparaison modèle
node qa.mjs http://cabinet-dupont.site.azko.fr --model-url http://alimon.site.azko.fr
```

---

## 8. CE QU'ON DÉTECTE — RÉSUMÉ

```
┌──────────────┬────────────────────────────────────────────────┐
│ CATÉGORIE    │ CHECKS                                         │
├──────────────┼────────────────────────────────────────────────┤
│              │ SSL expiré / invalide                          │
│              │ Site en HTTP (pas HTTPS)                       │
│ INFRA &      │ robots.txt / sitemap.xml                      │
│ SÉCURITÉ     │ Security headers manquants                    │
│              │ Formulaire sur HTTP                            │
│              │ target=_blank sans noopener                    │
├──────────────┼────────────────────────────────────────────────┤
│              │ Liens 404 (internes + externes)               │
│ LIENS        │ PDFs cassés                                   │
│              │ Redirections inutiles                          │
│              │ Ancres vides, javascript:void                  │
│              │ tel: / mailto: mal formatés                    │
├──────────────┼────────────────────────────────────────────────┤
│              │ Title manquant / court / long / dupliqué       │
│              │ Meta description manquante / dupliquée         │
│ SEO          │ H1 manquant / multiple                        │
│              │ Hiérarchie Hn cassée                           │
│              │ Canonical / OG vers préprod                    │
│              │ Noindex sur les pages                          │
│              │ Pages orphelines                               │
├──────────────┼────────────────────────────────────────────────┤
│              │ Formulaire contact absent                      │
│              │ Téléphone pas cliquable (mobile!)              │
│ UX /         │ Google Maps 0,0 ou Paris par défaut           │
│ FONCTIONNEL  │ Images > 500 Ko                               │
│              │ Images sans dimensions (CLS)                   │
│              │ Favicon manquant                               │
│              │ Liens sans texte ni alt                        │
│              │ Modules AZKO vides                             │
│              │ Mentions légales incomplètes                   │
├──────────────┼────────────────────────────────────────────────┤
│              │ Placeholders [Nom], XXX, {ADRESSE}            │
│ CONTENU      │ Prix placeholder (XX €)                       │
│ GÉNÉRIQUE    │ Email/téléphone/adresse template               │
│              │ Phrases template BALT connues                  │
│              │ Page tarifs sans vrais prix                    │
│              │ Compétences avocat ultra-génériques            │
│              │ Comparaison page-par-page vs modèle           │
├──────────────┼────────────────────────────────────────────────┤
│              │ Lorem ipsum, placeholder, sample data          │
│ VISUEL       │ Images cassées (rendu navigateur)             │
│ (Chrome)     │ Boutons catalogue AZKO visibles               │
│              │ Liens .site.azko.fr visibles                  │
│              │ Contenu vide (GSAP non déclenché)             │
│              │ Screenshots mobile + desktop                   │
├──────────────┼────────────────────────────────────────────────┤
│              │ Éléments .site.azko.fr                         │
│ PRÉPROD      │ base href préprod                             │
│ (CHECKLIST)  │ Noindex / robots disallow                     │
│              │ SSL partagé                                    │
└──────────────┴────────────────────────────────────────────────┘
```

---

## 9. POUR LES INTÉGRATEURS — PATTERNS À AJOUTER ?

Questions pour la réunion :

1. **Quels bugs revenez-vous corriger le plus souvent après une MEP ?**
2. **Quels éléments AZKO oubliez-vous parfois de personnaliser ?**
3. **Y a-t-il des modules/composants spécifiques qui cassent souvent ?**
4. **Quels retours clients reviennent systématiquement ?**
5. **Des patterns spécifiques à un secteur (notaire, avocat, camping, CDJ) ?**

> Chaque pattern remonté par les intégrateurs sera ajouté comme nouveau check.
> L'objectif : qu'aucun humain ne puisse trouver un bug que QA-BALT n'a pas vu.

---

## 10. FICHIERS DU PROJET

```
qa-balt/
├── qa.mjs                    ← Orchestrateur principal
├── server.mjs                ← Serveur webhook (Express)
├── package.json              ← Dépendances (express, playwright)
├── .env.example              ← Config (token ClickUp, port)
│
├── lib/
│   ├── crawler.mjs           ← Découverte des pages (sitemap + nav)
│   ├── tech-checks.mjs       ← Module 1 : checks techniques
│   ├── link-checks.mjs       ← Module 2 : validation des liens
│   ├── page-checks.mjs       ← Module 3 : checks par page
│   ├── content-checks.mjs    ← Module 4 : contenu générique
│   ├── visual-checks.mjs     ← Module 5 : checks visuels Playwright
│   ├── report.mjs            ← Génération rapport + déduplication
│   └── clickup.mjs           ← API ClickUp (get task, post comment)
│
├── reports/                  ← Rapports générés (.md)
├── screenshots/              ← Screenshots Playwright
├── deploy/
│   └── setup-vps.sh          ← Script d'installation VPS
└── docs/
    └── architecture-qa-balt.md  ← Ce document
```
