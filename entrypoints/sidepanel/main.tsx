import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import * as Slider from '@radix-ui/react-slider';
import { ArrowLeft, BookOpen, Check, ChevronDown, CircleHelp, Keyboard, Languages, ListRestart, Mic, MoreVertical,
  Pause, Play, RefreshCw, Repeat2, Settings, SkipBack, SkipForward, X } from 'lucide-react';
import { SettingsView } from '../../components/settings-view';
import { adjacentPlaybackRate, PLAYER_SHORTCUTS, PLAYBACK_RATES, PORT, emptyState, type State, type Track } from '../../lib/protocol';
import { connectPanel } from '../../lib/panel-connection';
import { record } from '../../lib/captions';
import { SERVICE_CHANNEL, type PublicSettings, type ServiceReply } from '../../lib/settings';
import { preferredTranscriptTrack } from '../../lib/transcript-selection';
import { activeTimedRowIndex, adjacentPlayableRowIndex, matchesPlaybackBinding } from '../../lib/playback-view';
import { secondaryTextForRange } from '../../lib/subtitle-lanes';
import { applyTheme } from '../../lib/theme';
import './style.css';

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
    ['?', '显示键盘快捷键'], ['Space / K', '播放/暂停'], ['Shift + < / >', '减速/加速'],
    ['E', '切换逐句跟读'], ['A', '上一句'], ['S', '重播当前句'], ['D', '下一句'],
  ] },
  { title: '跟读模式控制（预留）', items: [
    ['R', '开始/停止录音'], ['G', '播放录音'], ['V', '评估录音'], ['Esc', '取消录音'],
    ['P', '切换音高曲线'], ['[ / ]', '扩展片段'], ['Shift + [ / ]', '收缩片段'],
  ] },
  { title: '听写模式控制（预留）', items: [
    ['/', '聚焦听写输入框'], ['Enter', '检查答案'], ['Shift + Enter', '换行'], ['Esc', '取消输入'],
  ] },
] as const;

const GUIDE_STEPS = [
  ['选择字幕', '顶部左侧分别选择主字幕和第二字幕。第二字幕只读取视频实际提供的轨道，不自动翻译。'],
  ['选择语段', '点击任一语段即可定位。A、S、D 分别对应上一句、重播和下一句。'],
  ['逐句跟读', '按 E 或底部播放模式按钮开启。每句结束后按该句时长暂停，再自动播放下一句。'],
  ['播放速度', '点击底部倍速按钮打开滑块；Shift 加逗号或句号也可减速、加速。'],
  ['后续功能', '书本按钮预留听写；麦克风按钮预留录音和评分。当前点击会明确提示尚未开放。'],
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

const EchoCueRow = React.memo(function EchoCueRow({ item, active, index, onActivate }: { item: EchoRow; active: boolean; index: number; onActivate: (index: number) => void }) {
  const playable = item.startMs !== null && item.endMs !== null && item.endMs > item.startMs;
  return <li><button data-phrase-id={item.id} data-row-index={index} className={`echo-cue ${active ? 'selected' : ''}`}
    title={`${timestamp(item.startMs)} → ${timestamp(item.endMs)}`} disabled={!playable} aria-current={active ? 'true' : undefined}
    onClick={() => onActivate(index)}>
    <span className="echo-time">{compactTimestamp(item.startMs)}</span>
    <span className="echo-text">{item.text || '（空文本条目）'}</span>
    {item.secondaryText ? <span className="echo-secondary-text">{item.secondaryText}</span> : null}
  </button></li>;
});

function ShortcutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="echo-dialog-overlay"/>
    <Dialog.Content className="echo-dialog-content echo-shortcut-card" aria-describedby="shortcut-description">
      <div className="echo-dialog-header"><Dialog.Title>键盘快捷键</Dialog.Title><Dialog.Close aria-label="关闭"><X/></Dialog.Close></div>
      <Dialog.Description id="shortcut-description">在 YouTube、B站页面和侧栏均可使用。视频网站原有的 Space/K 与 Shift+&lt;/&gt; 快捷键也同时有效。</Dialog.Description>
      {SHORTCUT_SECTIONS.map(section => <section className="echo-shortcut-section" key={section.title}><h2>{section.title}</h2><dl>
        {section.items.map(([keys, description]) => <div key={`${keys}-${description}`}><dt>{keys.split(' / ').map((key, index) => <React.Fragment key={key}>{index ? ' / ' : ''}<kbd>{key}</kbd></React.Fragment>)}</dt><dd>{description}</dd></div>)}
      </dl></section>)}
      <Dialog.Close className="echo-dialog-done">关闭</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function GuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="echo-dialog-overlay"/><Dialog.Content className="echo-dialog-content echo-guide-card">
      <div className="echo-dialog-header"><Dialog.Title>使用引导</Dialog.Title><Dialog.Close aria-label="关闭"><X/></Dialog.Close></div>
      <Dialog.Description className="sr-only">Video Language Helper 使用步骤</Dialog.Description>
      <ol>{GUIDE_STEPS.map(([title, body], index) => <li key={title}><span>{index + 1}</span><div><h2>{title}</h2><p>{body}</p></div></li>)}</ol>
      <Dialog.Close className="echo-dialog-done">开始使用</Dialog.Close>
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
  const [playMode, setPlayMode] = useState<'all' | 'follow'>('all');
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const autoRequestedSessionRef = useRef('');
  const desiredSecondaryRef = useRef<string | null>(null);
  const connectionRef = useRef<ReturnType<typeof connectPanel> | null>(null);
  const viewRef = useRef({ videoId: '', session: '', track: '' });

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
        setState({ ...emptyState(), status: error ? 'error' : 'waiting', message }); setPlayback(''); setSelected('');
        setCurrentTimeMs(null); setPlaying(false); setRate(1); setPlayMode('all');
        autoRequestedSessionRef.current = ''; desiredSecondaryRef.current = null;
        viewRef.current = { videoId: '', session: '', track: '' };
      },
      message: (value, tabId) => {
        if (!record(value)) return;
        if (value.type === 'playback' && typeof value.message === 'string') {
          if (matchesPlaybackBinding(value, viewRef.current)) setPlayback(value.message); return;
        }
        if (value.type === 'playback-state' && typeof value.currentTimeMs === 'number') {
          if (!matchesPlaybackBinding(value, viewRef.current)) return;
          setCurrentTimeMs(value.currentTimeMs); if (typeof value.playing === 'boolean') setPlaying(value.playing);
          if (typeof value.rate === 'number') setRate(value.rate); return;
        }
        const message = value as unknown as State;
        if (message.version !== 1) return;
        const next = { videoId: message.video?.videoId ?? '', session: message.video?.session ?? '', track: message.trackId ?? '' };
        if (viewRef.current.session !== next.session || viewRef.current.track !== next.track || message.status !== 'loaded') {
          setSelected(''); setPlayback(''); setCurrentTimeMs(null); setPlaying(false); setRate(1); setPlayMode('all');
        }
        viewRef.current = next; setState({ ...message, tabId });
      },
    });
    connectionRef.current = controller;
    return () => { controller.dispose(); connectionRef.current = null; };
  }, [connection]);

  const video = state.video;
  const isBilibili = video?.platform === 'bilibili';
  const preferredTrack = preferredTranscriptTrack(video?.tracks ?? [], settings.language) ?? video?.tracks[0];
  const primaryTrackId = video?.tracks.some(track => track.id === state.primaryTrackId) ? state.primaryTrackId! : preferredTrack?.id ?? '';
  const primaryTrack = video?.tracks.find(track => track.id === primaryTrackId) ?? preferredTrack;
  const secondaryTrackId = video?.tracks.some(track => track.id === state.secondaryTrackId) ? state.secondaryTrackId! : 'none';
  const secondaryTracks = (video?.tracks ?? []).filter(track => track.id !== primaryTrackId);
  const primaryBusy = state.status === 'loading';
  const secondaryBusy = state.secondaryStatus === 'loading';
  const phraseRows = state.phrases ?? [];
  const echoRows = useMemo<EchoRow[]>(() => {
    // The learning list has one invariant: it renders the sentence-level rows produced by
    // the content script. Raw ASR events remain in state for diagnostics and seeking, but
    // must never silently replace phrases because that reintroduces split fragments.
    const base = phraseRows.map(phrase => ({ ...phrase, phraseId: phrase.id }));
    return base.map(row => ({ ...row, secondaryText: secondaryTextForRange(state.secondaryCues ?? [], row.startMs, row.endMs) }));
  }, [phraseRows, state.secondaryCues]);

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
  const activeIndex = currentTimeMs === null ? selectedIndex : playingIndex;
  const activeId = echoRows[activeIndex]?.id ?? '';
  const navigationIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const previousIndex = navigationIndex < 0 ? -1 : adjacentPlayableRowIndex(echoRows, navigationIndex, -1);
  const nextIndex = adjacentPlayableRowIndex(echoRows, navigationIndex, 1);

  useEffect(() => {
    if (!activeId) return;
    const element = document.querySelector<HTMLElement>(`.echo-cue[data-phrase-id="${CSS.escape(activeId)}"]`);
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 58 || bounds.bottom > innerHeight - 58) element.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [activeId]);

  const activateEchoRow = (index: number) => {
    const item = echoRows[index]; if (!item || item.startMs === null || item.endMs === null || item.endMs <= item.startMs) return;
    setCurrentTimeMs(null); setSelected(item.id); setPlayback(''); setPlaying(true);
    connectionRef.current?.send({ version: 1, type: 'seek', ...('phraseId' in item ? { phraseId: item.phraseId } : { cueId: item.cueId }),
      playMode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const togglePlayback = () => {
    if (selectedIndex < 0 && activeIndex < 0) activateEchoRow(nextIndex);
    else { setPlaying(value => !value); connectionRef.current?.send({ version: 1, type: 'playback-toggle', videoId: video?.videoId, session: video?.session, trackId: state.trackId }); }
  };
  const setPlaybackMode = (mode: 'all' | 'follow') => {
    setPlayMode(mode); connectionRef.current?.send({ version: 1, type: 'playback-mode', mode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
    setPlayback(mode === 'follow' ? '逐句跟读已开启：每句结束后按本句时长暂停，再自动播放下一句 (E)' : '连续播放已开启 (E)');
  };
  const setPlaybackRate = (next: number) => {
    if (next === rate || !(PLAYBACK_RATES as readonly number[]).includes(next)) return;
    setRate(next); connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: next, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const changeRate = (direction: -1 | 1) => setPlaybackRate(adjacentPlaybackRate(rate, direction));
  const reserved = (feature: string) => setPlayback(`${feature}按钮已预留，当前版本尚未开放。`);
  const refreshCaptions = () => {
    if (isBilibili) connectionRef.current?.send({ version: 1, type: 'refresh' });
    else if (video && primaryTrack) {
      autoRequestedSessionRef.current = `${video.session}:${primaryTrack.id}`;
      connectionRef.current?.send({ version: 1, type: 'load', force: true, trackId: primaryTrack.id,
        videoId: video.videoId, session: video.session, userInitiated: true });
    }
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editable = target?.closest('input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="option"]');
      const toolbarButton = target?.closest('button:not(.echo-cue)');
      if (editable || toolbarButton || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true); return; }
      if (event.shiftKey && event.code === PLAYER_SHORTCUTS.decreaseRate) { event.preventDefault(); changeRate(-1); return; }
      if (event.shiftKey && event.code === PLAYER_SHORTCUTS.increaseRate) { event.preventDefault(); changeRate(1); return; }
      if (event.shiftKey) return;
      if (event.code === PLAYER_SHORTCUTS.playOrPause || event.code === 'KeyK') { event.preventDefault(); togglePlayback(); }
      else if (event.code === PLAYER_SHORTCUTS.previous && previousIndex >= 0) { event.preventDefault(); activateEchoRow(previousIndex); }
      else if (event.code === PLAYER_SHORTCUTS.replay && navigationIndex >= 0) { event.preventDefault(); activateEchoRow(navigationIndex); }
      else if (event.code === PLAYER_SHORTCUTS.next && nextIndex >= 0) { event.preventDefault(); activateEchoRow(nextIndex); }
      else if (event.code === PLAYER_SHORTCUTS.toggleEcho) { event.preventDefault(); setPlaybackMode(playMode === 'follow' ? 'all' : 'follow'); }
      else if ([PLAYER_SHORTCUTS.toggleDictation, PLAYER_SHORTCUTS.record, PLAYER_SHORTCUTS.playRecording, 'KeyV'].includes(event.code as never)) { event.preventDefault(); reserved('听写或跟读录音'); }
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [activeIndex, selectedIndex, previousIndex, nextIndex, navigationIndex, rate, playMode, echoRows]);

  if (view === 'settings') return <SettingsView onBack={() => setView('reader')} onSettings={next => { setSettings(next); applyTheme(next.theme); }}/>

  if (echoRows.length && state.status === 'loaded') return <main className="echo-shell" data-display-mode="phrases">
    <header className="echo-toolbar">
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
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="echo-icon" aria-label="更多选项" title="更多选项"><MoreVertical/></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="echo-menu-content" sideOffset={6} align="end">
          <DropdownMenu.Item className="echo-menu-item" onSelect={refreshCaptions}><RefreshCw/><span>重新获取字幕</span></DropdownMenu.Item>
          <DropdownMenu.Item className="echo-menu-item" onSelect={() => setGuideOpen(true)}><CircleHelp/><span>显示引导</span></DropdownMenu.Item>
          <DropdownMenu.Separator className="echo-menu-separator"/>
          <DropdownMenu.Item className="echo-menu-item" onSelect={() => setView('settings')}><Settings/><span>设置</span></DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
    {playback ? <p className="echo-toast" role="status">{playback}</p> : null}
    {state.secondaryMessage ? <p className={`echo-notice ${state.secondaryStatus === 'error' ? 'failed' : ''}`}>{state.secondaryMessage}</p> : null}
    {state.timingMessage ? <p className="echo-notice">{state.timingMessage}</p> : null}
    <ol className="echo-list">{echoRows.map((item, index) => <EchoCueRow key={item.id} item={item} index={index} active={activeId === item.id} onActivate={activateEchoRow}/>)}</ol>
    <footer className="echo-player">
      <button aria-label="上一句" title="上一句 (A)" disabled={previousIndex < 0} onClick={() => activateEchoRow(previousIndex)}><SkipBack/></button>
      <button className="echo-play" aria-label={playing ? '暂停' : '播放'} title="播放/暂停 (Space / K)" onClick={togglePlayback}>{playing ? <Pause/> : <Play/>}</button>
      <button aria-label="下一句" title="下一句 (D)" disabled={nextIndex < 0} onClick={() => activateEchoRow(nextIndex)}><SkipForward/></button>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className={playMode === 'follow' ? 'active' : ''} aria-label="播放模式" title={playMode === 'follow' ? '逐句跟读' : '连续播放'}>{playMode === 'follow' ? <Repeat2/> : <ListRestart/>}</button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="echo-mode-content" side="top" sideOffset={8} align="start">
          <DropdownMenu.RadioGroup value={playMode} onValueChange={value => setPlaybackMode(value as 'all' | 'follow')}>
            <DropdownMenu.RadioItem className="echo-menu-item" value="all"><ListRestart/><span><strong>连续播放</strong><small>视频自然连续播放</small></span><DropdownMenu.ItemIndicator><Check/></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem className="echo-menu-item" value="follow"><Repeat2/><span><strong>逐句跟读</strong><small>每句结束后留出跟读时间</small></span><DropdownMenu.ItemIndicator><Check/></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button aria-label="重新播放当前句" title="重播当前句 (S)" disabled={navigationIndex < 0} onClick={() => activateEchoRow(navigationIndex)}><RefreshCw/></button>
      <span className="echo-player-spacer"/>
      <Popover.Root><Popover.Trigger asChild><button className="echo-rate" aria-label="播放速度" title="播放速度">{rate}x</button></Popover.Trigger>
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
      <button aria-label="听写模式（暂未开放）" title="听写模式（暂未开放）" onClick={() => reserved('听写模式')}><BookOpen/></button>
      <button aria-label="跟读录音（暂未开放）" title="跟读录音（暂未开放）" onClick={() => reserved('跟读录音与评分')}><Mic/></button>
    </footer>
    <ShortcutDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}/><GuideDialog open={guideOpen} onOpenChange={setGuideOpen}/>
  </main>;

  const fetching = primaryBusy || Boolean(video && !isBilibili && state.status === 'ready');
  return <main className="echo-empty-shell">
    <header className="echo-empty-toolbar"><strong>Video Language Helper</strong><span/><button className="echo-icon" aria-label="设置" onClick={() => setView('settings')}><Settings/></button></header>
    {video ? <div className="echo-connected"><span>✓</span>视频已连接</div> : null}
    <section className="echo-empty">
      {fetching ? <div className="echo-load-card"><div className="echo-load-spinner" aria-hidden="true"/><h1>正在准备字幕</h1><p>{state.message}</p><div className="echo-progress"><span/></div><small>只读取视频已有字幕，不生成转录</small></div>
      : state.status === 'error' ? <div className="echo-load-card echo-message-card failed"><div className="echo-state-icon failed">!</div><h1>字幕获取失败</h1><p role="alert">{state.message}</p><div className="echo-message-actions"><button className="echo-primary" onClick={refreshCaptions}>重试 YouTube 原生字幕</button></div></div>
      : <div className="echo-load-card echo-message-card"><div className="echo-state-icon">V</div><h1>{video?.title || '打开一个视频'}</h1><p>{state.message}</p><button className="echo-primary" onClick={() => setConnection(value => value + 1)}>重新连接</button></div>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
