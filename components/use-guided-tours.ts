import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveStep, Driver } from 'driver.js';
import type { PlayMode } from '../lib/protocol';

export type GuidedTourKind = 'welcome' | 'shadowing' | 'practice';
type CompletionState = Record<GuidedTourKind, boolean>;

export const GUIDED_TOUR_STORAGE_KEY = 'ylh-guided-tours-v1';
export const EMPTY_TOUR_STATE: CompletionState = { welcome: false, shadowing: false, practice: false };

const welcomeSteps: DriveStep[] = [
  { popover: { title: '欢迎使用 Video Language Helper！', description: '用一分钟认识字幕阅读、逐句跟读和麦克风练习。你可以随时从“更多选项”重新打开本引导。' } },
  { element: '[data-tour="subtitle-selectors"]', popover: { title: '选择字幕', description: '分别选择主字幕与第二字幕。第二字幕只读取视频实际提供的轨道，不会自动编造翻译。', side: 'bottom', align: 'start' } },
  { element: '[data-tour="active-cue"]', popover: { title: '阅读与定位', description: '点击任一字幕即可跳转。后续句子会尽量居中，同时保留上下文。', side: 'bottom', align: 'center' } },
  { element: '[data-tour="transport"]', popover: { title: '播放控制', description: 'A 上一句，Space 播放或暂停，D 下一句。普通播放会取消旧的逐句跟读计时。', side: 'top', align: 'center' } },
  { element: '[data-tour="shadowing"]', popover: { title: '逐句跟读', description: '按 E 开启：播放一句，按该句时长停顿，再自动播放下一句。', side: 'top', align: 'center' } },
  { element: '[data-tour="replay"]', popover: { title: '重播当前句', description: '按 S 随时重新播放当前句或练习片段。', side: 'top', align: 'center' } },
  { element: '[data-tour="speed"]', popover: { title: '调整播放速度', description: '打开倍速面板，或用 Shift + < / > 减速、加速。跟读停顿不会随倍速缩短。', side: 'top', align: 'center' } },
  { element: '[data-tour="practice"]', popover: { title: '麦克风跟读练习', description: '按 F 单独开启录音、听写与音高练习；它不会自动跳到下一句。', side: 'top', align: 'end' } },
  { element: '[data-tour="actions"]', popover: { title: '随时重新查看', description: '在更多选项中可以刷新字幕、重新显示引导或打开设置。现在可以开始学习了！', side: 'bottom', align: 'end' } },
];

const shadowingSteps: DriveStep[] = [
  { popover: { title: '逐句跟读已开启', description: '这是纯停顿循环，不会请求麦克风，也不会显示录音或听写面板。' } },
  { element: '[data-tour="active-cue"]', popover: { title: '当前练习句', description: '暖色区域是正在播放或等待跟读的句子；停顿结束后会自动进入下一句。', side: 'bottom', align: 'center' } },
  { element: '[data-tour="shadowing"]', popover: { title: '独立模式开关', description: '再次点击或按 E 可关闭。点击普通播放或按 Space 也会恢复连续播放。', side: 'top', align: 'center' } },
  { element: '[data-tour="replay"]', popover: { title: '需要时重播', description: '按 S 可以重播当前句，不会把逐句跟读和麦克风练习混在一起。', side: 'top', align: 'center' } },
];

const practiceSteps: DriveStep[] = [
  { popover: { title: '麦克风跟读练习已开启', description: '片段播放一次后停住，留在当前片段供你录音、听写和比较语调。' } },
  { element: '[data-tour="active-cue"]', popover: { title: '练习片段', description: '整段高亮会作为一个区块尽量居中；片段过长时优先从顶部完整展示。', side: 'bottom', align: 'center' } },
  { element: '[data-tour="segment-controls"]', popover: { title: '调整片段范围', description: '用箭头扩展或收缩片段；[ / ] 扩展，配合 Shift 收缩。', side: 'bottom', align: 'center' } },
  { element: '[data-tour="practice-card"]', popover: { title: '录音与音高', description: '按 R 开始或停止录音；展开音高曲线可比较原声与自己的语调。', side: 'top', align: 'center' } },
  { element: '[data-tour="dictation"]', popover: { title: '听写模式', description: '按 H 隐藏字幕并输入听到的内容。听写只在麦克风跟读练习中出现。', side: 'top', align: 'center' } },
  { element: '[data-tour="practice"]', popover: { title: '退出练习', description: '再次点击或按 F 退出。逐句跟读 E 始终是另一套独立模式。', side: 'top', align: 'end' } },
];

export const GUIDED_TOUR_STEPS: Record<GuidedTourKind, DriveStep[]> = {
  welcome: welcomeSteps, shadowing: shadowingSteps, practice: practiceSteps,
};

export function useGuidedTours(ready: boolean, playMode: PlayMode) {
  const [completed, setCompleted] = useState<CompletionState | null>(null);
  const [active, setActive] = useState(false);
  const driverRef = useRef<Driver | null>(null), previousMode = useRef<PlayMode>(playMode);

  useEffect(() => {
    let mounted = true;
    void browser.storage.local.get(GUIDED_TOUR_STORAGE_KEY).then(stored => {
      if (!mounted) return;
      const value = stored[GUIDED_TOUR_STORAGE_KEY];
      setCompleted(value && typeof value === 'object' ? { ...EMPTY_TOUR_STATE, ...value } : EMPTY_TOUR_STATE);
    }).catch(() => { if (mounted) setCompleted(EMPTY_TOUR_STATE); });
    return () => { mounted = false; driverRef.current?.destroy(); };
  }, []);

  const start = useCallback(async (kind: GuidedTourKind, force = false) => {
    if ((!force && completed?.[kind]) || driverRef.current?.isActive()) return;
    setActive(true);
    try {
      const [{ driver }] = await Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]);
      const finish = () => {
        driverRef.current = null; setActive(false);
        setCompleted(previous => {
          const next = { ...(previous ?? EMPTY_TOUR_STATE), [kind]: true };
          void browser.storage.local.set({ [GUIDED_TOUR_STORAGE_KEY]: next });
          return next;
        });
      };
      const instance = driver({
        steps: GUIDED_TOUR_STEPS[kind], animate: true, smoothScroll: true, allowClose: true,
        allowKeyboardControl: true, disableActiveInteraction: true, skipMissingElement: true,
        waitForElement: 1200, overlayColor: '#102332', overlayOpacity: .42, stagePadding: 7, stageRadius: 13,
        popoverOffset: 12, showProgress: true, showButtons: ['next', 'previous', 'close'],
        nextBtnText: '下一步', prevBtnText: '上一步', doneBtnText: '完成', progressText: '第 {{current}} 步，共 {{total}}',
        popoverClass: `ylh-tour-popover ylh-tour-${kind}`,
        onPopoverRender: popover => { popover.closeButton.setAttribute('aria-label', '跳过引导'); },
        onDestroyed: finish,
      });
      driverRef.current = instance; instance.drive();
    } catch {
      driverRef.current = null; setActive(false);
    }
  }, [completed]);

  useEffect(() => {
    if (!ready || !completed || completed.welcome || active) return;
    const timer = setTimeout(() => void start('welcome'), 1200);
    return () => clearTimeout(timer);
  }, [active, completed, ready, start]);

  useEffect(() => {
    const before = previousMode.current;
    if (before === playMode || !ready || !completed || active) return;
    previousMode.current = playMode;
    const kind = playMode === 'shadowing' ? 'shadowing' : playMode === 'practice' ? 'practice' : null;
    if (!kind || completed[kind]) return;
    const timer = setTimeout(() => void start(kind), 500);
    return () => clearTimeout(timer);
  }, [active, completed, playMode, ready, start]);

  return { tourActive: active, startTour: start };
}
