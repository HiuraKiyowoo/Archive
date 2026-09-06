import dns from "node:dns";
import fs from "node:fs";

// Ensure IPv4 first on Linux/PRoot environments
dns.setDefaultResultOrder("ipv4first");

const API_BASE_URL = "https://api.deepai.org";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Reverses DeepAI's browser dynamic island key hashing algorithm
 */
export function generateIslandKey(ua = USER_AGENT) {
  const myrandomstr = Math.round(Math.random() * 100000000000) + "";
  const myhashfunction = (function () {
    const a = [];
    for (let b = 0; 64 > b;) a[b] = 0 | 4294967296 * Math.sin(++b % Math.PI);
    return function (input) {
      let d, e, f, g = [d = 1732584193, e = 4023233417, ~d, ~e], h = [], l = unescape(encodeURI(input)) + "\u0080", k = l.length;
      let c = --k / 4 + 2 | 15;
      for (h[--c] = 8 * k; ~k;) h[k >> 2] |= l.charCodeAt(k) << 8 * k--;
      for (let b = 0, l = 0; b < c; b += 16) {
        for (k = g; 64 > l; k = [f = k[3], d + ((f = k[0] + [d & e | ~d & f, f & d | ~f & e, d ^ e ^ f, e ^ (d | ~f)][k = l >> 4] + a[l] + ~~h[b | [l, 5 * l + 1, 3 * l + 5, 7 * l][k] & 15]) << (k = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][4 * k + l++ % 4]) | f >>> -k), d, e])
          d = k[1] | 0, e = k[2];
        for (l = 4; l;) g[--l] += k[l];
      }
      let result = "";
      for (let l = 0; 32 > l;) result += (g[l >> 3] >> 4 * (1 ^ l++) & 15).toString(16);
      return result.split("").reverse().join("");
    };
  })();

  const secretSalt = "hackers_become_a_little_stinkier_every_time_they_hack";
  const tryitApiKey = "tryit-" + myrandomstr + "-" + myhashfunction(ua + myhashfunction(ua + myhashfunction(ua + myrandomstr + secretSalt)));
  return tryitApiKey;
}

/**
 * Generate image using DeepAI text2img model
 * @param {string} prompt Text description
 * @param {object} options Extra params (e.g. grid_num: 1)
 */
export async function text2img(prompt, options = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt string is required");
  }

  const apiKey = generateIslandKey(USER_AGENT);
  const form = new FormData();
  form.append("text", prompt);

  for (const [k, v] of Object.entries(options)) {
    form.append(k, String(v));
  }

  const res = await fetch(`${API_BASE_URL}/api/text2img`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "User-Agent": USER_AGENT,
      "Origin": "https://deepai.org",
      "Referer": "https://deepai.org/machine-learning-model/text2img"
    },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepAI generation failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (data.err || !data.output_url) {
    throw new Error(`DeepAI Error: ${data.err || "No output_url returned"}`);
  }

  return {
    success: true,
    id: data.id,
    output_url: data.output_url,
    prompt
  };
}

/**
 * Generate and download image directly as Buffer
 */
export async function generateAndDownload(prompt, options = {}) {
  const result = await text2img(prompt, options);
  const imgRes = await fetch(result.output_url, {
    headers: { "User-Agent": USER_AGENT }
  });

  if (!imgRes.ok) {
    throw new Error(`Failed to download image from ${result.output_url} (${imgRes.status})`);
  }

  const arrayBuf = await imgRes.arrayBuffer();
  return {
    ...result,
    buffer: Buffer.from(arrayBuf)
  };
}
