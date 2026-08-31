// cosmicscans-scraper: normalisasi field & util parsing.
//
// Catatan penting hasil recon:
// - `readingPage.chapters` BUKAN daftar chapter, tapi daftar GAMBAR halaman,
//   dan tiap elemen berupa string HTML `<img src='...'>` (bukan URL polos).
//   Daftar chapter sebenarnya ada di `otherChapters`.
// - `sinopsis` mengandung tag HTML + entitas → dibersihkan jadi teks polos.
// - `cover` bisa berupa path relatif → diabsolutkan ke API_BASE.
// - Nilai string kosong dari API diseragamkan jadi null.

import { API_BASE } from "./http.js";

/** Trim; string kosong → null. */
export function nz(v) {
  if (typeof v !== "string") return v ?? null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Absolutkan URL aset relatif terhadap API_BASE. */
export function absUrl(v) {
  const t = nz(v);
  if (!t) return null;
  if (/^(?:https?:|data:|blob:)/i.test(t)) return t;
  try {
    return new URL(t, API_BASE + "/").toString();
  } catch {
    return t;
  }
}

/** Buang tag HTML + decode entitas dasar → teks polos multiline. */
export function stripHtml(v) {
  const t = nz(v);
  if (!t) return null;
  const out = t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out === "" ? null : out;
}

/**
 * Ambil URL gambar dari entri readingPage.
 * Bentuk asli: `<img src='https://cdn.uqni.net/...jpeg'>`.
 * Kalau ternyata sudah URL polos, dipakai langsung.
 */
export function imgSrc(entry) {
  if (typeof entry !== "string") return null;
  const t = entry.trim();
  if (!t) return null;
  const m = t.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
  const url = m ? m[1] : t.replace(/<[^>]*>/g, "").trim();
  return url ? absUrl(url) : null;
}

/** Normalisasi satu entri chapter (dipakai di listing & detail). */
export function normChapter(c) {
  if (!c || typeof c !== "object") return null;
  const num = nz(c.chapterNum);
  return {
    chapter: num,
    chapter_number: num === null ? null : Number.parseFloat(num.replace(",", ".")),
    slug: nz(c.slug),
    url: c.slug ? `${chapterPath(c.slug)}` : null,
    time: nz(c.time),
    cover: absUrl(c.cover),
    redirect_link: nz(c.redirect_link),
  };
}

/** URL halaman baca di situs publik. Diverifikasi live: /chapter/{slug}/ = 200. */
export function chapterPath(slug) {
  return `https://03.cosmicscans.to/chapter/${slug}/`;
}

/** URL halaman series di situs publik. Diverifikasi live: /series/{slug}/ = 200. */
export function seriesPath(slug) {
  return `https://03.cosmicscans.to/series/${slug}/`;
}

/** Normalisasi kartu series pada endpoint listing. */
export function normCard(x) {
  if (!x || typeof x !== "object") return null;
  const genres = Array.isArray(x.genres)
    ? x.genres.filter(Boolean)
    : typeof x.genre === "string" && x.genre.trim()
      ? x.genre.split(",").map((g) => g.trim()).filter(Boolean)
      : [];
  const chapters = Array.isArray(x.chapters)
    ? x.chapters.map(normChapter).filter(Boolean)
    : [];
  return {
    title: nz(x.title),
    slug: nz(x.slug),
    url: x.slug ? seriesPath(x.slug) : null,
    cover: absUrl(x.cover),
    badge: nz(x.badge),
    rating: nz(x.rating),
    status: nz(x.status),
    type: nz(x.type),
    is_project: x.is_project === true,
    genres,
    latest_chapters: chapters,
    latest_chapter: chapters.length ? chapters[0].chapter : null,
  };
}
