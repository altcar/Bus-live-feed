import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSituations, normalizeTapiBoard } from '../src/tapi.js';

function departure(overrides) {
  return {
    date: '2026-10-22',
    source: 'tnds',
    status: { cancellation: { value: false }, occupancy: { types: [] } },
    ...overrides,
  };
}

const json = {
  atcocode: '017000054',
  name: 'Harry Stoke',
  indicator: 'S-bound',
  departures: {
    all: [
      departure({
        line: 'm1',
        direction: 'Hengrove Park',
        aimed_departure_time: '13:05',
        expected_departure_date: '2026-10-22',
        expected_departure_time: '13:07',
        source: 'tnds, SiriVM',
      }),
      departure({
        line: 'm4',
        direction: 'Bristol City Centre',
        aimed_departure_time: '13:10',
      }),
      departure({
        line: 'm3',
        direction: 'Emersons Green',
        aimed_departure_time: '13:12',
      }),
      departure({
        line: '19',
        direction: 'Bath City Centre',
        aimed_departure_time: '13:14',
      }),
      departure({
        line: 'm1',
        direction: 'Hengrove Park',
        aimed_departure_time: '13:05',
        expected_departure_date: '2026-10-22',
        expected_departure_time: '13:07',
        source: 'tnds, SiriVM',
      }),
      departure({
        line: 'T1',
        direction: 'Bristol City Centre',
        aimed_departure_time: '12:00',
      }),
    ],
  },
};

const NOW = Date.parse('2026-10-22T12:00:00Z'); // 13:00 in London (BST)

test('applies the Harry Stoke S-bound route filter and drops past buses', () => {
  const board = normalizeTapiBoard(json, '017000054', {
    now: NOW,
    routes: ['m1', 'm4', 'T1'],
  });

  assert.equal(board.stop.name, 'Harry Stoke');
  assert.deepEqual(
    board.departures.map((d) => d.line),
    ['m1', 'm4']
  );
});

test('includes m3 only when the stop allows it', () => {
  const board = normalizeTapiBoard(json, '0100BRP90372', {
    now: NOW,
    routes: ['m1', 'm4', 'T1', 'm3'],
  });

  assert.deepEqual(
    board.departures.map((d) => d.line),
    ['m1', 'm4', 'm3']
  );

  const m3 = board.departures.find((d) => d.line === 'm3');
  assert.equal(m3.destination, 'Emersons Green');
  assert.equal(m3.minutes, 12);
});

test('marks SiriVM predictions live and computes minutes', () => {
  const board = normalizeTapiBoard(json, '017000054', {
    now: NOW,
    routes: ['m1', 'm4', 'T1'],
  });

  const [m1, m4] = board.departures;
  assert.equal(m1.live, true);
  assert.equal(m1.expectedTime, '13:07');
  assert.equal(m1.minutes, 7);

  assert.equal(m4.live, false);
  assert.equal(m4.minutes, 10);
});

test('de-duplicates identical live predictions', () => {
  const board = normalizeTapiBoard(json, '017000054', {
    now: NOW,
    routes: ['m1', 'm4', 'T1'],
  });

  const m1s = board.departures.filter((d) => d.line === 'm1');
  assert.equal(m1s.length, 1);
});

test('normalises SIRI-SX situations', () => {
  const result = normalizeSituations({
    member: [
      {
        summary: 'Great Stoke Way closed',
        description: 'Roadworks',
        planned: true,
        validity_period: [{ start_time: '2026-10-22T00:00:00Z' }],
        consequences: [{ severity: 'severe', advice: { details: 'Use m1 instead' } }],
      },
    ],
  });

  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].severity, 'severe');
  assert.equal(result.items[0].advice, 'Use m1 instead');
});
