// ============================================================
//  QuantSigma — Scanner Server v5.1
//  Scanner 1 : Crypto Futures (Binance USDT-M Perpetuals)
//  Scanner 2 : Indian FNO Stocks (NSE) + Nifty & BankNifty
//  Formula   : Score = PriceChange × 0.6 + VolumeChange × 0.4
//  Window    : 5-min rolling (same logic as crypto)
// ============================================================

const express = require("express");
const axios   = require("axios");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// Open CORS — scanner data is public, no sensitive info exposed
app.use(cors());
app.options('*', cors()); // Handle preflight for all routes

// ══════════════════════════════════════════════════════════
//  SCANNER 1 — CRYPTO FUTURES (Binance)
// ══════════════════════════════════════════════════════════
const BAPI    = "https://fapi.binance.com";
const WINDOW  = 300;  // 5-min rolling window (seconds)
const REFRESH = 10;   // poll every 10 seconds

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
//  SCANNER 2 — INDIAN FNO STOCKS + INDICES (NSE)
// ══════════════════════════════════════════════════════════
const NSE_FNO_URL = "https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O";
const NSE_IDX_URL = "https://www.nseindia.com/api/allIndices";

const NSE_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer":         "https://www.nseindia.com/market-data/securities-available-for-trading",
  "Connection":      "keep-alive",
  "Cache-Control":   "no-cache",
};

let nseCookies   = "";
const nseHistory = {};
let nseResults   = [];
let nseIndices   = [];  // Fixed rows: Nifty 50 + Bank Nifty
let nseTotal     = 0;
let nseReady     = false;
let nseLastFetch = null;

async function getNSECookies() {
  try {
    const resp = await axios.get("https://www.nseindia.com", {
      headers: NSE_HEADERS, timeout: 15000, maxRedirects: 5
    });
    const raw = resp.headers["set-cookie"];
    if (raw) {
      nseCookies = raw.map(c => c.split(";")[0]).join("; ");
      console.log("✅ NSE: Cookies refreshed");
    }
  } catch(e) {
    console.error("NSE cookie error:", e.message);
  }
}

// ── Helper: update rolling history and compute score ─────
function computeScore(symbol, price, vol, now) {
  if (!nseHistory[symbol]) nseHistory[symbol] = [];
  nseHistory[symbol].push([now, price, vol]);
  nseHistory[symbol] = nseHistory[symbol].filter(x => now - x[0] < WINDOW);

  const h = nseHistory[symbol];
  if (h.length < 2) return null; // not enough data yet

  const [, oldP, oldV] = h[0];
  const [, newP, newV] = h[h.length - 1];
  if (!oldP) return null;

  const pc = ((newP - oldP) / oldP) * 100;
  const vc = oldV ? ((newV - oldV) / oldV) * 100 : 0;
  return { pc, vc, score: (pc * 0.6) + (vc * 0.4), newP, newV };
}

async function tickNSE() {
  try {
    if (!nseCookies) await getNSECookies();

    const now = Date.now() / 1000;

    // ── Fetch FNO stocks ──────────────────────────────────
    const { data: fnoData } = await axios.get(NSE_FNO_URL, {
      headers: { ...NSE_HEADERS, "Cookie": nseCookies },
      timeout: 15000
    });

    nseTotal = 0;
    const fnoResults = [];

    if (fnoData && fnoData.data) {
      for (const stock of fnoData.data) {
        try {
          if (!stock.symbol ||
              stock.symbol.startsWith("NIFTY") ||
              stock.symbol.startsWith("SENSEX")) continue;

          const price = parseFloat(stock.lastPrice?.toString().replace(/,/g, "") || 0);
          const vol   = parseFloat(stock.totalTradedVolume?.toString().replace(/,/g, "") || 0);
          if (!price || !vol) continue;

          nseTotal++;
          const res = computeScore(stock.symbol, price, vol, now);
          if (!res) continue;

          fnoResults.push({
            symbol:       stock.symbol,
            price:        res.newP,
            priceChange:  res.pc,
            volumeChange: res.vc,
            score:        res.score,
            totalVolume:  res.newV
          });
        } catch(_) {}
      }
    }

    nseResults   = fnoResults.sort((a, b) => b.score - a.score).slice(0, 5);
    nseReady     = fnoResults.length > 0;
    nseLastFetch = Date.now();

    // ── Fetch Nifty 50 & Bank Nifty ──────────────────────
    try {
      const { data: idxData } = await axios.get(NSE_IDX_URL, {
        headers: { ...NSE_HEADERS, "Cookie": nseCookies },
        timeout: 10000
      });

      nseIndices = [];

      if (idxData && idxData.data) {
        // Targets: Nifty 50 and Nifty Bank
        const targets = [
          { key: "NIFTY 50",   label: "NIFTY 50"   },
          { key: "NIFTY BANK", label: "NIFTY BANK"  }
        ];

        for (const target of targets) {
          const idx = idxData.data.find(i => i.index === target.key);
          if (!idx) continue;

          const price = parseFloat(idx.last || idx.lastPrice || 0);
          const vol   = parseFloat(idx.totalTradedVolume || 0);
          if (!price) continue;

          const res = computeScore(target.label, price, vol, now);

          if (res) {
            // Full rolling window score available
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
            // Not enough history yet — show day change as placeholder
            nseIndices.push({
              symbol:       target.label,
              price:        price,
              priceChange:  parseFloat(idx.percentChange || idx.pChange || 0),
              volumeChange: 0,
              score:        0,
              totalVolume:  vol,
              isIndex:      true,
              warming:      true  // indicates rolling score not ready yet
            });
          }
        }
      }
    } catch(e) {
      console.error("Index fetch error:", e.message);
    }

    console.log(`\n📈 NSE FNO TOP 5 (${nseTotal} stocks):`);
    for (const r of nseResults) {
      console.log(`  ${r.symbol.padEnd(16)} Price: ${r.priceChange.toFixed(2)}% | Score: ${r.score.toFixed(2)}`);
    }
    console.log(`📊 Indices: ${nseIndices.map(i => `${i.symbol} ${i.priceChange.toFixed(2)}%`).join(' | ')}`);

  } catch(e) {
    console.error("NSE tick error:", e.message);
    // Don't crash — just reset cookies and continue
    nseCookies = "";
    nseLastFetch = Date.now();
  }
}

// ══════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════

// Crypto scanner
app.get("/api/momentum", (req, res) => {
  res.json({ ok: true, total: cryptoTotal, top5: cryptoResults, ts: cryptoLastFetch });
});

// NSE FNO scanner + indices
app.get("/api/nse", (req, res) => {
  res.json({
    ok:      true,
    total:   nseTotal,
    top5:    nseResults,
    indices: nseIndices,   // Always contains Nifty 50 & Bank Nifty
    ready:   nseReady,
    ts:      nseLastFetch
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
  res.json({ name: "QuantSigma API v5.1", endpoints: ["/api/momentum", "/api/nse"] });
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
(async () => {
  try {
    console.log("\n🚀 QuantSigma Scanner v5.1 starting...\n");

    // Crypto
    await loadCryptoSymbols();
    await tickCrypto();
    setInterval(tickCrypto, REFRESH * 1000);
    setInterval(loadCryptoSymbols, 6 * 60 * 60 * 1000);

    // NSE (small delay to stagger startup)
    setTimeout(async () => {
      await getNSECookies();
      await tickNSE();
      setInterval(tickNSE, REFRESH * 1000);
      setInterval(getNSECookies, 30 * 60 * 1000); // refresh cookies every 30 min
    }, 3000);

  } catch(e) {
    console.error("Startup error:", e.message);
    process.exit(1);
  }
})();
// Prevent server crash on unhandled errors
process.on('uncaughtException', (e) => {
  console.error('Uncaught Exception:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('Unhandled Rejection:', e.message);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ Server on port ${PORT}`);
  console.log(`📡 Crypto  → /api/momentum`);
  console.log(`📈 NSE FNO → /api/nse (includes Nifty 50 & Bank Nifty)\n`);
});
