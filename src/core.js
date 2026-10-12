/* btrfs-next — iCalendar RRule next/previous occurrence finder.
 *
 * Scope: this module parses a useful subset of the iCalendar RRULE syntax
 * (RFC 5545) and computes the next or previous N occurrences of a calendar
 * event. It deliberately supports only FREQ=DAILY and FREQ=WEEKLY, with
 * INTERVAL, BYDAY, COUNT, and UNTIL. That covers the vast majority of
 * real-world recurring meetings.
 *
 * Why no third-party deps: the brief forbids them, and the algorithms here
 * are simple enough that a dependency would not pay for itself.
 */

export const WEEKLY = 'WEEKLY';
const DAILY = 'DAILY';

const DAYNAME_TO_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const NUM_TO_DAYNAME = ['SU','MO','TU','WE','TH','FR','SA'];

/**
 * Parse an iCalendar RRULE string into a normalised object.
 *
 * We return plain objects rather than a class instance so the parser is a
 * pure function and the caller can serialise the result if they want.
 *
 * Supported parts:
 *   FREQ=DAILY|WEEKLY  (required)
 *   INTERVAL=1         (default 1)
 *   BYDAY=MO,TU,WE     (only meaningful for WEEKLY)
 *   COUNT=10           (optional, caps the total number of occurrences)
 *   UNTIL=20240101T000000Z (optional, inclusive upper bound, UTC)
 *
 * UNTIL is always interpreted in UTC. This is the most portable choice and
 * avoids the local-timezone ambiguities that make iCalendar tricky.
 *
 * @param {string} str
 * @returns {{freq:string, interval:number, byDay:number[], count:number|null, until:Date|null}}
 */
export function parseRRule(str) {
  if (typeof str !== 'string' || str.trim() === '') {
    throw new Error('RRULE must be a non-empty string');
  }
  const body = str.startsWith('RRULE:') ? str.slice('RRULE:'.length) : str;
  const parts = {};
  for (const pair of body.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
  }

  const freq = (parts.FREQ || '').toUpperCase();
  if (freq !== DAILY && freq !== WEEKLY) {
    throw new Error('Only FREQ=DAILY and FREQ=WEEKLY are supported');
  }

  const interval = parts.INTERVAL !== undefined ? parseInt(parts.INTERVAL, 10) : 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error('INTERVAL must be a positive integer');
  }

  let byDay = [];
  if (parts.BYDAY) {
    byDay = parts.BYDAY.split(',').map(d => {
      const key = d.trim().toUpperCase();
      const n = DAYNAME_TO_NUM[key];
      if (n === undefined) throw new Error('Invalid BYDAY value: ' + d);
      return n;
    });
    if (freq !== WEEKLY) {
      throw new Error('BYDAY is only valid with FREQ=WEEKLY');
    }
    byDay.sort((a, b) => a - b);
  } else if (freq === WEEKLY) {
    // If no BYDAY is given for a WEEKLY rule, the event recurs on the same
    // weekday as DTSTART. We represent that by pre-computing it.
  }

  let count = null;
  if (parts.COUNT !== undefined) {
    count = parseInt(parts.COUNT, 10);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('COUNT must be a positive integer');
    }
  }

  let until = null;
  if (parts.UNTIL !== undefined) {
    const s = parts.UNTIL.trim();
    // Accept YYYYMMDDTHHMMSSZ (the standard basic form).
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) throw new Error('UNTIL must be in YYYYMMDDTHHMMSSZ form');
    until = new Date(Date.UTC(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      parseInt(m[4], 10),
      parseInt(m[5], 10),
      parseInt(m[6], 10)
    ));
  }

  return { freq, interval, byDay, count, until };
}

/**
 * Convenience: format a Date as YYYYMMDDTHHMMSSZ (basic UTC).
 * Used only for building UNTIL values in tests and in the caller's favour.
 */
function formatUtcBasic(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    'T' +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    'Z';
}

/**
 * RRule is a small wrapper that binds a parsed rule to a DTSTART and a clock
 * function. All date math is done in UTC to keep behaviour deterministic and
 * timezone-independent. The caller is responsible for converting local
 * event times to UTC before constructing the rule.
 */
export class RRule {
  /**
   * @param {string} ruleStr
   * @param {Date} dtstart — the first occurrence (UTC).
   * @param {object} [opts]
   * @param {() => Date} [opts.now] — clock function for `nextAfterNow`.
   */
  constructor(ruleStr, dtstart, opts = {}) {
    this.rule = parseRRule(ruleStr);
    if (!(dtstart instanceof Date) || isNaN(dtstart.getTime())) {
      throw new Error('dtstart must be a valid Date');
    }
    this.dtstart = new Date(dtstart.getTime());

    // Default clock: real time. Tests inject a fake.
    this._now = opts.now || (() => new Date());
  }

  /**
   * Enumerate occurrences in forward order from DTSTART, respecting COUNT and
   * UNTIL. Returns up to `limit` occurrences strictly greater than `from`
   * (exclusive lower bound).
   *
   * @param {number} limit
   * @param {Date} [from] — exclusive lower bound (default: dtstart minus 1ms)
   * @returns {Date[]}
   */
  next(limit, from) {
    return this._enumerate(limit, from || null, /*forward=*/true);
  }

  /**
   * Enumerate occurrences in reverse order from DTSTART, respecting COUNT and
   * UNTIL. Returns up to `limit` occurrences strictly less than `from`
   * (exclusive upper bound).
   *
   * The reverse enumeration first walks forward from DTSTART to `from` (or
   * UNTIL) collecting all occurrences, then returns the last `limit` of
   * them in descending order. This is O(n) where n is the number of prior
   * occurrences, which is fine for the meeting-scheduling use case this
   * library exists for.
   *
   * @param {number} limit
   * @param {Date} [from] — exclusive upper bound (default: now)
   * @returns {Date[]}
   */
  prev(limit, from) {
    return this._enumerate(limit, from || this._now(), /*forward=*/false);
  }

  _enumerate(limit, from, forward) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('limit must be a non-negative integer');
    }
    if (limit === 0) return [];
    const { freq, interval, byDay, count, until } = this.rule;
    const results = [];

    // Effective BYDAY set. For WEEKLY without BYDAY, it's the DTSTART weekday.
    const effectiveByDay = (freq === WEEKLY && byDay.length > 0)
      ? byDay
      : (freq === WEEKLY ? [this.dtstart.getUTCDay()] : []);

    // For the forward direction, we iterate candidate dates and pick those
    // that match the rule, up to COUNT or UNTIL. For the reverse direction,
    // we collect the full forward sequence up to the upper bound and then
    // return the tail.
    const upperBound = forward
      ? Infinity
      : (from instanceof Date ? from.getTime() : this._now().getTime());

    let occurrenceCount = 0;
    let candidate = new Date(this.dtstart.getTime());
    let isFirst = true;

    // Safety valve: never iterate more than ~10000 occurrences to avoid
    // pathological loops (e.g. asking for prev occurrences of a daily event
    // that started in 1970).
    const MAX_ITER = 10000;
    let iter = 0;

    while (iter++ < MAX_ITER) {
      if (until && candidate.getTime() > until.getTime()) break;
      if (candidate.getTime() > upperBound) break;

      let matches;
      if (freq === DAILY) {
        matches = true;
      } else {
        matches = effectiveByDay.includes(candidate.getUTCDay());
      }

      // Per RFC 5545, DTSTART is always the first occurrence even if its
      // weekday is not in BYDAY.
      if (isFirst) {
        matches = true;
        isFirst = false;
      }

      if (matches) {
        occurrenceCount++;
        if (count !== null && occurrenceCount > count) break;

        if (forward) {
          if (from instanceof Date && candidate.getTime() <= from.getTime()) {
            // skip, below the exclusive lower bound
          } else {
            results.push(new Date(candidate.getTime()));
            if (results.length >= limit) break;
          }
        } else {
          // reverse mode: collect everything below upperBound
          if (candidate.getTime() < upperBound) {
            results.push(new Date(candidate.getTime()));
          }
        }
      }

      candidate = this._advance(candidate, interval, effectiveByDay);
    }

    if (!forward) {
      results.reverse();
      return results.slice(0, limit);
    }
    return results;
  }

  /**
   * Advance a candidate date by one rule step.
   * For DAILY: add INTERVAL days.
   * For WEEKLY: move to the next matching weekday within the next eligible
   *   interval window. Week alignment is based on the week of DTSTART.
   */
  _advance(candidate, interval, effectiveByDay) {
    const { freq } = this.rule;
    if (freq === DAILY) {
      const d = new Date(candidate.getTime());
      d.setUTCDate(d.getUTCDate() + interval);
      return d;
    }
    // WEEKLY: advance to the next matching weekday, respecting interval.
    // Week 0 is the week containing DTSTART. Eligible weeks are those where
    // weekIndex % interval === 0.
    const MS_PER_DAY = 86400000;
    const startDay = this.dtstart.getUTCDay();
    const dayDiff = Math.round((candidate.getTime() - this.dtstart.getTime()) / MS_PER_DAY);
    const currentWeekIndex = Math.floor((dayDiff + startDay) / 7);

    const d = new Date(candidate.getTime());
    for (let i = 0; i < 14 * interval + 7; i++) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (!effectiveByDay.includes(d.getUTCDay())) continue;
      const newDayDiff = Math.round((d.getTime() - this.dtstart.getTime()) / MS_PER_DAY);
      const newWeekIndex = Math.floor((newDayDiff + startDay) / 7);
      if (newWeekIndex % interval === 0) {
        return d;
      }
    }
    return d;
  }
}

/**
 * Functional API: next N occurrences after a given reference date.
 * @param {string} ruleStr
 * @param {Date} dtstart
 * @param {number} n
 * @param {Date} [after] — exclusive lower bound (default: dtstart)
 * @returns {Date[]}
 */
export function nextOccurrences(ruleStr, dtstart, n, after) {
  const r = new RRule(ruleStr, dtstart);
  return r.next(n, after);
}

/**
 * Functional API: previous N occurrences before a given reference date.
 * @param {string} ruleStr
 * @param {Date} dtstart
 * @param {number} n
 * @param {Date} [before] — exclusive upper bound (default: now)
 * @returns {Date[]}
 */
export function prevOccurrences(ruleStr, dtstart, n, before) {
  const r = new RRule(ruleStr, dtstart);
  return r.prev(n, before);
}
