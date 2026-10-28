import process from 'node:process';

/**
 * The three boards. Routes are filtered per stop, because m3 only applies at
 * The Centre and must not appear at Harry Stoke.
 */
export const STOP_META = {
  '017000054': {
    label: 'Harry Stoke',
    indicator: 'S-bound',
    hint: 'towards City Centre & Hengrove Park',
    routes: ['m1', 'm4', 'T1'],
    primary: true,
    lat: 51.50761,
    lon: -2.53748,
  },
  '017000053': {
    label: 'Harry Stoke',
    indicator: 'N-bound',
    hint: 'towards Cribbs Causeway & Thornbury',
    routes: ['m1', 'm4', 'T1'],
    lat: 51.50779,
    lon: -2.53801,
  },
  '0100BRP90372': {
    label: 'The Centre',
    indicator: 'C2',
    hint: 'N-bound · towards Cribbs Causeway, Emersons Green & Thornbury',
    routes: ['m1', 'm4', 'T1', 'm3'],
    lat: 51.45409,
    lon: -2.59694,
  },
};

const DEFAULT_STOPS = ['017000054', '017000053', '0100BRP90372'];
const DEFAULT_ROUTES = ['m1', 'm4', 'T1', 'm3'];

function number(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function csv(value, fallback) {
  if (!value) return fallback;
  const items = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

const stopCodes = csv(process.env.STOPS, DEFAULT_STOPS).filter((code) =>
  /^[0-9A-Za-z]{6,20}$/.test(code)
);

const primaryProvider =
  String(process.env.PRIMARY_PROVIDER || 'bustimes').toLowerCase() === 'tapi'
    ? 'tapi'
    : 'bustimes';

export const config = {
  port: number(process.env.PORT, 3000, 1, 65535),
  host: process.env.HOST || '127.0.0.1',
  refreshSeconds: number(process.env.REFRESH_SECONDS, 60, 30, 600),
  horizonHours: number(process.env.HORIZON_HOURS, 3, 1, 6),
  limit: 50,
  primaryProvider,
  stops: stopCodes.length ? stopCodes : DEFAULT_STOPS,
  routes: csv(process.env.ROUTES, DEFAULT_ROUTES),
  tapi: {
    appId: (process.env.TAPI_APP_ID || '').trim(),
    appKey: (process.env.TAPI_APP_KEY || '').trim(),
    baseUrl: (process.env.TAPI_BASE_URL || 'https://transportapi.com').replace(/\/+$/, ''),
    // Hard local budget. Kept below the real 30/day plan so a few calls remain.
    dailyLimit: number(process.env.TAPI_DAILY_LIMIT, 28, 1, 10_000),
    // A snapshot older than this is shown with a warning, never auto-refreshed.
    cacheSeconds: number(process.env.TAPI_CACHE_SECONDS, 6 * 60 * 60, 60, 7 * 24 * 60 * 60),
    // Debounce accidental double-clicks on the TAPI button.
    minIntervalSeconds: number(process.env.TAPI_MIN_INTERVAL_SECONDS, 10, 0, 3600),
  },
};

config.tapi.enabled = Boolean(config.tapi.appId && config.tapi.appKey);

/** Route filter for a stop: its own list when known, otherwise the global list. */
export function routesForStop(atco) {
  const meta = STOP_META[atco];
  return meta?.routes?.length ? meta.routes : config.routes;
}

export function publicConfig() {
  return {
    defaultStop: config.stops[0],
    stops: config.stops.map((atco) => {
      const meta = STOP_META[atco] || {};
      return {
        atco,
        label: meta.label || atco,
        indicator: meta.indicator || '',
        hint: meta.hint || '',
        routes: routesForStop(atco),
      };
    }),
    routes: config.routes,
    refreshSeconds: config.refreshSeconds,
    primaryProvider: config.primaryProvider,
    tapi: {
      enabled: config.tapi.enabled,
      dailyLimit: config.tapi.dailyLimit,
      cacheSeconds: config.tapi.cacheSeconds,
    },
  };
}
