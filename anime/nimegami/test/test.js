import { home, detail, episode } from '../scraper.js';

let pass = 0, fail = 0;

async function t(name, fn, validate) {
  try {
    const data = await fn();
    const ok = validate(data);
    if (ok) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}`); }
  } catch (err) {
    fail++;
    console.log(`ERROR ${name}: ${err.message}`);
  }
}

const nonEmpty = arr => Array.isArray(arr) && arr.length > 0;

// Home
await t('home', async () => {
  const d = await home();
  return d;
}, d => nonEmpty(d.items) && d.items[0].title && d.items[0].url);

// Detail x3
const detailUrls = [
  'https://nimegami.id/girls-panzer-motto-love-love-sakusen-desu-sub-indo/',
  'https://nimegami.id/30-sai-made-doutei-dato-mahoutsukai-ni-nareru-rashii-movie-sub-indo/',
  'https://nimegami.id/oni-no-hanayome-sub-indo/',
];
for (const url of detailUrls) {
  const slug = url.split('/').filter(Boolean).pop();
  await t(`detail ${slug}`, async () => {
    const d = await detail(url);
    return d;
  }, d => d.title && nonEmpty(d.episodes) && Array.isArray(d.episodes[0].qualities) && nonEmpty(d.episodes[0].qualities));
}

// Episode x3 (ambil dari detail, ambil episode pertama)
for (const url of detailUrls) {
  const slug = url.split('/').filter(Boolean).pop();
  await t(`episode first of ${slug}`, async () => {
    const d = await episode(url, 1);
    return d;
  }, d => d.title && d.episode && Array.isArray(d.episode.qualities) && d.episode.qualities.length > 0);
}

console.log(`\\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);