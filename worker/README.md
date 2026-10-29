# Bus live feed — Cloudflare Worker

A CORS-enabled API for the static GitHub Pages board. It serves the same `/api`
shape as the local Node server, so the browser can fetch live data directly
instead of waiting for Pages rebuilds.

## Endpoints

- `GET /api/config`
- `GET /api/health`
- `GET /api/departures?stop=017000054&provider=bustimes`
- `GET /api/departures?stop=017000054&provider=tapi` — cache-only, **no hit**
- `GET /api/departures?stop=017000054&provider=tapi&refresh=1` — manual fetch,
  spends **1 TAPI hit**

## Sources

- **bustimes.org / BODS** is the live primary source.
- **TAPI** is manual-only. Snapshots and the daily usage counter live in the
  `BOARD_KV` namespace:
  - `tapi:<ATCO>` — normalized snapshot, 7-day TTL
  - `usage:<YYYY-MM-DD>` — London-day counter, 2-day TTL
- Budget: 28/day (`TAPI_DAILY_LIMIT`), 6-hour stale marker
  (`TAPI_CACHE_SECONDS`), 10-second double-click guard
  (`TAPI_MIN_INTERVAL_SECONDS`).
- Page reloads in TAPI mode read the KV snapshot and do **not** call TAPI.

The Worker and the local Node board use the same TAPI key, and therefore the same
upstream 30/day cap. Each has its own local guard, so don't max both.

## Deploy

```powershell
cd "C:\Users\V9\OneDrive - UWE Bristol\Apps\harrystoke\worker"
npx wrangler login

# First time only: create the KV namespace and put its id in wrangler.toml
npx wrangler kv namespace create BOARD_KV

npx wrangler secret put TAPI_APP_ID
npx wrangler secret put TAPI_APP_KEY
npx wrangler deploy
```

The deployed URL is printed by Wrangler. Point Pages at it:

```powershell
gh variable set WORKER_URL --repo altcar/Bus-live-feed --body "https://bus-live-feed.<subdomain>.workers.dev"
```

Re-run **Publish static board**. The Pages HTML will carry:

```html
<meta name="api-base" content="https://bus-live-feed.<subdomain>.workers.dev">
```

and the browser fetches the Worker every 60 seconds.

If `WORKER_URL` is empty, the Pages build stays in snapshot mode and uses
`data.json`.

## Notes

- `ALLOWED_ORIGINS` allows `https://altcar.github.io` and the local static
  preview.
- The Worker caches bustimes HTML for 60 seconds via Cloudflare's edge cache.
- If bustimes returns 403 to Cloudflare's egress, `/api/departures` returns 502
  and the page shows its error state. BODS/Worker was verified working.
- Secrets are encrypted Worker secrets; they are not in this repository.
