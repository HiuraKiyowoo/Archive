#!/usr/bin/env node
/**
 * CLI anime-indo — semua output JSON ke stdout, error ke stderr.
 * Library-nya ada di src/index.js (tanpa side effect, aman untuk di-import).
 */
const { BASE, home, search, genre, genres, detail, episode, stream } = require('./src/index.js');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const run = async () => {
    switch (cmd) {
      case 'home':    return home(parseInt(args[0] || '1', 10));
      case 'search':  return search(args[0], parseInt(args[1] || '1', 10));
      case 'genre':   return genre(args[0], parseInt(args[1] || '1', 10));
      case 'genres':  return genres();
      case 'detail':  return detail(args[0]);
      case 'episode': return episode(args[0]);
      case 'stream':  return stream(args[0]);
      default:
        console.error(`usage: node cli.js <home|search|genre|genres|detail|episode|stream> [arg] [page]`);
        process.exit(2);
    }
  };
  try {
    const result = await run();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, command: cmd, error: String(e.message || e), hint: 'see notes in README' }));
    process.exit(1);
  }
}

main();
