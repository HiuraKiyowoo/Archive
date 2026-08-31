#!/usr/bin/env node
/**
 * CLI maid — semua output JSON ke stdout, error ke stderr.
 * Library-nya ada di src/index.js (tanpa side effect, aman untuk di-import).
 */

import { home, mangaList, genreList, mangaListAZ, advancedSearch, series, chapter, search, genre, post } from './src/index.js';

// Parse arg CLI advanced: key=value (genre bisa diulang).
// Contoh: advanced type=Manhwa order=latest genre=romance genre=action
function parseAdvancedArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = arg.match(/^([a-zA-Z]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (key === 'genre') {
      opts.genre = opts.genre ? [...opts.genre, val] : [val];
    } else if (key === 'year') {
      opts.year = val;
    } else {
      opts[key] = val;
    }
  }
  return opts;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  try {
    let result;
    switch (cmd) {
      case 'home':
        result = await home();
        break;
      case 'list':
      case 'manga-list':
        result = await mangaList();
        break;
      case 'series':
        result = await series(args[1] || '');
        break;
      case 'chapter':
      case 'episode':
        result = await chapter(args[1] || '');
        break;
      case 'post':
        result = await post(args[1] || '');
        break;
      case 'search':
        result = await search(args[1] || '');
        break;
      case 'genre':
        result = await genre(args[1] || '');
        break;
      case 'genre-list':
        result = await genreList();
        break;
      case 'az':
      case 'manga-az':
        result = await mangaListAZ();
        break;
      case 'advanced':
        result = await advancedSearch(parseAdvancedArgs(args.slice(1)));
        break;
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error(
          'Gunakan: home | list | az | series "slug" | chapter "URL" | post "URL" | ' +
          'search "kata" | genre "slug" | genre-list | advanced [type=.. status=.. order=.. genre=.. title=.. author=.. year=..]'
        );
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
