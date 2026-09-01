import type { RawCue } from './captions.ts';

type TimedText = Pick<RawCue, 'text' | 'startMs' | 'endMs'>;

function clean(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

export function secondaryTextForRange(cues: readonly TimedText[], startMs: number | null, endMs: number | null) {
  if (startMs === null || endMs === null || endMs <= startMs) return '';
  const parts: string[] = [];
  for (const cue of cues) {
    if (cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs) continue;
    const overlap = Math.min(endMs, cue.endMs) - Math.max(startMs, cue.startMs);
    if (overlap <= 0) continue;
    const text = clean(cue.text);
    if (text && text !== parts.at(-1)) parts.push(text);
  }
  return parts.join(' ');
}
