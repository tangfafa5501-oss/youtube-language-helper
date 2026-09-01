import sbd from 'sbd';

// Display-only phrasing. These offsets are text boundaries, never timestamps.
// Keep short comma asides with their context; do not treat every comma as a cut.
const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
const MAX_DISPLAY_TEXT = 200_000;

export type ReadingSentence = {
  text: string;
  lines: string[];
  complete: boolean;
};

const hasSentenceEnd = (text: string) => /[.!?][\s"'”’\)\]\}]*$/u.test(text);

function phraseSentence(sentence: string): string[] {
  const cuts = new Set<number>();
  const commas: number[] = [];
  const brackets: Array<{ close: string; opening: number }> = [];
  let quote = '';
  for (let i = 0; i < sentence.length; i++) {
    const char = sentence[i]!;
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === '“' || char === '‘' || char === '«') {
      quote = char === '“' ? '”' : char === '‘' ? '’' : char === '«' ? '»' : '"'; continue;
    }
    const closing = char === '(' ? ')' : char === '[' ? ']' : char === '{' ? '}' : '';
    if (closing) { brackets.push({ close: closing, opening: i }); continue; }
    if (brackets.length && char === brackets.at(-1)!.close) {
      const completed = brackets.pop()!;
      if (!brackets.length) {
        // Attach punctuation following an aside to the aside, not the next line.
        let end = i + 1;
        while (/[,.!?;:]/.test(sentence[end] ?? '') && end < sentence.length) end++;
        cuts.add(completed.opening); cuts.add(end);
      }
      continue;
    }
    if (brackets.length) continue;
    // An em dash, or a non-numeric en dash, marks a pause. Hyphenated words
    // and ranges such as 10–20 remain intact. Keep the original dash character.
    if (char === '—' || char === '–' && !(/\d/.test(sentence[i - 1] ?? '') && /\d/.test(sentence[i + 1] ?? ''))) {
      cuts.add(i + 1);
    }
    if (char === ',' && /\s/.test(sentence[i + 1] ?? '')) commas.push(i);
    if (char === ';' && /\s/.test(sentence[i + 1] ?? '')) cuts.add(i + 1);
    if (char === ':' && /\s/.test(sentence[i + 1] ?? '') && wordCount(sentence.slice(0, i)) >= 2) cuts.add(i + 1);
  }
  const structuralCuts = [...cuts].sort((a, b) => a - b);
  let start = 0, structuralIndex = 0;
  for (let index = 0; index < commas.length; index++) {
    const comma = commas[index]!;
    while (structuralIndex < structuralCuts.length && structuralCuts[structuralIndex]! <= comma) {
      start = Math.max(start, structuralCuts[structuralIndex++]!);
    }
    const nextComma = commas[index + 1];
    const shortAsideAhead = nextComma !== undefined
      && (structuralCuts[structuralIndex] === undefined || structuralCuts[structuralIndex]! > nextComma)
      && wordCount(sentence.slice(comma + 1, nextComma)) <= 4
      && !/[.!?;()]/.test(sentence.slice(comma + 1, nextComma));
    // Eight words is a local, adjustable semantic heuristic, not a linguistic
    // guarantee. It retains short lead-ins and joins a short aside to the
    // preceding clause. A following relative/adverbial or sequence clause is
    // an additional textual cue even when a preceding structural boundary has
    // left a shorter main clause. Audio pauses are not inspected here.
    const clauseAhead = /^\s*(?:each|which|who|where|when|because|although)\b/i.test(sentence.slice(comma + 1));
    const sequenceAhead = /^\s*(?:first(?:ly)?|second(?:ly)?|next|then|finally)\b/i.test(sentence.slice(comma + 1));
    if (wordCount(sentence.slice(start, comma)) >= (clauseAhead || sequenceAhead ? 4 : 8) && !shortAsideAhead) {
      cuts.add(comma + 1); start = comma + 1;
    }
  }
  // A late prepositional tail is a semantic boundary in a long clause even
  // when transferred captions lost their punctuation. Split only when both
  // sides are substantial so ordinary short phrases such as "in the house"
  // stay intact. The boundary is generic; it is not tied to audio silence or a
  // sample sentence.
  const existingCuts = [0, ...cuts, sentence.length].sort((a, b) => a - b);
  for (let part = 0; part + 1 < existingCuts.length; part++) {
    const partStart = existingCuts[part]!, partEnd = existingCuts[part + 1]!;
    const segment = sentence.slice(partStart, partEnd);
    for (const match of segment.matchAll(/\s+(?=(?:in|with|for|from|by|at|on|into|over|under)\s+(?:my|our|your|his|her|their|the|a|an)\b)/giu)) {
      const boundary = partStart + match.index! + match[0].length;
      if (wordCount(sentence.slice(partStart, boundary)) >= 10
        && wordCount(sentence.slice(boundary, partEnd)) >= 4) cuts.add(boundary);
    }
  }
  // Long clauses without punctuation still need a usable reading breath. Use
  // explicit conjunction/relative-clause words only when both sides are long.
  const conjunctionCuts = [0, ...cuts, sentence.length].sort((a, b) => a - b);
  for (let part = 0; part + 1 < conjunctionCuts.length; part++) {
    const partStart = conjunctionCuts[part]!, partEnd = conjunctionCuts[part + 1]!;
    const segment = sentence.slice(partStart, partEnd);
    for (const match of segment.matchAll(/\s+(?=(?:and|but|because|while|when|which|who|that|so)\s+)/giu)) {
      const boundary = partStart + match.index! + match[0].length;
      if (wordCount(sentence.slice(partStart, boundary)) >= 12 && wordCount(sentence.slice(boundary, partEnd)) >= 5) {
        cuts.add(boundary); break;
      }
    }
  }
  cuts.add(sentence.length);
  const lines: string[] = [];
  let offset = 0;
  for (const end of [...cuts].sort((a, b) => a - b)) {
    const line = sentence.slice(offset, end).trim();
    if (line) lines.push(line);
    offset = end;
  }
  return lines;
}

export function readingSentences(text: string): ReadingSentence[] {
  // Source newlines may be arbitrary subtitle wrapping. Normalize only this
  // display copy; raw captions and the original-event view remain untouched.
  const display = text.replace(/\s+/gu, ' ').trim();
  if (!display) return [];
  if (display.length > MAX_DISPLAY_TEXT) return [{ text: display, lines: [display], complete: hasSentenceEnd(display) }];
  // SBD's default rules target English. Preserve mixed/CJK source text without
  // claiming English phrase heuristics work for bilingual captions.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(display)) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      .map(line => ({ text: line, lines: [line], complete: hasSentenceEnd(line) }));
  }
  let sentences: string[];
  try {
    sentences = sbd.sentences(display, { preserve_whitespace: true, newline_boundaries: false,
      html_boundaries: false, sanitize: false });
  } catch { return [{ text: display, lines: [display], complete: hasSentenceEnd(display) }]; }
  if (!sentences.length || sentences.join('') !== display) {
    return [{ text: display, lines: [display], complete: hasSentenceEnd(display) }];
  }
  const result = sentences.map(source => {
    const sentence = source.trim(), lines = phraseSentence(sentence);
    return { text: sentence, lines, complete: hasSentenceEnd(sentence) };
  }).filter(sentence => sentence.text);
  // Reject any unexpected loss of text or punctuation; only whitespace may vary.
  return result.flatMap(sentence => sentence.lines).join(' ').replace(/\s/gu, '') === display.replace(/\s/gu, '')
    ? result : [{ text: display, lines: [display], complete: hasSentenceEnd(display) }];
}

export function readingLines(text: string): string[] {
  return readingSentences(text).flatMap(sentence => sentence.lines);
}
