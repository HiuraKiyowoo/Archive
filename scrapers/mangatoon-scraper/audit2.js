// audit2.js — audit anti-null berskala: ambil banyak series/episode acak dari
// sitemap lalu periksa TIAP field. Tujuan: memastikan tidak ada field null,
// undefined, NaN, atau string kosong yang tidak disengaja.
import { sitemap, series, episodeImages, browse, byTag, booklist } from "./src/index.js";

const EMPTY_OK = new Set([
  // Field yang MEMANG boleh kosong di sisi situs (didokumentasikan di README):
  "user",          // booklist pemilik anonim/terhapus
  "user_avatar",   // avatar default
  "title",         // judul episode: banyak episode tanpa subtitle
  "views_raw",     // episode lama tanpa statistik
  "likes_raw",
  "author",        // sebagian series tidak mencantumkan penulis
  "description",   // sebagian series tanpa sinopsis
  "lastmod",       // entry sitemap tanpa <lastmod>
  "series_title",
]);

const problems = [];
function scan(v, path, field = "") {
  if (v === null) return problems.push(`${path} = null`);
  if (v === undefined) return problems.push(`${path} = undefined`);
  if (typeof v === "number" && Number.isNaN(v)) return problems.push(`${path} = NaN`);
  if (typeof v === "string" && v === "" && !EMPTY_OK.has(field)) {
    return problems.push(`${path} = "" (kosong)`);
  }
  if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${path}[${i}]`, field));
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) scan(val, `${path}.${k}`, k);
  }
}

const sm = await sitemap({ lang: "en" });
console.log(`sitemap en: ${sm.count} series`);

// 12 series tersebar merata di katalog
const step = Math.floor(sm.count / 12);
const picks = Array.from({ length: 12 }, (_, i) => sm.items[i * step]).filter(Boolean);

let epTotal = 0;
for (const p of picks) {
  try {
    const s = await series({ id: p.content_id, slug: p.slug });
    scan(s, `series(${p.content_id})`);
    epTotal += s.episode_count;
    // dedup: tidak boleh ada episode_id dobel
    const ids = s.episodes.map((e) => e.episode_id);
    if (new Set(ids).size !== ids.length) problems.push(`series(${p.content_id}) episode dobel`);
    // klaim situs vs jumlah nyata
    if (s.latest_episode && s.latest_episode !== s.episode_count) {
      problems.push(
        `series(${p.content_id}) klaim ${s.latest_episode} != parsed ${s.episode_count}`
      );
    }
    // ambil 1 episode acak dari series ini
    const ep = s.episodes[Math.floor(s.episode_count / 2)];
    if (ep) {
      const img = await episodeImages({ contentId: p.content_id, episodeId: ep.episode_id });
      scan(img, `ep(${p.content_id}/${ep.episode_id})`);
      if (img.count === 0) problems.push(`ep(${ep.episode_id}) 0 gambar`);
      for (const pg of img.pages) {
        if (!/^https:\/\/[a-z]{2}-c-pic-aliyun\.mangatoon\.mobi\/.*\.jpg$/.test(pg.url)) {
          problems.push(`ep(${ep.episode_id}) URL aneh: ${pg.url}`);
        }
      }
    }
    console.log(
      `  ok ${String(p.content_id).padEnd(8)} ${s.title.slice(0, 34).padEnd(36)} ` +
        `ep=${String(s.episode_count).padEnd(5)} status=${s.status}`
    );
  } catch (e) {
    problems.push(`series(${p.content_id}) ERROR: ${e.message}`);
  }
}

// listing lintas bahasa
for (const lang of ["en", "id", "es", "pt", "th"]) {
  const b = await browse({ lang });
  scan(b, `browse(${lang})`);
  console.log(`  browse ${lang}: ${b.count} item, next=${b.has_next}`);
}

// tag + booklist
scan(await byTag({ tag: 10, page: 2 }), "byTag(10,p2)");
scan(await booklist({ page: 2 }), "booklist(p2)");

console.log(`\ntotal episode diperiksa: ${epTotal}`);
if (problems.length === 0) {
  console.log("BERSIH: tidak ada null / undefined / NaN / kosong tak terduga");
} else {
  console.log(`${problems.length} MASALAH:`);
  for (const p of problems.slice(0, 40)) console.log("  -", p);
}
process.exit(problems.length ? 1 : 0);
