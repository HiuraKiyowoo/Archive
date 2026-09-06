#!/usr/bin/env node
import { generateAndSave, generateText } from "./src/index.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Pollinations.ai CLI Tool (Zero-dependency)

Usage:
  node cli.js image "<prompt>" [options]
  node cli.js text "<prompt>" [options]

Image Options:
  --out <path>        Path output file (default: output.jpg)
  --model <name>      Model (default: flux, options: turbo, flux-anime, flux-realism, flux-3d)
  --width <number>    Lebar gambar (default: 1024)
  --height <number>   Tinggi gambar (default: 1024)
  --seed <number>     Seed angka acak

Text Options:
  --model <name>      Model text (default: openai, options: mistral, llama)
  --system <text>     System prompt
`);
}

function getOpt(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return fallback;
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  const prompt = args[1];
  if (!prompt) {
    console.error("[-] Error: Prompt wajib diisi!");
    process.exit(1);
  }

  if (command === "image") {
    const outPath = getOpt("--out", "output.jpg");
    const model = getOpt("--model", "flux");
    const width = parseInt(getOpt("--width", "1024"), 10);
    const height = parseInt(getOpt("--height", "1024"), 10);
    const seed = getOpt("--seed", null);

    console.log(`[*] Generating image with model "${model}" (${width}x${height})...`);
    console.log(`[*] Prompt: "${prompt}"`);

    try {
      const res = await generateAndSave(prompt, outPath, {
        model,
        width,
        height,
        seed: seed ? parseInt(seed, 10) : undefined
      });
      console.log(`[+] Success! Saved to: ${res.path} (${(res.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`[-] Failed: ${err.message}`);
      process.exit(1);
    }
  } else if (command === "text") {
    const model = getOpt("--model", null);
    const system = getOpt("--system", null);

    console.log(`[*] Querying text model...`);
    try {
      const answer = await generateText(prompt, { model, system });
      console.log("\n--- Response ---");
      console.log(answer.trim());
      console.log("----------------\n");
    } catch (err) {
      console.error(`[-] Failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error(`[-] Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

main();
