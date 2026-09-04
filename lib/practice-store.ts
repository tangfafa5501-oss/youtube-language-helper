import Dexie, { type Table } from 'dexie';
import { practiceKey, type DictationResult, type PracticeSegment } from './practice';

export type PracticeRecording = { id: string; key: string; createdAt: number; audio: Blob; durationMs: number; segment: PracticeSegment; take?: number };
export type DictationAttempt = { id: string; key: string; createdAt: number; input: string; result: DictationResult };
class PracticeDatabase extends Dexie {
  recordings!: Table<PracticeRecording, string>;
  attempts!: Table<DictationAttempt, string>;
  constructor() {
    super('VideoLanguageHelperPractice');
    this.version(1).stores({ recordings: 'id, key, createdAt', attempts: 'id, key, createdAt' });
  }
}
export const practiceDatabase = new PracticeDatabase();
export async function savePracticeRecording(segment: PracticeSegment, audio: Blob, durationMs: number) {
  if (!audio.size) throw new Error('录音为空，请检查麦克风后重试');
  return practiceDatabase.transaction('rw', practiceDatabase.recordings, async () => {
    const key = practiceKey(segment);
    const previous = await practiceDatabase.recordings.where('key').equals(key).sortBy('createdAt');
    // Add numbers to older recordings without replacing their audio or changing the DB schema.
    let take = 0;
    for (const row of previous) {
      take = Math.max(take + 1, row.take ?? 0);
      if (row.take === undefined) await practiceDatabase.recordings.update(row.id, { take });
    }
    const value: PracticeRecording = { id: crypto.randomUUID(), key, createdAt: Date.now(), audio, durationMs, segment, take: take + 1 };
    await practiceDatabase.recordings.add(value); return value;
  });
}
export async function saveDictationAttempt(segment: PracticeSegment, input: string, result: DictationResult) {
  const value: DictationAttempt = { id: crypto.randomUUID(), key: practiceKey(segment), createdAt: Date.now(), input, result };
  await practiceDatabase.attempts.add(value); return value;
}
