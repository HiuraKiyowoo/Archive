#!/usr/bin/env node
/**
 * CLI donghuastream — semua output JSON ke stdout, error ke stderr.
 * Library-nya ada di src/index.js (tanpa side effect, aman untuk di-import).
 */

import { home, animeList, series, schedule, season, random, search, genre, episode, post } from './src/index.js';

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
      case 'anime-list':
        result = await animeList();
        break;
      case 'series':
        result = await series(args[1] || '');
        break;
      case 'episode':
        result = await episode(args[1] || '');
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
      case 'schedule':
        result = await schedule();
        break;
      case 'season':
        result = await season(args[1] || '');
        break;
      case 'random':
        result = await random();
        break;
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error('Gunakan: list | series "slug" | episode "URL" | post "URL" | search "kata" | genre "slug" | schedule | season "tahun" | random');
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
