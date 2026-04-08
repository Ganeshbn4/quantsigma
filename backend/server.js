// ── ADD THIS BEFORE app.listen ────────────────────────────
// Test route: https://api.quantsigma.in/debug-nse
app.get("/debug-nse", async (req, res) => {
  const results = {};

  // Test 3 FNO stocks
  const testSymbols = ["RELIANCE", "TCS", "INFY"];
  for (const sym of testSymbols) {
    const url = `https://stooq.com/q/l/?s=${sym.toLowerCase()}.ns&f=sd2t2ohlcv&h&e=csv`;
    try {
      const { data } = await axios.get(url, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      results[sym] = { raw: data, url };
    } catch(e) {
      results[sym] = { error: e.message, status: e.response?.status, url };
    }
  }

  // Test Nifty index
  const idxUrl = "https://stooq.com/q/l/?s=^nif50&f=sd2t2ohlcv&h&e=csv";
  try {
    const { data } = await axios.get(idxUrl, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    results["NIFTY50_INDEX"] = { raw: data, url: idxUrl };
  } catch(e) {
    results["NIFTY50_INDEX"] = { error: e.message, status: e.response?.status };
  }

  res.json(results);
});
