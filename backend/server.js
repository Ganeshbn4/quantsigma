// ============================================================
//  QuantSigma — Scanner Server
//  Scanner 1 : Crypto Futures (Binance)     — every 10s
//  Scanner 2 : Indian FNO Stocks (Stooq)   — every 15s
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options('*', cors());

process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Rejection:', e?.message || e));

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI   = "https://fapi.binance.com";
const WINDOW = 300; // 5 min rolling

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
//  SCANNER 2 — NSE FNO via Stooq
//  Stooq provides NSE data, no auth, no IP restrictions
//  Format: https://stooq.com/q/l/?s=RELIANCE.NS&f=sd2t2ohlcv&h&e=csv
// ══════════════════════════════════════════════════════════

const FNO_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL",
  "ITC","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","HCLTECH","SUNPHARMA",
  "TITAN","ULTRACEMCO","BAJFINANCE","WIPRO","NESTLEIND","POWERGRID","NTPC","TECHM",
  "ONGC","JSWSTEEL","TATASTEEL","COALINDIA","ADANIPORTS","BAJAJFINSV","DIVISLAB",
  "DRREDDY","EICHERMOT","GRASIM","HEROMOTOCO","HINDALCO","INDUSINDBK","M&M",
  "SBILIFE","TATACONSUM","TATAMOTORS","VEDL","BPCL","CIPLA","GAIL",
  "HAVELLS","PIDILITIND","AMBUJACEM","APOLLOHOSP","AUROPHARMA",
  "BALKRISIND","BANDHANBNK","BANKBARODA","BEL","BHEL","BIOCON",
  "BRITANNIA","CANBK","CHOLAFIN","COLPAL","DABUR","DEEPAKNTR",
  "ESCORTS","FEDERALBNK","GMRINFRA","GRANULES","HDFCAMC",
  "HDFCLIFE","HINDCOPPER","HINDPETRO","IDFCFIRSTB","IGL",
  "INDHOTEL","IOC","IRCTC","JUBLFOOD","LALPATHLAB","LAURUSLABS",
  "LICHSGFIN","LUPIN","MANAPPURAM","MARICO","METROPOLIS",
  "MINDTREE","MPHASIS","MRF","MUTHOOTFIN","NATIONALUM",
  "NMDC","OBEROIRLTY","OFSS","PETRONET","PFC",
  "PNB","POLYCAB","PAGEIND","PERSISTENT","PVRINOX",
  "RAMCOCEM","RBLBANK","RECLTD","SAIL","SHREECEM",
  "SHRIRAMFIN","SYNGENE","TATACHEM","TATACOMM",
  "TATAELXSI","TATAPOWER","TRENT","UBL","VOLTAS",
  "ZEEL","ZYDUSLIFE","ABCAPITAL","ACC","ALKEM",
  "ASHOKLEY","AUBANK","BAJAJ-AUTO","BATAINDIA","CAMS",
  "CANFINHOME","DIXON","DLF","DMART","EMAMILTD",
  "FORTIS","GLENMARK","GODREJCP","GODREJPROP","HAL",
  "HFCL","HUDCO","IDFC","INDIAMART","INDIANB","INDIGO",
  "JBCHEPHARM","JKCEMENT","JKPAPER","JSWENERGY",
  "KAJARIACER","KEC","KPITTECH","LICI","LODHA",
  "LTIM","LTTS","LUXIND","MANKIND","MCX","MMTC",
  "MOTILALOFS","NATCOPHARM","NBCC","NCC","NLCINDIA",
  "OIL","PAYTM","PNBHOUSING","POLICYBZR","PRESTIGE",
  "RAILTEL","RITES","SAFARI","SJVN","SOBHA",
  "SUZLON","TANLA","TATATECH","THYROCARE","TIINDIA",
  "TORNTPHARM","TORNTPOWER","TVSHLTD","UNIONBANK",
  "UNOMINDA","VBL","VGUARD","WELCORP","ZOMATO"
];

const NSE_INDICES = [
  { symbol: "NIFTY 50",   stooq: "^nif50"  },
  { symbol: "NIFTY BANK", stooq: "^nifbnk" }
];

const nseHistory = {};
let nseResults   = [];
let nseIndices   = [];
let nseTotal     = 0;
let nseReady     = false;
let nseLastFetch = null;

function computeNSEScore(symbol, price, vol, now) {
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

// Fetch single symbol from Stooq CSV
async function fetchStooq(ticker) {
  const url = `https://stooq.com/q/l/?s=${ticker.toLowerCase()}.ns&f=sd2t2ohlcv&h&e=csv`;
  try {
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
    const lines = data.trim().split("\n");
    if (lines.length < 2) return null;
    const parts = lines[1].split(",");
    if (parts.length < 8) return null;
    const close  = parseFloat(parts[6]);
    const volume = parseFloat(parts[7]);
    if (!close || close <= 0 || isNaN(close)) return null;
    return { price: close, volume: isNaN(volume) ? 0 : volume };
  } catch(e) {
    return null;
  }
}

// Fetch index from Stooq
async function fetchStooqIndex(stooqTicker) {
  const url = `https://stooq.com/q/l/?s=${stooqTicker}&f=sd2t2ohlcv&h&e=csv`;
  try {
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const lines = data.trim().split("\n");
    if (lines.length < 2) return null;
    const parts = lines[1].split(",");
    if (parts.length < 8) return null;
    const close  = parseFloat(parts[6]);
    const volume = parseFloat(parts[7]);
    if (!close || close <= 0 || isNaN(close)) return null;
    return { price: close, volume: isNaN(volume) ? 0 : volume };
  } catch(e) {
    return null;
  }
}

// Run all fetches concurrently in batches to avoid overwhelming Stooq
async function fetchBatch(symbols, batchSize = 20, delayMs = 500) {
  const results = {};
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    await Promise.all(batch.map(async sym => {
      const d = await fetchStooq(sym);
      if (d) results[sym] = d;
    }));
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

async function tickNSE() {
  try {
    const now = Date.now() / 1000;
    console.log("📡 Fetching NSE FNO data from Stooq...");

    // Fetch all FNO stocks
    const quotes = await fetchBatch(FNO_SYMBOLS, 20, 300);

    nseTotal = 0;
    const fnoResults = [];

    for (const [sym, q] of Object.entries(quotes)) {
      try {
        nseTotal++;
        const res = computeNSEScore(sym, q.price, q.volume, now);
        if (!res) continue;
        fnoResults.push({
          symbol:       sym,
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

    // Fetch indices
    nseIndices = [];
    for (const target of NSE_INDICES) {
      const q = await fetchStooqIndex(target.stooq);
      if (!q) continue;
      const res = computeNSEScore(target.symbol, q.price, q.volume, now);
      if (res) {
        nseIndices.push({
          symbol: target.symbol, price: res.newP,
          priceChange: res.pc, volumeChange: res.vc,
          score: res.score, totalVolume: res.newV,
          isIndex: true, warming: false
        });
      } else {
        nseIndices.push({
          symbol: target.symbol, price: q.price,
          priceChange: 0, volumeChange: 0,
          score: 0, totalVolume: q.volume,
          isIndex: true, warming: true
        });
      }
    }

    console.log(`\n📈 NSE FNO TOP 5 (${nseTotal} stocks via Stooq):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(16)} ₹${r.price.toFixed(2)} | Score: ${r.score.toFixed(2)}`);
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
  res.json({ name: "QuantSigma Scanner API", endpoints: ["/api/momentum", "/api/nse"] });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner starting...\n");

  // Crypto — every 10 seconds
  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, 10 * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  // NSE via Stooq — every 30 seconds (individual HTTP calls per symbol, so slower)
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
