const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  stop: null,
  provider: 'bustimes',
  data: null,
  loading: false,
  failures: 0,
  timer: null,
  lastFetch: 0,
  tapiRemaining: null,
  notice: null,
};

/* ---------- helpers ---------- */

function routeClass(line) {
  return `route--${String(line).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function timeOf(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return clockFmt.format(date);
}

function formatAge(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

async function apiGet(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(body?.message || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = body?.error;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- rendering ---------- */

function setDue(node, dep, now) {
  node.className = 'due';
  node.replaceChildren();

  if (dep.cancelled) {
    node.textContent = 'Cancelled';
    node.classList.add('is-cancelled');
    return;
  }

  const ms = dep.bestEpoch - now;
  if (ms <= 60_000) {
    node.textContent = 'due';
    node.classList.add('is-due');
    return;
  }

  const minutes = Math.floor(ms / 60_000);
  const big = document.createElement('strong');
  const small = document.createElement('small');

  if (minutes < 60) {
    big.textContent = String(minutes);
    small.textContent = 'min';
  } else {
    big.textContent = `${Math.floor(minutes / 60)}h`;
    const rest = minutes % 60;
    small.textContent = rest ? `${rest} min` : '';
  }

  node.append(big);
  if (small.textContent) node.append(small);
  if (minutes <= 2) node.classList.add('is-near');
}

function buildRow(dep) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.best = String(dep.bestEpoch);
  li.dataset.cancelled = dep.cancelled ? '1' : '0';
  if (dep.cancelled) li.classList.add('row--cancelled');

  const route = document.createElement('span');
  route.className = `route ${routeClass(dep.line)}`;
  route.textContent = dep.line;

  const dest = document.createElement('span');
  dest.className = 'dest';

  const name = document.createElement('span');
  name.className = 'dest__name';
  name.textContent = dep.destination || 'Unknown destination';

  const meta = document.createElement('span');
  meta.className = 'dest__meta';
  if (dep.cancelled) {
    meta.textContent = 'cancelled';
  } else if (dep.live) {
    meta.textContent = 'live';
    meta.classList.add('is-live');
  } else {
    meta.textContent = 'timetable';
  }

  dest.append(name, meta);

  const due = document.createElement('span');
  setDue(due, dep, Date.now());

  const sched = document.createElement('span');
  sched.className = 'sched';
  sched.textContent = dep.aimedTime || '—';
  if (dep.live && dep.expectedTime && dep.expectedTime !== dep.aimedTime) {
    const extra = document.createElement('small');
    extra.textContent = `exp ${dep.expectedTime}`;
    sched.append(extra);
  }

  li.append(route, dest, due, sched);
  return li;
}

function renderList(departures) {
  const list = $('list');
  const empty = $('empty');
  list.replaceChildren();

  if (!departures.length) {
    list.hidden = true;
    empty.hidden = false;
    return;
  }

  list.hidden = false;
  empty.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const dep of departures) fragment.append(buildRow(dep));
  list.append(fragment);
}

function showBanner(message, kind = 'warn') {
  const banner = $('banner');
  banner.textContent = message;
  banner.className = `banner banner--${kind}`;
  banner.hidden = false;
}

function hideBanner() {
  $('banner').hidden = true;
}

function showError() {
  $('error').hidden = false;
  $('empty').hidden = true;
  $('list').hidden = true;
}

function hideError() {
  $('error').hidden = true;
}

function renderBanner(data) {
  const mode = data.providerMode || state.provider;
  const tapi = data.tapi || {};

  if (mode === 'tapi') {
    if (tapi.error === 'tapi_daily_limit') {
      showBanner(
        tapi.message || `Daily TAPI limit reached (${tapi.dailyLimit || 28}). Showing the cached snapshot.`,
        'warn'
      );
    } else if (tapi.error) {
      showBanner(
        tapi.message || 'TAPI could not be refreshed — showing the cached snapshot.',
        'warn'
      );
    } else if (tapi.ageSeconds > (tapi.cacheSeconds || 21600)) {
      showBanner(
        `TAPI snapshot from ${timeOf(data.fetchedAt)} is ${formatAge(tapi.ageSeconds)} old. Press TAPI to refresh (1 hit).`,
        'warn'
      );
    } else if (tapi.cooldown) {
      showBanner(`Just fetched — showing the snapshot from ${timeOf(data.fetchedAt)}.`, 'info');
    } else {
      showBanner(
        `TAPI snapshot from ${timeOf(data.fetchedAt)}. Auto-refresh is paused; press TAPI to update (1 hit).`,
        'info'
      );
    }
    return;
  }

  if (state.notice) {
    showBanner(state.notice.text, state.notice.kind);
    state.notice = null;
    return;
  }

  if (data.stale) {
    showBanner(
      `Live feed unavailable — showing the last update from ${timeOf(data.fetchedAt)}.`,
      'warn'
    );
  } else if (data.degraded) {
    showBanner('Live BODS is unavailable — showing a cached TAPI snapshot.', 'warn');
  } else {
    hideBanner();
  }
}

function updateTapi(data) {
  if (Number.isFinite(data?.tapi?.remaining)) {
    state.tapiRemaining = data.tapi.remaining;
  }
  renderProviderButtons();
}

function render(data) {
  const stop = data.stop || {};
  $('stop-name').textContent = stop.label || stop.name || 'Bus stop';

  const details = [stop.indicator, stop.hint].filter(Boolean).join(' · ');
  $('stop-meta').textContent = details
    ? `${details}${stop.atco ? ` · ${stop.atco}` : ''}`
    : stop.atco || '';

  renderList(data.departures || []);
  renderBanner(data);
  updateTapi(data);

  const mode = data.providerMode || state.provider;
  $('provider').textContent = data.provider || 'Live feed';
  $('updated').textContent =
    mode === 'tapi'
      ? `snapshot ${timeOf(data.fetchedAt)}`
      : `updated ${timeOf(data.fetchedAt)}`;

  const interval = data.refreshSeconds || state.config?.refreshSeconds || 60;
  $('note').textContent =
    mode === 'tapi'
      ? 'TAPI snapshot. Page reloads reuse the cache and do not use a hit. Auto-refresh is paused.'
      : `Live BODS data via bustimes.org. Auto-refresh every ${interval}s. TAPI is only called when you press the TAPI button.`;
}

/* ---------- controls ---------- */

function renderProviderButtons() {
  const live = state.provider === 'bustimes';
  const tapiEnabled = Boolean(state.config?.tapi?.enabled);

  $('mode-live').setAttribute('aria-pressed', String(live));
  $('mode-tapi').setAttribute('aria-pressed', String(!live));

  $('mode-live').disabled = state.loading;
  $('mode-tapi').disabled = state.loading || !tapiEnabled;
  $('mode-tapi').title = tapiEnabled
    ? `Fetch a TAPI snapshot. Uses 1 of ${state.config?.tapi?.dailyLimit || 28} local daily hits; page reloads reuse the cache.`
    : 'TAPI credentials are not configured';

  $('tapi-left').textContent = !tapiEnabled
    ? 'off'
    : state.tapiRemaining == null
      ? '—'
      : `${state.tapiRemaining} left`;
}

function setProvider(mode) {
  state.provider = mode;
  clearTimeout(state.timer);
  try {
    localStorage.setItem('hsb.provider', mode);
  } catch {
    /* storage disabled */
  }
  renderProviderButtons();
}

function renderSwitcher() {
  const nav = $('stop-switch');
  nav.replaceChildren();

  const stops = state.config?.stops || [];
  if (stops.length < 2) {
    nav.hidden = true;
    return;
  }

  for (const stop of stops) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.dataset.atco = stop.atco;
    button.setAttribute('aria-pressed', String(stop.atco === state.stop));
    button.textContent = `${stop.label} · ${stop.indicator || 'stop'}`;
    button.title = stop.hint || '';
    button.addEventListener('click', () => selectStop(stop.atco));
    nav.append(button);
  }

  nav.hidden = false;
}

function selectStop(atco) {
  if (!atco || atco === state.stop) return;
  state.stop = atco;
  state.data = null;
  state.failures = 0;
  try {
    localStorage.setItem('hsb.stop', atco);
  } catch {
    /* storage disabled */
  }
  renderSwitcher();
  $('list').replaceChildren();
  hideBanner();
  hideError();
  load({
    provider: state.provider,
    force: state.provider === 'bustimes',
  });
}

/* ---------- loading ---------- */

function schedule() {
  clearTimeout(state.timer);
  if (!state.stop || state.provider !== 'bustimes') return;

  const base = (state.config?.refreshSeconds || 60) * 1000;
  const delay = state.failures
    ? Math.min(60_000, 5_000 * 2 ** Math.min(state.failures, 4))
    : base;

  state.timer = setTimeout(() => {
    if (document.hidden) {
      schedule();
      return;
    }
    load();
  }, delay);
}

function setLoading(loading) {
  state.loading = loading;
  renderProviderButtons();
}

function handleTapiFailure(err) {
  const messages = {
    tapi_cache_empty:
      'No TAPI snapshot is cached for this stop. Showing Live BODS — press TAPI to fetch one (1 hit).',
    tapi_daily_limit:
      err.body?.message || 'Daily TAPI limit reached. Showing Live BODS.',
    tapi_forbidden:
      'TAPI returned 403 — the daily quota may be used up. Showing Live BODS.',
    tapi_unauthorized: 'TAPI rejected the API key. Showing Live BODS.',
    tapi_rate_limited: 'TAPI is rate limited. Showing Live BODS.',
  };

  state.notice = {
    text: messages[err.code] || err.message || 'TAPI unavailable — showing Live BODS.',
    kind: 'warn',
  };
  setProvider('bustimes');

  // Let the current finally block finish before loading the primary feed.
  setTimeout(() => load({ provider: 'bustimes' }), 0);
}

async function load({ force = false, provider = state.provider } = {}) {
  if (state.loading || !state.stop) return;

  setLoading(true);
  clearTimeout(state.timer);

  try {
    const params = new URLSearchParams({ stop: state.stop, provider });
    if (force) params.set('refresh', '1');

    const data = await apiGet(`/api/departures?${params}`);
    state.data = data;
    state.provider = data.providerMode || provider;
    state.failures = 0;
    state.lastFetch = Date.now();
    hideError();
    render(data);
  } catch (err) {
    state.failures += 1;

    if (provider === 'tapi') {
      handleTapiFailure(err);
      return;
    }

    if (state.data) {
      showBanner(
        `Connection problem — showing the last update from ${timeOf(state.data.fetchedAt)}.`,
        'error'
      );
    } else {
      showError();
    }
  } finally {
    setLoading(false);
    if (state.provider === 'bustimes') schedule();
  }
}

/* ---------- clock and countdowns ---------- */

function tickClock() {
  const now = new Date();
  $('clock-time').textContent = clockFmt.format(now);
  $('clock-date').textContent = dateFmt.format(now);
}

function tickCountdowns() {
  const now = Date.now();
  for (const row of document.querySelectorAll('.row[data-best]')) {
    const due = row.querySelector('.due');
    if (!due) continue;
    setDue(
      due,
      {
        bestEpoch: Number(row.dataset.best),
        cancelled: row.dataset.cancelled === '1',
      },
      now
    );
  }
}

/* ---------- boot ---------- */

async function boot() {
  try {
    state.config = await apiGet('/api/config');
  } catch {
    state.config = {
      stops: [],
      routes: [],
      refreshSeconds: 60,
      primaryProvider: 'bustimes',
      tapi: { enabled: false, dailyLimit: 28, cacheSeconds: 21600, remaining: null },
    };
  }

  state.tapiRemaining = state.config?.tapi?.remaining ?? null;

  let savedProvider = null;
  let saved = null;
  try {
    savedProvider = localStorage.getItem('hsb.provider');
    saved = localStorage.getItem('hsb.stop');
  } catch {
    /* storage disabled */
  }

  state.provider =
    savedProvider === 'tapi' || savedProvider === 'bustimes'
      ? savedProvider
      : state.config.primaryProvider || 'bustimes';
  if (state.provider === 'tapi' && !state.config?.tapi?.enabled) {
    state.provider = 'bustimes';
  }

  const stops = state.config.stops || [];
  if (stops.some((s) => s.atco === saved)) {
    state.stop = saved;
  } else {
    state.stop = state.config.defaultStop || stops[0]?.atco || null;
  }

  renderSwitcher();
  renderProviderButtons();

  $('retry').addEventListener('click', () => {
    if (!state.stop) {
      window.location.reload();
      return;
    }
    hideError();
    load({
      provider: state.provider,
      force: state.provider === 'bustimes',
    });
  });

  $('mode-live').addEventListener('click', () => {
    if (state.loading) return;
    setProvider('bustimes');
    load({ provider: 'bustimes', force: true });
  });

  $('mode-tapi').addEventListener('click', () => {
    if (state.loading || !state.config?.tapi?.enabled) return;
    setProvider('tapi');
    load({ provider: 'tapi', force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || state.provider !== 'bustimes') return;
    const staleAfter = (state.config.refreshSeconds || 60) * 1000;
    if (Date.now() - state.lastFetch > staleAfter) load();
  });

  tickClock();
  setInterval(tickClock, 1000);
  setInterval(tickCountdowns, 1000);

  if (state.stop) {
    load({ provider: state.provider, force: false });
  } else {
    showError();
  }
}

boot();
