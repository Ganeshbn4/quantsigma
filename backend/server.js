// ============================================================
//  QuantSigma — Scanner Server v5.3
//  Scanner 1 : Crypto Futures (Binance)
//  Scanner 2 : Indian FNO Stocks via Yahoo Finance
//              Yahoo Finance works from any server IP
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// Open CORS — scanner data is public
app.use(cors());
app.options('*', cors());

// Prevent server crash
process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Rejection:', e?.message || e));

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI    = "https://fapi.binance.com";
const WINDOW  = 300;
const REFRESH = 10;

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
//  SCANNER 2 — INDIAN FNO STOCKS (Yahoo Finance)
//  Yahoo Finance NSE symbols use .NS suffix
//  e.g. RELIANCE.NS, HDFCBANK.NS, NIFTY50.NS
// ══════════════════════════════════════════════════════════

// Complete NSE FNO stock list with Yahoo Finance symbols
const FNO_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC",
  "SBIN","BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI",
  "TITAN","ULTRACEMCO","SUNPHARMA","BAJFINANCE","TATAMOTORS","WIPRO",
  "HCLTECH","POWERGRID","NTPC","ADANIENT","ADANIPORTS","TECHM","NESTLEIND",
  "ONGC","JSWSTEEL","TATASTEEL","HINDALCO","COALINDIA","BPCL","IOC",
  "DRREDDY","CIPLA","DIVISLAB","EICHERMOT","HEROMOTOCO","BAJAJFINSV",
  "BAJAJ-AUTO","BRITANNIA","GRASIM","INDUSINDBK","M&M","SBILIFE",
  "HDFCLIFE","APOLLOHOSP","TATACONSUM","LTIM","PERSISTENT","MPHASIS",
  "COFORGE","LTTS","OFSS","HDFCAMC","PIDILITIND","DABUR","MARICO",
  "GODREJCP","COLPAL","EMAMILTD","TATACOMM","DLF","PRESTIGE","OBEROIRLTY",
  "PHOENIXLTD","SOBHA","GODREJPROP","BRIGADE","IDFCFIRSTB","FEDERALBNK",
  "BANDHANBNK","CANBK","PNB","BANKBARODA","UNIONBANK","MAHABANK",
  "RBLBANK","KARURVYSYA","DCBBANK","UJJIVANSFB","AUBANK","EQUITASBNK",
  "CHOLAFIN","MUTHOOTFIN","MANAPPURAM","M&MFIN","SHRIRAMFIN","LICHSGFIN",
  "RECLTD","PFC","IRFC","HUDCO","IIFL","ANGELONE","CDSL","BSE","MCX",
  "NYKAA","ZOMATO","PAYTM","POLICYBZR","DELHIVERY","MAPMYINDIA",
  "IRCTC","RVNL","IRCON","RAILVIKAS","TITAGARH","TEXRAIL",
  "AUROPHARMA","ALKEM","LUPIN","IPCALAB","GLENMARK","GRANULES",
  "NATCOPHARM","AJANTPHARM","SANOFI","PFIZER","ABBOTINDIA","GLAXO",
  "BIOCON","LAURUSLABS","DIVIS","TORNTPHARM","JBCHEPHARM","GLAND",
  "CONCOR","ADANIGREEN","ADANITRANS","ADANIPOWER","TATAPOWER","CESC",
  "TORNTPOWER","NHPC","SJVN","GMRINFRA","NAVINFLUOR","DEEPAKNTR",
  "AARTIIND","VINDHYATEL","GUJGASLTD","MGL","IGL","PETRONET","GSPL",
  "CHAMBLFERT","COROMANDEL","PIIND","UPL","RALLIS","DHANUKA","ASTRAL",
  "SUPREMEIND","ATUL","SRF","GARFIBRES","BALKRISIND","MRF","CEATLTD",
  "APOLLOTYRE","JKTYRE","MOTHERSON","BOSCHLTD","SCHAEFFLER","TIMKEN",
  "SKFINDIA","GRINDWELL","CARBORUNIV","CUMMINSIND","THERMAX","ABB",
  "SIEMENS","HAVELLS","VOLTAS","BLUESTARCO","WHIRLPOOL","CROMPTON",
  "ORIENTELEC","POLYCAB","KEI","FINOLEX","SCHNEIDER","CGPOWER","BHEL",
  "BEL","HAL","BEML","MTAR","PARAS","ZYDUSLIFE","STAR","NAUKRI",
  "INDHOTEL","LEMONTRE","CHALET","EIH","MAHINDRA","TRENT","VEDL",
  "HINDZINC","NATIONALUM","SAIL","NMDC","MOIL","GMMPFAUDLR"
].map(s => s + ".NS");

// Index symbols
const INDEX_SYMBOLS = [
  { yahoo: "^NSEI",   label: "NIFTY 50"  },
  { yahoo: "^NSEBANK",label: "NIFTY BANK"}
];

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept":     "application/json"
};

const nseHistory = {};
let nseResults   = [];
let nseIndices   = [];
let nseTotal     = 0;
let nseReady     = false;
let nseLastFetch = null;

// Fetch a batch of symbols from Yahoo Finance
async function fetchYahooBatch(symbols) {
  const joined = symbols.join(",");
  const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}&fields=regularMarketPrice,regularMarketVolume,regularMarketChangePercent`;
  const { data } = await axios.get(url, {
    headers: YAHOO_HEADERS,
    timeout: 15000
  });
  return data?.quoteResponse?.result || [];
}

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

    // ── Fetch FNO stocks in batches of 50 ────────────────
    const BATCH = 50;
    const fnoResults = [];
    nseTotal = 0;

    for (let i = 0; i < FNO_SYMBOLS.length; i += BATCH) {
      const batch = FNO_SYMBOLS.slice(i, i + BATCH);
      try {
        const quotes = await fetchYahooBatch(batch);
        for (const q of quotes) {
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
        // Small delay between batches to avoid rate limiting
        if (i + BATCH < FNO_SYMBOLS.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch(e) {
        console.error(`Yahoo batch error (${i}):`, e.message);
      }
    }

    nseResults   = fnoResults.sort((a, b) => b.score - a.score).slice(0, 5);
    nseReady     = fnoResults.length > 0;
    nseLastFetch = Date.now();
    nseTotal     = fnoResults.length;

    // ── Fetch Nifty 50 & Bank Nifty ──────────────────────
    try {
      const idxQuotes = await fetchYahooBatch(INDEX_SYMBOLS.map(i => i.yahoo));
      nseIndices = [];
      for (const target of INDEX_SYMBOLS) {
        const q = idxQuotes.find(x => x.symbol === target.yahoo);
        if (!q) continue;
        const price = parseFloat(q.regularMarketPrice || 0);
        const vol   = parseFloat(q.regularMarketVolume || 0);
        if (!price) continue;
        const res = computeScore(target.label, price, vol, now);
        if (res) {
          nseIndices.push({
            symbol: target.label, price: res.newP,
            priceChange: res.pc, volumeChange: res.vc,
            score: res.score, totalVolume: res.newV,
            isIndex: true, warming: false
          });
        } else {
          nseIndices.push({
            symbol: target.label, price,
            priceChange: parseFloat(q.regularMarketChangePercent || 0),
            volumeChange: 0, score: 0, totalVolume: vol,
            isIndex: true, warming: true
          });
        }
      }
    } catch(e) {
      console.error("Index fetch error:", e.message);
    }

    console.log(`\n📈 NSE FNO TOP 5 (${nseTotal} stocks):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(16)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`);
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
    ok: true, total: nseTotal,
    top5: nseResults, indices: nseIndices,
    ready: nseReady, ts: nseLastFetch
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
  res.json({ name: "QuantSigma API v5.3", endpoints: ["/api/momentum", "/api/nse"] });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner v5.3 starting...\n");

  // Crypto
  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, REFRESH * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  // NSE via Yahoo Finance — runs every 10 seconds
  // First tick after 5 seconds
  setTimeout(async () => {
    await tickNSE();
    setInterval(tickNSE, REFRESH * 1000);
  }, 5000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum`);
  console.log(`📈 NSE FNO → /api/nse (Yahoo Finance)\n`);
});
