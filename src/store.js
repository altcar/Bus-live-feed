import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { londonDate } from './time.js';

const APP_DIR = 'harry-stoke-board';

/**
 * State lives outside the project so it does not sync to OneDrive.
 * Override with HARRY_STOKE_STATE_DIR (used by tests).
 */
export function statePaths() {
  const base =
    process.env.HARRY_STOKE_STATE_DIR ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), APP_DIR);
  return {
    base,
    cacheFile: path.join(base, 'tapi-cache.json'),
    usageFile: path.join(base, 'tapi-usage.json'),
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Return the cached TAPI snapshot for a stop, or null. */
export function getTapiCache(atco) {
  const { cacheFile } = statePaths();
  const all = readJson(cacheFile, { stops: {} });
  const entry = all?.stops?.[atco];
  if (!entry?.data || !entry.fetchedAt) return null;

  const fetchedMs = Date.parse(entry.fetchedAt);
  const ageSeconds = Number.isFinite(fetchedMs)
    ? Math.max(0, Math.floor((Date.now() - fetchedMs) / 1000))
    : null;

  return { data: entry.data, fetchedAt: entry.fetchedAt, ageSeconds };
}

/** Persist a TAPI snapshot. This is what makes page reloads free. */
export function setTapiCache(atco, data, fetchedAt = new Date().toISOString()) {
  const { cacheFile } = statePaths();
  const all = readJson(cacheFile, { stops: {} });
  const stops = all?.stops && typeof all.stops === 'object' ? all.stops : {};
  stops[atco] = { data, fetchedAt };
  writeJson(cacheFile, { version: 1, stops });
}

export function getTapiUsage(date = londonDate()) {
  const { usageFile } = statePaths();
  const usage = readJson(usageFile, { date, count: 0 });
  if (usage?.date !== date) return { date, count: 0 };
  return { date, count: Math.max(0, Number(usage.count) || 0) };
}

export function getTapiRemaining(limit, date = londonDate()) {
  const usage = getTapiUsage(date);
  return Math.max(0, limit - usage.count);
}

/**
 * Claim one TAPI request from today's budget. Call this immediately before an
 * upstream request; failed requests still count, because TAPI counts attempts.
 */
export function consumeTapiHit(limit, date = londonDate()) {
  const usage = getTapiUsage(date);
  if (usage.count >= limit) {
    return { ok: false, date, count: usage.count, remaining: 0 };
  }

  const next = { date, count: usage.count + 1 };
  writeJson(statePaths().usageFile, next);
  return { ok: true, date, count: next.count, remaining: Math.max(0, limit - next.count) };
}
