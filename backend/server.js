// ============================================================
//  QuantSigma — Scanner Server
//  Scanner 1 : Crypto Futures (Binance) — every 10s
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options('*', cors());

const { handleBacktest, initFirebase } = require("./backtest");

// ── Firebase Admin init for backtest engine ────────────────
const serviceAccount = {
  type:                        "service_account",
  project_id:                  process.env.FIREBASE_PROJECT_ID,
  private_key_id:              process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key:                 process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email:                process.env.FIREBASE_CLIENT_EMAIL,
  client_id:                   process.env.FIREBASE_CLIENT_ID,
  auth_uri:                    "https://accounts.google.com/o/oauth2/auth",
  token_uri:                   "https://oauth2.googleapis.com/token",
};
initFirebase(serviceAccount);

// ══════════════════════════════════════════════════════════
//  SCANNER — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI   = "https://fapi.binance.com";
const WINDOW = 300;

const cryptoHistory = {};
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
    console.log(`✅ Crypto: Loaded ${cryptoSymbols.size} symbols`);
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
      console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`);
    }
  } catch(e) {
    console.error("Crypto tick error:", e.message);
  }
}

// ══════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════
// Debug test route
app.post("/api/test", (req, res) => {
  res.json({ ok: true, body: req.body });
});

// Debug Firebase route
app.post("/api/backtest-debug", async (req, res) => {
  try {
    console.log("Backtest debug called:", JSON.stringify(req.body));
    const { symbol, startDate } = req.body;
    const admin = require("firebase-admin");
    const db    = admin.firestore();
    const doc   = await db
      .collection("candles")
      .doc(symbol || "BTCUSDT")
      .collection("days")
      .doc(startDate || "2024-01-01")
      .get();
    if (doc.exists) {
      const data = JSON.parse(doc.data().data);
      res.json({ ok:true, message:"Firebase connected", candleCount:data.length, firstCandle:data[0] });
    } else {
      res.json({ ok:false, message:"Document not found", symbol, startDate });
    }
  } catch(e) {
    console.error("Debug error:", e);
    res.json({ ok:false, error:e.message });
  }
});

// Backtest endpoint
app.post("/api/backtest", handleBacktest);

app.get("/api/momentum", (req, res) => {
  res.json({ ok: true, total: cryptoTotal, top5: cryptoResults, ts: cryptoLastFetch });
});

// NSE endpoint returns empty — so frontend doesn't break
app.get("/api/nse", (req, res) => {
  res.json({ ok: false, total: 0, top5: [], indices: [], ready: false, ts: null });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
  res.json({ name: "QuantSigma Scanner API", endpoints: ["/api/momentum", "/api/nse"] });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner starting...\n");

  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, 10 * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto → /api/momentum\n`);
});
