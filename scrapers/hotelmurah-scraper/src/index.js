import {
  curlRequest,
  createTempCookieJar,
  removeCookieJar
} from "./transport.js";
export {
  EwalletSession,
  EWALLET_TYPES,
  findProductByNominal,
  quoteEwalletTopUp,
  checkOrderStatus
} from "./ewallet.js";

const BASE_URL = "https://www.hotelmurah.com";
const SEARCH_V1_URL = "https://hotelmurah.com/search/v1";

/**
 * Generates default check-in and check-out dates (+2 days and +3 days from today).
 */
export function getDefaultDates() {
  const now = new Date();
  const dIn = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const dOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    checkIn: fmt(dIn),
    checkOut: fmt(dOut)
  };
}

/**
 * 1. Get Top Cities / Popular Destinations
 * Endpoint: GET /search/v1/api/cities/top-accommodations
 */
export async function getTopCities() {
  const url = `${SEARCH_V1_URL}/api/cities/top-accommodations`;
  const res = await curlRequest({ url });

  if (res.statusCode !== 200 || !res.json?.success) {
    throw new Error(
      `Failed to fetch top cities (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json.data || [];
}

/**
 * 2. Suggest Accommodations (Autocomplete)
 * Endpoint: GET /search/v1/api/accommodations/search/suggestions?q={query}
 */
export async function suggestAccommodations(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Query parameter 'query' is required");
  }

  const url = `${SEARCH_V1_URL}/api/accommodations/search/suggestions?q=${encodeURIComponent(query)}`;
  const res = await curlRequest({ url });

  if (res.statusCode !== 200 || !res.json?.data) {
    throw new Error(
      `Failed to fetch suggestions (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json.data || [];
}

/**
 * 3. Search Hotel Location (Legacy AJAX / PHP autocomplete)
 * Endpoint: POST /home/search_hotel_location
 */
export async function searchLocationLegacy(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Query parameter 'query' is required");
  }

  const url = `${BASE_URL}/home/search_hotel_location`;
  const res = await curlRequest({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE_URL
    },
    body: `cari=${encodeURIComponent(query)}`
  });

  if (res.statusCode !== 200 || !Array.isArray(res.json)) {
    throw new Error(
      `Failed to search location (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json;
}

/**
 * 4. Search Hotels
 * Endpoint: POST /hotel/api/bff/search/hotels
 *
 * @param {Object} [params={}]
 * @param {string} [params.city="jakarta"] - City slug or name
 * @param {string} [params.checkIn] - Check-in date (YYYY-MM-DD)
 * @param {string} [params.checkOut] - Check-out date (YYYY-MM-DD)
 * @param {number} [params.adults=2] - Number of adults
 * @param {number} [params.children=0] - Number of children
 * @param {number} [params.rooms=1] - Number of rooms
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.limit=15] - Items per page
 * @param {string} [params.sort="popular"] - Sort order (popular, price_asc, price_desc, rating)
 */
export async function searchHotels(params = {}) {
  const defaults = getDefaultDates();
  const city = params.city || "jakarta";
  const checkIn = params.checkIn || defaults.checkIn;
  const checkOut = params.checkOut || defaults.checkOut;
  const adults = Number(params.adults) || 2;
  const children = Number(params.children) || 0;
  const rooms = Number(params.rooms) || 1;
  const page = Number(params.page) || 1;
  const limit = Number(params.limit) || 15;
  const sort = params.sort || "popular";

  const url = `${BASE_URL}/hotel/api/bff/search/hotels`;
  const payload = {
    city,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    children,
    rooms,
    page,
    limit,
    sort
  };

  const res = await curlRequest({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${BASE_URL}/hotel/${encodeURIComponent(city)}`
    },
    body: payload
  });

  if (res.statusCode !== 200 || !res.json?.success) {
    throw new Error(
      `Failed to search hotels (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return {
    hotels: res.json.data?.hotels || [],
    pagination: res.json.data?.pagination || {
      page,
      totalPages: 0,
      totalItems: 0
    }
  };
}

/**
 * 5. Get Hotel Detail
 * Endpoint: POST /hotel/api/bff/hotel/detail
 *
 * @param {Object} params
 * @param {string} params.hotelId - Hotel slug / identifier
 * @param {string} [params.checkIn] - Check-in date (YYYY-MM-DD)
 * @param {string} [params.checkOut] - Check-out date (YYYY-MM-DD)
 * @param {number} [params.adults=2] - Number of adults
 * @param {number} [params.children=0] - Number of children
 * @param {number} [params.rooms=1] - Number of rooms
 * @param {string} [params.strategy="fast"] - Loading strategy
 */
export async function getHotelDetail(params) {
  if (!params || !params.hotelId) {
    throw new Error("Parameter 'hotelId' is required");
  }

  const defaults = getDefaultDates();
  const hotelId = params.hotelId;
  const checkIn = params.checkIn || defaults.checkIn;
  const checkOut = params.checkOut || defaults.checkOut;
  const adults = Number(params.adults) || 2;
  const children = Number(params.children) || 0;
  const rooms = Number(params.rooms) || 1;
  const strategy = params.strategy || "fast";

  const url = `${BASE_URL}/hotel/api/bff/hotel/detail`;
  const payload = {
    hotel_id: hotelId,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    childs: children,
    rooms,
    strategy
  };

  const res = await curlRequest({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${BASE_URL}/hotel`
    },
    body: payload
  });

  if (res.statusCode !== 200 || !res.json?.success) {
    throw new Error(
      `Failed to get hotel detail (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json.data;
}

/**
 * 6. Get Hotel Rooms and Room Packages
 * Endpoint: POST /hotel/api/bff/hotel/rooms
 *
 * @param {Object} params
 * @param {string} params.hotelId - Hotel slug / identifier
 * @param {string} [params.checkIn] - Check-in date (YYYY-MM-DD)
 * @param {string} [params.checkOut] - Check-out date (YYYY-MM-DD)
 * @param {number} [params.adults=2] - Number of adults
 * @param {number} [params.children=0] - Number of children
 * @param {number} [params.rooms=1] - Number of rooms
 * @param {string} [params.strategy="full"] - "full" returns packages; "fast" returns preview
 */
export async function getHotelRooms(params) {
  if (!params || !params.hotelId) {
    throw new Error("Parameter 'hotelId' is required");
  }

  const defaults = getDefaultDates();
  const hotelId = params.hotelId;
  const checkIn = params.checkIn || defaults.checkIn;
  const checkOut = params.checkOut || defaults.checkOut;
  const adults = Number(params.adults) || 2;
  const children = Number(params.children) || 0;
  const rooms = Number(params.rooms) || 1;
  const strategy = params.strategy || "full";

  const url = `${BASE_URL}/hotel/api/bff/hotel/rooms`;
  const payload = {
    hotel_id: hotelId,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    childs: children,
    rooms,
    strategy
  };

  const res = await curlRequest({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${BASE_URL}/hotel`
    },
    body: payload
  });

  if (res.statusCode !== 200 || !res.json?.success) {
    throw new Error(
      `Failed to get hotel rooms (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json.data;
}

/**
 * 7. Get Cheapest Prices for multiple hotels
 * Endpoint: POST /hotel/api/bff/hotel/cheapest-prices
 *
 * @param {Object} params
 * @param {string[]} params.hotelIds - Array of hotel slugs
 * @param {string} [params.checkIn] - Check-in date
 * @param {string} [params.checkOut] - Check-out date
 * @param {number} [params.adults=2]
 * @param {number} [params.children=0]
 * @param {number} [params.rooms=1]
 */
export async function getCheapestPrices(params) {
  if (!params || !Array.isArray(params.hotelIds) || params.hotelIds.length === 0) {
    throw new Error("Parameter 'hotelIds' must be a non-empty array");
  }

  const defaults = getDefaultDates();
  const checkIn = params.checkIn || defaults.checkIn;
  const checkOut = params.checkOut || defaults.checkOut;
  const adults = Number(params.adults) || 2;
  const children = Number(params.children) || 0;
  const rooms = Number(params.rooms) || 1;

  const url = `${BASE_URL}/hotel/api/bff/hotel/cheapest-prices`;
  const payload = {
    hotel_ids: params.hotelIds,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    children,
    rooms
  };

  const res = await curlRequest({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${BASE_URL}/hotel`
    },
    body: payload
  });

  if (res.statusCode !== 200 || !res.json?.success) {
    throw new Error(
      `Failed to get cheapest prices (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  return res.json.data?.hotels || [];
}

/**
 * 8. Get Pulsa / PPOB Products for a phone prefix
 * Endpoints:
 *  - GET /pulsa/ewallet/getCsrf
 *  - POST /pulsa/index.php/home/ambil_logo
 *
 * @param {string} phoneOrPrefix - e.g. "0812", "0878", "812", "0896..."
 */
export async function getPulsaProducts(phoneOrPrefix) {
  if (!phoneOrPrefix) {
    throw new Error("Phone number or prefix is required (e.g. '0812' or '0878')");
  }

  // Normalize prefix: if begins with 0, take next 3 digits (e.g. 0812 -> 812); if begins with 62, take 812; if already 812, keep it
  let clean = String(phoneOrPrefix).replace(/[^0-9]/g, "");
  let prefix = "";
  if (clean.startsWith("62")) {
    prefix = clean.slice(2, 5);
  } else if (clean.startsWith("0")) {
    prefix = clean.slice(1, 4);
  } else {
    prefix = clean.slice(0, 3);
  }

  const cookieJar = createTempCookieJar();

  try {
    // 1. Get CSRF and CI session
    const csrfRes = await curlRequest({
      url: `${BASE_URL}/pulsa/ewallet/getCsrf`,
      cookieJar,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE_URL}/pulsa/`
      }
    });

    const csrfToken = csrfRes.json?.csrf;
    if (!csrfToken) {
      throw new Error(
        `Failed to retrieve CSRF token: ${csrfRes.body.slice(0, 100)}`
      );
    }

    // 2. Fetch operator details & product list
    const logoRes = await curlRequest({
      url: `${BASE_URL}/pulsa/index.php/home/ambil_logo`,
      method: "POST",
      cookieJar,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE_URL}/pulsa/`
      },
      body: `no_depan=${encodeURIComponent(prefix)}&hm_csrf_hash_name=${encodeURIComponent(csrfToken)}`
    });

    if (logoRes.statusCode !== 200 || !logoRes.json?.data) {
      throw new Error(
        `Failed to retrieve pulsa products for prefix '${prefix}' (status ${logoRes.statusCode}): ${logoRes.body.slice(0, 120)}`
      );
    }

    const data = logoRes.json.data;
    return {
      prefix,
      operator: data.nama,
      logoUrl: data.gambar
        ? `https://img.hotelmurah.com/m-assets/img/operator/${data.gambar}`
        : null,
      products: (data.daftar_product || []).map((p) => ({
        id: p.id,
        productId: p.product_id,
        name: p.nama_product,
        price: Number(p.harga_jual) || 0,
        originalPrice: Number(p.harga_mahal) || 0,
        isPromo: p.label === "Promo" || Boolean(p.harga_mahal && Number(p.harga_mahal) > Number(p.harga_jual)),
        label: p.label || null,
        isAvailable: p.enable === "1"
      }))
    };
  } finally {
    removeCookieJar(cookieJar);
  }
}

/**
 * 9. Get Active Promos
 * Endpoint: GET /promo/listpromo
 */
export async function getPromos() {
  const url = `${BASE_URL}/promo/listpromo`;
  const res = await curlRequest({
    url,
    headers: {
      Referer: BASE_URL
    }
  });

  if (res.statusCode !== 200 || !res.body) {
    throw new Error(
      `Failed to fetch promos (status ${res.statusCode}): ${res.body.slice(0, 150)}`
    );
  }

  const html = res.body;
  const cards = html.split('<div class="panel panel-default card">').slice(1);
  const promos = [];

  for (const card of cards) {
    const endIdx = card.indexOf("</div>\n                    </div>\n                </div>");
    const block = endIdx !== -1 ? card.slice(0, endIdx) : card;

    const imgMatch = block.match(/<img[^>]+src=["']([^"']+)["']/i);
    const titleMatch = block.match(
      /<h2[^>]*class=["']post-title["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    );
    const linkMatch = block.match(
      /<h2[^>]*class=["']post-title["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i
    );
    const periodMatch = block.match(
      /Masa Berlaku<\/div>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i
    );

    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : null;
    const image = imgMatch ? imgMatch[1].trim() : null;
    const link = linkMatch && linkMatch[1] !== "#" ? linkMatch[1].trim() : null;
    const period = periodMatch
      ? periodMatch[1].trim().replace(/\s+/g, " ")
      : null;

    if (title || image) {
      promos.push({
        title,
        image,
        link,
        period
      });
    }
  }

  return promos;
}
