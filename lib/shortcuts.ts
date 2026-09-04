import { PLAYER_SHORTCUTS } from './protocol.ts';

export const SHORTCUT_ACTIONS = ['play', 'previous', 'replay', 'next', 'shadowing', 'slower', 'faster', 'help', 'reserved',
  'dictation', 'record', 'play-recording', 'cancel-recording', 'pitch', 'dictation-focus',
  'expand-start', 'expand-end', 'contract-start', 'contract-end'] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export function isShortcutAction(value: unknown): value is ShortcutAction {
  return typeof value === 'string' && (SHORTCUT_ACTIONS as readonly string[]).includes(value);
}
type KeyInput = { code: string; key?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean;
  altKey?: boolean; repeat?: boolean; isComposing?: boolean; defaultPrevented?: boolean; target?: unknown; composedPath?: () => unknown[] };
const editing = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="menu"], [role="listbox"], [role="dialog"]';
// Capturing repeated Space lets callers suppress native button activation while
// skipping the repeated playback command. Other repeated keys remain ignored.
export function shortcutAction(event: KeyInput, captureSpaceRepeat = false): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || (event.repeat && !(captureSpaceRepeat && event.code === 'Space'))
    || event.isComposing || event.defaultPrevented) return null;
  const path = event.composedPath?.() ?? [event.target];
  const closest = (selector: string) => path.some(node => {
    const element = node as { closest?: (value: string) => unknown } | null;
    return typeof element?.closest === 'function' && Boolean(element.closest(selector));
  });
  if (closest(editing)) return null;
  if (event.key === '?') return 'help';
  if (event.code === 'BracketLeft') return event.shiftKey ? 'contract-start' : 'expand-start';
  if (event.code === 'BracketRight') return event.shiftKey ? 'contract-end' : 'expand-end';
  if (event.shiftKey) return event.code === PLAYER_SHORTCUTS.decreaseRate ? 'slower'
    : event.code === PLAYER_SHORTCUTS.increaseRate ? 'faster' : null;
  switch (event.code) {
    case PLAYER_SHORTCUTS.playOrPause: return 'play';
    case PLAYER_SHORTCUTS.previous: return 'previous';
    case PLAYER_SHORTCUTS.replay: return 'replay';
    case PLAYER_SHORTCUTS.next: return 'next';
    case PLAYER_SHORTCUTS.toggleEcho: return 'shadowing';
    case PLAYER_SHORTCUTS.toggleDictation: return 'dictation';
    case PLAYER_SHORTCUTS.record: return 'record';
    case PLAYER_SHORTCUTS.playRecording: return 'play-recording';
    case 'Escape': return 'cancel-recording';
    case 'KeyP': return 'pitch';
    case 'Slash': return 'dictation-focus';
    default: return null;
  }
}
