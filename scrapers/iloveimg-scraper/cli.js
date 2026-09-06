#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { compressImage, resizeImage, convertToJpg, upscaleImage } from "./src/index.js";

function printHelp() {
  console.log(`
iLoveIMG Zero-Dep CLI Tool
Usage:
  node cli.js compress <input_file> [output_file]
  node cli.js resize <input_file> <width_px> [output_file]
  node cli.js convert <input_file> [output_file]
  node cli.js upscale <input_file> [2|4] [output_file]

Examples:
  node cli.js compress banner.png compressed_banner.jpg
  node cli.js resize photo.jpg 800 resized_800.jpg
  node cli.js upscale avatar.png 2 upscale_2x.png
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    process.exit(0);
  }

  const inputFile = args[1];
  if (!inputFile) {
    console.error("Error: input_file is required.");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: input file not found at "${inputFile}"`);
    process.exit(1);
  }

  try {
    if (command === "compress") {
      const outputFile = args[2] || `compressed_${path.basename(inputFile)}`;
      console.log(`[*] Compressing: ${inputFile}...`);
      const res = await compressImage(inputFile);
      await fs.promises.writeFile(outputFile, res.buffer);
      console.log(JSON.stringify({
        ok: true,
        command: "compress",
        input: inputFile,
        output: outputFile,
        original_size: res.original_size,
        output_size: res.output_size,
        ratio: res.ratio
      }, null, 2));

    } else if (command === "resize") {
      const width = parseInt(args[2] || "800", 10);
      const outputFile = args[3] || `resized_${path.basename(inputFile)}`;
      console.log(`[*] Resizing: ${inputFile} to width ${width}px...`);
      const res = await resizeImage(inputFile, { resize_mode: "pixels", pixels_width: width });
      await fs.promises.writeFile(outputFile, res.buffer);
      console.log(JSON.stringify({
        ok: true,
        command: "resize",
        input: inputFile,
        output: outputFile,
        width,
        output_size: res.output_size
      }, null, 2));

    } else if (command === "convert") {
      const outputFile = args[2] || `${path.parse(inputFile).name}.jpg`;
      console.log(`[*] Converting to JPG: ${inputFile}...`);
      const res = await convertToJpg(inputFile);
      await fs.promises.writeFile(outputFile, res.buffer);
      console.log(JSON.stringify({
        ok: true,
        command: "convert",
        input: inputFile,
        output: outputFile,
        output_size: res.output_size
      }, null, 2));

    } else if (command === "upscale") {
      const mult = parseInt(args[2] || "2", 10);
      const outputFile = args[3] || `upscaled_${path.basename(inputFile)}`;
      console.log(`[*] Upscaling: ${inputFile} (${mult}x)...`);
      const res = await upscaleImage(inputFile, mult);
      await fs.promises.writeFile(outputFile, res.buffer);
      console.log(JSON.stringify({
        ok: true,
        command: "upscale",
        input: inputFile,
        output: outputFile,
        multiplier: mult,
        output_size: res.output_size
      }, null, 2));

    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(`[-] Operation failed: ${err.message}`);
    process.exit(1);
  }
}

main();
