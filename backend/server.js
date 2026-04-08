// ============================================================
//  QuantSigma — Scanner Server
//  Scanner 1 : Crypto Futures (Binance)  — every 10s
//  Scanner 2 : Indian FNO Stocks (Yahoo Finance) — every 10s
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
//  SCANNER 2 — INDIAN FNO STOCKS (Yahoo Finance)
//  No cookies, no IP blocking, works from Railway
// ══════════════════════════════════════════════════════════

// Full NSE FNO stock list (Yahoo Finance uses SYMBOL.NS format)
const FNO_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL",
  "ITC","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","HCLTECH","SUNPHARMA",
  "TITAN","ULTRACEMCO","BAJFINANCE","WIPRO","NESTLEIND","POWERGRID","NTPC","TECHM",
  "ONGC","JSWSTEEL","TATASTEEL","COALINDIA","ADANIPORTS","BAJAJFINSV","DIVISLAB",
  "DRREDDY","EICHERMOT","GRASIM","HEROMOTOCO","HINDALCO","INDUSINDBK","M&M",
  "SBILIFE","TATACONSUM","TATAMOTORS","UPL","VEDL","BPCL","CIPLA","GAIL",
  "HAVELLS","PIDILITIND","SIEMENS","AMBUJACEM","APOLLOHOSP","AUROPHARMA",
  "BALKRISIND","BANDHANBNK","BANKBARODA","BEL","BERGEPAINT","BHEL","BIOCON",
  "BOSCHLTD","BRITANNIA","CANBK","CHOLAFIN","COLPAL","CONCOR","COROMANDEL",
  "CROMPTON","CUB","DABUR","DALBHARAT","DEEPAKNTR","DELTACORP","ESCORTS",
  "EXIDEIND","FEDERALBNK","GMRINFRA","GNFC","GRANULES","GSPL","HDFCAMC",
  "HDFCLIFE","HINDCOPPER","HINDPETRO","IBULHSGFIN","ICICIlombard","ICICIGI",
  "IDFCFIRSTB","IGL","INDHOTEL","INDUSTOWER","INFRATEL","INOXLEISUR","IOC",
  "IPCALAB","IRCTC","JINDALSTEL","JUBLFOOD","JUSTDIAL","LALPATHLAB","LAURUSLABS",
  "LICHSGFIN","LUPIN","MANAPPURAM","MARICO","MCDOWELL-N","METROPOLIS",
  "MFSL","MINDTREE","MOTHERSON","MPHASIS","MRF","MUTHOOTFIN","NATIONALUM",
  "NAVINFLUOR","NMDC","OBEROIRLTY","OFSS","PEL","PETRONET","PFC","PFIZER",
  "PHILIPCARB","PNB","POLYCAB","PAGEIND","PERSISTENT","PIIND","PVRINOX",
  "RAMCOCEM","RBLBANK","RECLTD","SAIL","SCHAEFFLER","SFL","SHREECEM",
  "SHRIRAMFIN","SONACOMS","STARHEALTH","SYNGENE","TATACHEM","TATACOMM",
  "TATAELXSI","TATAPOWER","TRENT","TRIDENT","UBL","UJJIVAN","VOLTAS",
  "WHIRLPOOL","ZEEL","ZYDUSLIFE","ABCAPITAL","ABFRL","ACC","AARTIIND",
  "ADANIENT","ADANIGREEN","ADANIPOWER","ALKEM","ANGELONE","ASHOKLEY",
  "ATGL","AUBANK","AWHCL","BAJAJ-AUTO","BATAINDIA","CAMS","CANFINHOME",
  "CAPLIPOINT","CARBORUNIV","CASTROLIND","CESC","CHAMBLFERT","CLEAN",
  "CUMMINSIND","CYIENT","DIXON","DLF","DMART","EIDPARRY","EMAMILTD",
  "ENDURANCE","ENGINERSIN","EQUITAS","ETERNAL","FACT","FINPIPE","FLUOROCHEM",
  "FORTIS","FSL","GLENMARK","GODREJCP","GODREJPROP","GPPL","GRINDWELL",
  "HAL","HFCL","HONAUT","HUDCO","ICICIPRULI","IDFC","IEFINDIA","IFCI",
  "IMFA","INDIAMART","INDIANB","INDIGO","INTELLECT","ISGEC","ITI",
  "JBCHEPHARM","JINDALPOLY","JKCEMENT","JKLAKSHMI","JKPAPER","JMFINANCIL",
  "JSWENERGY","JTEKTINDIA","JUBLINGREA","KAJARIACER","KEC","KPITTECH",
  "KPRMILL","KRBL","KRISHANA","L&TFH","LATENTVIEW","LICI","LINDEINDIA",
  "LODHA","LTIM","LTTS","LUXIND","MAHABANK","MAHLIFE","MANKIND",
  "MCX","MEDANTA","METROBRAND","MIDHANI","MMTC","MOTILALOFS","MSSL",
  "NATCOPHARM","NBCC","NCC","NIACL","NLCINDIA","NUVOCO","OIL","OLECTRA",
  "OPTIEMUS","ORIENTCEM","PAYTM","PGHH","PNBHOUSING","POLICYBZR",
  "POLYMED","PRAJIND","PRESTIGE","PRINCEPIPE","PSB","QUESS","RADICO",
  "RAILTEL","RAJESHEXPO","RITES","ROUTE","SAFARI","SAREGAMA","SCI",
  "SEQUENT","SHYAMMETL","SJVN","SOBHA","SPARC","SRTRANSFIN","STLTECH",
  "SUMICHEM","SUPRIYA","SUPREMEIND","SUZLON","SWANENERGY","TANLA",
  "TATATECH","TCNSBRANDS","TEJASNET","THYROCARE","TIINDIA","TIMKEN",
  "TORNTPHARM","TORNTPOWER","TTML","TVSHLTD","UCOBANK","UJJIVANSFB",
  "UNIONBANK","UNOMINDA","USHAMART","UTTAMSUGAR","VAIBHAVGBL","VBL",
  "VGUARD","VINATIORGA","VIPIND","WELCORP","WELSPUNLIV","WIPRO","ZOMATO"
];

// Indices to show always
const NSE_INDICES = [
  { symbol: "NIFTY 50",   yahoo: "^NSEI"  },
  { symbol: "NIFTY BANK", yahoo: "^NSEBANK" }
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

// Fetch a batch of Yahoo Finance quotes in one request
async function fetchYahooBatch(symbols) {
  // Yahoo supports up to 100 symbols in one call
  const joined = symbols.map(s => s + ".NS").join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}&fields=regularMarketPrice,regularMarketVolume,regularMarketChangePercent`;
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    });
    return data?.quoteResponse?.result || [];
  } catch(e) {
    console.error("Yahoo batch error:", e.message);
    return [];
  }
}

// Fetch Nifty 50 & Bank Nifty from Yahoo
async function fetchYahooIndices() {
  try {
    const joined = NSE_INDICES.map(i => i.yahoo).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}&fields=regularMarketPrice,regularMarketVolume,regularMarketChangePercent`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    return data?.quoteResponse?.result || [];
  } catch(e) {
    console.error("Yahoo indices error:", e.message);
    return [];
  }
}

async function tickNSE() {
  try {
    const now = Date.now() / 1000;

    // ── Fetch FNO stocks in batches of 100 ──────────────
    const BATCH = 100;
    let allQuotes = [];
    for (let i = 0; i < FNO_SYMBOLS.length; i += BATCH) {
      const batch = FNO_SYMBOLS.slice(i, i + BATCH);
      const quotes = await fetchYahooBatch(batch);
      allQuotes = allQuotes.concat(quotes);
    }

    nseTotal = 0;
    const fnoResults = [];

    for (const q of allQuotes) {
      try {
        const rawSym = q.symbol?.replace(".NS", "") || "";
        if (!rawSym) continue;
        const price = q.regularMarketPrice;
        const vol   = q.regularMarketVolume;
        if (!price || price <= 0) continue;
        nseTotal++;
        const res = computeNSEScore(rawSym, price, vol || 0, now);
        if (!res) continue;
        fnoResults.push({
          symbol:       rawSym,
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

    // ── Fetch indices ────────────────────────────────────
    const idxQuotes = await fetchYahooIndices();
    nseIndices = [];
    for (const target of NSE_INDICES) {
      const q = idxQuotes.find(x => x.symbol === target.yahoo);
      if (!q) continue;
      const price = q.regularMarketPrice;
      const vol   = q.regularMarketVolume || 0;
      if (!price) continue;
      const res = computeNSEScore(target.symbol, price, vol, now);
      if (res) {
        nseIndices.push({
          symbol: target.symbol, price: res.newP,
          priceChange: res.pc, volumeChange: res.vc,
          score: res.score, totalVolume: res.newV,
          isIndex: true, warming: false
        });
      } else {
        nseIndices.push({
          symbol: target.symbol, price,
          priceChange: q.regularMarketChangePercent || 0,
          volumeChange: 0, score: 0, totalVolume: vol,
          isIndex: true, warming: true
        });
      }
    }

    console.log(`\n📈 NSE FNO TOP 5 (${nseTotal} stocks via Yahoo):`);
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

  // NSE via Yahoo — every 10 seconds
  setTimeout(async () => {
    await tickNSE();
    setInterval(tickNSE, 10 * 1000);
  }, 3000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum`);
  console.log(`📈 NSE FNO → /api/nse\n`);
});
