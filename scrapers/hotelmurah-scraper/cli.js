#!/usr/bin/env node

import {
  getTopCities,
  suggestAccommodations,
  searchLocationLegacy,
  searchHotels,
  getHotelDetail,
  getHotelRooms,
  getCheapestPrices,
  getPulsaProducts,
  getPromos,
  EwalletSession,
  findProductByNominal,
  quoteEwalletTopUp,
  checkOrderStatus
} from "./src/index.js";

function printResult({ command, url, ok, data, error = null }) {
  const envelope = {
    source: "hotelmurah.com",
    command,
    url,
    ok,
    ...(ok ? { data } : { error: error?.message || String(error) })
  };
  console.log(JSON.stringify(envelope, null, 2));
  if (!ok) {
    process.exit(1);
  }
}

function printUsage() {
  console.error(`
Usage: node cli.js <command> [arguments]

Commands:
  top-cities                                     Get popular destination cities
  suggest <query>                                Search accommodation suggestions (autocomplete)
  search-location <query>                        Legacy hotel/airport/city location search
  search-hotels <city> [checkIn] [checkOut] [adults] [page]
                                                 Search hotel listings with room prices
  hotel-detail <hotelId> [checkIn] [checkOut]    Get full details, facilities, policies of a hotel
  hotel-rooms <hotelId> [checkIn] [checkOut]     Get room packages, breakfast/refund options & prices
  cheapest-prices <hotelId1,hotelId2,...>        Batch query cheapest prices for hotel IDs
  pulsa <prefix>                                 Get operator info & pulsa denom list (e.g. 0812)
  promos                                         List active promo banners and validity periods
  ewallet-catalog <wallet>                       Step 1: top-up denominations (dana|gopay|ovo|shopeepay|linkaja)
  ewallet-quote <wallet> <phone> <nominal|id>    Step 1+2: catalog + payment channels with fee simulation (no order)
  ewallet-order <wallet> <phone> <nominal|id> <channel> [payerPhone]
                                                 Step 1+2+3: place REAL pending order (QRIS/VA/checkout link). NOT paid.
  order-status <orderId> <idUser>                Poll payment status of a created order

Examples:
  node cli.js top-cities
  node cli.js suggest "bandung"
  node cli.js search-hotels jakarta 2026-09-15 2026-09-16 2 1
  node cli.js hotel-detail swiss-belresidence-and-hotel-kalibata-203-828
  node cli.js hotel-rooms swiss-belresidence-and-hotel-kalibata-203-828
  node cli.js pulsa 0812
  node cli.js promos
  node cli.js ewallet-catalog dana
  node cli.js ewallet-quote dana 081234567890 50000
  node cli.js ewallet-order dana 081234567890 50000 "QRIS"
  node cli.js order-status 101300606 0812345678901788885494
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
      case "top-cities": {
        const data = await getTopCities();
        printResult({
          command: "top-cities",
          url: "https://hotelmurah.com/search/v1/api/cities/top-accommodations",
          ok: true,
          data
        });
        break;
      }

      case "suggest": {
        const q = args[1];
        if (!q) {
          throw new Error("Missing query: node cli.js suggest <query>");
        }
        const data = await suggestAccommodations(q);
        printResult({
          command: `suggest ${q}`,
          url: `https://hotelmurah.com/search/v1/api/accommodations/search/suggestions?q=${encodeURIComponent(q)}`,
          ok: true,
          data
        });
        break;
      }

      case "search-location": {
        const q = args[1];
        if (!q) {
          throw new Error("Missing query: node cli.js search-location <query>");
        }
        const data = await searchLocationLegacy(q);
        printResult({
          command: `search-location ${q}`,
          url: "https://www.hotelmurah.com/home/search_hotel_location",
          ok: true,
          data
        });
        break;
      }

      case "search-hotels": {
        const city = args[1] || "jakarta";
        const checkIn = args[2];
        const checkOut = args[3];
        const adults = args[4] ? Number(args[4]) : undefined;
        const page = args[5] ? Number(args[5]) : undefined;

        const data = await searchHotels({
          city,
          checkIn,
          checkOut,
          adults,
          page
        });
        printResult({
          command: `search-hotels ${city}`,
          url: "https://www.hotelmurah.com/hotel/api/bff/search/hotels",
          ok: true,
          data
        });
        break;
      }

      case "hotel-detail": {
        const hotelId = args[1];
        if (!hotelId) {
          throw new Error("Missing hotelId: node cli.js hotel-detail <hotelId>");
        }
        const checkIn = args[2];
        const checkOut = args[3];

        const data = await getHotelDetail({
          hotelId,
          checkIn,
          checkOut
        });
        printResult({
          command: `hotel-detail ${hotelId}`,
          url: "https://www.hotelmurah.com/hotel/api/bff/hotel/detail",
          ok: true,
          data
        });
        break;
      }

      case "hotel-rooms": {
        const hotelId = args[1];
        if (!hotelId) {
          throw new Error("Missing hotelId: node cli.js hotel-rooms <hotelId>");
        }
        const checkIn = args[2];
        const checkOut = args[3];

        const data = await getHotelRooms({
          hotelId,
          checkIn,
          checkOut,
          strategy: "full"
        });
        printResult({
          command: `hotel-rooms ${hotelId}`,
          url: "https://www.hotelmurah.com/hotel/api/bff/hotel/rooms",
          ok: true,
          data
        });
        break;
      }

      case "cheapest-prices": {
        const idsArg = args[1];
        if (!idsArg) {
          throw new Error("Missing hotelIds: node cli.js cheapest-prices <id1,id2,...>");
        }
        const hotelIds = idsArg.split(",").map((s) => s.trim()).filter(Boolean);
        const data = await getCheapestPrices({ hotelIds });
        printResult({
          command: `cheapest-prices ${idsArg}`,
          url: "https://www.hotelmurah.com/hotel/api/bff/hotel/cheapest-prices",
          ok: true,
          data
        });
        break;
      }

      case "pulsa": {
        const prefix = args[1];
        if (!prefix) {
          throw new Error("Missing prefix: node cli.js pulsa <prefix>");
        }
        const data = await getPulsaProducts(prefix);
        printResult({
          command: `pulsa ${prefix}`,
          url: "https://www.hotelmurah.com/pulsa/index.php/home/ambil_logo",
          ok: true,
          data
        });
        break;
      }

      case "promos": {
        const data = await getPromos();
        printResult({
          command: "promos",
          url: "https://www.hotelmurah.com/promo/listpromo",
          ok: true,
          data
        });
        break;
      }

      case "ewallet-catalog": {
        const wallet = args[1];
        if (!wallet) {
          throw new Error("Missing wallet: node cli.js ewallet-catalog <dana|gopay|ovo|shopeepay|linkaja>");
        }
        const session = new EwalletSession();
        try {
          const data = await session.getCatalog(wallet);
          printResult({
            command: `ewallet-catalog ${wallet}`,
            url: "https://www.hotelmurah.com/pulsa/index.php/ewallet/getProductEwallet",
            ok: true,
            data
          });
        } finally {
          session.close();
        }
        break;
      }

      case "ewallet-quote": {
        const wallet = args[1];
        const phone = args[2];
        const target = args[3];
        if (!wallet || !phone || !target) {
          throw new Error(
            "Usage: node cli.js ewallet-quote <wallet> <phone> <nominal|productId>"
          );
        }
        const data = await quoteEwalletTopUp(wallet, phone, target);
        const dataWithoutCatalog = { ...data };
        delete dataWithoutCatalog.catalog;
        dataWithoutCatalog.availableDenominations = data.catalog.products.length;
        printResult({
          command: `ewallet-quote ${wallet} ${phone} ${target}`,
          url: "https://www.hotelmurah.com/pulsa/Ewallet/detailOrder (isOrderValidated)",
          ok: true,
          data: dataWithoutCatalog
        });
        break;
      }

      case "ewallet-order": {
        const wallet = args[1];
        const phone = args[2];
        const target = args[3];
        const channel = args[4];
        const payerPhone = args[5] || "";
        if (!wallet || !phone || !target || !channel) {
          throw new Error(
            "Usage: node cli.js ewallet-order <wallet> <phone> <nominal|productId> <channel> [payerPhone]"
          );
        }
        const session = new EwalletSession();
        let data;
        try {
          const catalog = await session.getCatalog(wallet);
          const num = Number(target);
          const looksLikeId = Number.isInteger(num) && num > 0 && String(num).length <= 3;
          const product = looksLikeId
            ? (catalog.products.find((p) => p.id === String(num)) || findProductByNominal(catalog, num))
            : findProductByNominal(catalog, num);

          const options = await session.getPaymentOptions(wallet, phone, product.id);
          const wanted = String(channel).trim();
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

          const order = await session.submitOrder({
            wallet,
            phone,
            productId: product.id,
            channel: found.label,
            payerPhone
          });

          // Trim the giant QR data URL from CLI output; keep only metadata + length.
          data = { ...order };
          if (data.payment?.kind === "qr" && data.payment.qrDataUrl) {
            data.payment.qrDataUrlLength = data.payment.qrDataUrl.length;
            delete data.payment.qrDataUrl;
            delete data.payment.qrBase64;
          }
        } finally {
          session.close();
        }
        printResult({
          command: `ewallet-order ${wallet} ${phone} ${target} ${channel}`,
          url: "https://www.hotelmurah.com/pulsa/ewallet/submitorder",
          ok: true,
          data
        });
        break;
      }

      case "order-status": {
        const orderId = args[1];
        const idUser = args[2];
        if (!orderId || !idUser) {
          throw new Error("Usage: node cli.js order-status <orderId> <idUser>");
        }
        const data = await checkOrderStatus(orderId, idUser);
        printResult({
          command: `order-status ${orderId}`,
          url: data.statusUrl,
          ok: true,
          data
        });
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}`);
        printUsage();
    }
  } catch (err) {
    printResult({
      command: cmd,
      url: "https://www.hotelmurah.com",
      ok: false,
      error: err
    });
  }
}

main();
