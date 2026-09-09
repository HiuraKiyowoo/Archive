import test from "node:test";
import assert from "node:assert/strict";
import { searchMixkit, searchVideezy, searchSplitShire, searchVidevo, searchAll } from "../src/index.js";

test("1. searchMixkit - returns video results for 'nature'", async () => {
  const data = await searchMixkit("nature");
  assert.equal(data.source, "mixkit", "source must be mixkit");
  assert.equal(data.query, "nature", "query must match");
  assert.ok(Array.isArray(data.videos), "videos must be an array");
  assert.ok(data.videos.length >= 1, `Expected at least 1 video, got ${data.videos.length}`);
  const first = data.videos[0];
  assert.ok(first.title, "video must have a title");
  assert.ok(first.url.includes("mixkit.co"), "url must point to mixkit");
});

test("2. searchMixkit - pagination works", async () => {
  const data = await searchMixkit("", 2);
  assert.equal(data.page, 2, "page must be 2");
  assert.ok(data.videos.length >= 1, "page 2 must have videos");
});

test("3. searchVideezy - returns video results for 'city'", async () => {
  const data = await searchVideezy("city");
  assert.equal(data.source, "videezy", "source must be videezy");
  assert.ok(Array.isArray(data.videos), "videos must be an array");
  assert.ok(data.videos.length >= 1, `Expected at least 1 video, got ${data.videos.length}`);
  const first = data.videos[0];
  assert.ok(first.title, "video must have a title");
});

test("4. searchSplitShire - returns video results", async () => {
  const data = await searchSplitShire();
  assert.equal(data.source, "splitshire", "source must be splitshire");
  assert.ok(Array.isArray(data.videos), "videos must be an array");
  assert.ok(data.videos.length >= 1, `Expected at least 1 video, got ${data.videos.length}`);
});

test("5. searchVidevo - returns video results", async () => {
  const data = await searchVidevo("nature");
  assert.equal(data.source, "videvo", "source must be videvo");
  assert.ok(Array.isArray(data.videos), "videos must be an array");
  assert.ok(data.videos.length >= 1, `Expected at least 1 video, got ${data.videos.length}`);
});

test("6. searchAll - returns results from all sources", async () => {
  const data = await searchAll("ocean");
  assert.ok(Array.isArray(data), "searchAll must return an array");
  assert.equal(data.length, 4, "must have 4 sources");
  const mixkit = data.find((d) => d.source === "mixkit");
  assert.ok(mixkit, "mixkit must be in results");
  assert.ok(mixkit.videos.length >= 1, "mixkit must return videos");
});
