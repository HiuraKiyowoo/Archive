import { home, search, genre, detail, chapter } from '../scraper.js';

let pass = 0;
let fail = 0;
const results = [];

async function t(name, fn, validate) {
  try {
    const data = await fn();
    const ok = validate(data);
    results.push({ name, ok, ...data.summary });
    if (ok) { pass++; console.log(`PASS ${name} — ${JSON.stringify(data.summary)}`); }
    else { fail++; console.log(`FAIL ${name} — validation failed: ${JSON.stringify(data.summary)}`); }
  } catch (err) {
    fail++;
    results.push({ name, ok: false, error: err.message });
    console.log(`ERROR ${name} — ${err.message}`);
  }
}

const nonEmpty = (arr) => Array.isArray(arr) && arr.length > 0;

// Homepage
await t('home', async () => {
  const d = await home();
  return {
    summary: { count: d.count },
    items: d.items,
  };
}, (d) => nonEmpty(d.items) && d.items[0].title && d.items[0].url);

// Search x2
await t('search "solo leveling"', async () => {
  const d = await search('solo leveling');
  return {
    summary: { count: d.count, page: d.page },
    items: d.items,
  };
}, (d) => nonEmpty(d.items) && d.items.every((i) => i.url && i.title));

await t('search "swordmaster"', async () => {
  const d = await search('swordmaster');
  return {
    summary: { count: d.count, page: d.page },
    items: d.items,
  };
}, (d) => nonEmpty(d.items) && d.items[0].url);

// Genre x2
await t('genre action', async () => {
  const d = await genre('action');
  return {
    summary: { count: d.count, totalPages: d.pagination?.totalPages },
    items: d.items,
  };
}, (d) => nonEmpty(d.items) && d.items[0].url);

await t('genre romance', async () => {
  const d = await genre('romance');
  return {
    summary: { count: d.count },
    items: d.items,
  };
}, (d) => nonEmpty(d.items));

// Detail x3
const detailUrls = [
  'https://komikindo.ch/komik/magic-emperor/',
  'https://komikindo.ch/komik/nano-machine/',
  'https://komikindo.ch/komik/eleceed/',
];
for (const url of detailUrls) {
  const slug = url.match(/\/komik\/([^/]+)\//)?.[1];
  await t(`detail ${slug}`, async () => {
    const d = await detail(url);
    return {
      summary: { title: d.title, chapters: d.chapterCount },
      detail: d,
    };
  }, (d) => d.detail.title && nonEmpty(d.detail.chapters) && d.detail.chapters[0].url);
}

// Chapter x3 (use first chapter links from details above)
// We need real chapter URLs; fetch detail to get chapter list then test first chapter
async function testChapterFromDetail(url) {
  const det = await detail(url);
  const firstChapter = det.chapters[0];
  if (!firstChapter) throw new Error('no chapters found');
  const ch = await chapter(firstChapter.url);
  return {
    summary: { pageCount: ch.pageCount, from: firstChapter.url.split('/').slice(-2, -1)[0] },
    images: ch.images,
  };
}

for (const url of detailUrls.slice(0, 3)) {
  const slug = url.match(/\/komik\/([^/]+)\//)?.[1];
  await t(`chapter first of ${slug}`, async () => testChapterFromDetail(url),
   (d) => nonEmpty(d.images) && d.images[0].url && d.summary.pageCount > 0);
}

// Pagination: genre page 2
await t('genre action page 2', async () => {
  const d = await genre('action', 2);
  return {
    summary: { count: d.count, page: d.page, current: d.pagination?.current },
    items: d.items,
  };
}, (d) => nonEmpty(d.items) && d.summary.page === 2 && d.summary.current === 2);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);