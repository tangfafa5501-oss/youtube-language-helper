import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, ChevronDown, CircleHelp, Keyboard, Languages, ListRestart, Mic, MoreVertical, Pause, Play, RefreshCw, Repeat, Repeat1, Settings, SkipBack, SkipForward, Square, X } from 'lucide-react';
import { adjacentPlaybackRate, PLAYER_SHORTCUTS, PLAYBACK_RATES, PORT, emptyState, type State } from '../../lib/protocol';
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

const SHORTCUT_SECTIONS = [
  { title: '通用控制', items: [
    ['?', '显示键盘快捷键'], ['Space / K', '播放/暂停'], ['Shift + < / >', '减速/加速'],
    ['E', '切换跟读模式'], ['H', '切换听写模式'], ['A', '上一行'], ['S', '重播当前行'], ['D', '下一行'],
  ] },
  { title: '跟读模式控制', items: [
    ['R', '开始/停止录音'], ['G', '播放录音'], ['Esc', '取消并删除本次录音'],
  ] },
] as const;

const GUIDE_STEPS = [
  ['选择字幕', '顶部第一个菜单切换网站已有语言或双语轨；YouTube 重新获取会明确使用一次 Supadata 调用。'],
  ['选择语段', '点击任一时间条即可精确定位并按当前播放模式开始。A/S/D 对应上一行、重播和下一行。'],
  ['跟读模式', '按 E 或底部书本按钮切换。开启时播放当前语段一次后暂停；关闭时连续播放。'],
  ['听写模式', '按 H 隐藏字幕正文；悬停或键盘聚焦当前行时临时显示。'],
  ['本地录音', '按 R 开始或停止，G 播放本次录音，Esc 取消并删除。录音不上传，也不做语音评分。'],
] as const;

const EchoCueRow = React.memo(function EchoCueRow({ item, active, index, dictation }: { item: EchoRow; active: boolean; index: number; dictation: boolean }) {
  const playable = item.startMs !== null && item.endMs !== null && item.endMs > item.startMs;
  return <li><button data-phrase-id={item.id} data-row-index={index} className={`echo-cue ${active ? 'selected' : ''}`}
    title={`${timestamp(item.startMs)} → ${timestamp(item.endMs)}`} disabled={!playable} aria-current={active ? 'true' : undefined}>
    <span className="echo-time">{compactTimestamp(item.startMs)}</span>
    <span className={`echo-text ${dictation ? 'dictation-hidden' : ''}`} aria-label={dictation ? '字幕已隐藏，悬停或聚焦当前行可显示' : undefined}>{item.text || '（空文本条目）'}</span>
  </button></li>;
});

function App() {
  const [state, setState] = useState<State>(emptyState);
  const [playback, setPlayback] = useState('');
  const [selected, setSelected] = useState('');
  const [connection, setConnection] = useState(0);
  const [displayMode, setDisplayMode] = useState<'phrases' | 'raw'>('phrases');
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(null);
  const [hasSupadataKey, setHasSupadataKey] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [sourceChoice, setSourceChoice] = useState({ session: '', id: 'auto' });
  const remoteBusy = useRef(new Set<string>());
  const [remotePendingSessions, setRemotePendingSessions] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [playMode, setPlayMode] = useState<'single' | 'loop' | 'all'>('single');
  const [playModeOpen, setPlayModeOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [dictationMode, setDictationMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');
  const recordingUrlRef = useRef('');
  const recordingAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingGenerationRef = useRef(0);
  const autoRequestedSessionRef = useRef('');
  const connectionRef = useRef<ReturnType<typeof connectPanel> | null>(null);
  const viewRef = useRef({ videoId: '', session: '', track: '' });
  useEffect(() => {
    let active = true;
    void browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1, type: 'settings' })
      .then((r: ServiceReply) => {
        if (!active || !r.ok || !r.settings) return;
        setPreferredLanguage(r.settings.language); setHasSupadataKey(Boolean(r.settings.hasKey));
      })
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
        setPlayMode('single'); setPlayModeOpen(false); setRateOpen(false); setMoreOpen(false); setShortcutsOpen(false); setGuideOpen(false); setDictationMode(false);
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
          setPlayMode('single'); setPlayModeOpen(false); setRateOpen(false); setMoreOpen(false); setShortcutsOpen(false); setGuideOpen(false); setDictationMode(false);
        }
        viewRef.current = next;
        setState({ ...message, tabId });
      },
    });
    connectionRef.current = controller;
    return () => { controller.dispose(); connectionRef.current = null; };
  }, [connection]);
  const video = state.video;
  // YouTube states from builds before platform tagging remain valid. Bilibili
  // has always identified itself explicitly, so the only safe fallback is YouTube.
  const isBilibili = video?.platform === 'bilibili';
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
  useEffect(() => {
    if (!settingsReady || !hasSupadataKey || !video || isBilibili || state.status !== 'ready') return;
    if (autoRequestedSessionRef.current === video.session) return;
    autoRequestedSessionRef.current = video.session;
    void loadSupadata();
  }, [settingsReady, hasSupadataKey, video?.session, isBilibili, state.status, sourceTrack?.id]);
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
  const replaceRecordingUrl = (next: string) => {
    const previous = recordingUrlRef.current;
    if (previous && previous !== next) URL.revokeObjectURL(previous);
    recordingUrlRef.current = next;
    setRecordingUrl(next);
  };
  const cancelRecording = (message = '') => {
    recordingGenerationRef.current++;
    const recorder = recorderRef.current;
    const stream = recordingStreamRef.current;
    recorderRef.current = null; recordingStreamRef.current = null; recordingChunksRef.current = [];
    if (recorder?.state === 'recording') try { recorder.stop(); } catch { /* already stopped */ }
    stopMediaTracks(stream); setRecording(false); replaceRecordingUrl('');
    if (message) setPlayback(message);
  };
  const playRecording = () => {
    const audio = recordingAudioRef.current;
    if (!audio || !recordingUrlRef.current) { setPlayback('还没有可播放的跟读录音'); return; }
    audio.currentTime = 0;
    void audio.play().catch(() => setPlayback('录音播放未能开始'));
  };
  const changeRate = (direction: -1 | 1) => {
    const next = adjacentPlaybackRate(rate, direction);
    if (next === rate) return;
    setRate(next);
    connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: next,
      videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const toggleEchoMode = () => {
    const mode = playMode === 'all' ? 'single' : 'all';
    setPlayMode(mode);
    connectionRef.current?.send({ version: 1, type: 'playback-mode', mode,
      videoId: video?.videoId, session: video?.session, trackId: state.trackId });
    setPlayback(mode === 'single' ? '跟读模式已开启 - 视频播放一次后暂停，点击播放重播 (E)' : '跟读模式已关闭 - 视频连续播放 (E)');
  };
  const toggleDictationMode = () => {
    setDictationMode(current => {
      const next = !current;
      setPlayback(next ? '听写模式已开启 - 字幕文本隐藏，悬停当前行可显示 (H)' : '听写模式已关闭 - 字幕文本可见 (H)');
      return next;
    });
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
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGenerationRef.current) { stopMediaTracks(stream); return; }
      const mimeType = preferredRecordingType(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStreamRef.current = stream; recorderRef.current = recorder; recordingChunksRef.current = [];
      replaceRecordingUrl('');
      recorder.ondataavailable = event => {
        if (generation === recordingGenerationRef.current && recorderRef.current === recorder && event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const owned = generation === recordingGenerationRef.current && recorderRef.current === recorder;
        const audio = owned ? recordedAudio(recordingChunksRef.current, recorder.mimeType) : null;
        if (owned && audio) {
          const url = URL.createObjectURL(audio);
          replaceRecordingUrl(url);
        } else if (owned) setPlayback('没有录到可播放的声音');
        stopMediaTracks(stream);
        if (recordingStreamRef.current === stream) recordingStreamRef.current = null;
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (owned) { recordingChunksRef.current = []; setRecording(false); }
      };
      recorder.onerror = () => {
        const owned = generation === recordingGenerationRef.current && recorderRef.current === recorder;
        if (owned) {
          recordingGenerationRef.current++;
          recordingStreamRef.current = null; recorderRef.current = null; recordingChunksRef.current = [];
          setPlayback('录音设备发生错误，已停止录音'); setRecording(false);
        }
        stopMediaTracks(stream);
      };
      recorder.start(); setRecording(true);
    } catch {
      stopMediaTracks(stream);
      if (generation === recordingGenerationRef.current) {
        if (recordingStreamRef.current === stream) recordingStreamRef.current = null;
        recorderRef.current = null; recordingChunksRef.current = []; setRecording(false);
        setPlayback('麦克风未授权或无法启动录音');
      }
    }
  };
  useEffect(() => {
    recordingGenerationRef.current++;
    const recorder = recorderRef.current;
    const stream = recordingStreamRef.current;
    recorderRef.current = null; recordingStreamRef.current = null; recordingChunksRef.current = [];
    if (recorder?.state === 'recording') try { recorder.stop(); } catch { /* already stopped */ }
    stopMediaTracks(stream); setRecording(false); replaceRecordingUrl('');
  }, [video?.session]);
  useEffect(() => () => {
    recordingGenerationRef.current++;
    const recorder = recorderRef.current;
    const stream = recordingStreamRef.current;
    recorderRef.current = null; recordingStreamRef.current = null; recordingChunksRef.current = [];
    if (recorder?.state === 'recording') try { recorder.stop(); } catch { /* already stopped */ }
    stopMediaTracks(stream);
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = '';
  }, []);
  useEffect(() => {
    if (!echoRows.length) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, select, textarea, audio, video, [contenteditable="true"]')) return;
      // Letter shortcuts must keep working after a cue or player button receives
      // focus. Space toggles playback on cue rows, while toolbar/menu controls
      // keep their native activation key.
      if (event.code === 'Space' && target?.closest('button, a, [role="button"]') && !target.closest('.echo-cue')) return;
      if (event.code === 'Escape' && (recording || recordingUrlRef.current)) { event.preventDefault(); cancelRecording('已取消跟读录音'); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === PLAYER_SHORTCUTS.playOrPause || event.code === 'KeyK') { event.preventDefault(); togglePlayback(); return; }
      if (event.shiftKey && event.code === PLAYER_SHORTCUTS.decreaseRate) { event.preventDefault(); changeRate(-1); return; }
      if (event.shiftKey && event.code === PLAYER_SHORTCUTS.increaseRate) { event.preventDefault(); changeRate(1); return; }
      if ((event.code === PLAYER_SHORTCUTS.previous || event.code === 'ArrowLeft') && previousIndex >= 0) { event.preventDefault(); activateEchoRow(previousIndex); return; }
      if ((event.code === PLAYER_SHORTCUTS.next || event.code === 'ArrowRight') && nextIndex >= 0) { event.preventDefault(); activateEchoRow(nextIndex); return; }
      if (event.code === PLAYER_SHORTCUTS.replay) {
        event.preventDefault(); activateEchoRow(activeIndex >= 0 ? activeIndex : selectedIndex >= 0 ? selectedIndex : adjacentPlayableRowIndex(echoRows, -1, 1)); return;
      }
      if (event.code === PLAYER_SHORTCUTS.toggleEcho) { event.preventDefault(); toggleEchoMode(); return; }
      if (event.code === PLAYER_SHORTCUTS.toggleDictation) { event.preventDefault(); toggleDictationMode(); return; }
      if (event.code === PLAYER_SHORTCUTS.record) { event.preventDefault(); void toggleRecording(); return; }
      if (event.code === PLAYER_SHORTCUTS.playRecording) { event.preventDefault(); playRecording(); return; }
      if (event.key === '?') {
        event.preventDefault(); setShortcutsOpen(value => !value); setMoreOpen(false); setPlayModeOpen(false); setRateOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, selectedIndex, echoRows, previousIndex, nextIndex, rate, playMode, recording]);
  useEffect(() => {
    if (!playModeOpen && !rateOpen && !moreOpen && !shortcutsOpen && !guideOpen) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target instanceof Element
        && event.target.closest('.echo-popover-wrap, .echo-shortcut-wrap, .echo-more-wrap, .echo-modal-card')) return;
      setPlayModeOpen(false); setRateOpen(false); setMoreOpen(false); setShortcutsOpen(false); setGuideOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [playModeOpen, rateOpen, moreOpen, shortcutsOpen, guideOpen]);
  useEffect(() => {
    if (!playback) return;
    const timeout = setTimeout(() => setPlayback(''), 4_500);
    return () => clearTimeout(timeout);
  }, [playback]);
  if (phraseRows.length || state.status === 'loaded' && state.cues.length) return <main className={`echo-shell ${dictationMode ? 'dictation-mode' : ''}`}>
    <div className="echo-toolbar">
      <label className="echo-select-wrap"><Languages aria-hidden="true"/><select className="echo-filter echo-language" aria-label="字幕语言" value={loadedTrackId} disabled={busy} onChange={event => {
        const track = video?.tracks.find(item => item.id === event.target.value);
        if (!track || !video) return;
        setSourceChoice({ session: video.session, id: track.id });
        setSelected(''); setPlayback('');
        if (isBilibili) connectionRef.current?.send({ version: 1, type: 'bilibili-select', trackId: track.id, videoId: video.videoId, session: video.session });
        else void loadSupadata(track);
      }}>
        {!video?.tracks.some(track => track.id === loadedTrackId) ? <option value="loaded">{languageLabel(state.requestedLanguage ?? state.language)}</option> : null}
        {video?.tracks.map(track => <option key={track.id} value={track.id}>{isBilibili ? track.name : languageLabel(track.language)}{track.kind === 'asr' ? ' (Auto)' : ''}</option>)}
      </select><ChevronDown className="echo-chevron" aria-hidden="true"/></label>
       <label className="echo-select-wrap"><Languages aria-hidden="true"/><select className="echo-filter echo-mode" aria-label="字幕显示" value={rawFallback ? 'raw' : 'phrases'} onChange={event => {
        setDisplayMode(event.target.value as 'phrases' | 'raw'); setSelected(''); setPlayback('');
      }}><option value="phrases">Subtitles</option><option value="raw">Raw captions</option></select><ChevronDown className="echo-chevron" aria-hidden="true"/></label>
      <span className="echo-toolbar-spacer" aria-hidden="true"/>
       <button className={`echo-icon echo-shortcut-wrap ${shortcutsOpen ? 'active' : ''}`} aria-label="键盘快捷键" title="键盘快捷键"
         aria-expanded={shortcutsOpen} aria-controls="echo-shortcuts" onClick={() => { setShortcutsOpen(value => !value); setMoreOpen(false); setPlayModeOpen(false); setRateOpen(false); }}><Keyboard /></button>
      <div className="echo-more-wrap">
        <button className={`echo-icon echo-menu ${moreOpen ? 'active' : ''}`} aria-label="更多选项" title="更多选项" aria-haspopup="menu"
          aria-expanded={moreOpen} aria-controls="echo-more-menu" onClick={() => { setMoreOpen(value => !value); setShortcutsOpen(false); setPlayModeOpen(false); setRateOpen(false); }}><MoreVertical /></button>
        {moreOpen ? <div id="echo-more-menu" className="echo-more-menu" role="menu">
          <button role="menuitem" disabled={busy} onClick={() => {
            setMoreOpen(false);
            if (isBilibili) connectionRef.current?.send({ version: 1, type: 'refresh' });
            else void loadSupadata();
          }}><RefreshCw/><span>重新获取字幕</span></button>
          <button role="menuitem" onClick={() => { setMoreOpen(false); setGuideOpen(true); }}><CircleHelp/><span>显示引导</span></button>
          <button role="menuitem" onClick={() => { setMoreOpen(false); void browser.runtime.openOptionsPage(); }}><Settings/><span>设置</span></button>
        </div> : null}
      </div>
    </div>
    {shortcutsOpen ? <div className="echo-modal" role="presentation"><section id="echo-shortcuts" className="echo-modal-card echo-shortcut-card" role="dialog" aria-modal="true" aria-labelledby="echo-shortcuts-title">
      <header className="echo-modal-header"><h1 id="echo-shortcuts-title">键盘快捷键</h1><button aria-label="关闭键盘快捷键" onClick={() => setShortcutsOpen(false)}><X/></button></header>
      <p>在视频页面和侧边栏均可使用。页面原生快捷键也会同时生效。</p>
      {SHORTCUT_SECTIONS.map(section => <section className="echo-shortcut-section" key={section.title}><h2>{section.title}</h2>
        <dl>{section.items.map(([keys, label]) => <div key={keys}><dt>{keys.split(' / ').map((key, index) => <React.Fragment key={key}>{index ? <span> / </span> : null}<kbd>{key}</kbd></React.Fragment>)}</dt><dd>{label}</dd></div>)}</dl>
      </section>)}
    </section></div> : null}
    {guideOpen ? <div className="echo-modal" role="presentation"><section className="echo-modal-card echo-guide-card" role="dialog" aria-modal="true" aria-labelledby="echo-guide-title">
      <header className="echo-modal-header"><h1 id="echo-guide-title">使用引导</h1><button aria-label="关闭使用引导" onClick={() => setGuideOpen(false)}><X/></button></header>
      <ol>{GUIDE_STEPS.map(([title, detail], index) => <li key={title}><span>{index + 1}</span><div><h2>{title}</h2><p>{detail}</p></div></li>)}</ol>
      <button className="echo-guide-done" onClick={() => setGuideOpen(false)}>开始使用</button>
    </section></div> : null}
    {playback ? <div className="echo-toast" role="status">{playback}</div> : null}
    {!phraseRows.length && state.timingMessage ? <div className="echo-notice" role="status">{state.timingMessage}</div> : null}
    <ol className="echo-list" aria-label="独立时间语段" onClick={event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row-index]') : null;
      const index = Number(target?.dataset.rowIndex);
      if (Number.isInteger(index)) activateEchoRow(index);
    }}>
      {echoRows.map((item, index) => <EchoCueRow key={item.id} item={item as EchoRow} index={index} active={activeId === item.id} dictation={dictationMode}/>)}
    </ol>
    {recordingUrl ? <div className="echo-recording"><audio ref={recordingAudioRef} src={recordingUrl} controls aria-label="本次跟读录音"/><button onClick={() => replaceRecordingUrl('')}>关闭</button></div> : null}
    <div className="echo-player" aria-label="字幕播放控制">
      <button aria-label="上一行" title="上一行 (A)" disabled={previousIndex < 0} onClick={() => activateEchoRow(previousIndex)}><SkipBack /></button>
      <button className="echo-play" aria-label={playing ? '暂停' : '播放'} title="播放/暂停 (Space/K)" onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</button>
      <button aria-label="下一行" title="下一行 (D)" disabled={nextIndex < 0} onClick={() => activateEchoRow(nextIndex)}><SkipForward /></button>
      <div className="echo-popover-wrap">
        <button aria-label="播放模式" aria-haspopup="menu" aria-expanded={playModeOpen} aria-controls="echo-mode-menu"
          title={playMode === 'single' ? '单句播放' : playMode === 'loop' ? '单句循环' : '连续播放'} onClick={() => { setPlayModeOpen(value => !value); setRateOpen(false); setMoreOpen(false); setShortcutsOpen(false); }}>
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
          onClick={() => { setRateOpen(value => !value); setPlayModeOpen(false); setMoreOpen(false); setShortcutsOpen(false); }}>{rate}x</button>
        {rateOpen ? <div id="echo-rate-menu" className="echo-popover echo-rate-menu" role="menu">
          {PLAYBACK_RATES.map(value => <button key={value} role="menuitemradio" aria-checked={rate === value} className={rate === value ? 'selected' : ''} onClick={() => {
            setRate(value); setRateOpen(false);
            connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: value, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
          }}>{value}x</button>)}
        </div> : null}
      </div>
      <button className={`echo-study ${playMode !== 'all' ? 'active' : ''}`} aria-label="切换跟读模式" aria-pressed={playMode !== 'all'} title="切换跟读模式 (E)" onClick={toggleEchoMode}><BookOpen/></button>
      <button className={`echo-mic ${recording ? 'recording' : ''}`} aria-label={recording ? '停止跟读录音' : '开始跟读录音'} title={recording ? '停止录音' : '跟读录音'} onClick={() => void toggleRecording()}>{recording ? <Square /> : <Mic />}</button>
    </div>
  </main>;
  const fetching = busy || !settingsReady || Boolean(video && !isBilibili && hasSupadataKey && state.status === 'ready');
  return <main className="echo-shell echo-empty-shell">
    {video ? <div className="echo-connected" role="status"><span aria-hidden="true">✓</span>视频已连接</div> : null}
    <section className="echo-empty" aria-busy={fetching}>
      {fetching && video ? <div className="echo-load-card">
        <div className="echo-load-spinner" aria-hidden="true"/>
        <h1>正在获取字幕</h1>
        <p>正在分析视频：<code>{video.videoId}</code></p>
        <div className="echo-progress" aria-label="字幕获取进行中"><span/></div>
        <small>这可能需要一些时间…</small>
      </div> : !video ? <div className="echo-load-card echo-message-card">
        <div className="echo-state-icon" aria-hidden="true">V</div><h1>打开一个视频</h1><p>{state.message}</p>
        <button className="echo-link" onClick={() => setConnection(value => value + 1)}>重新连接</button>
      </div> : !isBilibili && !hasSupadataKey ? <div className="echo-load-card echo-message-card">
        <div className="echo-state-icon" aria-hidden="true">Y</div><h1>设置字幕服务</h1>
        <p>保存 Supadata Key 后，每个新视频会话自动读取一次字幕。</p>
        <button className="echo-primary" onClick={() => void browser.runtime.openOptionsPage()}>打开设置</button>
      </div> : state.status === 'error' ? <div className="echo-load-card echo-message-card failed">
        <div className="echo-state-icon failed" aria-hidden="true">!</div><h1>字幕获取失败</h1><p role="alert">{state.message}</p>
        <button className="echo-primary" onClick={() => {
          if (isBilibili) connectionRef.current?.send({ version: 1, type: 'refresh' });
          else { autoRequestedSessionRef.current = ''; void loadSupadata(); }
        }}>重新获取字幕</button>
      </div> : <div className="echo-load-card">
        <div className="echo-load-spinner" aria-hidden="true"/><h1>正在准备字幕</h1><p>{state.message}</p>
      </div>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
