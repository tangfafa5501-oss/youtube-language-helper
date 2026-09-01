import assert from 'node:assert/strict';
import test from 'node:test';
import { secondaryTextForRange } from '../lib/subtitle-lanes.ts';

test('secondary subtitle text follows real overlapping cue times without changing the primary range', () => {
  const cues = [
    { text: '你好。', startMs: 500, endMs: 2_500 },
    { text: '欢迎。', startMs: 2_500, endMs: 4_000 },
    { text: '不重叠。', startMs: 6_000, endMs: 7_000 },
  ];
  assert.equal(secondaryTextForRange(cues, 1_000, 4_000), '你好。 欢迎。');
  assert.equal(secondaryTextForRange(cues, 4_000, 5_000), '');
});

test('secondary subtitle alignment ignores invalid times and adjacent duplicate rolling cues', () => {
  const cues = [
    { text: ' Same line ', startMs: 1_000, endMs: 2_000 },
    { text: 'Same   line', startMs: 2_000, endMs: 3_000 },
    { text: 'invalid', startMs: null, endMs: null },
  ];
  assert.equal(secondaryTextForRange(cues, 1_000, 3_000), 'Same line');
  assert.equal(secondaryTextForRange(cues, null, 3_000), '');
});
