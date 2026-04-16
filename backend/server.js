// ── ADD THIS before app.post("/api/backtest", handleBacktest) ──

app.post("/api/test", (req, res) => {
  res.json({ ok: true, body: req.body });
});

app.post("/api/backtest-debug", async (req, res) => {
  try {
    console.log("Backtest debug called with:", JSON.stringify(req.body));
    const { symbol, startDate, endDate } = req.body;
    
    // Test Firebase connection
    const admin = require("firebase-admin");
    const db = admin.firestore();
    
    // Try to fetch just one day
    const doc = await db
      .collection("candles")
      .doc(symbol || "BTCUSDT")
      .collection("days")
      .doc(startDate || "2024-01-01")
      .get();
    
    if (doc.exists) {
      const data = JSON.parse(doc.data().data);
      res.json({ 
        ok: true, 
        message: "Firebase connected",
        day: startDate,
        candleCount: data.length,
        firstCandle: data[0],
        lastCandle: data[data.length - 1]
      });
    } else {
      res.json({ 
        ok: false, 
        message: "Document not found",
        symbol,
        startDate
      });
    }
  } catch(e) {
    console.error("Debug error:", e);
    res.json({ ok: false, error: e.message, stack: e.stack });
  }
});
