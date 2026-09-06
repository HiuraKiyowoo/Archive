#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { text2img, generateAndDownload } from "./src/index.js";

function printHelp() {
  console.log(`
DeepAI Text2Img Generator CLI
Usage:
  node cli.js <prompt> [output_file]

Examples:
  node cli.js "cyberpunk samurai robot katana neon rain" samurai.jpg
  node cli.js "cute anime girl portrait with flowers" anime.jpg
`);
}

async function main() {
  const args = process.argv.slice(2);
  const prompt = args[0];

  if (!prompt || prompt === "-h" || prompt === "--help") {
    printHelp();
    process.exit(0);
  }

  const outputFile = args[1] || `deepai_${Date.now()}.jpg`;

  console.log(`[*] Generating image with prompt: "${prompt}"...`);
  try {
    const res = await generateAndDownload(prompt);
    await fs.promises.writeFile(outputFile, res.buffer);
    console.log(JSON.stringify({
      ok: true,
      prompt: res.prompt,
      id: res.id,
      output_url: res.output_url,
      saved_file: outputFile,
      size_bytes: res.buffer.length
    }, null, 2));
  } catch (err) {
    console.error(`[-] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
