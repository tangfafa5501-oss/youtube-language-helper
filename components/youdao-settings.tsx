import { useEffect, useState } from 'react';
import { Sparkles } from './icons';
import { YOUDAO_CHANNEL, type AssessmentReply } from '../lib/youdao';

const send = (type: string, data = {}): Promise<AssessmentReply> => browser.runtime.sendMessage({ channel: YOUDAO_CHANNEL, version: 1, type, ...data });
export function YoudaoSettings() {
  const [appKey, setAppKey] = useState(''), [secret, setSecret] = useState(''), [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useState('正在读取配置状态…');
  useEffect(() => {
    let active = true;
    void send('status').then(reply => {
      if (!active) return;
      setReady(reply.ok); setConfigured(!!reply.configured);
      setMessage(!reply.ok ? reply.error ?? '配置读取失败' : reply.configured
        ? reply.permitted ? '已配置。密钥不会回显，尚未验证接口。' : '已配置，但扩展缺少有道访问权限。' : '尚未配置。');
    }).catch(() => { if (active) setMessage('无法连接扩展后台'); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    if (busy || !appKey.trim() || !secret.trim()) return;
    setBusy(true);
    try {
      const reply = await send('save', { appKey: appKey.trim(), appSecret: secret.trim() });
      if (!reply.ok) throw new Error(reply.error ?? '保存失败');
      setAppKey(''); setSecret(''); setConfigured(true);
      setMessage('已保存。录音后点击「评估发音 (V)」验证；保存不会产生评估调用。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try {
      const reply = await send('clear'); if (!reply.ok) throw new Error(reply.error ?? '清除失败');
      setConfigured(false); setAppKey(''); setSecret('');
      setMessage('有道凭据已清除；本地录音及已有评分保留。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '清除失败'); }
    finally { setBusy(false); }
  };
  return <section className="settings-section" aria-label="有道发音评估设置">
    <div className="settings-section-title"><Sparkles/><div><h2>发音评估 · 有道</h2><p>使用你自己的语音评测 API 应用，支持英语和中文。</p></div></div>
    <div className="settings-card settings-form">
      <label htmlFor="youdao-app-id">应用 ID（App Key）</label>
      <input id="youdao-app-id" value={appKey} onChange={event => setAppKey(event.target.value)} maxLength={256} disabled={busy || !ready}
        autoComplete="off" spellCheck={false} placeholder={configured ? '重新填写以替换现有配置' : '有道语音评测应用 ID'}/>
      <label htmlFor="youdao-app-secret">应用密钥（App Secret）</label>
      <input id="youdao-app-secret" type="password" value={secret} onChange={event => setSecret(event.target.value)} maxLength={256}
        disabled={busy || !ready} autoComplete="new-password" spellCheck={false} placeholder={configured ? '已保存，不回显' : '不是 DeepSeek API Key'}/>
      <p className="settings-help">在<a href="https://ai.youdao.com/" target="_blank" rel="noreferrer">有道控制台</a>创建并绑定「语音评测」，接入方式选 API。评估时会发送所选录音及其字幕给有道，并按你的账户计费；不会自动上传其他录音。</p>
      <p className="settings-help">凭据只存于本机扩展配置，不同步云端；禁止页面内容脚本读取，不代表系统级加密保险箱。替换或清除凭据会取消尚在等待的评估。</p>
      <div className="settings-actions"><button disabled={busy || !ready || !appKey.trim() || !secret.trim()} onClick={() => void save()}>保存有道配置</button>
        <button className="settings-secondary" disabled={busy || !configured} onClick={() => void clear()}>清除有道凭据</button></div>
      <p className="settings-status" role="status">{message}</p>
    </div>
  </section>;
}
