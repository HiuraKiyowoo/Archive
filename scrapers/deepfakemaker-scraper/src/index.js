import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===================== CONSTANTS =====================

export const BASE_URL = 'https://apiv1.deepfakemaker.io/api';
export const APP_ID = 'ai_df';
export const SALT = 'NHGNy5YFz7HeFb';

export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDa2oPxMZe71V4dw2r8rHWt59gH
W5INRmlhepe6GUanrHykqKdlIB4kcJiu8dHC/FJeppOXVoKz82pvwZCmSUrF/1yr
rnmUDjqUefDu8myjhcbio6CnG5TtQfwN2pz3g6yHkLgp8cFfyPSWwyOCMMMsTU9s
snOjvdDb4wiZI8x3UwIDAQAB
-----END PUBLIC KEY-----`;

export const ENDPOINTS = {
  uploadSign: '/user/v2/upload-sign',
  photoFaceSwap: '/img/v2/free/task',
  hdFaceSwap: '/vmodel/swap/img/hd/v1/task',
  videoFaceSwap: '/face/v3/video/consumption',
  kieImageGen: '/kie/v1/free/imggen/task',
  fluxTask: '/replicate/v1/free/flux/task',
  bgReplace: '/replicate/v2/free/bg/replace/task',
  clothesRemover: '/img/v2/free/clothes/remover/task',
  clothesChanger: '/vmodel/v1/free/changer/task',
  upscaler: '/upscaler/v1/free/task',
  videoGenerate: '/v1/video/generate/task',
};

// ===================== UTILS =====================

export function generateUUID() {
  return '10000000-1000-4000-8000' + (-1e11).toString().replace(/[018]/g, (n) =>
    (n ^ (crypto.randomBytes(1)[0] & (15 >> (n / 4)))).toString(16)
  );
}

export function generateUUID64() {
  const rand = crypto.randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  return crypto.createHash('sha256').update(rand + ts).digest('hex');
}

export function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// ===================== AUTH =====================

export function generateAuthParams(extra = null) {
  const now = new Date();
  const utcSeconds = Math.floor(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds()
  ) / 1000);

  const nonce = generateUUID();
  const aesKey = randomString(16);

  const encryptedKey = crypto.publicEncrypt({
    key: PUBLIC_KEY,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  }, Buffer.from(aesKey, 'utf8')).toString('base64');

  const parts = [APP_ID, SALT, utcSeconds, nonce, encryptedKey];
  if (extra !== null && extra !== undefined) {
    parts.push(extra.toString());
  }

  const rawString = parts.join(':');

  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(aesKey, 'utf8'), Buffer.from(aesKey, 'utf8'));
  let sign = cipher.update(rawString, 'utf8', 'base64');
  sign += cipher.final('base64');

  return {
    app_id: APP_ID,
    t: utcSeconds,
    nonce,
    sign,
    secret_key: encryptedKey,
  };
}

export function buildQueryString(params) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.set(key, value);
    }
  }
  return qs.toString();
}

// ===================== HTTP HELPERS =====================

export function httpRequest(url, method = 'GET', headers = {}, payload = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://deepfakemaker.io',
        'Referer': 'https://deepfakemaker.io/',
        ...headers,
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data.slice(0, 500) }; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export function buildMultipart(fields, boundary) {
  const parts = [];
  for (const f of fields) {
    if (f.isFile) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
        'utf8'
      ));
      parts.push(Buffer.from(f.buffer));
      parts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`,
        'utf8'
      ));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(parts);
}

// ===================== CORE API =====================

export class DeepFakeMaker {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || BASE_URL;
    this.debug = options.debug || false;
  }

  log(...args) {
    if (this.debug) console.log('[DFM]', ...args);
  }

  // ---------- Upload ----------

  async getUploadSign(filename, sha256Hash) {
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.uploadSign}?${buildQueryString(auth)}`;
    const payload = JSON.stringify({ filename, hash: sha256Hash, is_verify: false });

    this.log('GET UPLOAD SIGN', filename);
    const res = await httpRequest(url, 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }, payload);

    return res;
  }

  async uploadFile(fileBuffer, mimeType = 'application/octet-stream', filename = 'file.bin') {
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const signRes = await this.getUploadSign(filename, hash);

    if (signRes.status !== 200 || signRes.body.code !== 200) {
      throw new Error(`Upload sign failed: ${JSON.stringify(signRes.body)}`);
    }

    const { url: signedUrl, object_name } = signRes.body.data;
    const cdnUrl = signedUrl.replace('mrpa-chatpdf.oss-us-west-1.aliyuncs.com', 'cdn.deepfakemaker.io');

    this.log('UPLOAD TO OSS', signedUrl.slice(0, 60) + '...');
    const uploadRes = await httpRequest(signedUrl, 'PUT', {
      'Content-Type': mimeType,
      'Content-Length': fileBuffer.length,
    }, fileBuffer);

    if (uploadRes.status !== 200) {
      throw new Error(`OSS upload failed: status ${uploadRes.status}`);
    }

    return { cdnUrl, object_name, signedUrl };
  }

  // ---------- Polling ----------

  async pollTask(path, params, options = {}) {
    const {
      maxPolls = options.maxPolls || 60,
      interval = options.interval || 3000,
      successField = options.successField || 'generate_url',
    } = options;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, interval));
      const auth = generateAuthParams();
      const qs = buildQueryString({ ...params, ...auth });
      const url = `${this.baseUrl}${path}?${qs}`;

      const res = await httpRequest(url, 'GET', { Accept: 'application/json' });
      this.log(`POLL #${i + 1}`, res.status, JSON.stringify(res.body).slice(0, 120));

      if (res.body.code === 200 && res.body.data) {
        const d = res.body.data;
        if (d[successField]) return { ...res, done: true, result: d };
        if (d.status === 'SUCCEEDED' || d.status === 0) return { ...res, done: true, result: d };
        if (d.status === 'FAILED' || d.status === 'CANCELLED') return { ...res, done: true, failed: true, result: d };
      }

      if ([40203, 40204, 40260, 41100].includes(res.body.code)) {
        return { ...res, done: true, failed: true, result: res.body };
      }
    }

    return { done: true, timeout: true };
  }

  // ---------- Photo Face Swap ----------

  async photoFaceSwap(swapImageBuffer, targetImageBuffer, options = {}) {
    const uid64 = generateUUID64();
    const boundary = `----WebKitFormBoundary${randomString(16)}`;

    const fields = [
      { name: 'swap_image', isFile: true, filename: options.swapFilename || 'swap.jpg', contentType: options.swapMime || 'image/jpeg', buffer: swapImageBuffer },
      { name: 'target_image', isFile: true, filename: options.targetFilename || 'target.jpg', contentType: options.targetMime || 'image/jpeg', buffer: targetImageBuffer },
      { name: 'user_id', value: uid64 },
    ];

    const payload = buildMultipart(fields, boundary);
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.photoFaceSwap}?${buildQueryString(auth)}`;

    this.log('SUBMIT PHOTO FACE SWAP');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`Face swap submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const jobId = submitRes.body.data.job_id;
    this.log('JOB CREATED', jobId);

    const pollRes = await this.pollTask(ENDPOINTS.photoFaceSwap, { user_id: uid64, job_id: jobId }, {
      maxPolls: options.maxPolls || 60,
      interval: options.interval || 3000,
      successField: options.successField || 'face_swap_url',
    });

    return {
      jobId,
      uid64,
      submit: submitRes.body,
      poll: pollRes,
      resultUrl: pollRes.result?.face_swap_url || pollRes.result?.generate_url || null,
    };
  }

  // ---------- KIE Image Generation ----------

  async kieImageGen(prompt, options = {}) {
    const uid64 = generateUUID64();
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.kieImageGen}?${buildQueryString(auth)}`;

    const itemJson = JSON.stringify({
      prompt,
      platform: 'web',
      output_format: options.format || 'png',
      aspect_ratio: options.aspectRatio || '1:1',
      model_type: options.modelType || '1',
      is_verify: true,
      user_id: uid64,
    });

    const boundary = `----WebKitFormBoundary${randomString(16)}`;
    const payload = buildMultipart([
      { name: 'item_json', value: itemJson },
      { name: 'user_id', value: uid64 },
    ], boundary);

    this.log('SUBMIT KIE IMG GEN', prompt.slice(0, 40));
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`KIE submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const taskId = submitRes.body.data.task_id;
    this.log('TASK CREATED', taskId);

    const pollRes = await this.pollTask(ENDPOINTS.kieImageGen, { task_id: taskId, user_id: uid64 }, {
      maxPolls: options.maxPolls || 60,
      interval: options.interval || 3000,
    });

    return {
      taskId,
      uid64,
      submit: submitRes.body,
      poll: pollRes,
      resultUrl: pollRes.result?.generate_url || pollRes.result?.image_url || null,
    };
  }

  // ---------- Background Replace ----------

  async backgroundReplace(imageBuffer, bgImageBuffer, options = {}) {
    const uid64 = generateUUID64();
    const boundary = `----WebKitFormBoundary${randomString(16)}`;

    const fields = [
      { name: 'image', isFile: true, filename: options.imageFilename || 'image.jpg', contentType: options.imageMime || 'image/jpeg', buffer: imageBuffer },
      { name: 'bg_image', isFile: true, filename: options.bgFilename || 'bg.jpg', contentType: options.bgMime || 'image/jpeg', buffer: bgImageBuffer },
      { name: 'user_id', value: uid64 },
    ];

    const payload = buildMultipart(fields, boundary);
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.bgReplace}?${buildQueryString(auth)}`;

    this.log('SUBMIT BG REPLACE');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`BG replace submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const taskId = submitRes.body.data.task_id || submitRes.body.data.job_id;
    const pollRes = await this.pollTask(ENDPOINTS.bgReplace, { task_id: taskId, user_id: uid64 }, { maxPolls: 60, interval: 3000 });
    return { taskId, uid64, submit: submitRes.body, poll: pollRes, resultUrl: pollRes.result?.generate_url || null };
  }

  // ---------- Clothes Remover ----------

  async clothesRemover(imageBuffer, options = {}) {
    const uid64 = generateUUID64();
    const boundary = `----WebKitFormBoundary${randomString(16)}`;

    const fields = [
      { name: 'image', isFile: true, filename: options.filename || 'image.jpg', contentType: options.mime || 'image/jpeg', buffer: imageBuffer },
      { name: 'user_id', value: uid64 },
    ];

    const payload = buildMultipart(fields, boundary);
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.clothesRemover}?${buildQueryString(auth)}`;

    this.log('SUBMIT CLOTHES REMOVER');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`Clothes remover submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const taskId = submitRes.body.data.task_id || submitRes.body.data.job_id;
    const pollRes = await this.pollTask(ENDPOINTS.clothesRemover, { task_id: taskId, user_id: uid64 }, { maxPolls: 60, interval: 3000 });
    return { taskId, uid64, submit: submitRes.body, poll: pollRes, resultUrl: pollRes.result?.generate_url || null };
  }

  // ---------- Clothes Changer ----------

  async clothesChanger(imageBuffer, prompt, options = {}) {
    const uid64 = generateUUID64();
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.clothesChanger}?${buildQueryString(auth)}`;

    const itemJson = JSON.stringify({
      prompt,
      platform: 'web',
      output_format: options.format || 'png',
      aspect_ratio: options.aspectRatio || '1:1',
      model_type: '1',
      is_verify: true,
      user_id: uid64,
    });

    const boundary = `----WebKitFormBoundary${randomString(16)}`;
    const payload = buildMultipart([
      { name: 'item_json', value: itemJson },
      { name: 'user_id', value: uid64 },
    ], boundary);

    this.log('SUBMIT CLOTHES CHANGER');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`Clothes changer submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const taskId = submitRes.body.data.task_id || submitRes.body.data.job_id;
    const pollRes = await this.pollTask(ENDPOINTS.clothesChanger, { task_id: taskId, user_id: uid64 }, { maxPolls: 60, interval: 3000 });
    return { taskId, uid64, submit: submitRes.body, poll: pollRes, resultUrl: pollRes.result?.generate_url || null };
  }

  // ---------- Upscaler ----------

  async upscale(imageBuffer, options = {}) {
    const uid64 = generateUUID64();
    const boundary = `----WebKitFormBoundary${randomString(16)}`;

    const fields = [
      { name: 'image', isFile: true, filename: options.filename || 'image.jpg', contentType: options.mime || 'image/jpeg', buffer: imageBuffer },
      { name: 'user_id', value: uid64 },
    ];

    const payload = buildMultipart(fields, boundary);
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.upscaler}?${buildQueryString(auth)}`;

    this.log('SUBMIT UPSCALER');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`Upscaler submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const taskId = submitRes.body.data.task_id || submitRes.body.data.job_id;
    const pollRes = await this.pollTask(ENDPOINTS.upscaler, { task_id: taskId, user_id: uid64 }, { maxPolls: 60, interval: 3000 });
    return { taskId, uid64, submit: submitRes.body, poll: pollRes, resultUrl: pollRes.result?.generate_url || null };
  }

  // ---------- Video Face Swap (GIF/MP4) ----------

  async videoFaceSwap(faceImageBuffer, targetVideoUrl, options = {}) {
    const uid64 = generateUUID64();
    const auth = generateAuthParams();
    const url = `${this.baseUrl}${ENDPOINTS.videoFaceSwap}?${buildQueryString(auth)}`;

    const boundary = `----WebKitFormBoundary${randomString(16)}`;
    const fields = [
      { name: 'file', isFile: true, filename: options.faceFilename || 'face.jpg', contentType: options.faceMime || 'image/jpeg', buffer: faceImageBuffer },
      { name: 'target_video_url', value: targetVideoUrl },
      { name: 'face_enhance', value: options.faceEnhance ? 'true' : 'false' },
      { name: 'is_gif_swap', value: options.isGif ? 'true' : 'false' },
      { name: 'duration', value: String(options.duration || 5) },
      { name: 'user_id', value: uid64 },
    ];

    const payload = buildMultipart(fields, boundary);

    this.log('SUBMIT VIDEO FACE SWAP');
    const submitRes = await httpRequest(url, 'POST', {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    }, payload);

    if (submitRes.status !== 200 || submitRes.body.code !== 200) {
      throw new Error(`Video face swap submit failed: ${JSON.stringify(submitRes.body)}`);
    }

    const jobId = submitRes.body.data.job_id;
    this.log('VIDEO JOB CREATED', jobId);

    const pollRes = await this.pollTask(ENDPOINTS.videoFaceSwap.replace('/consumption', '/task'), { user_id: uid64, job_id: jobId, is_gif_swap: options.isGif ? 'true' : 'false' }, { maxPolls: 120, interval: 5000 });
    return { jobId, uid64, submit: submitRes.body, poll: pollRes, resultUrl: pollRes.result?.video_url || pollRes.result?.generate_url || null };
  }
}

export default DeepFakeMaker;
