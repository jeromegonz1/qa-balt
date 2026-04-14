#!/usr/bin/env node
/**
 * Tests unitaires — lib/utils.mjs
 *
 * Couvre : shellEscape, isPrivateIp, safeCurl, validatePublicUrl
 */
import { shellEscape, safeCurl, isPrivateIp, validatePublicUrl } from '../lib/utils.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log('\n🧪 test-utils.mjs\n');

// ═══════════════════════════════════════
// shellEscape
// ═══════════════════════════════════════
console.log('── shellEscape ──');

assertEqual(shellEscape('hello'), "'hello'", 'simple string');
assertEqual(shellEscape("it's"), "'it'\\''s'", 'single quote in string');
assertEqual(shellEscape('$(rm -rf /)'), "'$(rm -rf /)'", 'command substitution');
assertEqual(shellEscape('`whoami`'), "'`whoami`'", 'backtick injection');
assertEqual(shellEscape('a;b'), "'a;b'", 'semicolon');
assertEqual(shellEscape('a|b'), "'a|b'", 'pipe');
assertEqual(shellEscape('a&b'), "'a&b'", 'ampersand');
assertEqual(shellEscape(''), "''", 'empty string');
assertEqual(shellEscape('http://example.com/path?q=1&a=2'), "'http://example.com/path?q=1&a=2'", 'URL with query');

// ═══════════════════════════════════════
// isPrivateIp
// ═══════════════════════════════════════
console.log('── isPrivateIp ──');

// Privees → true
assert(isPrivateIp('127.0.0.1'), '127.0.0.1 is private');
assert(isPrivateIp('127.255.255.255'), '127.x is private');
assert(isPrivateIp('10.0.0.1'), '10.x is private');
assert(isPrivateIp('10.255.255.255'), '10.255.x is private');
assert(isPrivateIp('172.16.0.1'), '172.16.x is private');
assert(isPrivateIp('172.31.255.255'), '172.31.x is private');
assert(isPrivateIp('192.168.0.1'), '192.168.x is private');
assert(isPrivateIp('192.168.255.255'), '192.168.255.x is private');
assert(isPrivateIp('169.254.0.1'), '169.254.x is private');
assert(isPrivateIp('0.0.0.0'), '0.x is private');
assert(isPrivateIp('::1'), '::1 is private');
assert(isPrivateIp('fc00::1'), 'fc00: is private');
assert(isPrivateIp('fe80::1'), 'fe80: is private');

// Publiques → false
assert(!isPrivateIp('8.8.8.8'), '8.8.8.8 is public');
assert(!isPrivateIp('1.1.1.1'), '1.1.1.1 is public');
assert(!isPrivateIp('172.15.255.255'), '172.15.x is public');
assert(!isPrivateIp('172.32.0.1'), '172.32.x is public');
assert(!isPrivateIp('192.167.1.1'), '192.167.x is public');
assert(!isPrivateIp('11.0.0.1'), '11.x is public');

// ═══════════════════════════════════════
// safeCurl
// ═══════════════════════════════════════
console.log('── safeCurl ──');

// URL invalide → null
assertEqual(safeCurl('not-a-url'), null, 'invalid URL returns null');
assertEqual(safeCurl(''), null, 'empty URL returns null');
assertEqual(safeCurl('ftp://'), null, 'malformed URL returns null');

// URL valide → string (ou null si no network, mais syntax passes)
const result = safeCurl('http://httpbin.org/status/200', { maxTime: 5 });
// We don't assert the result since it depends on network, just check it doesn't throw

// ═══════════════════════════════════════
// validatePublicUrl
// ═══════════════════════════════════════
console.log('── validatePublicUrl ──');

// These should all throw
const blockedUrls = [
  'http://127.0.0.1:8080',
  'http://localhost:3000',
  'http://10.0.0.1/admin',
  'http://192.168.1.1/router',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]:80/',
  'http://0.0.0.0',
];

for (const url of blockedUrls) {
  try {
    await validatePublicUrl(url);
    failed++;
    console.error(`  FAIL: ${url} should have been blocked`);
  } catch (err) {
    if (err.message.startsWith('URL bloquee')) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${url} threw unexpected: ${err.message}`);
    }
  }
}

// Public URL should pass
try {
  const parsed = await validatePublicUrl('http://google.com');
  assertEqual(parsed.hostname, 'google.com', 'google.com passes validation');
} catch (err) {
  failed++;
  console.error(`  FAIL: google.com should pass: ${err.message}`);
}

// ═══════════════════════════════════════
// Resume
// ═══════════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
