// Parser kartu listing & taxonomy animexin.dev.
import { declutter, text, attr, slugOf, episodeNumberFromSlug } from './html.js';

/**
 * Parse kartu `.bs > .bsx` (markup listing utama).
 * Dipakai di: homepage, /?post_type=anime, /?s=, /genres/*, /studio/*,
 * /country/*, /network/*.
 *
 * Kartu punya dua bentuk:
 *  - kartu EPISODE (homepage): badge `.epx` berisi "Ep 156", link ke post
 *    episode, ada `.hotbadge` bila sedang panas.
 *  - kartu SERIES (/?post_type=anime): `.epx` berisi status ("Completed"),
 *    ada `.status`, link ke halaman series.
 * Keduanya dibedakan lewat field `kind`.
 */
export function parseCards(html) {
  const clean = declutter(html);
  const out = [];
  const re = /<article class="bs"[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const card = m[1];
    const aTag = /<a\s[^>]*href="([^"]+)"[^>]*>/i.exec(card);
    if (!aTag) continue;
    const url = aTag[1];
    const slug = slugOf(url);

    const title = attr(aTag[0], 'title') || text(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(card)?.[1]);
    const seriesTitle = text(
      /<div class="tt">([\s\S]*?)(?:<h2|<\/div>)/i.exec(card)?.[1]
    );
    const typez = text(/<div class="typez[^"]*">([\s\S]*?)<\/div>/i.exec(card)?.[1]);
    const statusBadge = text(
      /<div class="status\s+([A-Za-z]*)"[^>]*>([\s\S]*?)<\/div>/i.exec(card)?.[2]
    );
    const epx = text(/<span class="epx">([\s\S]*?)<\/span>/i.exec(card)?.[1]);
    const sub = text(/<span class="sb\s*[^"]*">([\s\S]*?)<\/span>/i.exec(card)?.[1]);
    const img = /<img[^>]+>/i.exec(card);
    const poster = img ? attr(img[0], 'src') : '';

    const isEpisode = /^Ep\s*\d/i.test(epx) || /-episode-\d+/i.test(slug);
    const epNum = isEpisode
      ? episodeNumberFromSlug(slug) || Number(/(\d+)/.exec(epx)?.[1] || 0)
      : 0;

    out.push({
      kind: isEpisode ? 'episode' : 'series',
      title,
      series_title: seriesTitle || title,
      url,
      slug,
      poster,
      type: typez,
      status: statusBadge,
      episode: epNum,
      episode_label: epx,
      subtitle: sub,
      hot: /class="hotbadge"/i.test(card),
    });
  }
  return out;
}

/**
 * Parse halaman /season/{slug}/ — markup `.listseries > .card`, BUKAN `.bsx`.
 * Kartu di sini kaya: jumlah episode, tipe, status, judul alternatif, sinopsis.
 */
export function parseSeasonCards(html) {
  const clean = declutter(html);
  const out = [];
  const re = /<div class="card">([\s\S]*?)(?=<div class="card">|<\/div>\s*<\/div>\s*<div class="pagination|$)/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const card = m[1];
    const aTag = /<a\s[^>]*href="([^"]+)"[^>]*>/i.exec(card);
    if (!aTag) continue;
    const url = aTag[1];
    if (!/^https?:\/\/animexin\.dev\/[^/]+\/?$/.test(url)) continue;

    const stats = text(/<div class="left">([\s\S]*?)<\/div>/i.exec(card)?.[1]);
    const epMatch = /(\d+)\s*episodes?/i.exec(stats);
    const typeMatch = /episodes?\s*\u00b7\s*([A-Za-z]+)/i.exec(stats);
    const img = /<img[^>]+>/i.exec(card);

    out.push({
      kind: 'series',
      title: text(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(card)?.[1]) || attr(aTag[0], 'title'),
      url,
      slug: slugOf(url),
      poster: img ? attr(img[0], 'src') : '',
      episode_total: epMatch ? Number(epMatch[1]) : 0,
      type: typeMatch ? typeMatch[1] : '',
      status: text(/<span class="status">([\s\S]*?)<\/span>/i.exec(card)?.[1]),
      alternative_title: text(
        /<span class="alternative">([\s\S]*?)<\/span>/i.exec(card)?.[1]
      ),
      synopsis: text(/<div class="desc">([\s\S]*?)<\/div>/i.exec(card)?.[1]).slice(0, 600),
    });
  }
  return out;
}

/**
 * Parse /schedule/ — markup `.listSchh` (satu blok per hari),
 * `h2` = nama hari, `.subSchh > a` = daftar series.
 * Beberapa link memakai prefix /anime/ yang diblokir CF; di sini prefix itu
 * DIBUANG supaya URL-nya bisa dipakai (sudah diverifikasi: slug yang sama
 * dapat diakses tanpa prefix).
 */
export function parseSchedule(html) {
  const clean = declutter(html);
  const days = [];
  const re = /<div class="listSchh">([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const blok = m[1];
    const day = text(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(blok)?.[1]);
    if (!day) continue;
    const items = [];
    const aRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let a;
    while ((a = aRe.exec(blok)) !== null) {
      const raw = a[1];
      if (!/^https?:\/\/animexin\.dev\//.test(raw)) continue;
      const title = text(a[2]);
      if (!title) continue;
      const url = raw.replace('/anime/', '/');
      items.push({ title, url, slug: slugOf(url), blocked_path: raw !== url });
    }
    days.push({ day, count: items.length, series: items });
  }
  return days;
}
