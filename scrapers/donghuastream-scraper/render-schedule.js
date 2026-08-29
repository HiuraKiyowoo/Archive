import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const URL = 'https://donghuastream.org/schedule/';

// Cari binary Chromium Playwright yang sudah ter-install, apa pun versinya.
// Menghindari error "Executable doesn't exist" saat pindah mesin / versi beda.
function findPlaywrightChromium() {
  const root = join(os.homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return null;

  const names = ['chrome-headless-shell-linux64', 'chrome-linux64'];
  const bins = ['chrome-headless-shell', 'chrome'];
  try {
    for (const dir of readdirSync(root)) {
      for (const name of names) {
        for (const bin of bins) {
          const p = join(root, dir, name, bin);
          if (existsSync(p)) return p;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

const executablePath = findPlaywrightChromium();

const launchOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // Penting: tanpanya ClientHello Kyber bisa bikin handshake ke situs
    // Cloudflare (termasuk donghuastream.org) gagal di sebagian VPS/firewall.
    '--disable-features=PostQuantumKyber',
  ],
};
if (executablePath) launchOptions.executablePath = executablePath;

const browser = await chromium.launch(launchOptions);

try {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Tunggu blok jadwal terisi (maks 20 detik). Tidak wajib berhasil:
  // untuk /schedule/ donghuastream, blok harian memang kosong di sisi server.
  await page.waitForFunction(
    () => {
      const boxes = document.querySelectorAll('.bixbox .listupd');
      let filled = 0;
      boxes.forEach((b) => { if (b.querySelector('.bsx a[href*="/anime/"]')) filled++; });
      return filled >= 2;
    },
    { timeout: 20000 }
  ).catch(() => {});

  const days = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('.bixbox').forEach((box) => {
      const h3 = box.querySelector('h3');
      if (!h3) return;
      const label = h3.textContent.trim();
      const day = label.toLowerCase();
      const items = [];
      box.querySelectorAll('.bsx').forEach((el) => {
        const a = el.querySelector('a[href*="/anime/"]');
        if (!a) return;
        const img = el.querySelector('img');
        items.push({
          title: a.getAttribute('title') || (el.querySelector('h2, .tt h2')?.textContent?.trim() || null),
          url: a.getAttribute('href'),
          episode_label: el.querySelector('.epx')?.textContent?.trim() || null,
          poster: img?.getAttribute('data-src') || img?.getAttribute('src') || null,
        });
      });
      result.push({ day, label, items });
    });
    return result;
  });

  console.log(JSON.stringify({ total_days: days.length, days }, null, 2));
} finally {
  await browser.close();
}