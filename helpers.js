// ==========================================
// HELPERS.JS — Utility Functions
// ==========================================

// Sleep function
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Human-like random delay
function humanDelay(min = 500, max = 1500) {
  return sleep(Math.floor(Math.random() * (max - min)) + min);
}

// Parse CC string → object
function parseCC(ccStr) {
  const parts = ccStr.trim().split(/[|\/\s]+/);
  if (parts.length !== 4) return null;

  let [number, month, year, cvv] = parts;

  // Fix 2-digit year
  if (year.length === 2) year = "20" + year;

  // Pad month
  if (month.length === 1) month = "0" + month;

  return { number, month, year, cvv };
}

// Parse proxy string → object
function parseProxy(proxyStr) {
  if (!proxyStr || proxyStr.trim() === "") return null;

  try {
    proxyStr = proxyStr.trim();
