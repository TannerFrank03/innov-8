import { describe, expect, it } from 'vitest';
import { checkDateRange, nextCompletedAt, overWip, positionBetween } from '../server/rules.js';

describe('rules', () => {
  it('checks date ranges', () => {
    expect(checkDateRange('2026-11-01', '2026-11-05')).toBeNull();
    expect(checkDateRange('2026-11-05', '2026-11-05')).toBeNull();
    expect(checkDateRange('2026-11-06', '2026-11-05')).toMatch(/before/);
    expect(checkDateRange(null, '2026-11-05')).toBeNull();
  });

  it('works out completed_at on status change', () => {
    const now = '2026-11-01T10:00:00.000Z';
    expect(nextCompletedAt({ wasDone: false, isDone: true, current: null, now })).toBe(now);
    expect(nextCompletedAt({ wasDone: true, isDone: false, current: now, now: 'x' })).toBeNull();
    expect(nextCompletedAt({ wasDone: true, isDone: true, current: now, now: 'x' })).toBe(now);
  });

  it('places dropped items between neighbours', () => {
    expect(positionBetween(null, null)).toBe(1);
    expect(positionBetween(2, null)).toBe(3);
    expect(positionBetween(null, 2)).toBe(1);
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it('flags WIP over the limit only', () => {
    expect(overWip(4, 4)).toBe(false);
    expect(overWip(5, 4)).toBe(true);
    expect(overWip(50, null)).toBe(false);
  });
});
