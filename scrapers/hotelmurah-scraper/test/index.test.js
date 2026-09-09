import test from "node:test";
import assert from "node:assert/strict";
import {
  getTopCities,
  suggestAccommodations,
  searchLocationLegacy,
  searchHotels,
  getHotelDetail,
  getHotelRooms,
  getCheapestPrices,
  getPulsaProducts,
  getPromos
} from "../src/index.js";
import {
  EwalletSession,
  findProductByNominal,
  checkOrderStatus
} from "../src/ewallet.js";

test("1. getTopCities - retrieves popular destination cities", async () => {
  const cities = await getTopCities();
  assert.ok(Array.isArray(cities), "Top cities must be an array");
  assert.ok(cities.length >= 5, `Expected at least 5 top cities, got ${cities.length}`);

  const first = cities[0];
  assert.ok(typeof first.city_id === "number", "city_id must be a number");
  assert.ok(typeof first.name === "string" && first.name.length > 0, "name must be non-empty string");
  assert.ok(typeof first.slug === "string" && first.slug.length > 0, "slug must be non-empty string");
  assert.ok(typeof first.accommodation_count === "number", "accommodation_count must be a number");
  assert.ok(first.location && first.location.country === "Indonesia", "Country must be Indonesia");

  const cityNames = cities.map((c) => c.name.toLowerCase());
  assert.ok(cityNames.includes("bali") || cityNames.includes("jakarta"), "Should include Bali or Jakarta");
});

test("2. suggestAccommodations - autocomplete suggestions for 'bandung'", async () => {
  const suggestions = await suggestAccommodations("bandung");
  assert.ok(Array.isArray(suggestions), "Suggestions must be an array");
  assert.ok(suggestions.length > 0, `Expected suggestions for 'bandung', got ${suggestions.length}`);

  const first = suggestions[0];
  assert.ok(typeof first.id === "string", "id must be string");
  assert.ok(typeof first.name === "string" && first.name.length > 0, "name must be non-empty string");
  assert.ok(typeof first.slug === "string", "slug must be string");
  assert.ok(typeof first.type === "string", "type must be string (region/city/hotel/etc)");
  assert.ok(first.location && typeof first.location.country === "string", "location country must exist");
});

test("3. searchLocationLegacy - PHP autocomplete endpoint for 'bali'", async () => {
  const results = await searchLocationLegacy("bali");
  assert.ok(Array.isArray(results), "Legacy search must return an array");
  assert.ok(results.length > 0, `Expected results for 'bali', got ${results.length}`);

  const first = results[0];
  assert.ok(typeof first.category === "string", "category must be string");
  assert.ok(typeof first.label === "string", "label must be string");
  assert.ok(typeof first.keysearch === "string", "keysearch must be string");
  assert.ok(typeof first.id === "string", "id must be string");
});

test("4. searchHotels - hotel search listing in Jakarta", async () => {
  const result = await searchHotels({
    city: "jakarta",
    limit: 10,
    page: 1,
    sort: "popular"
  });

  assert.ok(result && typeof result === "object", "Result must be an object");
  assert.ok(Array.isArray(result.hotels), "hotels must be an array");
  assert.ok(result.hotels.length > 0, `Expected hotels in Jakarta, got ${result.hotels.length}`);

  const hotel = result.hotels[0];
  assert.ok(typeof hotel.idHotel === "string", "idHotel must be string");
  assert.ok(typeof hotel.name === "string" && hotel.name.length > 0, "name must be non-empty string");
  assert.ok(typeof hotel.originalPrice === "number" && hotel.originalPrice > 0, "originalPrice must be > 0");
  assert.ok(typeof hotel.address === "string", "address must be string");
  assert.ok(Array.isArray(hotel.images) && hotel.images.length > 0, "hotel images must be non-empty array");
  assert.ok(typeof hotel.star === "number", "hotel star must be a number");
  assert.ok(hotel.location && typeof hotel.location.lat === "number", "location.lat must be number");

  const pagination = result.pagination;
  assert.ok(pagination.page === 1, "pagination page must be 1");
  assert.ok(pagination.totalPages >= 1, "pagination totalPages must be >= 1");
  assert.ok(pagination.totalItems >= 1, "pagination totalItems must be >= 1");
});

test("5. getHotelDetail - full hotel metadata and policies", async () => {
  const detail = await getHotelDetail({
    hotelId: "swiss-belresidence-and-hotel-kalibata-203-828"
  });

  assert.ok(detail && typeof detail === "object", "Detail must be an object");
  assert.equal(detail.id, 1892, "Hotel id must be 1892");
  assert.ok(detail.name.includes("Swiss-Belresidences"), `Unexpected name: ${detail.name}`);
  assert.ok(Array.isArray(detail.images) && detail.images.length >= 10, "Should have >= 10 images");
  assert.ok(Array.isArray(detail.popularFacilities) && detail.popularFacilities.length > 0, "Should have popular facilities");
  assert.ok(Array.isArray(detail.otherFacilities) && detail.otherFacilities.length > 0, "Should have categorized facilities");
  assert.ok(detail.policies && typeof detail.policies.checkIn === "string", "policies.checkIn must exist");
  assert.ok(typeof detail.about === "string" && detail.about.length > 50, "about description must be non-empty HTML string");
  assert.ok(Array.isArray(detail.reviewPreview) && detail.reviewPreview.length > 0, "Should have customer reviews");
});

test("6. getHotelRooms - room packages with live pricing and bed types", async () => {
  const roomData = await getHotelRooms({
    hotelId: "swiss-belresidence-and-hotel-kalibata-203-828",
    strategy: "full"
  });

  assert.ok(roomData && typeof roomData === "object", "Room data must be an object");
  assert.ok(roomData.isAvailable === true, "Hotel should be available");
  assert.ok(typeof roomData.lowestPrice === "number" && roomData.lowestPrice > 0, "lowestPrice must be > 0");
  assert.ok(Array.isArray(roomData.rooms) && roomData.rooms.length > 0, "rooms must be non-empty array");

  const firstRoom = roomData.rooms[0];
  assert.ok(typeof firstRoom.idRoom === "string", "idRoom must be string");
  assert.ok(typeof firstRoom.name === "string", "Room name must be string");
  assert.ok(Array.isArray(firstRoom.roomPackage) && firstRoom.roomPackage.length > 0, "roomPackage must be non-empty array");

  const firstPkg = firstRoom.roomPackage[0];
  assert.ok(typeof firstPkg.roomCode === "string", "roomCode must be string");
  assert.ok(typeof firstPkg.originalPrice === "number" && firstPkg.originalPrice > 0, "package price must be > 0");
  assert.ok(firstPkg.facilitiesInfo && typeof firstPkg.facilitiesInfo.bed === "string", "bed info must exist");
});

test("7. getCheapestPrices - batch price inquiry for multiple hotels", async () => {
  const hotelIds = [
    "swiss-belresidence-and-hotel-kalibata-203-828",
    "favehotel-pluit-junction-203-503"
  ];

  const prices = await getCheapestPrices({ hotelIds });
  assert.ok(Array.isArray(prices), "Prices must be an array");
  assert.equal(prices.length, 2, "Should return price records for 2 hotels");

  const [p1, p2] = prices;
  assert.ok(hotelIds.includes(p1.hotelId), "hotelId must match requested ID");
  assert.ok(hotelIds.includes(p2.hotelId), "hotelId must match requested ID");
  assert.ok(typeof p1.originalPrice === "number" && p1.originalPrice > 0, "p1 price must be > 0");
  assert.ok(typeof p2.originalPrice === "number" && p2.originalPrice > 0, "p2 price must be > 0");
  assert.ok(typeof p1.isAvailable === "boolean", "isAvailable must be boolean");
});

test("8. getPulsaProducts - retrieve telco operator and denom catalog (0812 / Telkomsel)", async () => {
  const result = await getPulsaProducts("0812");
  assert.ok(result && typeof result === "object", "Result must be an object");
  assert.equal(result.prefix, "812", "Prefix must be normalized to 812");
  assert.equal(result.operator, "Telkomsel", "Operator must be Telkomsel");
  assert.ok(typeof result.logoUrl === "string" && result.logoUrl.startsWith("http"), "logoUrl must be valid URL");
  assert.ok(Array.isArray(result.products) && result.products.length >= 5, "products must have >= 5 items");

  const first = result.products[0];
  assert.ok(typeof first.name === "string" && first.name.includes("Telkomsel"), "Product name must contain Telkomsel");
  assert.ok(typeof first.price === "number" && first.price > 0, "price must be positive number");
  assert.ok(typeof first.isAvailable === "boolean", "isAvailable must be boolean");
});

test("9. getPromos - parse active promotional banners and validity", async () => {
  const promos = await getPromos();
  assert.ok(Array.isArray(promos), "Promos must be an array");
  assert.ok(promos.length >= 3, `Expected at least 3 promos, got ${promos.length}`);

  const first = promos[0];
  assert.ok(typeof first.title === "string" && first.title.length > 0, "Promo title must be non-empty");
  assert.ok(typeof first.image === "string" && first.image.startsWith("http"), "Promo image must be HTTP URL");
  assert.ok(typeof first.period === "string" && first.period.length > 0, "Promo period must be non-empty string");
});

test("10. ewallet getCatalog - DANA top-up denominations with prices", async () => {
  const session = new EwalletSession();
  try {
    const catalog = await session.getCatalog("dana");
    assert.equal(catalog.wallet, "dana", "wallet must be normalized");
    assert.equal(catalog.typeProduk, "11", "DANA type_produk must be 11");
    assert.ok(Array.isArray(catalog.products) && catalog.products.length >= 10, `Expected >= 10 denominations, got ${catalog.products.length}`);

    const p = catalog.products[0];
    assert.ok(typeof p.id === "string" && p.id.length > 0, "product id must be non-empty string");
    assert.ok(p.name.startsWith("DANA "), `product name must start with DANA, got '${p.name}'`);
    assert.ok(typeof p.price === "number" && p.price >= 1000, "price must be >= 1000 rupiah");
    assert.equal(p.adminFee, 1000, "DANA admin fee is 1000 rupiah");
    assert.ok(typeof p.isAvailable === "boolean", "isAvailable must be boolean");

    // Nominal finder
    const found = findProductByNominal(catalog, 50000);
    assert.equal(found.name, "DANA 50.000", "findProductByNominal(50000) must resolve DANA 50.000");
    assert.ok(found.isAvailable, "DANA 50.000 must be available");
  } finally {
    session.close();
  }
});

test("11. ewallet getPaymentOptions - channels & fee simulation (no order created)", async () => {
  const session = new EwalletSession();
  try {
    const catalog = await session.getCatalog("dana");
    const product = findProductByNominal(catalog, 10000);

    const quote = await session.getPaymentOptions("dana", "082112345678", product.id);
    assert.equal(quote.wallet, "dana", "wallet must be dana");
    assert.equal(quote.phone, "082112345678", "phone must keep canonical leading-0 format (cust_number)");
    assert.equal(quote.productName, "DANA 10.000", "productName must match product");
    assert.ok(quote.subtotal >= 11000, `subtotal must include product+admin, got ${quote.subtotal}`);
    assert.ok(Array.isArray(quote.channels) && quote.channels.length >= 5, `Expected >= 5 channels, got ${quote.channels.length}`);

    const qris = quote.channels.find((c) => c.label === "QRIS");
    assert.ok(qris, "QRIS channel must exist");
    assert.equal(qris.fee.kind, "percent", "QRIS fee must be percent-based");
    assert.ok(qris.fee.value > 0.02 && qris.fee.value < 0.05, `QRIS fee ~3%, got ${(qris.fee.value * 100).toFixed(2)}%`);
    assert.ok(qris.estimatedTotal > quote.subtotal, "QRIS total must exceed subtotal (gateway fee)");
    assert.ok(typeof qris.idPay === "string", "idPay must be present for checkout");

    const gopay = quote.channels.find((c) => c.paymentPay === "gopay" && c.typePembayaran === "m11");
    assert.ok(gopay, "GoPay channel must exist");
    assert.ok(gopay.feeLabel.startsWith("+"), "GoPay feeLabel must be a surcharge");
  } finally {
    session.close();
  }
});

test("12. ewallet submitOrder + checkOrderStatus - REAL order lifecycle (QRIS, smallest denom)", { skip: process.env.HM_REAL_ORDER !== "1" ? "creates a REAL order — run with HM_REAL_ORDER=1" : false }, async () => {
  const session = new EwalletSession();
  let order = null;
  try {
    const catalog = await session.getCatalog("dana");
    const product = findProductByNominal(catalog, 1000);

    const options = await session.getPaymentOptions("dana", "082112345678", product.id);
    const qris = options.channels.find((c) => c.label === "QRIS");
    assert.ok(qris, "QRIS channel must exist for submit");

    order = await session.submitOrder({
      wallet: "dana",
      phone: "082112345678",
      productId: product.id,
      channel: "QRIS"
    });

    assert.ok(order.orderId && order.orderId.length >= 8, `orderId must be a real id, got '${order.orderId}'`);
    assert.ok(order.statusUrl.includes(order.orderId), "statusUrl must contain orderId");
    assert.ok(order.expiryTime, "QRIS payment must have an expiryTime");
    assert.equal(order.payment.kind, "qr", "QRIS submit must return a qr payment object");
    assert.ok(order.payment.qrDataUrl && order.payment.qrDataUrl.startsWith("data:image/png;base64,"), "qr must be an embedded png data-url");
    assert.ok(order.payment.qrDataUrl.length > 10000, "qr payload must be a real image, not a stub");

    // Status page: guest orders are behind the member login wall, so a
    // stateless/sessionless poll returns REQUIRES_LOGIN (not a crash).
    // The important thing: the query succeeds and reports the wall honestly.
    const status = await session.checkOrder(order.orderId, order.idUser);
    assert.ok(status.statusUrl.includes(order.orderId), "statusUrl must contain orderId");
    assert.ok(typeof status.requiresLogin === "boolean", "requiresLogin must be a boolean");
    assert.ok(
      status.status === "PENDING" || status.status === "REQUIRES_LOGIN",
      `fresh guest order status should be PENDING or REQUIRES_LOGIN, got ${status.status}`
    );
    if (status.status === "PENDING") {
      assert.equal(status.isFinal, false, "pending order is not final");
    }
  } finally {
    session.close();
    if (order) {
      console.log(`  [info] QRIS order ${order.orderId} left PENDING (unpaid, will auto-expire)`);
    }
  }
});
