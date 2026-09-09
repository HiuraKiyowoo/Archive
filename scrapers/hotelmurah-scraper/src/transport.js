import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 250;

/**
 * Ensures polite spacing between requests.
 */
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Execute HTTP request using curl to bypass Cloudflare TLS JA3/JA4 fingerprinting.
 *
 * @param {Object} options
 * @param {string} options.url - Full URL to request
 * @param {string} [options.method="GET"] - HTTP method
 * @param {Object} [options.headers={}] - Custom HTTP headers
 * @param {string|Object} [options.body=null] - Request body (string or JSON object)
 * @param {string} [options.cookieJar=null] - File path to save/read cookies
 * @param {number} [options.timeout=25] - Max time in seconds
 * @returns {Promise<{ statusCode: number, body: string, json: any }>}
 */
export async function curlRequest({
  url,
  method = "GET",
  headers = {},
  body = null,
  cookieJar = null,
  timeout = 25
}) {
  await throttle();

  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--max-time",
      String(timeout),
      "-L",
      "--curves",
      "X25519",
      "-A",
      DEFAULT_UA
    ];

    if (cookieJar) {
      args.push("-c", cookieJar, "-b", cookieJar);
    }

    const mergedHeaders = {
      Accept: "application/json, text/html, */*",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      ...headers
    };

    for (const [k, v] of Object.entries(mergedHeaders)) {
      if (v !== undefined && v !== null) {
        args.push("-H", `${k}: ${v}`);
      }
    }

    if (method.toUpperCase() === "POST") {
      args.push("-X", "POST");
      if (body !== null && body !== undefined) {
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        args.push("-d", payload);
      }
    }

    args.push("-w", "\n%{http_code}");
    args.push(url);

    const proc = spawn("curl", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d;
    });
    proc.stderr.on("data", (d) => {
      stderr += d;
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(`curl process failed (code ${code}): ${stderr || stdout}`)
        );
      }

      const lastNewline = stdout.lastIndexOf("\n");
      if (lastNewline === -1) {
        return resolve({
          statusCode: 200,
          body: stdout,
          json: tryParseJson(stdout)
        });
      }

      const statusStr = stdout.slice(lastNewline + 1).trim();
      const rawBody = stdout.slice(0, lastNewline);
      const statusCode = parseInt(statusStr, 10) || 200;

      resolve({
        statusCode,
        body: rawBody,
        json: tryParseJson(rawBody)
      });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Creates a temporary cookie jar file path for session operations.
 */
export function createTempCookieJar() {
  const rnd = Math.random().toString(36).slice(2);
  return path.join(os.tmpdir(), `hm_cookie_${Date.now()}_${rnd}.txt`);
}

/**
 * Cleans up a temporary cookie jar file.
 */
export function removeCookieJar(jarPath) {
  try {
    if (jarPath && fs.existsSync(jarPath)) {
      fs.unlinkSync(jarPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
