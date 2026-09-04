import { record, type RawCue } from './captions.ts';

export type TimedPhrase = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  timing: 'youtube-word' | 'youtube-estimated' | 'bilibili-cue' | 'youtube-native';
};

export const CHANNEL = 'ylh-page-v1';
export const PORT = 'ylh-panel-v1';
// Keep the public player controls compatible with Enjoy's current media player.
export const PLAYBACK_RATES = [.5, 1, 1.5, 2] as const;
export function isPlaybackRate(value: unknown): value is (typeof PLAYBACK_RATES)[number] {
  return typeof value === 'number' && (PLAYBACK_RATES as readonly number[]).includes(value);
}

export function adjacentPlaybackRate(current: number, direction: -1 | 1) {
  const index = (PLAYBACK_RATES as readonly number[]).indexOf(current);
  if (index < 0) return 1;
  return PLAYBACK_RATES[index + direction] ?? current;
}

export type PlayMode = 'auto' | 'manual' | 'shadowing' | 'practice';

export const PLAYER_SHORTCUTS = {
  playOrPause: 'Space',
  previous: 'KeyA',
  replay: 'KeyS',
  next: 'KeyD',
  toggleEcho: 'KeyE',
  togglePractice: 'KeyF',
  toggleDictation: 'KeyH',
  record: 'KeyR',
  playRecording: 'KeyG',
  decreaseRate: 'Comma',
  increaseRate: 'Period',
} as const;
export type Track = { id: string; fingerprint: string; name: string; language: string; kind: 'manual' | 'asr' };
export type VideoInfo = { videoId: string; title: string; session: string; tracks: Track[]; availability: string; platform?: 'youtube' | 'bilibili' };
export type State = {
  version: 1; tabId?: number; video: VideoInfo | null; trackId: string | null;
  status: 'waiting' | 'ready' | 'loading' | 'loaded' | 'error';
  message: string; cues: RawCue[]; eventCount: number; controlEventCount: number;
  source?: 'youtube' | 'bilibili';
  language?: string;
  requestedLanguage?: string;
  phrases?: TimedPhrase[];
  timingMessage?: string;
  primaryTrackId?: string;
  secondaryTrackId?: string | null;
  secondaryCues?: RawCue[];
  secondaryLanguage?: string;
  secondaryStatus?: 'idle' | 'loading' | 'loaded' | 'error';
  secondaryMessage?: string;
  nativeTimeline?: {
    requestCompletedAt?: number;
    capturedAt: number;
    deliveredAt: number;
    source: 'captured' | 'latest' | 'cache' | 'network';
  };
};
export const emptyState = (): State => ({ version: 1, video: null, trackId: null, status: 'waiting',
  message: '请打开 YouTube 或 B 站视频', cues: [], eventCount: 0, controlEventCount: 0 });
export function isVideoInfo(v: unknown): v is VideoInfo {
  return record(v) && typeof v.videoId === 'string' && (/^[\w-]{11}$/.test(v.videoId) || /^BV[0-9A-Za-z]{10}$/.test(v.videoId))
    && typeof v.title === 'string' && v.title.length <= 1000
    && typeof v.session === 'string' && v.session.length <= 100
    && typeof v.availability === 'string' && v.availability.length <= 300
    && Array.isArray(v.tracks) && v.tracks.length <= 200 && v.tracks.every(t => record(t)
      && typeof t.id === 'string' && !!t.id && t.id.length <= 500 && typeof t.fingerprint === 'string' && !!t.fingerprint && t.fingerprint.length <= 2000
      && typeof t.name === 'string' && t.name.length <= 500 && typeof t.language === 'string' && t.language.length <= 100
      && (t.kind === 'asr' || t.kind === 'manual'))
    && (v.platform === undefined || v.platform === 'youtube' || v.platform === 'bilibili');
}
