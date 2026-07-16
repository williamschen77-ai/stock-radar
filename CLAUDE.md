# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

個股透視 Stock Radar — a Traditional Chinese (zh-TW) web app for tracking Taiwan-listed stocks from the angle of which active ETFs hold them: quote/K-line, three-major-institutional-investor (三大法人) flows, active-ETF holdings and buy/sell flow, disposition/margin-lock status, AI-generated advice, news, and a 5-day AI price prediction. Deployed on Vercel; `mobile/` wraps the same web app as a native iOS/Android app via Capacitor.

## Commands

Web app (repo root):
```bash
npm install
npm run dev       # vite dev server
npm run build     # production build to dist/
npm run preview   # preview the production build
```
There is no lint or test configuration in this repo — `npm run build` (which runs through Vite/esbuild) is the only available correctness check.

Mobile app (`mobile/`, separate npm project):
```bash
cd mobile
cp .env.example .env   # set STOCK_RADAR_API_ORIGIN to a public HTTPS domain
npm install
npm run ios:add        # first time only: creates ios/ via Capacitor
npm run android:add    # first time only: creates android/
npm run assets         # generate icons from resources/icon.png
npm run ios:prepare    # copies PrivacyInfo.xcprivacy into the Xcode project
npm run sync            # build the web app (CAPACITOR_BUILD=true) + `cap sync`
npm run ios:open        # open ios/ in Xcode
npm run android:open    # open android/ in Android Studio
```
After editing web source, `npm run sync` must be re-run before testing in Xcode/Android Studio. See `mobile/README.md` for the App Store submission checklist.

## Architecture

### Frontend is a single-file SPA
`src/App.jsx` (~740 lines) is the entire UI: theme, data fetching, chart rendering (hand-rolled inline SVG, no charting library), and all view components, in one file with a dense one-line-per-function style. There is no router — `view` state (`"stock" | "research" | "flow"`) and `tab` state switch between screens. Match the existing compact style (minimal whitespace, inline object styles keyed off the `T` theme constant) rather than reformatting into multiple files/components.

- `src/stockList.js` — a small static `STOCK_MAP` (code → name/sector) used for instant, offline autocomplete and for resolving display names everywhere in the UI.
- `api/search.js` provides the *real* dynamic search over the full FinMind security universe (TWSE/TPEx/emerging/ETF), cached in-memory for 24h. `useSearch()` in App.jsx shows local `STOCK_MAP` matches instantly, then merges in the debounced `/api/search` results — this two-tier pattern is intentional, not redundant.
- `src/nativeBridge.js` wraps Capacitor plugins (Share, LocalNotifications) behind `isNativeApp()`; on the web build these plugins are absent and calls fall back to `navigator.share`/clipboard or a no-op.
- `import.meta.env.VITE_API_ORIGIN` prefixes every API call (`apiUrl`/`apiFetch`/`apiPost` in App.jsx). It's empty for the normal Vercel deploy (same-origin `/api/*`) and set to a public HTTPS domain for the Capacitor mobile build, since the native shell can't hit relative paths.

### Backend is one Vercel serverless function per file, no framework
Every file in `api/` exports a plain `default async function handler(req, res)` and manually sets its own CORS headers (`Access-Control-Allow-Origin: *`) — there's no shared middleware layer, so new endpoints need to repeat this. Shared code lives only in `api/_lib/`:

- `api/_lib/kv.js` — a minimal hand-rolled Upstash Redis REST client (no `@vercel/kv` dependency). Every exported function returns `null` when `KV_REST_API_URL`/`KV_REST_API_TOKEN` aren't set (`kvEnabled()`); callers must handle that "history tracking not configured" state rather than assume KV is present.
- `api/_lib/moneydj.js` — the MoneyDJ ETF-holdings scraper plus `ACTIVE_ETF_CODES`, the canonical list of the ~22 Taiwan active equity ETFs (TWSE convention: trailing `A`) this app tracks. It's shared between the live lookup endpoint (`api/etf-holdings.js`) and the daily snapshot cron (`api/cron/snapshot-etf.js`) specifically so the scraping logic can't drift between the two call sites — change it once.

**ETF flow pipeline**: `vercel.json` schedules `api/cron/snapshot-etf.js` on weekday afternoons (post Taiwan market close). It fetches current holdings for every `ACTIVE_ETF_CODES` entry and writes each as a JSON blob to `etfsnap:{code}:{date}` plus a date index in a KV sorted set (`etfsnap:{code}:dates`). `api/etf-flow.js` reads back consecutive snapshots and diffs them to compute per-stock buy/sell consensus, NTD amounts (via live Yahoo prices), and timelines — this is real historical data, unlike the single-snapshot `api/etf-holdings.js`. Without KV configured, both the cron and `etf-flow.js` degrade gracefully (`{ ok:false, reason:'kv_not_configured' }`) instead of failing.

**External data sources** (know these before touching an endpoint):
- Yahoo Finance chart JSON — `api/quote.js` (tries `.TW` then `.TWO` suffix), and ad-hoc price lookups inside `etf-flow.js`/`fund-flow.js`.
- TWSE T86 report — `api/institutional.js` (per-stock, TWSE-listed) and `api/fund-flow.js` (market-wide 投信 aggregation).
- TPEx open data API — `api/institutional.js` fallback for OTC stocks (field names contain irregular whitespace; must match on whitespace-stripped exact field name, not substring — see `getField()`).
- MoneyDJ HTML scrape — `api/_lib/moneydj.js` (regex-parsed, no HTML parser library).
- FinMind API — `api/search.js` (full security universe) and `api/disposition.js` (margin short-sale suspension periods).
- TWSE punishment/announcement API — `api/disposition.js` (disposition/"處置股" status).
- CountAPI — `api/visitors.js` (public, keyless hit counter; returns `null` rather than a fake number if unreachable).

**AI features have no visible API key.** `api/advice.js`, `api/news.js`, and the client-side `fetchAIPred()` in `App.jsx` all POST directly to `https://api.anthropic.com/v1/messages` (model `claude-sonnet-4-6`) with no `x-api-key`/auth header in the code. All three wrap the call in try/catch and fall back to hardcoded, plausible-looking Chinese placeholder content on any failure — so a broken or missing key fails *silently* in the UI rather than erroring. If you're debugging "AI advice/news looks generic," check whether the request is actually succeeding before assuming the prompt is at fault.

### Environment variables
`VITE_API_ORIGIN` (frontend, mobile builds only), `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel KV / Upstash, enables ETF flow history), `CRON_SECRET` (optional bearer token guarding `api/cron/snapshot-etf.js`), `FINMIND_TOKEN` (optional, raises FinMind rate limits), `STOCK_RADAR_API_ORIGIN` (mobile build only, read by `mobile/scripts/build-web.mjs`).

## Conventions

- UI copy and most code comments are Traditional Chinese; keep new UI text and comments in zh-TW for consistency.
- Vercel's Hobby plan function-count limit has previously forced merging endpoints (see commit `6465443`) — think twice before splitting `api/etf-flow.js`'s multi-`view` handler back into separate files.
- Monetary formatting is duplicated per file rather than shared (張 = board lot = 1000 shares; amounts shown in 億/萬) — check the local `fmt`/`formatYi`/`formatNtd` helper in the file you're editing rather than introducing a new shared formatter.
- `src/App.jsx`'s deploy note in `README.md`: pushing to `main` auto-deploys via Vercel.

## Known repo cruft
`api/stockList.js` and `src/files.zip`/`src/files2.zip` are stray artifacts (an older duplicate stock map, and backup zips of previously-edited files) not referenced by any route or import. Leave them as-is unless the user explicitly asks for cleanup.
