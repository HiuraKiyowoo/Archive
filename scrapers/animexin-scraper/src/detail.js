// Parser halaman series & episode animexin.dev.
import {
  declutter,
  text,
  attr,
  slugOf,
  episodeNumberFromSlug,
  absolutize,
} from './html.js';

/**
 * Parse halaman SERIES: metadata dari blok `.spe` + genre `.genxed`,
 * judul alternatif `.alter`, poster, sinopsis, dan daftar episode `.eplister`.
 *
 * Catatan penting:
 * - Halaman series TIDAK punya URL arsip /anime/{slug}/ (403 CF).
 *   URL series selalu tanpa prefix: https://animexin.dev/{slug}/
 * - `eplister` kadang KOSONG <ul></ul> (mis. series baru / belum masuk
 *   daftar). Itu data situs, bukan bug — chapter_count = 0.
 * - Field yang memang tidak ada di situs dikembalikan sebagai null/"" —
 *   jangan ditebak.
 */
export function parseSeries(html, url = '') {
  const clean = declutter(html);
  const raw = html;

  const h1 = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw)?.[1]);

  // Poster: .thumbook > .thumb > img (fallback: img pertama di bigcontent)
  const posterMatch =
    /<div class="thumbook"[\s\S]*?<div class="thumb"[^>]*>\s*<img[^>]+src="([^"]+)"/i.exec(
      raw
    ) || /<div class="thumb"[^>]*>\s*<img[^>]+src="([^"]+)"/i.exec(raw);

  // Baris metadata .spe: <span><b>Status:</b> Ongoing</span> dst.
  // Nilainya tidak selalu teks polos — bisa <a>, <i class="fn"> (Posted by),
  // atau <time datetime> (Released on / Updated on). Jadi ambil seluruh isi
  // span setelah </b> lalu bersihkan tagnya.
  const spe = {};
  const speBlock = /class="spe">([\s\S]*?)<\/div>/i.exec(raw)?.[1] || '';
  for (const sm of speBlock.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)) {
    const isi = sm[1];
    const lm = /<b>([^<]+?):?<\/b>([\s\S]*)$/i.exec(isi);
    if (!lm) continue;
    const key = text(lm[1]).toLowerCase().replace(/:$/, '').replace(/\s+/g, '_');
    const val = text(lm[2]);
    if (key && val) spe[key] = val;
  }

  // Genre: tautan /genres/{slug}/ di blok .genxed (bisa duplikat — dedup)
  const genreBlock = /class="genxed">([\s\S]*?)<\/div>/i.exec(raw)?.[1] || '';
  const genres = [];
  for (const gm of genreBlock.matchAll(
    /<a\s[^>]*href="https?:\/\/animexin\.dev\/genres\/([^/"]+)\/"[^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const label = text(gm[2]);
    if (label && !genres.includes(label)) genres.push(label);
  }

  // Judul alternatif (.alter)
  const alter = text(/class="alter"[^>]*>([\s\S]*?)<\/span>/i.exec(raw)?.[1]);

  // Sinopsis: blok itemprop="description" (paragraf English lalu Indonesia).
  // Paragraf penanda bahasa ("English", "Indonesia") dipisah jadi label
  // supaya sinopsis tetap bisa dibaca per bahasa.
  let synopsis = '';
  const synParas = [];
  const descBlock = /class="entry-content"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i.exec(
    raw
  );
  if (descBlock) {
    for (const p of descBlock[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const t = text(p[1]);
      if (t) synParas.push(t);
    }
    synopsis = synParas.join('\n').slice(0, 4000);
  }
  // pisah per bahasa bila ada penanda
  const synopsisByLang = {};
  let langAktif = '';
  for (const p of synParas) {
    if (/^(english|indonesia|indonesian)$/i.test(p)) {
      langAktif = p.toLowerCase().startsWith('ind') ? 'id' : 'en';
      continue;
    }
    if (langAktif) {
      synopsisByLang[langAktif] = (synopsisByLang[langAktif] || '') + (synopsisByLang[langAktif] ? '\n' : '') + p;
    }
  }

  // Rating wpdiscuz (opsional, ada di beberapa series)
  const ratingMatch = /class='wpdrv'>([\d.]+)</.exec(raw);
  const votesMatch = /class='wpdrc'>(\d+)</.exec(raw);

  // Daftar episode .eplister (urutan situs: DESC, terbaru dulu)
  const episodes = [];
  const epBlock = /class="eplister"[\s\S]*?<ul>([\s\S]*?)<\/ul>/i.exec(clean)?.[1] || '';
  for (const em of epBlock.matchAll(/<li[^>]*data-index="\d+"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const li = em[1];
    const aTag = /<a\s[^>]*href="([^"]+)"[^>]*>/i.exec(li);
    if (!aTag) continue;
    const num = text(/<div class="epl-num">([\s\S]*?)<\/div>/i.exec(li)?.[1]);
    episodes.push({
      number: num !== '' ? Number(num) : 0,
      title: text(/<div class="epl-title">([\s\S]*?)<\/div>/i.exec(li)?.[1]),
      subtitle: text(/<div class="epl-sub">([\s\S]*?)<\/div>/i.exec(li)?.[1]),
      date: text(/<div class="epl-date">([\s\S]*?)<\/div>/i.exec(li)?.[1]),
      url: absolutize(aTag[1]),
    });
  }

  // Nomor episode dari slug bila halaman ini memang post episode
  const slug = slugOf(url);

  return {
    id: Number(/<article id="post-(\d+)"/.exec(raw)?.[1] || 0) || null,
    title: h1,
    alternative_title: alter || null,
    url: url || null,
    slug,
    poster: posterMatch ? posterMatch[1] : null,
    status: spe.status || null,
    season: spe.season || null,
    type: spe.type || null,
    network: spe.network || null,
    studio: spe.studio || null,
    released: spe.released || null,
    duration: spe.duration ? spe.duration.replace(/\s*Minute\b/i, ' min') : null,
    country: spe.country || null,
    episodes_declared: spe.episodes ? Number(spe.episodes) : null,
    fansub: spe.fansub || null,
    posted_by: spe.posted_by || null,
    released_on: spe.released_on || null,
    updated_on: spe.updated_on || null,
    date_published:
      /itemprop="datePublished"\s+datetime="([^"]+)"/.exec(raw)?.[1] || null,
    date_modified:
      /itemprop="dateModified"\s+datetime="([^"]+)"/.exec(raw)?.[1] || null,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    rating_votes: votesMatch ? Number(votesMatch[1]) : null,
    genres,
    synopsis: synopsis || null,
    synopsis_en: synopsisByLang.en || null,
    synopsis_id: synopsisByLang.id || null,
    chapter_count: episodes.length,
    chapters: episodes,
  };
}

/**
 * Parse halaman EPISODE POST:
 *  - mirror/stream: <select class="mirror"> — tiap <option value=BASE64>
 *    berisi HTML iframe; label option = "Hardsub Indonesia Dailymotion" dst.
 *    URL iframe = embed pihak ketiga (dailymotion, odysee, ok.ru, mega,
 *    rumble, d.tube, seekplayer, playmogo...). Ini BUKAN file MP4/HLS langsung.
 *  - download: blok .soraddlx per subtitle (label <h3>, kualitas <strong>,
 *    tautan: Terabox / Mirror(mirrored.to) / Mediafire). Blok terakhir
 *    biasanya "Membership VIP" (tautan ko-fi) — tetap ikut diambil, label
 *    yang menandai itu ada di `vip: true`.
 *  - navigasi prev / all episodes / next dari blok .naveps.
 */
export function parseEpisode(html, url = '') {
  const clean = declutter(html);
  const raw = html;

  const h1 = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw)?.[1]);
  const slug = slugOf(url);
  const typez = text(/<div class="typez[^"]*">([\s\S]*?)<\/div>/i.exec(raw)?.[1]);

  // Series induk: ambil item KEDUA dari breadcrumb schema.org
  // (item 1 = Home, item 2 = series, item 3 = episode ini).
  let seriesUrl = '';
  let seriesTitle = '';
  const bcItems = [
    ...raw.matchAll(
      /<a itemprop="item" href="([^"]+)"[^>]*>\s*<span itemprop="name">([\s\S]*?)<\/span>/gi
    ),
  ];
  if (bcItems.length >= 2) {
    seriesUrl = bcItems[1][1];
    seriesTitle = text(bcItems[1][2]);
  }

  // --- mirror (base64 di <option value>) ---
  const mirrors = [];
  const selMatch = /<select class="mirror"[\s\S]*?>([\s\S]*?)<\/select>/i.exec(raw);
  if (selMatch) {
    for (const om of selMatch[1].matchAll(
      /<option\s+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi
    )) {
      const b64 = om[1];
      const label = text(om[2]);
      let embed = '';
      try {
        const dec = Buffer.from(b64, 'base64').toString('utf8');
        embed = attr(/<iframe[^>]*>/i.exec(dec)?.[0] || '', 'src');
      } catch {
        // base64 rusak: tinggalkan embed kosong, jangan bikin error
      }
      const hostMatch = /^(?:https?:)?\/\/([^/]+)/i.exec(embed);
      mirrors.push({
        label,
        host: hostMatch ? hostMatch[1] : '',
        embed: absolutize(embed),
        kind: mirrorKind(hostMatch ? hostMatch[1] : ''),
      });
    }
  }

  // --- download (blok .soraddlx) ---
  // Struktur: <div class="soraddlx soradlg">
  //             <div class="sorattlx"><h3>Subtitle Indonesia</h3></div>
  //             <div class="soraurlx"><strong>1080</strong><a>Terabox</a>...</div>
  //           </div>
  // Satu blok bisa punya >1 .soraurlx (kualitas berbeda), jadi jangan
  // berhenti di <strong> pertama.
  const downloads = [];
  const dlSegs = declutter(raw).split(/<div class="soraddlx/).slice(1);
  for (const seg of dlSegs) {
    const langMatch = /<h3>([\s\S]*?)<\/h3>/.exec(seg);
    if (!langMatch) continue;
    const language = text(langMatch[1]);
    const vip = /vip|membership/i.test(language);
    // tiap .soraurlx = satu baris kualitas; potong di </div> penutupnya
    for (const part of seg.split('<div class="soraurlx">').slice(1)) {
      const isi = part.split('</div>')[0];
      const quality = text(/<strong>([\s\S]*?)<\/strong>/.exec(isi)?.[1]) || 'unknown';
      const links = [];
      for (const lm of isi.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const provider = text(lm[2]);
        if (provider) links.push({ provider, url: absolutize(lm[1]) });
      }
      if (links.length) downloads.push({ language, quality, vip, links });
    }
  }

  // --- navigasi prev / all episodes / next ---
  // Markup campur kutip: href="..." aria-label="prev" DAN href='...'
  // aria-label='All Episodes'; urutan atribut juga tidak konsisten.
  // "Next" pada episode terakhir bukan <a> tapi <span class="nolink">.
  const naveps = {};
  const nv = /<div class="naveps[\s\S]*?<\/div>\s*<\/div>/i.exec(clean)?.[0] || '';
  for (const am of nv.matchAll(/<a\s[^>]*>/gi)) {
    const tag = am[0];
    const href = attr(tag, 'href');
    const label = attr(tag, 'aria-label');
    if (!href || !label) continue;
    naveps[label.toLowerCase().replace(/\s+/g, '_')] = absolutize(href);
  }

  return {
    title: h1,
    url: url || null,
    slug,
    episode: episodeNumberFromSlug(slug),
    type: typez,
    series: {
      url: seriesUrl || null,
      title: seriesTitle || null,
    },
    mirrors,
    mirror_count: mirrors.length,
    downloads,
    download_count: downloads.filter((d) => !d.vip).length,
    prev: naveps.prev || null,
    next: naveps.next || null,
    all_episodes: naveps.all_episodes || seriesUrl || null,
    date_published:
      /itemprop="datePublished"\s+datetime="([^"]+)"/.exec(raw)?.[1] ||
      /"datePublished"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ||
      /property="[^"]*datePublished"\s+content="([^"]+)"/.exec(raw)?.[1] ||
      null,
    date_modified:
      /itemprop="dateModified"\s+datetime="([^"]+)"/.exec(raw)?.[1] ||
      /"dateModified"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ||
      /property="[^"]*dateModified"\s+content="([^"]+)"/.exec(raw)?.[1] ||
      null,
  };
}

function mirrorKind(host) {
  const h = host.toLowerCase();
  if (h.includes('dailymotion')) return 'dailymotion';
  if (h.includes('odysee')) return 'odysee';
  if (h.includes('ok.ru')) return 'okru';
  if (h.includes('mega.nz')) return 'mega';
  if (h.includes('rumble')) return 'rumble';
  if (h.includes('d.tube')) return 'dtube';
  if (h.includes('seekplayer')) return 'seekplayer';
  if (h.includes('playmogo')) return 'playmogo';
  return h ? 'other' : 'unknown';
}
