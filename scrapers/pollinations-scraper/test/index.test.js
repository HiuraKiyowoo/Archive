import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { generateImage, generateAndSave, generateText } from "../src/index.js";

test("generateImage returns a valid JPEG buffer", async () => {
  const buffer = await generateImage("minimalist black square", {
    model: "turbo",
    width: 256,
    height: 256,
    nologo: true
  });

  assert.ok(Buffer.isBuffer(buffer), "Result must be a Buffer");
  assert.ok(buffer.length > 1000, "Buffer size should be reasonable");

  // Magic bytes JPEG: FF D8 FF
  assert.strictEqual(buffer[0], 0xff, "First byte must be 0xFF");
  assert.strictEqual(buffer[1], 0xd8, "Second byte must be 0xD8");
  assert.strictEqual(buffer[2], 0xff, "Third byte must be 0xFF");
});

test("generateAndSave writes image file to disk", async () => {
  const tmpFile = path.join("/tmp", `test_polli_${Date.now()}.jpg`);
  const res = await generateAndSave("blue sky", tmpFile, {
    model: "turbo",
    width: 256,
    height: 256
  });

  assert.strictEqual(res.path, tmpFile);
  assert.ok(res.size > 0);

  const stats = await fs.stat(tmpFile);
  assert.strictEqual(stats.size, res.size);

  // Cleanup
  await fs.unlink(tmpFile);
});

test("generateText returns valid AI completion", async () => {
  const answer = await generateText("Say PONG");

  assert.strictEqual(typeof answer, "string");
  assert.ok(answer.length > 0);
  assert.match(answer.toUpperCase(), /PONG/);
});
