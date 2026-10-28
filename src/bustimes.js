import * as cheerio from 'cheerio';
import { config, STOP_META } from './config.js';
import { addDays, londonDate, zonedTimeToEpoch } from './time.js';

const DAY = 24 * 60 * 60 * 1000;

function firstTime(text) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(text || ''));
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
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
 * Keyless fallback: bustimes.org renders departure rows server-side from BODS
 * (including SIRI-VM expected times). Parsing HTML is fragile, so this is only
 * used when TAPI fails and is labelled as a fallback in the UI.
 */
export async function fetchBustimesBoard(
  atco,
  { fetchImpl = fetch, now = Date.now(), routes = config.routes } = {}
) {
  let res;
  try {
    res = await fetchImpl(`https://bustimes.org/stops/${encodeURIComponent(atco)}`, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'harry-stoke-board/1.0 (personal local departure display)',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`bustimes request failed: ${err.name || 'network error'}`);
  }

  if (!res.ok) throw new Error(`bustimes HTTP ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const headingMatch = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(heading);
  const meta = STOP_META[atco] || {};
  const indicator = headingMatch?.[2] || meta.indicator || '';
  const name = headingMatch?.[1] || heading || meta.label || atco;

  const today = londonDate(new Date(now));
  const seen = new Set();
  const departures = [];

  $('table tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 3) return;

    const line = cells.eq(0).text().replace(/\s+/g, ' ').trim();
    if (!line) return;
    if (!routes.some((r) => r.toLowerCase() === line.toLowerCase())) return;

    const destCell = cells.eq(1).clone();
    destCell.find('.vehicle').remove();
    const destination = destCell.text().replace(/\s+/g, ' ').trim();

    const aimedTime = firstTime(cells.eq(2).text());
    const expectedTime = firstTime(cells.eq(3).text());
    if (!aimedTime) return;

    let aimedEpoch = zonedTimeToEpoch(today, aimedTime);
    // The board is near midnight: a row shown as 00:10 is tomorrow's service.
    if (aimedEpoch < now - 6 * 60 * 60 * 1000) {
      aimedEpoch = zonedTimeToEpoch(addDays(today, 1), aimedTime);
    }

    let expectedEpoch = null;
    if (expectedTime) {
      const dateForExpected =
        aimedEpoch > now + DAY / 2 ? addDays(today, 1) : today;
      expectedEpoch = zonedTimeToEpoch(dateForExpected, expectedTime);
      if (expectedEpoch < aimedEpoch - 6 * 60 * 60 * 1000) expectedEpoch += DAY;
    }

    const bestEpoch = expectedEpoch ?? aimedEpoch;
    if (bestEpoch < now - 90_000) return;

    const dedupeKey = `${line.toLowerCase()}|${bestEpoch}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    departures.push({
      line: routeName(line, routes),
      destination: cleanDestination(destination) || 'Unknown destination',
      aimedDate: today,
      aimedTime,
      expectedDate: expectedTime ? londonDate(new Date(bestEpoch)) : null,
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
  });

  if (!departures.length && heading === '') {
    throw new Error('bustimes page could not be parsed');
  }

  departures.sort((a, b) => a.bestEpoch - b.bestEpoch);

  return {
    stop: {
      atco,
      name,
      indicator,
      locality: meta.label || '',
      bearing: '',
      smscode: '',
      lat: meta.lat ?? null,
      lon: meta.lon ?? null,
    },
    departures: departures.slice(0, 40),
    fetchedAt: new Date(now).toISOString(),
    requestTime: null,
  };
}
