import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SERVICE_CHANNEL, type ServiceReply, type PublicSettings } from '../../lib/settings';
import { SUPADATA_ORIGIN } from '../../lib/supadata';
import '../sidepanel/style.css';
import './style.css';

async function service(type: string, payload = {}): Promise<ServiceReply> {
  return browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1, type, ...payload });
}
function Options() {
  const [config, setConfig] = useState<PublicSettings>({ hasKey: false, language: 'en' });
  const [key, setKey] = useState('');
  const [language, setLanguage] = useState('en');
  const [message, setMessage] = useState('正在读取设置…');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void service('settings').then(r => {
    if (r.ok && r.settings) { setConfig(r.settings); setLanguage(r.settings.language); setMessage(r.settings.hasKey ? '已保存 Key（不会回填或显示密钥）' : '尚未配置 Supadata'); }
    else setMessage(r.error ?? '设置读取失败');
  }).catch(() => setMessage('未连接到扩展后台，请重新加载扩展后打开设置')); }, []);
  async function update(type: 'save' | 'delete') {
    setBusy(true); setMessage('正在处理…');
    try {
      const r = await service(type, { key, language });
      if (!r.ok || !r.settings) { setMessage(r.error ?? '操作失败'); return; }
      setConfig(r.settings); setLanguage(r.settings.language); setKey('');
      setMessage(type === 'save' ? '已保存。现在可测试连接；保存本身不调用 Supadata。' : '已删除 Key，已停止本扩展在途请求。已提交的服务端任务仍可能消耗额度。');
    } catch { setMessage('设置操作失败，请重新加载扩展后重试'); }
    finally { setBusy(false); }
  }
  async function testConnection() {
    // Called directly from the user's click to preserve permission user gesture.
    const permission = browser.permissions.request({ origins: [SUPADATA_ORIGIN] });
    setBusy(true); setMessage('正在授权并查询 Supadata 账户…');
    try {
      if (!await permission) { setMessage('未授权 Supadata 访问，无法使用主字幕来源；网页直读仅为未修复的实验路径'); return; }
      const r = await service('test');
      if (r.ok && r.account) setMessage(`连接成功 · 套餐 ${r.account.plan} · 已用 ${r.account.usedCredits} / ${r.account.maxCredits} credits。这里只验证账户，不代表视频字幕读取已通过。`);
      else setMessage(r.error ?? '连接失败');
    } catch { setMessage('授权或连接失败，请检查网络后手动重试'); }
    finally { setBusy(false); }
  }
  return <main>
    <header><span className="badge">YOUTUBE LANGUAGE HELPER</span><h1>字幕 API 设置</h1><p>主字幕来源采用 YouTube Digest 的 Supadata 链路。保存后，新视频会话会自动读取一次字幕。</p></header>
    <section className="settings-card">
      <h2>Supadata · 只提取已有字幕</h2>
      <p>固定使用 <code>native</code> 模式，不自动生成字幕。服务返回条目会标注来源；未保证与网站原轨分段逐条一致。</p>
      <label htmlFor="key">Supadata API Key</label>
      <input id="key" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={key} disabled={busy}
        placeholder={config.hasKey ? '已保存；留空保留原 Key，填写则替换' : '在此粘贴你自己的 Supadata Key'} onChange={e => setKey(e.target.value)}/>
      <p className="meta"><a href="https://dash.supadata.ai/" target="_blank" rel="noreferrer">打开 Supadata 控制台获取 Key</a>。请勿将 Key 发到聊天。</p>
      <label htmlFor="language">期望字幕语言代码</label>
      <input id="language" value={language} maxLength={35} disabled={busy} placeholder="en" onChange={e => setLanguage(e.target.value)}/>
      <p className="meta">默认 en。若所选语言不可用，服务可能返回其他语言；面板会显示实际语言。</p>
      <div className="actions">
        <button disabled={busy || !language || (!key && !config.hasKey)} onClick={() => void update('save')}>保存设置</button>
        <button className="secondary" disabled={busy || !config.hasKey || !!key || language !== config.language} onClick={() => void testConnection()}>测试连接（查询账户）</button>
        <button className="secondary" disabled={busy || !config.hasKey} onClick={() => void update('delete')}>删除 Key</button>
      </div>
      <p role="status" className="status">{message}</p>
    </section>
    <section className="settings-card"><h2>数据与费用</h2><p>Key 仅保存在此 Chrome 配置的扩展本地存储，不同步云端；仅扩展可信页面/后台可访问。这不是系统密码保险箱，本机有权限的软件仍可能读取。</p>
      <p>测试按钮将 Key 发给 <strong>api.supadata.ai</strong> 的账户接口，不发送视频。打开新的 YouTube 视频会话时，扩展会发送当前视频的标准 URL 和 Key 并使用一次服务额度；三点菜单中的“重新获取字幕”会再次调用。不会发送 Cookie、其他标签页或浏览历史。</p>
      <p>未配置、未授权、没有字幕或额度不足时，不自动重试、不切换其他供应商、不调用 AI 转录。</p>
      <p><a href="https://supadata.ai/pricing" target="_blank" rel="noreferrer">查看官方价格</a> · <a href="https://docs.supadata.ai/get-transcript" target="_blank" rel="noreferrer">查看接口说明</a></p></section>
    <footer>保存后回到 YouTube 视频，侧边栏会自动开始获取字幕。无需配置 DeepSeek。</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Options/>);
