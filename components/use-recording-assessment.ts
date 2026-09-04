import { useEffect, useRef, useState } from 'react';
import { practiceDatabase, type PracticeRecording } from '../lib/practice-store';
import { AssessmentError, YOUDAO_CHANNEL, type AssessmentReply, type PronunciationAssessment } from '../lib/youdao';

const send = (type: string, payload = {}): Promise<AssessmentReply> => browser.runtime.sendMessage({ channel: YOUDAO_CHANNEL, version: 1, type, ...payload });
export function useRecordingAssessment(selected: PracticeRecording | undefined, disabled: boolean) {
  const [view, setView] = useState<{ id: string; result?: PronunciationAssessment; error?: string }>({ id: '' });
  const [pending, setPending] = useState(''), [open, setOpen] = useState(false);
  const job = useRef(false), alive = useRef(true), currentId = useRef(selected?.id); currentId.current = selected?.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setOpen(false); setView({ id: selected?.id ?? '', result: selected?.assessment });
    if (selected) void practiceDatabase.recordings.get(selected.id).then(row => {
      if (active && row?.assessment) setView({ id: row.id, result: row.assessment });
    }).catch(() => { if (active) setView({ id: selected.id, error: '无法读取已保存的评分，请稍后重试' }); });
    return () => { active = false; };
  }, [selected?.id]);
  const result = view.id === selected?.id ? view.result : undefined;
  const assess = async () => {
    if (!selected || disabled || job.current) return;
    if (result) { setOpen(true); return; }
    const id = selected.id;
    job.current = true; setPending(id); setView({ id });
    try {
      // Read again after a panel reload, or an assessment completed in another panel.
      const cached = await practiceDatabase.recordings.get(id);
      if (!cached) throw new AssessmentError('录音已删除，请重新选择');
      let assessment = cached.assessment;
      if (!assessment) {
        const config = await send('status');
        if (!config.ok || !config.configured || !config.permitted) throw new AssessmentError(config.error ?? '请先在设置中保存有道应用 ID 和应用密钥，并确认扩展具有有道访问权限');
        const { prepareAssessmentAudio } = await import('../lib/assessment-audio');
        const audio = await prepareAssessmentAudio(cached.audio);
        // Switching/deleting before submission must not trigger a paid background call.
        if (!alive.current || currentId.current !== id) return;
        const reply = await send('assess', { recordingId: id, audio });
        if (!reply.ok || !reply.assessment) throw new AssessmentError(reply.error ?? '有道未返回可用评分');
        assessment = reply.assessment;
      }
      if (alive.current && currentId.current === id) { setView({ id, result: assessment }); setOpen(true); }
    } catch (error) {
      if (alive.current && currentId.current === id) setView({ id, error: error instanceof AssessmentError ? error.message
        : '未能取得评估结果，可能已产生用量；请检查连接后再决定是否重试' });
    } finally { job.current = false; if (alive.current) setPending(''); }
  };
  return { result, error: view.id === selected?.id ? view.error : undefined, pending, open, setOpen, assess };
}
