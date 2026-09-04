// Browser-local CDP transport; never attaches to the user's daily browser.
export async function connect(endpoint) {
  const ws = new WebSocket(endpoint), pending = new Map(), listeners = new Set(); let id = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const job = pending.get(data.id); if (!job) return;
      pending.delete(data.id); clearTimeout(job.timer);
      if (data.error) job.reject(Error(data.error.message)); else job.resolve(data.result);
    } else for (const fn of listeners) fn(data);
  });
  ws.addEventListener('close', () => {
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('Test browser CDP closed')); }
    pending.clear();
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)); }, 15_000);
        pending.set(key, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { ws.close(); },
  };
}
