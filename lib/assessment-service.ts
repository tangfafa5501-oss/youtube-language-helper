import { trustedServiceSender } from './settings.ts';
import { AssessmentError, assessmentLanguage, requestAssessment, validCredentials, validateReference, type AssessmentReply,
  type PronunciationAssessment, type YoudaoCredentials } from './youdao.ts';

type Recording = { segment: { text: string; language?: string }; assessment?: PronunciationAssessment };
type Dependencies = { extensionId: string; protectedStorage: Promise<boolean>; permitted: () => Promise<boolean>;
  readCredentials: () => Promise<unknown>; writeCredentials: (value: YoudaoCredentials | null) => Promise<void>;
  getRecording: (id: string) => Promise<Recording | undefined>; saveAssessment: (id: string, value: PronunciationAssessment) => Promise<boolean>;
  fetcher?: typeof fetch; timeoutMs?: number };

/** One in-flight request per take, shared by all panels. No automatic retry of paid calls. */
export function createAssessmentService(deps: Dependencies) {
  const jobs = new Map<string, { promise: Promise<AssessmentReply>; controller: AbortController }>();
  let revision = 0;
  const invalidate = () => { revision++; for (const job of jobs.values()) job.controller.abort(); };
  const failure = (error: unknown): AssessmentReply => ({ ok: false, error: error instanceof AssessmentError ? error.message
    : '评估未完成，可能已产生用量；请检查网络后再决定是否重试' });
  return async (message: Record<string, unknown>, sender: { id?: string; url?: string }): Promise<AssessmentReply> => {
    const panel = trustedServiceSender(sender, deps.extensionId, 'sidepanel');
    if (!panel && !trustedServiceSender(sender, deps.extensionId, 'options')) return { ok: false, error: '拒绝非扩展设置页/侧边栏的评估请求' };
    try {
      if (!await deps.protectedStorage) throw new AssessmentError('本地凭据保护不可用，已停止读写和评估');
      if (message.type === 'status') return { ok: true, configured: validCredentials(await deps.readCredentials()), permitted: await deps.permitted() };
      if (message.type === 'save') {
        const credentials = { appKey: message.appKey, appSecret: message.appSecret };
        if (!validCredentials(credentials)) throw new AssessmentError('请填写有效的有道应用 ID 与应用密钥，不要填写 DeepSeek Key');
        if (!await deps.permitted()) throw new AssessmentError('扩展缺少有道访问权限，请检查扩展的网站访问设置');
        invalidate(); await deps.writeCredentials(credentials); return { ok: true, configured: true, permitted: true };
      }
      if (message.type === 'clear') { invalidate(); await deps.writeCredentials(null); return { ok: true, configured: false }; }
      if (message.type !== 'assess' || !panel || typeof message.recordingId !== 'string' || !/^[\w-]{1,100}$/.test(message.recordingId)) {
        throw new AssessmentError('评估请求参数异常');
      }
      const id = message.recordingId, existing = jobs.get(id); if (existing) return await existing.promise;
      if (jobs.size) throw new AssessmentError('另一条录音正在评估，请等待完成');
      const controller = new AbortController(), startedRevision = revision;
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 25_000);
      const run = async (): Promise<AssessmentReply> => {
        const recording = await deps.getRecording(id); if (!recording) throw new AssessmentError('录音已删除，请重新选择');
        if (recording.assessment) return { ok: true, assessment: recording.assessment };
        validateReference(recording.segment.text);
        const language = assessmentLanguage(recording.segment.language, recording.segment.text);
        const credentials = await deps.readCredentials();
        if (!validCredentials(credentials)) throw new AssessmentError('请先在设置中填写有道应用 ID 和应用密钥');
        if (!await deps.permitted()) throw new AssessmentError('扩展缺少有道访问权限，请检查扩展的网站访问设置');
        controller.signal.throwIfAborted();
        const result = await requestAssessment(message.audio as string, recording.segment.text, language, credentials, controller.signal, deps.fetcher);
        if (revision !== startedRevision || controller.signal.aborted) throw new AssessmentError('评估已取消或超时，可能已产生用量，未自动重试');
        // Update only: deleting a take while an HTTP request is running must never recreate it.
        if (!await deps.saveAssessment(id, result)) throw new AssessmentError('录音已删除，评估结果已丢弃');
        return { ok: true, assessment: result };
      };
      const promise = run().catch(error => controller.signal.aborted
        ? { ok: false, error: '评估已取消或超时，可能已产生用量，未自动重试' } : failure(error))
        .finally(() => { clearTimeout(timer); if (jobs.get(id)?.controller === controller) jobs.delete(id); });
      jobs.set(id, { promise, controller }); return await promise;
    } catch (error) { return failure(error); }
  };
}
