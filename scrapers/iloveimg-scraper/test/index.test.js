import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compressImage, resizeImage, convertToJpg, getSessionConfig } from "../src/index.js";

// Create a small mock PNG image (red square) in memory:
// 1x1 red PNG magic bytes
const MOCK_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

test("1. getSessionConfig: retrieves valid token and task ID", async () => {
  const session = await getSessionConfig("compress-image");
  assert.ok(session.token, "token should exist");
  assert.ok(session.taskId, "taskId should exist");
  assert.ok(session.server, "server should exist");
  assert.match(session.workerUrl, /^https:\/\/api[0-9]+\.iloveimg\.com$/);
});

test("2. compressImage: live compression of test image", async () => {
  const res = await compressImage(MOCK_PNG);
  assert.equal(res.success, true);
  assert.equal(res.tool, "compressimage");
  assert.ok(res.output_size > 0);
  assert.ok(Buffer.isBuffer(res.buffer));
  // PNG input returns compressed PNG magic bytes: 0x89 0x50
  assert.equal(res.buffer[0], 0x89);
  assert.equal(res.buffer[1], 0x50);
});

test("3. convertToJpg: converts PNG to JPG", async () => {
  const res = await convertToJpg(MOCK_PNG);
  assert.equal(res.success, true);
  assert.equal(res.tool, "convertimage");
  assert.ok(res.output_size > 0);
  // Check JPEG magic bytes: 0xFF 0xD8
  assert.equal(res.buffer[0], 0xff);
  assert.equal(res.buffer[1], 0xd8);
});

test("4. resizeImage: resizes image via percentage", async () => {
  const res = await resizeImage(MOCK_PNG, { resize_mode: "percentage", percentage: 50 });
  assert.equal(res.success, true);
  assert.equal(res.tool, "resizeimage");
  assert.ok(res.output_size > 0);
});
