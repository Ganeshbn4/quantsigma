// ============================================================
//  QuantSigma — Scanner Server
//  Scanner 1 : Crypto Futures (Binance)  — every 10s
//  Scanner 2 : NSE FNO (Yahoo download)  — every 5 min
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
        .filter(s => s.underlyingType==="COIN" && s.contractType==="PERPETUAL" && s.status==="TRADING" && s.symbol.endsWith("USDT"))
        .map(s => s.symbol)
    );
    console.log(`✅ Crypto: Loaded ${cryptoSymbols.size} symbols`);
  } catch(e) { console.error("Crypto symbol load error:", e.message); }
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
    for (const sym of Object.keys(cryptoHistory)) {
      const h = cryptoHistory[sym];
      if (h.length < 2) continue;
      const [,oldP,oldV] = h[0], [,newP,newV] = h[h.length-1];
      if (!oldP || !oldV) continue;
      const pc = ((newP-oldP)/oldP)*100, vc = ((newV-oldV)/oldV)*100;
      results.push({ symbol:sym, price:newP, priceChange:pc, volumeChange:vc, score:(pc*0.6)+(vc*0.4), qVol:newV });
    }
    cryptoResults   = results.sort((a,b) => b.score-a.score).slice(0,5);
    cryptoLastFetch = Date.now();
    console.log("\n🔥 CRYPTO TOP 5:");
    cryptoResults.forEach(r => console.log(`  ${r.symbol.padEnd(14)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`));
  } catch(e) { console.error("Crypto tick error:", e.message); }
}

// ══════════════════════════════════════════════════════════
//  SCANNER 2 — NSE FNO via Yahoo Finance download endpoint
//  Mirrors exactly what yfinance.download() does in Python
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
  "GRINDWELL","IPCALAB","JBCHEPHARM","JKPAPER","JUBLINGREA",
  "LINDEINDIA","NIACL","NUVOCO","OLECTRA","ORIENTCEM",
  "PGHH","PIIND","PRINCEPIPE","QUESS","RADICO",
  "ROUTE","SAREGAMA","SEQUENT","SPARC","STLTECH","SUMICHEM",
  "SUPREMEIND","TRIDENT","UJJIVAN","WHIRLPOOL","AMARAJABAT",
  "APOLLOTYRE","ATUL","BAJAJELEC","CESC","CHAMBLFERT","CONCOR",
  "COROMANDEL","CROMPTON","CUB","DALBHARAT","DELTACORP","EIDPARRY",
  "EXIDEIND","GNFC","GSPL","INDUSTOWER","INOXLEISUR",
  "INTELLECT","JINDALSTEL","JUSTDIAL","MCDOWELL-N",
  "MOTHERSON","MFSL","NAUKRI","NAVINFLUOR",
  "PCBL","PEL","PFIZER","PRAJIND","SCI","SHYAMMETL",
  "STARHEALTH","SRTRANSFIN","TCNSBRANDS","TIMKEN",
  "TTML","UCOBANK","UJJIVANSFB","USHAMART","VAIBHAVGBL",
  "VINATIORGA","VIPIND","WELSPUNLIV","MINDTREE","NAUKRI"
];

const BATCH_SIZE  = 50;   // same as your Python script
const SLEEP_MS    = 500;  // 0.5s between batches — same as Python

// Previous snapshot for delta calculation
let nsePrevSnapshot = {};
let nseResults      = [];
let nseIndices      = [];
let nseTotal        = 0;
let nseReady        = false;
let nseLastFetch    = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Mirrors yf.download(tickers, period="1d", interval="1m")
// Uses Yahoo's chart API — same data source, same endpoint yfinance uses internally
async function fetchBatch(symbols) {
  // Fetch each symbol's latest 1d 1m data and extract last close+volume
  const results = {};

  await Promise.all(symbols.map(async sym => {
    const ticker = `${sym}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent":  "python-requests/2.31.0",  // mimic yfinance exactly
          "Accept":      "*/*",
          "Accept-Encoding": "gzip, deflate"
        }
      });
      const res    = data?.chart?.result?.[0];
      const meta   = res?.meta;
      const quotes = res?.indicators?.quote?.[0];
      if (!meta || !quotes) return;

      const closes  = quotes.close  || [];
      const volumes = quotes.volume || [];

      // Get last valid close and volume
      let price = null, volume = 0;
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] && closes[i] > 0) { price = closes[i]; break; }
      }
      for (let i = volumes.length - 1; i >= 0; i--) {
        if (volumes[i] && volumes[i] > 0) { volume = volumes[i]; break; }
      }
      if (price) results[sym] = { price, volume };
    } catch(_) {}
  }));

  return results;
}

async function fetchIndices() {
  const idxMap = { "^NSEI": "NIFTY 50", "^NSEBANK": "NIFTY BANK" };
  const results = {};
  for (const [ticker, label] of Object.entries(idxMap)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "python-requests/2.31.0", "Accept": "*/*" }
      });
      const res    = data?.chart?.result?.[0];
      const quotes = res?.indicators?.quote?.[0];
      if (!quotes) continue;
      const closes  = quotes.close  || [];
      const volumes = quotes.volume || [];
      let price = null, volume = 0;
      for (let i = closes.length-1; i >= 0; i--) { if (closes[i]>0) { price=closes[i]; break; } }
      for (let i = volumes.length-1; i >= 0; i--) { if (volumes[i]>0) { volume=volumes[i]; break; } }
      if (price) results[label] = { price, volume };
    } catch(_) {}
  }
  return results;
}

async function tickNSE() {
  try {
    console.log("\n📡 NSE: Fetching via Yahoo chart API (yfinance-style)...");
    const now = Date.now();

    // Fetch in batches of 50 with 0.5s sleep between — same as your Python
    const newSnapshot = {};
    let fetched = 0;

    for (let i = 0; i < FNO_SYMBOLS.length; i += BATCH_SIZE) {
      const batch   = FNO_SYMBOLS.slice(i, i + BATCH_SIZE);
      const results = await fetchBatch(batch);
      Object.assign(newSnapshot, results);
      fetched += Object.keys(results).length;
      if (i + BATCH_SIZE < FNO_SYMBOLS.length) await sleep(SLEEP_MS);
    }

    nseTotal = fetched;
    const fnoResults = [];

    for (const [sym, q] of Object.entries(newSnapshot)) {
      const prev = nsePrevSnapshot[sym];
      if (!prev) continue;
      const pc    = ((q.price  - prev.price)  / prev.price)  * 100;
      const vc    = prev.volume > 0 ? ((q.volume - prev.volume) / prev.volume) * 100 : 0;
      const score = (pc * 0.6) + (vc * 0.4);
      fnoResults.push({ symbol:sym, price:q.price, priceChange:pc, volumeChange:vc, score, totalVolume:q.volume });
    }

    nsePrevSnapshot = newSnapshot;
    nseResults      = fnoResults.sort((a,b) => b.score-a.score).slice(0,5);
    nseReady        = fnoResults.length > 0;
    nseLastFetch    = now;

    // Indices
    const idxData = await fetchIndices();
    nseIndices = [];
    for (const [label, q] of Object.entries(idxData)) {
      const prev = nsePrevSnapshot[label];
      nsePrevSnapshot[label] = q;
      if (prev) {
        const pc    = ((q.price - prev.price) / prev.price) * 100;
        const vc    = prev.volume > 0 ? ((q.volume - prev.volume) / prev.volume) * 100 : 0;
        nseIndices.push({ symbol:label, price:q.price, priceChange:pc, volumeChange:vc, score:(pc*0.6)+(vc*0.4), totalVolume:q.volume, isIndex:true, warming:false });
      } else {
        nseIndices.push({ symbol:label, price:q.price, priceChange:0, volumeChange:0, score:0, totalVolume:q.volume, isIndex:true, warming:true });
      }
    }

    if (nseReady) {
      console.log(`📈 NSE FNO TOP 5 (${nseTotal} stocks scanned):`);
      nseResults.forEach(r => console.log(`  ${r.symbol.padEnd(16)} ₹${r.price.toFixed(2)} | Score: ${r.score.toFixed(2)}`));
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
  res.json({ ok:true, total:cryptoTotal, top5:cryptoResults, ts:cryptoLastFetch });
});
app.get("/api/nse", (req, res) => {
  res.json({ ok:true, total:nseTotal, top5:nseResults, indices:nseIndices, ready:nseReady, ts:nseLastFetch });
});
app.get("/health", (req, res) => res.json({ status:"ok", uptime:process.uptime() }));
app.get("/",       (req, res) => res.json({ name:"QuantSigma Scanner API", endpoints:["/api/momentum","/api/nse"] }));

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  console.log("\n🚀 QuantSigma Scanner starting...\n");

  await loadCryptoSymbols();
  await tickCrypto();
  setInterval(tickCrypto, 10 * 1000);
  setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

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
