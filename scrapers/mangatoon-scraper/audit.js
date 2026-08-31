// audit.js — cross-check independen: bandingkan hasil parser vs hitungan
// langsung dari HTML mentah. Tujuan: menangkap "kehilangan senyap" seperti
// 2 kartu booklist & 2 kartu homepage yang sempat hilang.
// Bukan bagian dari test suite (lokal saja).
import {
  home, genres, browse, byTag, search, series, episodeImages, booklist, sitemap,
} from "./src/index.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const raw = async (u) =>
  (await fetch(u, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } })).text();
const countAll = (h, re) => (h.match(re) || []).length;

let bad = 0;
const check = (label, got, want, note = "") => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "BEDA"} ${label}: parser=${got} html=${want} ${note}`);
};

// 1. homepage: jumlah anchor content_id
{
  const h = await home();
  const html = await raw("https://mangatoon.mobi/");
  const anchors = countAll(html, /<a\s+href="[^"]*content_id=\d+"/g);
  const parsed = h.banner_count + h.count;
  check("home anchor content_id", parsed, anchors);
  const noTitle = h.sections.flatMap((s) => s.items).filter((x) => !x.title).length;
  check("home kartu tanpa judul", noTitle, 0);
}

// 2. genre listing: 18 kartu per halaman
{
  const b = await browse();
  const html = await raw("https://mangatoon.mobi/en/genre/comic");
  check("browse kartu", b.count, countAll(html, /<div class="item">/g));
}

// 3. genre filter widget — opsi memakai `class="channel-a"`, bukan `channel-item`
//    (`channel-item` hanya 2 kontainer grup: Genres + Status).
{
  const g = await genres();
  const html = await raw("https://mangatoon.mobi/en/genre/comic");
  const items = countAll(html, /<a href="[^"]*" class="channel-a">/g);
  check("genres+status opsi", g.genres.length + g.status.length, items);
}

// 4. search: semua recommend-item terhitung
{
  const s = await search({ word: "bossy" });
  const html = await raw("https://mangatoon.mobi/en/search?word=bossy");
  check("search kartu", s.count, countAll(html, /<div class="recommend-item">/g));
}

// 5. series: episode unik = separuh episode-item-new
{
  for (const [id, slug] of [[21, "hunk-no-1"], [4, "kiss-goodbye"], [785, "bossy-president"]]) {
    const s = await series({ id, slug });
    const html = await raw(`https://mangatoon.mobi/en/${slug}?content_id=${id}`);
    const total = countAll(html, /<a class="episode-item-new"/g);
    check(`series ${id} episode unik`, s.episode_count, total / 2, `(html total ${total})`);
    const claim = Number((html.match(/Update to episode (\d+)/) || [0, 0])[1]);
    if (claim) check(`series ${id} cocok klaim situs`, s.episode_count, claim);
  }
}

// 6. reader: jumlah gambar = jumlah entry JSON pictures
{
  for (const [cid, eid] of [[21, 517], [21, 518], [5, 40]]) {
    const ep = await episodeImages({ contentId: cid, episodeId: eid });
    const html = await raw(`https://mangatoon.mobi/en/watch/${cid}/${eid}`);
    const m = html.match(/let pictures = (\[[\s\S]*?\]);/);
    const n = m ? JSON.parse(m[1]).length : 0;
    check(`watch ${cid}/${eid} gambar`, ep.count, n);
  }
}

// 7. booklist: semua anchor booklist-detail terhitung
{
  const b = await booklist();
  const html = await raw("https://mangatoon.mobi/en/book/list");
  check("booklist kartu", b.count, countAll(html, /<a href="\/[a-z]{2}\/booklist-detail\/\d+">/g));
}

// 8. sitemap: jumlah <url>
{
  const s = await sitemap({ lang: "en" });
  const xml = await raw("https://mangatoon.mobi/sitemap/detail_en.xml");
  check("sitemap entry", s.count, countAll(xml, /<url>/g));
}

// 9. tag listing halaman tengah
{
  const t = await byTag({ tag: 8, page: 3 });
  const html = await raw("https://mangatoon.mobi/en/genre/tags/8?page=2");
  check("byTag page3 kartu", t.count, countAll(html, /<div class="item">/g));
}

console.log(bad === 0 ? "\nSEMUA COCOK — tidak ada kehilangan senyap" : `\n${bad} SELISIH ditemukan`);
process.exit(bad === 0 ? 0 : 1);
