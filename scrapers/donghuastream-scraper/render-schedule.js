import { chromium } from 'playwright';

const URL = 'https://donghuastream.org/schedule/';

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=PostQuantumKyber'],
});

try {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Tunggu AJAX schedule ngisi .listupd (maks 20 detik)
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
