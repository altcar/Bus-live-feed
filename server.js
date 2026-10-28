import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config, publicConfig, routesForStop, STOP_META } from './src/config.js';
import { fetchBustimesBoard } from './src/bustimes.js';
import { fetchTapiBoard } from './src/tapi.js';
import {
  consumeTapiHit,
  getTapiCache,
  getTapiRemaining,
  setTapiCache,
  statePaths,
} from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/** atco -> { data, expires } for bustimes/BODS, the always-on source. */
const bustimesCache = new Map();
/** atco -> last successful bustimes payload. */
const bustimesLastGood = new Map();

function mapTapiError(err) {
  if (err?.code) return err;

  const status = err?.status ?? null;
  let code = 'tapi_unavailable';
  let message = 'TAPI is unavailable right now.';

  if (status === 401) {
    code = 'tapi_unauthorized';
    message = 'TAPI rejected the API key (401).';
  } else if (status === 403) {
    code = 'tapi_forbidden';
    message = 'TAPI returned 403 — the daily quota may be used up, or the key is restricted.';
  } else if (status === 429) {
    code = 'tapi_rate_limited';
    message = 'TAPI rate limit reached (429).';
  }

  const mapped = new Error(message);
  mapped.status = status || 502;
  mapped.code = code;
  return mapped;
}

function tapiMeta(atco, extra = {}) {
  const cached = getTapiCache(atco);
  return {
    enabled: config.tapi.enabled,
    dailyLimit: config.tapi.dailyLimit,
    remaining: getTapiRemaining(config.tapi.dailyLimit),
    cacheSeconds: config.tapi.cacheSeconds,
    cachedAt: cached?.fetchedAt || null,
    ageSeconds: cached?.ageSeconds ?? null,
    ...extra,
  };
}

function withStopMeta(board, atco) {
  const meta = STOP_META[atco] || {};
  return {
    ...board,
    stop: {
      ...board.stop,
      label: meta.label || board.stop?.name || atco,
      hint: meta.hint || '',
      lat: meta.lat ?? board.stop?.lat ?? null,
      lon: meta.lon ?? board.stop?.lon ?? null,
    },
  };
}

/**
 * Bustimes/BODS is the primary live feed. It is polled normally and has no
 * TAPI quota. If it fails, the last good copy or a cached TAPI snapshot is
 * used instead, without making any TAPI request.
 */
async function loadBustimes(atco, { force = false } = {}) {
  const now = Date.now();
  const cached = bustimesCache.get(atco);

  if (!force && cached && now < cached.expires) {
    return { ...cached.data, cached: true };
  }

  try {
    const data = await fetchBustimesBoard(atco, { routes: routesForStop(atco) });
    const enriched = {
      ...data,
      provider: 'bustimes.org · BODS',
      degraded: false,
    };

    bustimesCache.set(atco, {
      data: enriched,
      expires: now + Math.max(20, config.refreshSeconds - 5) * 1000,
    });
    bustimesLastGood.set(atco, enriched);
    return enriched;
  } catch (err) {
    const previous = bustimesLastGood.get(atco);
    if (previous) {
      return { ...previous, stale: true, error: 'bustimes_unavailable' };
    }

    const tapiCached = getTapiCache(atco);
    if (tapiCached) {
      return {
        ...tapiCached.data,
        provider: 'TAPI snapshot · cached fallback',
        degraded: true,
        stale: true,
        tapiCached: true,
        error: 'bustimes_unavailable',
      };
    }

    throw err;
  }
}

/**
 * TAPI is manual-only.
 *  - cache-only reads never touch the network;
 *  - force is only set by clicking the TAPI button;
 *  - every forced attempt spends one local budget unit before it starts.
 */
async function loadTapi(atco, { force = false } = {}) {
  if (!config.tapi.enabled) {
    const err = new Error('TAPI credentials are not configured.');
    err.status = 503;
    err.code = 'tapi_disabled';
    throw err;
  }

  const cached = getTapiCache(atco);

  if (!force) {
    if (cached) {
      return {
        ...cached.data,
        provider: 'TAPI snapshot (cached)',
        tapiCached: true,
      };
    }

    const err = new Error('No TAPI snapshot is cached for this stop yet.');
    err.status = 404;
    err.code = 'tapi_cache_empty';
    throw err;
  }

  // Debounce accidental double clicks without spending a hit.
  if (cached && cached.ageSeconds !== null && cached.ageSeconds < config.tapi.minIntervalSeconds) {
    return {
      ...cached.data,
      provider: 'TAPI snapshot (cached)',
      tapiCached: true,
      cooldown: true,
    };
  }

  const spend = consumeTapiHit(config.tapi.dailyLimit);
  if (!spend.ok) {
    const message = `Daily TAPI limit reached (${config.tapi.dailyLimit}/${config.tapi.dailyLimit}).`;
    if (cached) {
      return {
        ...cached.data,
        provider: 'TAPI snapshot (cached)',
        tapiCached: true,
        tapiError: 'tapi_daily_limit',
        tapiMessage: message,
      };
    }

    const err = new Error(message);
    err.status = 429;
    err.code = 'tapi_daily_limit';
    throw err;
  }

  console.log('[tapi] manual fetch', {
    atco,
    spent: spend.count,
    remaining: spend.remaining,
  });

  try {
    const data = await fetchTapiBoard(atco, { routes: routesForStop(atco) });
    const fetchedAt = data.fetchedAt || new Date().toISOString();
    setTapiCache(atco, data, fetchedAt);
    return { ...data, provider: 'TAPI snapshot' };
  } catch (raw) {
    const err = mapTapiError(raw);
    console.error('[tapi] manual fetch failed', {
      atco,
      status: err.status,
      code: err.code,
      remaining: getTapiRemaining(config.tapi.dailyLimit),
    });

    if (cached) {
      return {
        ...cached.data,
        provider: 'TAPI snapshot (cached)',
        tapiCached: true,
        tapiError: err.code,
        tapiMessage: err.message,
      };
    }

    throw err;
  }
}

app.get('/api/config', (_req, res) => {
  const base = publicConfig();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...base,
    tapi: {
      ...base.tapi,
      remaining: getTapiRemaining(config.tapi.dailyLimit),
      caches: Object.fromEntries(
        config.stops.map((atco) => {
          const cached = getTapiCache(atco);
          return [
            atco,
            cached ? { fetchedAt: cached.fetchedAt, ageSeconds: cached.ageSeconds } : null,
          ];
        })
      ),
    },
  });
});

app.get('/api/departures', async (req, res) => {
  const atco = String(req.query.stop || config.stops[0]);
  if (!config.stops.includes(atco)) {
    res.status(400).json({ error: 'unknown_stop', stops: config.stops });
    return;
  }

  const provider = String(req.query.provider || 'bustimes').toLowerCase();
  if (provider !== 'bustimes' && provider !== 'tapi') {
    res.status(400).json({ error: 'unknown_provider', providers: ['bustimes', 'tapi'] });
    return;
  }

  const force = req.query.refresh === '1';

  try {
    const raw =
      provider === 'tapi'
        ? await loadTapi(atco, { force })
        : await loadBustimes(atco, { force });

    const {
      tapiCached,
      cooldown,
      tapiError,
      tapiMessage,
      ...board
    } = raw;

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...withStopMeta(board, atco),
      providerMode: provider,
      tapi: tapiMeta(atco, {
        fromCache: Boolean(tapiCached),
        cooldown: Boolean(cooldown),
        error: tapiError || null,
        message: tapiMessage || null,
      }),
      serverTime: Date.now(),
      refreshSeconds: config.refreshSeconds,
      horizonHours: config.horizonHours,
    });
  } catch (raw) {
    const err = mapTapiError(raw);
    console.error('[departures] failed', {
      atco,
      provider,
      status: err.status,
      code: err.code,
    });
    res.status(err.status || 502).json({
      error: err.code || 'upstream_unavailable',
      message: err.message || 'Departure data is unavailable right now.',
      providerMode: provider,
      tapi: tapiMeta(atco, { error: err.code || 'upstream_unavailable' }),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    primaryProvider: config.primaryProvider,
    stops: config.stops,
    tapiRemaining: getTapiRemaining(config.tapi.dailyLimit),
  });
});

app.use(
  express.static(publicDir, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(404).type('text/plain').send('Not found');
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Harry Stoke board: http://${config.host}:${config.port}`);
  console.log(`Primary source: bustimes.org / BODS (auto-refresh)`);
  console.log(
    `TAPI: manual only · ${config.tapi.dailyLimit}/day budget · cache ${statePaths().cacheFile}`
  );
  console.log(
    `TAPI credentials: ${config.tapi.enabled ? 'configured' : 'missing'} · stops: ${config.stops.join(', ')}`
  );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Set PORT in .env and retry.`);
    process.exitCode = 1;
    return;
  }
  throw err;
});
