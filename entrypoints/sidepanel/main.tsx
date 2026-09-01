import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, Keyboard, Languages, ListRestart, Mic, MoreVertical, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Square } from 'lucide-react';
import { PORT, emptyState, type State } from '../../lib/protocol';
import { connectPanel } from '../../lib/panel-connection';
import { record } from '../../lib/captions';
import { SERVICE_CHANNEL, type ServiceReply } from '../../lib/settings';
import { groupSentences, rawCaptionGroups } from '../../lib/sentence-groups';
import { preferredTranscriptTrack } from '../../lib/transcript-selection';
import './style.css';

function timestamp(ms: number | null) {
  if (ms === null) return '时间异常';
  return `${Math.floor(ms / 60_000).toString().padStart(2, '0')}:${(ms % 60_000 / 1000).toFixed(3).padStart(6, '0')}`;
}

function compactTimestamp(ms: number) {
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

function App() {
  const [state, setState] = useState<State>(emptyState);
  const [trackId, setTrackId] = useState('');
  const [playback, setPlayback] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(0);
  const [connection, setConnection] = useState(0);
  const [displayMode, setDisplayMode] = useState<'phrases' | 'sentences' | 'raw'>('phrases');
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [sourceChoice, setSourceChoice] = useState({ session: '', id: 'auto' });
  const remoteBusy = useRef(false);
  const [remotePending, setRemotePending] = useState(false);
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
  const connectionRef = useRef<ReturnType<typeof connectPanel> | null>(null);
  const viewRef = useRef({ session: '', track: '' });
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
      reset: (message, error) => {
        setState({ ...emptyState(), status: error ? 'error' : 'waiting', message });
        setPlayback(''); setSelected(''); setPage(0); setTrackId('');
        viewRef.current = { session: '', track: '' };
      },
      message: (value, tabId) => {
        if (!record(value)) return;
        if (value.type === 'playback' && typeof value.message === 'string') { setPlayback(value.message); return; }
        if (value.type === 'playback-state' && typeof value.currentTimeMs === 'number') {
          setCurrentTimeMs(value.currentTimeMs);
          if (typeof value.playing === 'boolean') setPlaying(value.playing);
          if (typeof value.rate === 'number') setRate(value.rate);
          return;
        }
        const message = value as unknown as State;
        if (message.version !== 1) return;
        const next = { session: message.video?.session ?? '', track: message.trackId ?? '' };
        if (viewRef.current.session !== next.session || viewRef.current.track !== next.track || message.status !== 'loaded') {
          setPage(0); setSelected(''); setPlayback('');
        }
        viewRef.current = next;
        setState({ ...message, tabId });
        setTrackId(message.video?.tracks.some(t => t.id === message.trackId) ? message.trackId! : message.video?.tracks[0]?.id ?? '');
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
  const busy = state.status === 'loading' || remotePending;
  const reading = displayMode === 'phrases';
  const grouped = displayMode !== 'raw';
  const rows = useMemo(() => grouped ? groupSentences(state.cues) : rawCaptionGroups(state.cues), [state.cues, grouped]);
  const phraseRows = state.phrases ?? [];
  const echoRows = useMemo(() => displayMode === 'raw'
    ? state.cues.filter(cue => cue.startMs !== null).map(cue => ({
        id: `raw:${cue.cueId}`, text: cue.text, startMs: cue.startMs!, endMs: cue.endMs ?? cue.startMs!, cueId: cue.cueId,
      }))
    : phraseRows.map(phrase => ({ ...phrase, phraseId: phrase.id })), [displayMode, phraseRows, state.cues]);
  const itemCount = reading ? phraseRows.length : rows.length;
  const pages = Math.max(1, Math.ceil(itemCount / 100));
  async function loadSupadata(requestedTrack = sourceTrack) {
    if (!video || state.tabId === undefined || busy || remoteBusy.current || !settingsReady) return;
    remoteBusy.current = true; setRemotePending(true);
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
    finally { remoteBusy.current = false; setRemotePending(false); }
  }
  const selectedIndex = echoRows.findIndex(item => item.id === selected);
  const playingIndex = currentTimeMs === null ? -1 : echoRows.findIndex((item, index) =>
    currentTimeMs >= item.startMs && currentTimeMs < (echoRows[index + 1]?.startMs ?? item.endMs));
  const activeIndex = playingIndex >= 0 ? playingIndex : selectedIndex;
  const activeId = echoRows[activeIndex]?.id ?? '';
  const loadedTrackId = video?.tracks.some(track => track.id === state.trackId) ? state.trackId!
    : video?.tracks.find(track => track.language.toLowerCase() === state.requestedLanguage?.toLowerCase())?.id
    ?? sourceTrack?.id ?? 'loaded';
  useEffect(() => {
    if (!activeId) return;
    const element = Array.from(document.querySelectorAll<HTMLElement>('.echo-cue'))
      .find(item => item.dataset.phraseId === activeId);
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 52 || bounds.bottom > innerHeight - 52) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeId]);
  const activateEchoRow = (index: number) => {
    const item = echoRows[index];
    if (!item) return;
    setCurrentTimeMs(null); setSelected(item.id); setPlayback(''); setPlaying(true);
    connectionRef.current?.send({ version: 1, type: 'seek', ...('phraseId' in item ? { phraseId: item.phraseId } : { cueId: item.cueId }),
      playMode, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
  };
  const togglePlayback = () => {
    if (activeIndex < 0) activateEchoRow(0);
    else {
      setPlaying(value => !value);
      connectionRef.current?.send({ version: 1, type: 'playback-toggle', videoId: video?.videoId, session: video?.session });
    }
  };
  const toggleRecording = async () => {
    if (recorderRef.current?.state === 'recording') { recorderRef.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingStreamRef.current = stream; recorderRef.current = recorder; recordingChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const url = URL.createObjectURL(new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
        setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
        recordingStreamRef.current?.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null; recorderRef.current = null; setRecording(false);
      };
      recorder.start(); setRecording(true);
    } catch { setPlayback('麦克风未授权，未开始录音'); }
  };
  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(track => track.stop());
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, [recordingUrl]);
  useEffect(() => {
    if (!phraseRows.length) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); activateEchoRow(Math.max(0, activeIndex - 1)); }
      if (event.code === 'ArrowRight') { event.preventDefault(); activateEchoRow(Math.min(echoRows.length - 1, activeIndex + 1)); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); activateEchoRow(Math.max(0, activeIndex)); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, echoRows, phraseRows.length]);
  if (phraseRows.length) return <main className="echo-shell">
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
      <label className="echo-select-wrap"><Languages aria-hidden="true"/><select className="echo-filter echo-mode" aria-label="字幕显示" value={displayMode === 'raw' ? 'raw' : 'phrases'} onChange={event => {
        setDisplayMode(event.target.value as 'phrases' | 'raw'); setSelected(''); setPlayback('');
      }}><option value="phrases">Subtitles</option><option value="raw">Raw captions</option></select><ChevronDown className="echo-chevron" aria-hidden="true"/></label>
      <button className={`echo-icon ${shortcutsOpen ? 'active' : ''}`} aria-label="键盘快捷键" title="键盘快捷键" onClick={() => setShortcutsOpen(value => !value)}><Keyboard /></button>
      <button className="echo-icon echo-menu" aria-label="API 设置" title="API 设置" onClick={() => void browser.runtime.openOptionsPage()}><MoreVertical /></button>
    </div>
    {shortcutsOpen ? <div className="echo-shortcuts"><span><kbd>Space</kbd> 播放/暂停</span><span><kbd>←</kbd><kbd>→</kbd> 上一句/下一句</span><span><kbd>R</kbd> 重播</span></div> : null}
    <ol className="echo-list" aria-label="独立时间语段">
      {echoRows.map((item, index) => <li key={item.id}>
        <button data-phrase-id={item.id} className={`echo-cue ${activeId === item.id ? 'selected' : ''}`} title={`${timestamp(item.startMs)} → ${timestamp(item.endMs)}`} onClick={() => activateEchoRow(index)}>
          <span className="echo-time">{compactTimestamp(item.startMs)}</span>
          <span className="echo-text">{item.text}</span>
        </button>
      </li>)}
    </ol>
    {recordingUrl ? <div className="echo-recording"><audio src={recordingUrl} controls aria-label="本次跟读录音"/><button onClick={() => setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return ''; })}>关闭</button></div> : null}
    <div className="echo-player" aria-label="字幕播放控制">
      <button aria-label="上一句" disabled={activeIndex <= 0} onClick={() => activateEchoRow(activeIndex - 1)}><SkipBack /></button>
      <button className="echo-play" aria-label={playing ? '暂停' : '播放'} onClick={togglePlayback}>{playing ? <Pause /> : <Play />}</button>
      <button aria-label="下一句" disabled={activeIndex + 1 >= echoRows.length} onClick={() => activateEchoRow(activeIndex < 0 ? 0 : activeIndex + 1)}><SkipForward /></button>
      <div className="echo-popover-wrap">
        <button aria-label="播放模式" title={playMode === 'single' ? '单句播放' : playMode === 'loop' ? '单句循环' : '连续播放'} onClick={() => { setPlayModeOpen(value => !value); setRateOpen(false); }}>
          {playMode === 'single' ? <Repeat /> : playMode === 'loop' ? <Repeat1 /> : <ListRestart />}
        </button>
        {playModeOpen ? <div className="echo-popover echo-mode-menu" role="menu">
          {([['single', '单句播放'], ['loop', '单句循环'], ['all', '连续播放']] as const).map(([mode, label]) => <button key={mode} className={playMode === mode ? 'selected' : ''} onClick={() => {
            setPlayMode(mode); setPlayModeOpen(false);
            connectionRef.current?.send({ version: 1, type: 'playback-mode', mode, videoId: video?.videoId, session: video?.session });
          }}>{label}</button>)}
        </div> : null}
      </div>
      <div className="echo-popover-wrap echo-rate-wrap">
        <button className="echo-rate" aria-label="播放速度" onClick={() => { setRateOpen(value => !value); setPlayModeOpen(false); }}>{rate}x</button>
        {rateOpen ? <div className="echo-popover echo-rate-menu" role="menu">
          {[.75, .8, .9, 1].map(value => <button key={value} className={rate === value ? 'selected' : ''} onClick={() => {
            setRate(value); setRateOpen(false);
            connectionRef.current?.send({ version: 1, type: 'playback-rate', rate: value, videoId: video?.videoId, session: video?.session });
          }}>{value}x</button>)}
        </div> : null}
      </div>
      <button className={`echo-mic ${recording ? 'recording' : ''}`} aria-label={recording ? '停止跟读录音' : '开始跟读录音'} title={recording ? '停止录音' : '跟读录音'} onClick={() => void toggleRecording()}>{recording ? <Square /> : <Mic />}</button>
    </div>
  </main>;
  return <main>
    <header><span className="badge">M0 · 独立语段时间</span><h1>字幕学习</h1><p>YouTube / Bilibili Language Helper</p><button className="secondary" onClick={() => void browser.runtime.openOptionsPage()}>API 设置</button></header>
    <section className="controls">
      <h2>{video?.title ?? '等待视频'}</h2>
      <p className="meta">{video ? `视频 ${video.videoId} · 标签页 ${state.tabId}` : '支持 YouTube /watch 和 B 站 /video'}</p>
      {video?.platform === 'bilibili' ? <p className="meta">B 站字幕会自动读取，无需 Supadata。</p> : null}
      {video?.platform !== 'bilibili' ? <>
      <p><strong>字幕来源：Supadata · 与 YouTube Digest 相同</strong></p>
      <p className="meta">先在“API 设置”保存 Key 并测试连接。点击读取会发送当前视频 URL 并使用服务额度；只获取已有字幕。无需开启 YouTube 字幕。</p>
      <label htmlFor="transcript-source">Supadata 请求字幕</label>
      <select id="transcript-source" value={sourceId} disabled={busy || !video || !settingsReady} onChange={e => {
        setSourceChoice({ session: video!.session, id: e.target.value });
      }}>
        <option value="auto">自动 · 优先同语言人工轨</option>
        <option value="settings">按 API 设置语言（{preferredLanguage ?? '已保存设置'}）</option>
        {video?.tracks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.kind === 'manual' ? '人工' : '自动'} · 请求 {t.language}</option>)}
      </select>
      <p className="meta">本次将请求：{sourceTrack ? `${sourceTrack.name} · ${sourceTrack.language}` : preferredLanguage ?? 'API 设置语言'}。选择只影响下一次读取，不修改 Key、不自动请求。</p>
      <div className="actions">
        <button disabled={busy || !video || !settingsReady} onClick={() => void loadSupadata()}>{busy ? '读取中…' : '读取字幕 · Supadata（使用额度）'}</button>
        <button className="secondary" disabled={busy} onClick={() => setConnection(n => n + 1)}>重新连接</button>
      </div>
      <p className="meta">默认参考 API 设置语言，优先请求网页公布的同语言人工轨代码；无匹配轨时沿用设置。服务按语言取字幕，不能保证区分相同语言代码的多条轨道。长视频最多查询 60 次，总等待上限 90 秒。</p>
      <details className="service"><summary>实验功能：网页直读（当前可能返回空内容）</summary>
      <p>此路径尚未修复，不使用 Supadata，也不受 API Key 设置影响。以下轨道选择仅用于网页直读。</p>
      <label htmlFor="track">网页原始字幕轨（仅实验路径）</label>
      <select id="track" value={trackId} disabled={busy || !video?.tracks.length} onChange={e => {
        setTrackId(e.target.value);
        connectionRef.current?.send({ version: 1, type: 'select', trackId: e.target.value, session: video?.session });
      }}>
        {!video?.tracks.length ? <option value="">尚无可读取轨道</option> : video.tracks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.kind === 'asr' ? '自动字幕' : '人工字幕'}</option>)}
      </select>
      <div className="actions">
        <button className="secondary" disabled={busy || !trackId || !video} onClick={() => connectionRef.current?.send({ version: 1, type: 'load', trackId, session: video?.session })}>尝试网页直读（不使用 API）</button>
      </div>
      </details>
      </> : null}
    </section>
    <p role="status" className={state.status === 'error' ? 'status error' : 'status'}>{state.message}</p>
    {playback ? <p className="playback" role="status">{playback}</p> : null}
    {state.cues.length ? <>
      <p className="meta">来源：{state.source === 'supadata' ? `Supadata 标点文本 · 请求 ${state.requestedLanguage ?? '旧记录未保存'} · 返回 ${state.language}` : state.source === 'bilibili' ? 'B 站官方字幕轨' : 'YouTube 网页原轨'}<br/>{state.cues.length} 条原字幕 · {reading ? `${phraseRows.length} 个独立时间语段` : `当前显示 ${rows.length} ${grouped ? '组' : '条'}`} · {state.controlEventCount} 个窗口/样式事件<br/>原始数据不变。{state.source === 'bilibili' ? 'B 站保留原始 from/to 时间，不伪造句内起点。' : '自然语段使用 YouTube 自动轨词级时间独立定位。'}</p>
      {reading && state.timingMessage ? <p className={phraseRows.length ? 'meta' : 'warning'}>{state.timingMessage}</p> : null}
      {state.source === 'supadata' && state.requestedLanguage && state.requestedLanguage.toLowerCase() !== state.language?.toLowerCase()
        ? <p className="meta">请求与返回语言标签不同：可能是方言标签归一或服务回退，不能只凭标签判定实际轨道，请核对正文。</p> : null}
      <label htmlFor="caption-view">字幕显示</label>
      <select id="caption-view" value={displayMode} onChange={e => {
        setDisplayMode(e.target.value as typeof displayMode); setPage(0); setSelected(''); setPlayback('');
      }}><option value="phrases">语段分行 · 按朗读停顿（无空行）</option><option value="sentences">句子时间组 · SBD + 2 秒以内向后合并</option><option value="raw">原始条目 · 不合并</option></select>
      {reading ? <p className="meta">按句界、朗读停顿和括号说明拆成独立条目；每条显示自己的词级起止时间并可独立点击。无法与网站自动轨首词对齐的语段不会伪造时间。</p>
        : grouped ? <p className="meta">SBD 识别句号、问号、感叹号和缩写；≤2 秒向后合并。句内没有更细时间时不拆原条目，末尾短句保留。非英文效果未验证。</p> : null}
      <nav aria-label="字幕分页"><button className="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1} / {pages}</span><button className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button><button className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)}>末页</button></nav>
      {reading ? <ol className="reading-list" aria-label="独立时间语段" start={page * 100 + 1}>{phraseRows.slice(page * 100, (page + 1) * 100).map(phrase => <li key={phrase.id}>
        <button className={`cue ${selected === phrase.id ? 'selected' : ''}`} title={`${timestamp(phrase.startMs)} → ${timestamp(phrase.endMs)} · ${video?.platform === 'bilibili' ? 'B站原始字幕时间' : 'YouTube 词级时间'}`} onClick={() => {
          setSelected(phrase.id); setPlayback('正在定位…');
          connectionRef.current?.send({ version: 1, type: 'seek', phraseId: phrase.id, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
        }}><span className="time">{timestamp(phrase.startMs)} → {timestamp(phrase.endMs)}</span><span className="text"><span className="reading-line">{phrase.text}</span></span></button>
      </li>)}</ol> : <ol aria-label="字幕时间组" start={page * 100 + 1}>{rows.slice(page * 100, (page + 1) * 100).map(row => <li key={row.id}>
        <button className={`cue ${selected === row.id ? 'selected' : ''}`} title={reading ? `原字幕时间组 ${timestamp(row.startMs)} → ${timestamp(row.endMs)}；组内语段共用定位` : undefined} disabled={row.startMs === null} onClick={() => {
          setSelected(row.id); setPlayback('正在定位…');
          connectionRef.current?.send({ version: 1, type: 'seek', cueId: row.cues[0].cueId, videoId: video?.videoId, session: video?.session, trackId: state.trackId });
        }}><span className="time">原条目 #{row.cues[0].sourceIndex + 1}{row.cues.length > 1 ? `–${row.cues.at(-1)!.sourceIndex + 1}` : ''} · {timestamp(row.startMs)} → {timestamp(row.endMs)}</span><span className="text">{row.text || '（空文本条目）'}</span>{row.notice ? <span className="warning">{row.notice}</span> : null}</button>
        <details><summary>原始事件（{row.cues.length} 条）</summary><pre>{JSON.stringify(row.cues.map(c => ({ cueId: c.cueId, startMs: c.startMs, endMs: c.endMs, raw: c.raw })), null, 2)}</pre></details>
      </li>)}</ol>}
    </> : null}
    <footer>SBD 本地断句 · 网站原始时间 · 无翻译请求</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
