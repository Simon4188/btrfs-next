import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RRule, parseRRule, nextOccurrences, prevOccurrences } from '../src/index.js';

const utc = (y, mo, d, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, s));

test('parseRRule rejects empty input', () => {
  assert.throws(() => parseRRule(''), /non-empty/);
  assert.throws(() => parseRRule(null), /non-empty/);
});

test('parseRRule rejects unsupported frequencies', () => {
  assert.throws(() => parseRRule('FREQ=MONTHLY'), /DAILY.*WEEKLY/);
  assert.throws(() => parseRRule('FREQ=YEARLY'), /DAILY.*WEEKLY/);
});

test('parseRRule rejects BYDAY with DAILY', () => {
  assert.throws(() => parseRRule('FREQ=DAILY;BYDAY=MO'), /BYDAY.*WEEKLY/);
});

test('parseRRule rejects invalid INTERVAL', () => {
  assert.throws(() => parseRRule('FREQ=DAILY;INTERVAL=0'), /INTERVAL/);
  assert.throws(() => parseRRule('FREQ=DAILY;INTERVAL=-1'), /INTERVAL/);
  assert.throws(() => parseRRule('FREQ=DAILY;INTERVAL=abc'), /INTERVAL/);
});

test('parseRRule rejects invalid COUNT', () => {
  assert.throws(() => parseRRule('FREQ=DAILY;COUNT=0'), /COUNT/);
  assert.throws(() => parseRRule('FREQ=DAILY;COUNT=-5'), /COUNT/);
});

test('parseRRule parses a basic daily rule', () => {
  const r = parseRRule('FREQ=DAILY;INTERVAL=2;COUNT=5');
  assert.equal(r.freq, 'DAILY');
  assert.equal(r.interval, 2);
  assert.equal(r.count, 5);
  assert.equal(r.until, null);
  assert.deepEqual(r.byDay, []);
});

test('parseRRule parses UNTIL in UTC basic form', () => {
  const r = parseRRule('FREQ=DAILY;UNTIL=20240101T000000Z');
  assert.ok(r.until instanceof Date);
  assert.equal(r.until.getUTCFullYear(), 2024);
  assert.equal(r.until.getUTCMonth(), 0);
  assert.equal(r.until.getUTCDate(), 1);
});

test('parseRRule accepts RRULE: prefix', () => {
  const r = parseRRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  assert.equal(r.freq, 'WEEKLY');
  assert.deepEqual(r.byDay, [1, 3]);
});

test('RRule constructor rejects invalid dtstart', () => {
  assert.throws(() => new RRule('FREQ=DAILY', new Date('invalid')), /valid Date/);
});

test('next occurrences of a daily rule', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;INTERVAL=1;COUNT=5', start);
  const occ = r.next(3);
  assert.equal(occ.length, 3);
  assert.equal(occ[0].getTime(), start.getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 2).getTime());
  assert.equal(occ[2].getTime(), utc(2024, 1, 3).getTime());
});

test('next occurrences respect COUNT cap', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;COUNT=3', start);
  const occ = r.next(10);
  assert.equal(occ.length, 3);
  assert.equal(occ[2].getTime(), utc(2024, 1, 3).getTime());
});

test('next occurrences respect UNTIL bound', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;UNTIL=20240103T000000Z', start);
  const occ = r.next(10);
  assert.equal(occ.length, 3);
  assert.equal(occ[2].getTime(), utc(2024, 1, 3).getTime());
});

test('next occurrences with exclusive lower bound', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;COUNT=10', start);
  const occ = r.next(2, utc(2024, 1, 3));
  assert.equal(occ.length, 2);
  assert.equal(occ[0].getTime(), utc(2024, 1, 4).getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 5).getTime());
});

test('next occurrences of a daily rule with interval 2', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;INTERVAL=2;COUNT=5', start);
  const occ = r.next(3);
  assert.equal(occ[0].getTime(), start.getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 3).getTime());
  assert.equal(occ[2].getTime(), utc(2024, 1, 5).getTime());
});

test('next occurrences of a weekly rule without BYDAY', () => {
  // 2024-01-01 is a Monday. Without BYDAY, it recurs weekly on Mondays.
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=WEEKLY;INTERVAL=1;COUNT=4', start);
  const occ = r.next(3);
  assert.equal(occ[0].getTime(), start.getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 8).getTime());
  assert.equal(occ[2].getTime(), utc(2024, 1, 15).getTime());
});

test('next occurrences of a weekly rule with BYDAY and interval 2', () => {
  // BYDAY=MO,WE with INTERVAL=2: every other week, Monday and Wednesday.
  const start = utc(2024, 1, 1); // Monday
  const r = new RRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4', start);
  const occ = r.next(4);
  assert.equal(occ[0].getTime(), utc(2024, 1, 1).getTime()); // Mon week 1
  assert.equal(occ[1].getTime(), utc(2024, 1, 3).getTime()); // Wed week 1
  assert.equal(occ[2].getTime(), utc(2024, 1, 15).getTime()); // Mon week 3
  assert.equal(occ[3].getTime(), utc(2024, 1, 17).getTime()); // Wed week 3
});

test('prev occurrences of a daily rule', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;COUNT=10', start);
  const occ = r.prev(3, utc(2024, 1, 5));
  assert.equal(occ.length, 3);
  assert.equal(occ[0].getTime(), utc(2024, 1, 4).getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 3).getTime());
  assert.equal(occ[2].getTime(), utc(2024, 1, 2).getTime());
});

test('prev occurrences cannot go below DTSTART', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;COUNT=10', start);
  const occ = r.prev(10, utc(2024, 1, 3));
  assert.equal(occ.length, 2);
  assert.equal(occ[0].getTime(), utc(2024, 1, 2).getTime());
  assert.equal(occ[1].getTime(), start.getTime());
});

test('prev occurrences respect COUNT cap', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY;COUNT=3', start);
  const occ = r.prev(10, utc(2024, 1, 10));
  assert.equal(occ.length, 3);
  assert.equal(occ[0].getTime(), utc(2024, 1, 3).getTime());
  assert.equal(occ[2].getTime(), start.getTime());
});

test('prev occurrences use injected now function', () => {
  const start = utc(2024, 1, 1);
  const fakeNow = () => utc(2024, 1, 4);
  const r = new RRule('FREQ=DAILY;COUNT=10', start, { now: fakeNow });
  const occ = r.prev(2);
  assert.equal(occ[0].getTime(), utc(2024, 1, 3).getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 2).getTime());
});

test('nextOccurrences functional API', () => {
  const start = utc(2024, 1, 1);
  const occ = nextOccurrences('FREQ=DAILY;COUNT=3', start, 2);
  assert.equal(occ.length, 2);
  assert.equal(occ[0].getTime(), start.getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 2).getTime());
});

test('prevOccurrences functional API', () => {
  const start = utc(2024, 1, 1);
  const occ = prevOccurrences('FREQ=DAILY;COUNT=5', start, 2, utc(2024, 1, 4));
  assert.equal(occ.length, 2);
  assert.equal(occ[0].getTime(), utc(2024, 1, 3).getTime());
  assert.equal(occ[1].getTime(), utc(2024, 1, 2).getTime());
});

test('next with limit 0 returns empty array', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY', start);
  assert.deepEqual(r.next(0), []);
});

test('prev with limit 0 returns empty array', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY', start);
  assert.deepEqual(r.prev(0, utc(2024, 1, 5)), []);
});

test('next with invalid limit throws', () => {
  const start = utc(2024, 1, 1);
  const r = new RRule('FREQ=DAILY', start);
  assert.throws(() => r.next(-1), /limit/);
  assert.throws(() => r.next(1.5), /limit/);
});

test('RRule with BYDAY starting on a non-listed weekday', () => {
  // DTSTART is Tuesday 2024-01-02, but BYDAY is MO,WE,FR.
  // The first occurrence is still DTSTART itself (Tuesday), then the rule
  // picks up MO/WE/FR from the following pattern.
  const start = utc(2024, 1, 2); // Tuesday
  const r = new RRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4', start);
  const occ = r.next(4);
  assert.equal(occ[0].getTime(), utc(2024, 1, 2).getTime()); // Tue (DTSTART)
  assert.equal(occ[1].getTime(), utc(2024, 1, 3).getTime()); // Wed
  assert.equal(occ[2].getTime(), utc(2024, 1, 5).getTime()); // Fri
  assert.equal(occ[3].getTime(), utc(2024, 1, 8).getTime()); // Mon next week
});
