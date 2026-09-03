import { Temporal } from '@js-temporal/polyfill';

export type TimePeriod =
  | 'last_24_hours'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month';

export interface TimeRangeInput {
  endAt?: number | string | undefined;
  period?: TimePeriod | undefined;
  startAt?: number | string | undefined;
  timezone?: string | undefined;
}

export interface TimeRange {
  endAt: number;
  startAt: number;
}

const ROLLING_DAYS: Partial<Record<TimePeriod, number>> = {
  last_24_hours: 1,
  last_7_days: 7,
  last_30_days: 30,
  last_90_days: 90,
};

function timestamp(value: number | string, name: string): number {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an epoch-millisecond number or an ISO timestamp`);
  }
  return parsed;
}

export function resolveTimeRange(input: TimeRangeInput, now = new Date()): TimeRange {
  const hasExplicitRange = input.startAt !== undefined || input.endAt !== undefined;
  if (input.period && hasExplicitRange) {
    throw new Error('Provide either period or startAt/endAt, not both');
  }
  if (hasExplicitRange) {
    if (input.startAt === undefined || input.endAt === undefined) {
      throw new Error('startAt and endAt must both be provided');
    }
    const startAt = timestamp(input.startAt, 'startAt');
    const endAt = timestamp(input.endAt, 'endAt');
    if (startAt >= endAt) throw new Error('startAt must be earlier than endAt');
    return { startAt, endAt };
  }

  const period = input.period ?? 'last_30_days';
  const endAt = now.getTime();
  const rollingDays = ROLLING_DAYS[period];
  if (rollingDays !== undefined) {
    return { startAt: endAt - rollingDays * 86_400_000, endAt };
  }

  const timezone = input.timezone ?? 'UTC';
  let current: Temporal.ZonedDateTime;
  try {
    current = Temporal.Instant.fromEpochMilliseconds(endAt).toZonedDateTimeISO(timezone);
  } catch {
    throw new Error(`timezone must be a valid IANA timezone: ${timezone}`);
  }

  const today = current.startOfDay();
  switch (period) {
    case 'today':
      return { startAt: today.epochMilliseconds, endAt };
    case 'yesterday': {
      const start = today.subtract({ days: 1 });
      return { startAt: start.epochMilliseconds, endAt: today.epochMilliseconds };
    }
    case 'this_week': {
      const start = today.subtract({ days: today.dayOfWeek - 1 });
      return { startAt: start.epochMilliseconds, endAt };
    }
    case 'last_week': {
      const thisWeek = today.subtract({ days: today.dayOfWeek - 1 });
      const start = thisWeek.subtract({ weeks: 1 });
      return { startAt: start.epochMilliseconds, endAt: thisWeek.epochMilliseconds };
    }
    case 'this_month': {
      const start = today.with({ day: 1 });
      return { startAt: start.epochMilliseconds, endAt };
    }
    case 'last_month': {
      const thisMonth = today.with({ day: 1 });
      const start = thisMonth.subtract({ months: 1 });
      return { startAt: start.epochMilliseconds, endAt: thisMonth.epochMilliseconds };
    }
    default:
      throw new Error(`Unsupported time period: ${String(period)}`);
  }
}
