import ts from 'typescript';
import assert from 'node:assert/strict';

const nodes = (node, predicate) => {
  const found = [];
  const walk = child => { if (predicate(child)) found.push(child); ts.forEachChild(child, walk); };
  walk(node); return found;
};
const parse = (source, jsx = false) => {
  const file = ts.createSourceFile(jsx ? 'main.tsx' : 'playback.ts', source, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, 'Source has syntax errors; refusing an ambiguous automatic rewrite');
  return file;
};
const attr = (element, name) => element.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === name)?.initializer;
const value = (element, name) => { const v = attr(element, name); return v && ts.isStringLiteral(v) ? v.text : undefined; };
const elements = file => nodes(file, ts.isJsxElement);
const unique = (items, label) => { assert.equal(items.length, 1, `Expected one ${label}; refusing a broad rewrite`); return items[0]; };
const replace = (source, node, text) => source.slice(0, node.getStart()) + text + source.slice(node.end);
const hasCall = (node, target) => nodes(node, ts.isCallExpression).some(call => call.expression.getText() === target);

export const SHADOWING_BUTTON = `<HoverHint content={playMode === 'shadowing'
        ? '逐句跟读已开启 · 句末停顿后自动下一句 (E)'
        : playMode === 'practice' ? '逐句跟读已关闭 · 当前为跟读练习 (E)'
          : '逐句跟读已关闭 · 视频连续播放 (E)'}>
        <button
          id="btn-sentence-shadowing"
          type="button"
          className="echo-mode-control shadowing-mode"
          data-tour="shadowing"
          aria-label="切换逐句跟读"
          aria-pressed={playMode === 'shadowing'}
          aria-keyshortcuts="E"
          onClick={toggleShadowing}
        >
          <AudioLines/><span>逐句跟读</span><kbd>E</kbd>
        </button>
      </HoverHint>`;
const BANNER = `<p className="echo-toast" role="status">{playback || (playMode === 'shadowing' ? '逐句跟读已开启 (E)'
      : playMode === 'practice' ? '跟读模式已开启：录音与听写练习'
        : playMode === 'manual' ? '手动按句模式：将在当前句尾暂停' : '自动连续播放已开启 (E)')}</p>`;

export function repairSidebar(input) {
  const crlf = input.includes('\r\n'); let source = input.replaceAll('\r\n', '\n'); const fixes = [];
  let file = parse(source, true);
  unique(nodes(file, n => ts.isVariableDeclaration(n) && n.name.getText() === 'toggleShadowing'), 'existing toggleShadowing function');
  const footer = unique(elements(file).filter(e => e.openingElement.tagName.getText() === 'footer' && value(e, 'className') === 'echo-player'), 'player footer');
  const children = footer.children.filter(ts.isJsxElement);
  const descendants = elements(footer);
  const replay = unique(descendants.filter(e => value(e, 'aria-label') === '重新播放当前句'), 'replay anchor');
  const directChild = element => { let current = element; while (current.parent !== footer) current = current.parent; return current; };
  const replayControl = directChild(replay);
  const buttons = descendants.filter(e => e.openingElement.tagName.getText() === 'button' && (value(e, 'id') === 'btn-sentence-shadowing'
    || e.children.some(c => c.getText().includes('逐句跟读'))));
  assert.ok(buttons.length <= 1, 'Duplicate shadowing text buttons; refusing to guess ownership');
  const button = buttons[0], click = button && attr(button, 'onClick');
  const valid = button && click && ts.isJsxExpression(click) && click.expression?.getText() === 'toggleShadowing'
    && value(button, 'id') === 'btn-sentence-shadowing' && attr(button, 'aria-pressed')?.getText().includes('playMode')
    && value(button, 'className')?.split(/\s+/).includes('shadowing-mode') && value(button, 'data-tour') === 'shadowing'
    && button.getText().includes('逐句跟读') && button.getText().includes('<kbd>E</kbd>')
    && children.indexOf(replayControl) === children.indexOf(directChild(button)) + 1
    && directChild(button).openingElement.tagName.getText() === 'HoverHint'
    && directChild(button).getText().includes('视频连续播放 (E)')
    && !hasCall(button, 'alert') && !hasCall(button, 'window.alert');
  if (!valid) {
    if (button) source = replace(source, directChild(button), '');
    file = parse(source, true);
    const anchor = unique(elements(file).filter(e => value(e, 'aria-label') === '重新播放当前句'), 'replay anchor');
    let anchorControl = anchor; while (anchorControl.parent.openingElement?.tagName?.getText?.() !== 'footer') anchorControl = anchorControl.parent;
    source = source.slice(0, anchorControl.getStart()) + SHADOWING_BUTTON + '\n      ' + source.slice(anchorControl.getStart());
    fixes.push('restored shadowing button, real handler, mode label and position');
  }
  file = parse(source, true);
  const banner = elements(file).filter(e => value(e, 'className') === 'echo-toast');
  assert.ok(banner.length <= 1, 'Ambiguous mode banner');
  const goodBanner = banner[0] && !ts.isConditionalExpression(banner[0].parent) && banner[0].getText().includes('playMode')
    && banner[0].getText().includes('逐句跟读已开启') && banner[0].getText().includes('自动连续播放');
  if (!goodBanner) {
    if (banner[0]) {
      const parent = banner[0].parent;
      const wrapped = ts.isConditionalExpression(parent) && ts.isJsxExpression(parent.parent) ? parent.parent : banner[0];
      source = replace(source, wrapped, BANNER);
    } else {
      const toolbar = unique(elements(file).filter(e => value(e, 'className') === 'echo-toolbar'), 'language toolbar');
      source = source.slice(0, toolbar.end) + '\n    ' + BANNER + source.slice(toolbar.end);
    }
    fixes.push('restored persistent mode banner');
  }
  parse(source, true);
  return { source: fixes.length ? (crlf ? source.replaceAll('\n', '\r\n') : source) : input, fixes };
}

export const BOUNDARY_METHOD = `enforceBoundary(trigger: BrakeTrigger = 'media-event') {
    const current = this.stateValue;
    const video = this.video;
    const owner = this.owner;
    if (!video || !owner || current.mode === 'auto' || current.phase !== 'playing' || !this.options.ownerActive(owner)) return;
    const detectedMs = video.currentTime * 1000;
    const isShadowingMode = current.mode === 'shadowing';
    const leadMs = isShadowingMode && trigger !== 'arm' ? 50 : this.brakeLeadMs();
    if (detectedMs < current.segment.endMs - leadMs) return;
    const errors = { boundaryDetectedErrorMs: detectedMs - current.segment.endMs, boundaryErrorMs: detectedMs - current.segment.endMs };
    const waitDurationMs = current.segment.endMs - current.segment.startMs;
    const waiting: PlaybackMachineState = current.mode === 'shadowing'
      ? { ...current, ...errors, phase: 'waiting', waitDurationMs, resumeAtMs: performance.now() + waitDurationMs }
      : { ...current, ...errors, phase: 'waiting' };
    this.stateValue = waiting;
    const pollTicks = this.brakePollTicks;
    this.clearBrakePoller();
    try { this.options.pauseAtBoundary?.(video); } catch { /* Element pause below remains authoritative. */ }
    video.pause();
    const pausedMs = video.currentTime * 1000;
    if (Math.abs(pausedMs - current.segment.endMs) > .5) video.currentTime = current.segment.endMs / 1000;
    const actualMs = video.currentTime * 1000;
    const boundaryErrorMs = actualMs - current.segment.endMs;
    const boundaryDetectedErrorMs = detectedMs - current.segment.endMs;
    this.options.onBrake?.(owner, { mode: current.mode, segment: current.segment, trigger,
      pollIntervalMs: BRAKE_POLL_INTERVAL_MS, leadMs, pollTicks, detectedMs, pausedMs, actualMs, driftMs: boundaryErrorMs });
    if (this.stateValue !== waiting || !this.operationCurrent(current.generation, owner, video)) return;
    const paused = { ...waiting, boundaryDetectedErrorMs, boundaryErrorMs };
    this.emit(paused);
    if (paused.mode === 'shadowing') this.scheduleShadowing(paused, owner);
    if (isShadowingMode) console.log('[SHADOWING_PAUSE_SUCCESS]', {
      start: current.segment.startMs / 1000, time: video.currentTime, end: current.segment.endMs / 1000,
    });
  }`;

export function repairPlayback(input) {
  const crlf = input.includes('\r\n'); let source = input.replaceAll('\r\n', '\n'); const fixes = [];
  let file = parse(source);
  let controller = unique(nodes(file, n => ts.isClassDeclaration(n) && n.name?.text === 'PrecisePlaybackController'), 'playback controller');
  const member = name => controller.members.find(n => n.name?.getText() === name);
  for (const name of ['stateValue', 'video', 'owner', 'options', 'brakeLeadMs', 'clearBrakePoller', 'emit', 'clear', 'bindVideo',
    'clearShadowingTimer', 'scheduleShadowing', 'resumeShadowing', 'operationCurrent'])
    assert.ok(member(name), `Unknown controller shape: missing ${name}`);
  const method = member('enforceBoundary');
  const conditions = method ? nodes(method, ts.isIfStatement).map(n => n.expression.getText()) : [];
  const guarded = method && hasCall(method, 'video.pause') && hasCall(method, 'this.clearBrakePoller') && hasCall(method, 'this.scheduleShadowing')
    && conditions.some(c => c.includes("current.mode === 'auto'") && c.includes("current.phase !== 'playing'"))
    && conditions.some(c => c.includes('detectedMs < current.segment.endMs - leadMs'));
  if (!guarded) {
    if (method) source = replace(source, method, BOUNDARY_METHOD);
    else { const pos = member('clear').getStart(); source = source.slice(0, pos) + BOUNDARY_METHOD + '\n\n  ' + source.slice(pos); }
    fixes.push('restored only enforceBoundary with guarded pause and sentence-duration automatic next cycle');
  }
  file = parse(source);
  controller = unique(nodes(file, n => ts.isClassDeclaration(n) && n.name?.text === 'PrecisePlaybackController'), 'playback controller');
  const binding = member('bindVideo');
  const listener = nodes(binding, ts.isCallExpression).some(call => call.expression.getText() === 'video.addEventListener'
    && call.arguments[0] && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'timeupdate' && hasCall(call, 'this.enforceBoundary'));
  if (!listener) {
    const anchor = nodes(binding, ts.isExpressionStatement).find(n => n.getText().includes("video.addEventListener('play'"));
    assert.ok(anchor, 'Missing media listener anchor; refusing a broad rewrite');
    const pos = anchor.getStart();
    source = source.slice(0, pos) + "video.addEventListener('timeupdate', () => this.enforceBoundary('media-event'), { signal });\n    " + source.slice(pos);
    fixes.push('restored timeupdate binding');
  }
  parse(source);
  return { source: fixes.length ? (crlf ? source.replaceAll('\n', '\r\n') : source) : input, fixes };
}
