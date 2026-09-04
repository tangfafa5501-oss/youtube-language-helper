import type { PracticeRecording } from './practice-store';
import { AssessmentError, type PronunciationAssessment } from './youdao';

/** Two background-only operations on the existing Dexie-created store.
 * Native IndexedDB avoids shipping a second copy of Dexie in the service worker.
 * Never create/upgrade the schema here; the recording UI owns that lifecycle.
 */
function recordingOperation<T>(id: string, mode: IDBTransactionMode, action: (row: PracticeRecording | undefined, store: IDBObjectStore) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { settled = true; reject(new AssessmentError('录音数据库暂不可用；请稍后重试，已提交的评估可能产生用量')); };
    const open = indexedDB.open('VideoLanguageHelperPractice');
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = fail; open.onblocked = fail;
    open.onsuccess = () => {
      const db = open.result; if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        const transaction = db.transaction('recordings', mode), store = transaction.objectStore('recordings');
        let result: T;
        transaction.oncomplete = () => { settled = true; db.close(); resolve(result); };
        transaction.onabort = () => { db.close(); fail(); };
        const get = store.get(id);
        get.onsuccess = () => { try { result = action(get.result, store); } catch { transaction.abort(); } };
      } catch { db.close(); fail(); }
    };
  });
}
export const readAssessmentRecording = (id: string) => recordingOperation(id, 'readonly', row => row);
export const saveRecordingAssessment = (id: string, assessment: PronunciationAssessment) => recordingOperation(id, 'readwrite', (row, store) => {
  if (!row) return false;
  store.put({ ...row, assessment }); return true;
});
