import { APPLICATION_HOLDER_REQUIRED_CODE, APPLICATION_HOLDER_REQUIRED_TH } from '@/lib/i18n/error-code-map';

export type AutoSaveSyncState =
  | 'IDLE'
  | 'DIRTY_LOCAL'
  | 'SYNCING'
  | 'SYNCED'
  | 'OFFLINE_RETRY'
  | 'ERROR';

export type AutoSaveErrorKind = 'OFFLINE' | 'AUTH' | 'SERVER' | 'UNKNOWN' | 'CONFLICT' | 'OWNER';

interface ClassifyAutoSaveFailureOptions {
  isOnline?: boolean;
}

export function classifyAutoSaveFailure(
  errorMessage?: string | null,
  options: ClassifyAutoSaveFailureOptions = {},
): { syncState: AutoSaveSyncState; errorKind: AutoSaveErrorKind } {
  const raw = String(errorMessage || '').trim();
  const normalized = raw.toLowerCase();

  if (options.isOnline === false) {
    return { syncState: 'OFFLINE_RETRY', errorKind: 'OFFLINE' };
  }

  const offlineSignals = [
    'unable to connect to server',
    'request timeout',
    'failed to fetch',
    'network request failed',
    'networkerror',
    'timeout',
  ];

  if (offlineSignals.some((signal) => normalized.includes(signal))) {
    return { syncState: 'OFFLINE_RETRY', errorKind: 'OFFLINE' };
  }

  const authSignals = [
    'session expired',
    'sign in again',
    'unauthorized',
    'invalid token',
    'token has expired',
    'authentication failed',
  ];

  if (authSignals.some((signal) => normalized.includes(signal))) {
    return { syncState: 'ERROR', errorKind: 'AUTH' };
  }

  if (!raw) {
    return { syncState: 'ERROR', errorKind: 'UNKNOWN' };
  }

  return { syncState: 'ERROR', errorKind: 'SERVER' };
}

/**
 * autosave-lost-reply (staging walk 2026-10-02): what the pill says, in the applicant's
 * words. Each line names the cause and what happens next or what to do (thai-ui-copy).
 * The server's own text never reaches the pill: it is English, or a raw message, or an
 * HTTP number, and none of those tell the applicant what to do.
 */
export const AUTO_SAVE_COPY_TH = Object.freeze({
  offline: 'เครื่องของคุณออฟไลน์อยู่ คำตอบของคุณยังอยู่ในเครื่องนี้ ระบบจะบันทึกให้เมื่อกลับมาออนไลน์',
  retrying: 'การเชื่อมต่อขาดช่วง คำตอบของคุณยังอยู่ในเครื่องนี้ ระบบกำลังลองบันทึกใหม่ให้อัตโนมัติ',
  retryExhausted: 'ยังบันทึกไม่สำเร็จเพราะการเชื่อมต่อไม่เสถียร คำตอบของคุณยังอยู่ในเครื่องนี้ กดเพื่อลองบันทึกอีกครั้ง',
  sessionExpired: 'เซสชันของคุณหมดอายุ เข้าสู่ระบบอีกครั้งเพื่อบันทึกคำตอบต่อ',
  forbidden: 'บัญชีของคุณไม่มีสิทธิ์บันทึกคำขอนี้ รีเฟรชหน้าจอ หากยังบันทึกไม่ได้ให้ติดต่อเจ้าหน้าที่',
  statusChanged: 'คำขอของคุณเปลี่ยนสถานะไปแล้ว รีเฟรชหน้าจอเพื่อดูข้อมูลล่าสุด',
  tooFrequent: 'คุณบันทึกถี่เกินไป รอสักครู่แล้วกดเพื่อลองบันทึกอีกครั้ง',
  rejected: 'ระบบไม่รับข้อมูลที่บันทึกครั้งนี้ คำตอบของคุณยังอยู่ในเครื่องนี้ ตรวจคำตอบในขั้นนี้แล้วแก้ไขเพื่อบันทึกอีกครั้ง',
  serverError: 'ระบบขัดข้องขณะบันทึก คำตอบของคุณยังอยู่ในเครื่องนี้ รอสักครู่แล้วกดเพื่อลองบันทึกอีกครั้ง',
  unexpected: 'ระบบบันทึกคำตอบไม่สำเร็จ คำตอบของคุณยังอยู่ในเครื่องนี้ รีเฟรชหน้าจอแล้วลองอีกครั้ง',
  // Fix round 2 (P8): the save was not sent because of who is signed in, not the network.
  signedOut: 'คุณออกจากระบบแล้ว คำตอบของคุณยังอยู่ในเครื่องนี้ เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ',
  otherAccount: 'คำตอบในหน้านี้เป็นของบัญชีอื่น ระบบจึงไม่บันทึกด้วยบัญชีของคุณ เข้าสู่ระบบด้วยบัญชีเดิมเพื่อบันทึกต่อ',
});

/** HTTP statuses that mean "a gateway did not get an answer": the save may not have run. */
const RETRYABLE_STATUSES: readonly number[] = Object.freeze([502, 503, 504]);

/**
 * How the autosave retries a failure:
 *   AUTO   — by itself, with backoff, and again when the page comes back (lost reply,
 *            dropped connection, timeout, 502/503/504, offline);
 *   MANUAL — only when the applicant taps (500, 429, an unknown failure): one tap, one request;
 *   NONE   — never (a refusal: retrying sends the same thing and gets the same answer).
 */
export type AutoSaveRetryMode = 'AUTO' | 'MANUAL' | 'NONE';

export interface DraftSaveFailure {
  syncState: AutoSaveSyncState;
  errorKind: AutoSaveErrorKind;
  retry: AutoSaveRetryMode;
  /** User-facing Thai. Never the server's text. */
  message: string;
}

/**
 * Classify a failed POST /applications/draft from what api-client returned.
 *
 * A save is safe to repeat (the server writes the same row with the same data:
 * draft-save-repeat-is-harmless-real-postgres.test.js), so anything that may only have
 * lost the REPLY is retried automatically, and only a real refusal is red.
 */
export function classifyDraftSaveFailure(
  response: { status?: number | undefined; transportFailure?: string | undefined; error?: string | undefined; errorCode?: string | undefined; code?: string | undefined },
  options: ClassifyAutoSaveFailureOptions = {},
): DraftSaveFailure {
  // R2: the server wants a holder and there is none. A refusal: repeating the same body
  // gets the same answer, so no retry. The one catalogue sentence, never the server's text.
  if (response.errorCode === APPLICATION_HOLDER_REQUIRED_CODE || response.code === APPLICATION_HOLDER_REQUIRED_CODE) {
    return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'NONE', message: APPLICATION_HOLDER_REQUIRED_TH };
  }
  const status = typeof response.status === 'number' ? response.status : undefined;
  if (options.isOnline === false) {
    return { syncState: 'OFFLINE_RETRY', errorKind: 'OFFLINE', retry: 'AUTO', message: AUTO_SAVE_COPY_TH.offline };
  }
  if (response.transportFailure || (status !== undefined && RETRYABLE_STATUSES.includes(status))) {
    return { syncState: 'OFFLINE_RETRY', errorKind: 'OFFLINE', retry: 'AUTO', message: AUTO_SAVE_COPY_TH.retrying };
  }
  if (status === undefined) {
    // No status and no transport flag: api-client's 401 "session expired" path, or a
    // caller-side failure. The text classifier still knows the old sentences.
    const legacy = classifyAutoSaveFailure(response.error, options);
    if (legacy.errorKind === 'OFFLINE') {
      return { syncState: 'OFFLINE_RETRY', errorKind: 'OFFLINE', retry: 'AUTO', message: AUTO_SAVE_COPY_TH.retrying };
    }
    if (legacy.errorKind === 'AUTH') {
      return { syncState: 'ERROR', errorKind: 'AUTH', retry: 'NONE', message: AUTO_SAVE_COPY_TH.sessionExpired };
    }
    return { syncState: 'ERROR', errorKind: legacy.errorKind, retry: 'MANUAL', message: AUTO_SAVE_COPY_TH.unexpected };
  }
  if (status === 401) {
    return { syncState: 'ERROR', errorKind: 'AUTH', retry: 'NONE', message: AUTO_SAVE_COPY_TH.sessionExpired };
  }
  if (status === 403) {
    return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'NONE', message: AUTO_SAVE_COPY_TH.forbidden };
  }
  if (status === 409) {
    return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'NONE', message: AUTO_SAVE_COPY_TH.statusChanged };
  }
  if (status === 429) {
    return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'MANUAL', message: AUTO_SAVE_COPY_TH.tooFrequent };
  }
  if (status >= 400 && status < 500) {
    return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'NONE', message: AUTO_SAVE_COPY_TH.rejected };
  }
  return { syncState: 'ERROR', errorKind: 'SERVER', retry: 'MANUAL', message: AUTO_SAVE_COPY_TH.serverError };
}

/**
 * The automatic retry schedule after a lost reply: 2 s, 4 s, 8 s, 16 s, then 30 s (the
 * cap), five retries in all, about one minute. After that the autosave stops and the pill
 * offers a button; the page coming back (visible / focus / online) starts the schedule over.
 */
export const AUTO_SAVE_RETRY_BASE_MS = 2000;
export const AUTO_SAVE_RETRY_CAP_MS = 30000;
export const AUTO_SAVE_MAX_AUTO_RETRIES = 5;

/** Delay before automatic retry number `attempt` (0-based), or null when the retries are spent. */
export function autoSaveRetryDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= AUTO_SAVE_MAX_AUTO_RETRIES) { return null; }
  return Math.min(AUTO_SAVE_RETRY_BASE_MS * 2 ** attempt, AUTO_SAVE_RETRY_CAP_MS);
}
