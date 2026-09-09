import { fetchHtml, fetchJson, curlRequest, createTempCookieJar, removeCookieJar } from "./transport.js";

const MIXKIT_BASE = "https://mixkit.co";
const VIDEVO_BASE = "https://www.videvo.net";
const VIDEOEZY_BASE = "https://www.videezy.com";
const SPLITSHIRE_BASE = "https://www.splitshire.com";

/**
 * Mixkit — no login, scrape HTML pages, CDN download.
 */
export async function searchMixkit(query = "", page = 1, category = "") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const cat = category ? category + "/" : "";
  const qs = params.toString();
  const url = `${MIXKIT_BASE}/free-stock-video/${cat}${qs ? "?" + qs : ""}`;
  const { body } = await fetchHtml(url);

  const videos = [];
  const reDiv = /<div class="item-grid-video-player[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
  let m;
  while ((m = reDiv.exec(body)) !== null) {
    const card = m[0];
    const itemId = (card.match(/data-item-grid--video-player-item-id-value="([^"]+)"/) || [])[1] || "";
    const title = (card.match(/class="item-grid-video-player__overlay-video-title"[^>]*>\s*([^<]+?)\s*</) || [])[1] || "";
    const link = (card.match(/href="(\/free-stock-video\/[^"]+)"/) || [])[1] || "";
    const thumb = (card.match(/srcset="([^"]+)"/) || [])[1] || "";
    if (link) {
      videos.push({
        id: itemId,
        title: title.trim(),
        thumbnail: thumb.split("?")[0] || thumb,
        url: link.startsWith("http") ? link : MIXKIT_BASE + link,
      });
    }
  }
  return { source: "mixkit", query, page, videos, count: videos.length };
}

export async function getMixkitVideo(detailUrl) {
  const { body } = await fetchHtml(detailUrl);
  const title = (body.match(/<h1[^>]*>(.*?)<\/h1>/i) || [])[1] || "";
  const desc = (body.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) || [])[1] || "";
  // Find all MP4 download links
  const mp4s = [...new Set([...body.matchAll(/https:\/\/assets\.mixkit\.co\/videos\/[0-9]+\/[0-9]+-[0-9]+\.mp4/g)].map((m) => m[0]))];
  // Group by resolution
  const downloads = {};
  for (const url of mp4s) {
    const res = url.match(/-([0-9]+)\.mp4/);
    if (res) downloads[res[1]] = url;
  }
  // Find tags
  const tags = [...body.matchAll(/<a[^>]*href="\/free-stock-video\/tags\/[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(
    (m) => m[1].trim()
  );
  // Find ID from URL
  const id = detailUrl.match(/([0-9]+)\/?$/)?.[1] || "";
  return {
    source: "mixkit",
    id,
    title: title.replace(/<[^>]+>/g, "").trim(),
    description: desc,
    downloads,
    tags: [...new Set(tags)].slice(0, 10),
    url: detailUrl,
    best: downloads["4k"] || downloads["1080"] || downloads["720"] || Object.values(downloads)[0] || null,
  };
}

/**
 * Videezy — no login, scrape HTML.
 */
export async function searchVideezy(query = "", page = 1) {
  const url = `${VIDEOEZY_BASE}/free-stock-footage/${encodeURIComponent(query)}/${page > 1 ? "?page=" + page : ""}`;
  const { body } = await fetchHtml(url);
  const videos = [];
  const cardRe = /<article[^>]*class="[^"]*video[^"]*"[\s\S]*?<\/article>/gi;
  let m;
  while ((m = cardRe.exec(body)) !== null) {
    const card = m[0];
    const title = (card.match(/<h2[^>]*>(.*?)<\/h2>/i) || [])[1] || "";
    const thumb = (card.match(/src="([^"]+\.jpg[^"]*)"/i) || [])[1] || "";
    const link = (card.match(/href="(\/free-stock-footage\/[^"]+)"/i) || [])[1] || "";
    if (link) {
      videos.push({
        title: title.replace(/<[^>]+>/g, "").trim(),
        thumbnail: thumb,
        url: link.startsWith("http") ? link : VIDEOEZY_BASE + link,
      });
    }
  }
  return { source: "videezy", query, page, videos, count: videos.length };
}

/**
 * SplitShire — no login, CC0, direct download.
 */
export async function searchSplitShire(query = "", page = 1) {
  const url = `${SPLITSHIRE_BASE}/videos/${query ? "?s=" + encodeURIComponent(query) : ""}${page > 1 ? "&paged=" + page : ""}`;
  const { body } = await fetchHtml(url);
  const videos = [];
  const cardRe = /<article[^>]*[\s\S]*?<\/article>/gi;
  let m;
  while ((m = cardRe.exec(body)) !== null) {
    const card = m[0];
    const title = (card.match(/<h2[^>]*>(.*?)<\/h2>/i) || [])[1] || "";
    const thumb = (card.match(/src="([^"]+\.jpg[^"]*)"/i) || [])[1] || "";
    const link = (card.match(/href="(\/videos\/[^"]+)"/i) || [])[1] || "";
    if (link) {
      videos.push({
        title: title.replace(/<[^>]+>/g, "").trim(),
        thumbnail: thumb,
        url: link.startsWith("http") ? link : SPLITSHIRE_BASE + link,
      });
    }
  }
  return { source: "splitshire", query, page, videos, count: videos.length };
}

/**
 * Videvo — no login, but needs browser UA.
 */
export async function searchVidevo(query = "", page = 1) {
  const url = `${VIDEVO_BASE}/stock-video-footage/${encodeURIComponent(query)}/${page > 1 ? "?page=" + page : ""}`;
  const { body } = await fetchHtml(url);
  const videos = [];
  const cardRe = /<article[^>]*[\s\S]*?<\/article>/gi;
  let m;
  while ((m = cardRe.exec(body)) !== null) {
    const card = m[0];
    const title = (card.match(/<h2[^>]*>(.*?)<\/h2>/i) || [])[1] || "";
    const thumb = (card.match(/src="([^"]+\.jpg[^"]*)"/i) || [])[1] || "";
    const link = (card.match(/href="(\/stock-video-footage\/[^"]+)"/i) || [])[1] || "";
    if (link) {
      videos.push({
        title: title.replace(/<[^>]+>/g, "").trim(),
        thumbnail: thumb,
        url: link.startsWith("http") ? link : VIDEVO_BASE + link,
      });
    }
  }
  return { source: "videvo", query, page, videos, count: videos.length };
}

/**
 * Unified search across all sources.
 */
export async function searchAll(query = "", page = 1) {
  const results = await Promise.allSettled([
    searchMixkit(query, page),
    searchVideezy(query, page),
    searchSplitShire(query, page),
    searchVidevo(query, page),
  ]);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason?.message }));
}

export { createTempCookieJar, removeCookieJar };
