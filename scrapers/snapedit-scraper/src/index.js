/**
 * snapedit-scraper: Zero-dependency SnapEdit Video Enhance API client
 * Reverse engineered from https://snapedit.app/id/video-enhance
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';

const CLIENT_SECRET_B64 = "HBmQJoIurA0HVLyUaCiFlxF+JJc14eHmZNttilecFGQ=";
const CLIENT_SECRET = Buffer.from(CLIENT_SECRET_B64, 'base64');
const API_BASE = "https://be-prod-web.snapedit.app";
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Generate HMAC-SHA256 Client JWT Token for SnapEdit backend
 */
export function generateClientToken(options = {}) {
  const { isPro = false, userId = null, tier = null } = options;
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.round(Date.now() / 1000);
  const payload = {
    sub: "ignore",
    platform: "web",
    is_pro: Boolean(isPro),
    is_premium: Boolean(isPro),
    ...(tier ? { tier } : {}),
    ...(userId ? { user_id: userId } : {}),
    exp: now + 600
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', CLIENT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Compute 32-bit integer string hash for X-Device-Fingerprint
 */
export function computeDeviceFingerprint(ua = DEFAULT_UA, tz = "Asia/Jakarta", lang = "id") {
  const str = `${ua}::${tz}::${lang}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * HTTP helper using Node stdlib https with IPv4 force
 */
export function requestHttp(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      family: 4,
      headers: options.headers || {}
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: raw.toString('utf-8'),
          raw
        });
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

/**
 * Get Video Enhance Upload Configs
 */
export async function getUploadConfigs(token = null) {
  const authToken = token || generateClientToken();
  const fp = computeDeviceFingerprint();

  const res = await requestHttp(`${API_BASE}/api/enhance_video/upload-configs`, {
    method: "GET",
    headers: {
      "User-Agent": DEFAULT_UA,
      "Origin": "https://snapedit.app",
      "Referer": "https://snapedit.app/",
      "Accept": "application/json",
      "Authorization": `Bearer ${authToken}`,
      "X-Device-Fingerprint": fp
    }
  });

  if (res.status !== 200) {
    throw new Error(`getUploadConfigs failed [HTTP ${res.status}]: ${res.body}`);
  }

  return JSON.parse(res.body);
}

/**
 * Step 1: Request signed upload URL and task_id from SnapEdit backend
 */
export async function initVideoUpload(options = {}) {
  const { isPro = false, firebaseToken = null } = options;
  const token = generateClientToken({ isPro });
  const fp = computeDeviceFingerprint();

  const headers = {
    "User-Agent": DEFAULT_UA,
    "Origin": "https://snapedit.app",
    "Referer": "https://snapedit.app/",
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "X-Device-Fingerprint": fp,
    ...(firebaseToken ? { "X-FIREBASE-TOKEN": firebaseToken } : {})
  };

  const res = await requestHttp(`${API_BASE}/api/enhance_video/v2/upload`, {
    method: "POST",
    headers
  });

  if (res.status !== 200) {
    throw new Error(`initVideoUpload failed [HTTP ${res.status}]: ${res.body}`);
  }

  return JSON.parse(res.body);
}

/**
 * Step 2: Upload raw video buffer directly to BytePlus/TOS signed URL
 */
export async function uploadVideoBinary(signedUrl, videoBuffer, contentLengthRange = "0,209715200") {
  const res = await requestHttp(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": videoBuffer.length,
      "x-goog-content-length-range": contentLengthRange
    }
  }, videoBuffer);

  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`uploadVideoBinary failed [HTTP ${res.status}]: ${res.body}`);
  }

  return { ok: true, status: res.status };
}

/**
 * Step 3: Submit video enhance task to queue
 */
export async function submitEnhanceTask(taskId, options = {}) {
  const { zoomFactor = "FHD", isPreview = true, workspaceId = null, firebaseToken = null } = options;
  const token = generateClientToken({ isPro: !isPreview });
  const fp = computeDeviceFingerprint();

  const boundary = "----WebKitFormBoundary" + crypto.randomBytes(8).toString('hex');
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="task_id"\r\n\r\n${taskId}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="zoom_factor"\r\n\r\n${zoomFactor}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="is_preview"\r\n\r\n${isPreview ? "true" : "false"}\r\n`,
    ...(workspaceId ? [`--${boundary}\r\nContent-Disposition: form-data; name="workspace_id"\r\n\r\n${workspaceId}\r\n`] : []),
    `--${boundary}--\r\n`
  ];

  const body = Buffer.from(parts.join(''));
  const headers = {
    "User-Agent": DEFAULT_UA,
    "Origin": "https://snapedit.app",
    "Referer": "https://snapedit.app/",
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "X-Device-Fingerprint": fp,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": body.length,
    ...(firebaseToken ? { "X-FIREBASE-TOKEN": firebaseToken } : {})
  };

  const res = await requestHttp(`${API_BASE}/api/enhance_video/v2/tasks`, {
    method: "POST",
    headers
  }, body);

  if (res.status !== 200) {
    throw new Error(`submitEnhanceTask failed [HTTP ${res.status}]: ${res.body}`);
  }

  return JSON.parse(res.body);
}

/**
 * Step 4: Poll status of a running task
 */
export async function getTaskStatus(taskId, options = {}) {
  const { firebaseToken = null } = options;
  const token = generateClientToken();
  const fp = computeDeviceFingerprint();

  const headers = {
    "User-Agent": DEFAULT_UA,
    "Origin": "https://snapedit.app",
    "Referer": "https://snapedit.app/",
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "X-Device-Fingerprint": fp,
    ...(firebaseToken ? { "X-FIREBASE-TOKEN": firebaseToken } : {})
  };

  const res = await requestHttp(`${API_BASE}/api/enhance_video/v2/tasks/${taskId}`, {
    method: "GET",
    headers
  });

  if (res.status !== 200) {
    throw new Error(`getTaskStatus failed [HTTP ${res.status}]: ${res.body}`);
  }

  return JSON.parse(res.body);
}

/**
 * High-level Pipeline: Enhance a local video file
 */
export async function enhanceVideo(filePath, options = {}) {
  const {
    zoomFactor = "FHD",
    isPreview = true,
    firebaseToken = null,
    pollIntervalMs = 3000,
    maxPollAttempts = 30,
    onProgress = null
  } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const videoBuffer = fs.readFileSync(filePath);

  if (onProgress) onProgress({ step: "init_upload", message: "Requesting signed upload URL..." });
  const init = await initVideoUpload({ firebaseToken });
  const taskId = init.task_id;
  const signedUrl = init.upload_signed_url;

  if (onProgress) onProgress({ step: "uploading", taskId, message: "Uploading video binary..." });
  await uploadVideoBinary(signedUrl, videoBuffer, init["x-goog-content-length-range"]);

  if (onProgress) onProgress({ step: "submit_task", taskId, message: "Submitting enhance task..." });
  await submitEnhanceTask(taskId, { zoomFactor, isPreview, firebaseToken });

  if (onProgress) onProgress({ step: "polling", taskId, message: "Waiting for processing..." });
  for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const status = await getTaskStatus(taskId, { firebaseToken });

    if (onProgress) onProgress({ step: "polling", attempt, status });

    if (status.status === "COMPLETED" || status.status === "COMPLETED_PREVIEW") {
      return {
        ok: true,
        taskId,
        status: status.status,
        resultUrl: status.result_url || status.resultFHD || status.result2K || status.preview_url || status.previewFHD || status.preview2K,
        raw: status
      };
    }

    if (status.status === "FAILED") {
      throw new Error(`Enhance task failed: ${JSON.stringify(status)}`);
    }
  }

  throw new Error(`Enhance task timed out after ${maxPollAttempts} attempts. Task ID: ${taskId}`);
}
