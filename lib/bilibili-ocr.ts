import { record } from './captions.ts';

export type BilibiliSubtitleMode = 'manual' | 'ai' | 'none';

function labelContainsAi(value: Record<string, unknown>) {
  const label = typeof value.lan_doc === 'string' ? value.lan_doc : '';
  return label.includes('AI') || /(?:^|[\s（(])ai(?:[\s）)]|$)/i.test(label);
}

/**
 * A Bilibili track is considered manually reviewed only when the API says so
 * explicitly and its user-facing label does not contradict that flag.
 */
export function isVerifiedManualBilibiliSubtitle(value: unknown) {
  if (!record(value) || labelContainsAi(value)) return false;
  return value.is_ai === false || value.is_ai === 0;
}

/**
 * Recognise current and historical Bilibili AI markers. Unknown tracks are not
 * promoted to either priority tier, which prevents malformed data from being
 * presented as a reviewed subtitle.
 */
export function isVerifiedAiBilibiliSubtitle(value: unknown) {
  if (!record(value)) return false;
  const language = typeof value.lan === 'string' ? value.lan : '';
  return labelContainsAi(value)
    || value.is_ai === true
    || value.is_ai === 1
    || Number(value.ai_status) > 0
    || Number(value.ai_type) > 0
    || /^ai-/i.test(language);
}

/**
 * Priority fallback strategy for Bilibili only:
 * 1. expose every verified manual track and no AI tracks;
 * 2. otherwise expose verified AI tracks as a non-blocking fallback;
 * 3. ignore unknown/malformed tracks.
 */
export function selectBilibiliSubtitlePriority<T>(subtitleList: readonly T[]) {
  const manualTracks = subtitleList.filter(item => isVerifiedManualBilibiliSubtitle(item));
  const aiTracks = subtitleList.filter(item => isVerifiedAiBilibiliSubtitle(item));
  const mode: BilibiliSubtitleMode = manualTracks.length ? 'manual' : aiTracks.length ? 'ai' : 'none';
  const selectedTracks = mode === 'manual' ? manualTracks : mode === 'ai' ? aiTracks : [];
  return {
    selectedTracks,
    manualTracks,
    aiTracks,
    mode,
    usedAiFallback: mode === 'ai',
  };
}
