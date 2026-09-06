#!/usr/bin/env node

import * as ryu from './src/index.js';

const [,, cmd, ...args] = process.argv;

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log(`
RyuKomik CLI - Multi-Source Manga & Anime Scraper
Usage: node cli.js <command> [args]

Commands:
  --- RYUKOMIK PROJECT ---
  project:filters                      Daftar filter pustaka project (tipe, status, genre)
  project:pustaka [page] [tipe] [genre] Katalog komik project RyuKomik
  project:detail <slug>                Detail komik project (metadata + chapter list)
  project:chapter <slug> <chSlug>      Baca chapter komik project (daftar gambar)

  --- SOURCE KOMIKU ---
  komiku:terbaru                       Komik terbaru dari source Komiku
  komiku:pustaka [page]                Pustaka Komiku berpaginasi
  komiku:search <query>                Cari komik di Komiku
  komiku:detail <slug>                 Detail komik Komiku
  komiku:chapter <chSlug>              Baca chapter komik Komiku

  --- SOURCE DOUJINDESU ---
  doujin:terbaru                       Doujin terbaru
  doujin:manhwa                        Manhwa dewasa terbaru
  doujin:search <query>                Cari di Doujindesu
  doujin:detail <slug>                 Detail doujin
  doujin:chapter <chSlug>              Baca chapter doujin

  --- SOURCE KOMIKID & KIRYUU ---
  komikid:pustaka [page]               Katalog Komikid
  komikid:detail <slug>                Detail Komikid
  kiryuu:pustaka [page]                Katalog Kiryuu

  --- ANIME ENGINE ---
  anime:terbaru                        Anime rilis terbaru
  anime:ongoing                        Anime sedang tayang
  anime:jadwal                         Jadwal rilis anime
  anime:detail <slug>                  Detail anime & daftar episode
  anime:stream <epSlug>                Ambil embed player streaming episode

  --- SOCIAL / LEADERBOARD ---
  leaderboard                          Peringkat pembaca (Top XP)
`);
}

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  try {
    switch (cmd) {
      // Project
      case 'project:filters':
        printJson(await ryu.getProjectFilters());
        break;
      case 'project:pustaka':
        printJson(await ryu.getProjectPustaka({
          page: args[0] || 1,
          tipe: args[1],
          genre: args[2]
        }));
        break;
      case 'project:detail':
        if (!args[0]) throw new Error('Slug diperlukan. Contoh: node cli.js project:detail sicario');
        printJson(await ryu.getProjectDetail(args[0]));
        break;
      case 'project:chapter':
        if (!args[0] || !args[1]) throw new Error('Argumen kurang. Contoh: node cli.js project:chapter sicario chapter-1');
        printJson(await ryu.getProjectChapter(args[0], args[1]));
        break;

      // Komiku
      case 'komiku:terbaru':
        printJson(await ryu.getKomikuTerbaru());
        break;
      case 'komiku:pustaka':
        printJson(await ryu.getKomikuPustaka({ page: args[0] || 1 }));
        break;
      case 'komiku:search':
        if (!args[0]) throw new Error('Query diperlukan. Contoh: node cli.js komiku:search magic');
        printJson(await ryu.searchKomiku(args.join(' ')));
        break;
      case 'komiku:detail':
        if (!args[0]) throw new Error('Slug diperlukan. Contoh: node cli.js komiku:detail magic-emperor');
        printJson(await ryu.getKomikuDetail(args[0]));
        break;
      case 'komiku:chapter':
        if (!args[0]) throw new Error('Chapter slug diperlukan. Contoh: node cli.js komiku:chapter magic-emperor-chapter-905');
        printJson(await ryu.getKomikuChapter(args[0]));
        break;

      // Doujindesu
      case 'doujin:terbaru':
        printJson(await ryu.getDoujinTerbaru());
        break;
      case 'doujin:manhwa':
        printJson(await ryu.getDoujinManhwaTerbaru());
        break;
      case 'doujin:search':
        if (!args[0]) throw new Error('Query diperlukan. Contoh: node cli.js doujin:search sister');
        printJson(await ryu.searchDoujin(args.join(' ')));
        break;
      case 'doujin:detail':
        if (!args[0]) throw new Error('Slug diperlukan.');
        printJson(await ryu.getDoujinDetail(args[0]));
        break;
      case 'doujin:chapter':
        if (!args[0]) throw new Error('Chapter slug diperlukan.');
        printJson(await ryu.getDoujinChapter(args[0]));
        break;

      // Komikid & Kiryuu
      case 'komikid:pustaka':
        printJson(await ryu.getKomikidPustaka({ page: args[0] || 1 }));
        break;
      case 'komikid:detail':
        if (!args[0]) throw new Error('Slug diperlukan. Contoh: node cli.js komikid:detail the-villain-wants-to-live');
        printJson(await ryu.getKomikidDetail(args[0]));
        break;
      case 'kiryuu:pustaka':
        printJson(await ryu.getKiryuuPustaka({ page: args[0] || 1 }));
        break;

      // Anime
      case 'anime:terbaru':
        printJson(await ryu.getAnimeTerbaru());
        break;
      case 'anime:ongoing':
        printJson(await ryu.getAnimeOngoing());
        break;
      case 'anime:jadwal':
        printJson(await ryu.getAnimeJadwal());
        break;
      case 'anime:detail':
        if (!args[0]) throw new Error('Slug diperlukan. Contoh: node cli.js anime:detail kaijuu-8-gou-narumi-no-heijitsu');
        printJson(await ryu.getAnimeDetail(args[0]));
        break;
      case 'anime:stream':
        if (!args[0]) throw new Error('Episode slug diperlukan. Contoh: node cli.js anime:stream kaijuu-8-gou-narumi-no-heijitsu-episode-1');
        printJson(await ryu.getAnimeEpisode(args[0]));
        break;

      // Leaderboard
      case 'leaderboard':
        printJson(await ryu.getLeaderboard());
        break;

      default:
        console.error(`Command tidak dikenal: '${cmd}'. Gunakan --help.`);
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
