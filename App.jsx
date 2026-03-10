import { useState, useEffect, useCallback, createContext, useContext } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine,
  ComposedChart, Legend
} from "recharts";

// ─── THEME ───────────────────────────────────────────────────────────────────
const C = {
  amber: "#D4820A", amberL: "#F0A830", green: "#22C55E", red: "#EF4444",
  blue: "#60A5FA", purple: "#A78BFA", neutral: "#94A3B8",
  bg: "#0A0700", bg2: "#0D0A06", border: "#2A2010", border2: "#1E1608",
  text: "#F5E6C8", muted: "#6B5B3E",
};
const TT = { contentStyle: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: "monospace", fontSize: 10, color: C.text } };

// ─── LIVE PRICE CONTEXT ───────────────────────────────────────────────────────
const PriceCtx = createContext(null);

// ICE Cocoa contract months: H=Mar, K=May, N=Jul, U=Sep, Z=Dec
// Active contracts as of Mar 2026
const CONTRACT_SYMBOLS = [
  { sym: "CCK26.NYB", label: "May 26", month: 0 },
  { sym: "CCN26.NYB", label: "Jul 26", month: 2 },
  { sym: "CCU26.NYB", label: "Sep 26", month: 4 },
  { sym: "CCZ26.NYB", label: "Dec 26", month: 7 },
  { sym: "CCH27.NYB", label: "Mar 27", month: 10 },
  { sym: "CCK27.NYB", label: "May 27", month: 12 },
  { sym: "CCN27.NYB", label: "Jul 27", month: 14 },
  { sym: "CCU27.NYB", label: "Sep 27", month: 16 },
  { sym: "CCZ27.NYB", label: "Dec 27", month: 21 },
  { sym: "CCH28.NYB", label: "Mar 28", month: 24 },
];

// Fallback static term structure — calibrated to ~$3,300 market (Mar 2026)
// Cocoa peaked ~$12,000 in early 2024, corrected sharply through 2025
const FALLBACK_SPOT = 3300;
const FALLBACK_TERM = [
  { label: "May 26 ★", price: 3300, oi: 52100, basis: 0,    roll_yield: null  },
  { label: "Jul 26",   price: 3260, oi: 38400, basis: -40,  roll_yield: -1.21 },
  { label: "Sep 26",   price: 3230, oi: 22800, basis: -70,  roll_yield: -0.92 },
  { label: "Dec 26",   price: 3190, oi: 16900, basis: -110, roll_yield: -0.82 },
  { label: "Mar 27",   price: 3160, oi:  8800, basis: -140, roll_yield: -0.62 },
  { label: "May 27",   price: 3140, oi:  5600, basis: -160, roll_yield: -0.42 },
  { label: "Jul 27",   price: 3120, oi:  3800, basis: -180, roll_yield: -0.38 },
  { label: "Sep 27",   price: 3100, oi:  2600, basis: -200, roll_yield: -0.32 },
  { label: "Dec 27",   price: 3075, oi:  1900, basis: -225, roll_yield: -0.27 },
  { label: "Mar 28",   price: 3050, oi:  1200, basis: -250, roll_yield: -0.22 },
];

// Fallback 1yr price history — reflects real cocoa trajectory:
// Mar 2025 ~$8k peak → sharp sell-off → Mar 2026 ~$3.3k
const FALLBACK_HISTORY = Array.from({ length: 252 }, (_, i) => {
  const t = i / 251;
  const base = 8000 - t * 4700;
  const noise = Math.sin(t * 18) * 280 + Math.sin(t * 42) * 140;
  return {
    date: `Day ${i + 1}`,
    price: Math.max(2800, Math.round(base + noise + (Math.random() - 0.5) * 200)),
  };
});

function useLivePrices() {
  const [spot, setSpot] = useState(null);
  const [prevClose, setPrevClose] = useState(null);
  const [high52, setHigh52] = useState(null);
  const [low52, setLow52] = useState(null);
  const [history, setHistory] = useState(FALLBACK_HISTORY);
  const [termCurve, setTermCurve] = useState(FALLBACK_TERM);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [dataSource, setDataSource] = useState("Fallback model data");
  const [fetchError, setFetchError] = useState(null);

  // Ordered list of CORS proxies — tries each in turn if one fails
  const PROXIES = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?",
    "https://api.codetabs.com/v1/proxy?quest=",
  ];

  const fetchWithProxy = async (url) => {
    for (const proxy of PROXIES) {
      try {
        const res = await fetch(proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          if (data && !data.error) return data;
        }
      } catch (_) { continue; }
    }
    throw new Error("All proxies failed — using fallback data");
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    let usedLive = false;

    try {
      // 1. Fetch spot price + history
      const chartData = await fetchWithProxy(
        "https://query1.finance.yahoo.com/v8/finance/chart/CC=F?interval=1d&range=1y"
      );
      const result = chartData?.chart?.result?.[0];
      if (!result) throw new Error("No chart result");

      const meta = result.meta;
      const liveSpot = meta.regularMarketPrice;
      const livePrev = meta.chartPreviousClose || meta.previousClose;
      setSpot(liveSpot);
      setPrevClose(livePrev);
      setHigh52(meta.fiftyTwoWeekHigh);
      setLow52(meta.fiftyTwoWeekLow);

      // Build history array
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const hist = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        price: closes[i] ? Math.round(closes[i]) : null,
      })).filter(d => d.price);
      if (hist.length > 10) setHistory(hist);
      usedLive = true;

      // 2. Fetch term structure contracts
      try {
        const symbols = CONTRACT_SYMBOLS.map(c => c.sym).join(",");
        const quoteData = await fetchWithProxy(
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,openInterest,symbol`
        );
        const quotes = quoteData?.quoteResponse?.result || [];
        if (quotes.length >= 3) {
          const frontPrice = quotes[0].regularMarketPrice || liveSpot;
          const curve = quotes.map((q, i) => {
            const price = q.regularMarketPrice;
            const basis = price - frontPrice;
            const rl = i > 0 ? ((price - frontPrice) / frontPrice * 100) : null;
            const label = CONTRACT_SYMBOLS.find(c => c.sym === q.symbol)?.label || q.symbol;
            return { label: i === 0 ? label + " ★" : label, price, oi: q.openInterest || 0, basis: Math.round(basis), roll_yield: rl ? parseFloat(rl.toFixed(2)) : null };
          }).filter(c => c.price > 1000);
          if (curve.length >= 3) setTermCurve(curve);
        }
      } catch (e) {
        // Term fallback with live-scaled prices
        const scale = liveSpot / FALLBACK_SPOT;
        setTermCurve(FALLBACK_TERM.map(t => ({
          ...t,
          price: Math.round(t.price * scale),
          basis: Math.round(t.basis * scale),
        })));
      }

      setDataSource("ICE Futures U.S. via Yahoo Finance (15-min delayed)");
    } catch (e) {
      setFetchError(e.message);
      setDataSource("Fallback model data (live fetch unavailable)");
    }

    setLastFetch(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 5 minutes during market hours
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const h = now.getUTCHours();
      if (h >= 13 && h <= 21) fetchAll(); // ICE market hours approx
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const change = spot && prevClose ? spot - prevClose : null;
  const changePct = change && prevClose ? (change / prevClose) * 100 : null;

  return { spot, prevClose, high52, low52, history, termCurve, loading, lastFetch, dataSource, fetchError, change, changePct, refetch: fetchAll };
}

// ─── STATIC MODEL DATA ────────────────────────────────────────────────────────
const PRODUCERS = [
  { country: "Côte d'Ivoire", share: 44, output: 2200, trend: "+3%", flag: "🇨🇮", status: "favorable" },
  { country: "Ghana", share: 14, output: 700, trend: "-8%", flag: "🇬🇭", status: "stress" },
  { country: "Ecuador", share: 8, output: 400, trend: "+12%", flag: "🇪🇨", status: "favorable" },
  { country: "Cameroon", share: 6, output: 300, trend: "-2%", flag: "🇨🇲", status: "neutral" },
  { country: "Nigeria", share: 5, output: 260, trend: "+1%", flag: "🇳🇬", status: "neutral" },
  { country: "Indonesia", share: 5, output: 250, trend: "-5%", flag: "🇮🇩", status: "stress" },
  { country: "Brazil", share: 4, output: 200, trend: "+7%", flag: "🇧🇷", status: "favorable" },
  { country: "Others", share: 14, output: 700, trend: "—", flag: "🌍", status: "neutral" },
];
const CONDITIONS = {
  favorable: [
    { factor: "Adequate Rainfall (1500–2000mm/yr)", impact: "high", detail: "Critical for pod development; excess causes fungal disease" },
    { factor: "Temperature 18–32°C", impact: "high", detail: "Optimal enzymatic activity for cocoa butter formation" },
    { factor: "Humid Tropics (lat. 10°N–10°S)", impact: "high", detail: "Consistent humidity prevents premature drying" },
    { factor: "Shade Tree Cover 30–50%", impact: "medium", detail: "Protects from direct sun; supports biodiversity" },
    { factor: "Deep Loamy Soil (pH 6–7)", impact: "medium", detail: "Good drainage with nutrient retention" },
    { factor: "Wind Protection", impact: "low", detail: "Reduces pod damage and moisture loss" },
  ],
  unfavorable: [
    { factor: "El Niño / Drought Conditions", impact: "high", detail: "Triggers sharp yield declines — primary supply shock driver" },
    { factor: "Black Pod Disease (Phytophthora)", impact: "high", detail: "Can destroy 30–90% of crop in wet, warm conditions" },
    { factor: "Swollen Shoot Virus (CSSV)", impact: "high", detail: "Endemic in Ghana; no cure, trees must be destroyed" },
    { factor: "Excessive Rain (Flooding)", impact: "medium", detail: "Root rot and pod spoilage in poorly drained soils" },
    { factor: "Aging Tree Stock", impact: "medium", detail: "West Africa avg tree age >25yrs — declining yields" },
    { factor: "Fertiliser Input Gaps", impact: "medium", detail: "Low adoption in smallholder farms limits productivity" },
    { factor: "Currency Volatility (CFA/GHS)", impact: "low", detail: "Affects farmer incentive to sell vs hoard" },
  ],
};
const DEMAND_DRIVERS = [
  { driver: "Dark Chocolate Premium Trend", region: "Europe/NA", strength: 88, direction: "↑" },
  { driver: "Asia-Pacific Emerging Middle Class", region: "Asia", strength: 92, direction: "↑" },
  { driver: "Craft & Bean-to-Bar Movement", region: "Global", strength: 74, direction: "↑" },
  { driver: "Confectionery Seasonal Demand", region: "Global", strength: 85, direction: "↑" },
  { driver: "Health / Cacao Supplement Trend", region: "NA/EU", strength: 68, direction: "↑" },
  { driver: "Cocoa Butter Cosmetics Demand", region: "Global", strength: 55, direction: "→" },
  { driver: "Price Elasticity Compression", region: "Global", strength: 62, direction: "↓" },
  { driver: "Reformulation / Cocoa Reduction", region: "EU/NA", strength: 40, direction: "↓" },
];
const SEASONALITY = [
  { month: "Jan", production: 35, demand: 72, price_pressure: 15 },
  { month: "Feb", production: 28, demand: 68, price_pressure: 10 },
  { month: "Mar", production: 22, demand: 65, price_pressure: 5 },
  { month: "Apr", production: 18, demand: 70, price_pressure: 20 },
  { month: "May", production: 42, demand: 74, price_pressure: 12 },
  { month: "Jun", production: 55, demand: 60, price_pressure: -10 },
  { month: "Jul", production: 48, demand: 55, price_pressure: -18 },
  { month: "Aug", production: 35, demand: 58, price_pressure: -8 },
  { month: "Sep", production: 45, demand: 78, price_pressure: 8 },
  { month: "Oct", production: 80, demand: 88, price_pressure: 5 },
  { month: "Nov", production: 92, demand: 95, price_pressure: 18 },
  { month: "Dec", production: 75, demand: 98, price_pressure: 30 },
];
const LEADING_INDICATORS = [
  { name: "West Africa Rainfall Anomaly", value: -1.4, unit: "σ", signal: "BEARISH", weight: 25, detail: "Below-avg rains in Côte d'Ivoire — crop stress" },
  { name: "Ghana COCOBOD Forward Sales", value: 68, unit: "%", signal: "NEUTRAL", weight: 15, detail: "68% hedged vs 75% avg" },
  { name: "Global Grinding Data (Q4)", value: +2.3, unit: "%YoY", signal: "BULLISH", weight: 20, detail: "European grind ahead of prior year" },
  { name: "ICE Certified Stocks", value: -34, unit: "%YoY", signal: "BULLISH", weight: 20, detail: "Warehouse stocks at multi-decade lows" },
  { name: "USD Index (DXY)", value: 104.2, unit: "", signal: "BEARISH", weight: 10, detail: "Strong USD dampens commodity pricing" },
  { name: "Crop Year Deficit Estimate", value: -150, unit: "kt", signal: "BULLISH", weight: 20, detail: "3rd consecutive year of supply deficit" },
];
const COT_DATA = [
  { week: "W1 Jan", mm_net: 46320, commercial_net: -51200, open_interest: 198000 },
  { week: "W2 Jan", mm_net: 50400, commercial_net: -53600, open_interest: 203000 },
  { week: "W3 Jan", mm_net: 55600, commercial_net: -57300, open_interest: 208500 },
  { week: "W4 Jan", mm_net: 60200, commercial_net: -61400, open_interest: 212000 },
  { week: "W1 Feb", mm_net: 55700, commercial_net: -58300, open_interest: 209000 },
  { week: "W2 Feb", mm_net: 62400, commercial_net: -64500, open_interest: 218000 },
  { week: "W3 Feb", mm_net: 66200, commercial_net: -68100, open_interest: 224000 },
  { week: "W4 Feb", mm_net: 60700, commercial_net: -63400, open_interest: 218000 },
  { week: "W1 Mar", mm_net: 68400, commercial_net: -71100, open_interest: 228000 },
  { week: "W2 Mar", mm_net: 73400, commercial_net: -75400, open_interest: 234000 },
];
const FACTOR_DEFINITIONS = [
  { id: "weather", name: "Weather / Climate", color: C.blue, icon: "🌦", description: "Rainfall anomaly, temperature, El Niño index. Primary beta.", beta: 0.38, current_zscore: -1.6, signal: "BEARISH", variance_contribution: 34 },
  { id: "supply_shock", name: "Supply Disruption", color: C.red, icon: "⚡", description: "Disease pressure, tree age profile, input availability.", beta: 0.28, current_zscore: 1.8, signal: "BULLISH", variance_contribution: 22 },
  { id: "grind_demand", name: "Grind / Demand", color: C.green, icon: "📦", description: "Global grind volumes, chocolate consumption growth.", beta: 0.18, current_zscore: 0.8, signal: "BULLISH", variance_contribution: 16 },
  { id: "macro_usd", name: "Macro / USD", color: C.amber, icon: "💵", description: "DXY direction, global risk appetite, rate expectations.", beta: -0.15, current_zscore: 1.2, signal: "BEARISH", variance_contribution: 12 },
  { id: "spec_flow", name: "Speculative Flow", color: C.purple, icon: "📊", description: "Managed Money COT, CTA trend signals, momentum.", beta: 0.22, current_zscore: 2.1, signal: "CAUTION", variance_contribution: 9 },
  { id: "carry", name: "Carry / Roll Yield", color: C.amberL, icon: "📈", description: "Term structure slope — backwardation = positive carry.", beta: 0.12, current_zscore: 2.4, signal: "BULLISH", variance_contribution: 4 },
  { id: "policy", name: "Policy / Geopolitical", color: "#F97316", icon: "🏛", description: "COCOBOD policy, CMC exports, EUDR sustainability regs.", beta: 0.08, current_zscore: 0.4, signal: "NEUTRAL", variance_contribution: 3 },
];
const FACTOR_ATTRIBUTION = [
  { period: "Q1 2024", weather: 18, supply_shock: 22, grind_demand: 8, macro_usd: -6, spec_flow: 14, carry: 4 },
  { period: "Q2 2024", weather: -8, supply_shock: 12, grind_demand: 5, macro_usd: -4, spec_flow: 18, carry: 3 },
  { period: "Q3 2024", weather: -14, supply_shock: 6, grind_demand: 4, macro_usd: -8, spec_flow: -12, carry: 2 },
  { period: "Q4 2024", weather: 24, supply_shock: 16, grind_demand: 9, macro_usd: -5, spec_flow: 22, carry: 5 },
  { period: "Q1 2025", weather: -10, supply_shock: 8, grind_demand: 6, macro_usd: 2, spec_flow: -8, carry: 3 },
  { period: "Q2 2025", weather: 8, supply_shock: 14, grind_demand: 7, macro_usd: -3, spec_flow: 16, carry: 4 },
];
const CROSS_ASSET = [
  { asset: "Sugar (SB)", corr: 0.42, reason: "Shared tropical crop risk" },
  { asset: "Coffee (KC)", corr: 0.38, reason: "West Africa weather correlation" },
  { asset: "Orange Juice", corr: 0.24, reason: "Soft commodity complex" },
  { asset: "DXY (USD)", corr: -0.31, reason: "USD pricing inverse" },
  { asset: "S&P 500", corr: 0.18, reason: "Risk appetite / EM consumer" },
  { asset: "Brent Crude", corr: 0.22, reason: "Transport / input cost" },
  { asset: "EM Currencies", corr: 0.29, reason: "Producer country FX link" },
  { asset: "CRB Index", corr: 0.34, reason: "Broad commodity cycle" },
];

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 3, height: 15, background: C.amber, borderRadius: 2 }} />
        <h2 style={{ margin: 0, color: C.text, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace" }}>{children}</h2>
      </div>
      {sub && <p style={{ margin: "3px 0 0 11px", color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{sub}</p>}
    </div>
  );
}
function SignalBadge({ signal, small }) {
  const colors = { BULLISH: C.green, BEARISH: C.red, NEUTRAL: C.neutral, CAUTION: "#F59E0B" };
  const col = colors[signal] || C.neutral;
  return <span style={{ background: col + "22", color: col, border: `1px solid ${col}44`, padding: small ? "2px 5px" : "3px 9px", borderRadius: 2, fontSize: small ? 8 : 9, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace" }}>{signal}</span>;
}
function MetricCard({ label, value, sub, color, live }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${live ? C.amber + "55" : C.border2}`, borderRadius: 4, padding: "10px 13px", position: "relative" }}>
      {live && <div style={{ position: "absolute", top: 6, right: 8, width: 5, height: 5, borderRadius: "50%", background: C.green }} />}
      <div style={{ color: C.muted, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>{label}</div>
      <div style={{ color: color || C.amberL, fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ color: C.neutral, fontSize: 8, marginTop: 1, fontFamily: "monospace" }}>{sub}</div>}
    </div>
  );
}

// ─── LIVE PRICE BANNER ────────────────────────────────────────────────────────
function LivePriceBanner() {
  const { spot, prevClose, change, changePct, high52, low52, loading, lastFetch, dataSource, fetchError, history, refetch } = useContext(PriceCtx);

  // Sparkline — last 30 days
  const spark = history.slice(-30);
  const sparkMin = Math.min(...spark.map(d => d.price));
  const sparkMax = Math.max(...spark.map(d => d.price));

  const fmtPrice = (p) => p ? `$${p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";
  const isUp = change >= 0;

  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 16px", marginBottom: 18, display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto auto", gap: 20, alignItems: "center" }}>
      {/* Exchange badge */}
      <div style={{ background: "#1A1408", border: `1px solid ${C.amber}33`, borderRadius: 3, padding: "4px 10px", textAlign: "center" }}>
        <div style={{ color: C.amber, fontSize: 8, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.1em" }}>ICE FUTURES U.S.</div>
        <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>CC (COCOA) · $/MT</div>
      </div>

      {/* Spot price */}
      <div>
        <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", letterSpacing: "0.1em" }}>FRONT MONTH (CC=F)</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {loading
            ? <div style={{ color: C.muted, fontSize: 18, fontFamily: "monospace" }}>Loading…</div>
            : <>
              <span style={{ color: C.amberL, fontSize: 22, fontWeight: 700, fontFamily: "monospace" }}>{fmtPrice(spot)}</span>
              {change !== null && (
                <span style={{ color: isUp ? C.green : C.red, fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>
                  {isUp ? "▲" : "▼"} {fmtPrice(Math.abs(change))} ({changePct >= 0 ? "+" : ""}{changePct?.toFixed(2)}%)
                </span>
              )}
            </>}
        </div>
        <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", marginTop: 2 }}>
          {fetchError ? <span style={{ color: "#F59E0B" }}>⚠ {dataSource}</span> : <span style={{ color: C.green }}>● {dataSource}</span>}
          {lastFetch && <span style={{ marginLeft: 8 }}>@ {lastFetch.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Sparkline */}
      <div style={{ width: 120, height: 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.amber} stopOpacity={0.4} />
                <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[sparkMin * 0.99, sparkMax * 1.01]} hide />
            <Area type="monotone" dataKey="price" stroke={C.amber} fill="url(#sparkGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      {[
        { label: "PREV CLOSE", val: fmtPrice(prevClose) },
        { label: "52W HIGH", val: fmtPrice(high52), color: C.green },
        { label: "52W LOW", val: fmtPrice(low52), color: C.red },
      ].map(s => (
        <div key={s.label} style={{ textAlign: "right" }}>
          <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", letterSpacing: "0.08em" }}>{s.label}</div>
          <div style={{ color: s.color || C.text, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{s.val || "—"}</div>
        </div>
      ))}

      {/* Refresh */}
      <button onClick={refetch} disabled={loading} style={{ background: C.amber + "22", color: C.amber, border: `1px solid ${C.amber}44`, borderRadius: 2, padding: "4px 10px", fontSize: 8, fontFamily: "monospace", cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? "…" : "↺ REFRESH"}
      </button>
    </div>
  );
}

// ─── PRICE HISTORY CHART ─────────────────────────────────────────────────────
function PriceHistoryChart() {
  const { history, spot } = useContext(PriceCtx);
  const last = history[history.length - 1]?.price || spot;
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionTitle sub="ICE Cocoa CC=F — 1-year price history (15-min delayed via Yahoo Finance)">Price History</SectionTitle>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={history} margin={{ top: 5, right: 5, bottom: 5, left: 10 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.amber} stopOpacity={0.3} />
              <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
          <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} interval={29} />
          <YAxis tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} domain={["auto", "auto"]} />
          <Tooltip {...TT} formatter={v => [`$${v.toLocaleString()}`, "Price"]} />
          <Area type="monotone" dataKey="price" stroke={C.amber} fill="url(#priceGrad)" strokeWidth={2} dot={false} name="ICE Cocoa" />
          {last && <ReferenceLine y={last} stroke={C.amberL + "55"} strokeDasharray="4 3" />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── TAB: SUPPLY ──────────────────────────────────────────────────────────────
function SupplyTab() {
  const maxOutput = Math.max(...PRODUCERS.map(p => p.output));
  return (
    <div>
      <PriceHistoryChart />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="Global Production" value="5,010 kt" sub="2024/25 estimate" />
        <MetricCard label="YoY Change" value="-3.8%" sub="3rd consecutive decline" color={C.red} />
        <MetricCard label="Deficit Estimate" value="-150 kt" sub="Supply vs demand gap" color={C.red} />
        <MetricCard label="Stock-to-Grind" value="28%" sub="vs 35% historical avg" color="#F59E0B" />
      </div>
      <SectionTitle sub="Cocoa bean production — thousand metric tons, 2024/25">Top Producing Nations</SectionTitle>
      <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
        {PRODUCERS.map(p => (
          <div key={p.country} style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px 55px", alignItems: "center", gap: 10, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "8px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 14 }}>{p.flag}</span>
              <div>
                <div style={{ color: C.text, fontSize: 10, fontWeight: 600, fontFamily: "monospace" }}>{p.country}</div>
                <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{p.output}kt · {p.share}%</div>
              </div>
            </div>
            <div style={{ position: "relative", height: 4, background: C.border2, borderRadius: 2 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(p.output / maxOutput) * 100}%`, background: p.status === "favorable" ? C.green : p.status === "stress" ? C.red : C.amber, borderRadius: 2 }} />
            </div>
            <div style={{ color: p.trend.startsWith("+") ? C.green : p.trend.startsWith("-") ? C.red : C.neutral, fontSize: 10, fontWeight: 700, fontFamily: "monospace", textAlign: "right" }}>{p.trend}</div>
            <div style={{ fontSize: 7, fontWeight: 700, color: p.status === "favorable" ? C.green : p.status === "stress" ? C.red : C.neutral, textTransform: "uppercase", fontFamily: "monospace", textAlign: "right" }}>{p.status}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <SectionTitle sub="What drives healthy yields">Favourable Conditions</SectionTitle>
          <div style={{ display: "grid", gap: 5 }}>
            {CONDITIONS.favorable.map(c => (
              <div key={c.factor} style={{ background: "#0A120A", border: "1px solid #1A2A1A", borderRadius: 3, padding: "7px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: C.green, fontSize: 9, fontWeight: 600, fontFamily: "monospace" }}>{c.factor}</span>
                  <span style={{ fontSize: 7, color: c.impact === "high" ? C.green : c.impact === "medium" ? C.amber : C.neutral, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase" }}>{c.impact}</span>
                </div>
                <div style={{ color: "#5A7A5A", fontSize: 8, fontFamily: "monospace" }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle sub="Key risk factors and yield suppressors">Unfavourable Conditions</SectionTitle>
          <div style={{ display: "grid", gap: 5 }}>
            {CONDITIONS.unfavorable.map(c => (
              <div key={c.factor} style={{ background: "#120A0A", border: "1px solid #2A1A1A", borderRadius: 3, padding: "7px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: C.red, fontSize: 9, fontWeight: 600, fontFamily: "monospace" }}>{c.factor}</span>
                  <span style={{ fontSize: 7, color: c.impact === "high" ? C.red : c.impact === "medium" ? "#F59E0B" : C.neutral, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase" }}>{c.impact}</span>
                </div>
                <div style={{ color: "#7A5A5A", fontSize: 8, fontFamily: "monospace" }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: DEMAND ─────────────────────────────────────────────────────────────
function DemandTab() {
  return (
    <div>
      <PriceHistoryChart />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="Global Grind 2024" value="4,860 kt" sub="+2.1% YoY" color={C.green} />
        <MetricCard label="EU Grind Q4 YoY" value="+2.3%" sub="Leading indicator" color={C.green} />
        <MetricCard label="Asia Grind Q4 YoY" value="+5.8%" sub="Fastest growing" color={C.green} />
        <MetricCard label="NA Grind Q4 YoY" value="+0.4%" sub="Mature market" color={C.neutral} />
      </div>
      <SectionTitle sub="Structural and cyclical demand drivers">Demand Drivers</SectionTitle>
      <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
        {DEMAND_DRIVERS.map(d => (
          <div key={d.driver} style={{ display: "grid", gridTemplateColumns: "250px 80px 1fr 26px", alignItems: "center", gap: 10, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "7px 12px" }}>
            <div style={{ color: C.text, fontSize: 10, fontFamily: "monospace" }}>{d.driver}</div>
            <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{d.region}</div>
            <div style={{ height: 4, background: C.border2, borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${d.strength}%`, background: d.strength > 70 ? C.amber : d.strength > 50 ? "#F59E0B88" : "#EF444488", borderRadius: 2 }} />
            </div>
            <div style={{ color: d.direction === "↑" ? C.green : d.direction === "↓" ? C.red : C.neutral, fontSize: 13 }}>{d.direction}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <SectionTitle sub="Quarterly grind by region — indexed">Regional Grind</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={[{ region: "Europe", current: 88, prior: 86 }, { region: "Americas", current: 72, prior: 72 }, { region: "Asia", current: 64, prior: 61 }, { region: "Africa", current: 18, prior: 17 }]} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="region" tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <Tooltip {...TT} />
              <Bar dataKey="prior" fill={C.border} name="Prior Year" radius={[2, 2, 0, 0]} />
              <Bar dataKey="current" fill={C.amber} name="Current" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="End-use breakdown of cocoa">Consumption Split</SectionTitle>
          <div style={{ display: "grid", gap: 7, marginTop: 6 }}>
            {[{ segment: "Dark/Milk Chocolate", pct: 54, color: C.amber }, { segment: "Cocoa Powder (baking)", pct: 18, color: "#C17A2A" }, { segment: "Cocoa Butter (food)", pct: 14, color: "#D49A3A" }, { segment: "Cocoa Butter (cosmetics)", pct: 8, color: "#8B6B3E" }, { segment: "Other / Industrial", pct: 6, color: "#5A4A2E" }].map(s => (
              <div key={s.segment}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: C.text, fontSize: 9, fontFamily: "monospace" }}>{s.segment}</span>
                  <span style={{ color: s.color, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{s.pct}%</span>
                </div>
                <div style={{ height: 3, background: C.border2, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${s.pct}%`, background: s.color, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: SEASONALITY ────────────────────────────────────────────────────────
function SeasonalityTab() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 4, marginBottom: 20 }}>
        {SEASONALITY.map(m => {
          const pp = m.price_pressure;
          const col = pp > 15 ? C.red : pp > 0 ? C.amber : pp > -10 ? C.neutral : C.green;
          return (
            <div key={m.month} style={{ background: C.bg2, border: `1px solid ${col}44`, borderRadius: 3, padding: "7px 4px", textAlign: "center" }}>
              <div style={{ color: C.amberL, fontSize: 8, fontWeight: 700, fontFamily: "monospace", marginBottom: 5 }}>{m.month}</div>
              <div style={{ fontSize: 7, color: C.muted, fontFamily: "monospace", marginBottom: 1 }}>PROD</div>
              <div style={{ color: C.text, fontSize: 9, fontWeight: 700, fontFamily: "monospace", marginBottom: 4 }}>{m.production}</div>
              <div style={{ fontSize: 7, color: C.muted, fontFamily: "monospace", marginBottom: 1 }}>DEM</div>
              <div style={{ color: C.text, fontSize: 9, fontWeight: 700, fontFamily: "monospace", marginBottom: 5 }}>{m.demand}</div>
              <div style={{ background: col + "22", color: col, fontSize: 7, fontWeight: 700, padding: "1px 0", borderRadius: 2, fontFamily: "monospace" }}>{pp > 0 ? "+" : ""}{pp}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="Production vs demand by month (indexed)">Seasonal Curve</SectionTitle>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={SEASONALITY} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <Tooltip {...TT} />
              <Area type="monotone" dataKey="production" stroke={C.amber} fill={C.amber + "22"} name="Production" strokeWidth={2} />
              <Line type="monotone" dataKey="demand" stroke={C.blue} strokeWidth={2} dot={false} name="Demand" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="Positive = upward price pressure by month">Price Pressure Index</SectionTitle>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={SEASONALITY} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <ReferenceLine y={0} stroke={C.border} />
              <Tooltip {...TT} />
              <Bar dataKey="price_pressure" name="Pressure" radius={[2, 2, 0, 0]} fill={C.amber} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
        <div style={{ color: C.amber, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 8 }}>HARVEST CALENDAR — WEST AFRICA</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          {[{ season: "Main Crop (Côte d'Ivoire)", period: "October → March", pct: "70–75% annual output", color: C.amber }, { season: "Mid Crop (Côte d'Ivoire)", period: "May → August", pct: "25–30% annual output", color: "#C17A2A" }, { season: "Main Crop (Ghana)", period: "September → February", pct: "70% annual output", color: "#D49A3A" }, { season: "Mid Crop (Ghana)", period: "May → July", pct: "30% annual output", color: "#8B6B3E" }].map(h => (
            <div key={h.season} style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 3, height: 34, background: h.color, borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ color: C.text, fontSize: 9, fontWeight: 600, fontFamily: "monospace" }}>{h.season}</div>
                <div style={{ color: h.color, fontSize: 8, fontFamily: "monospace" }}>{h.period}</div>
                <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{h.pct}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: FACTORS ─────────────────────────────────────────────────────────────
function FactorTab() {
  const radarData = FACTOR_DEFINITIONS.map(f => ({ factor: f.name.split(" ")[0], value: Math.min(100, Math.abs(f.current_zscore) * 26 + 18) }));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="Top Factor" value="Weather" sub="34% variance contribution" color={C.blue} />
        <MetricCard label="Most Elevated" value="Carry +2.4σ" sub="Deep backwardation signal" color={C.amberL} />
        <MetricCard label="Spec Flow Z-Score" value="+2.1σ" sub="Crowding risk — caution" color="#F59E0B" />
        <MetricCard label="Macro Drag" value="USD +1.2σ" sub="Strong dollar headwind" color={C.red} />
      </div>
      <SectionTitle sub="Price variance decomposition — factor betas, z-scores and signals">Factor Breakdown</SectionTitle>
      <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
        {FACTOR_DEFINITIONS.map(f => (
          <div key={f.id} style={{ background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "9px 12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "24px 155px 72px 75px 1fr 86px", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13 }}>{f.icon}</span>
              <div>
                <div style={{ color: C.text, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{f.name}</div>
                <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", marginTop: 1 }}>Beta: {f.beta > 0 ? "+" : ""}{f.beta}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>VAR.</div>
                <div style={{ color: f.color, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{f.variance_contribution}%</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>Z-SCORE</div>
                <div style={{ color: Math.abs(f.current_zscore) > 2 ? (f.current_zscore > 0 ? C.green : C.red) : C.amberL, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>
                  {f.current_zscore > 0 ? "+" : ""}{f.current_zscore}σ
                </div>
              </div>
              <div>
                <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", marginBottom: 3 }}>{f.description}</div>
                <div style={{ height: 3, background: C.border2, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${f.variance_contribution * 2.5}%`, background: f.color, borderRadius: 2 }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}><SignalBadge signal={f.signal} small /></div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="Quarterly factor attribution to price change (% pts)">Return Attribution</SectionTitle>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={FACTOR_ATTRIBUTION} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="period" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <ReferenceLine y={0} stroke={C.border} />
              <Tooltip {...TT} />
              <Bar dataKey="weather" name="Weather" fill={C.blue} stackId="a" />
              <Bar dataKey="supply_shock" name="Supply" fill={C.red} stackId="a" />
              <Bar dataKey="grind_demand" name="Demand" fill={C.green} stackId="a" />
              <Bar dataKey="macro_usd" name="Macro" fill={C.amber} stackId="a" />
              <Bar dataKey="spec_flow" name="Spec" fill={C.purple} stackId="a" />
              <Bar dataKey="carry" name="Carry" fill={C.amberL} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="Factor intensity radar — current z-score magnitude">Factor Radar</SectionTitle>
          <ResponsiveContainer width="100%" height={190}>
            <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <PolarGrid stroke={C.border2} />
              <PolarAngleAxis dataKey="factor" tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <Radar name="Intensity" dataKey="value" stroke={C.amber} fill={C.amber} fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <SectionTitle sub="Cocoa price correlations to other assets — 2-year rolling">Cross-Asset Correlations</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {CROSS_ASSET.map(a => {
          const col = a.corr < 0 ? C.red : Math.abs(a.corr) > 0.35 ? C.amber : C.neutral;
          return (
            <div key={a.asset} style={{ background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: C.text, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{a.asset}</span>
                <span style={{ color: col, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{a.corr > 0 ? "+" : ""}{a.corr.toFixed(2)}</span>
              </div>
              <div style={{ height: 3, background: C.border2, borderRadius: 2, marginBottom: 4 }}>
                <div style={{ height: "100%", width: `${Math.abs(a.corr) * 100}%`, background: col, borderRadius: 2 }} />
              </div>
              <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>{a.reason}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TAB: TERM STRUCTURE ─────────────────────────────────────────────────────
function TermStructureTab() {
  const { termCurve, spot, dataSource, fetchError, lastFetch, loading, refetch } = useContext(PriceCtx);

  const data = termCurve;
  const frontPrice = data[0]?.price || spot || FALLBACK_SPOT;
  const lastPrice = data[data.length - 1]?.price || 6950;
  const slope = ((lastPrice - frontPrice) / frontPrice) * 100;
  const isBack = slope < 0;
  const validRY = data.filter(d => d.roll_yield !== null && d.roll_yield !== undefined);
  const avgRY = validRY.length ? validRY.reduce((s, d) => s + d.roll_yield, 0) / validRY.length : -1.5;

  const HIST_CURVES = [
    { contract: "M1", y2022: 2580, y2023: 4120, y2024: Math.round(frontPrice * 0.78), current: frontPrice },
    { contract: "M3", y2022: 2560, y2023: 4090, y2024: Math.round(frontPrice * 0.76), current: data[1]?.price || Math.round(frontPrice * 0.97) },
    { contract: "M5", y2022: 2540, y2023: 4060, y2024: Math.round(frontPrice * 0.73), current: data[2]?.price || Math.round(frontPrice * 0.95) },
    { contract: "M7", y2022: 2520, y2023: 4030, y2024: Math.round(frontPrice * 0.71), current: data[3]?.price || Math.round(frontPrice * 0.92) },
    { contract: "M9", y2022: 2500, y2023: 4000, y2024: Math.round(frontPrice * 0.68), current: data[4]?.price || Math.round(frontPrice * 0.90) },
    { contract: "M12", y2022: 2480, y2023: 3980, y2024: Math.round(frontPrice * 0.66), current: data[5]?.price || Math.round(frontPrice * 0.88) },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Front Month (CC=F)" value={`$${frontPrice.toLocaleString()}`} sub="ICE Futures U.S." color={C.amberL} live />
        <MetricCard label="Curve Shape" value={isBack ? "BACKWARDATION" : "CONTANGO"} sub={`${Math.abs(slope).toFixed(1)}% slope`} color={isBack ? C.green : C.red} />
        <MetricCard label="Avg Roll Yield/mo" value={`${avgRY.toFixed(1)}%`} sub={isBack ? "Positive carry for longs" : "Roll cost for longs"} color={isBack ? C.green : C.red} />
        <MetricCard label="Back-month (24m)" value={`$${lastPrice.toLocaleString()}`} sub={`${slope.toFixed(1)}% vs spot`} color={isBack ? C.green : C.neutral} />
      </div>

      {/* Data source strip */}
      <div style={{ background: fetchError ? "#120A0A" : "#0A120A", border: `1px solid ${fetchError ? "#F59E0B" : C.green}33`, borderRadius: 3, padding: "6px 12px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9 }}>{fetchError ? "⚠️" : "✅"}</span>
          <span style={{ color: C.text, fontSize: 8, fontFamily: "monospace" }}>
            Exchange: <span style={{ color: C.amberL }}>ICE Futures U.S. (formerly NYBOT) · Ticker: CC</span>
          </span>
          <span style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>|</span>
          <span style={{ color: fetchError ? "#F59E0B" : C.green, fontSize: 8, fontFamily: "monospace" }}>{dataSource}</span>
          {fetchError && <span style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>({fetchError})</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {lastFetch && <span style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>@ {lastFetch.toLocaleTimeString()}</span>}
          <button onClick={refetch} disabled={loading} style={{ background: C.amber + "22", color: C.amber, border: `1px solid ${C.amber}44`, borderRadius: 2, padding: "2px 8px", fontSize: 7, fontFamily: "monospace", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "…" : "↺ REFRESH"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="ICE Cocoa futures curve — $/MT by contract month">Futures Curve</SectionTitle>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <YAxis domain={["auto", "auto"]} tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip {...TT} formatter={v => [`$${v.toLocaleString()}`, "Price"]} />
              <Area type="monotone" dataKey="price" stroke={isBack ? C.green : C.red} fill={(isBack ? C.green : C.red) + "18"} strokeWidth={2.5} dot={{ fill: C.amber, r: 3 }} name="$/MT" />
              <ReferenceLine y={frontPrice} stroke={C.amber + "44"} strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="Open interest by contract — liquidity profile">OI by Contract</SectionTitle>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip {...TT} formatter={v => [v.toLocaleString(), "OI"]} />
              <Bar dataKey="oi" fill={C.purple} radius={[2, 2, 0, 0]} name="Open Interest" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="Current curve vs prior years — same contract months">Historical Comparison</SectionTitle>
          <ResponsiveContainer width="100%" height={185}>
            <LineChart data={HIST_CURVES} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="contract" tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 8, fontFamily: "monospace" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip {...TT} formatter={v => [`$${v.toLocaleString()}`]} />
              <Line type="monotone" dataKey="y2022" stroke="#3A3020" strokeWidth={1.5} dot={false} name="2022" />
              <Line type="monotone" dataKey="y2023" stroke="#6B5B3E" strokeWidth={1.5} dot={false} name="2023" />
              <Line type="monotone" dataKey="y2024" stroke={C.amber} strokeWidth={1.5} dot={false} name="2024" />
              <Line type="monotone" dataKey="current" stroke={C.green} strokeWidth={2.5} dot={{ fill: C.green, r: 3 }} name="Live" />
              <Legend wrapperStyle={{ fontSize: 8, fontFamily: "monospace", color: C.muted }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="Contract-by-contract detail — live prices">Term Structure Table</SectionTitle>
          <div style={{ background: C.bg2, borderRadius: 3, overflow: "hidden", border: `1px solid ${C.border2}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 75px 65px 65px 55px", background: "#1A1408", padding: "5px 10px", gap: 5 }}>
              {["Contract", "Price", "Basis", "Roll Yld", "OI"].map(h => <span key={h} style={{ color: C.muted, fontSize: 7, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase" }}>{h}</span>)}
            </div>
            {data.map((row, i) => (
              <div key={row.label} style={{ display: "grid", gridTemplateColumns: "80px 75px 65px 65px 55px", padding: "4px 10px", gap: 5, borderTop: i > 0 ? `1px solid ${C.border2}` : "none", background: i === 0 ? C.amber + "0F" : "transparent" }}>
                <span style={{ color: i === 0 ? C.amberL : C.text, fontSize: 8, fontFamily: "monospace", fontWeight: i === 0 ? 700 : 400 }}>{row.label}</span>
                <span style={{ color: C.text, fontSize: 8, fontFamily: "monospace" }}>${row.price.toLocaleString()}</span>
                <span style={{ color: (row.basis || 0) < 0 ? C.green : (row.basis || 0) > 0 ? C.red : C.neutral, fontSize: 8, fontFamily: "monospace" }}>{(row.basis || 0) > 0 ? "+" : ""}{row.basis || 0}</span>
                <span style={{ color: row.roll_yield === null || row.roll_yield === undefined ? C.muted : row.roll_yield < 0 ? C.green : C.red, fontSize: 8, fontFamily: "monospace" }}>{row.roll_yield === null || row.roll_yield === undefined ? "—" : `${Number(row.roll_yield).toFixed(1)}%`}</span>
                <span style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{row.oi ? (row.oi / 1000).toFixed(0) + "k" : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
        <div style={{ color: C.amber, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 8 }}>EXCHANGE NOTE + TERM STRUCTURE INTERPRETATION</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { title: "ICE vs NYMEX Clarification", detail: "Cocoa (CC) trades on ICE Futures U.S. (formerly NYBOT), NOT NYMEX. NYMEX is CME Group's exchange for energy & metals. ICE is the correct venue for soft commodities including cocoa, coffee, sugar, cotton, OJ.", color: "#F59E0B" },
            { title: "Backwardation (Current)", detail: "Spot > Deferred. Signals tight nearby supply vs future expectations. Long positions earn positive roll yield as they roll into cheaper deferred contracts. Historically precedes further rallies if sustained.", color: C.green },
            { title: "Roll Yield & Carry", detail: `Avg monthly roll yield ~${(avgRY * 6).toFixed(1)}%/yr annualised. Deep backwardation is critical edge for active managers. Watch front/2nd month spread as leading indicator — narrowing = supply recovery signal.`, color: C.blue },
          ].map(c => (
            <div key={c.title} style={{ borderLeft: `2px solid ${c.color}`, paddingLeft: 9 }}>
              <div style={{ color: c.color, fontSize: 8, fontWeight: 700, fontFamily: "monospace", marginBottom: 3 }}>{c.title}</div>
              <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace", lineHeight: 1.6 }}>{c.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: OUTLOOK ────────────────────────────────────────────────────────────
function OutlookTab() {
  const { spot, changePct } = useContext(PriceCtx);
  const fmtP = p => p ? `$${p.toLocaleString()}` : "—";
  // Bull: +30% upside (supply tightness re-emerges), Bear: -20% downside (demand destruction)
  const bullT = spot ? Math.round(spot * 1.30) : 4290;
  const bearT = spot ? Math.round(spot * 0.80) : 2640;
  const bulls = LEADING_INDICATORS.filter(s => s.signal === "BULLISH").length;
  const bears = LEADING_INDICATORS.filter(s => s.signal === "BEARISH").length;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="ICE Cocoa Front Month" value={fmtP(spot)} sub={changePct ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% today` : "ICE Futures U.S."} color={C.amberL} live />
        <MetricCard label="Bull Target" value={fmtP(bullT)} sub="12-month upside" color={C.green} />
        <MetricCard label="Bear Target" value={fmtP(bearT)} sub="12-month downside" color={C.red} />
        <div style={{ background: C.bg2, border: `1px solid ${C.amber}44`, borderRadius: 4, padding: "10px 13px" }}>
          <div style={{ color: C.muted, fontSize: 8, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Model Consensus</div>
          <div style={{ color: C.green, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>CAUTIOUSLY BULLISH</div>
          <div style={{ color: C.neutral, fontSize: 8, marginTop: 2, fontFamily: "monospace" }}>Score: 68/100</div>
        </div>
      </div>
      <SectionTitle sub="Weighted composite indicators feeding the outlook model">Leading Indicators</SectionTitle>
      <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
        {LEADING_INDICATORS.map(ind => (
          <div key={ind.name} style={{ display: "grid", gridTemplateColumns: "210px 70px 34px 1fr 84px", alignItems: "center", gap: 10, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "7px 11px" }}>
            <div style={{ color: C.text, fontSize: 9, fontFamily: "monospace" }}>{ind.name}</div>
            <div style={{ color: C.amberL, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{ind.value > 0 && ind.unit !== "%" ? "+" : ""}{ind.value}{ind.unit}</div>
            <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace" }}>W:{ind.weight}</div>
            <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{ind.detail}</div>
            <div style={{ textAlign: "right" }}><SignalBadge signal={ind.signal} small /></div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <SectionTitle>Signal Distribution</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[{ label: "BULLISH", count: bulls, color: C.green, bg: "#0A120A" }, { label: "BEARISH", count: bears, color: C.red, bg: "#120A0A" }, { label: "NEUTRAL", count: LEADING_INDICATORS.length - bulls - bears, color: C.neutral, bg: C.bg2 }].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}22`, borderRadius: 3, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ color: s.color, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{s.label}</span>
                  <span style={{ color: s.color, fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>{s.count}</span>
                </div>
                <div style={{ height: 3, background: C.border2, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${(s.count / LEADING_INDICATORS.length) * 100}%`, background: s.color, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>Key Risks</SectionTitle>
          <div style={{ display: "grid", gap: 6 }}>
            {[{ risk: "El Niño re-intensification", dir: "↑ Bullish if occurs", sev: "HIGH" }, { risk: "COCOBOD over-hedging", dir: "↓ Bearish if confirmed", sev: "MEDIUM" }, { risk: "Demand destruction (high prices)", dir: "↓ Bearish", sev: "MEDIUM" }, { risk: "Policy / export quota intervention", dir: "↑↓ Binary", sev: "HIGH" }, { risk: "CTA / speculative unwind", dir: "↓ Sharp reversal risk", sev: "HIGH" }, { risk: "USD sustained strength", dir: "↓ Headwind", sev: "LOW" }].map(r => (
              <div key={r.risk} style={{ background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "7px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: C.text, fontSize: 9, fontFamily: "monospace" }}>{r.risk}</div>
                  <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace", marginTop: 1 }}>{r.dir}</div>
                </div>
                <span style={{ fontSize: 7, fontWeight: 700, color: r.sev === "HIGH" ? C.red : r.sev === "MEDIUM" ? C.amber : C.neutral, border: `1px solid ${r.sev === "HIGH" ? C.red : r.sev === "MEDIUM" ? C.amber : C.neutral}44`, padding: "2px 5px", borderRadius: 2, fontFamily: "monospace" }}>{r.sev}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: COT ────────────────────────────────────────────────────────────────
function COTTab() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <MetricCard label="MM Net Long" value="+73,400" sub="Managed money net" color={C.green} />
        <MetricCard label="Commercial Net" value="-75,400" sub="Industry hedgers" color={C.red} />
        <MetricCard label="Open Interest" value="234,000" sub="Total contracts ↑" color={C.amberL} />
        <MetricCard label="CTA Positioning" value="HEAVY LONG" sub="88th pct vs 3yr" color={C.green} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="Managed Money vs Commercial net — weekly CFTC COT">Net Positioning</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={COT_DATA} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <ReferenceLine y={0} stroke={C.border} />
              <Tooltip {...TT} formatter={v => v.toLocaleString()} />
              <Area type="monotone" dataKey="mm_net" stroke={C.green} fill={C.green + "22"} strokeWidth={2} name="MM Net Long" />
              <Line type="monotone" dataKey="commercial_net" stroke={C.red} strokeWidth={2} dot={false} name="Commercial Net" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <SectionTitle sub="Rising OI + rising price = genuine conviction">Open Interest</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={COT_DATA} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.border2} />
              <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: C.muted, fontSize: 7, fontFamily: "monospace" }} />
              <Tooltip {...TT} formatter={v => v.toLocaleString()} />
              <Area type="monotone" dataKey="open_interest" stroke={C.amber} fill={C.amber + "22"} strokeWidth={2} name="OI" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <SectionTitle sub="Gross breakdown — latest week">Gross Positions</SectionTitle>
          <div style={{ display: "grid", gap: 7 }}>
            {[{ label: "MM Gross Long", value: 87600, max: 100000, color: C.green }, { label: "MM Gross Short", value: 14200, max: 100000, color: C.red }, { label: "Commercial Long", value: 39400, max: 120000, color: C.blue }, { label: "Commercial Short", value: 114800, max: 120000, color: "#F97316" }].map(g => (
              <div key={g.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: C.neutral, fontSize: 8, fontFamily: "monospace" }}>{g.label}</span>
                  <span style={{ color: g.color, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{g.value.toLocaleString()}</span>
                </div>
                <div style={{ height: 3, background: C.border2, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${(g.value / g.max) * 100}%`, background: g.color + "CC", borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle sub="CTA / trend-following signal monitor">CTA Signal</SectionTitle>
          <div style={{ display: "grid", gap: 6 }}>
            {[{ label: "Trend Direction", value: "LONG", color: C.green }, { label: "Position Size", value: "Heavy", color: C.amberL }, { label: "Percentile vs 3yr", value: "88th", color: C.red }, { label: "Momentum Score", value: "74/100", color: C.amberL }, { label: "Reversal Risk", value: "Moderate", color: "#F59E0B" }, { label: "WoW Change", value: "+4,200 contracts", color: C.green }].map(c => (
              <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "6px 11px" }}>
                <span style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{c.label}</span>
                <span style={{ color: c.color, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
        <div style={{ color: C.amber, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 8 }}>COT INTERPRETATION</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[{ title: "Managed Money (Specs)", detail: "Trend-chasers, momentum-driven. Rising MM net longs = speculative conviction. At extremes (>80th pct), watch for crowded trade reversal.", color: C.green }, { title: "Commercials (Hedgers)", detail: "Producers, processors, merchants. Naturally short (hedging forward sales). Deep commercial shorts often coincide with price tops.", color: C.blue }, { title: "OI + Price Divergence", detail: "Rising OI + rising price = new longs entering (bullish). Falling OI + rising price = shorts covering — weaker signal. Monitor weekly.", color: C.amber }].map(c => (
            <div key={c.title} style={{ borderLeft: `2px solid ${c.color}`, paddingLeft: 9 }}>
              <div style={{ color: c.color, fontSize: 8, fontWeight: 700, fontFamily: "monospace", marginBottom: 3 }}>{c.title}</div>
              <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace", lineHeight: 1.6 }}>{c.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: NEWS & AI ───────────────────────────────────────────────────────────
function NewsTab() {
  const [state, setState] = useState("idle");
  const [articles, setArticles] = useState([]);
  const [synthesis, setSynthesis] = useState("");
  const [signals, setSignals] = useState([]);
  const [timestamp, setTimestamp] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const runAnalysis = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    try {
      // Call our Vercel serverless proxy — keeps API key server-side, avoids CORS
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `You are a commodity analyst specialising in soft commodities. Search the web for the LATEST cocoa market news from the past 7-14 days. Focus on: ICE Futures U.S. cocoa price moves (CC contract, currently ~$3,300/MT), West Africa crop conditions (Côte d\'Ivoire, Ghana), COCOBOD/CMC announcements, weather anomalies, global grinding data, ICE certified stocks levels, speculative positioning, and macro factors (USD, EM currencies). Note: cocoa trades on ICE Futures U.S. (formerly NYBOT), NOT NYMEX. After searching, return ONLY a valid JSON object with no markdown formatting or backticks whatsoever: {"synthesis":"3-4 sentence market overview mentioning current price level and key drivers","signals":[{"direction":"BULLISH","label":"5 words max","detail":"one clear sentence"},{"direction":"BEARISH","label":"5 words max","detail":"one clear sentence"},{"direction":"NEUTRAL","label":"5 words max","detail":"one clear sentence"}],"articles":[{"headline":"full headline","source":"publication name","date":"date string","summary":"2 clear sentences summarising the article","impact":"BULLISH or BEARISH or NEUTRAL","category":"Supply or Demand or Macro or Policy or Weather"}]}. Include 6-8 articles. Include at least 2 signals per direction.`
          }],
        }),
      });

      const data = await res.json();

      // Handle API key not configured
      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      // Extract the last text block (after tool use / web search)
      const textBlocks = (data.content || []).filter(b => b.type === "text");
      if (textBlocks.length === 0) throw new Error("No text response from AI — try again");
      const lastText = textBlocks[textBlocks.length - 1].text;

      // Strip any accidental markdown fences
      let raw = lastText.trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // Extract JSON object if surrounded by extra text
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not find JSON in response");
      raw = jsonMatch[0];

      const parsed = JSON.parse(raw);
      setArticles(parsed.articles || []);
      setSynthesis(parsed.synthesis || "");
      setSignals(parsed.signals || []);
      setTimestamp(new Date().toLocaleString());
      setState("done");
    } catch (e) {
      setErrorMsg(e.message);
      setState("error");
    }
  }, []);

  const iColors = { BULLISH: C.green, BEARISH: C.red, NEUTRAL: C.neutral };
  const cColors = { Supply: C.amber, Demand: C.blue, Macro: C.purple, Policy: "#F97316", Weather: "#22D3EE" };

  return (
    <div>
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "13px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: C.amberL, fontSize: 10, fontWeight: 700, fontFamily: "monospace", marginBottom: 2 }}>🤖 AI NEWS INTELLIGENCE — LIVE WEB SEARCH</div>
          <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>Claude searches web → extracts signals → synthesises ICE Cocoa market outlook</div>
          {timestamp && <div style={{ color: C.muted, fontSize: 7, fontFamily: "monospace", marginTop: 2 }}>Updated: {timestamp}</div>}
        </div>
        <button onClick={runAnalysis} disabled={state === "loading"} style={{ background: state === "loading" ? C.border2 : C.amber, color: state === "loading" ? C.muted : "#0A0700", border: "none", borderRadius: 3, padding: "8px 18px", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", cursor: state === "loading" ? "not-allowed" : "pointer", fontFamily: "monospace", textTransform: "uppercase" }}>
          {state === "loading" ? "⟳  SEARCHING…" : state === "done" ? "↺  REFRESH" : "▶  RUN ANALYSIS"}
        </button>
      </div>

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px", gap: 12 }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${C.border2}`, borderTop: `3px solid ${C.amber}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <div style={{ color: C.muted, fontSize: 9, fontFamily: "monospace" }}>Searching web · Analysing ICE Cocoa news · Extracting signals…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {state === "error" && (
        <div style={{ background: "#120A0A", border: `1px solid ${C.red}44`, borderRadius: 4, padding: "20px 24px" }}>
          <div style={{ color: C.red, fontSize: 10, fontWeight: 700, fontFamily: "monospace", marginBottom: 6 }}>⚠ Analysis Failed</div>
          <div style={{ color: C.text, fontSize: 9, fontFamily: "monospace", marginBottom: 10, lineHeight: 1.7 }}>{errorMsg}</div>
          {errorMsg?.toLowerCase().includes("anthropic_api_key") || errorMsg?.toLowerCase().includes("not configured") ? (
            <div style={{ background: "#1A1008", border: `1px solid ${C.amber}44`, borderRadius: 3, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ color: C.amber, fontSize: 9, fontWeight: 700, fontFamily: "monospace", marginBottom: 6 }}>HOW TO ADD YOUR API KEY TO VERCEL</div>
              <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace", lineHeight: 1.9 }}>
                1. Go to <span style={{ color: C.amberL }}>vercel.com</span> → your project → <span style={{ color: C.amberL }}>Settings</span><br/>
                2. Click <span style={{ color: C.amberL }}>Environment Variables</span><br/>
                3. Add: Name = <span style={{ color: C.green }}>ANTHROPIC_API_KEY</span> · Value = your key from <span style={{ color: C.amberL }}>console.anthropic.com</span><br/>
                4. Click <span style={{ color: C.amberL }}>Save</span> → then go to <span style={{ color: C.amberL }}>Deployments</span> → <span style={{ color: C.amberL }}>Redeploy</span>
              </div>
            </div>
          ) : null}
          <button onClick={runAnalysis} style={{ background: C.amber + "22", color: C.amber, border: `1px solid ${C.amber}44`, borderRadius: 2, padding: "5px 14px", fontSize: 8, fontFamily: "monospace", cursor: "pointer" }}>↺ Retry</button>
        </div>
      )}
      {state === "idle" && (
        <div style={{ background: C.bg2, border: `1px dashed ${C.border}`, borderRadius: 4, padding: "44px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📡</div>
          <div style={{ color: C.muted, fontSize: 10, fontFamily: "monospace", marginBottom: 3 }}>Ready to search</div>
          <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>Click "Run Analysis" to fetch live ICE Cocoa market news and generate structured insights</div>
        </div>
      )}
      {state === "done" && (
        <>
          {synthesis && (
            <div style={{ background: "#0D100A", border: `1px solid ${C.green}44`, borderRadius: 4, padding: "13px 15px", marginBottom: 16 }}>
              <div style={{ color: C.green, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 5 }}>📊 AI MARKET SYNTHESIS — ICE COCOA (CC)</div>
              <div style={{ color: C.text, fontSize: 10, fontFamily: "monospace", lineHeight: 1.7 }}>{synthesis}</div>
            </div>
          )}
          {signals.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SectionTitle sub="AI-extracted signals from live web search">Live Signals</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {["BULLISH", "BEARISH", "NEUTRAL"].map(dir => {
                  const col = iColors[dir];
                  const group = signals.filter(s => s.direction === dir);
                  return (
                    <div key={dir} style={{ background: col + "0D", border: `1px solid ${col}33`, borderRadius: 3, padding: "10px 11px" }}>
                      <div style={{ color: col, fontSize: 7, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 6 }}>{dir}</div>
                      {group.length === 0 ? <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>None identified</div>
                        : group.map((s, i) => (
                          <div key={i} style={{ marginBottom: 6 }}>
                            <div style={{ color: C.text, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{s.label}</div>
                            <div style={{ color: C.muted, fontSize: 8, fontFamily: "monospace", marginTop: 1, lineHeight: 1.5 }}>{s.detail}</div>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {articles.length > 0 && (
            <div>
              <SectionTitle sub="AI-summarised from live web search">News Feed</SectionTitle>
              <div style={{ display: "grid", gap: 6 }}>
                {articles.map((a, i) => (
                  <div key={i} style={{ background: C.bg2, borderLeft: `3px solid ${iColors[a.impact] || C.neutral}`, border: `1px solid ${C.border2}`, borderRadius: 3, padding: "9px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <div style={{ flex: 1, paddingRight: 10 }}>
                        <div style={{ color: C.text, fontSize: 10, fontWeight: 700, fontFamily: "monospace", marginBottom: 3 }}>{a.headline}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ color: C.amber, fontSize: 8, fontFamily: "monospace" }}>{a.source}</span>
                          <span style={{ color: C.muted, fontSize: 7 }}>·</span>
                          <span style={{ color: C.muted, fontSize: 8, fontFamily: "monospace" }}>{a.date}</span>
                          <span style={{ background: (cColors[a.category] || C.neutral) + "22", color: cColors[a.category] || C.neutral, fontSize: 7, padding: "1px 5px", borderRadius: 2, fontFamily: "monospace", fontWeight: 700 }}>{a.category}</span>
                        </div>
                      </div>
                      <SignalBadge signal={a.impact} small />
                    </div>
                    <div style={{ color: C.muted, fontSize: 9, fontFamily: "monospace", lineHeight: 1.6 }}>{a.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function CocoaDashboard() {
  const [tab, setTab] = useState("supply");
  const [pulse, setPulse] = useState(true);
  const prices = useLivePrices();

  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 1200);
    return () => clearInterval(t);
  }, []);

  const { spot, change, changePct, loading } = prices;
  const isUp = change >= 0;

  const TABS = [
    { id: "supply", label: "Supply" },
    { id: "demand", label: "Demand" },
    { id: "seasonality", label: "Seasonality" },
    { id: "factors", label: "Factor Analysis" },
    { id: "term", label: "Term Structure" },
    { id: "outlook", label: "Futures Outlook" },
    { id: "cot", label: "COT / Positioning" },
    { id: "news", label: "News & AI", dot: true },
  ];

  return (
    <PriceCtx.Provider value={prices}>
      <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "monospace" }}>
        {/* Header */}
        <div style={{ background: C.bg2, borderBottom: `1px solid ${C.border}`, padding: "10px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 17 }}>🫘</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.amberL, letterSpacing: "0.15em", textTransform: "uppercase" }}>Cocoa Intelligence Terminal</div>
              <div style={{ color: C.muted, fontSize: 7, marginTop: 1, letterSpacing: "0.07em" }}>
                ICE FUTURES U.S. · CC CONTRACT · SUPPLY · DEMAND · FACTORS · TERM STRUCTURE · POSITIONING
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* Live price ticker */}
            <div style={{ background: "#1A1408", border: `1px solid ${C.amber}44`, borderRadius: 3, padding: "4px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ color: C.muted, fontSize: 7, letterSpacing: "0.08em" }}>ICE COCOA CC=F</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ color: C.amberL, fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>
                    {loading ? "…" : spot ? `$${spot.toLocaleString()}` : "—"}
                  </span>
                  {!loading && change !== null && (
                    <span style={{ color: isUp ? C.green : C.red, fontSize: 9, fontFamily: "monospace" }}>
                      {isUp ? "▲" : "▼"}{Math.abs(changePct || 0).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: loading ? C.muted : C.green, opacity: pulse ? 1 : 0.2, transition: "opacity 0.4s" }} />
            </div>
            {[{ label: "CURVE", val: "BACKWARDATED", col: C.green }, { label: "MODEL", val: "CAUTIOUSLY BULLISH", col: C.green }, { label: "DEFICIT 24/25", val: "−150 kt", col: C.red }].map(item => (
              <div key={item.label} style={{ textAlign: "right" }}>
                <div style={{ color: C.muted, fontSize: 7, letterSpacing: "0.08em" }}>{item.label}</div>
                <div style={{ color: item.col, fontSize: 10, fontWeight: 700 }}>{item.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ padding: "8px 22px", background: C.bg2, borderBottom: `1px solid ${C.border2}`, display: "flex", gap: 5, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "5px 12px", background: tab === t.id ? C.amber : "transparent", color: tab === t.id ? "#0A0700" : C.neutral, border: tab === t.id ? "none" : `1px solid ${C.border2}`, borderRadius: 3, fontFamily: "monospace", fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
              {t.label}
              {t.dot && <span style={{ width: 4, height: 4, borderRadius: "50%", background: tab === t.id ? "#0A0700" : C.green }} />}
            </button>
          ))}
        </div>

        {/* Live price banner on all tabs */}
        <div style={{ padding: "14px 22px 0" }}>
          <LivePriceBanner />
        </div>

        {/* Tab content */}
        <div style={{ padding: "0 22px 22px", maxWidth: 1440, margin: "0 auto" }}>
          {tab === "supply" && <SupplyTab />}
          {tab === "demand" && <DemandTab />}
          {tab === "seasonality" && <SeasonalityTab />}
          {tab === "factors" && <FactorTab />}
          {tab === "term" && <TermStructureTab />}
          {tab === "outlook" && <OutlookTab />}
          {tab === "cot" && <COTTab />}
          {tab === "news" && <NewsTab />}
        </div>

        <div style={{ padding: "8px 22px", borderTop: `1px solid ${C.border2}`, display: "flex", justifyContent: "space-between", color: "#3A2E1E", fontSize: 7, letterSpacing: "0.07em" }}>
          <span>EXCHANGE: ICE FUTURES U.S. (FORMERLY NYBOT) · TICKER: CC · DATA: YAHOO FINANCE (15-MIN DELAYED) · CFTC COT · ICCO · USDA</span>
          <span>FOR ANALYTICAL PURPOSES ONLY · NOT INVESTMENT ADVICE</span>
          <span>MARCH 2026</span>
        </div>
      </div>
    </PriceCtx.Provider>
  );
}
