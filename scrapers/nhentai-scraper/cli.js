#!/usr/bin/env node
'use strict';
// Tiny demo CLI:
//   node cli.js gallery <id>      -> print one gallery entity (summarized)
//   node cli.js search <query>    -> print top search results
const s = require('./src/index.js');

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'gallery') {
    const g = await s.getGallery(Number(arg));
    const lang = g.tags.find((t) => t.type === 'language');
    console.log(JSON.stringify({
      id: g.id,
      media_id: g.media_id,
      title_pretty: g.title.pretty,
      title_english: g.title.english,
      language: lang && lang.name,
      artists: g.tags.filter((t) => t.type === 'artist').map((t) => t.name),
      tag_count: g.tags.length,
      scanlator: g.scanlator,
      num_pages: g.num_pages,
      favorites: g.num_favorites,
      cover: s.pageUrl(g.media_id, g.cover.path),
      page1: s.pageUrl(g.media_id, g.pages[0].path),
    }, null, 2));
  } else if (cmd === 'search') {
    const r = await s.search(arg, 1);
    console.log('total:', r.total, '| page1 cards:', r.results.length);
    r.results.slice(0, 5).forEach((x) =>
      console.log(`  ${x.id}  ${x.title.slice(0, 60)}  ${x.thumb}`));
  } else {
    console.error('usage: node cli.js gallery <id> | search <query>');
    process.exit(1);
  }
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});