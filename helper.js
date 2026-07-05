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

    // Remove protocol if present
    proxyStr = proxyStr
      .replace(/^https?:\/\//, "")
      .replace(/^socks5?:\/\//, "");

    let host, port, username, password;

    if (proxyStr.includes("@")) {
      // Format: user:pass@host:port
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
      // Format: host:port:user:pass OR host:port
      const parts = proxyStr.split(":");
      if (parts.length >= 4) {
        host = parts[0];
        port = parts[1];
        username = parts[2];
        password = parts.slice(3).join(":");
      } else if (parts.length === 2) {
        host = parts[0];
        port = parts[1];
      } else {
        return null;
      }
    }

    if (!host || !port) return null;

    return { host, port, username: username || null, password: password || null };
  } catch (e) {
    return null;
  }
}

// Format proxy for puppeteer arg
function proxyToArg(proxy) {
  if (!proxy) return null;
  return `${proxy.host}:${proxy.port}`;
}

// Random fake customer
const FAKE_CUSTOMERS = [
  {
    firstName: "John", lastName: "Smith",
    email: "john.smith92@gmail.com",
    phone: "2125551234",
    address: "123 Main St", city: "New York",
    zip: "10001", state: "NY", country: "United States",
  },
  {
    firstName: "Emily", lastName: "Johnson",
    email: "emily.j1990@yahoo.com",
    phone: "3105559876",
    address: "456 Oak Ave", city: "Los Angeles",
    zip: "90001", state: "CA", country: "United States",
  },
  {
    firstName: "Michael", lastName: "Brown",
    email: "m.brown88@hotmail.com",
    phone: "7735554567",
    address: "789 Pine Rd", city: "Chicago",
    zip: "60601", state: "IL", country: "United States",
  },
  {
    firstName: "Sarah", lastName: "Davis",
    email: "sarah.davis@gmail.com",
    phone: "6175558901",
    address: "321 Elm St", city: "Boston",
    zip: "02101", state: "MA", country: "United States",
  },
  {
    firstName: "David", lastName: "Wilson",
    email: "d.wilson95@outlook.com",
    phone: "4155552345",
    address: "654 Maple Dr", city: "San Francisco",
    zip: "94101", state: "CA", country: "United States",
  },
  {
    firstName: "Jessica", lastName: "Martinez",
    email: "jess.martinez@gmail.com",
    phone: "7025556789",
    address: "987 Cedar Ln", city: "Las Vegas",
    zip: "89101", state: "NV", country: "United States",
  },
  {
    firstName: "James", lastName: "Taylor",
    email: "james.t2000@gmail.com",
    phone: "2025553456",
    address: "147 Washington Blvd", city: "Washington",
    zip: "20001", state: "DC", country: "United States",
  },
];

function getFakeCustomer() {
  return FAKE_CUSTOMERS[Math.floor(Math.random() * FAKE_CUSTOMERS.length)];
}

// Escape HTML
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = {
  sleep,
  humanDelay,
  parseCC,
  parseProxy,
  proxyToArg,
  getFakeCustomer,
  escapeHTML,
};
