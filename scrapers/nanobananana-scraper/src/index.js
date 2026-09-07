import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

// =====================================================================
// nanobananana.com — Nano Banana (Gemini image gen) direct API client
//
// Reversed from Next.js webpack bundles (47 chunks, /_next/static/chunks):
//   transport : same-origin fetch, CREDENTIALS VIA SESSION COOKIES
//               (NO Bearer token, NO API key on the client)
//   auth      : Google OAuth login -> httpOnly session cookie set by
//               nanobananana.com. Without it every /api/* returns
//               401 {"ok":false,"error":{"code":"COMMON.UNAUTHORIZED"}}
//   envelope  : { ok: true, data: ... } | { ok: false, error: {code, message} }
//
// Public endpoints:
//   GET /api/auth/google/config -> {clientId: "580562041338-..."} (200 no cookie)
// Cookie-gated endpoints:
//   POST   /api/generation/image/generate   {prompt, model, aspectRatio, resolution?, n, inputAssetIds?}
//   GET    /api/generation/image            ?page=&pageSize=&type=  -> {requests:[...]}
//   GET    /api/generation/image/:id        -> single request (status processing|completed)
//   DELETE /api/generation/image/:id
//   GET    /api/credits                     -> credit balance (data.totalRemaining)
//   GET    /api/credits/transactions        ?page=&pageSize=
//   POST   /api/assets/upload               FormData {file}
//   GET    /api/assets                      ?page=&pageSize=&source=
//   DELETE /api/assets/:id
//
// The website's "extension" is just a UI client for the SAME API —
// scraping directly here makes the extension unnecessary.
// =====================================================================

export const BASE_URL = 'https://nanobananana.com';

// Nilai valid (diharvest dari modelSelector / aspect-ratio list / resolution
// buttons di chunk 5573-99a467964c373ccc.js)
export const MODELS = {
  'google/nano-banana': 'Nano Banana (standard)',
  'google/nano-banana-pro': 'Nano Banana Pro',
  'google/nano-banana-2': 'Nano Banana 2 (default di UI)',
  'alibaba/z-image': 'Z-Image (alibaba)',
};

export const ASPECT_RATIOS = ['1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '9:16'];

export const RESOLUTIONS = {
  '1K': '1024',
  '2K': '2048',
  '4K': '4096',
};

export const DEFAULT_MODEL = 'google/nano-banana-2';

// Model yang WAJIB-kan field `resolution` di server (diverifikasi live 400 pre-auth,
// 2026-09-07): google/nano-banana-pro, google/nano-banana-2.
// Model tanpa wajib: google/nano-banana, alibaba/z-image (kirim pun tidak masalah,
// tapi UI (et=()=>c.M1(model)?res:void) tidak pernah mengirimnya utk model ini).
// UI default-kan resolution ke "1K" (ef: r = e.resolution ?? "1K").
export const RESOLUTION_REQUIRED = new Set(['google/nano-banana-pro', 'google/nano-banana-2']);

// Model yang dukung reference input / image-to-image (harvest: Q = [...]; ee = Q.includes)
export const REFERENCE_CAPABLE = new Set(['google/nano-banana-pro', 'google/nano-banana-2', 'alibaba/z-image']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------- transport ----------------

function rawRequest(urlPath, { method = 'GET', cookie = null, body = null, headers = {}, isForm = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + urlPath);
    const h = {
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      ...headers,
    };
    if (cookie) h.Cookie = cookie;

    let payload = null;
    if (body !== null) {
      if (isForm) {
        payload = body; // Buffer multipart (dibangun caller)
        h['Content-Type'] = `multipart/form-data; boundary=${h.boundary || ''}`;
      } else {
        payload = JSON.stringify(body);
        h['Content-Type'] = 'application/json';
      }
      h['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        family: 4, // PRoot IPv6 drift workaround
        headers: h,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(buf.toString('utf8'));
          } catch {
            /* binary (asset) */
          }
          resolve({ status: res.statusCode, json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeError(status, code, message) {
  const err = new Error(`[${code || 'HTTP ' + status}] ${message}`);
  err.code = code || 'HTTP_ERROR';
  err.status = status;
  return err;
}

async function api(urlPath, opts = {}) {
  const { cookie = null, ...rest } = opts;
  const res = await rawRequest(urlPath, { cookie, ...rest });

  if (res.status === 401) {
    throw makeError(401, 'AUTH_REQUIRED', 'Session cookie tidak valid/tidak ada. Login dulu di browser nanobananana.com lalu salin cookie (lihat README).');
  }

  if (res.json && 'ok' in res.json) {
    if (!res.json.ok) {
      const e = res.json.error || {};
      throw makeError(res.status, e.code, e.message || JSON.stringify(e));
    }
    return res.json.data;
  }

  // Endpoint non-envelope (binary dll)
  if (res.status >= 400) throw makeError(res.status, null, res.raw.toString('utf8').slice(0, 200));
  if (res.json !== null) return res.json;
  return res.raw;
}

// ---------------- multipart (stdlib only) ----------------

function buildMultipart(fields, boundary) {
  const parts = [];
  for (const f of fields) {
    parts.push(Buffer.from(`--${boundary}\r\n${f.header}\r\n\r\n`, 'utf8'));
    parts.push(f.buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(parts);
}

// ---------------- image generation ----------------

function assertValidModel(model) {
  if (!MODELS[model]) {
    throw new Error(`model tidak dikenal: ${model}. Pilihan: ${Object.keys(MODELS).join(', ')}`);
  }
}

function assertValidAspect(ar) {
  if (!ASPECT_RATIOS.includes(ar)) {
    throw new Error(`aspectRatio tidak valid: ${ar}. Pilihan: ${ASPECT_RATIOS.join(', ')}`);
  }
}

function assertValidResolution(res) {
  if (res !== undefined && res !== null && !RESOLUTIONS[res]) {
    throw new Error(`resolution tidak valid: ${res}. Pilihan: ${Object.keys(RESOLUTIONS).join(', ')}`);
  }
}

/**
 * Submit generation (text-to-image atau image-to-image).
 * `resolution` di-set otomatis "1K" kalau model memaksanya (sesuai default UI).
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.cookie] session cookie browser (WAJIB utk endpoint ini)
 * @param {string} [opts.model] default google/nano-banana-2
 * @param {string} [opts.aspectRatio] default 1:1
 * @param {string} [opts.resolution] 1K|2K|4K (otomatis "1K" utk model yang mewajibkan)
 * @param {number} [opts.n] jumlah gambar (default 1)
 * @param {string[]} [opts.inputAssetIds] asset id utk image-to-image
 */
export async function generateImage(prompt, opts = {}) {
  const {
    cookie,
    model = DEFAULT_MODEL,
    aspectRatio = '1:1',
    resolution,
    n = 1,
    inputAssetIds,
  } = opts;

  assertValidModel(model);
  assertValidAspect(aspectRatio);
  assertValidResolution(resolution);

  const body = {
    prompt: String(prompt).trim(),
    model,
    aspectRatio,
    n,
  };
  // Server menolak model ini tanpa resolution (400 pre-auth, terverifikasi).
  const finalResolution = resolution ?? (RESOLUTION_REQUIRED.has(model) ? '1K' : undefined);
  if (finalResolution) body.resolution = finalResolution;
  if (inputAssetIds && inputAssetIds.length > 0) body.inputAssetIds = inputAssetIds;

  const data = await api('/api/generation/image/generate', { method: 'POST', cookie, body });
  return { requestId: data?.requestId ?? data?.id ?? null, raw: data };
}

/**
 * Poll request (status + outputs). Frontend site poll list tiap 15 detik.
 * @returns {Promise<{requestId, status, model, prompt, outputs:[{id,url}], inputAssets:[{id,url}]}>}
 */
export async function getRequest(cookie, requestId) {
  const data = await api(`/api/generation/image/${encodeURIComponent(requestId)}`, { cookie });
  return normalizeRequest(data);
}

/**
 * List request terbaru (paginated).
 */
export async function getRequests(cookie, { page = 1, pageSize = 20, type = null } = {}) {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (type) q.set('type', type);
  const data = await api(`/api/generation/image?${q}`, { cookie });
  const requests = (data.requests || []).map(normalizeRequest);
  return { page, pageSize, total: requests.length, data: requests };
}

/** Hapus 1 request. */
export async function deleteRequest(cookie, requestId) {
  await api(`/api/generation/image/${encodeURIComponent(requestId)}`, { method: 'DELETE', cookie });
  return { deleted: requestId };
}

function normalizeRequest(r) {
  if (!r || typeof r !== 'object') return r;
  const outputs = (r.outputs || []).map((o) => ({ id: o.assetId ?? o.id ?? null, url: o.url ?? null }));
  const inputs = (r.inputAssets || []).map((o) => ({ id: o.assetId ?? o.id ?? null, url: o.url ?? null }));
  return {
    requestId: r.requestId ?? r.id ?? null,
    status: r.status ?? null, // processing | completed (lihat chunks: filter "processing")
    model: r.model ?? null,
    prompt: r.prompt ?? null,
    aspectRatio: r.aspectRatio ?? null,
    resolution: r.resolution ?? null,
    createdAt: r.createdAt ?? null,
    outputs,
    inputAssets: inputs,
    done: r.status === 'completed',
  };
}

/**
 * Poll sampe completed/failed (timeout default 180 dtk, interval 5 dtk —
 * lebih agresif dari UI yang 15 dtk; backend-nya sama).
 */
export async function waitForRequest(cookie, requestId, { intervalMs = 5000, timeoutMs = 180000 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await getRequest(cookie, requestId);
    if (last.status === 'completed' || last.status === 'failed' || last.status === 'error') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  last.timeout = true;
  return last;
}

// ---------------- credits ----------------

export async function getCredits(cookie) {
  const data = await api('/api/credits', { cookie });
  return {
    totalRemaining: data?.totalRemaining ?? data ?? null,
    raw: data,
  };
}

export async function listCreditTransactions(cookie, { page = 1, pageSize = 20 } = {}) {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const data = await api(`/api/credits/transactions?${q}`, { cookie });
  return { data };
}

// ---------------- assets (reference images) ----------------

/**
 * Upload gambar utk image-to-image (FormData field `file`).
 * @param {Buffer|string} file buffer atau path ke file
 */
export async function uploadAsset(cookie, file, filename = null) {
  const buf = typeof file === 'string' ? fs.readFileSync(file) : file;
  const name = filename || (typeof file === 'string' ? path.basename(file) : 'upload.png');
  const ext = path.extname(name).replace('.', '').toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'application/octet-stream';

  const boundary = '----nbnscraper' + Math.random().toString(16).slice(2);
  const payload = buildMultipart(
    [
      {
        header: `Content-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}`,
        buffer: buf,
      },
    ],
    boundary
  );

  const data = await rawRequest('/api/assets/upload', {
    method: 'POST',
    cookie,
    body: payload,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  }).then((r) => {
    if (r.status === 401) throw makeError(401, 'AUTH_REQUIRED', 'Session cookie tidak valid/tidak ada.');
    if (r.json && 'ok' in r.json) {
      if (!r.json.ok) throw makeError(r.status, r.json.error?.code, r.json.error?.message);
      return r.json.data;
    }
    if (r.status >= 400) throw makeError(r.status, null, r.raw.toString().slice(0, 200));
    return r.json;
  });

  return { assetId: data?.assetId ?? data?.id ?? null, url: data?.url ?? null, raw: data };
}

export async function listAssets(cookie, { page = 1, pageSize = 20, source = null } = {}) {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (source) q.set('source', source);
  const data = await api(`/api/assets?${q}`, { cookie });
  return { data };
}

export async function deleteAsset(cookie, assetId) {
  await api(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE', cookie });
  return { deleted: assetId };
}

// ---------------- pipeline helper ----------------

/**
 * One-shot: submit + wait + kembalikan list URL gambar hasil.
 */
export async function generateAndWait(prompt, opts = {}) {
  const { cookie, ...gen } = opts;
  const { requestId } = await generateImage(prompt, { ...gen, cookie });
  if (!requestId) throw new Error('generate tidak mengembalikan requestId');
  const req = await waitForRequest(cookie, requestId, opts);
  return {
    requestId,
    status: req.status,
    outputs: req.outputs,
    imageUrls: req.outputs.map((o) => o.url).filter(Boolean),
  };
}

// ---------------- public info ----------------

export async function getGoogleAuthConfig() {
  const data = await api('/api/auth/google/config', {});
  return { clientId: data?.clientId ?? null };
}

export default {
  MODELS,
  ASPECT_RATIOS,
  RESOLUTIONS,
  DEFAULT_MODEL,
  BASE_URL,
  generateImage,
  generateAndWait,
  getRequest,
  getRequests,
  deleteRequest,
  waitForRequest,
  getCredits,
  listCreditTransactions,
  uploadAsset,
  listAssets,
  deleteAsset,
  getGoogleAuthConfig,
};
