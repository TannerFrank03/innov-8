// Pure business rules, kept separate so they can be unit-tested without a database.

/** Returns an error message when the start date falls after the due date. */
export function checkDateRange(start, due) {
  if (start && due && start > due) return 'Start date must be on or before the due date.';
  return null;
}

/**
 * What completed_at should become when a task changes status.
 * Entering a done status stamps it; leaving one clears it; otherwise it is kept.
 */
export function nextCompletedAt({ wasDone, isDone, current, now }) {
  if (isDone && !wasDone) return now;
  if (!isDone) return null;
  return current;
}

/** Position for an item dropped between two neighbours (either may be missing). */
export function positionBetween(before, after) {
  if (before == null && after == null) return 1;
  if (before == null) return after - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

/** True when a column has more cards than its WIP limit allows. */
export function overWip(count, limit) {
  return limit != null && count > limit;
}
