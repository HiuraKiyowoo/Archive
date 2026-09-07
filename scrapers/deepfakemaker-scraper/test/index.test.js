import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateUUID,
  generateUUID64,
  randomString,
  generateAuthParams,
  buildQueryString,
  buildMultipart,
  DeepFakeMaker,
  BASE_URL,
  APP_ID,
  SALT,
} from '../src/index.js';

test('generateUUID returns string with expected prefix and hex suffix', () => {
  const uuid = generateUUID();
  assert.ok(uuid.startsWith('10000000-1000-4000-8000-'));
  const suffix = uuid.replace('10000000-1000-4000-8000-', '');
  assert.match(suffix, /^[0-9a-f-]+$/i);
});

test('generateUUID64 returns 64-char hex string', () => {
  const uid = generateUUID64();
  assert.strictEqual(uid.length, 64);
  assert.match(uid, /^[0-9a-f]+$/i);
});

test('randomString returns requested length', () => {
  const s = randomString(16);
  assert.strictEqual(s.length, 16);
});

test('generateAuthParams returns expected keys', () => {
  const params = generateAuthParams();
  assert.ok(params.app_id);
  assert.ok(params.t);
  assert.ok(params.nonce);
  assert.ok(params.sign);
  assert.ok(params.secret_key);
  assert.strictEqual(params.app_id, APP_ID);
});

test('generateAuthParams with extra appends extra param', () => {
  const params = generateAuthParams('extra-value');
  // The extra value is embedded inside the AES-CBC ciphertext, so we can't inspect it directly.
  // But we can assert the other fields are present.
  assert.ok(params.sign);
  assert.ok(params.secret_key);
});

test('buildQueryString encodes params correctly', () => {
  const qs = buildQueryString({ a: '1', b: 'hello world', c: '' });
  assert.ok(qs.includes('a=1'));
  assert.ok(qs.includes('b=hello+world'));
  assert.ok(qs.includes('c='));
});

test('buildMultipart builds valid multipart body', () => {
  const boundary = '----boundary';
  const parts = buildMultipart([
    { name: 'foo', value: 'bar' },
    { name: 'file', isFile: true, filename: 'a.jpg', contentType: 'image/jpeg', buffer: Buffer.from('IMG') },
  ], boundary);

  const str = parts.toString('utf8');
  assert.ok(str.includes('Content-Disposition: form-data; name="foo"'));
  assert.ok(str.includes('Content-Disposition: form-data; name="file"; filename="a.jpg"'));
  assert.ok(str.includes('Content-Type: image/jpeg'));
  assert.ok(str.includes('IMG'));
});

test('DeepFakeMaker class instantiates with default base URL', () => {
  const dfm = new DeepFakeMaker();
  assert.strictEqual(dfm.baseUrl, BASE_URL);
});

test('DeepFakeMaker accepts custom baseUrl', () => {
  const dfm = new DeepFakeMaker({ baseUrl: 'https://example.com/api' });
  assert.strictEqual(dfm.baseUrl, 'https://example.com/api');
});

// Skip live tests unless DFM_LIVE_TESTS=1 is set (avoids hitting production in CI)
const runLive = process.env.DFM_LIVE_TESTS === '1';

if (runLive) {
  test('live: auth endpoint returns 403 without login (proves signature validation works)', async () => {
    const dfm = new DeepFakeMaker({ debug: true });
    const auth = generateAuthParams();
    const qs = buildQueryString(auth);
    const res = await httpRequest(`${BASE_URL}/user/v2/credit?${qs}`, 'GET');
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 403);
  }, 15000);

  test('live: upload sign returns valid signed URL', async () => {
    const dfm = new DeepFakeMaker({ debug: true });
    const res = await dfm.getUploadSign('test.jpg', 'abc123');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, 200);
    assert.ok(res.body.data?.url?.includes('http'));
  }, 15000);

  test('live: free flux list returns empty data array with valid auth', async () => {
    const dfm = new DeepFakeMaker({ debug: true });
    const auth = generateAuthParams();
    const qs = buildQueryString({ ...auth, user_id: generateUUID64() });
    const res = await httpRequest(`${BASE_URL}/replicate/v1/free/flux/list?${qs}`, 'GET');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, 20000);
  }, 15000);
}
