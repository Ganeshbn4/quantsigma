// ============================================================
//  QuantSigma — Scanner Server v5
//  Scanner 1: Crypto Futures (Binance USDT-M Perpetuals)
//  Scanner 2: Indian FNO Stocks (NSE)
//  Formula  : Score = PriceChange × 0.6 + VolumeChange × 0.4
//  Rolling  : 5-min window (same logic as crypto)
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: [
    "https://quantsigma.in",
    "https://www.quantsigma.in",
    "http://localhost:3000",
    /\.vercel\.app$/
  ]
}));

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI        = "https://fapi.binance.com";
const WINDOW      = 300;  // 5-min rolling window (seconds)
const REFRESH     = 10;   // poll every 10 seconds

const cryptoHistory = {}; // { symbol: [[ts, price, vol], ...] }
let cryptoSymbols   = new Set();
let cryptoResults   = [];
let cryptoTotal     = 0;
let cryptoLastFetch = null;

async function loadCryptoSymbols() {
  try {
    const { data } = await axios.get(`${BAPI}/fapi/v1/exchangeInfo`, { timeout: 15000 });
    cryptoSymbols = new Set(
      data.symbols
        .filter(s =>
          s.underlyingType === "COIN"      &&
          s.contractType   === "PERPETUAL" &&
          s.status         === "TRADING"   &&
          s.symbol.endsWith("USDT")
        )
        .map(s => s.symbol)
    );
    console.log(`✅ Crypto: Loaded ${cryptoSymbols.size} USDT perpetual symbols`);
  } catch(e) {
    console.error("Crypto symbol load error:", e.message);
  }
}

async function tickCrypto() {
  try {
    const now = Date.now() / 1000;
    const { data } = await axios.get(`${BAPI}/fapi/v1/ticker/24hr`, { timeout: 10000 });

    cryptoTotal = 0;
    for (const coin of data) {
      if (!cryptoSymbols.has(coin.symbol)) continue;
      const price = parseFloat(coin.lastPrice);
      const vol   = parseFloat(coin.quoteVolume);
      if (!price || !vol) continue;
      cryptoTotal++;
      if (!cryptoHistory[coin.symbol]) cryptoHistory[coin.symbol] = [];
      cryptoHistory[coin.symbol].push([now, price, vol]);
      cryptoHistory[coin.symbol] = cryptoHistory[coin.symbol].filter(x => now - x[0] < WINDOW);
    }

    const results = [];
    for (const symbol of Object.keys(cryptoHistory)) {
      const h = cryptoHistory[symbol];
      if (h.length < 2) continue;
      const [, oldP, oldV] = h[0];
      const [, newP, newV] = h[h.length - 1];
      if (!oldP || !oldV) continue;
      const pc    = ((newP - oldP) / oldP) * 100;
      const vc    = ((newV - oldV) / oldV) * 100;
      const score = (pc * 0.6) + (vc * 0.4);
      results.push({ symbol, price: newP, priceChange: pc, volumeChange: vc, score, qVol: newV });
    }

    cryptoResults   = results.sort((a, b) => b.score - a.score).slice(0, 5);
    cryptoLastFetch = Date.now();

    console.log("\n🔥 CRYPTO TOP 5:");
    for (const r of cryptoResults) {
      console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2).padStart(7)}% | Vol: ${r.volumeChange.toFixed(2).padStart(9)}% | Score: ${r.score.toFixed(2)}`);
    }
  } catch(e) {
    console.error("Crypto tick error:", e.message);
  }
}

// ══════════════════════════════════════════════════════════
//  SCANNER 2 — INDIAN FNO STOCKS (NSE)
//  Uses NSE's public JSON endpoint — no API key needed
//  Same rolling 5-min window formula as crypto
// ══════════════════════════════════════════════════════════
const NSE_URL = "https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O";

// NSE requires browser-like headers to avoid blocking
const NSE_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer":         "https://www.nseindia.com/market-data/securities-available-for-trading",
  "Connection":      "keep-alive",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
};

// NSE requires a session cookie — we get it by hitting the homepage first
let nseCookies     = "";
let nseHistory     = {}; // { symbol: [[ts, price, vol], ...] }
let nseResults     = [];
let nseTotal       = 0;
let nseLastFetch   = null;
let nseReady       = false;

// Get NSE session cookies (required to access API)
async function getNSECookies() {
  try {
    const resp = await axios.get("https://www.nseindia.com", {
      headers:  NSE_HEADERS,
      timeout:  15000,
      maxRedirects: 5
    });
    const rawCookies = resp.headers["set-cookie"];
    if (rawCookies) {
      nseCookies = rawCookies.map(c => c.split(";")[0]).join("; ");
      console.log("✅ NSE: Session cookies obtained");
    }
  } catch(e) {
    console.error("NSE cookie error:", e.message);
  }
}

async function tickNSE() {
  try {
    // Refresh cookies if empty
    if (!nseCookies) await getNSECookies();

    const { data } = await axios.get(NSE_URL, {
      headers: { ...NSE_HEADERS, "Cookie": nseCookies },
      timeout: 15000
    });

    if (!data || !data.data) {
      console.error("NSE: Invalid response format");
      return;
    }

    const now    = Date.now() / 1000;
    nseTotal     = 0;

    for (const stock of data.data) {
      try {
        // Skip index rows (NIFTY, BANKNIFTY etc)
        if (!stock.symbol || stock.symbol.startsWith("NIFTY") || stock.symbol.startsWith("SENSEX")) continue;

        const symbol = stock.symbol;
        const price  = parseFloat(stock.lastPrice?.toString().replace(/,/g, "") || 0);
        const vol    = parseFloat(stock.totalTradedVolume?.toString().replace(/,/g, "") || 0);

        if (!price || !vol) continue;
        nseTotal++;

        if (!nseHistory[symbol]) nseHistory[symbol] = [];
        nseHistory[symbol].push([now, price, vol]);
        nseHistory[symbol] = nseHistory[symbol].filter(x => now - x[0] < WINDOW);
      } catch(_) {}
    }

    // Need at least 2 snapshots to calculate momentum
    const results = [];
    for (const symbol of Object.keys(nseHistory)) {
      const h = nseHistory[symbol];
      if (h.length < 2) continue;

      const [, oldP, oldV] = h[0];
      const [, newP, newV] = h[h.length - 1];
      if (!oldP || !oldV) continue;

      const pc    = ((newP - oldP) / oldP) * 100;
      const vc    = ((newV - oldV) / oldV) * 100;
      const score = (pc * 0.6) + (vc * 0.4);

      results.push({
        symbol,
        price:         newP,
        priceChange:   pc,
        volumeChange:  vc,
        score,
        totalVolume:   newV
      });
    }

    nseResults   = results.sort((a, b) => b.score - a.score).slice(0, 5);
    nseLastFetch = Date.now();
    nseReady     = results.length > 0;

    console.log(`\n📈 NSE FNO TOP 5 (${nseTotal} stocks scanned):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2).padStart(7)}% | Vol: ${r.volumeChange.toFixed(2).padStart(9)}% | Score: ${r.score.toFixed(2)}`);
    }

  } catch(e) {
    console.error("NSE tick error:", e.message);
    // If request fails, refresh cookies and retry next tick
    nseCookies = "";
  }
}

// ══════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════

// Crypto scanner endpoint
app.get("/api/momentum", (req, res) => {
  res.json({
    ok:    true,
    total: cryptoTotal,
    top5:  cryptoResults,
    ts:    cryptoLastFetch
  });
});

// NSE FNO scanner endpoint
app.get("/api/nse", (req, res) => {
  res.json({
    ok:    true,
    total: nseTotal,
    top5:  nseResults,
    ready: nseReady,
    ts:    nseLastFetch
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Root
app.get("/", (req, res) => {
  res.json({
    name:      "QuantSigma Scanner API v5",
    endpoints: ["/api/momentum", "/api/nse", "/health"]
  });
});

// ══════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════
(async () => {
  try {
    console.log("\n🚀 QuantSigma Scanner v5 starting...\n");

    // ── Crypto: load symbols then start polling ──────────
    await loadCryptoSymbols();
    await tickCrypto();
    setInterval(tickCrypto, REFRESH * 1000);
    setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000); // refresh every 6h

    // ── NSE: get cookies then start polling ──────────────
    // Small delay so both scanners don't hammer on startup
    setTimeout(async () => {
      await getNSECookies();
      await tickNSE();
      setInterval(tickNSE, REFRESH * 1000);
      // Refresh NSE cookies every 30 minutes
      setInterval(getNSECookies, 30 * 60 * 1000);
    }, 3000);

  } catch(e) {
    console.error("Startup error:", e.message);
    process.exit(1);
  }
})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto API  → /api/momentum`);
  console.log(`📈 NSE FNO API → /api/nse`);
  console.log(`⏳ NSE scores appear after first 2 snapshots (~10 seconds)\n`);
});
