"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApplicationFlowStore, useWizardPersistSettled, useWizardStoreBase } from './use-application-flow-store';
import { api } from '@/lib/api/api-client';
import { forgetWizard } from '@/lib/wizard-session';
import { getStoredUser } from '@/lib/services/auth-service-session';
import { deriveLocationType } from '../steps/derive-location-type';
import {
  AUTO_SAVE_COPY_TH,
  autoSaveRetryDelay,
  classifyAutoSaveFailure,
  classifyDraftSaveFailure,
  type AutoSaveErrorKind,
  type AutoSaveSyncState,
} from './auto-save-status';

/**
 * autosave-lost-reply: where a failed save stands with respect to retrying.
 *   OFFLINE   — the browser says it is offline; `online` will retry;
 *   SCHEDULED — an automatic retry is waiting (backoff 2 s → 30 s);
 *   EXHAUSTED — the automatic retries are spent; the pill offers a button;
 *   MANUAL    — a red failure the applicant may retry by tapping (500, 429, unknown).
 */
export type AutoSaveRetryPhase = 'OFFLINE' | 'SCHEDULED' | 'EXHAUSTED' | 'MANUAL';

interface AutoSaveState {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
  errorKind: AutoSaveErrorKind | null;
  draftId: string | null;
  syncState: AutoSaveSyncState;
  // Optimistic-concurrency token returned by the backend on every
  // successful save. Echoed back as `expectedVersion` on the next
  // save so the backend can detect 2-tab concurrent writes.
  draftVersion: number | null;
  // Set when the backend returned 409 DRAFT_VERSION_CONFLICT —
  // another tab saved newer changes and the user should reload.
  hasConflict: boolean;
  /**
   * F-APPV2-02 — what the server decided about ประเภทคำขอ, when it did not agree.
   *
   * The save SUCCEEDED; this is not an error. `requestType` is server-owned because
   * RENEWAL and REPLACEMENT are judged by two rows instead of the whole ส่วนที่ ๓ set,
   * so the server grants that reading only against a live certificate the caller owns
   * and otherwise records the filing as NEW. Without this field the applicant would see
   * their document list quietly get longer and be told nothing — the same defect as a
   * refusal that reaches the browser as a bare code.
   */
  lawNotice: { code: string; messageTh: string } | null;
  /**
   * Round 5 (b): the server refused the application id this wizard was saving under, so
   * the id was dropped and the answers will be saved without it. Said once, in Thai,
   * and kept on screen for the rest of this visit (not cleared by the next save, which is
   * exactly the save it announces).
   */
  detachNotice: string | null;
  /** autosave-lost-reply: null when nothing is waiting to be retried. */
  retryPhase: AutoSaveRetryPhase | null;
}

interface UseAutoSaveReturn extends AutoSaveState {
  saveNow: () => Promise<void>;
  /** Retry a failed save now (the pill's button, and the page coming back). */
  retryNow: () => Promise<void>;
  markDirty: () => void;
  clearDraft: () => void;
  /** Drop local conflict state once the user has reloaded server data. */
  acknowledgeConflict: () => void;
}

type AutoSaveDependencies = {
  useApplicationFlowStore: typeof useApplicationFlowStore;
  api: Pick<typeof api, 'post' | 'delete'>;
  /** Has IndexedDB answered? Defaults to the store's own signal; tests pin it. */
  usePersistSettled?: () => boolean;
};

interface DraftSaveResponse {
  draftId?: string;
  id: string;
  /** Server-side optimistic-concurrency token (incremented per save). */
  version?: number;
  /**
   * F-APPV2-02 — set when the server did NOT grant the ประเภทคำขอ the applicant chose,
   * because RENEWAL and REPLACEMENT are only granted against a live certificate the
   * caller owns. The save still succeeded; the filing was recorded as NEW.
   */
  lawNotice?: { code: string; messageTh: string } | null;
  /** What the server actually recorded, after checking. */
  requestType?: string;
  certScope?: string;
}

const DEBOUNCE_DELAY = 3000;
/** Fix round 1 (M2): the least time between two retries triggered by page events. */
const COME_BACK_MIN_GAP_MS = 2000;

/**
 * Round 5 (b): the two refusals that mean "this id will never be saved again", and what
 * the applicant is told. Any other failure is retried as before.
 *   APPLICATION_NOT_EDITABLE (409) — the application was filed (or moved on) since.
 *   APPLICATION_NOT_FOUND   (404) — deleted, or not this user's (round 5 minor 1).
 */
export const DETACHED_NOTICE_TH: Readonly<Record<string, string>> = Object.freeze({
  APPLICATION_NOT_EDITABLE: 'คำขอนี้ยื่นไปแล้ว ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ',
  APPLICATION_NOT_FOUND: 'ไม่พบคำขอเดิมในบัญชีของคุณ ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ',
});

/**
 * Round 5b: read the machine code from `errorCode` (the envelope's own `code`) first. The
 * /draft route keeps its message in `error`, and api-client's `code` prefers `error`, so a
 * real 409 arrives with `code: 'Failed to save application'`. `code` / `error` stay as
 * fallbacks for envelopes that carry the code there.
 */
function detachNoticeFor(response: { errorCode?: string | undefined; code?: string | undefined; error?: string | undefined } | null | undefined): string | null {
  for (const candidate of [response?.errorCode, response?.code, response?.error]) {
    if (candidate && DETACHED_NOTICE_TH[candidate]) { return DETACHED_NOTICE_TH[candidate]!; }
  }
  return null;
}
const DEFAULT_DEPENDENCIES: AutoSaveDependencies = {
  useApplicationFlowStore,
  api,
  usePersistSettled: useWizardPersistSettled,
};

/**
 * autosave-lost-reply fix round 1 (C1): every draft save from this page carries
 * `{ saveSession, saveSeq }` beside `applicationId` (never inside formData). The session is
 * one random id per page load; the sequence only grows. The server refuses a save whose
 * sequence is not newer than the last one it applied for the same session (409
 * DRAFT_OUT_OF_ORDER, nothing written), so a slow older save can never land on top of a
 * newer one. Different sessions (another tab, a reload) are not compared: across tabs the
 * last writer still wins (the backlog (a)).
 */
const SAVE_SESSION: string = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') { return crypto.randomUUID(); }
  } catch { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
})();
let saveSeqCounter = 0;

export function nextSaveClock(): { saveSession: string; saveSeq: number } {
  saveSeqCounter += 1;
  return { saveSession: SAVE_SESSION, saveSeq: saveSeqCounter };
}

/**
 * Fix round 2 (3): the clock of the last save from this page that the server APPLIED, per
 * application. Submit names it, so the server can refuse to file answers another tab saved
 * after this page did (409 DRAFT_NOT_LATEST).
 */
const lastAppliedClocks = new Map<string, { saveSession: string; saveSeq: number }>();

function rememberAppliedClock(applicationId: string | null | undefined, clock: { saveSession: string; saveSeq: number }): void {
  if (!applicationId) { return; }
  const previous = lastAppliedClocks.get(applicationId);
  if (!previous || previous.saveSeq < clock.saveSeq) { lastAppliedClocks.set(applicationId, clock); }
}

/** `{ saveSession, lastAppliedSeq }` for a submit of `applicationId`, or null when this page saved nothing for it. */
export function submitClockFor(applicationId: string): { saveSession: string; lastAppliedSeq: number } | null {
  const clock = lastAppliedClocks.get(applicationId);
  return clock ? { saveSession: clock.saveSession, lastAppliedSeq: clock.saveSeq } : null;
}

/** The server's word for "a newer save from this page already landed". */
export const DRAFT_OUT_OF_ORDER = 'DRAFT_OUT_OF_ORDER';

function isOutOfOrder(response: { errorCode?: string | undefined; code?: string | undefined } | null | undefined): boolean {
  return response?.errorCode === DRAFT_OUT_OF_ORDER || response?.code === DRAFT_OUT_OF_ORDER;
}

/**
 * Fix round 1 (I3): may these answers be sent under the session signed in now? No when no
 * user is signed in (signed out, also in another tab: the stored user is shared by tabs, so
 * this covers cookie-only sessions too), and no when the answers are stamped with another
 * user. The store is left exactly as it is, so the owner gets it back on their next sign-in.
 */
export function answersBelongToSignedInUser(state: { ownerUserId?: string | undefined | null }): boolean {
  const userId = getStoredUser()?.id;
  if (!userId) { return false; }
  return !state.ownerUserId || String(state.ownerUserId) === String(userId);
}

function getAutoSaveErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || null;
  }

  if (typeof error === 'string') {
    const message = error.trim();
    return message || null;
  }

  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    const message = error.message.trim();
    return message || null;
  }

  return null;
}

/**
 * Everything the applicant has answered, ready to be sent as `formData`.
 *
 * The same deny-list as the dirty-check, and for the same reason: this used to be a
 * hand-typed object naming twenty-odd fields, and it was the THIRD copy of the old
 * wizard's field list on this path. All three were stale in the same way, so a filing
 * could be seen as changed, be allowed to save, and still arrive at the server with the
 * applicant's answers to steps 1 and 4 missing.
 *
 * The server keeps its own allow-list (`WIZARD_OWNED_FORM_DATA_KEYS`) and that one is a
 * security boundary, not a convenience — sending a key the server does not own changes
 * nothing. Sending everything the applicant answered is exactly what this side owes.
 */
export function answersForDraft(state: ReturnType<typeof useApplicationFlowStore>['state']): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const key of Object.keys(state) as Array<keyof typeof state>) {
    if (NOT_SENT_KEYS.includes(key as string)) { continue; }
    const value = state[key];
    // The raw zustand state (ensureLatestDraftSaved reads it) carries the actions too.
    if (value === undefined || typeof value === 'function') { continue; }
    answers[key as string] = value;
  }
  return answers;
}

/**
 * Has the applicant actually started filling this wizard?
 *
 * The point of asking is to not create a draft row for someone who merely opened the page.
 * It used to be asked as `state.plantId`, which was the OLD wizard's first question. The
 * six-step rebuild moved the plant to STEP 4, so that test silently became "save nothing
 * until the applicant reaches step 4": steps 1-3 were never persisted, a reload lost them,
 * and because steps 2 and 3 fetch their document cards BY the application id that only a
 * save produces, those steps showed no papers at all — with no message, because the fetch
 * is skipped rather than failed.
 *
 * Measured in a browser 2026-09-06 on a fresh filing: step 1 answered in full, six seconds
 * later the pill still read "พร้อมบันทึก".
 *
 * Three ways to have started, and each is a different real applicant:
 *   requestType   — answered the first question of the six-step wizard
 *   plantId       — a draft from the old wizard being resumed
 *   applicationId — an existing application being edited; its saves must never be dropped
 */
export function wizardHasStarted(state: ReturnType<typeof useApplicationFlowStore>['state']): boolean {
  return Boolean(state.requestType || state.plantId || state.applicationId);
}

/**
 * The only fields that are NOT an answer: the wizard's own bookkeeping about saving.
 *
 * They must be exempt in both directions. Counting them would make one save mark the
 * form dirty again (the save response writes applicationId / syncStatus), which is an
 * endless loop; and a timestamp changes on every write with nothing to save.
 */
export const HASH_EXEMPT_KEYS: readonly string[] = Object.freeze([
  'syncStatus',
  'hydrationEpoch',
  'resumePending',
  'ownerUserId',
  'applicationId',
  'applicationNumber',
  'lastSyncError',
  'createdAt',
  'updatedAt',
]);

/**
 * Keys the payload must NOT carry, beyond the bookkeeping above.
 *
 * Two different questions were being answered by one list and they are not the same:
 * "did anything change?" and "what do we send?".
 *   currentStep — IS a change worth saving (progress), and it travels in its own
 *                 `payload.step` field which the server judges against what was earned.
 *                 Sending it inside formData too would be a second, ungated way to claim
 *                 progress.
 *   milestone1  — the quotation and the amount owed. The finance rails own it; the wizard
 *                 holds it only to display what the server said (L3).
 */
export const NOT_SENT_KEYS: readonly string[] = Object.freeze([
  ...HASH_EXEMPT_KEYS,
  'currentStep',
  'milestone1',
]);


/**
 * "Has anything changed?" — asked over the WHOLE state minus the bookkeeping above.
 *
 * It used to be an allow-list of thirteen field names typed out by hand, and that list
 * was written for the wizard that came before this one. Seven fields the six-step wizard
 * writes were not on it — requestType, certScope, applicantType, previousCertificateNumber
 * (step 1) and varieties, varietiesNote, processing (step 4) — so answering step 1 in full
 * left the form CLEAN. No debounce fired, no draft row was created, `applicationId` stayed
 * empty, and steps 2/3/5 fetch their document cards BY that id: the applicant saw a bare
 * form with no papers listed and no message saying why, and lost every answer on reload.
 *
 * Found by walking the wizard in a real browser on 2026-09-06 — filled step 1, waited six
 * seconds, and the pill still read "พร้อมบันทึก".
 *
 * A deny-list is the fix, not seven more names: the next field added to the state is
 * covered the day it is added, and anything genuinely not an answer has to be declared
 * above where it can be read. Keys are sorted so the hash cannot move just because the
 * store happened to gain a key in a different order.
 */
export function buildStateHash(state: ReturnType<typeof useApplicationFlowStore>['state']) {
  try {
    const entries = (Object.keys(state) as Array<keyof typeof state>)
      .filter((key) => !HASH_EXEMPT_KEYS.includes(key as string))
      .sort()
      .map((key) => [key, state[key]] as const);
    return JSON.stringify(entries);
  } catch {
    return '';
  }
}

/**
 * What POST /applications/draft carries for a given wizard state — ONE builder for the
 * autosave and for the submit gate's last save (round 3), so the two can never send a
 * different shape for the same filing.
 */
export function buildDraftPayload(
  state: ReturnType<typeof useApplicationFlowStore>['state'],
  expectedVersion?: number,
) {
  const draftStep = Math.max(
    1,
    (Number.isFinite(state.currentStep) ? state.currentStep : 0) + 1,
  );
  return {
    // Round 4: WHICH application this save is for. Without it the server resolved the
    // applicant's latest DRAFT, so an edit to a REVISION_REQUESTED / CAR_PENDING filing
    // landed on another draft (or minted one) and submit filed the edited one stale. The
    // server honours an explicit id only in an applicant-editable status (the Bug 2.3
    // guard in applications.js findOrCreateApplicationForHealth). A brand-new filing has
    // none yet; the first save returns it and every later save carries it. Still kept
    // out of the change hash and out of formData (HASH_EXEMPT_KEYS / NOT_SENT_KEYS).
    applicationId: state.applicationId || undefined,
    plantId: state.plantId,
    serviceType: state.serviceType,
    areaType: state.siteTypes?.[0] || 'OUTDOOR',
    purpose: state.certificationPurposes?.[0] || null, // Legacy: backend expects single purpose for sorting
    cultivationMethods: state.cultivationMethods,
    step: draftStep,
    currentStep: state.currentStep,
    // Optimistic-concurrency token. Sent only after the first successful save (or first
    // load); on the very first save for a fresh wizard session it is undefined and the
    // backend takes the upsert path.
    expectedVersion,
    // ทุกคำตอบที่ผู้ยื่นให้ไว้ ไม่ใช่รายการที่พิมพ์ชื่อไว้ด้วยมือ (ดู answersForDraft
    // — รายการแบบนั้นค้างมาแล้วสามชุดบนเส้นทางเดียวกันนี้) · `locationType` เขียนทับ
    // ด้วยค่าที่คำนวณ เพื่อให้ร่างที่โหลดกลับมากับคำขอที่ยื่นแล้วตรงกัน
    formData: {
      ...answersForDraft(state),
      locationType: deriveLocationType(state),
    },
  };
}

/**
 * Round 3 — the mounted wizard's "save the latest edit now" (null when no wizard is on
 * screen). Registered by useAutoSave; read by ensureLatestDraftSaved.
 */
let activeDraftFlusher: (() => Promise<DraftGateResult>) | null = null;

/**
 * What the submit gate found. A string, not a boolean, since round 5: a refused id is
 * neither "saved" nor "try again" — retrying fails the same way forever.
 *   SAVED     — the server holds the latest edit (or there was nothing to save);
 *   NOT_SAVED — it could not be saved now (held, offline, server error): try again;
 *   DETACHED  — the server refused the id itself (409 not editable / 404 not found); the
 *               id was dropped and the answers will be saved without it.
 */
export type DraftGateResult = 'SAVED' | 'NOT_SAVED' | 'DETACHED';

type DraftGateDeps = {
  getState: () => ReturnType<typeof useApplicationFlowStore>['state'] & { resumePending?: boolean };
  setSyncStatus: (status: 'SYNCED' | 'PENDING' | 'ERROR') => void;
  post: (url: string, body: unknown) => Promise<{ success: boolean; data?: unknown; error?: string; code?: string; errorCode?: string }>;
  detachApplication: () => void;
};

const DEFAULT_DRAFT_GATE_DEPS: DraftGateDeps = {
  getState: () => useWizardStoreBase.getState() as unknown as ReturnType<DraftGateDeps['getState']>,
  setSyncStatus: (status) => useWizardStoreBase.getState().setSyncStatus(status),
  post: (url, body) => api.post(url, body),
  detachApplication: () => useWizardStoreBase.getState().detachApplication(),
};

/**
 * Round 3 — is the server's copy of THIS application the applicant's latest edit?
 *
 * Submit posts only `{ applicationId }`; the server files what it holds. An edit still
 * unsaved on the client (PENDING / ERROR, or held while the resume fetch is unresolved)
 * would be filed stale. This saves it first when it can and answers false when it cannot,
 * so the caller blocks the filing instead of filing old data.
 *   - store about another application, or already SYNCED → true, nothing sent;
 *   - held by the resume fetch → false: posting now could blank the server draft;
 *   - unsaved, wizard on screen → its own save (waits for one in flight);
 *   - unsaved, no wizard (the preview page) → one save of what the store holds.
 */
export async function ensureLatestDraftSaved(
  applicationId: string,
  deps: DraftGateDeps = DEFAULT_DRAFT_GATE_DEPS,
): Promise<DraftGateResult> {
  const state = deps.getState();
  if (!state || (state.applicationId ?? null) !== applicationId) { return 'SAVED'; }
  if (state.resumePending) { return 'NOT_SAVED'; }
  if (state.syncStatus === 'SYNCED') { return 'SAVED'; }
  if (!answersBelongToSignedInUser(state as { ownerUserId?: string })) { return 'NOT_SAVED'; }
  if (activeDraftFlusher) { return activeDraftFlusher(); }
  try {
    const clockSent = nextSaveClock();
    const response = await deps.post('/applications/draft', { ...buildDraftPayload(state), ...clockSent });
    if (!response?.success) {
      // A newer save from this page already landed: not a failure, and not "saved" either.
      if (isOutOfOrder(response)) { return 'NOT_SAVED'; }
      // Round 5 (b): the id itself is refused. Drop it (the answers stay, marked unsent,
      // so the next wizard mount saves them without the id); never file under it.
      if (detachNoticeFor(response)) {
        deps.detachApplication();
        return 'DETACHED';
      }
      deps.setSyncStatus('ERROR');
      return 'NOT_SAVED';
    }
    rememberAppliedClock(applicationId, clockSent);
    deps.setSyncStatus('SYNCED');
    return 'SAVED';
  } catch {
    deps.setSyncStatus('ERROR');
    return 'NOT_SAVED';
  }
}

/**
 * Fix round 2 (3): save what this page holds for `applicationId` now, even when it reads as
 * SYNCED (another tab may have saved over it). Used once after a 409 DRAFT_NOT_LATEST.
 */
export async function saveCurrentDraftNow(
  applicationId: string,
  deps: DraftGateDeps = DEFAULT_DRAFT_GATE_DEPS,
): Promise<DraftGateResult> {
  const state = deps.getState();
  if (!state || (state.applicationId ?? null) !== applicationId) { return 'NOT_SAVED'; }
  deps.setSyncStatus('PENDING');
  return ensureLatestDraftSaved(applicationId, deps);
}

/**
 * Round 5 (a): the server accepted the filing of `applicationId`; the wizard lets go of it,
 * so the next "ยื่นคำขอใหม่" starts empty instead of saving under a filed id (409 forever).
 *
 * Only when the store is about THIS application: filing X from the preview page must not
 * wipe a different filing the applicant has open in the wizard.
 *
 * When the wizard is still on screen (step 6 submits from inside it) the reset waits until
 * it unmounts. Emptying it in place would make the step page's guard bounce to step 1
 * while the push to the payments page is in flight, and leave a bounce notice behind.
 */
let forgetOnLeave: string | null = null;

type ForgetDeps = {
  getState: () => { applicationId?: string };
  forget: () => Promise<void>;
};

const DEFAULT_FORGET_DEPS: ForgetDeps = {
  getState: () => useWizardStoreBase.getState(),
  forget: forgetWizard,
};

export async function forgetFiledApplication(
  applicationId: string,
  deps: ForgetDeps = DEFAULT_FORGET_DEPS,
): Promise<void> {
  if ((deps.getState().applicationId ?? null) !== applicationId) { return; }
  if (activeDraftFlusher) {
    forgetOnLeave = applicationId;
    return;
  }
  await deps.forget();
}

/** The wizard is leaving the screen: carry out a reset deferred by forgetFiledApplication. */
function forgetDeferredOnLeave(): void {
  const filedId = forgetOnLeave;
  forgetOnLeave = null;
  if (filedId && useWizardStoreBase.getState().applicationId === filedId) {
    void forgetWizard();
  }
}

export function useAutoSave(dependencies: AutoSaveDependencies = DEFAULT_DEPENDENCIES): UseAutoSaveReturn {
  const { state, setSyncStatus, setApplicationId, detachApplication } = dependencies.useApplicationFlowStore();
  const persistSettled = (dependencies.usePersistSettled ?? useWizardPersistSettled)();
  // Round 2 (2026-10-02, data loss already on main): no save may leave while the store
  // has not finished loading — IndexedDB not answered yet, or the step page's resume
  // fetch (GET /applications/draft) still in flight. A save then POSTs a near-empty
  // store; with no applicationId the server lands it on the applicant's latest open
  // draft and the empty values overwrite the stored ones (applications.js /draft merge).
  const holdSaves = !persistSettled || Boolean(state.resumePending);
  const holdSavesRef = useRef(holdSaves);
  holdSavesRef.current = holdSaves;
  // Round 2 M2: what the store holds NOW, readable after an await.
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>({
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    error: null,
    errorKind: null,
    draftId: null,
    syncState: 'IDLE',
    draftVersion: null,
    hasConflict: false,
    lawNotice: null,
    detachNotice: null,
    retryPhase: null,
  });

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastStateHash = useRef<string>('');
  // O1 — the load epoch the baseline hash was taken at. `undefined` = not yet
  // (first run after mount), so whatever the wizard mounts on is a baseline too.
  const baselineEpoch = useRef<number | undefined>(undefined);
  // Keep `draftVersion` available to the saveDraft closure without
  // re-creating the callback every time the version changes. Same
  // pattern as lastStateHash above; saveDraft is invoked via a ref
  // so capturing the latest version this way is safe.
  const draftVersionRef = useRef<number | null>(null);
  draftVersionRef.current = autoSaveState.draftVersion;

  // Round 3: the save in flight, so the submit gate can wait for it instead of racing it.
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  // Round 5: set when a save found its id refused, so the gate can tell "refused for good"
  // from "try again".
  const detachedRef = useRef(false);
  // autosave-lost-reply: the automatic retry after a reply that may only have been lost.
  // `retryAttemptRef` counts automatic retries since the last success or fresh start;
  // `retryModeRef` says whether the last failure may be retried and how.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const retryModeRef = useRef<'AUTO' | 'MANUAL' | 'NONE'>('NONE');
  // Fix round 1 (C1): the newest save sequence whose answer was applied here.
  const lastAppliedSeqRef = useRef(0);
  // Fix round 1 (M2): when a page event last triggered a retry.
  const lastComeBackAtRef = useRef(0);
  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const saveDraft = useCallback(async (): Promise<boolean> => {
    // Fix round 1 (C1): what is sent is the store as it is NOW, read after any wait, never
    // the copy this callback closed over when it was scheduled.
    const state = latestStateRef.current;
    // ด่านเดียวกับใน effect ด้านล่าง และเป็นด่านที่สองที่เคยถาม `plantId` — พืชคือคำถามของ
    // ขั้นที่ 4 ในรุ่นหกขั้น การถามที่นี่จึงแปลว่า "ห้ามบันทึกจนกว่าจะถึงขั้น 4" อีกที
    if (!wizardHasStarted(state) || holdSavesRef.current) {
      return false;
    }
    // Fix round 1 (I3): never send one user's answers under another user's session. Nothing
    // is changed: no detach, no error, the store stays for its owner.
    if (!answersBelongToSignedInUser(state)) {
      clearRetryTimer();
      // Fix round 2 (P8): say why, in the applicant's words, instead of leaving the pill
      // promising an automatic retry that will not happen while this account is signed in.
      const signedOut = !getStoredUser()?.id;
      setAutoSaveState((previous) => ({
        ...previous,
        isSaving: false,
        error: signedOut ? AUTO_SAVE_COPY_TH.signedOut : AUTO_SAVE_COPY_TH.otherAccount,
        errorKind: signedOut ? 'AUTH' : 'OWNER',
        syncState: 'ERROR',
        retryPhase: null,
      }));
      return false;
    }
    const run = saveDraftOnce();
    inFlightSaveRef.current = run;
    try {
      return await run;
    } finally {
      if (inFlightSaveRef.current === run) { inFlightSaveRef.current = null; }
    }

    /**
     * Arm (or not) the next automatic retry after a failure, and say where it stands.
     * Never re-arms for a refusal (NONE) or a tap-only failure (MANUAL): no 4xx loop.
     */
    function afterFailure(mode: 'AUTO' | 'MANUAL' | 'NONE', kind: AutoSaveErrorKind): AutoSaveRetryPhase | null {
      clearRetryTimer();
      retryModeRef.current = mode;
      if (mode === 'NONE') { retryAttemptRef.current = 0; return null; }
      if (mode === 'MANUAL') { retryAttemptRef.current = 0; return 'MANUAL'; }
      const delay = autoSaveRetryDelay(retryAttemptRef.current);
      if (delay === null) { return 'EXHAUSTED'; }
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void requestSaveRef.current();
      }, delay);
      const offline = kind === 'OFFLINE' && typeof navigator !== 'undefined' && navigator.onLine === false;
      return offline ? 'OFFLINE' : 'SCHEDULED';
    }

    async function saveDraftOnce(): Promise<boolean> {
    const sentHash = buildStateHash(state);

    setAutoSaveState((previous) => ({
      ...previous,
      isSaving: true,
      error: null,
      errorKind: null,
      syncState: 'SYNCING',
    }));
    setSyncStatus('PENDING');

    const clock = nextSaveClock();
    try {
      const draftData = { ...buildDraftPayload(state, draftVersionRef.current ?? undefined), ...clock };

      const response = await dependencies.api.post<DraftSaveResponse>('/applications/draft', draftData);

      // Fix round 1 (C1): an answer older than one already applied says nothing about now.
      if (clock.saveSeq < lastAppliedSeqRef.current) {
        return false;
      }

      if (!response.success && isOutOfOrder(response)) {
        // A newer save from this page already landed on the server. Not an error, not a
        // retry, not a detach: whatever this one carried is already superseded.
        retryModeRef.current = 'NONE';
        clearRetryTimer();
        setAutoSaveState((previous) => ({
          ...previous,
          isSaving: false,
          error: null,
          errorKind: null,
          syncState: 'DIRTY_LOCAL',
          retryPhase: null,
        }));
        return false;
      }

      if (!response.success) {
        // Round 5 (b): the id itself is refused (409 APPLICATION_NOT_EDITABLE: filed since;
        // 404 APPLICATION_NOT_FOUND: deleted or not this user's). Retrying under it fails
        // forever, so: drop the id, keep every answer, say so, and re-arm the autosave so
        // its next pass saves them with no id and no version token. The server lands an
        // id-less save on the latest open DRAFT, or creates one: so the notice says
        // "ร่างคำขอ", never "ร่างใหม่" (the backlog: it may land on another DRAFT). The refused
        // application is never written or resubmitted.
        const detachCopy = draftData.applicationId
          ? detachNoticeFor(response)
          : null;
        if (detachCopy) {
          clearRetryTimer();
          retryAttemptRef.current = 0;
          retryModeRef.current = 'NONE';
          detachedRef.current = true;
          lastStateHash.current = '';
          detachApplication();
          setAutoSaveState((previous) => ({
            ...previous,
            isSaving: false,
            isDirty: true,
            error: null,
            errorKind: null,
            syncState: 'DIRTY_LOCAL',
            draftId: null,
            draftVersion: null,
            hasConflict: false,
            detachNotice: detachCopy,
            retryPhase: null,
          }));
          return false;
        }
        // Distinguish DRAFT_VERSION_CONFLICT (409 — another tab won)
        // from generic save failures so the UI can prompt the user
        // to reload instead of silently retrying.
        const isConflict = response.error === 'DRAFT_VERSION_CONFLICT';
        if (isConflict) {
          clearRetryTimer();
          retryModeRef.current = 'NONE';
          setAutoSaveState((previous) => ({
            ...previous,
            isSaving: false,
            error: 'อีกแท็บได้บันทึกร่างไปก่อนหน้านี้แล้ว โปรดโหลดข้อมูลล่าสุด',
            errorKind: 'CONFLICT' as AutoSaveErrorKind,
            syncState: 'ERROR',
            hasConflict: true,
            retryPhase: null,
          }));
          setSyncStatus('ERROR');
          return false;
        }
        // autosave-lost-reply: a reply that may only have been LOST (a 2xx whose body never
        // arrived, a dropped connection, a timeout, 502/503/504) is amber and retried; the
        // server may already hold this save, and repeating it is harmless. Only a real
        // refusal is red, and the pill says why in Thai, never in the server's words.
        const failure = classifyDraftSaveFailure(response, {
          ...(typeof navigator !== 'undefined' ? { isOnline: navigator.onLine } : {}),
        });
        const retryPhase = afterFailure(failure.retry, failure.errorKind);
        setAutoSaveState((previous) => ({
          ...previous,
          isSaving: false,
          error: retryPhase === 'EXHAUSTED' ? AUTO_SAVE_COPY_TH.retryExhausted : failure.message,
          errorKind: failure.errorKind,
          syncState: failure.syncState,
          retryPhase,
        }));
        setSyncStatus('ERROR');
        return false;
      }

      // Round 2 M2: the save answered for what was SENT. If the applicant has typed since
      // (an edit made while the request was in flight), the store is not synced: it stays
      // PENDING and keeps its newer baseline, so leaving now cannot lose that edit — the
      // next mount sees PENDING and sends it.
      lastAppliedSeqRef.current = clock.saveSeq;
      rememberAppliedClock(response.data?.draftId || response.data?.id || state.applicationId, clock);
      const caughtUp = buildStateHash(latestStateRef.current) === sentHash;
      clearRetryTimer();
      retryAttemptRef.current = 0;
      retryModeRef.current = 'NONE';
      const now = new Date();
      setAutoSaveState((previous) => ({
        ...previous,
        isDirty: !caughtUp,
        isSaving: false,
        lastSavedAt: now,
        errorKind: null,
        draftId:
          response.data?.draftId
          || response.data?.id
          || previous.draftId,
        // Capture the new version so the next save sends it back as
        // expectedVersion. Server increments per save.
        draftVersion:
          typeof response.data?.version === 'number'
            ? response.data.version
            : previous.draftVersion,
        syncState: caughtUp ? 'SYNCED' : 'DIRTY_LOCAL',
        hasConflict: false,
        retryPhase: null,
        // null clears a notice the applicant has since fixed.
        lawNotice: response.data?.lawNotice ?? null,
      }));
      if (caughtUp) {
        lastStateHash.current = sentHash;
        setSyncStatus('SYNCED');
      }

      // Tell the WIZARD which application this now is — not just this hook's own state.
      //
      // The id was kept in `autoSaveState.draftId` and nowhere else, so the store's
      // `applicationId` stayed null after a perfectly successful save. Steps 2, 3 and 5 ask
      // the server for their document cards BY that id and skip the fetch when it is empty
      // (`if (!appId) return`), so the applicant saw those steps with no papers listed at
      // all and no message explaining why — the requirements lens was never asked.
      const savedId = response.data?.draftId || response.data?.id;
      if (savedId && savedId !== state.applicationId) {
        setApplicationId(savedId);
      }
      return caughtUp;
    } catch (error: unknown) {
      const errorMessage = getAutoSaveErrorMessage(error) || 'Unable to connect to server';
      const failure = classifyAutoSaveFailure(errorMessage, {
        ...(typeof navigator !== 'undefined' ? { isOnline: navigator.onLine } : {}),
      });
      const offline = failure.errorKind === 'OFFLINE';
      const retryPhase = afterFailure(offline ? 'AUTO' : 'MANUAL', failure.errorKind);
      setAutoSaveState((previous) => ({
        ...previous,
        isSaving: false,
        error: retryPhase === 'EXHAUSTED'
          ? AUTO_SAVE_COPY_TH.retryExhausted
          : offline
            ? (retryPhase === 'OFFLINE' ? AUTO_SAVE_COPY_TH.offline : AUTO_SAVE_COPY_TH.retrying)
            : AUTO_SAVE_COPY_TH.unexpected,
        errorKind: failure.errorKind,
        syncState: failure.syncState,
        retryPhase,
      }));
      setSyncStatus('ERROR');
      return false;
    }
    }
  }, [setSyncStatus, setApplicationId, detachApplication, dependencies]);

  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  /**
   * Fix round 1 (C1): the ONE way any path asks for a save (debounce, retry timer, retryNow,
   * page events, saveNow, the submit gate). Saves never overlap: while one is in flight, the
   * next request waits for it and then sends the store as it is at that moment. Requests
   * that arrive during the wait share that one queued save.
   */
  const queuedSaveRef = useRef<Promise<boolean> | null>(null);
  const requestSave = (): Promise<boolean> => {
    if (queuedSaveRef.current) { return queuedSaveRef.current; }
    const inFlight = inFlightSaveRef.current;
    if (!inFlight) { return saveDraftRef.current(); }
    const queued = inFlight.catch(() => false).then(() => {
      queuedSaveRef.current = null;
      return requestSave();
    });
    queuedSaveRef.current = queued;
    return queued;
  };
  const requestSaveRef = useRef(requestSave);
  requestSaveRef.current = requestSave;

  // Round 3: while this wizard is on screen, the submit gate saves through it — the same
  // request, the same version token, and it waits for a save already in flight.
  useEffect(() => {
    const flush = async (): Promise<DraftGateResult> => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      detachedRef.current = false;
      if (inFlightSaveRef.current) {
        const saved = await inFlightSaveRef.current;
        // Round 5: a save in flight that found its id refused is final: do not follow it
        // with a save of the detached store, which would land on another draft and report
        // "saved" for the application being filed.
        if (detachedRef.current) { return 'DETACHED'; }
        if (saved) { return 'SAVED'; }
      }
      const saved = await requestSaveRef.current();
      if (detachedRef.current) { return 'DETACHED'; }
      return saved ? 'SAVED' : 'NOT_SAVED';
    };
    activeDraftFlusher = flush;
    return () => {
      if (activeDraftFlusher === flush) {
        activeDraftFlusher = null;
        // Round 5 (a): a filing accepted while this wizard was on screen is forgotten now.
        forgetDeferredOnLeave();
      }
    };
  }, []);

  const saveNow = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }

    await requestSaveRef.current();
  }, []);

  // autosave-lost-reply: the pill's button, and the page coming back. Only a failure that
  // may be retried is (a refusal is not), the backoff starts over, and a save already in
  // flight is left to answer. It re-sends the CURRENT store through the same builder.
  const retryNow = useCallback(async () => {
    if (retryModeRef.current === 'NONE') { return; }
    clearRetryTimer();
    retryAttemptRef.current = 0;
    await requestSaveRef.current();
  }, []);

  const markDirty = useCallback(() => {
    setAutoSaveState((previous) => ({
      ...previous,
      isDirty: true,
      syncState: previous.syncState === 'OFFLINE_RETRY' ? 'OFFLINE_RETRY' : 'DIRTY_LOCAL',
    }));
  }, []);

  const clearDraft = useCallback(async () => {
    if (autoSaveState.draftId) {
      try {
        await dependencies.api.delete<unknown>(`/applications/draft/${autoSaveState.draftId}`);
      } catch {
        // Keep local reset even if backend cleanup fails.
      }
    }

    setAutoSaveState({
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      error: null,
      errorKind: null,
      draftId: null,
      lawNotice: null,
      syncState: 'IDLE',
      draftVersion: null,
      hasConflict: false,
      detachNotice: null,
      retryPhase: null,
    });
    clearRetryTimer();
    retryModeRef.current = 'NONE';
    setSyncStatus('SYNCED');
    lastStateHash.current = '';
  }, [autoSaveState.draftId, setSyncStatus, dependencies]);

  // Called by the conflict-resolution UI after the user has reloaded
  // server data. Drops the local conflict flag so subsequent saves
  // don't keep nagging.
  const acknowledgeConflict = useCallback(() => {
    setAutoSaveState((previous) => ({
      ...previous,
      hasConflict: false,
      error: null,
      errorKind: null,
      syncState: 'IDLE',
    }));
  }, []);

  useEffect(() => {
    const currentHash = buildStateHash(state);

    // O1 (staging walk 2026-09-30) — loading a draft is not an edit.
    //
    // The baseline used to be '' until the first save, so ANY state the wizard first saw
    // counted as a change: the edit page hydrates the store and then mounts the wizard,
    // IndexedDB rehydrates after mount, and the step page restores a server draft — each
    // one raised "มีการเปลี่ยนแปลง (รอบันทึก)" and fired POST /applications/draft three
    // seconds later with nobody having touched anything.
    //
    // Now: the state at mount, and the state after every load (the store bumps
    // `hydrationEpoch` in the same write), is the baseline. Only a later change is an edit.
    // The one exception is a loaded state that itself records a save that never finished
    // (syncStatus PENDING / ERROR, persisted in IndexedDB) — that is unsaved work, so it
    // falls through to the ordinary dirty path and is retried.
    const epoch = state.hydrationEpoch ?? 0;
    if (baselineEpoch.current !== epoch) {
      baselineEpoch.current = epoch;
      const unfinishedSave = state.syncStatus === 'PENDING' || state.syncStatus === 'ERROR';
      if (!unfinishedSave) {
        lastStateHash.current = currentHash;
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
        setAutoSaveState((previous) => (previous.isDirty || previous.syncState === 'DIRTY_LOCAL'
          ? { ...previous, isDirty: false, syncState: 'IDLE' }
          : previous));
        return;
      }
    }

    // Round 2: held. The edit is real, so it is shown and recorded as unsent, but nothing
    // is scheduled: when the hold lifts (the draft loaded and marked PENDING, or the server
    // said there is none) the comparison below fires again and sends the whole store once.
    // Round 3 minor 1: this runs BEFORE the "nothing changed" return. A save that was
    // already scheduled moved the baseline to its own hash; cancelling it here without
    // undoing that would leave the edit equal to the baseline and drop it for good.
    if (holdSaves) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        lastStateHash.current = '';
      }
      if (!currentHash || currentHash === lastStateHash.current || !wizardHasStarted(state)) {
        return;
      }
      if (state.syncStatus !== 'PENDING') {
        setSyncStatus('PENDING');
      }
      setAutoSaveState((previous) => (previous.isDirty && previous.syncState === 'DIRTY_LOCAL'
        ? previous
        : { ...previous, isDirty: true, syncState: 'DIRTY_LOCAL' }));
      return;
    }

    if (!currentHash || currentHash === lastStateHash.current || !wizardHasStarted(state)) {
      return;
    }

    lastStateHash.current = currentHash;
    // I-1 (fix round 1): record "unsent" IN THE STORE the moment an edit is scheduled, not
    // only when the save starts. The store (and IndexedDB) outlive this hook: an applicant
    // who leaves within the debounce unmounts it and the timer goes with it. Without this
    // mark the edit came back as SYNCED, the load baseline above swallowed it, and it was
    // never sent. With it, the next mount or rehydrate sees PENDING and sends it once.
    if (state.syncStatus !== 'PENDING') {
      setSyncStatus('PENDING');
    }
    setAutoSaveState((previous) => ({
      ...previous,
      isDirty: true,
      syncState: previous.syncState === 'OFFLINE_RETRY' ? 'OFFLINE_RETRY' : 'DIRTY_LOCAL',
    }));

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Fix round 1 (M1): a new edit starts the automatic retries over, so an edit made after
    // the retries were spent is retried again if its own save is lost.
    retryAttemptRef.current = 0;
    debounceTimer.current = setTimeout(() => {
      void requestSaveRef.current();
    }, DEBOUNCE_DELAY);

    // NO cleanup here, and that is the fix, not an omission.
    //
    // This effect used to return a cleanup that cleared the pending timer. It reads like
    // ordinary hygiene and it silently disabled autosave completely:
    //   1. an answer changes → the effect runs → it schedules the save AND calls
    //      setAutoSaveState (to raise `isDirty`), which is a state update;
    //   2. that update re-renders → the store hook builds a NEW `state` object (it composes
    //      one on every call), so `[state]` is a new dependency → the effect re-runs;
    //   3. the cleanup fires FIRST and cancels the timer, then the body returns early
    //      because the hash has not changed since step 1 — so nothing reschedules it.
    // The timer was cancelled by the very render its own setState caused, every time.
    // Measured in a browser 2026-09-06: the pill sat at "มีการเปลี่ยนแปลง (รอบันทึก)"
    // and not one POST /applications/draft ever left the page.
    //
    // Nothing leaks: a later change clears the pending timer before scheduling the next one
    // (just above), and unmount is handled by its own effect below.
  }, [state, setSyncStatus, holdSaves]);

  // The only moment the pending save must be dropped: this component is going away.
  useEffect(() => () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    clearRetryTimer();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!autoSaveState.isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = 'คุณมีข้อมูลที่ยังไม่บันทึก';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autoSaveState.isDirty]);

  // autosave-lost-reply: the page coming back retries a failed save at once: the network
  // returned (`online`), the tab was brought back (`visibilitychange` → visible), or the
  // window regained focus. The old handler listened to `online` only, so a failure that
  // left navigator.onLine true (a lost reply, a blocked request) kept the pill amber until
  // the next edit. It also fired after a refusal; now a refusal is never retried.
  useEffect(() => {
    const comeBack = () => {
      // Fix round 1 (I1): only a failure the autosave retries by itself. A tap-only failure
      // (500, 429) waits for the tap; a refusal is never retried.
      if (retryModeRef.current !== 'AUTO') { return; }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { return; }
      // Fix round 1 (M2): focus, visibilitychange and online often fire together; one retry.
      const now = Date.now();
      if (now - lastComeBackAtRef.current < COME_BACK_MIN_GAP_MS) { return; }
      lastComeBackAtRef.current = now;
      void retryNow();
    };
    window.addEventListener('online', comeBack);
    window.addEventListener('focus', comeBack);
    document.addEventListener('visibilitychange', comeBack);
    return () => {
      window.removeEventListener('online', comeBack);
      window.removeEventListener('focus', comeBack);
      document.removeEventListener('visibilitychange', comeBack);
    };
  }, [retryNow]);

  return {
    ...autoSaveState,
    saveNow,
    retryNow,
    markDirty,
    clearDraft,
    acknowledgeConflict,
  };
}

export default useAutoSave;
