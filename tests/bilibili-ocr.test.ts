import test from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedAiBilibiliSubtitle, isVerifiedManualBilibiliSubtitle,
  selectBilibiliSubtitlePriority } from '../lib/bilibili-ocr.ts';

const mockBiliSubtitleResponse = (subtitle_list: Array<Record<string, unknown>>) => ({
  code: 0,
  data: { subtitle_list },
});

test('Bilibili priority selector chooses verified manual tracks when manual and AI tracks coexist', () => {
  const response = mockBiliSubtitleResponse([
    { id: 1, is_ai: true, lan: 'ai-zh', lan_doc: '中文 (AI)', subtitle_url: '//i0.hdslb.com/ai.json' },
    { id: 2, is_ai: false, lan: 'zh-Hans', lan_doc: '中文（人工校对）', subtitle_url: '//i0.hdslb.com/manual.json' },
    { id: 3, is_ai: false, lan: 'en-US', lan_doc: 'English', subtitle_url: '//i0.hdslb.com/en.json' },
  ]);

  const selection = selectBilibiliSubtitlePriority(response.data.subtitle_list);

  assert.equal(selection.mode, 'manual');
  assert.equal(selection.usedAiFallback, false);
  assert.deepEqual(selection.selectedTracks.map(track => track.id), [2, 3]);
  assert.deepEqual(selection.aiTracks.map(track => track.id), [1]);
});

test('Bilibili priority selector falls back to AI tracks when no verified manual track exists', () => {
  const response = mockBiliSubtitleResponse([
    { id: 11, is_ai: true, lan: 'ai-zh', lan_doc: '中文 (AI)', subtitle_url: '//i0.hdslb.com/ai-zh.json' },
    { id: 12, is_ai: 1, lan: 'ai-en', lan_doc: 'English (AI)', subtitle_url: '//i0.hdslb.com/ai-en.json' },
  ]);

  const selection = selectBilibiliSubtitlePriority(response.data.subtitle_list);

  assert.equal(selection.mode, 'ai');
  assert.equal(selection.usedAiFallback, true);
  assert.deepEqual(selection.manualTracks, []);
  assert.deepEqual(selection.selectedTracks.map(track => track.id), [11, 12]);
});

test('AI label overrides a contradictory is_ai=false flag and malformed unknown tracks stay hidden', () => {
  const deceptive = { id: 21, is_ai: false, lan: 'zh-Hans', lan_doc: '中文（AI）' };
  const unknown = { id: 22, lan: 'zh-Hans', lan_doc: '中文' };

  assert.equal(isVerifiedManualBilibiliSubtitle(deceptive), false);
  assert.equal(isVerifiedAiBilibiliSubtitle(deceptive), true);
  assert.equal(isVerifiedManualBilibiliSubtitle(unknown), false);
  assert.equal(isVerifiedAiBilibiliSubtitle(unknown), false);
  assert.deepEqual(selectBilibiliSubtitlePriority([unknown]).selectedTracks, []);
});

test('Bilibili priority selector reports none for an empty subtitle list', () => {
  const selection = selectBilibiliSubtitlePriority(mockBiliSubtitleResponse([]).data.subtitle_list);
  assert.equal(selection.mode, 'none');
  assert.equal(selection.usedAiFallback, false);
  assert.deepEqual(selection.selectedTracks, []);
});
