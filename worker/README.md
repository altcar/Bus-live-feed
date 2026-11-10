# Bus live feed — Cloudflare Worker

One Worker serves both the static board and the live API at
`https://m1-bus.hheylau.workers.dev/`. The browser calls `/api/*` on the same
origin, so no GitHub Pages build or CORS configuration is needed.

## Routes

- `GET /` — the board (`worker/assets/index.html`)
- `GET /styles.css`, `GET /app.js` — static assets
- `GET /api/config`
- `GET /api/health`
- `GET /api/departures?stop=017000054&provider=bustimes`
- `GET /api/departures?stop=017000054&provider=tapi` — cache-only, **no hit**
- `GET /api/departures?stop=017000054&provider=tapi&refresh=1` — manual fetch,
  spends **1 TAPI hit**

Anything under `/api/*` that is not listed returns `404`; everything else falls
through to the `ASSETS` binding.

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

Build the static assets, then deploy:

```powershell
npm run build:worker
npx wrangler deploy --config worker/wrangler.toml
```

Optional TAPI secrets (the TAPI button stays disabled until both are set):

```powershell
npx wrangler secret put TAPI_APP_ID
npx wrangler secret put TAPI_APP_KEY
```

For automatic deployments, connect the repository in the Cloudflare dashboard:
Workers & Pages → `m1-bus` → Settings → Builds → Connect → GitHub. Use build
command `node scripts/build-worker-assets.mjs` and deploy command
`npx wrangler@4.160.0 deploy`. The `name` in `wrangler.toml` must stay `m1-bus`.

## Notes

- `ALLOWED_ORIGINS` allows `https://altcar.github.io`, the Worker itself and the
  local static preview.
- The Worker caches bustimes HTML for 60 seconds via Cloudflare's edge cache.
- If bustimes returns 403 to Cloudflare's egress, `/api/departures` returns 502
  and the page shows its error state. BODS/Worker was verified working.
- Secrets are encrypted Worker secrets; they are not in this repository.
