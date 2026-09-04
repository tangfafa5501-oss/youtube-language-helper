import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from './icons';
import type { PronunciationAssessment } from '../lib/youdao';

const displayScore = (value: number | undefined) => value === undefined ? '—' : value.toFixed(1);
export default function AssessmentResult({ result, open, onOpenChange, take }: { result: PronunciationAssessment;
  open: boolean; onOpenChange: (open: boolean) => void; take?: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const word = selected === null ? undefined : result.words[selected];
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="echo-dialog-overlay"/>
    <Dialog.Content className="assessment-dialog" aria-describedby="assessment-description" onCloseAutoFocus={event => {
      event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-assessment-trigger]')?.focus();
    }}>
      <header className="assessment-heading"><Dialog.Title>发音评估{take ? ` · 录音 #${take}` : ''}</Dialog.Title>
        <Dialog.Close aria-label="关闭发音评估"><X/></Dialog.Close></header>
      <Dialog.Description id="assessment-description">有道语音评测 · {result.language === 'en' ? '英语' : '中文'} · 满分 100。点击单词查看音素详情。</Dialog.Description>
      <div className="assessment-scores">{[
        ['综合', result.overall], ['准确度', result.accuracy], ['流利度', result.fluency], ['完整度', result.completeness],
      ].map(([label, value]) => <div key={label}><strong>{displayScore(value as number)}</strong><span>{label}</span></div>)}</div>
      <p className="assessment-reference">{result.referenceText}</p>
      <div className="assessment-words" aria-label="单词评分">{result.words.map((item, index) => <button type="button" key={index}
        aria-label={`${item.text}，准确度 ${displayScore(item.score)}`} aria-expanded={selected === index}
        data-needs-practice={item.phonemes.some(p => p.correct === false)} onClick={() => setSelected(selected === index ? null : index)}>
        <span>{item.text}</span><small>{displayScore(item.score)}</small></button>)}</div>
      {word && <section className="assessment-word-detail" aria-label="音素详情">
        <h3>{word.text} {word.ipa ? `/${word.ipa}/` : ''}</h3>
        {word.phonemes.length ? <ul>{word.phonemes.map((p, index) => <li key={index} data-needs-practice={p.correct === false}>
          <div><strong>/{p.phoneme}/</strong><span>{displayScore(p.score)}</span></div>
          <p>{p.correct === true ? '发音正确' : p.correct === false ? `需练习${p.heard ? `，听起来像 /${p.heard}/` : ''}` : '未提供音素判断'}
            {p.expectedStress === true && p.actualStress === false ? '；应重读，未检测到重音' : ''}
          </p>
        </li>)}</ul> : <p>该单词未返回音素详情。</p>}
      </section>}
      <p className="assessment-note">{result.speechRate !== undefined && result.language === 'en' ? `语速 ${Math.round(result.speechRate)} 词/分钟。` : ''}评分已随本条录音保存，重复查看不会重新调用。分数供练习参考。</p>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
