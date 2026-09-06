import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIslandKey, text2img, generateAndDownload } from "../src/index.js";

test("1. generateIslandKey: creates valid dynamic hash token", () => {
  const key = generateIslandKey();
  assert.ok(key.startsWith("tryit-"));
  const parts = key.split("-");
  assert.equal(parts.length, 3);
  assert.equal(parts[2].length, 32); // MD5 hex length
});

test("2. text2img: generates live image URL from prompt", async () => {
  const res = await text2img("miniature cute red apple on wooden table 4k");
  assert.equal(res.success, true);
  assert.ok(res.id);
  assert.ok(res.output_url.startsWith("https://api.deepai.org/"));
});

test("3. generateAndDownload: downloads live generated image buffer", async () => {
  const res = await generateAndDownload("blue floating neon crystal isolated");
  assert.equal(res.success, true);
  assert.ok(Buffer.isBuffer(res.buffer));
  assert.ok(res.buffer.length > 5000);
  // JPEG magic bytes: FF D8
  assert.equal(res.buffer[0], 0xff);
  assert.equal(res.buffer[1], 0xd8);
});
