#!/usr/bin/env node
/**
 * CLI komikindo — semua output JSON ke stdout, error ke stderr.
 * Library-nya ada di src/index.js (tanpa side effect, aman untuk di-import).
 */

import { home, search, genre, detail, chapter } from './src/index.js';

const [, , cmd, arg1, arg2] = process.argv;
const out = (obj) => console.log(JSON.stringify(obj, null, 2));

try {
  switch (cmd) {
    case 'home':
      out(await home());
      break;
    case 'search':
      out(await search(arg1 || 'solo leveling', parseInt(arg2) || 1));
      break;
    case 'genre':
      out(await genre(arg1 || 'action', parseInt(arg2) || 1));
      break;
    case 'detail':
      out(await detail(arg1));
      break;
    case 'chapter':
      out(await chapter(arg1));
      break;
    default:
      console.log('Usage: node cli.js <home|search|genre|detail|chapter> [args...]');
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}

