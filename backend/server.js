// ============================================================
//  QuantSigma — Scanner Server v5.5
//  Scanner 1 : Crypto Futures (Binance) — every 10s
//  Scanner 2 : Indian FNO (stock-nse-india package) — every 30s
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express    = require("express");
const axios      = require("axios");
const cors       = require("cors");
const { NseIndia } = require("stock-nse-india");

const app    = express();
const PORT   = process.env.PORT || 3000;
const nse    = new NseIndia();

// Open CORS
app.use(cors());
app.options('*', cors());

// Prevent crash
process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Rejection:', e?.message || e));

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI    = "https://fapi.binance.com";
const WINDOW  = 300;

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
//  SCANNER 2 — INDIAN FNO (stock-nse-india package)
//  This package handles NSE cookies automatically
//  Works from any server IP including European Railway servers
// ══════════════════════════════════════════════════════════

// Top 50 liquid FNO stocks
const FNO_STOCKS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK",
  "ITC","SBIN","BHARTIARTL","KOTAKBANK","LT",
  "AXISBANK","TATAMOTORS","WIPRO","HCLTECH","SUNPHARMA",
  "BAJFINANCE","TITAN","MARUTI","ASIANPAINT","ULTRACEMCO",
  "NTPC","POWERGRID","ONGC","TATASTEEL","JSWSTEEL",
  "HINDALCO","COALINDIA","BPCL","DRREDDY","CIPLA",
  "DIVISLAB","EICHERMOT","HEROMOTOCO","BAJAJFINSV","BRITANNIA",
  "GRASIM","INDUSINDBK","M&M","SBILIFE","HDFCLIFE",
  "APOLLOHOSP","TATACONSUM","LTIM","ADANIENT","ADANIPORTS",
  "ZOMATO","NAUKRI","IRCTC","DLF","VEDL"
];

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
    const now      = Date.now() / 1000;
    const fnoResults = [];
    nseTotal = 0;

    // Fetch each stock using stock-nse-india package
    // Stagger requests to avoid rate limiting
    for (const symbol of FNO_STOCKS) {
      try {
        const details = await nse.getEquityDetails(symbol);
        const price   = parseFloat(details?.priceInfo?.lastPrice || 0);
        const vol     = parseFloat(details?.securityInfo?.totalTradedVolume || 0);
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
      } catch(_) {
        // Skip failed symbol silently
      }
      // Small delay between requests
      await new Promise(r => setTimeout(r, 100));
    }

    nseResults   = fnoResults.sort((a, b) => b.score - a.score).slice(0, 5);
    nseReady     = fnoResults.length > 0;
    nseLastFetch = Date.now();
    nseTotal     = fnoResults.length;

    // Fetch Nifty 50 & Bank Nifty
    try {
      const indices = [
        { method: "NIFTY 50",   label: "NIFTY 50"   },
        { method: "NIFTY BANK", label: "NIFTY BANK"  }
      ];
      nseIndices = [];
      for (const idx of indices) {
        try {
          const data  = await nse.getIndexDetails(idx.method);
          const price = parseFloat(data?.data?.[0]?.last || 0);
          const vol   = parseFloat(data?.data?.[0]?.totalTradedVolume || 0);
          if (!price) continue;
          const res = computeScore(idx.label, price, vol, now);
          if (res) {
            nseIndices.push({
              symbol: idx.label, price: res.newP,
              priceChange: res.pc, volumeChange: res.vc,
              score: res.score, totalVolume: res.newV,
              isIndex: true, warming: false
            });
          } else {
            nseIndices.push({
              symbol: idx.label, price,
              priceChange: parseFloat(data?.data?.[0]?.percentChange || 0),
              volumeChange: 0, score: 0, totalVolume: vol,
              isIndex: true, warming: true
            });
          }
        } catch(_) {}
      }
    } catch(e) {
      console.error("Index fetch error:", e.message);
    }

    console.log(`\n📈 NSE TOP 5 (${nseTotal} stocks):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`);
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
    ok: true, total: nseTotal,
    top5: nseResults, indices: nseIndices,
    ready: nseReady, ts: nseLastFetch
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
  res.json({ name: "QuantSigma API v5.5", endpoints: ["/api/momentum", "/api/nse"] });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner v5.5 starting...\n");

  // Crypto — every 10 seconds
  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, 10 * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  // NSE — every 30 seconds
  setTimeout(async () => {
    await tickNSE();
    setInterval(tickNSE, 30 * 1000);
  }, 5000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum`);
  console.log(`📈 NSE FNO → /api/nse\n`);
});
