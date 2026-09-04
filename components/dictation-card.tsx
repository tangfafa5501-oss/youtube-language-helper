import React, { useEffect, useRef, useState } from 'react';
import { checkDictation, practiceKey, wordCount, type DictationResult, type PracticeSegment } from '../lib/practice';
import { Ear, Check } from './icons';
import { practiceDatabase, saveDictationAttempt, type DictationAttempt } from '../lib/practice-store';

export function DictationCard({ segment, registerFocus }: { segment: PracticeSegment; registerFocus: (callback: (() => void) | null) => void }) {
  const [input, setInput] = useState(''), [result, setResult] = useState<DictationResult | null>(null);
  const [checking, setChecking] = useState(false), [error, setError] = useState(''), [history, setHistory] = useState<DictationAttempt[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null), current = useRef(true), busy = useRef(false);
  const key = practiceKey(segment);
  useEffect(() => { current.current = true; registerFocus(() => textarea.current?.focus());
    void practiceDatabase.attempts.where('key').equals(key).reverse().sortBy('createdAt').then(rows => { if (current.current) setHistory(rows); }).catch(() => setError('无法读取听写历史'));
    return () => { current.current = false; registerFocus(null); };
  }, [key]);
  const check = async () => {
    if (!input.trim() || busy.current) return;
    busy.current = true; setChecking(true); setError('');
    const next = checkDictation(segment.text, input); setResult(next);
    try { const saved = await saveDictationAttempt(segment, input, next); if (current.current) setHistory(rows => [saved, ...rows]); }
    catch { if (current.current) setError('答案已检查，但历史保存失败，请检查浏览器存储空间'); }
    finally { busy.current = false; if (current.current) setChecking(false); }
  };
  const best = history.length ? Math.max(...history.map(row => row.result.accuracy)) : 0;
  return <section className="practice-dictation" aria-label="听写练习">
    <h3><Ear/>听写练习</h3>
    <textarea ref={textarea} aria-label="听写输入" placeholder="开始输入..." value={input} maxLength={10_000}
      onChange={event => { setInput(event.target.value); setResult(null); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void check(); }
        if (event.key === 'Escape') textarea.current?.blur();
      }}/>
    <p className="practice-help">输入你听到的内容（Enter 检查，Shift+Enter 换行）</p>
    <div className="practice-line"><span>{wordCount(input)} 词</span><button className="practice-primary" disabled={!input.trim() || checking} onClick={() => void check()}><Check/>{checking ? '保存中…' : '检查'}</button></div>
    {result && <div className="practice-result" role="status" data-passed={result.passed}>
      <strong>{result.passed ? '全部正确' : '继续练习'} · {result.accuracy}%</strong>
      <p>正确 {result.correct} · 漏写 {result.missed} · 多写 {result.extra}</p>
      <p className="practice-diff">{result.changes.map((change, index) => <span key={index} className={change.added ? 'added' : change.removed ? 'missed' : ''}>{change.value}</span>)}</p>
      <small>红色：参考答案中漏写的词；橙色：多写的词。忽略大小写和标点。</small>
    </div>}
    {error && <p role="alert">{error}</p>}
    {history.length > 0 && <details className="practice-history"><summary>{history.length} 次练习 · 最好 {best}% · 平均 {Math.round(history.reduce((sum, row) => sum + row.result.accuracy, 0) / history.length)}%</summary>
      {history.slice(0, 10).map(row => <button key={row.id} onClick={() => { setInput(row.input); setResult(row.result); }}>{new Date(row.createdAt).toLocaleString()} · {row.result.accuracy}%</button>)}
    </details>}
  </section>;
}
