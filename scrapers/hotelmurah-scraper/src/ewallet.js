import {
  curlRequest,
  createTempCookieJar,
  removeCookieJar
} from "./transport.js";

const BASE_URL = "https://www.hotelmurah.com";
const CSRF_NAME = "hm_csrf_hash_name";

/**
 * type_produk codes used by the legacy CodeIgniter PPOB backend.
 */
export const EWALLET_TYPES = {
  dana: 11,
  gopay: 12,
  ovo: 10,
  shopeepay: 9,
  linkaja: 13
};

const XHR_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${BASE_URL}/pulsa/`
};

const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  ...XHR_HEADERS
};

function normalizeWallet(wallet) {
  const key = String(wallet || "").toLowerCase().trim();
  if (!(key in EWALLET_TYPES)) {
    throw new Error(
      `Unknown e-wallet '${wallet}'. Supported: ${Object.keys(EWALLET_TYPES).join(", ")}`
    );
  }
  return key;
}

function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length > 11) {
    digits = digits.slice(2);
  }
  if (!digits.startsWith("0") && digits.startsWith("8")) {
    digits = "0" + digits;
  }
  if (!/^0?8\d{8,12}$/.test(digits)) {
    throw new Error(`Invalid phone number '${phone}' (expected Indonesian mobile, e.g. 081234567890)`);
  }
  // Canonical local format WITH leading 0 — exactly what the site's JS sends as cust_number
  return digits.startsWith("0") ? digits : "0" + digits;
}

/**
 * Parsing helpers for the detailOrder HTML page (step 2).
 */
function parseDetailOrder(html) {
  const nameMatch = html.match(/<span class="span-kiri">([^<]+)<\/span>/);
  const totalMatch = html.match(/id="total_harga">([^<]+)</);
  const productName = nameMatch ? nameMatch[1].trim() : null;
  const totalText = totalMatch ? totalMatch[1].trim() : null;
  const total = parseInt((totalText || "").replace(/[^0-9]/g, ""), 10) || 0;

  const channels = [];
  const channelRegex =
    /onclick="pilihanPayment\(([^)]+)\)"[\s\S]*?<span class="container2">([^<]+)/g;
  let match;
  while ((match = channelRegex.exec(html)) !== null) {
    const args = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    if (args[0] === "e") continue; // function signature, not a real channel

    const idPay = args[0];
    const paymentPay = args[2];
    const typePembayaran = args[3];
    const provider = args[4];
    const flatFee = Number.parseFloat(args[5]) || 0;
    const rate = Number.parseFloat(args[6]) || 1.0;

    const rawLabel = match[2].trim().replace(/\s+/g, " ");
    let label = rawLabel;
    if (paymentPay === "gopay" && /QRIS/i.test(rawLabel)) {
      label = "QRIS";
    }

    let estimatedTotal = total;
    let feeLabel = "";
    if (rate > 1.0) {
      estimatedTotal = Math.ceil(total * rate);
      feeLabel = `+${((rate - 1.0) * 100).toFixed(2)}%`;
    } else if (flatFee > 0) {
      estimatedTotal = total + flatFee;
      feeLabel = `+Rp ${Math.round(flatFee).toLocaleString("id-ID")}`;
    }

    channels.push({
      label,
      rawLabel,
      idPay,
      paymentPay,
      typePembayaran,
      provider,
      fee: rate > 1.0
        ? { kind: "percent", value: Number((rate - 1.0).toFixed(4)) }
        : { kind: "flat", value: flatFee },
      feeLabel,
      estimatedTotal
    });
  }

  return { productName, total, channels };
}

/**
 * Stateless session for the legacy PPOB e-wallet checkout flow.
 *
 * Flow (mirrors the site's own JS):
 *   1. getCatalog(wallet)                  -> POST /pulsa/index.php/ewallet/getProductEwallet
 *   2. getPaymentOptions(wallet, phone, id) -> POST isOrderValidated + POST /pulsa/Ewallet/detailOrder
 *   3. submitOrder({ ..., channel })        -> POST /pulsa/ewallet/submitorder  (creates a REAL pending order)
 *
 * @example
 *   const s = new EwalletSession();
 *   try {
 *     const catalog = await s.getCatalog("dana");
 *     const quote   = await s.getPaymentOptions("dana", "081234567890", catalog.products[4].id);
 *     const order   = await s.submitOrder({ wallet: "dana", phone: "081234567890",
 *                                            productId: catalog.products[4].id, channel: "QRIS" });
 *   } finally {
 *     s.close();
 *   }
 */
export class EwalletSession {
  #lastToken = null;
  #lastPhone = null;
  #lastCsrf = null;

  constructor() {
    this.jar = createTempCookieJar();
    this.csrf = null;
  }

  /**
   * Refresh CSRF token + CI session.
   */
  async #refreshCsrf() {
    const res = await curlRequest({
      url: `${BASE_URL}/pulsa/ewallet/getCsrf`,
      cookieJar: this.jar,
      headers: XHR_HEADERS
    });
    const token = res.json?.csrf;
    if (res.statusCode !== 200 || !token) {
      throw new Error(
        `Failed to retrieve CSRF token (status ${res.statusCode}): ${res.body.slice(0, 120)}`
      );
    }
    this.csrf = token;
    return token;
  }

  /**
   * STEP 1 — Catalog of top-up denominations for a given e-wallet.
   * @param {string} wallet dana|gopay|ovo|shopeepay|linkaja
   */
  async getCatalog(wallet) {
    const key = normalizeWallet(wallet);
    const tipe = EWALLET_TYPES[key];
    if (!this.csrf) await this.#refreshCsrf();

    const res = await curlRequest({
      url: `${BASE_URL}/pulsa/index.php/ewallet/getProductEwallet`,
      method: "POST",
      cookieJar: this.jar,
      headers: FORM_HEADERS,
      body: `tipe_produk=${tipe}&${CSRF_NAME}=${encodeURIComponent(this.csrf)}`
    });

    if (res.statusCode !== 200 || !res.json?.data?.daftar_product) {
      throw new Error(
        `Failed to fetch ${key} catalog (status ${res.statusCode}): ${res.body.slice(0, 150)}`
      );
    }

    const products = res.json.data.daftar_product.map((p) => ({
      id: String(p.id),
      name: p.nama_produk,
      price: Number(p.harga_jual) || 0,
      adminFee: Number(p.harga_admin) || 0,
      isAvailable: p.enable === "1"
    }));

    return {
      wallet: key,
      typeProduk: String(tipe),
      products,
      activeCount: products.filter((p) => p.isAvailable).length
    };
  }

  /**
   * Validate phone + product, returns the encrypted order token (used by step 2 & 3).
   * Retries once on transient server rejection (the legacy endpoint is
   * rate-sensitive when hit concurrently).
   */
  async #validateOrder(wallet, phone, productId, attempt = 1) {
    const key = normalizeWallet(wallet);
    const digits = normalizePhone(phone);
    const tipe = EWALLET_TYPES[key];
    if (!this.csrf) await this.#refreshCsrf();

    const res = await curlRequest({
      url: `${BASE_URL}/pulsa/index.php/ewallet/isOrderValidated`,
      method: "POST",
      cookieJar: this.jar,
      headers: FORM_HEADERS,
      body:
        `cust_number=${digits}&id=${encodeURIComponent(productId)}` +
        `&tipe_produk=${tipe}&web=web&${CSRF_NAME}=${encodeURIComponent(this.csrf)}`
    });

    if (res.statusCode !== 200 || res.json?.status !== "1" || !res.json?.data) {
      const serverMsg =
        res.json?.data && res.json?.status !== "1"
          ? String(res.json.data)
          : res.body.slice(0, 150);
      // Transient concurrency rejection -> refresh CSRF + retry once
      if (attempt < 2 && res.json?.status === "888") {
        await new Promise((r) => setTimeout(r, 1500));
        this.csrf = null;
        return this.#validateOrder(wallet, phone, productId, attempt + 1);
      }
      throw new Error(
        `Order validation failed (HTTP ${res.statusCode}, server status ${res.json?.status ?? "?"}): ${serverMsg || "(no message)"}`
      );
    }

    this.csrf = res.json.csrf || this.csrf;
    return { digits, token: res.json.data, csrf: this.csrf };
  }

  /**
   * STEP 2 — Payment channel options with fees (simulation, no order created).
   * @param {string} wallet
   * @param {string} phone
   * @param {string|number} productId product id from getCatalog
   */
  async getPaymentOptions(wallet, phone, productId) {
    const { digits, token, csrf } = await this.#validateOrder(wallet, phone, productId);

    const res = await curlRequest({
      url: `${BASE_URL}/pulsa/Ewallet/detailOrder`,
      method: "POST",
      cookieJar: this.jar,
      headers: FORM_HEADERS,
      body: `data=${encodeURIComponent(token)}&${CSRF_NAME}=${encodeURIComponent(csrf)}`
    });

    if (res.statusCode !== 200 || !res.body?.includes("pilihanPayment")) {
      throw new Error(
        `Failed to fetch payment options (status ${res.statusCode}): ${res.body.slice(0, 150)}`
      );
    }

    const parsed = parseDetailOrder(res.body);
    this.#lastToken = token;
    this.#lastPhone = digits;
    this.#lastCsrf = csrf;

    return {
      wallet: normalizeWallet(wallet),
      phone: digits,
      productId: String(productId),
      productName: parsed.productName,
      subtotal: parsed.total,
      channels: parsed.channels
    };
  }

  /**
   * STEP 3 — Place the order (REAL pending order, payment is NOT charged yet).
   * Returns order id, status URL, and payment instruction (QR image / VA / checkout link).
   *
   * @param {Object} opts
   * @param {string} opts.wallet
   * @param {string} opts.phone       recipient phone (dompet tujuan)
   * @param {string|number} opts.productId
   * @param {string} opts.channel     channel label from getPaymentOptions (e.g. "QRIS", "GoPay", "Bank BCA (QR)")
   * @param {string} [opts.payerPhone] phone of the wallet used to PAY (required for OVO / blu BCA direct)
   */
  async submitOrder({ wallet, phone, productId, channel, payerPhone = "" }) {
    const key = normalizeWallet(wallet);
    const digits = normalizePhone(phone);
    if (!this.#lastToken || this.#lastPhone !== digits) {
      const v = await this.#validateOrder(wallet, phone, productId);
      this.#lastToken = v.token;
      this.#lastPhone = v.digits;
      this.#lastCsrf = v.csrf;
    }
    const token = this.#lastToken;
    const csrf = this.#lastCsrf;

    // Resolve channel (reuse cached detailOrder state when phone/product match)
    let options;
    try {
      options = await this.getPaymentOptions(wallet, phone, productId);
    } catch (err) {
      throw new Error(`Channel resolution failed: ${err.message}`);
    }

    const wanted = String(channel || "").trim();
    const found = options.channels.find(
      (c) =>
        c.label.toLowerCase() === wanted.toLowerCase() ||
        c.paymentPay.toLowerCase() === wanted.toLowerCase() ||
        c.rawLabel.toLowerCase().includes(wanted.toLowerCase())
    );
    if (!found) {
      throw new Error(
        `Channel '${channel}' not found. Available: ${options.channels.map((c) => c.label).join(", ")}`
      );
    }

    const body =
      `stats=&voucher_kode=&data=${encodeURIComponent(token)}` +
      `&payment_type=100&id_pay=${found.idPay}&payment_pay=${encodeURIComponent(found.paymentPay)}` +
      `&no_ovo=${encodeURIComponent(payerPhone ? normalizePhone(payerPhone) : "")}` +
      `&type_pembayaran=${encodeURIComponent(found.typePembayaran)}` +
      `&source=&validasiTelkomsel=&nomer_combo=&email_esim=&no_hp_esim=&versipg=1` +
      `&${CSRF_NAME}=${encodeURIComponent(csrf)}`;

    const res = await curlRequest({
      url: `${BASE_URL}/pulsa/ewallet/submitorder`,
      method: "POST",
      cookieJar: this.jar,
      headers: FORM_HEADERS,
      body
    });

    if (res.statusCode === 403) {
      throw new Error(
        "submitorder blocked (HTTP 403): site demanded a Turnstile human check for this attempt"
      );
    }
    if (res.statusCode !== 200 || !res.json?.id_order) {
      throw new Error(
        `submitorder failed (status ${res.statusCode}): ${res.body.slice(0, 200)}`
      );
    }

    const raw = res.json;
    let tokenPayment = null;
    if (raw.tokenPayment) {
      try {
        tokenPayment = JSON.parse(raw.tokenPayment);
      } catch {
        tokenPayment = raw.tokenPayment;
      }
    }

    const out = {
      orderId: String(raw.id_order),
      idUser: raw.id_user,
      statusUrl: raw.urlSnap,
      viaBank: raw.viaBank,
      expiryTime: tokenPayment?.expiry_time || null,
      channel: found.label,
      productName: options.productName,
      phone: digits,
      payment: null
    };

    const tp = tokenPayment || {};
    if (typeof tp.qrBase === "string" && tp.qrBase.startsWith("data:image")) {
      out.payment = { kind: "qr", qrDataUrl: tp.qrBase, qrBase64: tp.qrBase.split(",")[1] || null };
    }
    if (typeof tp.checkout_url === "string" && tp.checkout_url) {
      out.payment = { kind: "checkout_url", url: tp.checkout_url };
    }
    if (
      tp.virtualAccount || tp.virtual_account ||
      (tp.accountNumber) || (tp.va_number) ||
      (Array.isArray(tp.actions) && tp.actions.length > 0 && tp.channel_code && !tp.qrBase && !tp.checkout_url)
    ) {
      out.payment = out.payment || { kind: "virtual_account" };
      out.payment.data = tokenPayment;
    }
    if (!out.payment) {
      out.payment = { kind: "raw", data: tokenPayment };
    }

    return out;
  }

  /**
   * Poll order status using THIS session's cookies (the status page
   * redirects to /member/last_order for anonymous visitors).
   * @param {string|number} orderId   from this.submitOrder().orderId
   * @param {string} idUser           from this.submitOrder().idUser
   */
  async checkOrder(orderId, idUser) {
    if (!this.jar) {
      throw new Error("Session is closed — call checkOrder before close()");
    }
    const url = `${BASE_URL}/pulsa/pln/pln_trx/${encodeURIComponent(orderId)}/${encodeURIComponent(idUser)}`;
    const res = await curlRequest({ url, cookieJar: this.jar, headers: FORM_HEADERS });
    return parseOrderStatus(url, res);
  }

  close() {
    removeCookieJar(this.jar);
    this.jar = null;
    this.csrf = null;
    this.#lastToken = null;
  }
}

/**
 * Look up a product id by nominal (price in rupiah) from a catalog.
 */
export function findProductByNominal(catalog, nominal) {
  const target = Number(nominal);
  const exact = catalog.products.find((p) => p.price === target);
  if (exact) return exact;
  // closest available denomination at or below target, else closest above
  const below = catalog.products
    .filter((p) => p.isAvailable && p.price <= target)
    .sort((a, b) => b.price - a.price)[0];
  if (below) return below;
  const above = catalog.products
    .filter((p) => p.isAvailable && p.price >= target)
    .sort((a, b) => a.price - b.price)[0];
  if (!above) {
    throw new Error(`No product matches nominal ${nominal} in ${catalog.wallet} catalog`);
  }
  return above;
}

const STATUS_MAP = [
  [/MENUNGGU|PENDING|PROSES/i, "PENDING"],
  [/BERHASIL|SUKSES|SUCCESS/i, "SUCCESS"],
  [/GAGAL|BATAL|CANCEL|FAILED/i, "FAILED"],
  [/EXPIRED|LUPUT|KADALUARSA/i, "EXPIRED"]
];

function parseOrderStatus(url, res) {
  if (res.statusCode !== 200 || !res.body) {
    throw new Error(`Failed to fetch order status (status ${res.statusCode})`);
  }

  // Guest orders always hit the member login wall (redirect to /member/last_order)
  const requiresLogin = /member\/last_order|login|masuk|sign.?in/i.test(res.body)
    && !/id="status-transaksi"/i.test(res.body);

  const m = res.body.match(/id="status-transaksi"[^>]*>\s*([^<]+?)\s*</i);
  const rawStatus = m ? m[1].trim() : null;
  const normalized = rawStatus
    ? STATUS_MAP.find(([re]) => re.test(rawStatus))?.[1] || rawStatus
    : null;

  return {
    statusUrl: url,
    requiresLogin,
    rawStatus,
    status: rawStatus ? normalized : (requiresLogin ? "REQUIRES_LOGIN" : "UNKNOWN"),
    isFinal: normalized === "SUCCESS" || normalized === "FAILED" || normalized === "EXPIRED"
  };
}

/**
 * Poll the status of a previously created order.
 * NOTE: the status page redirects to /member/last_order for anonymous
 * visitors, so a stateless call usually can't see the status. Prefer
 * `session.checkOrder(orderId, idUser)` (same cookies as submitOrder).
 * @param {string|number} orderId  from submitOrder().orderId
 * @param {string} idUser          from submitOrder().idUser
 */
export async function checkOrderStatus(orderId, idUser) {
  const url = `${BASE_URL}/pulsa/pln/pln_trx/${encodeURIComponent(orderId)}/${encodeURIComponent(idUser)}`;
  const res = await curlRequest({ url, headers: { Referer: BASE_URL } });
  const out = parseOrderStatus(url, res);
  return { orderId: String(orderId), ...out };
}

/**
 * Convenience: run steps 1 -> 2 (catalog + quote) without creating an order.
 */
export async function quoteEwalletTopUp(wallet, phone, productIdOrNominal) {
  const session = new EwalletSession();
  try {
    const catalog = await session.getCatalog(wallet);
    const num = Number(productIdOrNominal);
    const looksLikeId = Number.isInteger(num) && num > 0 && String(num).length <= 3;
    const product = looksLikeId
      ? (catalog.products.find((p) => p.id === String(num)) || findProductByNominal(catalog, num))
      : findProductByNominal(catalog, num);
    const quote = await session.getPaymentOptions(wallet, phone, product.id);
    return { catalog, product, ...quote };
  } finally {
    session.close();
  }
}
