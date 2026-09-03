import { describe, expect, it } from 'vitest';

import { resolveTimeRange } from '../src/umami/time-range.js';

const NOW = new Date('2026-09-03T10:00:00.000Z');

describe('resolveTimeRange', () => {
  it('defaults to a rolling 30-day window ending now', () => {
    expect(resolveTimeRange({}, NOW)).toEqual({
      startAt: Date.parse('2026-08-04T10:00:00.000Z'),
      endAt: NOW.getTime(),
    });
  });

  it('resolves rolling periods without rounding away recent data', () => {
    expect(resolveTimeRange({ period: 'last_7_days' }, NOW)).toEqual({
      startAt: Date.parse('2026-08-27T10:00:00.000Z'),
      endAt: NOW.getTime(),
    });
  });

  it('resolves calendar periods in the requested IANA timezone', () => {
    expect(resolveTimeRange({ period: 'today', timezone: 'Europe/Luxembourg' }, NOW)).toEqual({
      startAt: Date.parse('2026-09-02T22:00:00.000Z'),
      endAt: NOW.getTime(),
    });
    expect(resolveTimeRange({ period: 'last_month', timezone: 'Europe/Luxembourg' }, NOW)).toEqual({
      startAt: Date.parse('2026-07-31T22:00:00.000Z'),
      endAt: Date.parse('2026-08-31T22:00:00.000Z'),
    });
  });

  it('accepts ISO timestamps and epoch milliseconds', () => {
    expect(
      resolveTimeRange({ startAt: '2026-09-01T00:00:00Z', endAt: NOW.getTime() }, NOW),
    ).toEqual({
      startAt: Date.parse('2026-09-01T00:00:00Z'),
      endAt: NOW.getTime(),
    });
  });

  it('rejects partial, reversed, and ambiguous ranges', () => {
    expect(() => resolveTimeRange({ startAt: NOW.getTime() }, NOW)).toThrow(/both/);
    expect(() =>
      resolveTimeRange({ startAt: NOW.getTime(), endAt: NOW.getTime() - 1 }, NOW),
    ).toThrow(/earlier/);
    expect(() => resolveTimeRange({ period: 'last_7_days', startAt: 1, endAt: 2 }, NOW)).toThrow(
      /either/,
    );
  });
});
