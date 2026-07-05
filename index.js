// ==========================================
// INDEX.JS — Express API Server
// ==========================================

const express = require("express");
const { checkShopify } = require("./shopify");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// HEALTH CHECK
// ==========================================
app.get("/", (req, res) => {
  res.json({
    status: "running",
    name: "Shopify Checker API",
    version: "2.0",
    endpoints: {
      check: "/shopify?site=SITE_URL&cc=NUMBER|MM|YYYY|CVV&proxy=HOST:PORT:USER:PASS",
    },
  });
});

// ==========================================
// MAIN CHECKER ENDPOINT
// GET /shopify?site=...&cc=...&proxy=...
// ==========================================
app.get("/shopify", async (req, res) => {
  const { site, cc, proxy } = req.query;

  // Validate required params
  if (!site) {
    return res.status(400).json({
      Status: false,
      Response: "Missing 'site' parameter",
    });
  }

  if (!cc) {
    return res.status(400).json({
      Status: false,
      Response: "Missing 'cc' parameter",
    });
  }

  // Validate CC format
  const parts = cc.split("|");
  if (parts.length !== 4) {
    return res.status(400).json({
      Status: false,
      Response: "Invalid CC format. Use: number|MM|YYYY|CVV",
    });
  }

  // Validate site URL
  if (!site.startsWith("http")) {
    return res.status(400).json({
      Status: false,
      Response: "Invalid site URL. Must start with https://",
    });
  }

  console.log(`\n[API] ==================`);
  console.log(`[API] New request`);
  console.log(`[API] Site: ${site}`);
  console.log(`[API] CC: ${parts[0].substring(0, 6)}XXXXXXXXXX`);
  console.log(`[API] Proxy: ${proxy || "None"}`);

  try {
    const result = await checkShopify(site, cc, proxy || null);
    return res.json(result);
  } catch (err) {
    console.error("[API] Unhandled Error:", err.message);
    return res.status(500).json({
      Status: false,
      Response: "Internal Server Error",
    });
  }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Shopify Checker API running on port ${PORT}`);
  console.log(`📌 Endpoint: http://localhost:${PORT}/shopify?site=...&cc=...`);
});
