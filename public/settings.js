import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings-store.js';

const $ = (id) => document.getElementById(id);
const saveState = $('save-state');

let settings = await loadSettings();
let config = null;

function flash(message) {
  saveState.textContent = message;
  window.setTimeout(() => {
    if (saveState.textContent === message) saveState.textContent = '';
  }, 2200);
}

async function fetchConfig() {
  try {
    const response = await fetch('./api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return { stops: [] };
  }
}

function configuredStops() {
  return (config?.stops || []).map((stop) => ({ ...stop, custom: false }));
}

function customStops() {
  return settings.customStops.map((stop) => ({
    atco: stop.atco,
    label: stop.label || stop.atco,
    indicator: stop.indicator || '',
    hint: stop.hint || '',
    routes: stop.routes || [],
    custom: true,
  }));
}

function allStops() {
  return [...configuredStops(), ...customStops()];
}

function stopLabel(stop) {
  return `${stop.label || stop.atco}${stop.indicator ? ` · ${stop.indicator}` : ''}`;
}

function renderDefaultStop() {
  const select = $('default-stop');
  const stops = allStops();
  select.replaceChildren();

  if (!stops.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No stops available';
    select.append(option);
    $('remember-note').textContent = '';
    return;
  }

  for (const stop of stops) {
    const option = document.createElement('option');
    option.value = stop.atco;
    option.textContent = stopLabel(stop);
    select.append(option);
  }

  if (!stops.some((stop) => stop.atco === settings.defaultStop)) {
    settings.defaultStop = stops[0].atco;
  }
  select.value = settings.defaultStop;

  const remembered = stops.find((stop) => stop.atco === settings.stop);
  $('remember-note').textContent = remembered
    ? `This browser is remembering ${stopLabel(remembered)}.`
    : 'This browser is not remembering a stop.';
}

function renderCustomStops() {
  const list = $('custom-stops');
  list.replaceChildren();

  for (const stop of settings.customStops) {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.textContent = `${stop.label || stop.atco} · ${stop.atco}`;
    if (stop.routes?.length) name.textContent += ` · ${stop.routes.join(', ')}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeStop(stop.atco));

    item.append(name, remove);
    list.append(item);
  }
}

function renderForm() {
  $('auto-refresh').checked = settings.autoRefresh;
  $('swap-columns').checked = settings.swapColumns;
  $('sched-mode').value = settings.schedMode;
}

function render() {
  renderDefaultStop();
  renderCustomStops();
  renderForm();
}

async function addStop(event) {
  event.preventDefault();
  const atco = $('stop-atco').value.trim();
  const label = $('stop-label').value.trim();
  const routes = $('stop-routes').value
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);

  if (!/^[0-9A-Za-z]{6,20}$/.test(atco)) {
    flash('Enter a valid ATCO code (6–20 letters or numbers).');
    return;
  }
  if (allStops().some((stop) => stop.atco === atco)) {
    flash('That stop is already in the list.');
    return;
  }

  settings = await saveSettings({
    customStops: [...settings.customStops, { atco, label, indicator: '', hint: '', routes }],
  });
  $('stop-atco').value = '';
  $('stop-label').value = '';
  $('stop-routes').value = '';
  render();
  flash('Stop added.');
}

async function removeStop(atco) {
  const patch = {
    customStops: settings.customStops.filter((stop) => stop.atco !== atco),
  };
  if (settings.defaultStop === atco) patch.defaultStop = DEFAULT_SETTINGS.defaultStop;
  if (settings.stop === atco) patch.stop = '';
  settings = await saveSettings(patch);
  render();
  flash('Stop removed.');
}

$('default-stop').addEventListener('change', async (event) => {
  settings = await saveSettings({ defaultStop: event.target.value });
  renderDefaultStop();
  flash('Saved.');
});

$('auto-refresh').addEventListener('change', async (event) => {
  settings = await saveSettings({ autoRefresh: event.target.checked });
  flash('Saved.');
});

$('swap-columns').addEventListener('change', async (event) => {
  settings = await saveSettings({ swapColumns: event.target.checked });
  flash('Saved.');
});

$('sched-mode').addEventListener('change', async (event) => {
  settings = await saveSettings({ schedMode: event.target.value });
  flash('Saved.');
});

$('add-stop').addEventListener('submit', addStop);

config = await fetchConfig();
render();
