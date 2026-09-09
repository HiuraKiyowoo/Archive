import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const cookieJars = new Set();

export function createTempCookieJar() {
  const jar = join(mkdtempSync(join(tmpdir(), "ck-")), "jar.txt");
  cookieJars.add(jar);
  return jar;
}

export function removeCookieJar(jar) {
  if (!jar) return;
  try {
    rmSync(jar, { force: true });
  } catch {}
  cookieJars.delete(jar);
}

export function curlRequest({ url, method = "GET", headers = {}, body = null, cookieJar = null, timeout = 60 }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--curves",
      "X25519",
      "-A",
      UA,
      "-m",
      String(timeout),
      "-w",
      "\n%{http_code}",
    ];
    if (cookieJar) {
      args.push("-c", cookieJar, "-b", cookieJar);
    }
    if (method === "POST") args.push("-X", "POST");
    if (body) {
      if (typeof body === "string") {
        args.push("-d", body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push(url);

    const proc = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && code !== 22) {
        reject(new Error(`curl exit ${code}: ${stderr.trim()}`));
        return;
      }
      const idx = stdout.lastIndexOf("\n");
      const httpCode = parseInt(stdout.slice(idx + 1).trim(), 10) || 0;
      const content = idx >= 0 ? stdout.slice(0, idx) : stdout;
      resolve({ statusCode: httpCode, body: content, headers: {} });
    });
  });
}

export function fetchHtml(url, cookieJar = null) {
  return curlRequest({ url, cookieJar, headers: { Accept: "text/html,application/xhtml+xml" } });
}

export function fetchJson(url, cookieJar = null) {
  return curlRequest({ url, cookieJar, headers: { Accept: "application/json" } });
}
