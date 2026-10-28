import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, formatLondonTime, londonDate, zonedTimeToEpoch } from '../src/time.js';

test('converts London wall time during BST', () => {
  assert.equal(
    new Date(zonedTimeToEpoch('2026-07-01', '12:00')).toISOString(),
    '2026-07-01T11:00:00.000Z'
  );
});

test('converts London wall time during GMT', () => {
  assert.equal(
    new Date(zonedTimeToEpoch('2026-01-15', '12:00')).toISOString(),
    '2026-01-15T12:00:00.000Z'
  );
});

test('handles after-midnight departures', () => {
  assert.equal(
    new Date(zonedTimeToEpoch('2026-10-22', '00:10')).toISOString(),
    '2026-10-21T23:10:00.000Z'
  );
});

test('handles the October DST change', () => {
  assert.equal(
    new Date(zonedTimeToEpoch('2026-10-25', '00:30')).toISOString(),
    '2026-10-24T23:30:00.000Z'
  );
  assert.equal(
    new Date(zonedTimeToEpoch('2026-10-25', '03:30')).toISOString(),
    '2026-10-25T03:30:00.000Z'
  );
});

test('addDays and londonDate are stable', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(londonDate(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
});

test('formats a London clock time', () => {
  assert.equal(formatLondonTime(Date.parse('2026-07-01T11:00:00Z')), '12:00');
  assert.equal(formatLondonTime(Date.parse('2026-01-15T12:00:00Z')), '12:00');
});
