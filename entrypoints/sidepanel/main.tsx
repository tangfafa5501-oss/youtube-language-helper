import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, Keyboard, Languages, ListRestart, Mic, MoreVertical, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Square } from 'lucide-react';
import { PLAYBACK_RATES, PORT, emptyState, type State } from '../../lib/protocol';
import { connectPanel } from '../../lib/panel-connection';
import { record } from '../../lib/captions';
import { SERVICE_CHANNEL, type ServiceReply } from '../../lib/settings';
import { preferredTranscriptTrack } from '../../lib/transcript-selection';
import { activeTimedRowIndex, adjacentPlayableRowIndex, matchesPlaybackBinding } from '../../lib/playback-view';
import { preferredRecordingType, recordedAudio, stopMediaTracks } from '../../lib/recording';
import './style.css';

function timestamp(ms: number | null) {
  if (ms === null) return '时间异常';
  return `${Math.floor(ms / 60_000).toString().padStart(2, '0')}:${(ms % 60_000 / 1000).toFixed(3).padStart(6, '0')}`;
}

function compactTimestamp(ms: number | null) {
  if (ms === null) return '--:--';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function languageLabel(language?: string) {
  const code = language?.toLowerCase();
  if (code?.includes('+')) return code.split('+').map(part => part.startsWith('en') ? 'English' : part.startsWith('zh') || part.startsWith('ai-zh') ? '中文' : part).join(' + ');
  if (code === 'en-gb') return 'British English';
  if (code === 'en-us') return 'American English';
  if (code?.startsWith('en')) return 'English';
  return language || 'Original';
}

type EchoRow = { id: string; text: string; startMs: number | null; endMs: number | null; phraseId?: string; cueId?: string };

const EchoCueRow = React.memo(function EchoCueRow({ item, active, index }: { item: EchoRow; active: boolean; index: number }) {
  const playable = item.startMs !== null && item.endMs !== null && item.endMs > item.startMs;
  return <li><button data-phrase-id={item.id} data-row-index={index} className={`echo-cue ${active ? 'selected' : ''}`}
    title={`${timestamp(item.startMs)} → ${timestamp(item.endMs)}`} disabled={!playable} aria-current={active ? 'true' : undefined}>
    <span className="echo-time">{compactTimestamp(item.startMs)}</span>
    <span className="echo-text">{item.text || '（空文本条目）'}</span>
  </button></li>;
});

function App() {
  const [state, setState] = useState<State>(emptyState);
  const [playback, setPlayback] = useState('');
  const [selected, setSelected] = useState('');
  const [connection, setConnection] = useState(0);
  const [displayMode, setDisplayMode] = useState<'phrases' | 'raw'>('phrases');
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [sourceChoice, setSourceChoice] = useState({ session: '', id: 'auto' });
  const remoteBusy = useRef(new Set<string>());
  const [remotePendingSessions, setRemotePendingSessions] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [playMode, setPlayMode] = useState<'single' | 'loop' | 'all'>('single');
  const [playModeOpen, setPlayModeOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingGenerationRef = useRef(0);
  const connectionRef = useRef<ReturnType<typeof connectPanel> | null>(null);
  const viewRef = useRef({ videoId: '', session: '', track: '' });
  useEffect(() => {
    let active = true;
    void browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1, type: 'settings' })
      .then((r: ServiceReply) => { if (active && r.ok && r.settings) setPreferredLanguage(r.settings.language); })
      .catch(() => { /* The background still uses saved settings if public settings cannot be read. */ })
      .finally(() => { if (active) setSettingsReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = connectPanel({
      query: () => browser.tabs.query({ active: true, currentWindow: true }),
      connect: tabId => browser.tabs.connect(tabId, { name: PORT, frameId: 0 }),
      lastError: () => browser.runtime.lastError?.message,
      activated: browser.tabs.onActivated,
      updated: browser.tabs.onUpdated,
    }, {
      handshake: value => record(value) && value.version === 1 && typeof value.status === 'string',
      reset: (message, error) => {
        setState({ ...emptyState(), status: error ? 'error' : 'waiting', message });
        setPlayback(''); setSelected('');
        setPlayMode('single'); setPlayModeOpen(false); setRateOpen(false); setShortcutsOpen(false);
        setCurrentTimeMs(null); setPlaying(false); setRate(1);
        viewRef.current = { videoId: '', session: '', track: '' };
      },
      message: (value, tabId) => {
        if (!record(value)) return;
        if (value.type === 'playback' && typeof value.message === 'string') {
          if (!matchesPlaybackBinding(value, viewRef.current)) return;
          setPlayback(value.message); return;
        }
        if (value.type === 'playback-state' && typeof value.currentTimeMs === 'number') {
          const bound = viewRef.current;
          if (!matchesPlaybackBinding(value, bound)) return;
          setCurrentTimeMs(value.currentTimeMs);
          if (typeof value.playing === 'boolean') setPlaying(value.playing);
          if (typeof value.rate === 'number') setRate(value.rate);
          return;
        }
        const message = value as unknown as State;
        if (message.version !== 1) return;
        const next = { videoId: message.video?.videoId ?? '', session: message.video?.session ?? '', track: message.trackId ?? '' };
        if (viewRef.current.session !== next.session || viewRef.current.track !== next.track || message.status !== 'loaded') {
          setSelected(''); setPlayback('');
          setCurrentTimeMs(null); setPlaying(false); setRate(1);
          setPlayMode('single'); setPlayModeOpen(false); setRateOpen(false); setShortcutsOpen(false);
        }
        viewRef.current = next;
        setState({ ...message, tabId });
      },
    });
    connectionRef.current = controller;
    return () => { controller.dispose(); connectionRef.current = null; };
  }, [connection]);
  const video = state.video;
  const sourceId = sourceChoice.session === video?.session
    && (sourceChoice.id === 'auto' || sourceChoice.id === 'settings' || video?.tracks.some(t => t.id === sourceChoice.id))
    ? sourceChoice.id : 'auto';
  const sourceTrack = sourceId === 'auto' ? preferredTranscriptTrack(video?.tracks ?? [], preferredLanguage)
    : video?.tracks.find(t => t.id === sourceId);
  const busy = state.status === 'loading' || Boolean(video && remotePendingSessions.has(video.session));
  const phraseRows = state.phrases ?? [];
  const rawFallback = displayMode === 'raw' || !phraseRows.length;
  const echoRows = useMemo(() => rawFallback
    ? state.cues.map(cue => ({
        id: `raw:${cue.cueId}`, text: cue.text, startMs: cue.startMs, endMs: cue.endMs, cueId: cue.cueId,
      }))
    : phraseRows.map(phrase => ({ ...phrase, phraseId: phrase.id })), [rawFallback, phraseRows, state.cues]);
  async function loadSupadata(requestedTrack = sourceTrack) {
    if (!video || state.tabId === undefined || busy || remoteBusy.current.has(video.session) || !settingsReady) return;
    remoteBusy.current.add(video.session);
    setRemotePendingSessions(previous => new Set(previous).add(video.session));
    const controller = connectionRef.current;
    const requestId = crypto.randomUUID();
    const binding = { version: 1, requestId, videoId: video.videoId, session: video.session };
    controller?.send({ ...binding, type: 'supadata-begin' });
    try {
      const response: ServiceReply = await browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1,
        type: 'transcript', tabId: state.tabId, videoId: video.videoId,
        ...(requestedTrack ? { language: requestedTrack.language } : {}) });
      controller?.send({ ...binding, type: 'supadata-finish', ...(response.ok
        ? { data: response.data, requestedLanguage: response.requestedLanguage }
        : { error: response.error ?? '服务请求失败' }) });
      if (response.ok) {
        const language = response.requestedLanguage ?? requestedTrack?.language ?? preferredLanguage ?? 'en';
        controller?.send({ ...binding, type: 'timing-load', language });
      }
    } catch { controller?.send({ ...binding, type: 'supadata-finish', error: '扩展后台请求中断，请重新连接；已提交的请求仍可能消耗额度' }); }
    finally {
      remoteBusy.current.delete(video.session);
      setRemotePendingSessions(previous => { const next = new Set(previous); next.delete(video.session); return next; });
    }
  }
  const selectedIndex = echoRows.findIndex(item => item.id === selected);
  const playingIndex = activeTimedRowIndex(echoRows, currentTimeMs);
  const activeIndex = currentTimeMs === null ? selectedIndex : playingIndex;
  const activeId = echoRows[activeIndex]?.id ?? '';
  const navigationIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const previousIndex = navigationIndex < 0 ? -1 : adjacentPlayableRowIndex(echoRows, navigationIndex, -1);
  const nextIndex = adjacentPlayableRowIndex(echoRows, navigationIndex, 1);
  const loadedTrackId = video?.tracks.some(track => track.id === state.trackId) ? state.trackId!
    : video?.tracks.find(track => track.language.toLowerCase() === state.requestedLanguage?.toLowerCase())?.id
    ?? sourceTrack?.id ?? 'loaded';
  useEffect(() => {
    if (!activeId) return;
    const element = document.querySelector<HTMLElement>(`.echo-cue[data-phrase-id="${CSS.escape(activeId)}"]`);
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 52 || bounds.bottom > innerHeight - 52) element.scrollIntoView({ block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [activeId]);
  const activateEchoRow = (index: number) => {
    const item = echoRows[index];
    if (!item || item.startMs === null || item.endMs === null || item.endMs <= item.startMs) return;
    setCurrentTimeMs(null); setSelected(item.id); setPlayback(''); setPlaying(true);
    connectionRef.current?.send({ version: 1, type: 'seek', ...('phraseId' in item ? { phraseId: item.phraseId } : { cueId: item.cueId }),
      playMode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const togglePlayback = () => {
    if (selectedIndex < 0 && activeIndex < 0) activateEchoRow(nextIndex);
    else {
      setPlaying(value => !value);
      connectionRef.current?.send({ version: 1, type: 'playback-toggle', videoId: video?.videoId, session: video?.session, trackId: state.trackId });
    }
  };
  const toggleRecording = async () => {
    if (recorderRef.current?.state === 'recording') {
      setRecording(false);
      try { recorderRef.current.requestData(); recorderRef.current.stop(); }
      catch { stopMediaTracks(recordingStreamRef.current); recordingStreamRef.current = null; recorderRef.current = null; }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPlayback('当前浏览器不支持麦克风录音'); return;
    }
    const generation = ++recordingGenerationRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGenerationRef.current) { stopMediaTracks(stream); return; }
      const mimeType = preferredRecordingType(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStreamRef.current = stream; recorderRef.current = recorder; recordingChunksRef.current = [];
      setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return ''; });
      recorder.ondataavailable = event => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const audio = recordedAudio(recordingChunksRef.current, recorder.mimeType);
        if (generation === recordingGenerationRef.current && audio) {
          const url = URL.createObjectURL(audio);
          setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
        } else if (generation === recordingGenerationRef.current) setPlayback('没有录到可播放的声音');
        stopMediaTracks(stream);
        recordingStreamRef.current = null; recorderRef.current = null; setRecording(false);
      };
      recorder.onerror = () => {
        if (generation === recordingGenerationRef.current) setPlayback('录音设备发生错误，已停止录音');
        stopMediaTracks(stream); recordingStreamRef.current = null; recorderRef.current = null; setRecording(false);
      };
      recorder.start(); setRecording(true);
    } catch { setPlayback('麦克风未授权，未开始录音'); }
  };
  useEffect(() => {
    recordingGenerationRef.current++;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === 'recording') try { recorder.stop(); } catch { /* already stopped */ }
    stopMediaTracks(recordingStreamRef.current); recordingStreamRef.current = null; setRecording(false);
  }, [video?.session]);
  useEffect(() => () => {
    recordingGenerationRef.current++;
    if (recorderRef.current?.state === 'recording') try { recorderRef.current.stop(); } catch { /* already stopped */ }
    stopMediaTracks(recordingStreamRef.current);
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, [recordingUrl]);
  useEffect(() => {
    if (!echoRows.length) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a, audio, video, [contenteditable="true"], [role="button"]')) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      if (event.code === 'ArrowLeft' && previousIndex >= 0) { event.preventDefault(); activateEchoRow(previousIndex); }
      if (event.code === 'ArrowRight' && nextIndex >= 0) { event.preventDefault(); activateEchoRow(nextIndex); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); activateEchoRow(activeIndex >= 0 ? activeIndex
        : selectedIndex >= 0 ? selectedIndex : adjacentPlayableRowIndex(echoRows, -1, 1)); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, selectedIndex, echoRows, previousIndex, nextIndex]);
  useEffect(() => {
    if (!playModeOpen && !rateOpen && !shortcutsOpen) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target instanceof Element
        && event.target.closest('.echo-popover-wrap, .echo-shortcut-wrap')) return;
      setPlayModeOpen(false); setRateOpen(false); setShortcutsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [playModeOpen, rateOpen, shortcutsOpen]);
  useEffect(() => {
    if (!playback) return;
    const timeout = setTimeout(() => setPlayback(''), 4_500);
    return () => clearTimeout(timeout);
  }, [playback]);
  if (phraseRows.length || state.status === 'loaded' && state.cues.length) return <main className="echo-shell">
    <div className="echo-toolbar">
      <label className="echo-select-wrap"><Languages aria-hidden="true"/><select className="echo-filter echo-language" aria-label="字幕语言" value={loadedTrackId} disabled={busy} onChange={event => {
        const track = video?.tracks.find(item => item.id === event.target.value);
        if (!track || !video) return;
        setSourceChoice({ session: video.session, id: track.id });
        setSelected(''); setPlayback('');
        if (video.platform === 'bilibili') connectionRef.current?.send({ version: 1, type: 'bilibili-select', trackId: track.id, videoId: video.videoId, session: video.session });
        else void loadSupadata(track);
      }}>
        {!video?.tracks.some(track => track.id === loadedTrackId) ? <option value="loaded">{languageLabel(state.requestedLanguage ?? state.language)}</option> : null}
        {video?.tracks.map(track => <option key={track.id} value={track.id}>{video.platform === 'bilibili' ? track.name : languageLabel(track.language)}{track.kind === 'asr' ? ' (Auto)' : ''}</option>)}
      </select><ChevronDown className="echo-chevron" aria-hidden="true"/></label>
       <label className="echo-select-wrap"><Languages aria-hidden="true"/><select className="echo-filter echo-mode" aria-label="字幕显示" value={rawFallback ? 'raw' : 'phrases'} onChange={event => {
        setDisplayMode(event.target.value as 'phrases' | 'raw'); setSelected(''); setPlayback('');
      }}><option value="phrases">Subtitles</option><option value="raw">Raw captions</option></select><ChevronDown className="echo-chevron" aria-hidden="true"/></label>
       <button className={`echo-icon echo-shortcut-wrap ${shortcutsOpen ? 'active' : ''}`} aria-label="键盘快捷键" title="键盘快捷键"
         aria-expanded={shortcutsOpen} aria-controls="echo-shortcuts" onClick={() => { setShortcutsOpen(value => !value); setPlayModeOpen(false); setRateOpen(false); }}><Keyboard /></button>
      <button className="echo-icon echo-menu" aria-label="API 设置" title="API 设置" onClick={() => void browser.runtime.openOptionsPage()}><MoreVertical /></button>
    </div>
    {shortcutsOpen ? <div id="echo-shortcuts" className="echo-shortcuts" role="dialog" aria-label="键盘快捷键"><span><kbd>Space</kbd> 播放/暂停</span><span><kbd>←</kbd><kbd>→</kbd> 上一句/下一句</span><span><kbd>R</kbd> 重播</span></div> : null}
    {playback ? <div className="echo-toast" role="status">{playback}</div> : null}
    {!phraseRows.length && state.timingMessage ? <div className="echo-notice" role="status">{state.timingMessage}</div> : null}
    <ol className="echo-list" aria-label="独立时间语段" onClick={event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row-index]') : null;
      const index = Number(target?.dataset.rowIndex);
      if (Number.isInteger(index)) activateEchoRow(index);
    }}>
      {echoRows.map((item, index) => <EchoCueRow key={item.id} item={item as EchoRow} index={index} active={activeId === item.id}/>)}
    </ol>
    {recordingUrl ? <div className="echo-recording"><audio src={recordingUrl} controls aria-label="本次跟读录音"/><button onClick={() => setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return ''; })}>关闭</button></div> : null}
    <div className="echo-player" aria-label="字幕播放控制">
      <button aria-label="上一句" disabled={previousIndex < 0} onClick={() => activateEchoRow(previousIndex)}><SkipBack /></button>
      <button className="echo-play" aria-label={playing ? '暂停' : '播放'} onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</button>
      <button aria-label="下一句" disabled={nextIndex < 0} onClick={() => activateEchoRow(nextIndex)}><SkipForward /></button>
      <div className="echo-popover-wrap">
        <button aria-label="播放模式" aria-haspopup="menu" aria-expanded={playModeOpen} aria-controls="echo-mode-menu"
          title={playMode === 'single' ? '单句播放' : playMode === 'loop' ? '单句循环' : '连续播放'} onClick={() => { setPlayModeOpen(value => !value); setRateOpen(false); setShortcutsOpen(false); }}>
          {playMode === 'single' ? <Repeat /> : playMode === 'loop' ? <Repeat1 /> : <ListRestart />}
        </button>
        {playModeOpen ? <div id="echo-mode-menu" className="echo-popover echo-mode-menu" role="menu">
          {([['single', '单句播放'], ['loop', '单句循环'], ['all', '连续播放']] as const).map(([mode, label]) => <button key={mode} role="menuitemradio" aria-checked={playMode === mode} className={playMode === mode ? 'selected' : ''} onClick={() => {
            setPlayMode(mode); setPlayModeOpen(false);
            connectionRef.current?.send({ version: 1, type: 'playback-mode', mode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
          }}>{label}</button>)}
        </div> : null}
      </div>
      <div className="echo-popover-wrap echo-rate-wrap">
        <button className="echo-rate" aria-label="播放速度" aria-haspopup="menu" aria-expanded={rateOpen} aria-controls="echo-rate-menu"
          onClick={() => { setRateOpen(value => !value); setPlayModeOpen(false); setShortcutsOpen(false); }}>{rate}x</button>
        {rateOpen ? <div id="echo-rate-menu" className="echo-popover echo-rate-menu" role="menu">
          {PLAYBACK_RATES.map(value => <button key={value} role="menuitemradio" aria-checked={rate === value} className={rate === value ? 'selected' : ''} onClick={() => {
            setRate(value); setRateOpen(false);
            connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: value, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
          }}>{value}x</button>)}
        </div> : null}
      </div>
      <button className={`echo-mic ${recording ? 'recording' : ''}`} aria-label={recording ? '停止跟读录音' : '开始跟读录音'} title={recording ? '停止录音' : '跟读录音'} onClick={() => void toggleRecording()}>{recording ? <Square /> : <Mic />}</button>
    </div>
  </main>;
  return <main className="echo-shell echo-empty-shell">
    <div className="echo-toolbar echo-empty-toolbar">
      <span className="echo-brand">Language Helper</span>
      <span/>
      <button className="echo-icon echo-menu" aria-label="API 设置" title="API 设置" onClick={() => void browser.runtime.openOptionsPage()}><MoreVertical /></button>
    </div>
    <section className="echo-empty" aria-busy={busy}>
      <div className={`echo-state-icon ${busy ? 'loading' : state.status === 'error' ? 'failed' : ''}`} aria-hidden="true">
        {busy ? '' : video?.platform === 'bilibili' ? 'B' : 'Y'}
      </div>
      <h1>{video?.title ?? '打开一个视频'}</h1>
      <p role="status" className={state.status === 'error' ? 'echo-state-message failed' : 'echo-state-message'}>{state.message}</p>
      {video?.platform !== 'bilibili' && video ? <div className="echo-load-controls">
        <label htmlFor="transcript-source">字幕语言</label>
        <select id="transcript-source" value={sourceId} disabled={busy || !settingsReady} onChange={event => {
          setSourceChoice({ session: video.session, id: event.target.value });
        }}>
          <option value="auto">自动选择</option>
          <option value="settings">API 设置语言 · {preferredLanguage ?? '默认'}</option>
          {video.tracks.map(track => <option key={track.id} value={track.id}>{languageLabel(track.language)}{track.kind === 'asr' ? ' · Auto' : ''}</option>)}
        </select>
        <button className="echo-primary" disabled={busy || !settingsReady} onClick={() => void loadSupadata()}>
          {busy ? '正在读取…' : '读取字幕'}
        </button>
        <span className="echo-cost">Supadata · 手动调用一次</span>
      </div> : null}
      {video?.platform === 'bilibili' && state.status === 'error' ? <button className="echo-primary" disabled={busy}
        onClick={() => connectionRef.current?.send({ version: 1, type: 'refresh' })}>重新读取</button> : null}
      {!video || state.status === 'error' ? <button className="echo-link" disabled={busy} onClick={() => setConnection(value => value + 1)}>重新连接</button> : null}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
