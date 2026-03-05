/**
 * Checks techniques (curl-based, fiables)
 * Ne dépend PAS de Playwright — fonctionne sur le HTML brut
 */
import { execSync } from 'child_process';

export function runTechChecks(baseUrl) {
  const issues = [];
  const info = {};

  // Détection préprod AZKO (.site.azko.fr)
  const domain = new URL(baseUrl).hostname;
  const isPreprod = domain.includes('.site.azko.fr');
  info.isPreprod = isPreprod;

  // Helper : sur préprod, certaines issues deviennent "CHECKLIST_MEP" au lieu de "BLOQUANT"
  const preprodOrBloquant = (id) => isPreprod ? 'CHECKLIST_MEP' : 'BLOQUANT';

  // ═══════════════════════════════════════
  // 1. SSL
  // ═══════════════════════════════════════
  try {
    const domain = new URL(baseUrl).hostname;
    const ssl = execSync(
      `echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    info.ssl = ssl.trim();
    const notAfter = ssl.match(/notAfter=(.+)/)?.[1];
    const subject = ssl.match(/subject=.*CN\s*=\s*(.+)/)?.[1];

    if (notAfter) {
      const expiry = new Date(notAfter);
      if (expiry < new Date()) {
        issues.push({
          severity: preprodOrBloquant('SSL_EXPIRED'),
          id: 'SSL_EXPIRED',
          title: 'Certificat SSL expiré',
          detail: `Expiré le ${notAfter}. Sujet: ${subject || 'inconnu'}`,
        });
      }
      if (subject && !subject.includes(domain)) {
        issues.push({
          severity: preprodOrBloquant('SSL_WRONG_DOMAIN'),
          id: 'SSL_WRONG_DOMAIN',
          title: 'Certificat SSL pour un autre domaine',
          detail: `Le certificat est pour "${subject}", pas pour "${domain}"`,
        });
      }
    }
  } catch (e) {
    // Pas de SSL du tout
    info.ssl = 'non disponible';
  }

  // ═══════════════════════════════════════
  // 2. Headers HTTP + Security headers (Screaming Frog parity)
  // ═══════════════════════════════════════
  let responseHeaders = '';
  try {
    responseHeaders = execSync(
      `curl -sI -k --max-time 10 "${baseUrl}/" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    info.server = responseHeaders.match(/Server:\s*(.+)/i)?.[1]?.trim();
    info.httpStatus = responseHeaders.match(/HTTP\/[\d.]+ (\d+)/)?.[1];
  } catch (e) {
    // skip
  }

  // --- Site en HTTP (pas HTTPS) ---
  if (baseUrl.startsWith('http://')) {
    issues.push({
      severity: isPreprod ? 'CHECKLIST_MEP' : 'BLOQUANT',
      id: 'SITE_HTTP',
      title: 'Site en HTTP (pas HTTPS)',
      detail: isPreprod
        ? 'Le site est en HTTP. Vérifier que le HTTPS est configuré pour la prod.'
        : 'Le site est en HTTP — non sécurisé, Chrome affiche "Non sécurisé". Passer en HTTPS.',
    });
  }

  // --- Security headers ---
  if (responseHeaders) {
    const missingHeaders = [];

    if (!/x-frame-options/i.test(responseHeaders)) {
      missingHeaders.push('X-Frame-Options');
    }
    if (!/x-content-type-options/i.test(responseHeaders)) {
      missingHeaders.push('X-Content-Type-Options');
    }
    if (!/content-security-policy/i.test(responseHeaders)) {
      missingHeaders.push('Content-Security-Policy');
    }
    if (!/referrer-policy/i.test(responseHeaders)) {
      missingHeaders.push('Referrer-Policy');
    }

    if (missingHeaders.length > 0) {
      issues.push({
        severity: 'MINEUR',
        id: 'SECURITY_HEADERS_MISSING',
        title: `${missingHeaders.length} en-tête(s) de sécurité manquant(s)`,
        detail: `Manque: ${missingHeaders.join(', ')} — recommandé pour la sécurité.`,
      });
    }
  }

  // ═══════════════════════════════════════
  // 3. HTML Homepage — analyse complète
  // ═══════════════════════════════════════
  let html = '';
  try {
    html = execSync(
      `curl -sL -k --max-time 30 "${baseUrl}/" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 35000 }
    );
  } catch (e) {
    issues.push({
      severity: 'BLOQUANT',
      id: 'SITE_UNREACHABLE',
      title: 'Site injoignable',
      detail: `Impossible de charger ${baseUrl}/`,
    });
    return { issues, info };
  }

  // --- Meta robots noindex ---
  if (/content\s*=\s*"noindex/i.test(html)) {
    issues.push({
      severity: preprodOrBloquant('NOINDEX'),
      id: 'NOINDEX',
      title: 'Meta robots noindex,nofollow',
      detail: isPreprod ? 'Noindex en place (normal en préprod). A retirer pour la prod.' : 'Le site sera invisible pour Google. A retirer immédiatement.',
    });
  }

  // --- Canonical pointe vers préprod ---
  const canonical = html.match(/rel="canonical"\s+href="([^"]+)"/)?.[1];
  if (canonical && canonical.includes('.site.azko.fr')) {
    issues.push({
      severity: preprodOrBloquant('CANONICAL_PREPROD'),
      id: 'CANONICAL_PREPROD',
      title: 'URL canonical pointe vers la préprod',
      detail: `canonical: ${canonical}` + (isPreprod ? ' — À remplacer par le domaine prod lors de la MEP.' : ''),
    });
  }

  // --- OG URL pointe vers préprod ---
  const ogUrl = html.match(/property="og:url"\s+content="([^"]+)"/)?.[1];
  if (ogUrl && ogUrl.includes('.site.azko.fr')) {
    issues.push({
      severity: preprodOrBloquant('OG_PREPROD'),
      id: 'OG_PREPROD',
      title: 'og:url pointe vers la préprod',
      detail: `og:url: ${ogUrl}` + (isPreprod ? ' — À remplacer lors de la MEP.' : ''),
    });
  }

  // --- Base href préprod ---
  const baseHref = html.match(/<base\s+href="([^"]+)"/)?.[1];
  if (baseHref && baseHref.includes('.site.azko.fr')) {
    issues.push({
      severity: preprodOrBloquant('BASE_HREF_PREPROD'),
      id: 'BASE_HREF_PREPROD',
      title: '<base href> pointe vers la préprod',
      detail: `base href: ${baseHref}` + (isPreprod ? ' — À remplacer lors de la MEP.' : ''),
    });
  }

  // --- Tel en mailto ---
  const telMailto = html.match(/href="mailto:(\+33[^"]+)"/);
  if (telMailto) {
    issues.push({
      severity: 'BLOQUANT',
      id: 'TEL_MAILTO',
      title: 'Numéro de téléphone avec mailto: au lieu de tel:',
      detail: `href="mailto:${telMailto[1]}" → devrait être href="tel:..."`,
    });
  }

  // --- Schema.org GPS 0,0 ---
  const latMatch = html.match(/"latitude"\s*:\s*([\d.]+)/);
  const lngMatch = html.match(/"longitude"\s*:\s*([\d.]+)/);
  if (latMatch && lngMatch && latMatch[1] === '0' && lngMatch[1] === '0') {
    issues.push({
      severity: 'BLOQUANT',
      id: 'SCHEMA_GPS_ZERO',
      title: 'Coordonnées GPS Schema.org à 0,0',
      detail: 'latitude: 0, longitude: 0 → océan Atlantique. A corriger.',
    });
  }

  // --- Schema.org nom avec code interne ---
  const schemaName = html.match(/"name"\s*:\s*"([^"]+)"/);
  if (schemaName && /\s-\s[A-Z]\d{3,}/.test(schemaName[1])) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'SCHEMA_NAME_INTERNAL',
      title: 'Code interne dans le Schema.org name',
      detail: `name: "${schemaName[1]}" — retirer le code interne`,
    });
  }

  // --- Footer email vide ---
  if (/class="footer__mail"[^>]*>\s*Mail\s*:\s*<\/div/i.test(html) ||
      /class="footer__mail">\s*Mail\s*:\s*$/m.test(html)) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'FOOTER_EMAIL_EMPTY',
      title: 'Footer "Mail :" sans adresse email',
      detail: 'Le footer affiche "Mail :" sans email derrière.',
    });
  }

  // --- Réseaux sociaux vides ---
  if (/<div[^>]*class="[^"]*topRS[^"]*"[^>]*>\s*<\/div/i.test(html)) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'SOCIAL_EMPTY',
      title: 'Espaces réseaux sociaux vides',
      detail: 'Les zones prévues pour les RS (header/footer) sont vides.',
    });
  }

  // --- Boutons catalogue AZKO ---
  if (/btn-catalogue/i.test(html) && /catalogue-campings\.azko\.fr/i.test(html)) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'CATALOGUE_AZKO_VISIBLE',
      title: 'Boutons catalogue AZKO visibles',
      detail: 'Les boutons "Choisir ce modèle" / "Voir le catalogue" sont dans le HTML.',
    });
  }

  // --- Viewport bloque zoom ---
  if (/user-scalable\s*=\s*no/i.test(html)) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'ZOOM_BLOCKED',
      title: 'Zoom mobile bloqué (user-scalable=no)',
      detail: 'Problème accessibilité WCAG 1.4.4 + signal négatif Google.',
    });
  }

  // --- Alt images génériques ---
  const genericAlts = html.match(/alt="(Diaporama|Image|Photo|img)"/gi);
  if (genericAlts && genericAlts.length > 2) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'ALT_GENERIC',
      title: `${genericAlts.length} images avec alt générique`,
      detail: 'alt="Diaporama" etc. Pas descriptif pour le SEO/accessibilité.',
    });
  }

  // --- Images sans alt ---
  const noAlt = html.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (noAlt && noAlt.length > 0) {
    issues.push({
      severity: 'IMPORTANT',
      id: 'ALT_MISSING',
      title: `${noAlt.length} images sans attribut alt`,
      detail: 'Impact SEO et accessibilité.',
    });
  }

  // --- Meta keywords vide ---
  if (/name="keywords"\s+content=""\s*\/>/i.test(html)) {
    issues.push({
      severity: 'MINEUR',
      id: 'META_KEYWORDS_EMPTY',
      title: 'Meta keywords vide',
      detail: 'Soit le remplir, soit le supprimer.',
    });
  }

  // --- Copyright année périmée ---
  const currentYear = new Date().getFullYear();
  const copyrightYear = html.match(/©\s*(\d{4})/)?.[1];
  if (copyrightYear && parseInt(copyrightYear) < currentYear) {
    issues.push({
      severity: 'MINEUR',
      id: 'COPYRIGHT_OLD',
      title: `Copyright ${copyrightYear} au lieu de ${currentYear}`,
      detail: 'Mettre à jour ou rendre dynamique.',
    });
  }

  // --- Axeptio vide ---
  if (/CONSENT AXEPTIO DEBUT\s*-->\s*<!--\s*CONSENT AXEPTIO FIN/i.test(html)) {
    issues.push({
      severity: 'MINEUR',
      id: 'AXEPTIO_EMPTY',
      title: 'Balises Axeptio vides',
      detail: 'Le block CONSENT AXEPTIO est vide. Vérifier la conformité RGPD cookies.',
    });
  }

  // --- Images sans width/height (CLS) ---
  const imgsNoSize = html.match(/<img(?![^>]*(?:width|style\s*=\s*"[^"]*width))[^>]*>/gi);
  if (imgsNoSize && imgsNoSize.length > 3) {
    issues.push({
      severity: 'MINEUR',
      id: 'IMG_NO_DIMENSIONS',
      title: `${imgsNoSize.length} images sans attributs width/height`,
      detail: 'Cause des Layout Shifts (CLS) au chargement. Définir width et height dans le HTML.',
    });
  }

  // --- Protocol-relative links (//url) ---
  const protoRelative = html.match(/(?:src|href)="\/\/[^"]+"/gi);
  if (protoRelative && protoRelative.length > 0) {
    issues.push({
      severity: 'MINEUR',
      id: 'PROTOCOL_RELATIVE',
      title: `${protoRelative.length} lien(s) sans protocole (//url)`,
      detail: 'Anti-pattern — utiliser des URLs absolues avec https://.',
    });
  }

  // --- target="_blank" sans rel="noopener" ---
  const blankLinks = [...html.matchAll(/<a\s([^>]*target="_blank"[^>]*)>/gi)];
  let unsafeBlankCount = 0;
  for (const m of blankLinks) {
    const attrs = m[1];
    if (!/rel="[^"]*noopener/i.test(attrs)) {
      unsafeBlankCount++;
    }
  }
  if (unsafeBlankCount > 0) {
    issues.push({
      severity: 'MINEUR',
      id: 'BLANK_NO_NOOPENER',
      title: `${unsafeBlankCount} lien(s) target="_blank" sans rel="noopener"`,
      detail: 'Risque de sécurité (window.opener) sur anciens navigateurs.',
    });
  }

  // --- Formulaire sur page HTTP ---
  if (baseUrl.startsWith('http://') && /<form[^>]*>/i.test(html)) {
    issues.push({
      severity: isPreprod ? 'CHECKLIST_MEP' : 'BLOQUANT',
      id: 'FORM_HTTP',
      title: 'Formulaire sur page HTTP (non sécurisé)',
      detail: 'Les données saisies (nom, email, tel) ne sont pas chiffrées.',
    });
  }

  // --- H3 "Fichiers joints" abusifs ---
  const fichiers = html.match(/<h3>Fichiers joints\s*:<\/h3>/gi);
  if (fichiers && fichiers.length > 2) {
    issues.push({
      severity: 'MINEUR',
      id: 'H3_FICHIERS_JOINTS',
      title: `<h3>Fichiers joints</h3> x${fichiers.length}`,
      detail: 'Balise h3 utilisée pour du contenu non-titre. Devrait être <span>.',
    });
  }

  // ═══════════════════════════════════════
  // 4. Politique de confidentialité
  // ═══════════════════════════════════════
  try {
    const pdcStatus = execSync(
      `curl -sL -k --max-time 10 "${baseUrl}/politique-de-confidentialite.htm" -o /dev/null -w "%{http_code}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();

    if (pdcStatus === '404' || pdcStatus === '000') {
      // Vérifier si c'est une page 404 soft
      const pdcHtml = execSync(
        `curl -sL -k --max-time 10 "${baseUrl}/politique-de-confidentialite.htm" 2>/dev/null | head -20`,
        { encoding: 'utf-8', timeout: 15000 }
      );
      if (/introuvable|not found|404/i.test(pdcHtml) || pdcStatus === '404') {
        issues.push({
          severity: 'BLOQUANT',
          id: 'PRIVACY_404',
          title: 'Page Politique de confidentialité = 404',
          detail: 'Obligatoire RGPD (formulaire de contact + cookies présents).',
        });
      }
    }
  } catch (e) {
    // skip
  }

  // ═══════════════════════════════════════
  // 5. Sitemap + Robots
  // ═══════════════════════════════════════
  try {
    const robotsTxt = execSync(
      `curl -sL -k --max-time 10 "${baseUrl}/robots.txt" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    info.robotsTxt = robotsTxt.length > 10 ? 'présent' : 'vide';

    if (robotsTxt.includes('Disallow: /')) {
      const disallowAll = robotsTxt.match(/Disallow:\s*\/\s*$/m);
      if (disallowAll) {
        issues.push({
          severity: preprodOrBloquant('ROBOTS_DISALLOW_ALL'),
          id: 'ROBOTS_DISALLOW_ALL',
          title: 'robots.txt bloque tout le site (Disallow: /)',
          detail: isPreprod ? 'Normal en préprod. À ouvrir lors de la MEP.' : 'A corriger immédiatement — le site est invisible.',
        });
      }
    }
  } catch (e) {
    info.robotsTxt = 'absent';
  }

  try {
    const sitemapStatus = execSync(
      `curl -sL -k --max-time 10 "${baseUrl}/sitemap.xml" -o /dev/null -w "%{http_code}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    info.sitemap = sitemapStatus === '200' ? 'présent' : `HTTP ${sitemapStatus}`;
  } catch (e) {
    info.sitemap = 'absent';
  }

  // ═══════════════════════════════════════
  // 6. Pages AZKO par défaut (doivent être bloquées)
  // ═══════════════════════════════════════
  const defaultPages = [
    { path: '/annonces', label: 'Liste brute des annonces', realPages: '/locations.htm et /emplacements.htm' },
  ];

  // Détection du noindex global (préprod) pour ne pas confondre avec un noindex spécifique
  const hasGlobalNoindex = /content\s*=\s*"noindex/i.test(html);

  for (const dp of defaultPages) {
    try {
      const dpHeaders = execSync(
        `curl -sI -L -k --max-time 10 "${baseUrl}${dp.path}" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 15000 }
      );
      const dpStatus = dpHeaders.match(/HTTP\/[\d.]+ (\d+)/g);
      const finalStatus = dpStatus?.[dpStatus.length - 1]?.match(/HTTP\/[\d.]+ (\d+)/)?.[1];

      if (finalStatus === '200') {
        // La page est accessible — vérifier si elle a un noindex propre
        let dpHtml = '';
        try {
          dpHtml = execSync(
            `curl -sL -k --max-time 10 "${baseUrl}${dp.path}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 15000 }
          );
        } catch (_) { /* skip */ }

        const hasOwnNoindex = /content\s*=\s*"noindex/i.test(dpHtml);
        const noindexNote = hasOwnNoindex && !hasGlobalNoindex
          ? ' (noindex détecté sur la page)'
          : hasGlobalNoindex
            ? ' (noindex global préprod — ne protège pas en prod)'
            : ' (aucun noindex sur la page)';

        issues.push({
          severity: isPreprod ? 'IMPORTANT' : 'BLOQUANT',
          id: 'DEFAULT_PAGE_ACCESSIBLE',
          title: `Page CMS par défaut accessible : ${dp.path}`,
          detail: `${dp.label} — cette page est générée automatiquement par le CMS et fait doublon avec les vraies pages ${dp.realPages}. `
            + `Elle n'est pas dans la navigation ni le sitemap mais reste accessible en URL directe${noindexNote}. `
            + (isPreprod
              ? 'À bloquer avant la MEP : redirection 301 vers la page réelle, ou 404, ou noindex spécifique.'
              : 'Contenu dupliqué indexable en prod — à bloquer immédiatement (301 vers la page réelle ou 404).'),
        });
      }
    } catch (e) {
      // Page inaccessible → OK, rien à signaler
    }
  }

  return { issues, info };
}
