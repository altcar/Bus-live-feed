# Harry Stoke live bus board

A small Node.js site showing **live departures** for three Bristol boards —
minutes until the bus, not just the timetable.

Dark, phone-friendly, auto-refreshing. Live BODS data is the primary source;
TransportAPI is a **manual-only snapshot** so its 30 hits/day limit is not
burned by page refreshes.

## Stops and route filters

| ATCO | Board | Direction | Routes shown |
| --- | --- | --- | --- |
| `017000054` | Harry Stoke | S-bound | **m1, m4, T1** — primary |
| `017000053` | Harry Stoke | N-bound | **m1, m4, T1** |
| `0100BRP90372` | The Centre (C2) | N-bound | **m1, m4, T1, m3** |

Only these three boards are configured. Each has its own route filter in
`src/config.js`, so **m3 cannot appear on either Harry Stoke board**. The Centre
C2 is the side where m1, m3, m4 and T1 actually depart; C1 is the opposite side
and is not included. Great Stoke (`017000052`) has been removed.

## How it gets live times

### 1. Live BODS (default, always on)

`bustimes.org` renders the stop board from BODS live data. The server polls it
normally and caches it for `REFRESH_SECONDS − 5` seconds. This path **never
calls TAPI**. The UI refreshes every `REFRESH_SECONDS` while the page is open.

### 2. TAPI snapshot (manual only)

Pressing the **TAPI snapshot** button is the only action that calls
TransportAPI. It uses:

`GET /v3/uk/bus/stop_timetables/{ATCO}.json?live=true&source_config=siri_vm`

The response is written to a local cache:

```
%LOCALAPPDATA%\harry-stoke-board\tapi-cache.json
%LOCALAPPDATA%\harry-stoke-board\tapi-usage.json
```

The cache is outside the OneDrive project, survives server restarts, and is
reused by page reloads. **A page reload never calls TAPI.** Only the button
does, and a hard local budget of **28 requests/day** (`TAPI_DAILY_LIMIT`) stops
it from reaching the plan's 30/day ceiling. Rapid repeat presses inside
`TAPI_MIN_INTERVAL_SECONDS` reuse the cache without spending another hit.

The TAPI view pauses auto-refresh. It counts down locally from the snapshot and
clearly labels the time it was fetched. Its route filter is per stop: a TAPI
snapshot taken at The Centre asks for m1/m4/T1/m3, while Harry Stoke snapshots
request only m1/m4/T1.

### 3. Fallbacks

If bustimes/BODS fails, the server uses its last good copy; if there is none, it
uses the cached TAPI snapshot. No fallback path calls TAPI.

There is no SIRI-SX strip: this TAPI key returns `403` for `bus/situations`, so
the endpoint was removed from the request path entirely.

## Setup

Requires Node.js 22 or newer (tested on Node 24).

```powershell
cd "C:\Users\V9\OneDrive - UWE Bristol\Apps\harrystoke"
npm install
npm start
```

Open <http://127.0.0.1:3000>.

For development with auto-restart:

```powershell
npm run dev
```

## View online (GitHub Pages)

A GitHub Action builds a **static snapshot** of all three boards and publishes it
to GitHub Pages — no Node server, and no API key in the browser.

**<https://altcar.github.io/Bus-live-feed/>**

Why TAPI here: GitHub-hosted runners get HTTP 403 from bustimes, so the online
build uses TAPI. It runs every 3 hours and fetches each stop once:
8 builds/day × 3 stops = **24 TAPI calls/day**, inside the 30/day plan. Each
code push or manual run also costs 3 calls, so keep those occasional.

Setup:

1. Enable Pages: **Settings → Pages → Source: GitHub Actions**.
2. Add the repository secrets:

   ```powershell
   gh secret set TAPI_APP_ID --repo altcar/Bus-live-feed
   gh secret set TAPI_APP_KEY --repo altcar/Bus-live-feed
   ```

3. Run `.github/workflows/pages.yml` by schedule, push, or manual dispatch.

How it works:

- `scripts/build-static.mjs` uses TAPI when its credentials are present;
  otherwise it falls back to bustimes/BODS. It writes `dist/index.html`,
  `dist/styles.css`, `dist/app.js` and `dist/data.json`.
- `actions/deploy-pages` publishes `dist/`; the page polls `data.json` every
  5 minutes and counts the minutes down locally.
- The banner shows the exact snapshot time. This is a **3-hour snapshot**, not a
  live stream: TAPI's 30/day limit cannot support minute-by-minute Pages builds.
  The local server remains the live BODS board.
- The online version has **no TAPI button** — a static page cannot keep the key
  secret. The workflow also uploads a downloadable `static-board` artifact.

Local preview:

```powershell
npm run build:static
npm run preview:static   # http://127.0.0.1:3002
```

## Where to get API keys

| Key | Sign up | Copy it |
| --- | --- | --- |
| `TAPI_APP_ID`, `TAPI_APP_KEY` | <https://developer.transportapi.com/signup> | <https://developer.transportapi.com/my-apps> |
| BODS API key (optional; not used by this version) | <https://data.bus-data.dft.gov.uk/account/signup/> | <https://data.bus-data.dft.gov.uk/account/> |

bustimes.org needs no key. Copy `.env.example` to `.env`, paste the TAPI
credentials, and keep `.env` private — it is git-ignored.

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRIMARY_PROVIDER` | `bustimes` | Always-on source; TAPI can never auto-refresh |
| `TAPI_APP_ID` / `TAPI_APP_KEY` | — | TransportAPI credentials |
| `TAPI_DAILY_LIMIT` | `28` | Hard local cap on manual TAPI hits |
| `TAPI_CACHE_SECONDS` | `21600` | Age before a snapshot is marked old (6 h) |
| `TAPI_MIN_INTERVAL_SECONDS` | `10` | Debounce repeated TAPI button presses |
| `STOPS` | `017000054,017000053,0100BRP90372` | Boards in order; first is default |
| `ROUTES` | `m1,m4,T1,m3` | Fallback filter; known stops use their per-stop list |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Listen address |
| `REFRESH_SECONDS` | `60` | Live BODS refresh interval (30–600) |
| `HORIZON_HOURS` | `3` | How far ahead TAPI fetches (1–6) |

`.env` is git-ignored. Do not commit real keys.

## API

- `GET /api/config` — stops, routes, refresh interval, TAPI budget and cache state.
- `GET /api/departures?stop=017000054` — live BODS board (default).
- `GET /api/departures?stop=017000054&provider=bustimes&refresh=1` — bypass the
  short bustimes cache; still no TAPI call.
- `GET /api/departures?stop=017000054&provider=tapi` — **cache-only**. Returns
  `404 tapi_cache_empty` if no snapshot exists; never touches the network.
- `GET /api/departures?stop=017000054&provider=tapi&refresh=1` — **manual TAPI
  fetch**, spends one budget unit.
- `GET /api/health` — liveness, primary provider and TAPI hits remaining.

Response shape (abridged):

```json
{
  "stop": { "atco": "017000054", "label": "Harry Stoke", "indicator": "S-bound" },
  "provider": "bustimes.org · BODS",
  "providerMode": "bustimes",
  "departures": [
    {
      "line": "m1",
      "destination": "Hengrove Park",
      "aimedTime": "13:40",
      "expectedTime": "13:42",
      "bestEpoch": 1761136920000,
      "minutes": 2,
      "due": false,
      "live": true,
      "cancelled": false
    }
  ],
  "tapi": {
    "enabled": true,
    "dailyLimit": 28,
    "remaining": 28,
    "cacheSeconds": 21600,
    "cachedAt": null,
    "ageSeconds": null,
    "fromCache": false,
    "error": null
  }
}
```

## Notes and limits

- **TAPI hits:** only `provider=tapi&refresh=1` spends one. Page loads, page
  reloads, stop switches while in TAPI mode, live auto-refresh, and fallbacks
  are all free.
- **TAPI 403:** means the daily quota is gone or the key is restricted. The
  cached snapshot is shown with a warning; Live BODS continues normally.
- **bustimes.org** is an unofficial HTML scrape. It can break if its page
  structure changes. Because it is the primary source, 60 s polling should stay
  modest; raise `REFRESH_SECONDS` if you prefer a gentler cadence.
- **Security:** binds to `127.0.0.1` by default. If you expose it, put it behind
  a reverse proxy with authentication and keep the TAPI key server-side. API
  responses never include `app_id`/`app_key`.
- Data attribution: bus data via BODS/bustimes.org and TransportAPI. Check each
  service's terms before redistributing.

## Tests

```powershell
npm test
```

Covers London/BST time conversion (including the October DST change), route
filtering, de-duplication, live detection, TAPI cost normalisation, the daily
budget cap and snapshot persistence.
