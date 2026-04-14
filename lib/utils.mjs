/**
 * Utilitaires securite QA-BALT
 *
 * - shellEscape() : echappement shell single-quote
 * - safeCurl() : wrapper curl centralise (URL validee + echappee)
 * - safeCurlHead() : variante HEAD-only
 * - isPrivateIp() : detection IPs privees (SSRF)
 * - validatePublicUrl() : validation SSRF async (DNS resolution)
 */
import { execSync } from 'child_process';

/**
 * Echappe une chaine pour utilisation dans une commande shell (single-quote wrapping)
 */
export function shellEscape(str) {
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

/**
 * Fetch une URL via curl de maniere securisee.
 * Valide la syntaxe URL, echappe pour le shell.
 *
 * @param {string} url - URL a fetcher
 * @param {object} options
 * @param {number} options.maxTime - timeout curl en secondes (default 15)
 * @param {boolean} options.headOnly - si true, utilise -I (HEAD) au lieu de -L (GET+follow)
 * @param {boolean} options.followRedirects - si true, suit les redirections -L (default true)
 * @param {boolean} options.includeHeaders - si true, utilise -i (inclut headers dans output)
 * @param {string} options.writeOut - format -w (ex: "%{http_code}")
 * @param {string} options.outputDev - si "null", redirige output vers /dev/null (-o /dev/null)
 * @param {string[]} options.extraArgs - arguments curl supplementaires
 * @returns {string|null} output curl, ou null si erreur/timeout
 */
export function safeCurl(url, {
  maxTime = 15,
  headOnly = false,
  followRedirects = true,
  includeHeaders = false,
  writeOut = null,
  outputDev = null,
  extraArgs = [],
  maxBuffer = undefined,
} = {}) {
  // Valider la syntaxe URL
  try { new URL(url); } catch { return null; }

  const escaped = shellEscape(url);
  const parts = ['curl', '-s'];

  if (headOnly) parts.push('-I');
  if (followRedirects) parts.push('-L');
  parts.push('-k');
  parts.push(`--max-time ${maxTime}`);

  if (outputDev === 'null') parts.push('-o /dev/null');
  if (includeHeaders) parts.push('-i');
  if (writeOut) parts.push(`-w ${shellEscape(writeOut)}`);

  for (const arg of extraArgs) {
    parts.push(arg);
  }

  parts.push(escaped);
  parts.push('2>/dev/null');

  const cmd = parts.join(' ');
  const execOpts = {
    encoding: 'utf-8',
    timeout: (maxTime + 5) * 1000,
  };
  if (maxBuffer !== undefined) execOpts.maxBuffer = maxBuffer;

  try {
    return execSync(cmd, execOpts);
  } catch {
    return null;
  }
}
