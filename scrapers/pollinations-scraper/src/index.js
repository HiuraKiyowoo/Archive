import https from "node:https";
import fs from "node:fs/promises";

const IMAGE_BASE_URL = "https://image.pollinations.ai/prompt";
const TEXT_BASE_URL = "https://text.pollinations.ai";

/**
 * Helper HTTP GET menggunakan native node:https (kebal bug PRoot undici)
 * @param {string} urlStr
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>}
 */
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, {
      family: 4, // Paksa IPv4
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(45000, () => {
      req.destroy(new Error("Request timed out (45s)"));
    });
  });
}

/**
 * Generate AI image via Pollinations.ai (Flux, Turbo, Flux-Anime, dll)
 * @param {string} prompt - Deskripsi gambar
 * @param {object} [options]
 * @param {string} [options.model='flux'] - Model: 'flux', 'turbo', 'flux-anime', 'flux-realism', 'flux-3d'
 * @param {number} [options.width=1024] - Lebar gambar
 * @param {number} [options.height=1024] - Tinggi gambar
 * @param {number} [options.seed] - Seed random
 * @param {boolean} [options.nologo=true] - Hilangkan watermark logo
 * @param {boolean} [options.enhance=false] - Enhance prompt otomatis
 * @returns {Promise<Buffer>} Buffer biner gambar JPEG
 */
export async function generateImage(prompt, options = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt is required and must be a string");
  }

  const {
    model = "flux",
    width = 1024,
    height = 1024,
    seed,
    nologo = true,
    enhance = false
  } = options;

  const encodedPrompt = encodeURIComponent(prompt.trim());
  const params = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
    nologo: String(nologo),
    enhance: String(enhance)
  });

  if (seed !== undefined && seed !== null) {
    params.set("seed", String(seed));
  }

  const url = `${IMAGE_BASE_URL}/${encodedPrompt}?${params.toString()}`;
  const res = await httpsGet(url);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Pollinations Image API error: HTTP ${res.statusCode}`);
  }

  return res.body;
}

/**
 * Generate AI image dan langsung simpan ke file
 * @param {string} prompt
 * @param {string} outputPath
 * @param {object} [options]
 * @returns {Promise<{path: string, size: number}>}
 */
export async function generateAndSave(prompt, outputPath, options = {}) {
  const buffer = await generateImage(prompt, options);
  await fs.writeFile(outputPath, buffer);
  return { path: outputPath, size: buffer.length };
}

/**
 * Generate Text / LLM completion via Pollinations.ai
 * @param {string} prompt - Prompt atau pertanyaan
 * @param {object} [options]
 * @param {string} [options.model='openai-fast'] - Model text aktif (contoh: 'openai-fast')
 * @param {string} [options.system] - System instruction
 * @param {number} [options.seed] - Seed random
 * @returns {Promise<string>} Jawaban teks
 */
export async function generateText(prompt, options = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt is required and must be a string");
  }

  const { model, system, seed } = options;
  const encodedPrompt = encodeURIComponent(prompt.trim());
  const params = new URLSearchParams();

  if (model) params.set("model", model);
  if (system) params.set("system", system);
  if (seed !== undefined) params.set("seed", String(seed));

  const query = params.toString();
  const url = query ? `${TEXT_BASE_URL}/${encodedPrompt}?${query}` : `${TEXT_BASE_URL}/${encodedPrompt}`;
  const res = await httpsGet(url);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Pollinations Text API error: HTTP ${res.statusCode}`);
  }

  return res.body.toString("utf-8");
}
