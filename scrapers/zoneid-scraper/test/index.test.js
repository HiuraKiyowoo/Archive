import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFeatured,
  searchFeatured,
  getOfficial,
  getMySubdomains,
  BASE_URL,
} from '../src/index.js';

// Semua test LIVE ke https://my.zone.id/api (endpoint publik 200 tanpa token).

test('GET /featured returns catalogue with items', async () => {
  const r = await getFeatured();
  assert.ok(r.total >= 100, `total harus >= 100, dapat ${r.total}`);
  assert.ok(Array.isArray(r.data));
  assert.strictEqual(r.data.length, r.total);
}, 30000);

test('featured items have expected fields and *.zone.id names', async () => {
  const r = await getFeatured({ limit: 20 });
  assert.ok(r.data.length > 0);
  for (const s of r.data) {
    assert.ok(s.id, 'id required');
    assert.match(s.nama, /^[a-z0-9-]+\.zone\.id$/i, `nama harus *.zone.id: ${s.nama}`);
    assert.ok(['active', 'suspended'].includes(s.status), `status: ${s.status}`);
    assert.ok(['free', 'premium'].includes(s.plan), `plan: ${s.plan}`);
    assert.ok(['dns_record', 'url_forwarder'].includes(s.mode), `mode: ${s.mode}`);
    assert.ok(s.url.startsWith('https://'), 'url https');
  }
}, 30000);

test('featured order is deterministic (sorted created_at desc)', async () => {
  const a = await getFeatured();
  const b = await getFeatured();
  const ka = a.data.map((s) => s.created_at);
  const kb = b.data.map((s) => s.created_at);
  // sorted desc: tiap elemen >= elemen berikutnya
  for (let i = 0; i + 1 < ka.length; i++) {
    assert.ok(new Date(ka[i]) >= new Date(ka[i + 1]), `sort desc gagal di idx ${i}`);
  }
  // dua call berbeda harus menghasilkan urutan yang sama (walaupun upstream random)
  assert.deepStrictEqual(ka, kb);
}, 60000);

test('limit param respected (limit=10 -> max 10 items)', async () => {
  const r = await getFeatured({ limit: 10 });
  assert.ok(r.total <= 10, `harus <= 10, dapat ${r.total}`);
  assert.ok(r.total > 0, 'tidak kosong');
}, 30000);

test('searchFeatured filters locally (no upstream search param)', async () => {
  const r = await searchFeatured('zone.id');
  assert.ok(r.total >= 100, 'katalog penuh di background');
  assert.ok(r.matches > 0, 'query zone.id pasti match');
  for (const s of r.data) {
    const hit =
      s.nama.toLowerCase().includes('zone.id') ||
      (s.usage_type || '').toLowerCase().includes('zone.id') ||
      (s.usage_description || '').toLowerCase().includes('zone.id');
    assert.ok(hit, `item tidak seharusnya match: ${s.nama}`);
  }
}, 30000);

test('searchFeatured nonsense query -> 0 matches, katalog utuh', async () => {
  const r = await searchFeatured('zzz-tidak-ada-12345');
  assert.strictEqual(r.matches, 0);
  assert.ok(r.total >= 100);
}, 30000);

test('GET /official returns official services', async () => {
  const r = await getOfficial();
  assert.ok(r.total >= 3, `harus >= 3, dapat ${r.total}`);
  const titles = r.data.map((o) => o.title.toLowerCase());
  assert.ok(titles.some((t) => t.includes('upld')), 'upld.zone.id harus ada');
  for (const o of r.data) {
    assert.ok(o.url?.startsWith('https://'), 'url https');
    assert.ok(o.title, 'title required');
  }
}, 30000);

test('token-gated endpoint rejects without token (AUTH_REQUIRED)', async () => {
  await assert.rejects(() => getMySubdomains(null), (err) => {
    assert.strictEqual(err.code, 'AUTH_REQUIRED');
    return true;
  });
}, 30000);
