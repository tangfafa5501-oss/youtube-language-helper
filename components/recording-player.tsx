import { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { PracticeRecording } from '../lib/practice-store';
import { MoreVertical, Pause, Play, Trash, Sparkles, RotateCcw } from './icons';
import { HoverHint } from './hover-hint';
import { useRecordingAssessment } from './use-recording-assessment';
import './assessment.css';
const AssessmentResult = lazy(() => import('./assessment-result'));

export type RecordingPlayerHandle = { pause: () => void; toggle: () => void; assess: () => void };
type Props = { recordings: PracticeRecording[]; selectedId: string; onSelect: (id: string) => void;
  onRemove: (id: string) => void; assessmentDisabled?: boolean; ref?: Ref<RecordingPlayerHandle> };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`;

/** Native audio decoding, with only the recording controls we actually offer. */
export function RecordingPlayer({ recordings, selectedId, onSelect, onRemove, assessmentDisabled = false, ref }: Props) {
  const selected = recordings.find(row => row.id === selectedId);
  const assessment = useRecordingAssessment(selected, assessmentDisabled);
  const audio = useRef<HTMLAudioElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState(''), [playing, setPlaying] = useState(false), [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0), [error, setError] = useState(''), [open, setOpen] = useState(false);
  useEffect(() => {
    const player = audio.current;
    player?.pause(); setPlaying(false); setPosition(0); setError(''); setOpen(false);
    setDuration((selected?.durationMs ?? 0) / 1000);
    if (!selected) { setUrl(''); return; }
    const next = URL.createObjectURL(selected.audio); setUrl(next);
    return () => { player?.pause(); URL.revokeObjectURL(next); };
  }, [selected]);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const keepTriggerVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const trigger = menuTrigger.current, footer = document.querySelector<HTMLElement>('.echo-player');
        if (!trigger || !footer) return;
        const triggerBox = trigger.getBoundingClientRect(), safeBottom = footer.getBoundingClientRect().top - 12;
        if (triggerBox.bottom > safeBottom) scrollBy({ top: triggerBox.bottom - safeBottom, behavior: 'instant' });
      });
    };
    const closeOnResize = () => setOpen(false);
    keepTriggerVisible(); addEventListener('resize', closeOnResize);
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', closeOnResize); };
  }, [open]);
  const toggle = () => {
    const player = audio.current; if (!player || !url) return;
    if (!player.paused) { player.pause(); return; }
    player.playbackRate = 1; player.defaultPlaybackRate = 1;
    if (player.ended) player.currentTime = 0;
    void player.play().catch(reason => { if (reason?.name !== 'AbortError') setError('录音回放失败，请重新选择录音'); });
  };
  useImperativeHandle(ref, () => ({ pause: () => audio.current?.pause(), toggle, assess: () => { void assessment.assess(); } }));
  if (!selected) return null;
  const choose = (id: string) => {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setPosition(0); setOpen(false); onSelect(id);
  };
  return <div className="practice-recordings" data-recording-id={selectedId}>
    <audio ref={audio} src={url || undefined} preload="metadata" aria-label="录音回放"
      onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value)) setDuration(value); }}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onRateChange={event => { if (event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1; }}
      onError={() => { if (url) setError('录音无法播放，请重新选择录音'); }}/>
    <div className="practice-playback-row">
      <button className="practice-playback-toggle" type="button" aria-label={playing ? '暂停录音回放' : '播放录音'}
        aria-keyshortcuts="G" title={playing ? '暂停录音回放 (G)' : '播放录音 (G)'} onClick={toggle}>{playing ? <Pause/> : <Play/>}</button>
      <HoverHint content={assessment.pending ? '正在评估，请勿重复提交' : assessment.result ? '查看发音评分 (V)' : '评估发音 (V)'}>
        <button type="button" className="practice-assess" data-assessment-trigger="true" aria-keyshortcuts="V"
          aria-label={assessment.pending ? '正在评估发音' : assessment.result ? '查看发音评分' : '评估发音'} aria-busy={!!assessment.pending}
          disabled={assessmentDisabled || !!assessment.pending} onClick={() => void assessment.assess()}>
          {assessment.pending ? <span className="assessment-spinner"><RotateCcw/></span> : assessment.result
            ? <span className="assessment-score-badge">{Math.round(assessment.result.overall)}</span> : <Sparkles/>}
        </button>
      </HoverHint>
      <input className="practice-playback-progress" type="range" min="0" max={duration || 1} step="0.01"
        value={Math.min(position, duration)} disabled={!url || !duration} aria-label="录音播放进度"
        aria-valuetext={`${clock(position)} / ${clock(duration)}`} onChange={event => {
          const next = Number(event.target.value); if (audio.current) audio.current.currentTime = next; setPosition(next);
        }}/>
      <span className="practice-playback-time">{clock(position)} / {clock(duration)}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild><button ref={menuTrigger} className="practice-recordings-trigger" type="button" aria-label="选择录音" title="选择录音"><MoreVertical/></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="practice-recordings-menu" aria-label="录音条目" side="top" align="end" sideOffset={8}
          collisionPadding={{ top: 12, right: 12, bottom: 80, left: 12 }}>
          {recordings.map((row, index) => {
            const number = row.take ?? recordings.length - index;
            return <div className="practice-recording-item" key={row.id} data-selected={row.id === selectedId}>
              <button className="practice-recording-choice" type="button" aria-label={`录音 #${number}`} aria-pressed={row.id === selectedId}
                onClick={() => choose(row.id)}><span>录音 #{number}</span><span>{clock(row.durationMs / 1000)}</span></button>
              <button className="practice-recording-delete" type="button" aria-label={`删除录音 #${number}`} title="删除此录音" onClick={() => onRemove(row.id)}><Trash/></button>
            </div>;
          })}
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div>
    {error && <p className="practice-error" role="alert">{error}</p>}
    {assessment.error && <p className="practice-error" role="alert" data-assessment-error="true">{assessment.error}</p>}
    {assessment.result && assessment.open && <Suspense fallback={<p role="status">正在打开评分…</p>}>
      <AssessmentResult key={selectedId} result={assessment.result} open={assessment.open} onOpenChange={assessment.setOpen} take={selected.take}/>
    </Suspense>}
  </div>;
}
