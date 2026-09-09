#!/usr/bin/env node
import { searchMixkit, searchVideezy, searchSplitShire, searchVidevo, searchAll, getMixkitVideo } from "./src/index.js";

function printResult({ command, ok, data, error = null }) {
  const envelope = {
    source: "stock-video-scraper",
    command,
    ok,
    ...(ok ? { data } : { error: error?.message || String(error) }),
  };
  console.log(JSON.stringify(envelope, null, 2));
  if (!ok) process.exit(1);
}

function printUsage() {
  console.error(`
Usage: node cli.js <command> [arguments]

Commands:
  mixkit <query> [page]              Search Mixkit (no login)
  videezy <query> [page]             Search Videezy (no login)
  splitshire <query> [page]          Search SplitShire (no login)
  videvo <query> [page]              Search Videvo (no login)
  all <query> [page]                 Search all sources
  mixkit-detail <url>                Get Mixkit video details + download links

Examples:
  node cli.js mixkit nature
  node cli.js mixkit nature 2
  node cli.js videezy city
  node cli.js splitshire
  node cli.js all ocean
  node cli.js mixkit-detail https://mixkit.co/free-stock-video/nature/
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
  }

  try {
    switch (cmd) {
      case "mixkit":
      case "videezy":
      case "splitshire":
      case "videvo": {
        const query = args[1] || "";
        const page = parseInt(args[2]) || 1;
        const fn = { mixkit: searchMixkit, videezy: searchVideezy, splitshire: searchSplitShire, videvo: searchVidevo }[cmd];
        const data = await fn(query, page);
        printResult({ command: `${cmd} "${query}"`, ok: true, data });
        break;
      }
      case "all": {
        const query = args[1] || "";
        const page = parseInt(args[2]) || 1;
        const data = await searchAll(query, page);
        printResult({ command: `all "${query}"`, ok: true, data });
        break;
      }
      case "mixkit-detail": {
        const url = args[1];
        if (!url) throw new Error("Usage: node cli.js mixkit-detail <url>");
        const data = await getMixkitVideo(url);
        printResult({ command: `mixkit-detail`, ok: true, data });
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}`);
        printUsage();
    }
  } catch (err) {
    printResult({ command: cmd, ok: false, error: err });
  }
}

main();
