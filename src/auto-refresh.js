/** Quiet re-read of the published snapshot. Same spacing as the feed schedule. */
export const AUTO_REFRESH_MS = 15 * 60 * 1000;

/**
 * Whether a quiet check of the published snapshot should start.
 * Returns "wait" while a check is already in flight, so a timer and the
 * Check for updates button cannot overlap.
 * A hidden tab does not fetch. When that tab becomes visible and the
 * interval has already elapsed, the check runs then.
 */
export function quietRefreshAction({
  now,
  lastCheckAt,
  refreshing = false,
  hidden = false,
  becameVisible = false,
  intervalMs = AUTO_REFRESH_MS,
} = {}) {
  if (refreshing) return "wait";
  if (!Number.isFinite(lastCheckAt) || !Number.isFinite(now)) return "wait";
  const due = now - lastCheckAt >= intervalMs;
  if (!due) return "wait";
  if (hidden && !becameVisible) return "wait";
  return "refresh";
}

/**
 * Keep the reader's place when a new published snapshot arrives.
 * The source and Word Bank stay. The open story stays open when that
 * article is still in the current list; otherwise it closes.
 */
export function applyPublishedSnapshot(state, articles) {
  const articleId = state?.articleId ?? null;
  const stillOpen = !articleId || (articles || []).some((article) => article?.id === articleId);
  return {
    selection: state?.selection,
    articleId: stillOpen ? articleId : null,
    openHit: stillOpen ? (state?.openHit ?? null) : null,
    words: state?.words,
  };
}
