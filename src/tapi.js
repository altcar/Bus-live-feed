import { config } from './config.js';
import { londonDate, zonedTimeToEpoch } from './time.js';

export class UpstreamError extends Error {
  constructor(message, status = null, detail = '') {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.detail = detail;
  }
}

function redact(text) {
  return String(text || '')
    .replace(/(app_key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(app_id=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 240);
}

function isTrue(value) {
  return value === true || value === 'true' || value === 1;
}

function routeName(line, routes) {
  return routes.find((r) => r.toLowerCase() === line.toLowerCase()) || line;
}

function cleanDestination(value) {
  return String(value || '')
    .replace(/,\s*The Centre\s*$/i, '')
    .trim();
}

/**
 * Normalise a TAPI bus/stop_timetables response into the small shape the
 * browser needs. Exported for tests.
 */
export function normalizeTapiBoard(
  json,
  atco,
  { now = Date.now(), routes = config.routes } = {}
) {
  const stop = {
    atco: json.atcocode || atco,
    name: json.name || json.stop_name || '',
    indicator: json.indicator || '',
    locality: json.locality || '',
    bearing: json.bearing || '',
    smscode: json.smscode || '',
    lat: json.location?.latitude ?? null,
    lon: json.location?.longitude ?? null,
  };

  const raw = Object.values(json.departures || {}).flat();
  const seen = new Set();
  const departures = [];

  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;

    const line = String(d.line || d.line_name || '').trim();
    if (!routes.some((r) => r.toLowerCase() === line.toLowerCase())) continue;

    const destination = String(d.direction || '').trim();

    const aimedDate = d.aimed?.departure?.date || d.date;
    const aimedTime = d.aimed_departure_time || d.aimed?.departure?.time;
    if (!aimedDate || !aimedTime) continue;

    const expectedTime = d.expected_departure_time || d.expected?.departure?.time || null;
    const expectedDate =
      d.expected_departure_date || d.expected?.departure?.date || aimedDate || null;

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

    // Ignore departures that have already gone (small grace for clock skew).
    if (bestEpoch < now - 90_000) continue;

    const dedupeKey = `${line.toLowerCase()}|${bestEpoch}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const cancelled = isTrue(d.status?.cancellation?.value);
    const source = String(d.source || '');
    const live = Boolean(expectedTime) && /sirivm|siri\s*vm|nextbuses|realtime/i.test(source);

    departures.push({
      line: routeName(line, routes),
      destination: cleanDestination(destination) || 'Unknown destination',
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
    stop,
    departures: departures.slice(0, 40),
    fetchedAt: new Date(now).toISOString(),
    requestTime: json.request_time || null,
  };
}

export async function fetchTapiBoard(
  atco,
  { fetchImpl = fetch, now = Date.now(), routes = config.routes } = {}
) {
  if (!config.tapi.enabled) throw new UpstreamError('TAPI credentials are not configured');

  const url = new URL(
    `/v3/uk/bus/stop_timetables/${encodeURIComponent(atco)}.json`,
    config.tapi.baseUrl
  );
  url.searchParams.set('app_id', config.tapi.appId);
  url.searchParams.set('app_key', config.tapi.appKey);
  url.searchParams.set('live', 'true');
  url.searchParams.set('source_config', 'siri_vm');
  url.searchParams.set('limit', String(config.limit));
  url.searchParams.set('from_offset', '-PT00:01:00');
  url.searchParams.set('to_offset', `PT0${config.horizonHours}:00:00`);

  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    throw new UpstreamError(`TAPI request failed: ${err.name || 'network error'}`);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new UpstreamError(`TAPI ${res.status}`, res.status, redact(body));
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new UpstreamError('TAPI returned invalid JSON', res.status);
  }

  return normalizeTapiBoard(json, atco, { now, routes });
}

export function normalizeSituations(json) {
  const members = Array.isArray(json?.member) ? json.member : [];
  const items = members
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const consequences = Array.isArray(s.consequences) ? s.consequences : [];
      const first = consequences[0] || null;
      const validity = Array.isArray(s.validity_period) ? s.validity_period : [];
      const summary = String(s.summary || '').trim();
      if (!summary) return null;

      return {
        summary,
        description: String(s.description || '').trim(),
        advice: String(first?.advice?.details || '').trim(),
        severity: String(first?.severity || 'unknown'),
        planned: isTrue(s.planned),
        validity: validity
          .map((v) => ({ start: v?.start_time || null, end: v?.end_time || null }))
          .slice(0, 3),
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  return { available: true, items };
}

export async function fetchSituations(atco, { fetchImpl = fetch } = {}) {
  if (!config.tapi.enabled) return { available: false, items: [], reason: 'disabled' };

  const url = new URL('/v3/uk/bus/situations.json', config.tapi.baseUrl);
  url.searchParams.set('app_id', config.tapi.appId);
  url.searchParams.set('app_key', config.tapi.appKey);
  url.searchParams.set('atcocodes', atco);
  url.searchParams.set('date', londonDate(new Date()));
  url.searchParams.set('limit', '20');

  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { available: false, items: [], reason: 'network' };
  }

  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
    return {
      available: false,
      items: [],
      reason: res.status === 403 ? 'subscription_required' : `http_${res.status}`,
    };
  }
  if (!res.ok) {
    return { available: false, items: [], reason: `http_${res.status}` };
  }

  const body = await res.text();
  try {
    return normalizeSituations(JSON.parse(body));
  } catch {
    return { available: false, items: [], reason: 'invalid_json' };
  }
}
