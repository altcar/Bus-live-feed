# Bus live feed — Cloudflare Worker

A tiny CORS-enabled API for the static GitHub Pages board. It fetches the
bustimes/BODS departures fragment and returns the same `/api` shape as the
local Node server, so the page can fetch live data directly instead of waiting
for a Pages rebuild.

Endpoints:

- `GET /api/config`
- `GET /api/departures?stop=017000054&provider=bustimes`
- `GET /api/health`

TAPI is intentionally disabled here: a public Worker cannot offer a manual
button without a KV-backed budget, and the local server already handles it.

## Deploy

```powershell
cd "C:\Users\V9\OneDrive - UWE Bristol\Apps\harrystoke\worker"
npx wrangler login
npx wrangler deploy
```

Copy the printed `https://bus-live-feed.<your-subdomain>.workers.dev` URL, then
point the Pages build at it:

```powershell
gh variable set WORKER_URL --repo altcar/Bus-live-feed --body "https://bus-live-feed.<your-subdomain>.workers.dev"
```

Re-run **Publish static board** in GitHub Actions. The Pages HTML will carry:

```html
<meta name="api-base" content="https://bus-live-feed.<your-subdomain>.workers.dev">
```

and the browser will fetch the Worker every 60 seconds.

If the Worker URL variable is empty, the Pages build stays in snapshot mode and
uses `data.json`.

## Notes

- `ALLOWED_ORIGINS` is set in `wrangler.toml` for `https://altcar.github.io`
  and the local static preview.
- The Worker caches the bustimes HTML for 60 seconds via Cloudflare's edge cache.
- If bustimes returns 403 to Cloudflare's egress, `/api/departures` returns 502
  and the page shows its error state. Test immediately after deploying.
- No secrets are required for the bustimes-only Worker.
