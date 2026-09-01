import { useEffect, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { ArrowLeft, Check, ChevronDown, CircleSlash2, Database, KeyRound, Palette, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { SERVICE_CHANNEL, type DisplaySetting, type PublicSettings, type ServiceReply, type ThemeSetting } from '../lib/settings';
import { SUPADATA_ORIGIN } from '../lib/supadata';
import { applyTheme } from '../lib/theme';
import './settings-view.css';

const defaults: PublicSettings = { hasKey: false, language: 'en', theme: 'system', displayMode: 'phrases' };

async function service(type: string, payload = {}): Promise<ServiceReply> {
  return browser.runtime.sendMessage({ channel: SERVICE_CHANNEL, version: 1, type, ...payload });
}

function SettingSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void;
  options: readonly { value: string; label: string }[]; label: string }) {
  return <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger className="settings-select" aria-label={label}>
      <Select.Value/><Select.Icon><ChevronDown/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="settings-select-content" position="popper" sideOffset={6}>
      <Select.Viewport>{options.map(option => <Select.Item className="settings-select-item" value={option.value} key={option.value}>
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check/></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

export function SettingsView({ onBack, onSettings }: { onBack?: () => void; onSettings?: (settings: PublicSettings) => void }) {
  const [config, setConfig] = useState<PublicSettings>(defaults);
  const [key, setKey] = useState('');
  const [language, setLanguage] = useState('en');
  const [message, setMessage] = useState('正在读取设置…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void service('settings').then(reply => {
      if (!reply.ok || !reply.settings) { setMessage(reply.error ?? '设置读取失败'); return; }
      setConfig(reply.settings); setLanguage(reply.settings.language); applyTheme(reply.settings.theme);
      setMessage(reply.settings.hasKey ? 'Supadata Key 已保存，密钥不会回填显示。' : '尚未配置 Supadata。');
    }).catch(() => setMessage('未连接到扩展后台，请重新加载扩展后再试'));
  }, []);
  const accept = (settings: PublicSettings) => {
    setConfig(settings); setLanguage(settings.language); applyTheme(settings.theme); onSettings?.(settings);
  };
  async function savePreferences(theme: ThemeSetting, displayMode: DisplaySetting) {
    const optimistic = { ...config, theme, displayMode };
    accept(optimistic); setMessage('正在保存外观设置…');
    try {
      const reply = await service('save-preferences', { theme, displayMode });
      if (!reply.ok || !reply.settings) throw new Error(reply.error ?? '外观设置保存失败');
      accept(reply.settings); setMessage('外观设置已保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '外观设置保存失败'); }
  }
  async function updateApi(type: 'save' | 'delete') {
    setBusy(true); setMessage('正在处理字幕服务设置…');
    try {
      const reply = await service(type, { key, language });
      if (!reply.ok || !reply.settings) throw new Error(reply.error ?? '操作失败');
      accept(reply.settings); setKey('');
      setMessage(type === 'save' ? 'Supadata 设置已保存；保存本身不会调用字幕服务。' : 'Supadata Key 已删除，外观设置已保留。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '设置操作失败'); }
    finally { setBusy(false); }
  }
  async function testConnection() {
    setBusy(true); setMessage('正在申请访问并查询 Supadata 账户…');
    try {
      if (!await browser.permissions.request({ origins: [SUPADATA_ORIGIN] })) throw new Error('未授权 Supadata 域名访问');
      const reply = await service('test');
      if (!reply.ok || !reply.account) throw new Error(reply.error ?? '连接失败');
      setMessage(`连接成功 · 套餐 ${reply.account.plan} · 已用 ${reply.account.usedCredits} / ${reply.account.maxCredits} credits。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '授权或连接失败'); }
    finally { setBusy(false); }
  }
  return <main className="settings-page">
    <header className="settings-header">
      {onBack ? <button className="settings-back" aria-label="返回字幕" onClick={onBack}><ArrowLeft/></button> : <span/>}
      <h1>设置</h1><span/>
    </header>
    <div className="settings-scroll">
      <section className="settings-section">
        <div className="settings-section-title"><Palette/><div><h2>外观</h2><p>自定义侧栏的外观和字幕显示。</p></div></div>
        <div className="settings-card">
          <div className="settings-row"><div><strong>主题模式</strong><small>跟随系统，或固定浅色、深色。</small></div>
            <SettingSelect label="主题模式" value={config.theme} onChange={value => void savePreferences(value as ThemeSetting, config.displayMode)} options={[
              { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
            ]}/></div>
          <div className="settings-divider"/>
          <div className="settings-row"><div><strong>字幕显示</strong><small>自然语段用于学习，原始字幕用于核对。</small></div>
            <SettingSelect label="字幕显示" value={config.displayMode} onChange={value => void savePreferences(config.theme, value as DisplaySetting)} options={[
              { value: 'phrases', label: '自然语段' }, { value: 'raw', label: '原始字幕' },
            ]}/></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Sparkles/><div><h2>AI 服务</h2><p>为后续翻译与语言功能预留。</p></div></div>
        <div className="settings-card settings-disabled-card">
          <div className="settings-row"><div><strong>提供商与模型</strong><small>当前版本没有翻译调用，不会把字幕发送给模型。</small></div><span className="settings-pill">尚未启用</span></div>
          <div className="settings-availability"><CircleSlash2/><div><strong>Translator API · 不支持</strong><p>此处不会保存无用途的模型密钥，也不会伪装成已经接入。</p></div></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><KeyRound/><div><h2>字幕服务</h2><p>Supadata 只提取视频已有字幕。</p></div></div>
        <div className="settings-card settings-form">
          <label htmlFor="supadata-key">Supadata API Key</label>
          <input id="supadata-key" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={key} disabled={busy}
            placeholder={config.hasKey ? '已保存；留空保留原 Key' : '输入你自己的 Supadata Key'} onChange={event => setKey(event.target.value)}/>
          <p className="settings-help"><a href="https://dash.supadata.ai/" target="_blank" rel="noreferrer">打开 Supadata 控制台</a>。请勿把 Key 发到聊天。</p>
          <label htmlFor="subtitle-language">期望字幕语言代码</label>
          <input id="subtitle-language" value={language} maxLength={35} disabled={busy} placeholder="en" onChange={event => setLanguage(event.target.value)}/>
          <div className="settings-actions">
            <button disabled={busy || !language || (!key && !config.hasKey)} onClick={() => void updateApi('save')}>保存字幕设置</button>
            <button className="settings-secondary" disabled={busy || !config.hasKey || Boolean(key) || language !== config.language} onClick={() => void testConnection()}>测试连接</button>
          </div>
          <p className="settings-status" role="status">{message}</p>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Database/><div><h2>高级</h2><p>本地数据与恢复操作。</p></div></div>
        <div className="settings-card settings-actions-stack">
          <button className="settings-secondary" onClick={() => void savePreferences('system', 'phrases')}><RotateCcw/>恢复默认外观</button>
          <button className="settings-danger" disabled={busy || !config.hasKey} onClick={() => void updateApi('delete')}><Trash2/>删除 Supadata Key</button>
        </div>
      </section>
      <p className="settings-privacy"><Check/>Key 只保存在当前 Chrome 配置的扩展本地存储，不同步云端，也不会显示在页面 DOM 中。</p>
    </div>
  </main>;
}
