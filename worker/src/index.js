const TZ = 'Europe/London';
const DEFAULT_ORIGINS =
  'https://altcar.github.io,http://127.0.0.1:3002,http://localhost:3002';

const STOPS = {
  '017000054': {
    label: 'Harry Stoke',
    indicator: 'S-bound',
    hint: 'towards City Centre & Hengrove Park',
    routes: ['m1', 'm4', 'T1'],
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

const ROUTES = ['m1', 'm4', 'T1', 'm3'];

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function pad(n) {
  return String(n).padStart(2, '0');
}

function londonParts(input) {
  const date = input instanceof Date ? input : new Date(input);
  const out = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

function londonDate(input = new Date()) {
  const p = londonParts(input);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function zonedTimeToEpoch(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr || ''));
  if (!dm || !tm) throw new Error('Invalid date/time');

  const target = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    Number(tm[3] || 0)
  );

  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = londonParts(new Date(guess));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = target - asUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTime(value) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function parseBustimes(html, atco, now = Date.now()) {
  const meta = STOPS[atco];
  if (!meta) throw Object.assign(new Error('Unknown stop'), { status: 400 });

  const today = londonDate(new Date(now));
  const seen = new Set();
  const departures = [];

  for (const rowMatch of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 3) continue;

    const line = stripTags(cells[0]);
    if (!line) continue;
    if (!meta.routes.some((r) => r.toLowerCase() === line.toLowerCase())) continue;

    const destHtml = cells[1].replace(/<div class="vehicle">[\s\S]*?<\/div>/gi, '');
    const destination = stripTags(destHtml);
    const aimedTime = firstTime(cells[2]);
    const expectedTime = firstTime(cells[3] || '');
    if (!aimedTime) continue;

    let aimedEpoch = zonedTimeToEpoch(today, aimedTime);
    if (aimedEpoch < now - 6 * 60 * 60 * 1000) {
      aimedEpoch = zonedTimeToEpoch(addDays(today, 1), aimedTime);
    }

    let expectedEpoch = null;
    if (expectedTime) {
      expectedEpoch = zonedTimeToEpoch(londonDate(new Date(aimedEpoch)), expectedTime);
      if (expectedEpoch < aimedEpoch - 6 * 60 * 60 * 1000) {
        expectedEpoch += 24 * 60 * 60 * 1000;
      }
    }

    const bestEpoch = expectedEpoch ?? aimedEpoch;
    if (bestEpoch < now - 90_000) continue;

    const key = `${line.toLowerCase()}|${bestEpoch}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const displayLine =
      meta.routes.find((r) => r.toLowerCase() === line.toLowerCase()) || line;

    departures.push({
      line: displayLine,
      destination: destination || 'Unknown destination',
      aimedDate: londonDate(new Date(aimedEpoch)),
      aimedTime,
      expectedDate: expectedEpoch !== null ? londonDate(new Date(expectedEpoch)) : null,
      expectedTime,
      aimedEpoch,
      bestEpoch,
      minutes: Math.max(0, Math.floor((bestEpoch - now) / 60_000)),
      due: bestEpoch - now <= 60_000,
      live: Boolean(expectedTime),
      cancelled: false,
      source: 'bustimes.org',
      operator: '',
      operatorName: '',
      occupancy: '',
    });
  }

  departures.sort((a, b) => a.bestEpoch - b.bestEpoch);

  return {
    stop: {
      atco,
      name: meta.label,
      label: meta.label,
      indicator: meta.indicator,
      hint: meta.hint,
      locality: meta.label,
      bearing: '',
      smscode: '',
      lat: meta.lat,
      lon: meta.lon,
    },
    departures: departures.slice(0, 40),
    fetchedAt: new Date(now).toISOString(),
    requestTime: null,
  };
}

async function fetchBustimes(atco) {
  const res = await fetch(
    `https://bustimes.org/stops/${encodeURIComponent(atco)}/departures`,
    {
      headers: {
        Accept: 'text/html',
        'User-Agent':
          'bus-live-feed-worker/1.0 (+https://github.com/altcar/Bus-live-feed)',
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    }
  );

  if (!res.ok) {
    const err = new Error(`bustimes HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.text();
}

function cleanDestination(value) {
  return String(value || '')
    .replace(/,\s*The Centre\s*$/i, '')
    .trim();
}

function isTrue(value) {
  return value === true || value === 'true' || value === 1;
}

function tapiSettings(env) {
  return {
    enabled: Boolean(env.TAPI_APP_ID && env.TAPI_APP_KEY && env.BOARD_KV),
    dailyLimit: Math.max(1, Number(env.TAPI_DAILY_LIMIT) || 28),
    cacheSeconds: Math.max(60, Number(env.TAPI_CACHE_SECONDS) || 21_600),
    minIntervalSeconds: Math.max(0, Number(env.TAPI_MIN_INTERVAL_SECONDS) || 10),
  };
}

async function getTapiCache(env, atco) {
  if (!env.BOARD_KV) return null;
  try {
    const raw = await env.BOARD_KV.get(`tapi:${atco}`, { type: 'json' });
    if (!raw?.data || !raw.fetchedAt) return null;
    const fetchedMs = Date.parse(raw.fetchedAt);
    const ageSeconds = Number.isFinite(fetchedMs)
      ? Math.max(0, Math.floor((Date.now() - fetchedMs) / 1000))
      : null;
    return { data: raw.data, fetchedAt: raw.fetchedAt, ageSeconds };
  } catch {
    return null;
  }
}

async function setTapiCache(env, atco, data) {
  await env.BOARD_KV.put(
    `tapi:${atco}`,
    JSON.stringify({ data, fetchedAt: data.fetchedAt }),
    { expirationTtl: 7 * 24 * 60 * 60 }
  );
}

async function getTapiRemaining(env) {
  const settings = tapiSettings(env);
  if (!settings.enabled) return null;
  try {
    const date = londonDate();
    const raw = await env.BOARD_KV.get(`usage:${date}`);
    const count = Number(raw) || 0;
    return Math.max(0, settings.dailyLimit - count);
  } catch {
    return null;
  }
}

async function consumeTapiHit(env) {
  const settings = tapiSettings(env);
  const date = londonDate();
  const key = `usage:${date}`;
  const current = Number(await env.BOARD_KV.get(key)) || 0;
  if (current >= settings.dailyLimit) {
    return { ok: false, count: current, remaining: 0 };
  }
  const count = current + 1;
  await env.BOARD_KV.put(key, String(count), { expirationTtl: 2 * 24 * 60 * 60 });
  return { ok: true, count, remaining: settings.dailyLimit - count };
}

function normalizeTapiBoard(json, atco, now = Date.now()) {
  const meta = STOPS[atco];
  const raw = Object.values(json.departures || {}).flat();
  const seen = new Set();
  const departures = [];

  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;

    const line = String(d.line || d.line_name || '').trim();
    if (!line) continue;
    if (!meta.routes.some((r) => r.toLowerCase() === line.toLowerCase())) continue;

    const aimedDate = d.aimed?.departure?.date || d.date;
    const aimedTime = d.aimed_departure_time || d.aimed?.departure?.time;
    if (!aimedDate || !aimedTime) continue;

    const expectedTime = d.expected_departure_time || d.expected?.departure?.time || null;
    const expectedDate =
      d.expected_departure_date || d.expected?.departure?.date || aimedDate;

    const bestDate = expectedTime ? expectedDate : aimedDate;
    const bestTime = expectedTime || aimedTime;

    let aimedEpoch;
    let bestEpoch;
    try {
      aimedEpoch = zonedTimeToEpoch(aimedDate, aimedTime);
      bestEpoch = zonedTimeToEpoch(bestDate, bestTime);
    } catch {
      continue;
    }

    if (bestEpoch < now - 90_000) continue;

    const key = `${line.toLowerCase()}|${bestEpoch}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cancelled = isTrue(d.status?.cancellation?.value);
    const source = String(d.source || '');
    const live =
      Boolean(expectedTime) && /sirivm|siri\s*vm|nextbuses|realtime/i.test(source);

    departures.push({
      line: meta.routes.find((r) => r.toLowerCase() === line.toLowerCase()) || line,
      destination: cleanDestination(d.direction) || 'Unknown destination',
      aimedDate,
      aimedTime,
      expectedDate,
      expectedTime,
      aimedEpoch,
      bestEpoch,
      minutes: Math.max(0, Math.floor((bestEpoch - now) / 60_000)),
      due: bestEpoch - now <= 60_000,
      live,
      cancelled,
      source,
      operator: d.operator || '',
      operatorName: d.operator_name || '',
      occupancy: Array.isArray(d.status?.occupancy?.types)
        ? d.status.occupancy.types.join(', ')
        : '',
    });
  }

  departures.sort((a, b) => a.bestEpoch - b.bestEpoch);

  return {
    stop: {
      atco,
      name: meta.label,
      label: meta.label,
      indicator: meta.indicator,
      hint: meta.hint,
      locality: meta.label,
      bearing: '',
      smscode: '',
      lat: meta.lat,
      lon: meta.lon,
    },
    departures: departures.slice(0, 40),
    fetchedAt: new Date(now).toISOString(),
    requestTime: json.request_time || null,
  };
}

async function fetchTapiBoard(env, atco) {
  const url = new URL(
    `https://transportapi.com/v3/uk/bus/stop_timetables/${encodeURIComponent(atco)}.json`
  );
  url.searchParams.set('app_id', env.TAPI_APP_ID);
  url.searchParams.set('app_key', env.TAPI_APP_KEY);
  url.searchParams.set('live', 'true');
  url.searchParams.set('source_config', 'siri_vm');
  url.searchParams.set('limit', '50');
  url.searchParams.set('from_offset', '-PT00:01:00');
  url.searchParams.set('to_offset', 'PT04:00:00');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`TAPI ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return normalizeTapiBoard(await res.json(), atco);
}

function mapTapiError(err) {
  const status = err?.status ?? null;
  if (status === 401) {
    return {
      status: 401,
      code: 'tapi_unauthorized',
      message: 'TAPI rejected the API key (401).',
    };
  }
  if (status === 403) {
    return {
      status: 403,
      code: 'tapi_forbidden',
      message: 'TAPI returned 403 — the daily quota may be used up.',
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: 'tapi_rate_limited',
      message: 'TAPI rate limit reached (429).',
    };
  }
  return {
    status: 502,
    code: 'tapi_unavailable',
    message: 'TAPI is unavailable right now.',
  };
}

async function tapiMeta(env, atco, extra = {}) {
  const settings = tapiSettings(env);
  const cached = await getTapiCache(env, atco);
  return {
    enabled: settings.enabled,
    dailyLimit: settings.dailyLimit,
    remaining: await getTapiRemaining(env),
    cacheSeconds: settings.cacheSeconds,
    cachedAt: cached?.fetchedAt || null,
    ageSeconds: cached?.ageSeconds ?? null,
    ...extra,
  };
}

async function handleTapi(url, env, atco, cors) {
  const settings = tapiSettings(env);
  if (!settings.enabled) {
    return json(
      {
        error: 'tapi_disabled',
        message: 'TAPI is not configured on this Worker.',
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco, { error: 'tapi_disabled' }),
      },
      503,
      cors
    );
  }

  const force = url.searchParams.get('refresh') === '1';
  const cached = await getTapiCache(env, atco);

  if (!force) {
    if (cached) {
      return json(
        {
          ...cached.data,
          provider: 'TAPI snapshot (cached)',
          providerMode: 'tapi',
          tapi: await tapiMeta(env, atco, { fromCache: true }),
          refreshSeconds: 60,
          serverTime: Date.now(),
        },
        200,
        cors
      );
    }
    return json(
      {
        error: 'tapi_cache_empty',
        message: 'No TAPI snapshot is cached for this stop yet.',
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco, { error: 'tapi_cache_empty' }),
      },
      404,
      cors
    );
  }

  if (
    cached &&
    cached.ageSeconds !== null &&
    cached.ageSeconds < settings.minIntervalSeconds
  ) {
    return json(
      {
        ...cached.data,
        provider: 'TAPI snapshot (cached)',
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco, { fromCache: true, cooldown: true }),
        refreshSeconds: 60,
        serverTime: Date.now(),
      },
      200,
      cors
    );
  }

  const spend = await consumeTapiHit(env);
  if (!spend.ok) {
    const message = `Daily TAPI limit reached (${settings.dailyLimit}/${settings.dailyLimit}).`;
    if (cached) {
      return json(
        {
          ...cached.data,
          provider: 'TAPI snapshot (cached)',
          providerMode: 'tapi',
          tapi: await tapiMeta(env, atco, {
            fromCache: true,
            error: 'tapi_daily_limit',
            message,
          }),
          refreshSeconds: 60,
          serverTime: Date.now(),
        },
        200,
        cors
      );
    }
    return json(
      {
        error: 'tapi_daily_limit',
        message,
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco, { error: 'tapi_daily_limit', message }),
      },
      429,
      cors
    );
  }

  try {
    const data = await fetchTapiBoard(env, atco);
    await setTapiCache(env, atco, data);
    return json(
      {
        ...data,
        provider: 'TAPI snapshot',
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco),
        refreshSeconds: 60,
        serverTime: Date.now(),
      },
      200,
      cors
    );
  } catch (err) {
    const mapped = mapTapiError(err);
    if (cached) {
      return json(
        {
          ...cached.data,
          provider: 'TAPI snapshot (cached)',
          providerMode: 'tapi',
          tapi: await tapiMeta(env, atco, {
            fromCache: true,
            error: mapped.code,
            message: mapped.message,
          }),
          refreshSeconds: 60,
          serverTime: Date.now(),
        },
        200,
        cors
      );
    }
    return json(
      {
        error: mapped.code,
        message: mapped.message,
        providerMode: 'tapi',
        tapi: await tapiMeta(env, atco, {
          error: mapped.code,
          message: mapped.message,
        }),
      },
      mapped.status,
      cors
    );
  }
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const value = origin && allowed.includes(origin) ? origin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': value,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function configPayload(env) {
  const settings = tapiSettings(env);
  return {
    defaultStop: '017000054',
    stops: Object.entries(STOPS).map(([atco, meta]) => ({
      atco,
      label: meta.label,
      indicator: meta.indicator,
      hint: meta.hint,
      routes: meta.routes,
    })),
    routes: ROUTES,
    refreshSeconds: 60,
    primaryProvider: 'bustimes',
    tapi: {
      enabled: settings.enabled,
      dailyLimit: settings.dailyLimit,
      remaining: await getTapiRemaining(env),
      cacheSeconds: settings.cacheSeconds,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    if (url.pathname === '/api/health') {
      return json(
        {
          ok: true,
          provider: 'bustimes',
          stops: Object.keys(STOPS),
          tapiRemaining: await getTapiRemaining(env),
        },
        200,
        cors
      );
    }

    if (url.pathname === '/api/config') {
      return json(await configPayload(env), 200, cors);
    }

    if (url.pathname === '/api/departures') {
      const atco = url.searchParams.get('stop') || '017000054';
      if (!STOPS[atco]) {
        return json({ error: 'unknown_stop', stops: Object.keys(STOPS) }, 400, cors);
      }

      const provider = String(url.searchParams.get('provider') || 'bustimes').toLowerCase();
      if (provider === 'tapi') {
        try {
          return await handleTapi(url, env, atco, cors);
        } catch {
          return json(
            {
              error: 'tapi_unavailable',
              message: 'TAPI endpoint failed.',
            },
            502,
            cors
          );
        }
      }
      if (provider !== 'bustimes') {
        return json({ error: 'unknown_provider' }, 400, cors);
      }

      try {
        const html = await fetchBustimes(atco);
        const board = parseBustimes(html, atco);
        return json(
          {
            ...board,
            provider: 'bustimes.org · BODS (Worker)',
            providerMode: 'bustimes',
            tapi: await tapiMeta(env, atco),
            refreshSeconds: 60,
            horizonHours: 3,
            serverTime: Date.now(),
          },
          200,
          cors
        );
      } catch (err) {
        return json(
          {
            error: 'upstream_unavailable',
            message: err.message || 'bustimes is unavailable',
          },
          err.status === 403 ? 403 : 502,
          cors
        );
      }
    }

    if (url.pathname === '/') {
      return new Response('Bus live feed worker. Try /api/config', {
        status: 200,
        headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return json({ error: 'not_found' }, 404, cors);
  },
};
