export type TimedViewRow = { startMs: number | null; endMs: number | null };
export type PlaybackBinding = { videoId: string; session: string; track: string };

export function matchesPlaybackBinding(message: Record<string, unknown>, binding: PlaybackBinding) {
  return message.videoId === binding.videoId && message.session === binding.session && message.trackId === binding.track;
}

// Caption rows can overlap. Prefer the latest row that has actually started,
// and never keep the previous row highlighted through an uncovered silence.
export function activeTimedRowIndex(rows: TimedViewRow[], currentTimeMs: number | null) {
  if (currentTimeMs === null || !Number.isFinite(currentTimeMs)) return -1;
  let active = -1;
  let latestStart = -1;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (row.startMs === null || row.endMs === null || row.endMs <= row.startMs) continue;
    if (currentTimeMs >= row.startMs && currentTimeMs < row.endMs && row.startMs >= latestStart) {
      active = index;
      latestStart = row.startMs;
    }
  }
  return active;
}

export function adjacentPlayableRowIndex(rows: TimedViewRow[], currentIndex: number, direction: -1 | 1) {
  let index = currentIndex < 0 ? (direction === 1 ? 0 : rows.length - 1) : currentIndex + direction;
  while (index >= 0 && index < rows.length) {
    const row = rows[index]!;
    if (row.startMs !== null && row.endMs !== null && row.endMs > row.startMs) return index;
    index += direction;
  }
  return -1;
}
