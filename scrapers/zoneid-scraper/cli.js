#!/usr/bin/env node
import {
  getFeatured,
  searchFeatured,
  getOfficial,
  getMySubdomains,
  getSubdomainDetail,
  getDnsRecords,
  getUrlForwarders,
  getAuthUrl,
  BASE_URL,
} from './src/index.js';

const args = process.argv.slice(2);
const cmd = args[0];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function usage() {
  console.log(`zoneid — Zone.ID member area scraper (zero-dep)
${BASE_URL}

Commands:
  featured [--limit N]          Katalog subdomain featured (publik, default semua 142)
  search <query>                Cari di katalog featured (filter lokal)
  official                      Layanan resmi zone.id (publik)
  authurl                       Tampilkan URL OAuth login
  mine                          Daftar subdomain milik akun (butuh token)
  detail <id>                   Detail subdomain (butuh token)
  dns <id>                      DNS records subdomain (butuh token)
  forwarders <id>               URL forwarders subdomain (butuh token)

Member commands butuh token: set env ZONEID_TOKEN=<accessToken>.
Cara ambil token (lihat README): login via authurl, lalu dari browser
DevTools: localStorage['auth'] -> accessToken.
`);
}

function token() {
  return process.env.ZONEID_TOKEN || null;
}

function getLimit() {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1], 10) : 500;
}

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      usage();
      return;
    case 'featured': {
      const r = await getFeatured({ limit: getLimit() });
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'featured', url: BASE_URL + '/featured', ok: true, total: r.total, catatan: r.catatan, data: r.data }, null, 2));
      return;
    }
    case 'search': {
      const q = args[1];
      if (!q) die('search butuh query. Contoh: zoneid search blog');
      const r = await searchFeatured(q);
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'search', query: q, ok: true, total: r.total, matches: r.matches, data: r.data }, null, 2));
      return;
    }
    case 'official': {
      const r = await getOfficial();
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'official', url: BASE_URL + '/official', ok: true, total: r.total, data: r.data }, null, 2));
      return;
    }
    case 'authurl': {
      const r = await getAuthUrl();
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'authurl', ok: true, url: r.url }, null, 2));
      return;
    }
    case 'mine': {
      if (!token()) die('Butuh ZONEID_TOKEN. Login via `zoneid authurl`, ambil access token dari browser, set env ZONEID_TOKEN.');
      const r = await getMySubdomains(token());
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'mine', url: BASE_URL + '/subdomains', ok: true, total: r.total, data: r.data }, null, 2));
      return;
    }
    case 'detail': {
      const id = args[1];
      if (!id) die('detail butuh id. Contoh: zoneid detail q1idspia');
      if (!token()) die('Butuh ZONEID_TOKEN.');
      const r = await getSubdomainDetail(token(), id);
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'detail', id, url: `${BASE_URL}/subdomains/${id}`, ok: true, data: r }, null, 2));
      return;
    }
    case 'dns': {
      const id = args[1];
      if (!id) die('dns butuh id. Contoh: zoneid dns q1idspia');
      if (!token()) die('Butuh ZONEID_TOKEN.');
      const r = await getDnsRecords(token(), id);
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'dns', id, url: `${BASE_URL}/subdomains/${id}/dns`, ok: true, total: r.total, data: r.data }, null, 2));
      return;
    }
    case 'forwarders': {
      const id = args[1];
      if (!id) die('forwarders butuh id. Contoh: zoneid forwarders q1idspia');
      if (!token()) die('Butuh ZONEID_TOKEN.');
      const r = await getUrlForwarders(token(), id);
      console.log(JSON.stringify({ source: 'my.zone.id', command: 'forwarders', id, url: `${BASE_URL}/subdomains/${id}/urlforwarder`, ok: true, total: r.total, data: r.data }, null, 2));
      return;
    }
    default:
      die(`Command tidak dikenal: ${cmd}\n\n`);
  }
}

main().catch((e) => {
  if (e.code === 'AUTH_REQUIRED') die(`⚠️  ${e.message}`);
  die(`❌ ${e.message}`, 1);
});
