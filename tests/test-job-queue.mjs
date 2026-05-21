#!/usr/bin/env node
/**
 * Tests unitaires — lib/job-queue.mjs
 */
import { JobQueue } from '../lib/job-queue.mjs';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — got ${a}, expected ${e}`); }
}
async function expectThrow(fn, subStr, label) {
  try { await fn(); failed++; console.error(`  FAIL: ${label} — expected throw`); }
  catch (e) {
    if (subStr && !e.message.includes(subStr)) {
      failed++;
      console.error(`  FAIL: ${label} — got "${e.message}", expected substring "${subStr}"`);
    } else passed++;
  }
}

// Helper : promise qu'on resout/rejette manuellement
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Helper : attend que la microtask resout
const tick = () => new Promise(r => setImmediate(r));

console.log('\n🧪 test-job-queue.mjs\n');

// ─── Enqueue direct quand slot dispo ───
{
  const q = new JobQueue({ maxConcurrent: 2 });
  const d = deferred();
  const result = q.enqueue({ jobId: 'a', url: 'x' }, () => d.promise);
  assertEqual(result.status, 'running', 'enqueue immediat quand slot libre → running');
  assertEqual(result.position, 0, 'position 0 quand running');
  assertEqual(q.size(), { active: 1, waiting: 0 }, '1 actif, 0 en attente');
  d.resolve();
  await tick();
  assertEqual(q.size(), { active: 0, waiting: 0 }, 'apres resolve, slot libere');
}

// ─── Saturation : mis en queue ───
{
  const q = new JobQueue({ maxConcurrent: 2 });
  const d1 = deferred(), d2 = deferred(), d3 = deferred();
  q.enqueue({ jobId: 'a' }, () => d1.promise);
  q.enqueue({ jobId: 'b' }, () => d2.promise);
  const r3 = q.enqueue({ jobId: 'c' }, () => d3.promise);
  assertEqual(r3.status, 'queued', 'le 3eme job → queued (saturation)');
  assertEqual(r3.position, 1, 'position 1 (1er en attente)');
  assertEqual(q.size(), { active: 2, waiting: 1 }, '2 actifs, 1 en attente');
}

// ─── Auto-progression quand un slot se libere ───
{
  const q = new JobQueue({ maxConcurrent: 1 });
  const d1 = deferred();
  let cRanWith;
  const d2 = deferred();
  q.enqueue({ jobId: 'a' }, () => d1.promise);
  q.enqueue({ jobId: 'b' }, (id) => { cRanWith = id; return d2.promise; });
  assertEqual(q.size(), { active: 1, waiting: 1 }, 'a actif, b en attente');
  d1.resolve();
  await tick();
  assertEqual(q.size(), { active: 1, waiting: 0 }, 'b promu en actif automatiquement');
  assertEqual(cRanWith, 'b', 'runFn appele avec le bon jobId');
}

// ─── Position updates dans le bon ordre ───
{
  const q = new JobQueue({ maxConcurrent: 1 });
  const d1 = deferred();
  q.enqueue({ jobId: 'a' }, () => d1.promise);

  const positionsB = [];
  q.enqueue({ jobId: 'b' }, () => new Promise(() => {}));
  q.subscribe('b', (s) => positionsB.push(s));

  const positionsC = [];
  q.enqueue({ jobId: 'c' }, () => new Promise(() => {}));
  q.subscribe('c', (s) => positionsC.push(s));

  assertEqual(q.size(), { active: 1, waiting: 2 }, 'a + 2 en attente');
  assertEqual(q.getStatus('b'), { status: 'queued', position: 1 }, 'b position 1');
  assertEqual(q.getStatus('c'), { status: 'queued', position: 2 }, 'c position 2');

  // a finit → b devient actif → c passe en position 1
  d1.resolve();
  await tick();
  assertEqual(positionsB.pop()?.status, 'running', 'b notifie qu\'il devient running');
  assertEqual(positionsC.pop()?.position, 1, 'c notifie position 1');
}

// ─── jobId duplicate refuse ───
{
  const q = new JobQueue({ maxConcurrent: 2 });
  q.enqueue({ jobId: 'dup' }, () => new Promise(() => {}));
  await expectThrow(
    () => q.enqueue({ jobId: 'dup' }, () => new Promise(() => {})),
    'deja present', 'jobId duplicate → erreur'
  );
}

// ─── Queue pleine → throw ───
{
  const q = new JobQueue({ maxConcurrent: 1, maxWaiting: 2 });
  q.enqueue({ jobId: 'a' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'b' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'c' }, () => new Promise(() => {}));
  await expectThrow(
    () => q.enqueue({ jobId: 'd' }, () => new Promise(() => {})),
    'File pleine', 'queue pleine → erreur'
  );
}

// ─── enqueue sans jobId → throw ───
{
  const q = new JobQueue();
  await expectThrow(() => q.enqueue({}, () => {}), 'jobId requis', 'jobId manquant');
  await expectThrow(() => q.enqueue({ jobId: 'x' }, null), 'fonction', 'runFn manquant');
}

// ─── cancel d'un job en attente ───
{
  const q = new JobQueue({ maxConcurrent: 1 });
  q.enqueue({ jobId: 'a' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'b' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'c' }, () => new Promise(() => {}));
  assert(q.cancel('b'), 'cancel b (en attente) → true');
  assertEqual(q.size(), { active: 1, waiting: 1 }, 'apres cancel : 1 actif, 1 en attente');
  assertEqual(q.getStatus('b'), null, 'b plus dans la queue');
  assertEqual(q.getStatus('c'), { status: 'queued', position: 1 }, 'c remonte en position 1');

  // cancel d'un job actif : impossible
  assert(!q.cancel('a'), 'cancel a (actif) → false (ne peut pas annuler un actif)');
  // cancel d'un inconnu : false
  assert(!q.cancel('zzz'), 'cancel inconnu → false');
}

// ─── list() snapshot pour /api/jobs ───
{
  const q = new JobQueue({ maxConcurrent: 1 });
  q.enqueue({ jobId: 'a', url: 'http://a', type: 'sse' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'b', url: 'http://b', type: 'clickup' }, () => new Promise(() => {}));
  const snap = q.list();
  assertEqual(snap.maxConcurrent, 1, 'snap.maxConcurrent');
  assertEqual(snap.running.length, 1, '1 running dans snapshot');
  assertEqual(snap.running[0].jobId, 'a', 'running[0] = a');
  assertEqual(snap.running[0].url, 'http://a', 'running[0].url');
  assert(!snap.running[0].runFn, 'runFn stripped du snapshot');
  assertEqual(snap.waiting.length, 1, '1 waiting');
  assertEqual(snap.waiting[0].position, 1, 'position 1');
  assertEqual(snap.waiting[0].url, 'http://b', 'waiting[0].url');
}

// ─── cleanupStale ───
{
  const q = new JobQueue({ maxConcurrent: 2, staleAfterMs: 50 });
  q.enqueue({ jobId: 'stuck' }, () => new Promise(() => {}));
  q.enqueue({ jobId: 'fresh' }, () => new Promise(() => {}));
  // Force le stuck en arriere
  const stuck = q.active.get('stuck');
  stuck.startedAt = Date.now() - 1000;
  const cleaned = q.cleanupStale();
  assertEqual(cleaned, ['stuck'], 'stuck nettoye');
  assert(!q.active.has('stuck'), 'stuck retire de actifs');
  assert(q.active.has('fresh'), 'fresh conserve');
}

// ─── Erreur dans runFn ne casse pas la queue ───
{
  const q = new JobQueue({ maxConcurrent: 1 });
  let bRan = false;
  q.enqueue({ jobId: 'crash' }, async () => { throw new Error('boom'); });
  q.enqueue({ jobId: 'b' }, () => { bRan = true; return new Promise(() => {}); });
  await tick();
  await tick();
  assert(bRan, 'b a tourne malgre crash de a');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
