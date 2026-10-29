import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, routesForStop, STOP_META } from '../src/config.js';
import { fetchBustimesBoard } from '../src/bustimes.js';
import { fetchTapiBoard } from '../src/tapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// GitHub-hosted runners are blocked by bustimes, so CI uses TAPI when its
// credentials are present. Local builds without credentials fall back to BODS.
const useTapi = config.tapi.enabled;
const fetchBoard = useTapi ? fetchTapiBoard : fetchBustimesBoard;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

console.log(`[build] Source: ${useTapi ? 'TAPI SIRI-VM' : 'bustimes/BODS'}`);

const stops = await Promise.all(
  config.stops.map(async (atco) => {
    const meta = STOP_META[atco] || {};
    const routes = routesForStop(atco);

    try {
      const board = await fetchBoard(atco, { routes });
      console.log(`[build] ${atco} ${meta.label || ''}: ${board.departures.length} departures`);
      return {
        atco,
        label: meta.label || board.stop?.name || atco,
        indicator: meta.indicator || board.stop?.indicator || '',
        hint: meta.hint || '',
        routes,
        departures: board.departures,
        fetchedAt: board.fetchedAt,
        error: null,
      };
    } catch (err) {
      console.error(`[build] ${atco} failed: ${err.message}`);
      return {
        atco,
        label: meta.label || atco,
        indicator: meta.indicator || '',
        hint: meta.hint || '',
        routes,
        departures: [],
        fetchedAt: null,
        error: 'fetch_failed',
      };
    }
  })
);

if (stops.every((stop) => stop.error)) {
  throw new Error('All stop snapshots failed; refusing to publish an empty board');
}

const data = {
  generatedAt: new Date().toISOString(),
  defaultStop: config.stops[0],
  refreshSeconds: 300,
  actionIntervalMinutes: useTapi ? 180 : 15,
  provider: useTapi
    ? 'GitHub Pages · TAPI SIRI-VM snapshot'
    : 'GitHub Pages · static BODS snapshot',
  stops,
};

fs.writeFileSync(path.join(dist, 'data.json'), `${JSON.stringify(data, null, 2)}\n`);
fs.copyFileSync(path.join(root, 'public', 'styles.css'), path.join(dist, 'styles.css'));
fs.copyFileSync(path.join(root, 'public', 'app.js'), path.join(dist, 'app.js'));

let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
html = html
  .replace('<html lang="en-GB">', '<html lang="en-GB" data-mode="static">')
  .replace(/href="\/styles\.css\?v=[^"]*"/, 'href="./styles.css"')
  .replace(/src="\/app\.js\?v=[^"]*"/, 'src="./app.js"');

if (!html.includes('data-mode="static"') || html.includes('/app.js?v=')) {
  throw new Error('Static HTML rewrite failed');
}

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`[build] Wrote ${path.relative(root, dist)} with ${stops.length} stops`);
