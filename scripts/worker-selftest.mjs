import worker from '../worker/src/index.js';

const env = { ALLOWED_ORIGINS: 'https://altcar.github.io' };
const stops = ['017000054', '017000053', '0100BRP90372'];

for (const stop of stops) {
  const request = new Request(
    `https://worker.local/api/departures?stop=${encodeURIComponent(stop)}`,
    { headers: { Origin: 'https://altcar.github.io' } }
  );
  const response = await worker.fetch(request, env);
  const body = await response.json();
  const lines = [...new Set((body.departures || []).map((d) => d.line))];
  console.log(
    stop,
    response.status,
    `ACAO=${response.headers.get('access-control-allow-origin')}`,
    body.provider,
    `deps=${body.departures?.length || 0}`,
    `lines=${lines.join(',')}`
  );
  const first = body.departures?.[0];
  if (first) {
    console.log(
      '  ',
      first.line,
      first.destination,
      first.aimedTime,
      first.expectedTime,
      `${first.minutes}min`
    );
  }
}

const configResponse = await worker.fetch(
  new Request('https://worker.local/api/config', {
    headers: { Origin: 'https://altcar.github.io' },
  }),
  env
);
const config = await configResponse.json();
console.log('config', configResponse.status, config.stops.map((s) => s.atco).join(','));
