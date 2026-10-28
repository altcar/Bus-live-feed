const TZ = 'Europe/London';

const formatter = new Intl.DateTimeFormat('en-GB', {
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

/** Wall-clock parts of an instant in Europe/London. */
export function londonParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function londonDate(input = new Date()) {
  const p = londonParts(input);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function londonClock(input = new Date()) {
  const p = londonParts(input);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Convert a Europe/London wall-clock date + time into an epoch in ms.
 * Handles BST/GMT by iterating the timezone offset to a stable answer.
 */
export function zonedTimeToEpoch(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr || ''));
  if (!dm || !tm) throw new Error(`Invalid London date/time: ${dateStr} ${timeStr}`);

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

export function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Format an epoch as a London HH:MM clock time. */
export function formatLondonTime(epoch) {
  return londonClock(new Date(epoch));
}
