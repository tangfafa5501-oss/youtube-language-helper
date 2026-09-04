import React, { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DictationCard } from './dictation-card';
import { HoverHint } from './hover-hint';
import { RecordingPlayer, type RecordingPlayerHandle } from './recording-player';
import { PracticeMicrophone, requestMicrophonePermission, type MicrophoneStatus } from '../lib/microphone';
import { livePracticeKey, practiceKey, type PracticeSegment } from '../lib/practice';
import { practiceDatabase, savePracticeRecording, type PracticeRecording } from '../lib/practice-store';
import { pitchFromBlob, type PitchContour } from '../lib/pitch';
import type { ShortcutAction } from '../lib/shortcuts';
import { Mic, Clock, AudioLines, Activity, ChevronDown, CircleHelp, Square } from './icons';
import './practice.css';

const PitchCurve = lazy(() => import('./pitch-curve'));
const referenceCache = new Map<string, PitchContour>();
export type ExerciseHandle = { shortcut: (action: ShortcutAction) => boolean };
type Props = { segment: PracticeSegment; dictation: boolean; currentTimeMs: number | null; ref?: React.Ref<ExerciseHandle>;
  request: (type: 'practice-pause' | 'practice-capture', signal: AbortSignal) => Promise<string | undefined> };
const durationText = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export default function ShadowingExerciseCard({ segment, dictation, currentTimeMs, ref, request }: Props) {
  const [status, setStatus] = useState<MicrophoneStatus>('idle'), [duration, setDuration] = useState(0), [power, setPower] = useState(0);
  const [recordings, setRecordings] = useState<PracticeRecording[]>([]), [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const [reference, setReference] = useState<PitchContour | null>(null), [recordingPitch, setRecordingPitch] = useState<PitchContour | null>(null);
  const [showReference, setShowReference] = useState(true), [showRecording, setShowRecording] = useState(true);
  const [capturing, setCapturing] = useState(false), [analyzing, setAnalyzing] = useState(false);
  const [referenceError, setReferenceError] = useState(''), [recordingError, setRecordingError] = useState('');
  const [amplitude, setAmplitude] = useState(true);
  const lifetime = useRef(new AbortController()), captureAbort = useRef<AbortController | null>(null), audio = useRef<RecordingPlayerHandle>(null);
  const focus = useRef<(() => void) | null>(null), actionBusy = useRef(false), stopRef = useRef<() => void>(() => {});
  const requestRef = useRef(request); requestRef.current = request;
  const mic = useRef<PracticeMicrophone | null>(null);
  const key = practiceKey(segment), liveKey = livePracticeKey(segment);
  const selected = recordings.find(row => row.id === selectedId);
  if (!mic.current) mic.current = new PracticeMicrophone((next, elapsed, level) => {
    if (lifetime.current.signal.aborted) return;
    setStatus(next); if (elapsed !== undefined) setDuration(elapsed); if (level !== undefined) setPower(level);
  }, () => stopRef.current());
  useEffect(() => {
    lifetime.current = new AbortController();
    const signal = lifetime.current.signal;
    void practiceDatabase.recordings.where('key').equals(key).reverse().sortBy('createdAt').then(rows => {
      if (!signal.aborted) { setRecordings(rows); setSelectedId(rows[0]?.id ?? ''); }
    }).catch(() => { if (!signal.aborted) setError('无法读取录音条目'); });
    return () => { lifetime.current.abort(); captureAbort.current?.abort(); mic.current?.cancel(); };
  }, [liveKey]);
  useEffect(() => {
    let active = true; setRecordingPitch(null); setRecordingError('');
    if (!selected || !expanded) { setAnalyzing(false); return; }
    setAnalyzing(true);
    void pitchFromBlob(selected.audio).then(contour => { if (active) setRecordingPitch(contour); })
      .catch(() => { if (active) setRecordingError('录音音高分析失败，请重新录制'); })
      .finally(() => { if (active) setAnalyzing(false); });
    return () => { active = false; };
  }, [selected, expanded]);
  const captureReference = async () => {
    if (captureAbort.current || actionBusy.current || mic.current?.status !== 'idle') return;
    const controller = new AbortController(); captureAbort.current = controller; setCapturing(true); setReferenceError('');
    try {
      const data = await requestRef.current('practice-capture', controller.signal);
      if (!data?.startsWith('data:audio/')) throw new Error('视频没有返回可用的原声音频');
      const blob = await (await fetch(data)).blob(), contour = await pitchFromBlob(blob);
      if (controller.signal.aborted || lifetime.current.signal.aborted) return;
      if (referenceCache.size >= 32) referenceCache.delete(referenceCache.keys().next().value!);
      referenceCache.set(liveKey, contour); setReference(contour);
    } catch (reason) {
      if (!controller.signal.aborted && !lifetime.current.signal.aborted) setReferenceError(reason instanceof Error ? reason.message : '原声音高暂不可用');
    } finally { if (captureAbort.current === controller) { captureAbort.current = null; if (!lifetime.current.signal.aborted) setCapturing(false); } }
  };
  useEffect(() => {
    if (expanded) { const cached = referenceCache.get(liveKey); if (cached) setReference(cached); else void captureReference(); }
    else captureAbort.current?.abort();
    return () => captureAbort.current?.abort();
  }, [expanded, liveKey]);
  const toggleRecording = async () => {
    if (actionBusy.current || capturing) return;
    actionBusy.current = true; setError('');
    const signal = lifetime.current.signal;
    try {
      if (mic.current!.status === 'recording') {
        setSaving(true); const result = await mic.current!.stop();
        if (signal.aborted) return;
        const saved = await savePracticeRecording(segment, result.blob, result.durationMs);
        const rows = await practiceDatabase.recordings.where('key').equals(key).reverse().sortBy('createdAt');
        if (!signal.aborted) { setRecordings(rows); setSelectedId(saved.id); }
      } else if (mic.current!.status === 'idle') {
        audio.current?.pause(); setStatus('requesting');
        await requestRef.current('practice-pause', signal);
        await requestMicrophonePermission(signal);
        if (!signal.aborted) await mic.current!.start();
      }
    } catch (reason) { if (!signal.aborted) { setError(reason instanceof Error ? reason.message : '录音失败'); setStatus('idle'); } }
    finally { actionBusy.current = false; if (!signal.aborted) setSaving(false); }
  };
  stopRef.current = () => { void toggleRecording(); };
  const cancel = () => { mic.current?.cancel(); setDuration(0); setError('录音已取消'); };
  useImperativeHandle(ref, () => ({ shortcut: action => {
    if (action === 'record') { void toggleRecording(); return true; }
    if (action === 'cancel-recording') { if (status === 'recording') cancel(); return true; }
    if (action === 'play-recording') { audio.current?.toggle(); return true; }
    if (action === 'pitch') { if (status === 'idle' && !saving) setExpanded(value => !value); return true; }
    if (action === 'dictation-focus' && dictation) { focus.current?.(); return true; }
    return false;
  } }));
  const remove = async (id: string) => {
    try { await practiceDatabase.recordings.delete(id); setRecordings(rows => rows.filter(row => row.id !== id)); if (selectedId === id) setSelectedId(recordings.find(row => row.id !== id)?.id ?? ''); }
    catch { setError('删除录音失败，请重试'); }
  };
  const progress = currentTimeMs !== null && currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs
    ? (currentTimeMs - segment.startMs) / (segment.endMs - segment.startMs) * 100 : null;
  return <div className="practice-card" data-practice-key={key}>
    {dictation && <DictationCard key={liveKey} segment={segment} registerFocus={callback => { focus.current = callback; }}/>}
    <section aria-label="跟读练习">
      <div className="practice-line practice-heading"><h3><Mic/>跟读练习</h3><span className="practice-duration"><Clock/>{durationText(segment.endMs - segment.startMs)}</span></div>
      <p className="practice-help">跟着片段朗读并录音，注意匹配语速和语调。按 R 键开始/停止。</p>
      <div className="practice-pitch-heading">
        <button className="practice-disclosure" aria-expanded={expanded} disabled={status !== 'idle' || saving} title="展开/收起音高曲线 (P)" onClick={() => setExpanded(value => !value)}>
          <span><AudioLines/>音高曲线</span><ChevronDown/>
        </button>
        <HoverHint variant="help" content={<><strong className="ylh-tooltip-title">如何读懂图表</strong>曲线表示音高（语调）：青色 = 原声，橙色 = 你的录音。底部阴影区域表示音量强度，空白处代表停顿。尝试同时模仿音高曲线的形状和节奏模式。</>}>
          <button className="practice-chart-help" type="button" aria-label="如何读懂音高图表"><CircleHelp/></button>
        </HoverHint>
      </div>
      {expanded && <div className="practice-pitch-panel">
        <div className="practice-pitch-controls">
          <button className="practice-source reference" aria-label="显示原声曲线" aria-pressed={showReference} title="显示/隐藏原声" onClick={() => setShowReference(value => !value)}><span/></button>
          {recordingPitch && <button className="practice-source recording" aria-label="显示录音曲线" aria-pressed={showRecording} title="显示/隐藏录音" onClick={() => setShowRecording(value => !value)}><span/></button>}
          <span className="practice-control-divider"/>
          <button className="practice-amplitude" aria-label="显示音量强度" aria-pressed={amplitude} title="显示/隐藏音量阴影与轮廓" onClick={() => setAmplitude(value => !value)}><Activity/></button>
        </div>
        {reference || recordingPitch ? <Suspense fallback={<p className="practice-chart-message">正在加载音高图…</p>}><PitchCurve reference={reference} recording={recordingPitch} amplitude={amplitude} showReference={showReference} showRecording={showRecording && !!recordingPitch} playbackProgress={progress}/></Suspense>
          : !capturing && !referenceError && !analyzing && <p className="practice-chart-message">尚无可用音高，请录音后查看。</p>}
        {capturing && <p className="practice-help" role="status">正在播放片段并采集原声…</p>}
        {referenceError && <div className="practice-pitch-notice" role="status">{referenceError}<button disabled={capturing || status !== 'idle' || saving} onClick={() => void captureReference()}>重试原声</button></div>}
        {recordingError && <p className="practice-error" role="status">{recordingError}</p>}
        {analyzing && <p className="practice-help" role="status">正在分析录音音高…</p>}
      </div>}
      {recordings.length > 0 && <RecordingPlayer ref={audio} recordings={recordings} selectedId={selectedId} onSelect={setSelectedId} onRemove={id => void remove(id)}/>}
      {status === 'recording' && <div className="practice-live" role="status"><span className="practice-pulse"/>录音中 {durationText(duration)}<meter min="0" max="100" value={power} aria-label="麦克风音量"/></div>}
      <div className="practice-record-action"><button aria-label={status === 'recording' ? '停止录音' : '录音'} className={`practice-primary practice-record ${status === 'recording' ? 'recording' : ''}`}
        disabled={status === 'requesting' || status === 'stopping' || saving || capturing} onClick={() => void toggleRecording()}>
        {status === 'recording' ? <Square/> : <Mic/>}{saving || status === 'stopping' ? '保存中…' : status === 'requesting' ? '等待授权…' : status === 'recording' ? '停止' : '录音'}
      </button>{status === 'recording' && <button onClick={cancel}>取消</button>}</div>
      {error && <p role="alert" className="practice-error">{error}</p>}
    </section>
  </div>;
}
