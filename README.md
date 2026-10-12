# btrfs-next

Computes the next or previous N occurrences of a calendar event following an iCalendar RRule recurrence specification.

## Usage

```js
import { RRule, nextOccurrences, prevOccurrences } from 'btrfs-next';

const start = new Date(Date.UTC(2024, 0, 1)); // 2024-01-01T00:00:00Z

// Class-based API with an injectable clock (deterministic tests)
const rule = new RRule('FREQ=DAILY;COUNT=10', start, {
  now: () => new Date(Date.UTC(2024, 0, 5))
});
const next3 = rule.next(3);
const prev2 = rule.prev(2);

// Functional API
const occ = nextOccurrences('FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2', start, 4);
const earlier = prevOccurrences('FREQ=DAILY', start, 3, new Date(Date.UTC(2024, 0, 10)));
```

## Why this exists

Scheduling code often needs to answer "what are the next three instances of this recurring meeting?" without pulling in a full iCalendar library. The trade-off here is coverage for simplicity: this library supports only `FREQ=DAILY` and `FREQ=WEEKLY`, with `INTERVAL`, `BYDAY`, `COUNT`, and `UNTIL`. That subset covers the vast majority of real-world recurring meetings.

All date math is done in UTC. The caller is responsible for converting local event times to UTC before construction. This avoids the local-timezone ambiguities that make iCalendar date comparison unreliable. `UNTIL` is always parsed and interpreted as UTC.

## Edge cases you will hit

- `prev()` collects the full forward sequence from `DTSTART` to the upper bound and returns the tail. Asking for previous occurrences of a daily event that started decades ago will hit the internal 10,000-iteration safety cap and return fewer results than requested. This is intentional — the library is meant for meeting scheduling, not historical enumeration.
- When `BYDAY` is specified but `DTSTART` falls on a weekday not in that list, `DTSTART` itself is still counted as the first occurrence, per RFC 5545.
- `next(limit, from)` uses an exclusive lower bound: occurrences equal to `from` are not returned.
