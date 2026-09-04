import { useEffect, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { ArrowLeft, Check, ChevronDown, CircleSlash2, Database, Languages, Palette, RotateCcw, Sparkles } from './icons';
import { SERVICE_CHANNEL, type PublicSettings, type ServiceReply, type ThemeSetting } from '../lib/settings';
import { applyTheme } from '../lib/theme';
import { YoudaoSettings } from './youdao-settings';
import './settings-view.css';

const defaults: PublicSettings = { language: 'en', theme: 'system', displayMode: 'phrases' };

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
  const [language, setLanguage] = useState('en');
  const [message, setMessage] = useState('正在读取设置…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void service('settings').then(reply => {
      if (!reply.ok || !reply.settings) { setMessage(reply.error ?? '设置读取失败'); return; }
      setConfig(reply.settings); setLanguage(reply.settings.language); applyTheme(reply.settings.theme);
      setMessage('设置已读取。字幕只从当前视频网站获取。');
    }).catch(() => setMessage('未连接到扩展后台，请重新加载扩展后再试'));
  }, []);
  const accept = (settings: PublicSettings) => {
    setConfig(settings); setLanguage(settings.language); applyTheme(settings.theme); onSettings?.(settings);
  };
  async function savePreferences(theme: ThemeSetting, nextLanguage = config.language) {
    const optimistic = { language: nextLanguage.trim(), theme, displayMode: 'phrases' as const };
    accept(optimistic); setMessage('正在保存设置…'); setBusy(true);
    try {
      const reply = await service('save-preferences', { theme, displayMode: 'phrases', language: optimistic.language });
      if (!reply.ok || !reply.settings) throw new Error(reply.error ?? '设置保存失败');
      accept(reply.settings); setMessage('设置已保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '设置保存失败'); }
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
            <SettingSelect label="主题模式" value={config.theme} onChange={value => void savePreferences(value as ThemeSetting)} options={[
              { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
            ]}/></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Languages/><div><h2>字幕</h2><p>选择原生字幕轨时优先使用的语言。</p></div></div>
        <div className="settings-card settings-form">
          <label htmlFor="subtitle-language">期望字幕语言代码</label>
          <input id="subtitle-language" value={language} maxLength={35} disabled={busy} placeholder="en"
            onChange={event => setLanguage(event.target.value)}/>
          <p className="settings-help">例如 en、en-GB、zh-CN。实际可选项仍以当前视频网站提供的字幕轨为准。</p>
          <div className="settings-actions"><button disabled={busy || !language.trim() || language.trim() === config.language}
            onClick={() => void savePreferences(config.theme, language)}>保存字幕语言</button></div>
        </div>
      </section>

      <YoudaoSettings/>
      <section className="settings-section">
        <div className="settings-section-title"><Sparkles/><div><h2>AI 服务</h2><p>为后续翻译与语言功能预留。</p></div></div>
        <div className="settings-card settings-disabled-card">
          <div className="settings-row"><div><strong>提供商与模型</strong><small>当前版本没有翻译调用，不会把字幕发送给模型。</small></div><span className="settings-pill">尚未启用</span></div>
          <div className="settings-availability"><CircleSlash2/><div><strong>Translator API · 不支持</strong><p>此处不会保存无用途的模型密钥，也不会伪装成已经接入。</p></div></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Database/><div><h2>高级</h2><p>本地数据与恢复操作。</p></div></div>
        <div className="settings-card settings-actions-stack">
          <button className="settings-secondary" disabled={busy} onClick={() => void savePreferences('system', 'en')}><RotateCcw/>恢复默认设置</button>
        </div>
      </section>
      <p className="settings-status" role="status">{message}</p>
      <p className="settings-privacy"><Check/>外观和字幕语言只保存在当前 Chrome 配置，不同步云端。</p>
    </div>
  </main>;
}
