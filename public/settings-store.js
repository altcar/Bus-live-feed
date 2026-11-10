const DB_NAME = 'bus-live-feed';
const STORE_NAME = 'settings';
const SETTINGS_KEY = 'ui';

let writeQueue = Promise.resolve();

export const DEFAULT_SETTINGS = {
  // Stop loaded when there is no remembered selection.
  defaultStop: '017000054',
  // Last stop viewed in this browser.
  stop: '',
  provider: 'bustimes',
  autoRefresh: true,
  // 'both' | 'aimed' | 'expected' — what the Timetable column shows.
  schedMode: 'both',
  swapColumns: false,
  customStops: [],
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isValidStop(stop) {
  return Boolean(
    stop &&
      typeof stop === 'object' &&
      /^[0-9A-Za-z]{6,20}$/.test(String(stop.atco || ''))
  );
}

function normalize(settings) {
  const customStops = Array.isArray(settings.customStops)
    ? settings.customStops
        .filter(isValidStop)
        .map((stop) => ({
          atco: String(stop.atco),
          label: String(stop.label || ''),
          indicator: String(stop.indicator || ''),
          hint: String(stop.hint || ''),
          routes: Array.isArray(stop.routes)
            ? stop.routes.map((route) => String(route).trim()).filter(Boolean)
            : [],
        }))
    : [];

  return {
    defaultStop: typeof settings.defaultStop === 'string' ? settings.defaultStop : DEFAULT_SETTINGS.defaultStop,
    stop: typeof settings.stop === 'string' ? settings.stop : '',
    provider: settings.provider === 'tapi' ? 'tapi' : 'bustimes',
    autoRefresh: settings.autoRefresh !== false,
    schedMode: ['aimed', 'expected', 'both'].includes(settings.schedMode)
      ? settings.schedMode
      : 'both',
    swapColumns: Boolean(settings.swapColumns),
    customStops,
  };
}

export async function loadSettings() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(SETTINGS_KEY);
    const stored = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return normalize({ ...DEFAULT_SETTINGS, ...(stored || {}) });
  } catch {
    return normalize({ ...DEFAULT_SETTINGS });
  }
}

export async function saveSettings(patch) {
  // Serialize read-modify-write cycles so quick successive changes cannot
  // clobber each other.
  const run = async () => {
    const current = await loadSettings();
    const next = normalize({ ...current, ...patch });

    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(next, SETTINGS_KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return next;
  };

  const result = writeQueue.then(run, run);
  writeQueue = result.catch(() => {});
  return result;
}

export async function resetSettings() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(SETTINGS_KEY);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return normalize({ ...DEFAULT_SETTINGS });
}
