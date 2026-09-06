import fs from "node:fs";
import path from "node:path";

const BASE_URL = "https://www.iloveimg.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Fetch fresh session config (token, taskId, server worker) from tool page
 */
export async function getSessionConfig(tool = "compress-image") {
  const url = `${BASE_URL}/${tool}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch iLoveIMG tool page (${res.status} ${res.statusText})`);
  }

  const html = await res.text();
  const cfgMatch = html.match(/var ilovepdfConfig = (\{.*?\});/);
  if (!cfgMatch) {
    throw new Error("Unable to parse ilovepdfConfig from HTML");
  }

  const cfg = JSON.parse(cfgMatch[1]);
  const token = cfg.token;
  const servers = cfg.servers || ["api1"];
  const server = servers[0];

  const taskIdMatch = html.match(/ilovepdfConfig\.taskId = '([^']+)';/);
  const taskId = taskIdMatch ? taskIdMatch[1] : null;

  if (!taskId || !token) {
    throw new Error("Missing taskId or token in iLoveIMG page");
  }

  return {
    token,
    taskId,
    server,
    workerUrl: `https://${server}.iloveimg.com`
  };
}

/**
 * Upload an image file buffer or path to iLoveIMG worker
 */
export async function uploadFile(session, fileInput, filename = "image.jpg") {
  let fileBuffer;
  if (typeof fileInput === "string") {
    fileBuffer = await fs.promises.readFile(fileInput);
    filename = path.basename(fileInput);
  } else if (Buffer.isBuffer(fileInput) || fileInput instanceof Uint8Array) {
    fileBuffer = fileInput;
  } else {
    throw new Error("fileInput must be a file path string or Buffer");
  }

  const form = new FormData();
  form.append("task", session.taskId);
  const blob = new Blob([fileBuffer], { type: "image/jpeg" });
  form.append("file", blob, filename);

  const res = await fetch(`${session.workerUrl}/v1/upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.token}`,
      "User-Agent": USER_AGENT
    },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  return {
    server_filename: json.server_filename,
    original_filename: filename,
    filesize: fileBuffer.length
  };
}

/**
 * Trigger processing task on uploaded file
 */
export async function processTask(session, tool, uploaded, options = {}) {
  const form = new FormData();
  form.append("task", session.taskId);
  form.append("tool", tool);
  form.append("files[0][server_filename]", uploaded.server_filename);
  form.append("files[0][filename]", uploaded.original_filename);

  for (const [k, v] of Object.entries(options)) {
    form.append(k, String(v));
  }

  const res = await fetch(`${session.workerUrl}/v1/process`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.token}`,
      "User-Agent": USER_AGENT
    },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Process task failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Download processed output file as Buffer
 */
export async function downloadResult(session) {
  const res = await fetch(`${session.workerUrl}/v1/download/${session.taskId}`, {
    headers: {
      "Authorization": `Bearer ${session.token}`,
      "User-Agent": USER_AGENT
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Download failed (${res.status}): ${errText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * High-level: Compress Image
 */
export async function compressImage(fileInput, options = { compression_level: "recommended" }) {
  const session = await getSessionConfig("compress-image");
  const uploaded = await uploadFile(session, fileInput);
  const result = await processTask(session, "compressimage", uploaded, options);
  const outputBuffer = await downloadResult(session);

  return {
    success: true,
    tool: "compressimage",
    original_size: uploaded.filesize,
    output_size: outputBuffer.length,
    ratio: ((outputBuffer.length / uploaded.filesize) * 100).toFixed(1) + "%",
    buffer: outputBuffer,
    meta: result
  };
}

/**
 * High-level: Resize Image
 * options: { resize_mode: "pixels", pixels_width: 800 } or { resize_mode: "percentage", percentage: 50 }
 */
export async function resizeImage(fileInput, options = { resize_mode: "percentage", percentage: 50 }) {
  const session = await getSessionConfig("resize-image");
  const uploaded = await uploadFile(session, fileInput);
  const result = await processTask(session, "resizeimage", uploaded, options);
  const outputBuffer = await downloadResult(session);

  return {
    success: true,
    tool: "resizeimage",
    original_size: uploaded.filesize,
    output_size: outputBuffer.length,
    buffer: outputBuffer,
    meta: result
  };
}

/**
 * High-level: Convert Image to JPG/PNG
 */
export async function convertToJpg(fileInput, format = "jpg") {
  const session = await getSessionConfig("convert-to-jpg");
  const uploaded = await uploadFile(session, fileInput);
  const result = await processTask(session, "convertimage", uploaded, { convert_to: format });
  const outputBuffer = await downloadResult(session);

  return {
    success: true,
    tool: "convertimage",
    format,
    original_size: uploaded.filesize,
    output_size: outputBuffer.length,
    buffer: outputBuffer,
    meta: result
  };
}

/**
 * High-level: Upscale Image (2x, 4x)
 */
export async function upscaleImage(fileInput, multiplier = 2) {
  const session = await getSessionConfig("upscale-image");
  const uploaded = await uploadFile(session, fileInput);
  const result = await processTask(session, "upscaleimage", uploaded, { multiplier: String(multiplier) });
  const outputBuffer = await downloadResult(session);

  return {
    success: true,
    tool: "upscaleimage",
    multiplier,
    original_size: uploaded.filesize,
    output_size: outputBuffer.length,
    buffer: outputBuffer,
    meta: result
  };
}
