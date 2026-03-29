// ============================================================
//  QuantSigma — Crypto Futures Momentum Scanner
//  Stack  : Node.js + Express + Axios
//  Deploy : Railway
//  Logic  : Rolling 5-min history window
//  Score  : PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Allow requests from your frontend domain ──────────────
app.use(cors({
  origin: [
    "https://quantsigma.in",
    "https://www.quantsigma.in",
    "http://localhost:3000"   // for local testing
  ]
}));

const BAPI    = "https://fapi.binance.com";
const WINDOW  = 300;   // 5-minute rolling window (seconds)
const REFRESH = 10;    // fetch new data every 10 seconds

// ── In-memory rolling history ─────────────────────────────
// Structure: { symbol: [ [timestamp, price, volume], ... ] }
const history = {};

// ── Whitelist: crypto-only USDT perpetuals ────────────────
// This excludes equity derivatives like NVDA, META, GOOGL
let cryptoSymbols = new Set();

async function loadCryptoSymbols() {
  try {
    const { data } = await axios.get(`${BAPI}/fapi/v1/exchangeInfo`, { timeout: 15000 });
    cryptoSymbols = new Set(
      data.symbols
        .filter(s =>
          s.underlyingType === "COIN"      &&  // crypto only
          s.contractType   === "PERPETUAL" &&  // perpetuals only
          s.status         === "TRADING"   &&  // active markets only
          s.symbol.endsWith("USDT")            // USDT-margined only
        )
        .map(s => s.symbol)
    );
    console.log(`✅  Loaded ${cryptoSymbols.size} crypto USDT perpetual symbols`);
  } catch (e) {
    console.error("Failed to load symbols:", e.message);
  }
}

// ── Fetch latest ticker snapshot from Binance ─────────────
async function getSnapshot() {
  const { data } = await axios.get(`${BAPI}/fapi/v1/ticker/24hr`, { timeout: 10000 });
  const snapshot = {};
  for (const coin of data) {
    try {
      const symbol = coin.symbol;
      if (!cryptoSymbols.has(symbol)) continue;
      const price  = parseFloat(coin.lastPrice);
      const volume = parseFloat(coin.quoteVolume);
      if (price && volume) snapshot[symbol] = [price, volume];
    } catch (_) {}
  }
  return snapshot;
}

// ── Core scoring loop — runs every 10 seconds ─────────────
let latestResults = [];
let lastFetch     = null;
let totalCoins    = 0;

async function tick() {
  try {
    const now     = Date.now() / 1000; // unix timestamp in seconds
    const current = await getSnapshot();

    totalCoins = Object.keys(current).length;

    // Add new snapshot to rolling history, remove entries older than WINDOW
    for (const [symbol, [price, vol]] of Object.entries(current)) {
      if (!history[symbol]) history[symbol] = [];
      history[symbol].push([now, price, vol]);
      history[symbol] = history[symbol].filter(x => now - x[0] < WINDOW);
    }

    // Score every symbol that has at least 2 data points in the window
    const results = [];
    for (const symbol of Object.keys(history)) {
      const h = history[symbol];
      if (h.length < 2) continue;

      const [, oldPrice, oldVol] = h[0];            // oldest entry
      const [, newPrice, newVol] = h[h.length - 1]; // latest entry

      if (oldPrice === 0 || oldVol === 0) continue;

      const priceChange  = ((newPrice - oldPrice) / oldPrice) * 100;
      const volumeChange = ((newVol   - oldVol)   / oldVol)   * 100;

      // Scoring formula: Price momentum weighted 60%, Volume momentum 40%
      const score = (priceChange * 0.6) + (volumeChange * 0.4);

      results.push({
        symbol,
        price: newPrice,
        priceChange,
        volumeChange,
        score,
        qVol: newVol
      });
    }

    // Sort by score descending, keep top 5
    latestResults = results
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    lastFetch = Date.now();

    // Log to Railway console
    console.log("\n🔥 TOP 5 STRONGEST — " + new Date().toLocaleTimeString());
    for (const r of latestResults) {
      console.log(
        `${r.symbol.padEnd(12)} | Price: ${r.priceChange.toFixed(2).padStart(7)}% | ` +
        `Vol: ${r.volumeChange.toFixed(2).padStart(9)}% | Score: ${r.score.toFixed(2).padStart(8)}`
      );
    }

  } catch (e) {
    console.error("Tick error:", e.message);
  }
}

// ── API Routes ────────────────────────────────────────────

// Main endpoint — frontend calls this every 10 seconds
app.get("/api/momentum", (req, res) => {
  res.json({
    ok:     true,
    total:  totalCoins,
    top5:   latestResults,
    ts:     lastFetch
  });
});

// Health check — Railway uses this to confirm server is alive
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Root route
app.get("/", (req, res) => {
  res.json({
    name:    "QuantSigma Scanner API",
    version: "1.0.0",
    status:  "running",
    endpoint: "/api/momentum"
  });
});

// ── Start Server ──────────────────────────────────────────
(async () => {
  try {
    // Load crypto symbol whitelist first
    await loadCryptoSymbols();

    // Run first tick immediately, then every 10 seconds
    await tick();
    setInterval(tick, REFRESH * 1000);

    // Refresh symbol whitelist every 6 hours
    setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  } catch (e) {
    console.error("Startup error:", e.message);
    process.exit(1);
  }
})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅  QuantSigma Scanner running on port ${PORT}`);
  console.log(`📡  API → http://0.0.0.0:${PORT}/api/momentum`);
  console.log(`⏳  Warming up... scores appear after first 2 snapshots (~10s)\n`);
});
