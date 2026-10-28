import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'hsb-store-'));
process.env.HARRY_STOKE_STATE_DIR = dir;

const { consumeTapiHit, getTapiCache, getTapiRemaining, setTapiCache } = await import(
  '../src/store.js'
);

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('daily TAPI budget stops at the limit and resets the next day', () => {
  const date = '2026-10-22';
  assert.equal(getTapiRemaining(2, date), 2);

  assert.equal(consumeTapiHit(2, date).ok, true);
  assert.equal(consumeTapiHit(2, date).ok, true);

  const blocked = consumeTapiHit(2, date);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(getTapiRemaining(2, date), 0);
  assert.equal(getTapiRemaining(2, '2026-10-23'), 2);
});

test('TAPI snapshots persist and report their age', () => {
  const fetchedAt = new Date(Date.now() - 90_000).toISOString();
  setTapiCache('017000054', { stop: { atco: '017000054' }, departures: [] }, fetchedAt);

  const cached = getTapiCache('017000054');
  assert.equal(cached.fetchedAt, fetchedAt);
  assert.equal(cached.data.stop.atco, '017000054');
  assert.ok(cached.ageSeconds >= 90);
});

test('missing snapshots return null', () => {
  assert.equal(getTapiCache('000000000'), null);
});
