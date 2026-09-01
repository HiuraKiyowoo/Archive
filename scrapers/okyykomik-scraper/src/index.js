// okyykomik-scraper: API publik (library murni, tanpa dependensi).
//
// Sumber data: Blogger Feed API www.okyykomik.my.id/feeds/posts/*
// Semua fungsi mengembalikan objek biasa (tanpa side effect, aman di-import).

import { feedGet, htmlGet, HttpError, FeedError, clearCache, BASE } from "./http.js";
import {
  labelsOf, altLink, postId, isChapterEntry, isSeriesEntry, chapterNumber,
  ratingOf, genresOf, parseExtraInfo, parseSynopsis, imagesOf, slugOf,
  upsizeImage, stripHtml, decodeEntities,
  LABEL_STATUS, LABEL_TYPE, LABEL_COUNTRY,
} from "./normalize.js";

const SOURCE = "okyykomik.my.id";

/**
 * PENTING — pagination Blogger.
 *
 * `max-results=100` TIDAK selalu balas 100 entri: Blogger juga membatasi ukuran
 * respons, jadi sebuah halaman bisa balas 72 entri padahal diminta 100.
 * Kalau start-index dimajukan tetap +100, post-post itu TERLEWAT.
 * Diverifikasi live: cara naif dapat 510 dari 538 post (28 hilang).
 * Yang benar: majukan start-index sebanyak entri yang BENAR-BENAR diterima.
 */
async function collect(path, { params = {}, limit = Infinity, perPage = 100 } = {}) {
  const out = [];
  let si = 1;
  let total = null;
  let url = null;
  for (;;) {
    const { data, url: u } = await feedGet(path, {
      ...params,
      "max-results": perPage,
      "start-index": si,
    });
    if (url === null) url = u;
    const feed = data.feed;
    if (!feed) throw new FeedError(u, "Envelope feed tidak dikenal (tidak ada .feed)");
    if (total === null) total = Number(feed["openSearch$totalResults"]?.$t ?? 0);
    const got = feed.entry || [];
    if (got.length === 0) break;
    out.push(...got);
    if (out.length >= limit) break;
    si += got.length;
    if (si > total) break;
  }
  return { entries: out.slice(0, limit === Infinity ? out.length : limit), total, url };
}

/** Peta label-unik -> judul series. Kunci pemasangan chapter ke series. */
let _labelMapCache = null;

async function seriesLabelMap() {
  if (_labelMapCache) return _labelMapCache;
  const { entries } = await collect("/feeds/posts/default/-/Series", {});
  const freq = new Map();
  for (const e of entries) {
    for (const l of new Set(labelsOf(e))) freq.set(l, (freq.get(l) || 0) + 1);
  }
  const map = new Map();       // label unik -> judul series
  const perSeries = new Map(); // judul series -> label unik[]
  for (const e of entries) {
    const title = (e.title?.$t || "").trim();
    const unik = [...new Set(labelsOf(e))].filter(
      (l) => freq.get(l) === 1 && l.length > 2 && !/^\d+(\.\d+)?$/.test(l),
    );
    perSeries.set(title, unik);
    for (const l of unik) map.set(l, title);
  }
  const allSeriesLabels = new Set(map.keys());
  for (const e of entries) allSeriesLabels.add((e.title?.$t || "").trim());
  _labelMapCache = { entries, map, perSeries, allSeriesLabels };
  return _labelMapCache;
}

/** Kartu ringkas untuk listing. */
function toCard(entry, seriesLabels) {
  const url = altLink(entry);
  const thumb = entry["media$thumbnail"]?.url || null;
  return {
    id: postId(entry),
    title: decodeEntities((entry.title?.$t || "").trim()),
    slug: slugOf(url),
    url,
    kind: isChapterEntry(entry) ? "chapter" : isSeriesEntry(entry) ? "series" : "other",
    chapter: chapterNumber(entry.title?.$t),
    cover: upsizeImage(thumb),
    thumbnail: thumb,
    rating: ratingOf(entry),
    status: labelsOf(entry).find((t) => LABEL_STATUS.has(t)) || null,
    type: labelsOf(entry).find((t) => LABEL_TYPE.has(t)) || null,
    country: labelsOf(entry).find((t) => LABEL_COUNTRY.has(t)) || null,
    genres: genresOf(entry, seriesLabels),
    published: entry.published?.$t || null,
    updated: entry.updated?.$t || null,
    comments: Number(entry["thr$total"]?.$t ?? 0),
  };
}

/** Update terbaru (post apa pun, urut terbaru). */
export async function latest({ limit = 20 } = {}) {
  const { allSeriesLabels } = await seriesLabelMap();
  const { entries, total, url } = await collect("/feeds/posts/summary", { limit });
  return {
    source: SOURCE,
    command: "latest",
    url,
    ok: true,
    total_posts: total,
    count: entries.length,
    data: entries.map((e) => toCard(e, allSeriesLabels)),
  };
}

/** Chapter terbaru saja. */
export async function latestChapters({ limit = 20 } = {}) {
  const { allSeriesLabels, map } = await seriesLabelMap();
  const { entries, total, url } = await collect("/feeds/posts/summary/-/Chapter", { limit });
  return {
    source: SOURCE,
    command: "latestChapters",
    url,
    ok: true,
    total_chapters: total,
    count: entries.length,
    data: entries.map((e) => {
      const c = toCard(e, allSeriesLabels);
      const lab = labelsOf(e).find((l) => map.has(l));
      c.series_title = lab ? map.get(lab) : null;
      return c;
    }),
  };
}

/** Seluruh katalog series (41 judul). */
export async function seriesList({ limit = Infinity, status, type, country, genre } = {}) {
  const { entries, allSeriesLabels } = await seriesLabelMap();
  let cards = entries.map((e) => toCard(e, allSeriesLabels));
  if (status) cards = cards.filter((c) => c.status === status);
  if (type) cards = cards.filter((c) => c.type === type);
  if (country) cards = cards.filter((c) => c.country === country);
  if (genre) {
    const g = String(genre).toLowerCase();
    cards = cards.filter((c) => c.genres.some((x) => x.toLowerCase() === g));
  }
  cards.sort((a, b) => a.title.localeCompare(b.title));
  const sliced = limit === Infinity ? cards : cards.slice(0, limit);
  return {
    source: SOURCE,
    command: "seriesList",
    url: `${BASE}/feeds/posts/default/-/Series?alt=json`,
    ok: true,
    total_series: entries.length,
    count: sliced.length,
    filters: { status: status || null, type: type || null, country: country || null, genre: genre || null },
    data: sliced,
  };
}

/**
 * Detail satu series + seluruh chapter-nya.
 * `key` = judul series, label unik, atau slug URL.
 */
export async function seriesDetail(key) {
  if (!key) throw new TypeError("seriesDetail(key): key wajib");
  const { entries, map, perSeries, allSeriesLabels } = await seriesLabelMap();
  const needle = String(key).trim().toLowerCase();

  // Judul di feed masih ber-entitas HTML ("Why You Shouldn&#39;t ..."), sedangkan
  // judul yang dikembalikan listing sudah di-decode. Pencocokan harus memakai
  // bentuk decoded di KEDUA sisi, kalau tidak series ber-apostrof tidak ketemu.
  const judulNorm = (e) => decodeEntities((e.title?.$t || "").trim()).toLowerCase();
  const needleNorm = decodeEntities(needle).toLowerCase();

  let entry = entries.find((e) => judulNorm(e) === needleNorm);
  if (!entry) {
    const lewatLabel = [...map.entries()].find(
      ([l]) => decodeEntities(l).toLowerCase() === needleNorm,
    );
    if (lewatLabel) {
      const judul = lewatLabel[1];
      entry = entries.find((e) => (e.title?.$t || "").trim() === judul);
    }
  }
  if (!entry) entry = entries.find((e) => slugOf(altLink(e)) === needle);
  if (!entry) entry = entries.find((e) => judulNorm(e).includes(needleNorm));
  if (!entry) throw new HttpError(404, `${BASE}/feeds/posts/default/-/Series`, `Series tidak ditemukan: ${key}`);

  const title = decodeEntities((entry.title?.$t || "").trim());
  const content = entry.content?.$t || "";
  const info = parseExtraInfo(content);
  const card = toCard(entry, allSeriesLabels);

  // Chapter: kumpulkan lewat SEMUA label unik series ini (label pendek + judul).
  const labels = new Set([...(perSeries.get(entry.title?.$t?.trim()) || []), entry.title?.$t?.trim()]);
  const chapters = new Map();
  for (const lab of labels) {
    if (!lab) continue;
    let hasil;
    try {
      hasil = await collect(`/feeds/posts/summary/-/${encodeURIComponent(lab)}`, {});
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) continue;
      throw e;
    }
    for (const e of hasil.entries) {
      if (!isChapterEntry(e)) continue;
      const u = altLink(e);
      if (!chapters.has(u)) {
        chapters.set(u, {
          id: postId(e),
          title: decodeEntities((e.title?.$t || "").trim()),
          chapter: chapterNumber(e.title?.$t),
          slug: slugOf(u),
          url: u,
          published: e.published?.$t || null,
          updated: e.updated?.$t || null,
        });
      }
    }
  }
  const list = [...chapters.values()].sort((a, b) => {
    const fa = parseFloat(a.chapter), fb = parseFloat(b.chapter);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
    return String(b.published).localeCompare(String(a.published));
  });

  return {
    source: SOURCE,
    command: "seriesDetail",
    url: card.url,
    ok: true,
    data: {
      ...card,
      kind: "series",
      chapter: null,
      synopsis: parseSynopsis(content, entry.summary?.$t),
      author: info.author,
      artist: info.artist,
      country_full: info.country,
      year_published: info.published,
      chapter_count_meta: info.chapter_count,
      tags: info.tags,
      labels: labelsOf(entry).sort(),
      series_labels: [...labels].filter(Boolean).sort(),
      chapter_total: list.length,
      chapters: list,
    },
  };
}

/** Satu chapter: gambar + nav prev/next + info series. */
export async function chapter(key) {
  if (!key) throw new TypeError("chapter(key): key wajib");
  const { map, allSeriesLabels } = await seriesLabelMap();
  const needle = String(key).trim();

  let entry = null;
  if (/^\d{6,}$/.test(needle)) {
    const { data, url } = await feedGet(`/feeds/posts/default/${needle}`);
    if (!data.entry) throw new HttpError(404, url, `Chapter tidak ditemukan: ${key}`);
    entry = data.entry;
  } else {
    const { entries } = await collect("/feeds/posts/default/-/Chapter", {});
    const low = needle.toLowerCase();
    entry = entries.find((e) => slugOf(altLink(e)) === low)
      || entries.find((e) => (e.title?.$t || "").trim().toLowerCase() === low)
      || entries.find((e) => (e.title?.$t || "").trim().toLowerCase().includes(low));
    if (!entry) throw new HttpError(404, `${BASE}/feeds/posts/default/-/Chapter`, `Chapter tidak ditemukan: ${key}`);
  }

  const content = entry.content?.$t || "";
  const images = imagesOf(content);
  const lab = labelsOf(entry).find((l) => map.has(l));
  const seriesTitle = lab ? map.get(lab) : null;

  // Nav: ambil daftar chapter series ini, cari posisi.
  let prev = null, next = null, seriesUrl = null, total = null;
  if (seriesTitle) {
    const det = await seriesDetail(seriesTitle);
    seriesUrl = det.data.url;
    total = det.data.chapter_total;
    const idx = det.data.chapters.findIndex((c) => c.id === postId(entry));
    if (idx !== -1) {
      next = idx > 0 ? det.data.chapters[idx - 1] : null;   // urut DESC: index kecil = lebih baru
      prev = idx < det.data.chapters.length - 1 ? det.data.chapters[idx + 1] : null;
    }
  }

  const url = altLink(entry);
  return {
    source: SOURCE,
    command: "chapter",
    url,
    ok: true,
    data: {
      id: postId(entry),
      title: decodeEntities((entry.title?.$t || "").trim()),
      chapter: chapterNumber(entry.title?.$t),
      slug: slugOf(url),
      url,
      series_title: seriesTitle,
      series_url: seriesUrl,
      series_chapter_total: total,
      published: entry.published?.$t || null,
      updated: entry.updated?.$t || null,
      image_count: images.length,
      images,
      nav: { prev, next },
      labels: labelsOf(entry).sort(),
    },
  };
}

/** Hanya URL gambar sebuah chapter. */
export async function chapterImages(key) {
  const r = await chapter(key);
  return {
    source: SOURCE,
    command: "chapterImages",
    url: r.url,
    ok: true,
    title: r.data.title,
    count: r.data.image_count,
    data: r.data.images,
  };
}

/**
 * Pencarian via parameter `q` feed Blogger.
 * Catatan: robots.txt melarang /search (halaman HTML) — endpoint feed `q=`
 * tidak dilarang, jadi itu yang dipakai.
 */
export async function search(q, { limit = 25 } = {}) {
  if (!q) throw new TypeError("search(q): q wajib");
  const { allSeriesLabels, map } = await seriesLabelMap();
  const { entries, total, url } = await collect("/feeds/posts/summary", { params: { q }, limit });
  return {
    source: SOURCE,
    command: "search",
    url,
    ok: true,
    query: String(q),
    total_match: total,
    count: entries.length,
    data: entries.map((e) => {
      const c = toCard(e, allSeriesLabels);
      if (c.kind === "chapter") {
        const lab = labelsOf(e).find((l) => map.has(l));
        c.series_title = lab ? map.get(lab) : null;
      }
      return c;
    }),
  };
}

/** Daftar label + jumlah pemakaian, dipisah per kategori. */
export async function labels() {
  const { entries } = await seriesLabelMap();
  const freq = new Map();
  for (const e of entries) {
    for (const l of new Set(labelsOf(e))) freq.set(l, (freq.get(l) || 0) + 1);
  }
  const genre = [], sistem = [], seri = [], rating = [], abjad = [];
  for (const [l, n] of freq) {
    const item = { label: l, count: n };
    if (/^\d+(\.\d+)?$/.test(l)) rating.push(item);
    else if (l.length <= 2) abjad.push(item);
    else if (LABEL_STATUS.has(l) || LABEL_TYPE.has(l) || LABEL_COUNTRY.has(l)
      || ["Series", "Chapter", "Project", "ProjectOkyy", "New"].includes(l)) sistem.push(item);
    else if (n === 1) seri.push(item);
    else genre.push(item);
  }
  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label);
  return {
    source: SOURCE,
    command: "labels",
    url: `${BASE}/feeds/posts/default/-/Series?alt=json`,
    ok: true,
    genre_count: genre.length,
    data: {
      genre: genre.sort(byCount),
      system: sistem.sort(byCount),
      series_labels: seri.sort((a, b) => a.label.localeCompare(b.label)),
      rating: rating.sort(byCount),
      alphabet_index: abjad.sort(byCount),
    },
  };
}

/** Semua post ber-label tertentu (genre, status, tipe, dsb). */
export async function byLabel(label, { limit = 50 } = {}) {
  if (!label) throw new TypeError("byLabel(label): label wajib");
  const { allSeriesLabels } = await seriesLabelMap();
  const { entries, total, url } = await collect(
    `/feeds/posts/summary/-/${encodeURIComponent(label)}`, { limit },
  );
  return {
    source: SOURCE,
    command: "byLabel",
    url,
    ok: true,
    label: String(label),
    total_match: total,
    count: entries.length,
    data: entries.map((e) => toCard(e, allSeriesLabels)),
  };
}

/** Statistik blog dari feed + jumlah per kategori. */
export async function stats() {
  const { entries: ser } = await seriesLabelMap();
  const { total: totalPost, url } = await collect("/feeds/posts/summary", { limit: 1 });
  const { total: totalCh } = await collect("/feeds/posts/summary/-/Chapter", { limit: 1 });
  const per = { status: {}, type: {}, country: {} };
  for (const e of ser) {
    for (const [k, set] of [["status", LABEL_STATUS], ["type", LABEL_TYPE], ["country", LABEL_COUNTRY]]) {
      const v = labelsOf(e).find((t) => set.has(t));
      if (v) per[k][v] = (per[k][v] || 0) + 1;
    }
  }
  return {
    source: SOURCE,
    command: "stats",
    url,
    ok: true,
    data: {
      total_posts: totalPost,
      total_chapters: totalCh,
      total_series: ser.length,
      by_status: per.status,
      by_type: per.type,
      by_country: per.country,
    },
  };
}

/** Sitemap XML: semua URL post. */
export async function sitemap() {
  const { html, url } = await htmlGet("/sitemap.xml");
  const locs = [...html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return {
    source: SOURCE,
    command: "sitemap",
    url,
    ok: true,
    count: locs.length,
    data: locs,
  };
}

/** Susuri semua series + hitung chapter (lambat, banyak request). */
export async function walkSeries({ limit = 5 } = {}) {
  const { entries } = await seriesLabelMap();
  const out = [];
  for (const e of entries.slice(0, limit)) {
    const judul = (e.title?.$t || "").trim();
    const det = await seriesDetail(judul);
    out.push({
      title: det.data.title,
      url: det.data.url,
      rating: det.data.rating,
      status: det.data.status,
      chapter_total: det.data.chapter_total,
      first_chapter: det.data.chapters.at(-1)?.chapter ?? null,
      last_chapter: det.data.chapters[0]?.chapter ?? null,
    });
  }
  return {
    source: SOURCE,
    command: "walkSeries",
    url: `${BASE}/feeds/posts/default/-/Series?alt=json`,
    ok: true,
    count: out.length,
    data: out,
  };
}

export { HttpError, FeedError, clearCache, BASE };
