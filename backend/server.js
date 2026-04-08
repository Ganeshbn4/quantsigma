// ============================================================
//  QuantSigma — Scanner Server
//  Scanner 1 : Crypto Futures (Binance)  — every 10s
//  Scanner 2 : NSE FNO (Yahoo Finance)   — every 5 min
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
//  SCANNER 2 — NSE FNO (Yahoo Finance, every 5 min)
//  Simple: fetch all stocks once, calc score, store top 5
// ══════════════════════════════════════════════════════════

const FNO_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL",
  "ITC","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","HCLTECH","SUNPHARMA",
  "TITAN","ULTRACEMCO","BAJFINANCE","WIPRO","NESTLEIND","POWERGRID","NTPC","TECHM",
  "ONGC","JSWSTEEL","TATASTEEL","COALINDIA","ADANIPORTS","BAJAJFINSV","DIVISLAB",
  "DRREDDY","EICHERMOT","GRASIM","HEROMOTOCO","HINDALCO","INDUSINDBK",
  "SBILIFE","TATACONSUM","TATAMOTORS","VEDL","BPCL","CIPLA","GAIL",
  "HAVELLS","PIDILITIND","AMBUJACEM","APOLLOHOSP","AUROPHARMA","BALKRISIND",
  "BANDHANBNK","BANKBARODA","BEL","BHEL","BIOCON","BRITANNIA","CANBK",
  "CHOLAFIN","COLPAL","DABUR","DEEPAKNTR","ESCORTS","FEDERALBNK",
  "GRANULES","HDFCAMC","HDFCLIFE","HINDCOPPER","HINDPETRO","IDFCFIRSTB",
  "IGL","INDHOTEL","IOC","IRCTC","JUBLFOOD","LALPATHLAB","LAURUSLABS",
  "LICHSGFIN","LUPIN","MANAPPURAM","MARICO","METROPOLIS","MPHASIS","MRF",
  "MUTHOOTFIN","NATIONALUM","NMDC","OBEROIRLTY","OFSS","PETRONET","PFC",
  "PNB","POLYCAB","PAGEIND","PERSISTENT","PVRINOX","RAMCOCEM","RBLBANK",
  "RECLTD","SAIL","SHREECEM","SHRIRAMFIN","SYNGENE","TATACHEM","TATACOMM",
  "TATAELXSI","TATAPOWER","TRENT","UBL","VOLTAS","ZEEL","ZYDUSLIFE",
  "ABCAPITAL","ACC","ALKEM","ASHOKLEY","AUBANK","BAJAJ-AUTO","BATAINDIA",
  "DIXON","DLF","DMART","EMAMILTD","FORTIS","GLENMARK","GODREJCP",
  "GODREJPROP","HAL","HUDCO","IDFC","INDIAMART","INDIANB","INDIGO",
  "JKCEMENT","JSWENERGY","KAJARIACER","KEC","KPITTECH","LICI","LODHA",
  "LTIM","LTTS","LUXIND","MANKIND","MCX","MOTILALOFS","NATCOPHARM",
  "NBCC","NCC","NLCINDIA","OIL","PAYTM","PNBHOUSING","POLICYBZR",
  "PRESTIGE","RAILTEL","RITES","SAFARI","SJVN","SOBHA","SUZLON",
  "TANLA","TATATECH","TIINDIA","TORNTPHARM","TORNTPOWER","TVSHLTD",
  "UNIONBANK","UNOMINDA","VBL","VGUARD","WELCORP","ZOMATO",
  "ADANIENT","ADANIGREEN","ADANIPOWER","ANGELONE","ATGL","CAMS","CANFINHOME",
  "CLEAN","CUMMINSIND","CYIENT","ENDURANCE","EQUITAS","FLUOROCHEM",
  "GODREJPROP","GRINDWELL","IPCALAB","JBCHEPHARM","JKPAPER","JUBLINGREA",
  "KRBL","LINDEINDIA","MEDANTA","NIACL","NUVOCO","OLECTRA","ORIENTCEM",
  "PGHH","PHILIPCARB","PIIND","POLYCAB","PRINCEPIPE","QUESS","RADICO",
  "ROUTE","SAREGAMA","SEQUENT","SOBHA","SPARC","STLTECH","SUMICHEM",
  "SUPREMEIND","TRENT","TRIDENT","UJJIVAN","WHIRLPOOL","AMARAJABAT",
  "APOLLOTYRE","ATUL","BAJAJELEC","BSOFT","CESC","CHAMBLFERT","CONCOR",
  "COROMANDEL","CROMPTON","CUB","DALBHARAT","DELTACORP","EIDPARRY",
  "EXIDEIND","GNFC","GSPL","IBULHSGFIN","INDUSTOWER","INOXLEISUR",
  "INTELLECT","ISGEC","ITI","JINDALSTEL","JUSTDIAL","MCDOWELL-N",
  "MINDTREE","MOTHERSON","MFSL","NAUKRI","NAVINFLUOR","OBEROIRLTY",
  "PCBL","PEL","PFIZER","PRAJIND","RBLBANK","SCI","SHYAMMETL",
  "SJVN","STARHEALTH","SRTRANSFIN","TATAPOWER","TCNSBRANDS","TEJASNET",
  "TIMKEN","TTML","UCOBANK","UJJIVANSFB","USHAMART","VAIBHAVGBL",
  "VINATIORGA","VIPIND","WELSPUNLIV"
];

// Previous snapshot for score calculation (price & volume from last fetch)
let nsePrevSnapshot = {}; // { symbol: { price, volume } }
let nseResults      = [];
let nseIndices      = [];
let nseTotal        = 0;
let nseReady        = false;
let nseLastFetch    = null;

// Yahoo Finance uses query2 with these headers — works from server IPs
async function fetchYahooQuotes(symbols) {
  // Yahoo v8 finance/spark or use /quote endpoint with proper headers
  const joined = symbols.map(s => `${s}.NS`).join("%2C");
  const url = `https://query2.finance.yahoo.com/v8/finance/spark?symbols=${joined}&range=1d&interval=5m`;
  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":          "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         "https://finance.yahoo.com/",
        "Origin":          "https://finance.yahoo.com"
      }
    });
    return data?.spark?.result || [];
  } catch(e) {
    console.error("Yahoo spark error:", e.response?.status, e.message);
    return [];
  }
}

async function fetchYahooIndices() {
  const symbols = ["%5ENSEI", "%5ENSEBANK"]; // ^NSEI, ^NSEBANK URL-encoded
  const joined  = symbols.join("%2C");
  const url = `https://query2.finance.yahoo.com/v8/finance/spark?symbols=${joined}&range=1d&interval=5m`;
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer":    "https://finance.yahoo.com/"
      }
    });
    return data?.spark?.result || [];
  } catch(e) {
    console.error("Yahoo index error:", e.response?.status, e.message);
    return [];
  }
}

// Extract latest close price & volume from spark response
function extractFromSpark(item) {
  try {
    const resp   = item?.response?.[0];
    const meta   = resp?.meta;
    const quotes = resp?.quotes;
    if (!meta || !quotes || quotes.length === 0) return null;
    // Get latest valid close
    const closes  = quotes.map(q => q.close).filter(v => v && v > 0);
    const volumes = quotes.map(q => q.volume).filter(v => v && v > 0);
    if (closes.length === 0) return null;
    return {
      price:  closes[closes.length - 1],
      volume: volumes.length > 0 ? volumes[volumes.length - 1] : 0
    };
  } catch(_) {
    return null;
  }
}

async function tickNSE() {
  try {
    console.log("\n📡 NSE: Fetching from Yahoo Finance (spark)...");
    const now = Date.now();

    // Fetch in batches of 50 (Yahoo spark handles ~50 at a time reliably)
    const BATCH = 50;
    let allResults = [];
    for (let i = 0; i < FNO_SYMBOLS.length; i += BATCH) {
      const batch   = FNO_SYMBOLS.slice(i, i + BATCH);
      const results = await fetchYahooQuotes(batch);
      allResults    = allResults.concat(results);
      // Small delay between batches
      if (i + BATCH < FNO_SYMBOLS.length) await new Promise(r => setTimeout(r, 500));
    }

    nseTotal = 0;
    const fnoResults  = [];
    const newSnapshot = {};

    for (const item of allResults) {
      try {
        const sym = (item.symbol || "").replace(".NS", "");
        if (!sym) continue;
        const q = extractFromSpark(item);
        if (!q || q.price <= 0) continue;

        newSnapshot[sym] = { price: q.price, volume: q.volume };
        nseTotal++;

        // Score needs previous snapshot
        const prev = nsePrevSnapshot[sym];
        if (!prev) continue; // First run — no prev data yet

        const pc    = ((q.price  - prev.price)  / prev.price)  * 100;
        const vc    = prev.volume > 0 ? ((q.volume - prev.volume) / prev.volume) * 100 : 0;
        const score = (pc * 0.6) + (vc * 0.4);

        fnoResults.push({
          symbol:       sym,
          price:        q.price,
          priceChange:  pc,
          volumeChange: vc,
          score,
          totalVolume:  q.volume
        });
      } catch(_) {}
    }

    // Save snapshot for next tick
    nsePrevSnapshot = newSnapshot;
    nseResults      = fnoResults.sort((a, b) => b.score - a.score).slice(0, 5);
    nseReady        = fnoResults.length > 0;
    nseLastFetch    = now;

    // ── Indices ──────────────────────────────────────────
    const idxResults = await fetchYahooIndices();
    const idxMap     = { "^NSEI": "NIFTY 50", "^NSEBANK": "NIFTY BANK" };
    nseIndices = [];

    for (const item of idxResults) {
      const label = idxMap[item.symbol];
      if (!label) continue;
      const q = extractFromSpark(item);
      if (!q || q.price <= 0) continue;

      const prev = nsePrevSnapshot[label];
      nsePrevSnapshot[label] = { price: q.price, volume: q.volume };

      if (prev) {
        const pc    = ((q.price - prev.price) / prev.price) * 100;
        const vc    = prev.volume > 0 ? ((q.volume - prev.volume) / prev.volume) * 100 : 0;
        const score = (pc * 0.6) + (vc * 0.4);
        nseIndices.push({
          symbol: label, price: q.price,
          priceChange: pc, volumeChange: vc,
          score, totalVolume: q.volume,
          isIndex: true, warming: false
        });
      } else {
        nseIndices.push({
          symbol: label, price: q.price,
          priceChange: 0, volumeChange: 0,
          score: 0, totalVolume: q.volume,
          isIndex: true, warming: true
        });
      }
    }

    if (nseReady) {
      console.log(`📈 NSE FNO TOP 5 (${nseTotal} stocks scanned):`);
      for (const r of nseResults) {
        console.log(`  ${r.symbol.padEnd(16)} ₹${r.price.toFixed(2)} | Score: ${r.score.toFixed(2)}`);
      }
    } else {
      console.log(`📈 NSE: ${nseTotal} stocks fetched. Scores ready next tick (5 min).`);
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

  // Crypto — every 10s
  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, 10 * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

  // NSE — every 5 minutes
  // First tick: builds snapshot. Second tick (5 min later): scores appear.
  setTimeout(async () => {
    await tickNSE();
    setInterval(tickNSE, 5 * 60 * 1000);
  }, 5000);

})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum`);
  console.log(`📈 NSE FNO → /api/nse\n`);
});
