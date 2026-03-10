# 🫘 Cocoa Intelligence Terminal

A professional commodity market dashboard tracking ICE Futures U.S. cocoa (CC) supply, demand, factor analysis, term structure, COT positioning, and AI-powered live news insights.

---

## Features

- **Live Prices** — ICE Cocoa CC=F via Yahoo Finance (15-min delayed), auto-refreshes every 5 mins during market hours
- **Supply & Demand** — Top producers, growing conditions, demand drivers, consumption breakdown
- **Seasonality** — Monthly production/demand curves, price pressure index, West Africa harvest calendar
- **Factor Analysis** — 7-factor variance decomposition (weather, supply shock, grind/demand, macro/USD, spec flow, carry, policy) with z-scores and cross-asset correlations
- **Term Structure** — Live futures curve (10 contracts), OI by expiry, historical curve comparison, roll yield table
- **Futures Outlook** — 6 leading indicators, bull/bear targets, signal distribution, key risks
- **COT / Positioning** — CFTC Commitments of Traders, MM vs Commercial net positions, CTA signal monitor
- **News & AI Insights** — Live web search via Claude AI, extracts bull/bear signals, synthesises market outlook

---

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
npm install

# 2. Run development server (opens at http://localhost:3000)
npm run dev

# 3. Build for production
npm run build

# 4. Preview production build locally
npm run preview
```

---

## Deploy to Vercel (Recommended — Free)

### Option A: Via Vercel CLI (fastest)

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy from project root
vercel

# Follow prompts:
# - Set up and deploy? Y
# - Which scope? (your account)
# - Link to existing project? N
# - Project name: cocoa-terminal
# - Directory: ./
# - Override build settings? N

# You'll get a URL like: https://cocoa-terminal.vercel.app
```

### Option B: Via GitHub (automatic deploys on push)

```bash
# 1. Create a new GitHub repo (e.g. cocoa-terminal)
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/cocoa-terminal.git
git push -u origin main

# 2. Go to https://vercel.com
# 3. Click "Add New Project" → Import from GitHub
# 4. Select your repo → Deploy
# 5. Every git push auto-deploys to your URL
```

---

## Deploy to Netlify (Alternative Free Option)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build & deploy
npm run build
netlify deploy --prod --dir=dist
```

Or drag-and-drop the `dist/` folder at https://app.netlify.com/drop after running `npm run build`.

---

## Add to Phone Home Screen (PWA-style)

Once deployed:
1. Open your Vercel URL in **Chrome (Android)** or **Safari (iOS)**
2. Android: Tap the 3-dot menu → "Add to Home Screen"
3. iOS: Tap the Share icon → "Add to Home Screen"

You now have a native-looking app icon on your phone that opens directly to the dashboard.

---

## Pin as Browser Tab (Desktop)

1. Open your deployed URL in Chrome/Edge
2. Right-click the tab → "Pin Tab"
3. The tab stays pinned across browser restarts — live prices refresh automatically

---

## Exchange & Data Sources

| Data | Source | Latency |
|------|--------|---------|
| Spot price (CC=F) | Yahoo Finance → ICE Futures U.S. | 15-min delayed |
| Term structure contracts | Yahoo Finance (CCK26.NYB etc.) | 15-min delayed |
| Price history (1yr daily) | Yahoo Finance | Daily |
| COT positioning | CFTC (manually updated) | Weekly |
| Supply/demand fundamentals | ICCO / USDA estimates | Seasonal |
| AI news insights | Anthropic Claude + live web search | On-demand |

> **Note:** Cocoa trades on **ICE Futures U.S.** (formerly NYBOT), not NYMEX. The CC contract specification is 10 metric tons per contract, priced in USD per metric ton.

---

## Project Structure

```
cocoa-terminal/
├── index.html          # Entry HTML
├── vite.config.js      # Vite configuration
├── vercel.json         # Vercel deployment config
├── package.json        # Dependencies
├── .gitignore
├── public/
│   └── favicon.svg     # Cocoa bean favicon
└── src/
    ├── main.jsx        # React root
    └── App.jsx         # Full dashboard (all 8 tabs)
```

---

## Refresh Behaviour

- **On load**: Fetches live spot price, 1yr history, and term structure immediately
- **Auto-refresh**: Every 5 minutes when ICE market is open (13:00–21:00 UTC)
- **Manual refresh**: Click the `↺ REFRESH` button in the Live Price Banner on any tab
- **News/AI**: On-demand only — click "Run Analysis" in the News & AI tab

---

*For analytical purposes only. Not investment advice.*
