// okyykomik-scraper: normalisasi entri feed Blogger + parsing metadata.
//
// Jebakan penting dari recon:
// 1. Post SERIES dan post CHAPTER hidup di feed yang SAMA. Pembeda: label
//    "Series" vs "Chapter". TAPI 4 post chapter tidak punya label "Chapter"
//    sama sekali, jadi judul harus dipakai sebagai fallback.
// 2. Label seri di post chapter sering versi PENDEK dari judul series
//    (16 dari 41 series). Contoh: judul "Shinmai Necromancer, Maou wo Sosei
//    suru" tapi label chapter cuma "Shinmai Necromancer". Solusi: cocokkan
//    lewat label yang UNIK (hanya dipakai 1 series), bukan judul.
// 3. Metadata (Country/Author/Artist/Chapter/Published/Tags) ada di
//    <div id="extra-info"> DI DALAM content post — hanya 25 dari 41 series
//    punya blok ini.
// 4. Rating = label numerik di post series (mis. "8.60"); 4 series tidak punya.
// 5. Cover: media$thumbnail berukuran s72-c (thumbnail kecil) — harus di-upsize.
//    17 dari 41 series memakai gambar placeholder "OkyyKomik.jpg".

/** Label yang bukan judul/genre — dipakai untuk klasifikasi. */
export const LABEL_STATUS = new Set(["Ongoing", "Completed", "Hiatus", "Dropped"]);
export const LABEL_TYPE = new Set(["Manga", "Manhua", "Manhwa", "Novel"]);
export const LABEL_COUNTRY = new Set(["JP", "CN", "KR", "ID", "EN"]);
export const LABEL_SYSTEM = new Set([
  "Series", "Chapter", "Project", "ProjectOkyy", "New",
  ...LABEL_STATUS, ...LABEL_TYPE, ...LABEL_COUNTRY,
]);

const RE_RATING = /^\d+(\.\d+)?$/;

/** Buang tag HTML, rapikan entitas & spasi. */
export function stripHtml(s) {
  if (!s) return "";
  return decodeEntities(String(s).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/** Decode entitas HTML yang muncul di feed Blogger. */
export function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Daftar label sebuah entry feed. */
export function labelsOf(entry) {
  return (entry.category || []).map((c) => c.term).filter(Boolean);
}

/** URL publik post (link rel="alternate"). */
export function altLink(entry) {
  const l = (entry.link || []).find((x) => x.rel === "alternate" && x.href);
  return l ? l.href : null;
}

/** ID post numerik dari id feed Blogger (…post-3259626334273168939). */
export function postId(entry) {
  const raw = entry.id?.$t || "";
  const m = raw.match(/post-(\d+)/);
  return m ? m[1] : null;
}

/**
 * Perbesar gambar Blogger. Thumbnail feed datang sebagai /s72-c/ — segmen
 * ukuran itu diganti /s1600/ supaya dapat resolusi penuh. Diverifikasi live:
 * URL hasilnya balas 200 image/*.
 */
export function upsizeImage(url, size = "s1600") {
  if (!url) return null;
  return url
    .replace(/\/s\d+(-c|-rw|-rw-c)?\//, `/${size}/`)
    .replace(/\/w\d+-h\d+(-p)?(-k)?(-no)?(-nu)?\//, `/${size}/`);
}

/** Apakah entry ini post CHAPTER? */
export function isChapterEntry(entry) {
  const L = labelsOf(entry);
  if (L.includes("Chapter")) return true;
  if (L.includes("Series")) return false;
  // 4 post chapter di situs ini tidak berlabel "Chapter" — pakai judul.
  return /\bchapter\s*[\d.]+/i.test(entry.title?.$t || "");
}

/** Apakah entry ini post SERIES? */
export function isSeriesEntry(entry) {
  return labelsOf(entry).includes("Series");
}

/** Nomor chapter dari judul post. */
export function chapterNumber(title) {
  const m = String(title || "").match(/chapter\s*([\d]+(?:\.[\d]+)?)/i);
  return m ? m[1].replace(/^0+(?=\d)/, "") : null;
}

/** Rating dari label numerik. */
export function ratingOf(entry) {
  const n = labelsOf(entry).find((t) => RE_RATING.test(t));
  return n ? Number(n) : null;
}

/**
 * Genre = label yang bukan sistem, bukan rating, bukan nama seri.
 * `seriesLabels` = label yang sudah diketahui sebagai nama seri.
 */
export function genresOf(entry, seriesLabels = new Set()) {
  const title = (entry.title?.$t || "").trim();
  return labelsOf(entry)
    .filter((t) => !LABEL_SYSTEM.has(t))
    .filter((t) => !RE_RATING.test(t))
    .filter((t) => t.length > 2)            // label indeks abjad: "K", "U", "W"
    .filter((t) => t !== title)
    .filter((t) => !seriesLabels.has(t))
    .sort();
}

/** Blok <div id="extra-info"> di dalam content post series. */
export function parseExtraInfo(content) {
  const out = { country: null, author: null, artist: null, chapter_count: null, published: null, tags: [] };
  if (!content) return out;
  const blok = content.match(/<div id="extra-info">([\s\S]*?)<\/div>/i);
  if (!blok) return out;
  const map = {};
  for (const m of blok[1].matchAll(/<dt>([^<]+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)) {
    map[stripHtml(m[1]).replace(/:$/, "").toLowerCase()] = stripHtml(m[2]);
  }
  out.country = map.country || null;
  out.author = map.author || null;
  out.artist = map.artist || null;
  out.chapter_count = map.chapter ? map.chapter.replace(/^0+(?=\d)/, "") : null;
  out.published = map.published || null;
  out.tags = map.tags ? map.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return out;
}

/** Sinopsis dari <div id="synopsis"> (semua 41 series punya blok ini). */
export function parseSynopsis(content, fallback = "") {
  if (content) {
    const m = content.match(/<div id="synopsis">([\s\S]*?)<\/div>/i);
    if (m) {
      const t = stripHtml(m[1]);
      if (t) return t;
    }
  }
  return stripHtml(fallback);
}

/** URL gambar dari content post chapter, berurutan sesuai kemunculan. */
export function imagesOf(content) {
  if (!content) return [];
  const out = [];
  for (const m of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const u = decodeEntities(m[1]);
    if (/^https?:\/\//i.test(u)) out.push(upsizeImage(u));
  }
  return [...new Set(out)];
}

/** Slug dari URL post: /2024/10/nama-post.html -> nama-post */
export function slugOf(url) {
  if (!url) return null;
  const m = String(url).match(/\/([^/]+)\.html(?:[?#].*)?$/);
  return m ? m[1] : null;
}
