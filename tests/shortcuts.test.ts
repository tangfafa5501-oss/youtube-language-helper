import test from 'node:test';
import assert from 'node:assert/strict';
import { isShortcutAction, shortcutAction } from '../lib/shortcuts.ts';

test('native keyboard decoder maps learning shortcuts without a focus library', () => {
  for (const [code, action] of [['KeyA', 'previous'], ['KeyS', 'replay'], ['KeyD', 'next'], ['KeyE', 'shadowing'],
    ['Space', 'play']]) assert.equal(shortcutAction({ code }), action);
  assert.equal(shortcutAction({ code: 'KeyK', key: 'k' }), null, 'K is no longer an extension shortcut');
  assert.equal(shortcutAction({ code: 'Comma', shiftKey: true }), 'slower');
  assert.equal(shortcutAction({ code: 'Period', shiftKey: true }), 'faster');
  assert.equal(shortcutAction({ code: 'Slash', key: '?', shiftKey: true }), 'help');
  assert.equal(shortcutAction({ code: 'KeyQ' }), null);
});

test('button focus keeps Space on play/pause rather than activating an unrelated control', () => {
  const button = { closest: (selector: string) => selector === 'button, [role="button"]' ? {} : null };
  assert.equal(shortcutAction({ code: 'KeyD', target: button }), 'next');
  assert.equal(shortcutAction({ code: 'KeyE', target: button }), 'shadowing');
  assert.equal(shortcutAction({ code: 'Space', target: button }), 'play');
});

test('typing, shadow-DOM editors, modifiers and key repeats never dispatch learning actions', () => {
  const editor = { closest: (selector: string) => selector.includes('contenteditable') ? {} : null };
  assert.equal(shortcutAction({ code: 'KeyE', target: editor }), null);
  assert.equal(shortcutAction({ code: 'KeyA', composedPath: () => [{}, editor] }), null);
  assert.equal(shortcutAction({ code: 'Space', target: editor }), null);
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'repeat', 'isComposing', 'defaultPrevented', 'shiftKey']) {
    assert.equal(shortcutAction({ code: 'KeyD', [flag]: true }), null);
  }
  for (const action of ['next', 'previous', 'replay', 'shadowing']) assert.equal(isShortcutAction(action), true);
  for (const action of [null, {}, 'arbitrary-action', '__proto__']) assert.equal(isShortcutAction(action), false);
});

test('repeat capture only consumes Space outside editors so native buttons cannot fire on keyup', () => {
  assert.equal(shortcutAction({ code: 'Space', repeat: true }), null);
  assert.equal(shortcutAction({ code: 'Space', repeat: true }, true), 'play');
  assert.equal(shortcutAction({ code: 'KeyD', repeat: true }, true), null);
  assert.equal(shortcutAction({ code: 'Space', repeat: true, target: { closest: () => ({}) } }, true), null);
});
