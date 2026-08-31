#!/usr/bin/env node
// CLI animexin-scraper.
import {
  home,
  series,
  seriesDetail,
  search,
  episode,
  genres,
  taxonomy,
  taxonomyList,
  schedule,
  sitemap,
  walk,
} from './src/index.js';

const USAGE = `animexin-scraper — scraper HTTP untuk https://animexin.dev/

Pemakaian:
  node cli.js home
  node cli.js series [halaman] [--order=popular] [--genre=action] [--status=ongoing] [--type=TV]
  node cli.js detail <slug|url>
  node cli.js search <kata kunci> [halaman]
  node cli.js episode <slug|url>
  node cli.js genres
  node cli.js taxonomy <genres|studio|country|network|season|label> <slug> [halaman]
  node cli.js schedule
  node cli.js sitemap
  node cli.js walk-series [maxPages]

Contoh:
  node cli.js detail renegade-immortal
  node cli.js episode renegade-immortal-episode-156-indonesia-english-sub
  node cli.js taxonomy season fall-2024
`;

function flags(args) {
  const out = {};
  const rest = [];
  for (const a of args) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else rest.push(a);
  }
  return { opt: out, rest };
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { opt, rest } = flags(argv);

  let result;
  switch (cmd) {
    case 'home':
      result = await home();
      break;
    case 'series':
      result = await series(Number(rest[0] || 1), opt);
      break;
    case 'detail':
      if (!rest[0]) throw new Error('butuh slug/url series');
      result = await seriesDetail(rest[0]);
      break;
    case 'search': {
      const last = rest[rest.length - 1];
      const page = /^\d+$/.test(last || '') ? Number(rest.pop()) : 1;
      if (!rest.length) throw new Error('butuh kata kunci');
      result = await search(rest.join(' '), page);
      break;
    }
    case 'episode':
      if (!rest[0]) throw new Error('butuh slug/url episode');
      result = await episode(rest[0]);
      break;
    case 'genres':
      result = await genres();
      break;
    case 'taxlist':
      if (!rest[0]) throw new Error('butuh nama taxonomy');
      result = await taxonomyList(rest[0]);
      break;
    case 'taxonomy':
      if (!rest[0] || !rest[1]) throw new Error('butuh <taxonomy> <slug>');
      result = await taxonomy(rest[0], rest[1], Number(rest[2] || 1));
      break;
    case 'schedule':
      result = await schedule();
      break;
    case 'sitemap':
      result = await sitemap();
      break;
    case 'walk-series':
      result = await walk((p) => series(p), { maxPages: Number(rest[0] || 12) });
      break;
    default:
      process.stdout.write(USAGE);
      process.exit(cmd ? 1 : 0);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify(
      { ok: false, error: err.name || 'Error', message: err.message },
      null,
      2
    ) + '\n'
  );
  process.exit(1);
});
