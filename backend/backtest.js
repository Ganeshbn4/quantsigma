// ============================================================
//  QuantSigma — Backtest Engine
//  Indicators: MA, EMA, RSI, MACD, Stochastic, VWAP,
//              Bollinger Bands, Fibonacci, Volume Spike
//  Fees: 0.05% entry + 0.05% exit + user slippage
// ============================================================

const admin = require("firebase-admin");

// ── Firebase Admin Init (call once from server.js) ──────────
let db = null;
function initFirebase(serviceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  db = admin.firestore();
}

// ══════════════════════════════════════════════════════════
//  FETCH CANDLES FROM FIREBASE
// ══════════════════════════════════════════════════════════
async function fetchCandles(symbol, startDate, endDate) {
  const days    = [];
  const start   = new Date(startDate);
  const end     = new Date(endDate);
  const current = new Date(start);

  // Generate all dates in range
  while (current <= end) {
    days.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  // Fetch each day from Firebase
  const allCandles = [];
  const colRef = db.collection("candles").doc(symbol).collection("days");

  await Promise.all(days.map(async day => {
    try {
      const doc = await colRef.doc(day).get();
      if (doc.exists) {
        const data    = JSON.parse(doc.data().data);
        allCandles.push(...data);
      }
    } catch(_) {}
  }));

  // Sort by time ascending
  return allCandles.sort((a, b) => a[0] - b[0]);
}

// ══════════════════════════════════════════════════════════
//  INDICATORS
// ══════════════════════════════════════════════════════════

// Simple Moving Average
function calcSMA(prices, period) {
  const result = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result[i] = sum / period;
  }
  return result;
}

// Exponential Moving Average
function calcEMA(prices, period) {
  const result = new Array(prices.length).fill(null);
  const k      = 2 / (period + 1);
  let ema      = null;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) continue;
    if (ema === null) {
      ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      ema = prices[i] * k + ema * (1 - k);
    }
    result[i] = ema;
  }
  return result;
}

// RSI
function calcRSI(prices, period = 14) {
  const result = new Array(prices.length).fill(null);
  for (let i = period; i < prices.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = prices[j] - prices[j - 1];
      if (diff > 0) gains  += diff;
      else          losses -= diff;
    }
    const avgGain = gains  / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) { result[i] = 100; continue; }
    const rs     = avgGain / avgLoss;
    result[i]    = 100 - (100 / (1 + rs));
  }
  return result;
}

// MACD
function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast   = calcEMA(prices, fast);
  const emaSlow   = calcEMA(prices, slow);
  const macdLine  = prices.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const macdVals     = macdLine.map(v => v ?? 0);
  const signalLine   = calcEMA(macdVals, signal);
  const histogram    = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? v - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

// Stochastic %K and %D
function calcStochastic(prices, highs, lows, kPeriod = 14, dPeriod = 3) {
  const kValues = new Array(prices.length).fill(null);
  for (let i = kPeriod - 1; i < prices.length; i++) {
    const slice     = prices.slice(i - kPeriod + 1, i + 1);
    const highSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lowSlice  = lows.slice(i - kPeriod + 1, i + 1);
    const highest   = Math.max(...highSlice);
    const lowest    = Math.min(...lowSlice);
    kValues[i]      = lowest === highest ? 50 : ((prices[i] - lowest) / (highest - lowest)) * 100;
  }
  const dValues = calcSMA(kValues.map(v => v ?? 0), dPeriod);
  return { k: kValues, d: dValues };
}

// Bollinger Bands
function calcBollingerBands(prices, period = 20, stdDev = 2) {
  const middle = calcSMA(prices, period);
  const upper  = new Array(prices.length).fill(null);
  const lower  = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean  = middle[i];
    const std   = Math.sqrt(slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period);
    upper[i]    = mean + stdDev * std;
    lower[i]    = mean - stdDev * std;
  }
  return { upper, middle, lower };
}

// VWAP (resets daily)
function calcVWAP(candles) {
  const vwap        = new Array(candles.length).fill(null);
  let cumVolume     = 0;
  let cumPriceVol   = 0;
  let currentDay    = null;

  for (let i = 0; i < candles.length; i++) {
    const day = new Date(candles[i][0]).toISOString().split("T")[0];
    if (day !== currentDay) {
      cumVolume   = 0;
      cumPriceVol = 0;
      currentDay  = day;
    }
    const price   = candles[i][1]; // open price
    const volume  = candles[i][2];
    cumPriceVol  += price * volume;
    cumVolume    += volume;
    vwap[i]       = cumVolume > 0 ? cumPriceVol / cumVolume : price;
  }
  return vwap;
}

// Volume Average (rolling)
function calcVolumeAvg(volumes, period = 20) {
  return calcSMA(volumes, period);
}

// Fibonacci levels based on a lookback window
function calcFibonacciLevels(prices, lookback = 50) {
  const levels = new Array(prices.length).fill(null);
  for (let i = lookback; i < prices.length; i++) {
    const slice  = prices.slice(i - lookback, i);
    const high   = Math.max(...slice);
    const low    = Math.min(...slice);
    const diff   = high - low;
    levels[i] = {
      high,
      low,
      fib236: high - diff * 0.236,
      fib382: high - diff * 0.382,
      fib500: high - diff * 0.500,
      fib618: high - diff * 0.618,
      fib786: high - diff * 0.786,
    };
  }
  return levels;
}

// ══════════════════════════════════════════════════════════
//  SIGNAL CHECKER
// ══════════════════════════════════════════════════════════
function checkEntrySignal(i, prices, volumes, indicators, config) {
  const { entry } = config;
  const signals   = [];

  // 1. Price change %
  if (entry.priceChange?.enabled) {
    const n     = entry.priceChange.candles || 5;
    const start = i - n;
    if (start >= 0 && prices[start]) {
      const chg = ((prices[i] - prices[start]) / prices[start]) * 100;
      signals.push(entry.priceChange.direction === "up"
        ? chg >= entry.priceChange.threshold
        : chg <= -entry.priceChange.threshold
      );
    }
  }

  // 2. Volume spike
  if (entry.volumeSpike?.enabled && indicators.volAvg[i]) {
    const ratio = (volumes[i] / indicators.volAvg[i]) * 100;
    signals.push(ratio >= entry.volumeSpike.threshold);
  }

  // 3. MA crossover
  if (entry.maCross?.enabled) {
    const fast = indicators.maFast, slow = indicators.maSlow;
    if (fast[i] && slow[i] && fast[i-1] && slow[i-1]) {
      if (entry.maCross.direction === "up") {
        signals.push(fast[i] > slow[i] && fast[i-1] <= slow[i-1]);
      } else {
        signals.push(fast[i] < slow[i] && fast[i-1] >= slow[i-1]);
      }
    }
  }

  // 4. EMA crossover
  if (entry.emaCross?.enabled) {
    const fast = indicators.emaFast, slow = indicators.emaSlow;
    if (fast[i] && slow[i] && fast[i-1] && slow[i-1]) {
      if (entry.emaCross.direction === "up") {
        signals.push(fast[i] > slow[i] && fast[i-1] <= slow[i-1]);
      } else {
        signals.push(fast[i] < slow[i] && fast[i-1] >= slow[i-1]);
      }
    }
  }

  // 5. RSI
  if (entry.rsi?.enabled && indicators.rsi[i] !== null) {
    if (entry.rsi.condition === "oversold") {
      signals.push(indicators.rsi[i] < entry.rsi.level);
    } else {
      signals.push(indicators.rsi[i] > entry.rsi.level);
    }
  }

  // 6. MACD crossover
  if (entry.macd?.enabled) {
    const { macdLine, signalLine } = indicators.macd;
    if (macdLine[i] && signalLine[i] && macdLine[i-1] && signalLine[i-1]) {
      if (entry.macd.direction === "up") {
        signals.push(macdLine[i] > signalLine[i] && macdLine[i-1] <= signalLine[i-1]);
      } else {
        signals.push(macdLine[i] < signalLine[i] && macdLine[i-1] >= signalLine[i-1]);
      }
    }
  }

  // 7. Stochastic
  if (entry.stochastic?.enabled) {
    const { k, d } = indicators.stoch;
    if (k[i] && d[i] && k[i-1] && d[i-1]) {
      if (entry.stochastic.condition === "oversold") {
        signals.push(k[i] < entry.stochastic.level && k[i] > d[i] && k[i-1] <= d[i-1]);
      } else {
        signals.push(k[i] > entry.stochastic.level && k[i] < d[i] && k[i-1] >= d[i-1]);
      }
    }
  }

  // 8. VWAP
  if (entry.vwap?.enabled && indicators.vwap[i]) {
    if (entry.vwap.direction === "above") {
      signals.push(prices[i] > indicators.vwap[i] && prices[i-1] <= indicators.vwap[i-1]);
    } else {
      signals.push(prices[i] < indicators.vwap[i] && prices[i-1] >= indicators.vwap[i-1]);
    }
  }

  // 9. Bollinger Bands
  if (entry.bollinger?.enabled && indicators.bb.upper[i]) {
    if (entry.bollinger.condition === "touch_lower") {
      signals.push(prices[i] <= indicators.bb.lower[i]);
    } else {
      signals.push(prices[i] >= indicators.bb.upper[i]);
    }
  }

  // 10. Fibonacci
  if (entry.fibonacci?.enabled && indicators.fib[i]) {
    const fib   = indicators.fib[i];
    const level = fib[`fib${entry.fibonacci.level}`];
    if (level) {
      const tolerance = prices[i] * 0.001; // 0.1% tolerance
      signals.push(Math.abs(prices[i] - level) <= tolerance);
    }
  }

  // All enabled signals must be true (AND logic)
  return signals.length > 0 && signals.every(s => s === true);
}

// ══════════════════════════════════════════════════════════
//  BACKTEST CORE
// ══════════════════════════════════════════════════════════
function runBacktest(candles, config) {
  const {
    capital       = 10000,
    riskPerTrade  = 2,       // % of capital per trade
    leverage      = 1,
    takeProfit    = 2,       // %
    stopLoss      = 1,       // %
    trailingStop  = null,    // % or null
    exitAfter     = null,    // candles or null
    slippage      = 0.05,    // % per side
    feePerSide    = 0.05,    // % per side (fixed Binance)
    direction     = "long"   // long or short
  } = config;

  const prices  = candles.map(c => c[1]);
  const volumes = candles.map(c => c[2]);
  const times   = candles.map(c => c[0]);

  // ── Pre-calculate all indicators ──────────────────────
  const indicators = {
    maFast:  calcSMA(prices, config.entry.maCross?.fastPeriod  || 9),
    maSlow:  calcSMA(prices, config.entry.maCross?.slowPeriod  || 21),
    emaFast: calcEMA(prices, config.entry.emaCross?.fastPeriod || 9),
    emaSlow: calcEMA(prices, config.entry.emaCross?.slowPeriod || 21),
    rsi:     calcRSI(prices, config.entry.rsi?.period          || 14),
    macd:    calcMACD(prices),
    stoch:   calcStochastic(prices, prices, prices),
    vwap:    calcVWAP(candles),
    bb:      calcBollingerBands(prices, 20, 2),
    fib:     calcFibonacciLevels(prices, 50),
    volAvg:  calcVolumeAvg(volumes, 20),
  };

  // ── Trade simulation ──────────────────────────────────
  const trades        = [];
  const equityCurve   = [];
  let   currentCapital = capital;
  let   inTrade        = false;
  let   entryPrice     = 0;
  let   entryIndex     = 0;
  let   highestPrice   = 0;
  let   lowestPrice    = Infinity;

  const totalCostPct = (feePerSide * 2) + (slippage * 2); // total round trip cost %

  for (let i = 50; i < candles.length; i++) {
    const price = prices[i];
    const time  = times[i];

    if (!inTrade) {
      // Check entry signal
      if (checkEntrySignal(i, prices, volumes, indicators, config)) {
        const riskAmount  = (currentCapital * riskPerTrade) / 100;
        const tradeSize   = riskAmount * leverage;
        const entryWithSlip = direction === "long"
          ? price * (1 + slippage / 100)
          : price * (1 - slippage / 100);

        inTrade      = true;
        entryPrice   = entryWithSlip;
        entryIndex   = i;
        highestPrice = price;
        lowestPrice  = price;
      }
    } else {
      // Track price extremes for trailing stop
      if (price > highestPrice) highestPrice = price;
      if (price < lowestPrice)  lowestPrice  = price;

      // Check exit conditions
      let exitReason = null;
      let exitPrice  = price;

      const pnlPct = direction === "long"
        ? ((price - entryPrice) / entryPrice) * 100
        : ((entryPrice - price) / entryPrice) * 100;

      // Take profit
      if (pnlPct >= takeProfit) {
        exitReason = "TP";
        exitPrice  = direction === "long"
          ? price * (1 - slippage / 100)
          : price * (1 + slippage / 100);
      }

      // Stop loss
      if (pnlPct <= -stopLoss) {
        exitReason = "SL";
        exitPrice  = direction === "long"
          ? price * (1 - slippage / 100)
          : price * (1 + slippage / 100);
      }

      // Trailing stop
      if (trailingStop && !exitReason) {
        const trailPct = direction === "long"
          ? ((highestPrice - price) / highestPrice) * 100
          : ((price - lowestPrice)  / lowestPrice)  * 100;
        if (trailPct >= trailingStop) {
          exitReason = "Trail";
          exitPrice  = direction === "long"
            ? price * (1 - slippage / 100)
            : price * (1 + slippage / 100);
        }
      }

      // Time-based exit
      if (exitAfter && (i - entryIndex) >= exitAfter) {
        exitReason = "Time";
        exitPrice  = price * (1 - slippage / 100);
      }

      if (exitReason) {
        // Calculate P&L
        const riskAmount  = (currentCapital * riskPerTrade) / 100;
        const tradeSize   = riskAmount * leverage;

        const grossPnlPct = direction === "long"
          ? ((exitPrice - entryPrice) / entryPrice) * 100 * leverage
          : ((entryPrice - exitPrice) / entryPrice) * 100 * leverage;

        const grossPnl    = (tradeSize * grossPnlPct) / 100;
        const feeCost     = (tradeSize * feePerSide * 2) / 100;
        const slippageCost= (tradeSize * slippage  * 2) / 100;
        const netPnl      = grossPnl - feeCost - slippageCost;

        currentCapital   += netPnl;

        trades.push({
          id:           trades.length + 1,
          entryTime:    new Date(times[entryIndex]).toISOString(),
          exitTime:     new Date(time).toISOString(),
          entryPrice:   parseFloat(entryPrice.toFixed(4)),
          exitPrice:    parseFloat(exitPrice.toFixed(4)),
          direction,
          grossPnlPct:  parseFloat(grossPnlPct.toFixed(4)),
          grossPnl:     parseFloat(grossPnl.toFixed(2)),
          feeCost:      parseFloat(feeCost.toFixed(2)),
          slippageCost: parseFloat(slippageCost.toFixed(2)),
          netPnl:       parseFloat(netPnl.toFixed(2)),
          netPnlPct:    parseFloat(((netPnl / riskAmount) * 100).toFixed(4)),
          capital:      parseFloat(currentCapital.toFixed(2)),
          exitReason,
          candlesHeld:  i - entryIndex
        });

        inTrade      = false;
        entryPrice   = 0;
        highestPrice = 0;
        lowestPrice  = Infinity;
      }
    }

    // Equity curve every 60 candles (hourly)
    if (i % 60 === 0) {
      equityCurve.push({
        time:    new Date(time).toISOString(),
        capital: parseFloat(currentCapital.toFixed(2))
      });
    }
  }

  // ── Calculate metrics ─────────────────────────────────
  const wins       = trades.filter(t => t.netPnl > 0);
  const losses     = trades.filter(t => t.netPnl <= 0);
  const totalPnl   = trades.reduce((s, t) => s + t.netPnl, 0);
  const totalFees  = trades.reduce((s, t) => s + t.feeCost, 0);
  const totalSlip  = trades.reduce((s, t) => s + t.slippageCost, 0);
  const winRate    = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const avgWin     = wins.length   > 0 ? wins.reduce((s,t)   => s + t.netPnlPct, 0) / wins.length   : 0;
  const avgLoss    = losses.length > 0 ? losses.reduce((s,t) => s + t.netPnlPct, 0) / losses.length : 0;
  const bestTrade  = trades.length > 0 ? Math.max(...trades.map(t => t.netPnlPct)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.netPnlPct)) : 0;

  // Max drawdown
  let maxDrawdown  = 0;
  let peak         = capital;
  for (const t of trades) {
    if (t.capital > peak) peak = t.capital;
    const dd = ((peak - t.capital) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Profit factor
  const grossWins   = wins.reduce((s, t)   => s + t.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Sharpe ratio (simplified)
  const returns     = trades.map(t => t.netPnlPct);
  const avgReturn   = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn   = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length)
    : 1;
  const sharpe      = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    metrics: {
      totalTrades:   trades.length,
      winningTrades: wins.length,
      losingTrades:  losses.length,
      winRate:       parseFloat(winRate.toFixed(2)),
      totalReturn:   parseFloat(((currentCapital - capital) / capital * 100).toFixed(2)),
      maxDrawdown:   parseFloat(maxDrawdown.toFixed(2)),
      sharpeRatio:   parseFloat(sharpe.toFixed(2)),
      profitFactor:  parseFloat(profitFactor.toFixed(2)),
      avgWin:        parseFloat(avgWin.toFixed(2)),
      avgLoss:       parseFloat(avgLoss.toFixed(2)),
      bestTrade:     parseFloat(bestTrade.toFixed(2)),
      worstTrade:    parseFloat(worstTrade.toFixed(2)),
      startCapital:  capital,
      finalCapital:  parseFloat(currentCapital.toFixed(2)),
      grossProfit:   parseFloat((totalPnl + totalFees + totalSlip).toFixed(2)),
      totalFees:     parseFloat(totalFees.toFixed(2)),
      totalSlippage: parseFloat(totalSlip.toFixed(2)),
      netProfit:     parseFloat(totalPnl.toFixed(2)),
    },
    trades:      trades.slice(-200), // last 200 trades for display
    equityCurve,
  };
}

// ══════════════════════════════════════════════════════════
//  MAIN EXPORT — called from server.js route
// ══════════════════════════════════════════════════════════
async function handleBacktest(req, res) {
  try {
    const {
      symbol    = "BTCUSDT",
      startDate,
      endDate,
      config
    } = req.body;

    if (!startDate || !endDate || !config) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // Validate date range (max 1 year)
    const start = new Date(startDate);
    const end   = new Date(endDate);
    const days  = (end - start) / (1000 * 60 * 60 * 24);
    if (days > 366) return res.status(400).json({ ok: false, error: "Max date range is 1 year" });
    if (days < 1)   return res.status(400).json({ ok: false, error: "Min date range is 1 day" });

    console.log(`\n📊 Backtest: ${symbol} | ${startDate} → ${endDate}`);

    // Fetch candles from Firebase
    const candles = await fetchCandles(symbol, startDate, endDate);
    if (candles.length < 100) {
      return res.status(400).json({ ok: false, error: "Not enough data for this date range" });
    }

    console.log(`  ✅ Loaded ${candles.length} candles`);

    // Run backtest
    const result = runBacktest(candles, config);

    console.log(`  ✅ Backtest done: ${result.metrics.totalTrades} trades | ${result.metrics.winRate}% win rate`);

    res.json({ ok: true, symbol, startDate, endDate, ...result });

  } catch(e) {
    console.error("Backtest error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = { handleBacktest, initFirebase };
