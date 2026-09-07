import https from 'node:https';

// =====================================================================
// my.zone.id — Zone.ID member area API client
//
// Architecture (reversed from /assets/index-ZY4FlPCJ.js, Vue 3 + axios):
//   baseURL: https://my.zone.id/api
//   transport: axios withCredentials, browser UA required (Cloudflare
//              lenient: Python-urllib UA -> 403, browser UA -> 200)
//   auth: Bearer <accessToken> (pinia store "auth"), OAuth flow:
//         GET /authurl -> autz.org onboarding -> ?auth_code=... -> POST /authorize
//   PUBLIC (no token):
//     GET /featured      -> 142 subdomains (limit honoured, order RANDOM per request)
//     GET /official      -> 4 official services
//   TOKEN-GATED (member data, 401 {"message":"Invalid token"} without token):
//     GET    /subdomains
//     GET    /subdomains/:id
//     GET    /subdomains/:id/dns
//     GET    /subdomains/:id/urlforwarder
//     POST   /subdomains                {subdomain}
//     PATCH  /subdomains/:id            {mode} / {usage_type, usage_description, will}
//     DELETE /subdomains/:id
//     POST   /subdomains/:id/transfer   {email}
//     POST   /authorize {auth_code}
//     POST   /bd-token  {token}
//     POST   /refresh-token
// =====================================================================

export const BASE_URL = 'https://my.zone.id/api';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------- transport ----------------

function rawRequest(path, { method = 'GET', token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const headers = {
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: 'https://my.zone.id',
      Referer: 'https://my.zone.id/',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload = null;
    if (body !== null) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        family: 4, // PRoot IPv6 drift workaround
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode, json, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function api(path, opts = {}) {
  const res = await rawRequest(path, opts);
  if (res.status === 401) {
    const err = new Error('Token dibutuhkan (401). Jalankan `zoneid authurl`, login, lalu simpan access token (lihat README).');
    err.code = 'AUTH_REQUIRED';
    err.status = 401;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error(`Endpoint tidak ditemukan (404): ${path}`);
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status}: ${res.raw.slice(0, 200)}`);
    err.code = 'HTTP_ERROR';
    err.status = res.status;
    throw err;
  }
  return res.json;
}

// ---------------- normalizer ----------------

function normalizeSubdomain(s) {
  return {
    id: s.id ?? null,
    nama: s.subdomain ?? null,
    usage_type: s.usage_type ?? '',
    usage_description: s.usage_description ?? '',
    mode: s.mode ?? null, // dns_record | url_forwarder
    status: s.status ?? null, // active | suspended
    plan: s.plan ?? null, // free | premium
    featured_score: s.featured ?? null,
    created_at: s.created_at ?? null,
    expired_at: s.expired_at ?? null,
    updated_at: s.updated_at ?? null,
    suspend_reason: s.suspend_reason ?? null,
    records_count: s.records_count ?? null,
    forwarders_count: s.forwarders_count ?? null,
    am_notes: s.am_notes ?? null,
    url: s.subdomain ? `https://${s.subdomain}` : null,
  };
}

// ---------------- public APIs ----------------

/**
 * Ambil katalog subdomain featured (publik, tanpa token).
 * Catatan upstream: order RANDOM per request, tidak ada pagination stabil —
 * fungsi ini ambil semua dalam 1 request (limit besar) lalu sort deterministik
 * (created_at desc) supaya output konsisten.
 * @param {object} [opts]
 * @param {number} [opts.limit] batas ambang limit (default 500, total saat ini 142)
 * @param {boolean} [opts.sort=true] sort created_at desc
 */
export async function getFeatured({ limit = 500, sort = true } = {}) {
  const data = await api(`/featured?limit=${limit}`);
  const list = (data.subdomains || []).map(normalizeSubdomain);
  if (sort) {
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  return {
    total: list.length,
    catatan: 'order upstream random per-request; hasil di-sort created_at desc lokal. Total katalog saat ini 142 (2026-09-07).',
    data: list,
  };
}

/**
 * Filter lokal di katalog featured (API upstream TIDAK punya param search —
 * terverifikasi: ?search= / ?mode= / ?page= diabaikan).
 * @param {string} query cari di nama/usage_type/usage_description
 */
export async function searchFeatured(query) {
  const { total, data } = await getFeatured();
  const q = String(query).toLowerCase();
  const found = data.filter(
    (s) =>
      s.nama?.toLowerCase().includes(q) ||
      s.usage_type?.toLowerCase().includes(q) ||
      s.usage_description?.toLowerCase().includes(q)
  );
  return { total: total, matches: found.length, data: found };
}

/** Layanan resmi zone.id (publik). */
export async function getOfficial() {
  const data = await api('/official');
  return {
    total: (data.subdomains || []).length,
    data: (data.subdomains || []).map((o) => ({
      title: o.title ?? null,
      url: o.url ?? null,
      description: o.description ?? null,
    })),
  };
}

// ---------------- member APIs (butuh token) ----------------

/** Daftar subdomain milik akun (token = accessToken dari browser). */
export function getMySubdomains(token) {
  return api('/subdomains', { token }).then((d) => ({
    total: (d.subdomains || []).length,
    data: (d.subdomains || []).map(normalizeSubdomain),
  }));
}

/** Detail subdomain + aksi "Manage" (mode: dns_record | url_forwarder). */
export function getSubdomainDetail(token, id) {
  return api(`/subdomains/${id}`, { token }).then((d) => ({
    ...(normalizeSubdomain(d.subdomain || {})),
    ...((d.subdomain || {})['id'] && { id: d.subdomain.id }),
  }));
}

/** Daftar DNS record sebuah subdomain (owner atau featured-published). */
export function getDnsRecords(token, id) {
  return api(`/subdomains/${id}/dns`, { token }).then((d) => ({
    total: (d.records || []).length,
    data: (d.records || []).map((r) => ({
      id: r.id ?? null,
      hostname: r.hostname ?? null,
      type: r.type ?? null,
      content: r.content ?? null,
    })),
  }));
}

/** Daftar URL forwarder sebuah subdomain. */
export function getUrlForwarders(token, id) {
  return api(`/subdomains/${id}/urlforwarder`, { token }).then((d) => ({
    total: (d.urlforwarders || []).length,
    data: (d.urlforwarders || []).map((f) => ({
      id: f.id ?? null,
      path: f.path ?? null,
      destination: f.destination ?? null,
    })),
  }));
}

/** URL OAuth login (autz.org). Buka di browser, selesaikan login, ambil access token. */
export function getAuthUrl() {
  return api('/authurl').then((d) => ({ url: d.url }));
}

/** Refresh token (butuh session cookie — hanya layak dipanggil dari browser; di luar browser kemungkinan gagal). */
export function refreshAccessToken() {
  return api('/refresh-token', { method: 'POST', body: {} });
}

// ---------------- multi-page helper (kompatibilitas workflow) ----------------

/**
 * Generic helper untuk merangkai banyak halaman/paginated call, dedupe by key.
 * (featured/official tidak paginated — helper ini disediakan utk endpoint
 *  member yang kelak bisa paginated.)
 */
export async function ambilHalaman(fn, { mulai = 1, jumlahHalaman = 1, key = 'id' } = {}) {
  const seen = new Set();
  const hasil = [];
  for (let h = mulai; h < mulai + jumlahHalaman; h++) {
    const page = await fn(h);
    const items = page.data || [];
    let baru = 0;
    for (const it of items) {
      const k = it[key];
      if (k === null || k === undefined || seen.has(k)) continue;
      seen.add(k);
      hasil.push(it);
      baru++;
    }
    if (items.length === 0 || baru === 0) break;
  }
  return hasil;
}

export default {
  getFeatured,
  searchFeatured,
  getOfficial,
  getMySubdomains,
  getSubdomainDetail,
  getDnsRecords,
  getUrlForwarders,
  getAuthUrl,
  refreshAccessToken,
  ambilHalaman,
  BASE_URL,
};
