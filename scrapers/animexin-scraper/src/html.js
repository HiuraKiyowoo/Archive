// Helper parsing HTML animexin.dev — zero dependency (regex + pembersihan teks).
//
// Catatan markup penting hasil recon 2026-08-31:
// - Kartu listing: <article class="bs"><div class="bsx"><a href title>...
//   dipakai di homepage, /?post_type=anime, /?s=, /genres/*, /studio/*,
//   /country/*, /network/*.
// - Kelas .bsx JUGA muncul di dalam blok <style> (aturan CSS tema). Jadi
//   HITUNG KARTU HANYA setelah <style>/<script> dibuang, kalau tidak jumlahnya
//   salah (halaman /season/ punya 11 "bsx" yang semuanya CSS, nol kartu).
// - Halaman /season/{slug}/ memakai markup BERBEDA: .listseries > .card.
// - Halaman /schedule/ memakai markup BERBEDA lagi: .listSchh (h2 = nama hari)
//   > .subSchh > <a>.

/** Buang <style> dan <script> supaya regex tidak kena aturan CSS/JS. */
export function declutter(html) {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#039': "'",
  '#8217': '\u2019',
  '#8216': '\u2018',
  '#8220': '\u201c',
  '#8221': '\u201d',
  '#8211': '\u2013',
  '#8212': '\u2014',
  nbsp: ' ',
  hellip: '\u2026',
};

export function decodeEntities(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&([a-z]+|#\d+);/gi, (m, code) => {
      const key = code.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (ENTITIES[code] !== undefined) return ENTITIES[code];
      if (code.startsWith('#')) {
        const n = Number(code.slice(1));
        if (Number.isFinite(n)) return String.fromCharCode(n);
      }
      return m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/** Hapus semua tag, rapikan spasi, decode entity. */
export function text(html) {
  if (html == null) return '';
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ambil atribut pertama dari sebuah potongan tag. */
export function attr(tagHtml, name) {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(String(tagHtml || ''));
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i');
  const m2 = re2.exec(String(tagHtml || ''));
  return m2 ? decodeEntities(m2[1]) : '';
}

/** Slug terakhir dari sebuah URL animexin. */
export function slugOf(url) {
  if (!url) return '';
  const m = /^https?:\/\/[^/]+\/(.+?)\/?$/.exec(String(url));
  if (!m) return '';
  const parts = m[1].split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Nomor episode dari slug episode, mis. `...-episode-156-...` -> 156. */
export function episodeNumberFromSlug(slug) {
  const m = /episode-(\d+)(?:-(\d+))?/i.exec(String(slug || ''));
  if (!m) return 0;
  return Number(m[1]);
}

/** Absolutkan URL protokol-relatif (`//ok.ru/...`) dan path relatif. */
export function absolutize(url, base = 'https://animexin.dev') {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http')) return u;
  if (u.startsWith('/')) return base + u;
  return u;
}
