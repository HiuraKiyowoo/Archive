/**
 * Scraper homepage keikomik.net
 * Hanya mengambil halaman HOME — tidak mengikuti pagination,
 * tidak membuka halaman detail/chapter.
 *
 * Cara pakai:
 *   npm install cheerio
 *   node scraper.js                 -> print JSON ke stdout
 *   node scraper.js output.json     -> simpan ke file
 */

const cheerio = require('cheerio');
const fs = require('fs');

const BASE_URL = 'https://keikomik.net';
const HOME_URL = `${BASE_URL}/`;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const absUrl = (u) => (u ? (u.startsWith('http') ? u : BASE_URL + u) : null);

async function fetchHome() {
  const res = await fetch(HOME_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} saat mengambil ${HOME_URL}`);
  return res.text();
}

/** Section 1: banner/slider featured (swiper) — tanpa judul di halaman */
function parseFeatured($) {
  const items = [];
  $('.swiper .swiper-slide').each((_, el) => {
    const $el = $(el);
    const title = clean($el.find('h1').first().text());
    const url = absUrl($el.find('a[href^="/komik/"]').attr('href'));
    const image = $el.find('img').attr('src') || null;
    const description = clean($el.find('p').first().text());
    items.push({
      title,
      url,
      image,
      metadata: description ? { description } : {},
    });
  });
  return { title: 'Featured (Slider)', items };
}

/** Section 2: "Populer" — carousel horizontal dengan badge tipe */
function parsePopuler($) {
  const items = [];
  // h1 berisi teks "Populer", lalu ul setelahnya berisi item
  const heading = $('h1').filter((_, el) => clean($(el).text()) === 'Populer').first();
  const $list = heading.closest('div').next('div').find('ul > li');
  $list.each((_, el) => {
    const $el = $(el);
    const url = absUrl($el.find('a').attr('href'));
    const image = $el.find('img').attr('src') || null;
    const type = clean($el.find('div.absolute.top-0.left-0').first().text());
    const title = clean($el.find('p').first().text());
    items.push({
      title,
      url,
      image,
      metadata: type ? { type } : {},
    });
  });
  return { title: 'Populer', items };
}

/** Section 3: "Update" — grid komik dengan 3 chapter terbaru */
function parseUpdate($) {
  const items = [];
  const heading = $('h2').filter((_, el) => clean($(el).text()) === 'Update').first();
  const $grid = heading.closest('div').next('div');
  $grid.children('div').each((_, el) => {
    const $el = $(el);
    const title = clean($el.find('h2').first().text());
    const url = absUrl($el.find('a[href^="/komik/"]').attr('href'));
    const image = $el.find('img').attr('src') || null;

    const latestChapters = [];
    $el.find('a[href^="/chapter/"]').each((_, a) => {
      const $a = $(a);
      const chapter = clean($a.find('h3').text());
      // waktu rilis ada di div sibling setelah link chapter
      const released = clean($a.parent().find('div.text-slate-300').text());
      latestChapters.push({
        chapter,
        url: absUrl($a.attr('href')),
        released,
      });
    });

    items.push({
      title,
      url,
      image,
      metadata: { latest_chapters: latestChapters },
    });
  });
  return { title: 'Update', items };
}

async function main() {
  const html = await fetchHome();
  const $ = cheerio.load(html);

  const result = {
    url: HOME_URL,
    sections: [parseFeatured($), parsePopuler($), parseUpdate($)],
  };

  const json = JSON.stringify(result, null, 2);
  const outFile = process.argv[2];
  if (outFile) {
    fs.writeFileSync(outFile, json, 'utf-8');
    console.error(`Tersimpan ke ${outFile}`);
    console.error(
      `Sections: ${result.sections.map((s) => `${s.title} (${s.items.length})`).join(', ')}`
    );
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error('Gagal:', err.message);
  process.exit(1);
});
