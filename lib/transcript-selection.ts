import type { Track } from './protocol.ts';

// A broad language preference may have a manual regional track (en -> en-GB).
// Do not replace a user's explicit regional preference with another dialect.
export function preferredTranscriptTrack(tracks: Track[], language: string | null): Track | undefined {
  if (!language) return undefined;
  const preferred = language.toLowerCase();
  const matches = tracks.filter(t => t.language.toLowerCase() === preferred
    || !preferred.includes('-') && t.language.toLowerCase().startsWith(`${preferred}-`));
  const manual = matches.filter(t => t.kind === 'manual');
  const candidates = manual.length ? manual : matches;
  return candidates.find(t => t.language.toLowerCase() === preferred) ?? candidates[0];
}
