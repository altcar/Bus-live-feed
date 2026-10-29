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

function disabledTapi() {
  return {
    enabled: false,
    dailyLimit: 0,
    remaining: null,
    cacheSeconds: 0,
    cachedAt: null,
    ageSeconds: null,
  };
}

function configPayload() {
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
    tapi: disabledTapi(),
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
        { ok: true, provider: 'bustimes', stops: Object.keys(STOPS) },
        200,
        cors
      );
    }

    if (url.pathname === '/api/config') {
      return json(configPayload(), 200, cors);
    }

    if (url.pathname === '/api/departures') {
      const atco = url.searchParams.get('stop') || '017000054';
      if (!STOPS[atco]) {
        return json({ error: 'unknown_stop', stops: Object.keys(STOPS) }, 400, cors);
      }

      const provider = String(url.searchParams.get('provider') || 'bustimes').toLowerCase();
      if (provider === 'tapi') {
        return json(
          {
            error: 'tapi_disabled',
            message: 'TAPI is local-only. Online uses free BODS via the Worker.',
          },
          503,
          cors
        );
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
            tapi: disabledTapi(),
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
