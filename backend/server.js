// ============================================================
//  QuantSigma — Scanner Server v5.4
//  Scanner 1 : Crypto Futures (Binance) — every 10s
//  Scanner 2 : Indian FNO Top 50 (Yahoo Finance) — every 30s
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// Open CORS
app.use(cors());
app.options('*', cors());

// Prevent crash on unhandled errors
process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Rejection:', e?.message || e));

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI        = "https://fapi.binance.com";
const WINDOW      = 300; // 5-min rolling
const CRYPTO_INT  = 10;  // seconds

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
//  SCANNER 2 — INDIAN FNO TOP 50 (Yahoo Finance)
//  Light version — top 50 liquid FNO stocks + 2 indices
//  Runs every 30 seconds to stay within memory limits
// ══════════════════════════════════════════════════════════

// Top 50 most liquid NSE FNO stocks
const FNO_SYMBOLS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK", "LT",
  "AXISBANK", "TATAMOTORS", "WIPRO", "HCLTECH", "SUNPHARMA",
  "BAJFINANCE", "TITAN", "MARUTI", "ASIANPAINT", "ULTRACEMCO",
  "NTPC", "POWERGRID", "ONGC", "TATASTEEL", "JSWSTEEL",
  "HINDALCO", "COALINDIA", "BPCL", "DRREDDY", "CIPLA",
  "DIVISLAB", "EICHERMOT", "HEROMOTOCO", "BAJAJFINSV", "BRITANNIA",
  "GRASIM", "INDUSINDBK", "M&M", "SBILIFE", "HDFCLIFE",
  "APOLLOHOSP", "TATACONSUM", "LTIM", "ADANIENT", "ADANIPORTS",
  "ZOMATO", "NAUKRI", "IRCTC", "DLF", "VEDL"
].map(s => s + ".NS");

// Nifty 50 and Bank Nifty
const INDEX_SYMBOLS = [
  { yahoo: "^NSEI",    label: "NIFTY 50"   },
  { yahoo: "^NSEBANK", label: "NIFTY BANK"  }
];

// All symbols to fetch in one call
const ALL_SYMBOLS = [...FNO_SYMBOLS, ...INDEX_SYMBOLS.map(i => i.yahoo)];

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":     "application/json"
};

const nseHistory = {};
let nseResults   = [];
let nseIndices   = [];
let nseTotal     = 0;
let nseReady     = false;
let nseLastFetch = null;

function computeScore(symbol, price, vol, now) {
  if (!nseHistory[symbol]) nseHistory[symbol] = [];
  nseHistory[symbol].push([now, price, vol]);
  nseHistory[symbol] = nseHistory[symbol].filter(x => now - x[0] < WINDOW);
  const h = nseHistory[symbol];
  if (h.length < 2) return null;
  const [, oldP, oldV] = h[0];
  const [, newP, newV] = h[h.length - 1];
  if (!oldP) return null;
  const pc = ((newP - oldP) / oldP) * 100;
  const vc = oldV ? ((newV - oldV) / oldV) * 100 : 0;
  return { pc, vc, score: (pc * 0.6) + (vc * 0.4), newP, newV };
}

async function tickNSE() {
  try {
    const now = Date.now() / 1000;

    // Fetch all symbols in ONE single API call — lightweight
    const joined = ALL_SYMBOLS.join(",");
    const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}&fields=regularMarketPrice,regularMarketVolume,regularMarketChangePercent`;

    const { data } = await axios.get(url, {
      headers: YAHOO_HEADERS,
      timeout: 20000
    });

    const quotes = data?.quoteResponse?.result || [];
    if (!quotes.length) {
      console.log("NSE: No data from Yahoo Finance");
      nseLastFetch = Date.now();
      return;
    }

    // ── Process FNO stocks ────────────────────────────────
    const fnoResults = [];
    nseTotal = 0;

    for (const q of quotes) {
      // Skip index symbols
      if (q.symbol.startsWith("^")) continue;

      try {
        const symbol = q.symbol.replace(".NS", "");
        const price  = parseFloat(q.regularMarketPrice || 0);
        const vol    = parseFloat(q.regularMarketVolume || 0);
        if (!price) continue;
        nseTotal++;
        const res = computeScore(symbol, price, vol, now);
        if (!res) continue;
        fnoResults.push({
          symbol,
          price:        res.newP,
          priceChange:  res.pc,
          volumeChange: res.vc,
          score:        res.score,
          totalVolume:  res.newV
        });
      } catch(_) {}
    }

    nseResults   = fnoResults.sort((a, b) => b.score - a.score).slice(0, 5);
    nseReady     = fnoResults.length > 0;
    nseLastFetch = Date.now();

    // ── Process Indices ───────────────────────────────────
    nseIndices = [];
    for (const target of INDEX_SYMBOLS) {
      const q = quotes.find(x => x.symbol === target.yahoo);
      if (!q) continue;
      const price = parseFloat(q.regularMarketPrice || 0);
      const vol   = parseFloat(q.regularMarketVolume || 0);
      if (!price) continue;
      const res = computeScore(target.label, price, vol, now);
      if (res) {
        nseIndices.push({
          symbol:       target.label,
          price:        res.newP,
          priceChange:  res.pc,
          volumeChange: res.vc,
          score:        res.score,
          totalVolume:  res.newV,
          isIndex:      true,
          warming:      false
        });
      } else {
        nseIndices.push({
          symbol:       target.label,
          price,
          priceChange:  parseFloat(q.regularMarketChangePercent || 0),
          volumeChange: 0,
          score:        0,
          totalVolume:  vol,
          isIndex:      true,
          warming:      true
        });
      }
    }

    console.log(`\n📈 NSE TOP 5 (${nseTotal} stocks scanned):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`);
    }
    if (nseIndices.length) {
      console.log(`📊 ${nseIndices.map(i => `${i.symbol}: ${i.priceChange.toFixed(2)}%`).join(" | ")}`);
    }

  } catch(e) {
    console.error("NSE tick error:", e.message);
    nseLastFetch = Date.now();
  }
}

// ══════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════
app.get("/api/momentum", (req, res) => {
  res.json({ ok: true, total: cryptoTotal, top5: cryptoResults, ts: cryptoLastFetch });
});

app.get("/api/nse", (req, res) => {
  res.json({
    ok:      true,
    total:   nseTotal,
    top5:    nseResults,
    indices: nseIndices,
    ready:   nseReady,
    ts:      nseLastFetch
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
  res.json({
    name:      "QuantSigma API v5.4",
    endpoints: ["/api/momentum", "/api/nse", "/health"]
  });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner v5.4 starting...\n");

  // Crypto — every 10 seconds
  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, CRYPTO_INT * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  // NSE via Yahoo Finance — every 30 seconds (lightweight)
  setTimeout(async () => {
    await tickNSE();
    setInterval(tickNSE, 30 * 1000);
  }, 5000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum (every 10s)`);
  console.log(`📈 NSE FNO → /api/nse     (every 30s via Yahoo Finance)\n`);
});
