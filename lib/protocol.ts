import { record, type RawCue } from './captions';
import type { TimedPhrase } from './timed-phrases';

export const CHANNEL = 'ylh-page-v1';
export const PORT = 'ylh-panel-v1';
export type Track = { id: string; fingerprint: string; name: string; language: string; kind: 'manual' | 'asr' };
export type VideoInfo = { videoId: string; title: string; session: string; tracks: Track[]; availability: string; platform?: 'youtube' | 'bilibili' };
export type State = {
  version: 1; tabId?: number; video: VideoInfo | null; trackId: string | null;
  status: 'waiting' | 'ready' | 'loading' | 'loaded' | 'error';
  message: string; cues: RawCue[]; eventCount: number; controlEventCount: number;
  source?: 'youtube' | 'supadata' | 'bilibili';
  language?: string;
  requestedLanguage?: string;
  phrases?: TimedPhrase[];
  timingMessage?: string;
};
export const emptyState = (): State => ({ version: 1, video: null, trackId: null, status: 'waiting',
  message: '请打开 YouTube 或 B 站视频', cues: [], eventCount: 0, controlEventCount: 0 });
export function isVideoInfo(v: unknown): v is VideoInfo {
  return record(v) && typeof v.videoId === 'string' && (/^[\w-]{11}$/.test(v.videoId) || /^BV[0-9A-Za-z]{10}$/.test(v.videoId))
    && typeof v.title === 'string' && v.title.length <= 1000
    && typeof v.session === 'string' && v.session.length <= 100
    && typeof v.availability === 'string' && v.availability.length <= 300
    && Array.isArray(v.tracks) && v.tracks.length <= 200 && v.tracks.every(t => record(t)
      && typeof t.id === 'string' && t.id.length <= 500 && typeof t.fingerprint === 'string' && t.fingerprint.length <= 2000
      && typeof t.name === 'string' && t.name.length <= 500 && typeof t.language === 'string' && t.language.length <= 100
      && (t.kind === 'asr' || t.kind === 'manual'))
    && (v.platform === undefined || v.platform === 'youtube' || v.platform === 'bilibili');
}
