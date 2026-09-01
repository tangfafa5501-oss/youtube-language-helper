import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPanel, supportedVideoUrl } from '../lib/panel-connection.ts';

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return { addListener: (fn: (...args: any[]) => void) => { listeners.add(fn); },
    removeListener: (fn: (...args: any[]) => void) => { listeners.delete(fn); },
    emit: (...args: any[]) => { for (const fn of listeners) fn(...args); },
    get size() { return listeners.size; }, snapshot: () => [...listeners] };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t: any, options: { handshake?: (value: unknown) => boolean; handshakeTimeoutMs?: number } = {}) {
  const activated = event(), updated = event();
  let active = { id: 1, windowId: 10, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  let error: string | undefined;
  const ports: any[] = [], resets: any[] = [], messages: any[] = [];
  const controller = connectPanel({ query: async () => [active], activated, updated, handshakeTimeoutMs: options.handshakeTimeoutMs,
    connect: id => {
      const port = { id, onMessage: event(), onDisconnect: event(), sent: [] as unknown[], closed: false,
        postMessage(m: unknown) { if (this.closed) throw Error('disconnected'); this.sent.push(m); },
        disconnect() { this.closed = true; } };
      ports.push(port); return port;
    }, lastError: () => error,
  }, { handshake: options.handshake, reset: (message, error) => resets.push({ message, error }), message: (message, tabId) => messages.push({ message, tabId }) });
  t.after(() => controller.dispose());
  return { activated, updated, ports, resets, messages, controller,
    setError: (value: string) => { error = value; },
    setActive: (id: number) => { active = { ...active, id }; },
  };
}
test('reload clears state and reconnects the same tab when loading completes', async t => {
  const h = setup(t); await tick();
  h.ports[0].onMessage.emit({ version: 1 });
  h.updated.emit(1, { status: 'loading' });
  assert.equal(h.ports[0].closed, true); assert.match(h.resets.at(-1).message, /加载/);
  h.updated.emit(1, { status: 'complete' }); await tick();
  assert.equal(h.ports.length, 2); assert.equal(h.ports[1].id, 1);
  h.ports[1].onMessage.emit({ version: 1 }); assert.equal(h.messages.length, 2);
});

test('only exact supported video URLs are connected', () => {
  assert.equal(supportedVideoUrl('https://www.youtube.com/watch?v=abcdefghijk'), true);
  assert.equal(supportedVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7?p=2'), true);
  assert.equal(supportedVideoUrl('https://www.bilibili.com/list/BV1GJ411x7h7'), true);
  for (const url of [
    'https://www.youtube.com/watchevil?v=abcdefghijk',
    'https://www.youtube.com/watch?v=short',
    'https://www.bilibili.com/videoevil/BV1GJ411x7h7',
    'https://www.bilibili.com/video/not-a-bvid',
    'https://www.youtube.com.evil.test/watch?v=abcdefghijk',
  ]) assert.equal(supportedVideoUrl(url), false);
});

test('an unrelated port message cannot fake a completed panel handshake', async t => {
  const h = setup(t, { handshake: value => typeof value === 'object' && value !== null && 'status' in value, handshakeTimeoutMs: 15 });
  await tick(); h.ports[0].onMessage.emit({ type: 'playback-state' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(h.resets.at(-1).message, /未收到内容脚本应答/);
  assert.equal(h.resets.at(-1).error, true);
});

test('a valid initial state completes the panel handshake', async t => {
  const h = setup(t, { handshake: value => typeof value === 'object' && value !== null && 'status' in value, handshakeTimeoutMs: 15 });
  await tick(); h.ports[0].onMessage.emit({ version: 1, status: 'ready' });
  const resetCount = h.resets.length;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.resets.length, resetCount);
});
test('Chrome disconnect error is preserved and disconnected ports cannot send', async t => {
  const h = setup(t); await tick(); h.setError('Could not establish connection. Receiving end does not exist.');
  h.ports[0].onDisconnect.emit();
  assert.match(h.resets.at(-1).message, /Receiving end does not exist/); assert.equal(h.resets.at(-1).error, true);
  h.controller.send({ type: 'load' }); assert.equal(h.ports[0].sent.length, 0);
});
test('unrelated tabs do not rebind, and late old-tab callbacks do not clear a new connection', async t => {
  const h = setup(t); await tick();
  const lateDisconnect = h.ports[0].onDisconnect.snapshot()[0];
  h.updated.emit(99, { status: 'complete' }); await tick(); assert.equal(h.ports.length, 1);
  h.setActive(2); h.activated.emit({ tabId: 2, windowId: 10 }); await tick();
  const before = h.resets.length; lateDisconnect();
  assert.equal(h.resets.length, before); h.controller.send({ type: 'load' });
  assert.equal(h.ports[1].sent.length, 1); assert.equal(h.ports[1].id, 2);
});
test('closing the panel removes event listeners and prevents reconnects', async t => {
  const h = setup(t); await tick(); h.controller.dispose();
  assert.equal(h.activated.size, 0); assert.equal(h.updated.size, 0);
  h.updated.emit(1, { status: 'complete' }); await tick(); assert.equal(h.ports.length, 1);
});
