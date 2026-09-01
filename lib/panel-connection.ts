type Listener<T extends unknown[]> = {
  addListener(callback: (...args: T) => void): void;
  removeListener(callback: (...args: T) => void): void;
};
export type PanelPort = {
  onMessage: Listener<[unknown]>;
  onDisconnect: Listener<[]>;
  postMessage(message: unknown): void;
  disconnect(): void;
};
export type ConnectionApi = {
  query(): Promise<{ id?: number; windowId: number; url?: string }[]>;
  connect(tabId: number): PanelPort;
  lastError(): string | undefined;
  activated: Listener<[{ tabId: number; windowId: number }]>;
  updated: Listener<[number, { status?: string }]>;
};
export type ConnectionCallbacks = {
  reset(message: string, error?: boolean): void;
  message(message: unknown, tabId: number): void;
};

// Page reload destroys the content-script Port. Rebind on that tab's completion,
// not on unrelated tabs, and never let a late old-port callback clear a new one.
export function connectPanel(api: ConnectionApi, callbacks: ConnectionCallbacks) {
  let disposed = false;
  let generation = 0;
  let tabId: number | undefined;
  let windowId: number | undefined;
  let port: PanelPort | null = null;
  let removePortListeners = () => {};
  let handshake: ReturnType<typeof setTimeout> | undefined;

  function release() {
    generation++;
    clearTimeout(handshake);
    removePortListeners(); removePortListeners = () => {};
    const previous = port; port = null;
    previous?.disconnect();
  }
  function fail(message: string) {
    release(); callbacks.reset(message, true);
  }
  async function bind() {
    release();
    const token = generation;
    callbacks.reset('正在连接当前视频页面…');
    try {
      const tabs = await api.query();
      if (disposed || token !== generation) return;
      const active = tabs[0]; tabId = active?.id; windowId = active?.windowId;
      if (!active || tabId === undefined) { callbacks.reset('没有找到当前标签页', true); return; }
      // URL is omitted without matching host permissions. Do not request tabs
      // permission just to inspect unrelated sites.
      if (!active.url || !/^https:\/\/www\.(?:youtube\.com\/watch|bilibili\.com\/(?:video|list)\/)/.test(active.url)) {
        callbacks.reset('请切换到 YouTube 或 B 站视频页，再点击重新连接'); return;
      }
      const boundTabId = tabId;
      const next = api.connect(boundTabId); port = next;
      const current = () => !disposed && generation === token && port === next;
      const message = (value: unknown) => {
        if (!current()) return;
        clearTimeout(handshake);
        callbacks.message(value, boundTabId);
      };
      const disconnect = () => {
        // lastError exists only for the duration of this callback.
        const reason = api.lastError();
        if (!current()) return;
        fail(reason
          ? `连接失败：${reason.slice(0, 500)}。请刷新视频页面；加载完成后将自动重新连接。`
          : '视频页面连接已断开。页面加载完成后将自动重新连接，也可点击重新连接。');
      };
      next.onMessage.addListener(message); next.onDisconnect.addListener(disconnect);
      removePortListeners = () => { next.onMessage.removeListener(message); next.onDisconnect.removeListener(disconnect); };
      handshake = setTimeout(() => {
        if (current()) fail('连接未收到内容脚本应答。请检查扩展的视频网站访问权限，刷新视频后重试。');
      }, 5000);
    } catch (error) {
      if (!disposed && token === generation) fail(`连接失败：${error instanceof Error ? error.message.slice(0, 500) : '未知错误'}`);
    }
  }
  const activated = (active: { tabId: number; windowId: number }) => {
    if (windowId === undefined || active.windowId === windowId) void bind();
  };
  const updated = (updatedTabId: number, change: { status?: string }) => {
    if (updatedTabId !== tabId) return;
    if (change.status === 'loading') {
      release(); callbacks.reset('视频页面正在加载，完成后自动连接…');
    } else if (change.status === 'complete') {
      void bind();
    }
  };
  api.activated.addListener(activated); api.updated.addListener(updated);
  void bind();
  return {
    send(message: unknown) {
      if (!port || disposed) return;
      try { port.postMessage(message); } catch (error) {
        fail(`连接已断开：${error instanceof Error ? error.message.slice(0, 500) : '请重新连接'}`);
      }
    },
    dispose() {
      disposed = true; release(); api.activated.removeListener(activated); api.updated.removeListener(updated);
    },
  };
}
