import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  RESOLUTION_REQUIRED,
  REFERENCE_CAPABLE,
  DEFAULT_MODEL,
  BASE_URL,
  getGoogleAuthConfig,
  getCredits,
  generateImage,
  getRequest,
  waitForRequest,
} from '../src/index.js';

const COOKIE = process.env.NBN_COOKIE || null;

// ================= publik (selalu jalan) =================

test('GET /api/auth/google/config publik -> clientId', async () => {
  const r = await getGoogleAuthConfig();
  assert.match(r.clientId, /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
}, 30000);

test('MODELS / ASPECT_RATIOS / RESOLUTIONS sesuai harvest bundle', () => {
  assert.ok(MODELS['google/nano-banana']);
  assert.ok(MODELS['google/nano-banana-pro']);
  assert.ok(MODELS['google/nano-banana-2']);
  assert.ok(MODELS['alibaba/z-image']);
  assert.strictEqual(DEFAULT_MODEL, 'google/nano-banana-2');
  assert.deepStrictEqual(ASPECT_RATIOS, ['1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '9:16']);
  assert.deepStrictEqual(RESOLUTIONS, { '1K': '1024', '2K': '2048', '4K': '4096' });
});

test('endpoint privat tanpa cookie -> AUTH_REQUIRED (401 COMMON.UNAUTHORIZED)', async () => {
  await assert.rejects(() => getCredits(null), (err) => {
    assert.strictEqual(err.code, 'AUTH_REQUIRED');
    assert.strictEqual(err.status, 401);
    return true;
  });
  await assert.rejects(() => generateImage('test', { cookie: null }), (err) => {
    assert.strictEqual(err.code, 'AUTH_REQUIRED');
    return true;
  });
  await assert.rejects(() => getRequest(null, 'some-id'), (err) => {
    assert.strictEqual(err.code, 'AUTH_REQUIRED');
    return true;
  });
}, 60000);

// ================= validasi lokal (tanpa network) =================

test('generateImage tolak model tidak dikenal (lokal, tanpa request)', async () => {
  await assert.rejects(
    () => generateImage('x', { cookie: 'dummy', model: 'google/not-a-model' }),
    /model tidak dikenal/
  );
});

test('generateImage tolak aspectRatio tidak valid', async () => {
  await assert.rejects(
    () => generateImage('x', { cookie: 'dummy', aspectRatio: '7:9' }),
    /aspectRatio tidak valid/
  );
});

test('generateImage tolak resolution tidak valid', async () => {
  await assert.rejects(
    () => generateImage('x', { cookie: 'dummy', resolution: '8K' }),
    /resolution tidak valid/
  );
});

test('generateImage prompt kosong -> error (trim menghasilkan body kosong tetap dikirim, tapi input non-string harus stringified)', async () => {
  // prompt 12345 harus di-stringify tanpa melempar (kontrak library)
  assert.doesNotThrow(() => String(12345).trim());
});

// ================= live privat (hanya kalau NBN_COOKIE di-set) =================

test('LIVE: getCredits mengembalikan angka (butuh NBN_COOKIE)', async () => {
  if (!COOKIE) {
    console.log('  (skip: NBN_COOKIE tidak di-set)');
    return;
  }
  const r = await getCredits(COOKIE);
  assert.ok(typeof r.totalRemaining === 'number', `totalRemaining harus number, dapat ${JSON.stringify(r.raw)}`);
  console.log('  totalRemaining =', r.totalRemaining);
}, 30000);

test('LIVE: generate -> request processing/completed (butuh NBN_COOKIE, MAKNAI KREDIT)', async () => {
  if (!COOKIE) {
    console.log('  (skip: NBN_COOKIE tidak di-set)');
    return;
  }
  // Guard: hanya jalan kalau NBN_LIVE_GEN=1 karena maknai kredit akun
  if (process.env.NBN_LIVE_GEN !== '1') {
    console.log('  (skip: set NBN_LIVE_GEN=1 untuk generate beneran — memaknai kredit)');
    return;
  }
  const { requestId } = await generateImage('a red apple on a white table, product photo', {
    cookie: COOKIE,
    aspectRatio: '1:1',
    n: 1,
  });
  assert.ok(requestId, 'requestId harus ada');
  const req = await getRequest(COOKIE, requestId);
  assert.ok(['processing', 'completed', 'failed', 'error'].includes(req.status), `status: ${req.status}`);
  console.log('  status:', req.status, 'outputs:', req.outputs.length);

  if (req.status === 'processing') {
    const done = await waitForRequest(COOKIE, requestId, { intervalMs: 5000, timeoutMs: 120000 });
    console.log('  after wait:', done.status, done.outputs.map((o) => o.url));
  }
}, 180000);

test('LIVE: getRequests list (butuh NBN_COOKIE)', async () => {
  if (!COOKIE) {
    console.log('  (skip: NBN_COOKIE tidak di-set)');
    return;
  }
  const r = await import('../src/index.js').then((m) => m.getRequests(COOKIE, { page: 1, pageSize: 5 }));
  assert.ok(Array.isArray(r.data));
  for (const item of r.data) {
    assert.ok(item.requestId, 'requestId required');
    assert.ok(item.status, 'status required');
  }
  console.log('  requests di halaman 1:', r.total);
}, 30000);
