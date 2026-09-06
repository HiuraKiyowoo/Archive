import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  generateClientToken,
  computeDeviceFingerprint,
  getUploadConfigs,
  initVideoUpload,
  uploadVideoBinary
} from '../src/index.js';

test('SnapEdit Scraper - Generate Client JWT & Fingerprint', () => {
  const token = generateClientToken({ isPro: false });
  assert.ok(token, 'Token must not be empty');
  assert.strictEqual(typeof token, 'string', 'Token must be string');
  const parts = token.split('.');
  assert.strictEqual(parts.length, 3, 'JWT must have 3 segments');

  const fp = computeDeviceFingerprint();
  assert.ok(fp, 'Fingerprint must not be empty');
  assert.strictEqual(typeof fp, 'string', 'Fingerprint must be string');
});

test('SnapEdit Scraper - Live getUploadConfigs', async () => {
  const configs = await getUploadConfigs();
  assert.ok(configs, 'Configs object returned');
  assert.strictEqual(typeof configs.limitMb, 'number', 'limitMb must be number');
  assert.strictEqual(configs.limitMb, 200, 'Max upload limit must be 200 MB');
});

test('SnapEdit Scraper - Live initVideoUpload (Signed TOS URL Negotiation)', async () => {
  const init = await initVideoUpload();
  assert.ok(init, 'Init upload response exists');
  assert.ok(init.task_id, 'task_id must be present');
  assert.strictEqual(typeof init.task_id, 'string', 'task_id must be string');
  assert.ok(init.upload_signed_url, 'upload_signed_url must be present');
  assert.ok(init.upload_signed_url.startsWith('https://'), 'signed URL must be HTTPS');
  assert.ok(init.upload_signed_url.includes('tos-ap-southeast-1.bytepluses.com'), 'URL points to BytePlus TOS');
  assert.strictEqual(init.bucket, 'snapedit-enhance-video-v2-asia-northeast3-prod');
});

test('SnapEdit Scraper - Live uploadVideoBinary (Direct Cloud Storage Upload)', async () => {
  const init = await initVideoUpload();
  const dummyBuffer = Buffer.from('FAKE_MP4_HEADER_TEST_BYTES');
  const uploadRes = await uploadVideoBinary(init.upload_signed_url, dummyBuffer, init['x-goog-content-length-range']);
  assert.strictEqual(uploadRes.ok, true, 'Upload binary must succeed');
  assert.strictEqual(uploadRes.status, 200, 'TOS storage returns 200 on PUT');
});
