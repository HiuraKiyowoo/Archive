#!/usr/bin/env node
/**
 * CLI nimegami — semua output JSON ke stdout, error ke stderr.
 * Library-nya ada di src/index.js (tanpa side effect, aman untuk di-import).
 */

import { home, search, genre, genres, detail, detailWithDownloads, chapter, parseDownloadChaptersFromHtml } from './src/index.js';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'home';

  const commands = {
    home,
    search,
    genre,
    genres,
    detail,
    chapter,
  };

  try {
    let result;
    switch (cmd) {
      case 'home':
        result = await home();
        break;
      case 'search':
        result = await search(args[1] || '', Number(args[2]) || 1);
        break;
      case 'genre':
        result = await genre(args[1] || '', Number(args[2]) || 1);
        break;
      case 'genres':
        result = await genres();
        break;
      case 'detail':
        result = await detailWithDownloads(args[1] || '');
        break;
      case 'chapter':
        result = await chapter(args[1] || '');
        break;
      default:
        console.error(`Perintah tidak dikenal: ${cmd}`);
        console.error('Gunakan: home | search "q" [page] | genre "slug" [page] | genres | detail "URL" | chapter "URL"');
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
