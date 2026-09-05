import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import * as Slider from '@radix-ui/react-slider';
import { BookOpen, Check, ChevronDown, CircleHelp, Ear, Keyboard, Languages, Mic, MoreVertical,
  ArrowUp, ArrowDown, Minus, Plus, Pause, Play, RefreshCw, Settings, SkipBack, SkipForward, X } from '../../components/icons';
import { SettingsView } from '../../components/settings-view';
import { HoverHint } from '../../components/hover-hint';
import { useCueFollow } from '../../components/use-cue-follow';
import { useGuidedTours } from '../../components/use-guided-tours';
import { adjacentPlaybackRate, PLAYBACK_RATES, PORT, emptyState, type PlayMode, type State, type Track } from '../../lib/protocol';
import { connectPanel } from '../../lib/panel-connection';
import { record } from '../../lib/captions';
import { SERVICE_CHANNEL, type PublicSettings, type ServiceReply } from '../../lib/settings';
import { preferredTranscriptTrack } from '../../lib/transcript-selection';
import { activeTimedRowIndex, adjacentPlayableRowIndex, matchesPlaybackBinding } from '../../lib/playback-view';
import { secondaryTextForRange } from '../../lib/subtitle-lanes';
import { applyTheme } from '../../lib/theme';
import { isShortcutAction, shortcutAction, type ShortcutAction } from '../../lib/shortcuts';
import { createPracticeClient } from '../../lib/practice-client';
import { livePracticeKey, type PracticeSegment } from '../../lib/practice';
import type { ExerciseHandle } from '../../components/shadowing-exercise-card';
import './style.css';
const ShadowingExerciseCard = lazy(() => import('../../components/shadowing-exercise-card'));

const defaultSettings: PublicSettings = { language: 'en', theme: 'system', displayMode: 'phrases' };

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
  if (code === 'en-gb') return 'British English';
  if (code === 'en-us') return 'American English';
  if (code?.startsWith('en')) return 'English';
  if (code?.startsWith('zh') || code?.startsWith('ai-zh')) return '中文';
  return language || 'Original';
}

function trackLabel(track: Track, isBilibili: boolean) {
  return `${isBilibili ? track.name : languageLabel(track.language)}${track.kind === 'asr' ? ' (Auto)' : ''}`;
}

type EchoRow = { id: string; text: string; secondaryText: string; startMs: number | null; endMs: number | null; phraseId?: string; cueId?: string };

const SHORTCUT_SECTIONS = [
  { title: '通用控制', items: [
    ['?', '显示键盘快捷键'], ['Space', '暂停/继续（继续时自动播放）'], ['Shift + < / >', '减速/加速'],
    ['E', '切换逐句跟读'], ['F', '切换麦克风跟读模式'], ['A', '上一句'], ['S', '重播当前句'], ['D', '下一句'],
  ] },
  { title: '跟读模式控制', items: [
    ['R', '开始/停止录音'], ['G', '播放录音'], ['V', '评估发音/查看评分'], ['Esc', '取消录音'],
    ['P', '切换音高曲线'], ['[ / ]', '扩展片段'], ['Shift + [ / ]', '收缩片段'],
  ] },
  { title: '听写模式控制', items: [
    ['H', '切换听写模式'], ['/', '聚焦听写输入框'], ['Enter', '检查答案'], ['Shift + Enter', '换行'], ['Esc', '取消输入'],
  ] },
] as const;

function TrackSelect({ label, value, disabled, placeholder, tracks, isBilibili, onChange }: { label: string; value: string;
  disabled?: boolean; placeholder: string; tracks: readonly Track[]; isBilibili: boolean; onChange: (value: string) => void }) {
  return <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
    <Select.Trigger className="echo-track-trigger" aria-label={label} title={label}>
      <Languages/><Select.Value placeholder={placeholder}/><Select.Icon><ChevronDown/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="echo-select-content" position="popper" sideOffset={6} align="start">
      <Select.Viewport>{tracks.map(track => <Select.Item className="echo-select-item" value={track.id} key={track.id}>
        <Select.ItemText>{trackLabel(track, isBilibili)}</Select.ItemText><Select.ItemIndicator><Check/></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

const EchoCueRow = React.memo(function EchoCueRow({ item, active, index, onActivate, hidden, children }: { item: EchoRow; active: boolean; index: number; onActivate: (index: number) => void; hidden: boolean; children?: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const obscure = hidden && !revealed;
  const playable = item.startMs !== null && item.endMs !== null && item.endMs > item.startMs;
  return <li><button data-phrase-id={item.id} data-row-index={index} data-tour={active ? 'active-cue' : undefined} className={`echo-cue ${active ? 'selected' : ''}`}
    title={`${timestamp(item.startMs)} → ${timestamp(item.endMs)}`} disabled={!playable} aria-current={active ? 'true' : undefined}
    onClick={() => onActivate(index)}>
    <span className="echo-time">{compactTimestamp(item.startMs)}</span>
    <span className={`echo-text ${obscure ? 'dictation-hidden' : ''}`} aria-hidden={obscure}>{item.text || '（空文本条目）'}</span>
    {item.secondaryText ? <span className={`echo-secondary-text ${obscure ? 'dictation-hidden' : ''}`} aria-hidden={obscure}>{item.secondaryText}</span> : null}
  </button>{hidden && <button className="echo-reveal" onMouseEnter={() => setRevealed(true)} onMouseLeave={() => setRevealed(false)} onFocus={() => setRevealed(true)} onBlur={() => setRevealed(false)} aria-label="临时显示字幕">查看字幕</button>}{children}</li>;
});

function ShortcutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="echo-dialog-overlay"/>
    <Dialog.Content className="echo-dialog-content echo-shortcut-card" aria-describedby="shortcut-description">
      <div className="echo-dialog-header"><Dialog.Title>键盘快捷键</Dialog.Title><Dialog.Close aria-label="关闭"><X/></Dialog.Close></div>
      <Dialog.Description id="shortcut-description">Space 暂停/恢复自动播放；F 开关麦克风跟读，S 重播当前片段。输入框或弹窗内保留原有键盘操作。扩展连接时 F 用于跟读，不再触发网站全屏。</Dialog.Description>
      {SHORTCUT_SECTIONS.map(section => <section className="echo-shortcut-section" key={section.title}><h2>{section.title}</h2><dl>
        {section.items.map(([keys, description]) => <div key={`${keys}-${description}`}><dt>{keys.split(' / ').map((key, index) => <React.Fragment key={key}>{index ? ' / ' : ''}<kbd>{key}</kbd></React.Fragment>)}</dt><dd>{description}</dd></div>)}
      </dl></section>)}
      <Dialog.Close className="echo-dialog-done">关闭</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function App() {
  const [state, setState] = useState<State>(emptyState);
  const [settings, setSettings] = useState<PublicSettings>(defaultSettings);
  const [view, setView] = useState<'reader' | 'settings'>('reader');
  const [playback, setPlayback] = useState('');
  const [selected, setSelected] = useState('');
  const [connection, setConnection] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [playMode, setPlayMode] = useState<PlayMode>('auto');
  useEffect(() => { if (!playback) return; const timer = setTimeout(() => setPlayback(''), 3500); return () => clearTimeout(timer); }, [playback]);
  const [dictation, setDictation] = useState(false);
  const [practiceEnd, setPracticeEnd] = useState('');
  const exerciseRef = useRef<ExerciseHandle>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const autoRequestedSessionRef = useRef('');
  const desiredSecondaryRef = useRef<string | null>(null);
  const connectionRef = useRef<ReturnType<typeof connectPanel> | null>(null);
  const practiceClientRef = useRef<ReturnType<typeof createPracticeClient> | null>(null);
  if (!practiceClientRef.current) practiceClientRef.current = createPracticeClient(message => connectionRef.current?.send(message));
  const viewRef = useRef({ videoId: '', session: '', track: '' });
  const phraseRowsRef = useRef<NonNullable<State['phrases']>>([]);
  const shortcutHandlerRef = useRef<(action: ShortcutAction, repeat?: boolean) => boolean>(() => false);

  useEffect(() => {
    let active = true;
    void browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1, type: 'settings' }).then((reply: ServiceReply) => {
      if (!active || !reply.ok || !reply.settings) return;
      setSettings(reply.settings); applyTheme(reply.settings.theme);
    }).catch(() => { /* Loading state will expose the settings route. */ });
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
        practiceClientRef.current?.reset(); setDictation(false); setPracticeEnd('');
        setState({ ...emptyState(), status: error ? 'error' : 'waiting', message }); setPlayback(''); setSelected('');
        setCurrentTimeMs(null); setPlaying(false); setRate(1); setPlayMode('auto');
        autoRequestedSessionRef.current = ''; desiredSecondaryRef.current = null;
        viewRef.current = { videoId: '', session: '', track: '' };
      },
      message: (value, tabId) => {
        if (!record(value)) return;
        if (practiceClientRef.current?.receive(value)) return;
        if (value.type === 'bilibili-shortcut' || value.type === 'player-shortcut') {
          if (matchesPlaybackBinding(value, viewRef.current) && isShortcutAction(value.action)) shortcutHandlerRef.current(value.action);
          return;
        }
        if (value.type === 'playback' && typeof value.message === 'string') {
          if (matchesPlaybackBinding(value, viewRef.current) && !value.message.startsWith('精准定位完成')) setPlayback(value.message); return;
        }
        if (value.type === 'playback-state' && typeof value.currentTimeMs === 'number') {
          if (!matchesPlaybackBinding(value, viewRef.current)) return;
          setCurrentTimeMs(value.currentTimeMs); if (typeof value.playing === 'boolean') setPlaying(value.playing);
          if (typeof value.rate === 'number') setRate(value.rate);
          if (value.playMode === 'auto' || value.playMode === 'manual' || value.playMode === 'shadowing' || value.playMode === 'practice') {
            setPlayMode(value.playMode);
            if (value.playMode !== 'practice') setDictation(false);
          }
          const segmentStartMs = value.playMode === 'manual' ? value.manualStartMs
            : value.playMode === 'shadowing' ? value.shadowingStartMs
              : value.playMode === 'practice' ? value.practiceStartMs : undefined;
          if (typeof segmentStartMs === 'number') {
            const active = phraseRowsRef.current.find(row => row.startMs === segmentStartMs);
            if (active) setSelected(active.id);
          }
          return;
        }
        const message = value as unknown as State;
        if (message.version !== 1) return;
        const next = { videoId: message.video?.videoId ?? '', session: message.video?.session ?? '', track: message.trackId ?? '' };
        if (viewRef.current.session !== next.session || viewRef.current.track !== next.track || message.status !== 'loaded') {
          practiceClientRef.current?.reset(); setDictation(false); setPracticeEnd('');
          setSelected(''); setPlayback(''); setCurrentTimeMs(null); setPlaying(false); setRate(1); setPlayMode('auto');
        }
        viewRef.current = next; setState({ ...message, tabId });
      },
    });
    connectionRef.current = controller;
    return () => { practiceClientRef.current?.reset(); controller.dispose(); connectionRef.current = null; };
  }, [connection]);

  const video = state.video;
  const isBilibili = state.source === 'bilibili' || video?.platform === 'bilibili';
  const preferredTrack = preferredTranscriptTrack(video?.tracks ?? [], settings.language) ?? video?.tracks[0];
  const primaryTrackId = video?.tracks.some(track => track.id === state.primaryTrackId) ? state.primaryTrackId! : preferredTrack?.id ?? '';
  const primaryTrack = video?.tracks.find(track => track.id === primaryTrackId) ?? preferredTrack;
  const secondaryTrackId = video?.tracks.some(track => track.id === state.secondaryTrackId) ? state.secondaryTrackId! : 'none';
  const secondaryTracks = (video?.tracks ?? []).filter(track => track.id !== primaryTrackId);
  const primaryBusy = state.status === 'loading';
  const secondaryBusy = state.secondaryStatus === 'loading';
  const phraseRows = state.phrases ?? [];
  phraseRowsRef.current = phraseRows;
  const echoRows = useMemo<EchoRow[]>(() => {
    // The learning list has one invariant: it renders the sentence-level rows produced by
    // the content script. Raw ASR events remain in state for diagnostics and seeking, but
    // must never silently replace phrases because that reintroduces split fragments.
    const base = phraseRows.map(phrase => ({ ...phrase, phraseId: phrase.id }));
    return base.map(row => ({ ...row, secondaryText: secondaryTextForRange(state.secondaryCues ?? [], row.startMs, row.endMs) }));
  }, [phraseRows, state.secondaryCues]);
  const { tourActive, startTour, scheduleModeTour } = useGuidedTours(view === 'reader' && state.status === 'loaded' && echoRows.length > 0);

  useEffect(() => {
    if (!video || isBilibili || state.status !== 'ready' || !preferredTrack) return;
    const requestKey = `${video.session}:${preferredTrack.id}`;
    if (autoRequestedSessionRef.current === requestKey) return;
    autoRequestedSessionRef.current = requestKey;
    connectionRef.current?.send({ version: 1, type: 'load', trackId: preferredTrack.id,
      videoId: video.videoId, session: video.session, userInitiated: false });
  }, [video?.session, isBilibili, state.status, preferredTrack?.id]);

  useEffect(() => {
    const requested = desiredSecondaryRef.current;
    if (!video || isBilibili || state.status !== 'loaded' || !requested || !video.tracks.some(track => track.id === requested)) return;
    desiredSecondaryRef.current = null;
    connectionRef.current?.send({ version: 1, type: 'load-secondary', trackId: requested,
      videoId: video.videoId, session: video.session });
  }, [video?.session, isBilibili, state.status, state.primaryTrackId]);

  const selectTracks = (nextPrimaryId: string, nextSecondaryId: string | null) => {
    if (!video) return;
    const primary = video.tracks.find(track => track.id === nextPrimaryId); if (!primary) return;
    const secondary = nextSecondaryId && nextSecondaryId !== nextPrimaryId ? video.tracks.find(track => track.id === nextSecondaryId) : undefined;
    if (isBilibili) connectionRef.current?.send({ version: 1, type: 'bilibili-select', trackId: primary.id,
      secondaryTrackId: secondary?.id ?? null, videoId: video.videoId, session: video.session });
    else {
      if (primary.id !== primaryTrackId || state.status !== 'loaded') {
        desiredSecondaryRef.current = secondary?.id ?? null;
        connectionRef.current?.send({ version: 1, type: 'load', trackId: primary.id, videoId: video.videoId,
          session: video.session, userInitiated: true });
      }
      else if (secondary) connectionRef.current?.send({ version: 1, type: 'load-secondary', trackId: secondary.id,
        videoId: video.videoId, session: video.session });
      else connectionRef.current?.send({ version: 1, type: 'secondary-clear', videoId: video.videoId, session: video.session });
    }
  };

  const selectedIndex = echoRows.findIndex(item => item.id === selected);
  const playingIndex = activeTimedRowIndex(echoRows, currentTimeMs);
  const boundedWaiting = (playMode === 'shadowing' || playMode === 'practice' || !playing) && playMode !== 'auto' && selectedIndex >= 0;
  const activeIndex = boundedWaiting ? selectedIndex : playingIndex >= 0 ? playingIndex : !playing ? selectedIndex : -1;
  const activeId = echoRows[activeIndex]?.id ?? '';
  const navigationIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const previousIndex = navigationIndex < 0 ? -1 : adjacentPlayableRowIndex(echoRows, navigationIndex, -1);
  const endIndex = playMode === 'practice' ? Math.max(navigationIndex, echoRows.findIndex(row => row.id === practiceEnd)) : navigationIndex;
  const nextIndex = adjacentPlayableRowIndex(echoRows, endIndex, 1);
  const practiceSegment: PracticeSegment | null = video && state.trackId && navigationIndex >= 0 && endIndex >= navigationIndex ? {
    videoId: video.videoId, session: video.session, trackId: state.trackId, startMs: echoRows[navigationIndex]!.startMs!,
    endMs: echoRows[endIndex]!.endMs!, text: echoRows.slice(navigationIndex, endIndex + 1).map(row => row.text).join(' '),
    language: state.language ?? video.tracks.find(track => track.id === state.trackId)?.language,
  } : null;

  useCueFollow(view === 'reader' && state.status === 'loaded' && activeId
    ? `${video?.session}:${state.trackId}:${playMode}:${activeId}:${endIndex}:${dictation}` : '');

  const activateEchoRow = (index: number, intent: 'select' | 'previous' | 'next' | 'replay' | 'shadowing' | 'practice' = 'select', rangeEnd?: number) => {
    const item = echoRows[index]; if (!item || item.startMs === null || item.endMs === null || item.endMs <= item.startMs) return;
    const requestedMode: PlayMode = intent === 'shadowing' || intent === 'practice' ? intent
      : playMode === 'shadowing' || playMode === 'practice' ? playMode
        : intent === 'previous' || intent === 'next' || intent === 'replay' ? 'manual' : playMode;
    if (requestedMode !== playMode) setPlayMode(requestedMode);
    const last = rangeEnd ?? (intent === 'replay' && playMode === 'practice' ? endIndex : index);
    setPracticeEnd(echoRows[last]?.id ?? item.id);
    setCurrentTimeMs(null); setSelected(item.id); setPlayback('');
    connectionRef.current?.send({ version: 1, type: 'seek', ...('phraseId' in item ? { phraseId: item.phraseId } : { cueId: item.cueId }),
      ...(requestedMode === 'practice' ? { endPhraseId: echoRows[last]?.id ?? item.id } : {}),
      playMode: requestedMode, intent, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const togglePlayback = () => {
    setPlayback('');
    // The content script reads the actual paused state; a stale UI update or
    // an uncovered caption gap must never turn a pause into a seek.
    connectionRef.current?.send({ version: 1, type: 'playback-toggle', videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const setPlaybackMode = (mode: PlayMode) => {
    setPlayMode(mode); connectionRef.current?.send({ version: 1, type: 'playback-mode', mode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
    setPlayback(mode === 'manual' ? '手动按句模式：将在当前句尾暂停'
      : mode === 'shadowing' ? '逐句跟读已开启 (E)' : mode === 'practice' ? '跟读模式已开启：录音与听写练习' : '自动连续播放已开启 (E)');
  };
  const toggleShadowing = () => {
    if (playMode === 'shadowing') { scheduleModeTour(null); setDictation(false); setPlaybackMode('auto'); return; }
    const index = navigationIndex >= 0 ? navigationIndex : nextIndex;
    if (index >= 0) {
      setPlayMode('shadowing'); activateEchoRow(index, 'shadowing');
      setPlayback('逐句跟读已开启 (E)');
    } else setPlaybackMode('shadowing');
    scheduleModeTour('shadowing');
  };
  const togglePracticeMode = () => {
    if (playMode === 'practice') { scheduleModeTour(null); setDictation(false); setPlaybackMode('auto'); return; }
    const index = navigationIndex >= 0 ? navigationIndex : nextIndex;
    if (index >= 0) {
      activateEchoRow(index, 'practice');
      setPlayback('跟读模式已开启：录音与听写练习');
    } else setPlaybackMode('practice');
    scheduleModeTour('practice');
  };
  const setPlaybackRate = (next: number) => {
    if (next === rate || !(PLAYBACK_RATES as readonly number[]).includes(next)) return;
    setRate(next); connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: next, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const changeRate = (direction: -1 | 1) => setPlaybackRate(adjacentPlaybackRate(rate, direction));
  const toggleDictation = () => { if (playMode === 'practice') setDictation(value => !value); };
  const resizePractice = (edge: 'start' | 'end', direction: -1 | 1) => {
    if (playMode !== 'practice' || !practiceSegment) return;
    const first = edge === 'start' ? navigationIndex + direction : navigationIndex;
    const last = edge === 'end' ? endIndex + direction : endIndex;
    if (first < 0 || last < first || last >= echoRows.length) return;
    if (echoRows[last]!.endMs! - echoRows[first]!.startMs! > 60_000) { setPlayback('练习片段最长 60 秒'); return; }
    activateEchoRow(first, 'practice', last);
  };
  const refreshCaptions = () => {
    if (isBilibili) connectionRef.current?.send({ version: 1, type: 'refresh' });
    else if (video && primaryTrack) {
      autoRequestedSessionRef.current = `${video.session}:${primaryTrack.id}`;
      connectionRef.current?.send({ version: 1, type: 'load', force: true, trackId: primaryTrack.id,
        videoId: video.videoId, session: video.session, userInitiated: true });
    } else setConnection(value => value + 1);
  };

  useLayoutEffect(() => {
    if (!echoRows.length || state.status !== 'loaded' || !state.nativeTimeline || !video) return;
    const root = document.documentElement;
    root.dataset.nativeVideoId = video.videoId;
    root.dataset.nativeSource = state.nativeTimeline.source;
    root.dataset.nativeCapturedAt = String(state.nativeTimeline.capturedAt);
    root.dataset.nativeDeliveredAt = String(state.nativeTimeline.deliveredAt);
    root.dataset.nativeRenderedAt = String(Date.now());
    if (state.nativeTimeline.requestCompletedAt) {
      root.dataset.nativeRequestCompletedAt = String(state.nativeTimeline.requestCompletedAt);
    } else delete root.dataset.nativeRequestCompletedAt;
  }, [echoRows.length, state.status, state.nativeTimeline, video?.videoId]);

  shortcutHandlerRef.current = (action, repeat = false) => {
    if (view !== 'reader' || shortcutsOpen || tourActive || state.status !== 'loaded') return false;
    if (repeat) return action === 'play';
    if (action === 'help') setShortcutsOpen(true);
    else if (action === 'slower') changeRate(-1);
    else if (action === 'faster') changeRate(1);
    else if (action === 'play') togglePlayback();
    else if (action === 'previous' && previousIndex >= 0) activateEchoRow(previousIndex, 'previous');
    else if (action === 'replay' && navigationIndex >= 0) activateEchoRow(navigationIndex, 'replay');
    else if (action === 'next' && nextIndex >= 0) activateEchoRow(nextIndex, 'next');
    else if (action === 'shadowing') toggleShadowing();
    else if (action === 'practice') togglePracticeMode();
    else if (action === 'dictation' && playMode === 'practice') toggleDictation();
    else if (action === 'expand-start') resizePractice('start', -1);
    else if (action === 'contract-start') resizePractice('start', 1);
    else if (action === 'expand-end') resizePractice('end', 1);
    else if (action === 'contract-end') resizePractice('end', -1);
    else if (playMode === 'practice' && exerciseRef.current?.shortcut(action)) return true;
    else return false;
    return true;
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutAction(event, true);
      if (action && shortcutHandlerRef.current(action, event.repeat)) event.preventDefault();
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, []);

  if (view === 'settings') return <SettingsView onBack={() => setView('reader')} onSettings={next => { setSettings(next); applyTheme(next.theme); }}/>

  if (echoRows.length && state.status === 'loaded') return <main className="echo-shell" data-display-mode="phrases"
    data-play-mode={playMode} data-playing={playing} data-tour-active={tourActive}>
    <header className="echo-toolbar" data-tour="subtitle-selectors">
      <TrackSelect label="主字幕" value={primaryTrackId} disabled={primaryBusy || !primaryTrackId} placeholder="主字幕" tracks={video?.tracks ?? []} isBilibili={isBilibili}
        onChange={value => selectTracks(value, secondaryTrackId === 'none' || value === secondaryTrackId ? null : secondaryTrackId)}/>
      <Select.Root value={secondaryTrackId} disabled={primaryBusy || secondaryBusy} onValueChange={value => selectTracks(primaryTrackId, value === 'none' ? null : value)}>
        <Select.Trigger className="echo-track-trigger" aria-label="第二字幕"><Languages/><Select.Value placeholder="第二字幕"/><Select.Icon><ChevronDown/></Select.Icon></Select.Trigger>
        <Select.Portal><Select.Content className="echo-select-content" position="popper" sideOffset={6} align="start"><Select.Viewport>
          <Select.Item className="echo-select-item" value="none"><Select.ItemText>无第二字幕</Select.ItemText><Select.ItemIndicator><Check/></Select.ItemIndicator></Select.Item>
          {secondaryTracks.map(track => <Select.Item className="echo-select-item" value={track.id} key={track.id}><Select.ItemText>{trackLabel(track, isBilibili)}</Select.ItemText><Select.ItemIndicator><Check/></Select.ItemIndicator></Select.Item>)}
        </Select.Viewport></Select.Content></Select.Portal>
      </Select.Root>
      <span className="echo-toolbar-spacer"/>
      <button className="echo-icon" aria-label="键盘快捷键" title="键盘快捷键" onClick={() => setShortcutsOpen(true)}><Keyboard/></button>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="echo-icon" data-tour="actions" aria-label="更多选项" title="更多选项"><MoreVertical/></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="echo-menu-content" sideOffset={6} align="end">
          <DropdownMenu.Item className="echo-menu-item" onSelect={refreshCaptions}><RefreshCw/><span>重新获取字幕</span></DropdownMenu.Item>
          <DropdownMenu.Item className="echo-menu-item" onSelect={() => void startTour('welcome', true)}><CircleHelp/><span>显示引导</span></DropdownMenu.Item>
          <DropdownMenu.Separator className="echo-menu-separator"/>
          <DropdownMenu.Item className="echo-menu-item" onSelect={() => setView('settings')}><Settings/><span>设置</span></DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
    <p className="echo-toast" role="status">{playback || (playMode === 'shadowing' ? '逐句跟读已开启 (E)'
      : playMode === 'practice' ? '跟读模式已开启：录音与听写练习'
        : playMode === 'manual' ? '手动按句模式：将在当前句尾暂停' : '自动连续播放已开启 (E)')}</p>
    {state.secondaryMessage ? <p className={`echo-notice ${state.secondaryStatus === 'error' ? 'failed' : ''}`}>{state.secondaryMessage}</p> : null}
    {state.timingMessage ? <p className="echo-notice">{state.timingMessage}</p> : null}
    <ol className="echo-list">{echoRows.map((item, index) => <EchoCueRow key={item.id} item={item} index={index}
      active={playMode === 'practice' ? index >= navigationIndex && index <= endIndex : activeId === item.id} hidden={playMode === 'practice' && dictation} onActivate={activateEchoRow}>
      {playMode === 'practice' && index === endIndex && practiceSegment && <>
        <div className="echo-segment-controls" data-tour="segment-controls" aria-label="调整练习片段">
          <button title="向前扩展 ([)" aria-label="向前扩展片段" disabled={navigationIndex <= 0} onClick={() => resizePractice('start', -1)}><ArrowUp/><Plus/></button>
          <button title="收缩开头 (Shift+[)" aria-label="收缩片段开头" disabled={endIndex <= navigationIndex} onClick={() => resizePractice('start', 1)}><ArrowUp/><Minus/></button>
          <button title="收缩结尾 (Shift+])" aria-label="收缩片段结尾" disabled={endIndex <= navigationIndex} onClick={() => resizePractice('end', -1)}><ArrowDown/><Minus/></button>
          <button title="向后扩展 (])" aria-label="向后扩展片段" disabled={endIndex >= echoRows.length - 1} onClick={() => resizePractice('end', 1)}><ArrowDown/><Plus/></button>
        </div>
        <Suspense fallback={<p role="status">正在加载练习…</p>}><ShadowingExerciseCard key={livePracticeKey(practiceSegment)} ref={exerciseRef}
          segment={practiceSegment} dictation={dictation} currentTimeMs={currentTimeMs} request={(type, signal) => practiceClientRef.current!.request(type, practiceSegment,
            echoRows[navigationIndex]!.id, echoRows[endIndex]!.id, signal)}/></Suspense>
      </>}
    </EchoCueRow>)}</ol>
    <footer className="echo-player">
      <button className="echo-transport-control echo-previous" aria-label="上一句" title="上一句 (A)" disabled={previousIndex < 0} onClick={() => activateEchoRow(previousIndex, 'previous')}><SkipBack/><span>上一句</span><kbd>A</kbd></button>
      <button className="echo-play" aria-label={playing ? '暂停' : '播放'}
        data-tour="transport" title="播放/暂停 (Space)" onClick={togglePlayback}>
        {playing ? <Pause/> : <Play/>}<span>播放/暂停</span><kbd>Space</kbd>
      </button>
      <button className="echo-transport-control echo-next" aria-label="下一句" title="下一句 (D)" disabled={nextIndex < 0} onClick={() => activateEchoRow(nextIndex, 'next')}><SkipForward/><span>下一句</span><kbd>D</kbd></button>
      <button
        id="btn-sentence-shadowing"
        type="button"
        className="echo-mode-control shadowing-mode"
        data-tour="shadowing"
        aria-label="切换逐句跟读"
        aria-pressed={playMode === 'shadowing'}
        aria-keyshortcuts="E"
        title={playMode === 'shadowing' ? '关闭逐句跟读 (E)' : '开启逐句跟读 (E)'}
        onClick={toggleShadowing}
      >
        <Ear/><span>逐句跟读</span><kbd>E</kbd>
      </button>
      <button className="echo-mode-control echo-replay" data-tour="replay" aria-label="重新播放当前句" title="重播当前句 (S)" disabled={navigationIndex < 0} onClick={() => activateEchoRow(navigationIndex, 'replay')}><RefreshCw/><span>重播</span><kbd>S</kbd></button>
      <Popover.Root><Popover.Trigger asChild><button className="echo-mode-control echo-rate" data-tour="speed" aria-label="播放速度" title="播放速度"><strong>{rate}x</strong><span>播放速度</span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="echo-rate-content" side="top" sideOffset={10} align="end">
          <div className="echo-rate-heading"><strong>播放速度</strong><b>{rate}x</b></div>
          <Slider.Root className="echo-slider" min={0} max={PLAYBACK_RATES.length - 1} step={1}
            value={[Math.max(0, (PLAYBACK_RATES as readonly number[]).indexOf(rate))]} onValueChange={value => setPlaybackRate(PLAYBACK_RATES[value[0] ?? 1] ?? 1)}>
            <Slider.Track><Slider.Range/></Slider.Track><Slider.Thumb aria-label="播放速度"/>
          </Slider.Root>
          <div className="echo-rate-labels">{PLAYBACK_RATES.map(value => <button key={value} onClick={() => setPlaybackRate(value)}>{value}x</button>)}</div>
          <div className="echo-rate-shortcuts"><span><kbd>Shift+&lt;</kbd> 减速</span><span><kbd>Shift+&gt;</kbd> 加速</span></div>
          <Popover.Arrow className="echo-popover-arrow"/>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      {playMode === 'practice' && <button className={`echo-mode-control dictation-mode ${dictation ? 'active' : ''}`} data-tour="dictation" aria-label="听写模式" aria-pressed={dictation} title="听写模式 (H)" onClick={toggleDictation}><BookOpen/><span>听写</span><kbd>H</kbd></button>}
      <HoverHint align="end" content={playMode === 'practice'
        ? '跟读模式已开启—片段播放一次后暂停，按 S 重播；F 关闭。'
        : '开启跟读模式—片段播放一次后暂停，可录音与听写 (F)。'}>
        <button className={`echo-mode-control practice-mode ${playMode === 'practice' ? 'active' : ''}`} data-tour="practice" data-play-mode-control="practice" aria-label="跟读模式" aria-keyshortcuts="F" aria-pressed={playMode === 'practice'} onClick={togglePracticeMode}><Mic/><span>跟读练习</span><kbd>F</kbd></button>
      </HoverHint>
    </footer>
    <ShortcutDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}/>
  </main>;

  const fetching = primaryBusy || Boolean(video && !isBilibili && state.status === 'ready');
  return <main className="echo-empty-shell">
    <header className="echo-empty-toolbar"><strong>Video Language Helper</strong><span/><button className="echo-icon" aria-label="设置" onClick={() => setView('settings')}><Settings/></button></header>
    {video ? <div className="echo-connected"><span>✓</span>视频已连接</div> : null}
    <section className="echo-empty">
      {fetching ? <div className="echo-load-card"><div className="echo-load-spinner" aria-hidden="true"/><h1>正在准备字幕</h1><p>{state.message}</p><div className="echo-progress"><span/></div><small>只读取视频已有字幕，不生成转录</small></div>
      : state.status === 'error' ? <div className="echo-load-card echo-message-card failed"><div className="echo-state-icon failed">!</div><h1>字幕获取失败</h1><p role="alert">{state.message}</p><div className="echo-message-actions"><button className="echo-primary" onClick={refreshCaptions}>{isBilibili ? '重试 B站字幕' : '重试 YouTube 原生字幕'}</button></div></div>
      : <div className="echo-load-card echo-message-card"><div className="echo-state-icon">V</div><h1>{video?.title || '打开一个视频'}</h1><p>{state.message}</p><button className="echo-primary" onClick={() => setConnection(value => value + 1)}>重新连接</button></div>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
