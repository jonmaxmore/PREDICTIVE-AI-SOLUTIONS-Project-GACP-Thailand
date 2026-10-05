import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { jest } from '@jest/globals';

import { useAutoSave, ensureLatestDraftSaved, buildDraftPayload, NOT_SENT_KEYS } from './use-auto-save';

type HookValue = ReturnType<typeof useAutoSave>;
type AutoSaveDependencies = NonNullable<Parameters<typeof useAutoSave>[0]>;
type ApplicationFlowStore = ReturnType<AutoSaveDependencies['useApplicationFlowStore']>;
type SyncStatus = 'SYNCED' | 'PENDING' | 'ERROR';
type SetSyncStatusFn = (status: SyncStatus) => void;

type MockStoreState = {
  plantId: string | null;
  requestType?: string | null;
  serviceType: string | null;
  certificationPurposes: string[];
  cultivationMethods: string[];
  currentStep: number;
  applicantData: Record<string, unknown> | null;
  farmData: Record<string, unknown> | null;
  plots: unknown[];
  lots: unknown[];
  documents: unknown[];
  productionData: Record<string, unknown> | null;
  harvestData: Record<string, unknown> | null;
  syncStatus: 'SYNCED' | 'PENDING' | 'ERROR';
  applicationId?: string;
  hydrationEpoch?: number;
  resumePending?: boolean;
};

type MockStoreReturn = {
  state: MockStoreState;
  setSyncStatus: jest.MockedFunction<SetSyncStatusFn>;
  setApplicationId: jest.MockedFunction<(id: string) => void>;
  detachApplication: jest.MockedFunction<() => void>;
};

type MockApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
};

type MockApi = {
  post: jest.MockedFunction<(url: string, payload: unknown) => Promise<MockApiResponse>>;
  delete: jest.MockedFunction<(url: string) => Promise<MockApiResponse>>;
};

function createMockStore(overrides: Partial<MockStoreState> = {}): MockStoreReturn {
  const state: MockStoreState = {
    plantId: 'cannabis',
    requestType: null,
    serviceType: 'NEW',
    certificationPurposes: ['EXPORT'],
    cultivationMethods: ['outdoor'],
    currentStep: 2,
    applicantData: { applicantType: 'INDIVIDUAL', firstName: 'Test' },
    farmData: { farmName: 'Farm A' },
    plots: [],
    lots: [],
    documents: [],
    productionData: null,
    harvestData: null,
    syncStatus: 'SYNCED',
    ...overrides,
  };

  return {
    state,
    setSyncStatus: jest.fn(),
    setApplicationId: jest.fn(),
    detachApplication: jest.fn(),
  };
}

function HookHarness({
  onChange,
  dependencies,
}: {
  onChange: (value: HookValue) => void;
  dependencies: AutoSaveDependencies;
}) {
  const hook = useAutoSave(dependencies);

  useEffect(() => {
    onChange(hook);
  }, [hook, onChange]);

  return null;
}

let mockPersistSettled = true;

// Fix round 1 (I3): the autosave and the gate send only while a user is signed in.
beforeEach(() => {
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', role: 'HEALTH' }));
});

describe('useAutoSave (mock API)', () => {
  let container: HTMLDivElement | null;
  let root: Root | null;
  let latestHook: HookValue | null;
  let mockStore: MockStoreReturn;
  let mockApi: MockApi;
  let mockUseApplicationFlowStore: jest.MockedFunction<() => ApplicationFlowStore>;
  let dependencies: AutoSaveDependencies;

  const onChange = jest.fn((value: HookValue) => {
    latestHook = value;
  });

  function renderHookWithStore(overrides: Partial<MockStoreState> = {}) {
    mockStore = createMockStore(overrides);
    mockUseApplicationFlowStore.mockImplementation(
      () => mockStore as unknown as ApplicationFlowStore,
    );

    act(() => {
      root?.render(<HookHarness onChange={onChange} dependencies={dependencies} />);
    });
  }

  async function callSaveNow() {
    if (!latestHook) {
      throw new Error('Hook not rendered');
    }
    await act(async () => {
      await latestHook!.saveNow();
    });
  }

  async function callClearDraft() {
    if (!latestHook) {
      throw new Error('Hook not rendered');
    }
    await act(async () => {
      await latestHook!.clearDraft();
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    jest.useFakeTimers();
    mockPersistSettled = true;
    jest.clearAllMocks();
    latestHook = null;
    onChange.mockClear();

    mockApi = {
      post: jest.fn(),
      delete: jest.fn(),
    };

    mockUseApplicationFlowStore = jest.fn();
    dependencies = {
      useApplicationFlowStore:
        mockUseApplicationFlowStore as unknown as AutoSaveDependencies['useApplicationFlowStore'],
      api: mockApi as unknown as AutoSaveDependencies['api'],
      // IndexedDB has answered unless a test says otherwise (round 2 hold).
      usePersistSettled: () => mockPersistSettled,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container) {
      container.remove();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  /**
   * เทสทุกตัวในไฟล์นี้เรียก saveNow() เอง ซึ่ง **ข้าม debounce** ไปเลย เส้นทางที่ผู้ใช้จริงเดิน
   * — พิมพ์แล้วปล่อยให้มันบันทึกเอง — จึงไม่เคยถูกทดสอบสักครั้ง และมันไม่ทำงาน
   *
   * กลไก: effect ที่เฝ้า [state] ตั้ง timer ไว้ แล้วเรียก setAutoSaveState ในตัวมันเอง
   * ⇒ เกิด render ใหม่ ⇒ cleanup ของ effect เดิมล้าง timer ทิ้ง ⇒ รอบใหม่แฮชไม่เปลี่ยนแล้ว
   * จึง return ก่อนตั้ง timer ใหม่ · ผลคือ **timer ถูกยกเลิกเสมอ ไม่มีการบันทึกอัตโนมัติเลย**
   *
   * เห็นตอนเดินจริงผ่านเบราว์เซอร์ 2026-09-06: ป้ายค้างที่ "มีการเปลี่ยนแปลง (รอบันทึก)"
   * ตลอดกาล และไม่มี POST /applications/draft ออกไปเลยแม้แต่ครั้งเดียว
   */
  /** The real store composes a NEW `state` object on every call; the mock must too. */
  function mountWithLiveState(initial: Partial<MockStoreState>) {
    mockStore = createMockStore(initial);
    // Like the real store, setSyncStatus writes into the state the next render reads
    // (it is persisted to IndexedDB with the answers — I-1).
    mockStore.setSyncStatus.mockImplementation((status) => {
      mockStore.state = { ...mockStore.state, syncStatus: status };
    });
    // Round 5: like the real store, dropping the id keeps every answer and marks them unsent.
    mockStore.detachApplication.mockImplementation(() => {
      mockStore.state = { ...mockStore.state, applicationId: undefined, syncStatus: 'PENDING' };
    });
    mockUseApplicationFlowStore.mockImplementation(() => ({
      state: { ...mockStore.state },
      setSyncStatus: mockStore.setSyncStatus,
      setApplicationId: mockStore.setApplicationId,
      detachApplication: mockStore.detachApplication,
    } as unknown as ApplicationFlowStore));
    act(() => {
      root?.render(<HookHarness onChange={onChange} dependencies={dependencies} />);
    });
  }

  /** Replace the store's state (an edit or a hydration) and re-render. */
  function storeBecomes(next: Partial<MockStoreState>) {
    mockStore.state = { ...mockStore.state, ...next };
    act(() => {
      root?.render(<HookHarness onChange={onChange} dependencies={dependencies} />);
    });
  }

  async function waitPastDebounce() {
    await act(async () => {
      jest.advanceTimersByTime(3500);
      await Promise.resolve();
    });
  }

  /**
   * เทสทุกตัวในไฟล์นี้เรียก saveNow() เอง ซึ่ง **ข้าม debounce** ไปเลย เส้นทางที่ผู้ใช้จริงเดิน
   * — พิมพ์แล้วปล่อยให้มันบันทึกเอง — จึงไม่เคยถูกทดสอบสักครั้ง และมันไม่ทำงาน
   *
   * กลไก: effect ที่เฝ้า [state] ตั้ง timer ไว้ แล้วเรียก setAutoSaveState ในตัวมันเอง
   * ⇒ เกิด render ใหม่ ⇒ cleanup ของ effect เดิมล้าง timer ทิ้ง ⇒ รอบใหม่แฮชไม่เปลี่ยนแล้ว
   * จึง return ก่อนตั้ง timer ใหม่ · ผลคือ **timer ถูกยกเลิกเสมอ ไม่มีการบันทึกอัตโนมัติเลย**
   *
   * เห็นตอนเดินจริงผ่านเบราว์เซอร์ 2026-09-06: ป้ายค้างที่ "มีการเปลี่ยนแปลง (รอบันทึก)"
   * ตลอดกาล และไม่มี POST /applications/draft ออกไปเลยแม้แต่ครั้งเดียว
   *
   * O1 (2026-09-30): เทสนี้เคยใช้ "เปิดหน้ามาพร้อมคำตอบ" แทนการแก้ของผู้ใช้ — ซึ่งก็คือบั๊ก O1
   * เอง (เปิดร่างแล้วบันทึกทั้งที่ไม่มีใครแก้) · ตอนนี้เปิดหน้าเปล่าก่อน แล้วผู้ใช้ตอบคำถาม
   */
  it('บันทึกเองหลัง debounce โดยผู้ใช้ไม่ต้องกดอะไร', async () => {
    mountWithLiveState({ plantId: null, requestType: null });
    mockApi.post.mockResolvedValueOnce({ success: true, data: { draftId: 'draft-1' } });

    // ผู้ใช้ตอบคำถามแล้วปล่อยมือ — ไม่มีการกดปุ่มบันทึกใด ๆ ทั้งสิ้น
    storeBecomes({ requestType: 'NEW' });
    await waitPastDebounce();

    expect(dependencies.api.post).toHaveBeenCalledWith(
      '/applications/draft',
      expect.objectContaining({ formData: expect.objectContaining({ requestType: 'NEW' }) }),
    );

    // และคำขอที่เพิ่งเกิดต้องถูกบอกกลับเข้าสโตร์ · ขั้น 2/3/5 ดึงรายการเอกสารด้วย id นี้
    // ถ้าไม่บอก การบันทึกสำเร็จก็ยังไม่มีการ์ดเอกสารสักใบให้ผู้ยื่นเห็น
    expect(mockStore.setApplicationId).toHaveBeenCalledWith('draft-1');
  });

  /**
   * O1 (staging walk 2026-09-30): เปิดร่าง 7fe0b094 เข้าวิซาร์ด แล้ว POST /applications/draft
   * ออกไปเองโดยไม่มีใครแก้อะไร และหัววิซาร์ดขึ้น "มีการเปลี่ยนแปลง (รอบันทึก)"
   *
   * การโหลดร่างไม่ใช่การแก้ — สิ่งที่โหลดมาคือเส้นฐาน ไม่ใช่ความเปลี่ยนแปลง
   */
  describe('O1 — loading a saved draft is not an edit', () => {
    const SAVED_DRAFT: Partial<MockStoreState> = {
      plantId: 'ginger',
      requestType: 'NEW',
      applicationId: '7fe0b094-2531-4b0f-ad3b-11e38aeb3566',
      applicantData: { applicantType: 'JURISTIC' },
      syncStatus: 'SYNCED',
      hydrationEpoch: 1,
    };

    it('the wizard mounting on an already-hydrated draft (the edit page path) sends no save and is not dirty', async () => {
      mountWithLiveState(SAVED_DRAFT);
      await waitPastDebounce();

      expect(mockApi.post).not.toHaveBeenCalled();
      expect(latestHook?.isDirty).toBe(false);
      expect(latestHook?.syncState).not.toBe('DIRTY_LOCAL');
    });

    it('a draft hydrated AFTER mount (server draft / IndexedDB) sends no save and is not dirty', async () => {
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0 });
      storeBecomes(SAVED_DRAFT);
      await waitPastDebounce();

      expect(mockApi.post).not.toHaveBeenCalled();
      expect(latestHook?.isDirty).toBe(false);
      expect(latestHook?.syncState).not.toBe('DIRTY_LOCAL');
    });

    it('a real edit after the draft loaded still autosaves, once', async () => {
      mountWithLiveState(SAVED_DRAFT);
      mockApi.post.mockResolvedValueOnce({ success: true, data: { id: SAVED_DRAFT.applicationId, version: 2 } });

      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'แก้แล้ว' } });
      expect(latestHook?.isDirty).toBe(true);
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({
          formData: expect.objectContaining({ applicantData: { applicantType: 'JURISTIC', companyName: 'แก้แล้ว' } }),
        }),
      );
    });

    /** Leave the wizard: the layout (and this hook) unmounts, the store keeps its state. */
    function leaveWizard() {
      act(() => { root?.unmount(); });
      root = createRoot(container!);
    }

    function reenterWizard() {
      act(() => {
        root?.render(<HookHarness onChange={onChange} dependencies={dependencies} />);
      });
    }

    const EDITED = { applicantType: 'JURISTIC', companyName: 'แก้แล้วก่อนออก' };

    it('I-1: edit → leave before the debounce → come back sends the edit exactly once', async () => {
      mountWithLiveState(SAVED_DRAFT);
      storeBecomes({ applicantData: EDITED });
      leaveWizard();
      expect(mockApi.post).not.toHaveBeenCalled();

      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      reenterWizard();
      await waitPastDebounce();
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({ formData: expect.objectContaining({ applicantData: EDITED }) }),
      );
    });

    it('I-1: a page reload that rehydrates an unsent edit from IndexedDB sends it exactly once', async () => {
      mountWithLiveState(SAVED_DRAFT);
      storeBecomes({ applicantData: EDITED });
      const persisted = { ...mockStore.state }; // what IndexedDB holds when the tab closes
      leaveWizard();

      // A fresh page: the store starts at its initial state, IndexedDB lands after mount.
      mockStore.state = { ...createMockStore({ plantId: null, requestType: null, hydrationEpoch: 0 }).state, syncStatus: 'SYNCED' };
      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      reenterWizard();
      storeBecomes({ ...persisted, hydrationEpoch: (persisted.hydrationEpoch ?? 0) + 1 });
      await waitPastDebounce();
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({ formData: expect.objectContaining({ applicantData: EDITED }) }),
      );
    });

    it('I-1: a fresh open of a draft that was saved sends nothing, even after leaving and coming back', async () => {
      mountWithLiveState(SAVED_DRAFT);
      await waitPastDebounce();
      leaveWizard();
      reenterWizard();
      await waitPastDebounce();

      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('I-1: an edit made while the server draft was loading arrives marked unsent (PENDING) and is POSTed', async () => {
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0 });
      storeBecomes({ requestType: 'RENEWAL' }); // the applicant answers while the fetch is in flight
      // The step page loads the server draft over it, keeps the edited key and the
      // PENDING mark (application-step-page.tsx — pinned by its own test).
      storeBecomes({ ...SAVED_DRAFT, requestType: 'RENEWAL', syncStatus: 'PENDING', hydrationEpoch: 1 });
      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({ formData: expect.objectContaining({ requestType: 'RENEWAL' }) }),
      );
    });

    /**
     * Round 2 I-1 (data loss, already on main): on a fresh browser the store is empty
     * and GET /applications/draft can take longer than the debounce. An answer given
     * meanwhile used to be POSTed as a near-empty store; with no applicationId the
     * server lands it on the real draft and the empty values overwrite the stored ones.
     * Every autosave now waits for the resume fetch to settle.
     */
    it('round 2: an edit while the resume fetch is pending is held (0 POST), then the merged draft is sent once', async () => {
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0, resumePending: true });
      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });

      storeBecomes({ requestType: 'RENEWAL' });
      await waitPastDebounce();
      await waitPastDebounce();
      expect(mockApi.post).not.toHaveBeenCalled();

      // The draft lands: the step page loads it with the answer on top, marked unsent.
      storeBecomes({ ...SAVED_DRAFT, requestType: 'RENEWAL', syncStatus: 'PENDING', hydrationEpoch: 1, resumePending: false });
      await waitPastDebounce();
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({
          formData: expect.objectContaining({ requestType: 'RENEWAL', applicantData: SAVED_DRAFT.applicantData }),
        }),
      );
    });

    it('round 2: the resume fetch settles with no draft (200 data:null or 404) — the held edit is saved once', async () => {
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0, resumePending: true });
      mockApi.post.mockResolvedValue({ success: true, data: { id: 'draft-new' } });

      storeBecomes({ requestType: 'NEW' });
      await waitPastDebounce();
      expect(mockApi.post).not.toHaveBeenCalled();

      storeBecomes({ resumePending: false });
      await waitPastDebounce();
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        '/applications/draft',
        expect.objectContaining({ formData: expect.objectContaining({ requestType: 'NEW' }) }),
      );
    });

    it('round 2: nothing is saved before IndexedDB has answered either', async () => {
      mockPersistSettled = false;
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0 });
      mockApi.post.mockResolvedValue({ success: true, data: { id: 'draft-new' } });

      storeBecomes({ requestType: 'NEW' });
      await waitPastDebounce();
      expect(mockApi.post).not.toHaveBeenCalled();

      mockPersistSettled = true;
      storeBecomes({});
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    /**
     * Round 2 M2: a save that succeeds marked the store SYNCED and took ITS hash as the
     * baseline even when the applicant had typed again while it was in flight. Leaving
     * within the next debounce then lost the second edit on return.
     */
    it('round 2 M2: an edit made during an in-flight save survives leaving — remount sends it once', async () => {
      mountWithLiveState(SAVED_DRAFT);
      let finishFirstSave: (value: { success: boolean; data: unknown }) => void = () => {};
      mockApi.post.mockImplementationOnce(() => new Promise((resolve) => { finishFirstSave = resolve; }));

      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'ครั้งที่ 1' } });
      await waitPastDebounce(); // first save is now in flight
      expect(mockApi.post).toHaveBeenCalledTimes(1);

      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'ครั้งที่ 2' } });
      leaveWizard(); // within the second debounce, while the first save is still in flight
      await act(async () => {
        finishFirstSave({ success: true, data: { id: SAVED_DRAFT.applicationId } });
        await Promise.resolve();
        await Promise.resolve();
      });

      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      reenterWizard();
      await waitPastDebounce();
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(2);
      expect(mockApi.post).toHaveBeenLastCalledWith(
        '/applications/draft',
        expect.objectContaining({
          formData: expect.objectContaining({ applicantData: { applicantType: 'JURISTIC', companyName: 'ครั้งที่ 2' } }),
        }),
      );
    });

    /**
     * Round 3 minor 1: an edit scheduled its save (and moved the baseline to itself) just
     * before a hold was raised. The hold cleared the timer, so the edit was never sent, and
     * when the hold lifted the hash equalled the moved baseline — dropped for good.
     */
    it('round 3: an edit whose save was cancelled by a hold is still sent once the hold lifts', async () => {
      mountWithLiveState(SAVED_DRAFT);
      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });

      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'ก่อนถูกพัก' } });
      storeBecomes({ resumePending: true }); // within the debounce
      await waitPastDebounce();
      await waitPastDebounce();
      expect(mockApi.post).not.toHaveBeenCalled();

      storeBecomes({ resumePending: false });
      await waitPastDebounce();
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    it('round 3: a stale hold cleared by an edit-page load — one edit after it saves once', async () => {
      // A 503 left the hold up; the edit page then loaded a draft. The real store's
      // hydrateDraft lowers the hold (pinned in use-application-flow-store.test.ts).
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0, resumePending: true });
      storeBecomes({ ...SAVED_DRAFT, hydrationEpoch: 1, syncStatus: 'SYNCED', resumePending: false });
      mockApi.post.mockResolvedValue({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      await waitPastDebounce();
      expect(mockApi.post).not.toHaveBeenCalled();

      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'แก้หลังโหลด' } });
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    /**
     * Round 4 I-1: the payload never carried applicationId, so the server picked the
     * applicant's latest DRAFT. An edit to a REVISION_REQUESTED / CAR_PENDING application
     * landed on another draft (or minted a new one), and submit then filed the edited
     * application with stale data. Every save now names the application it is for.
     */
    it('round 4: an edit to application X (a resubmit) is POSTed WITH X\'s id', async () => {
      mountWithLiveState({ ...SAVED_DRAFT, applicationId: 'app-X-revision' });
      mockApi.post.mockResolvedValue({ success: true, data: { id: 'app-X-revision' } });
      storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'แก้ตามข้อสังเกต' } });
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      const body = mockApi.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(body.applicationId).toBe('app-X-revision');
    });

    it('round 4: a brand-new filing sends no id until the first save returns one, then every save carries it', async () => {
      mountWithLiveState({ plantId: null, requestType: null, hydrationEpoch: 0, applicationId: undefined });
      mockStore.setApplicationId.mockImplementation((id: string) => {
        mockStore.state = { ...mockStore.state, applicationId: id };
      });
      mockApi.post.mockResolvedValue({ success: true, data: { id: 'app-new-1' } });

      storeBecomes({ requestType: 'NEW' });
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect((mockApi.post.mock.calls[0]![1] as Record<string, unknown>).applicationId).toBeUndefined();

      storeBecomes({ certScope: 'PLANTING' } as Partial<MockStoreState>);
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(2);
      expect((mockApi.post.mock.calls[1]![1] as Record<string, unknown>).applicationId).toBe('app-new-1');
    });

    /**
     * Round 5 (b), defence in depth: the store names an application the server will no
     * longer let this user edit (409 APPLICATION_NOT_EDITABLE: already filed) or cannot
     * find for this user (404 APPLICATION_NOT_FOUND: deleted, or not theirs). Retrying
     * with the same id fails forever, so the id is dropped, the answers are kept, the
     * applicant is told in one line, and the next save carries no id. X itself is
     * never resubmitted or touched.
     */
    describe.each([
      ['APPLICATION_NOT_EDITABLE', 'คำขอนี้ยื่นไปแล้ว ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ'],
      ['APPLICATION_NOT_FOUND', 'ไม่พบคำขอเดิมในบัญชีของคุณ ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ'],
    ])('round 5: a save refused with %s', (code, noticeTh) => {
      function serverRefusesX(newId: string) {
        mockStore.setApplicationId.mockImplementation((id: string) => {
          mockStore.state = { ...mockStore.state, applicationId: id };
        });
        mockApi.post.mockImplementation(async (_url, body) => (
          (body as Record<string, unknown>).applicationId === 'app-X-filed'
            ? { success: false, error: code, code }
            : { success: true, data: { id: newId, version: 1 } }
        ));
      }

      it('drops the id, keeps the answers, says so, and the next save has no id and no version', async () => {
        mountWithLiveState({ ...SAVED_DRAFT, applicationId: 'app-X-filed' });
        serverRefusesX('app-new-2');

        storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'คำตอบใหม่' } });
        await waitPastDebounce();
        expect(mockApi.post).toHaveBeenCalledTimes(1);
        expect((mockApi.post.mock.calls[0]![1] as Record<string, unknown>).applicationId).toBe('app-X-filed');

        expect(mockStore.detachApplication).toHaveBeenCalledTimes(1);
        expect(mockStore.state.applicationId).toBeUndefined();
        expect(mockStore.state.applicantData).toEqual({ applicantType: 'JURISTIC', companyName: 'คำตอบใหม่' });
        expect(latestHook?.detachNotice).toBe(noticeTh);

        await waitPastDebounce();
        expect(mockApi.post).toHaveBeenCalledTimes(2);
        const second = mockApi.post.mock.calls[1]![1] as Record<string, unknown>;
        expect(second.applicationId).toBeUndefined();
        expect(second.expectedVersion).toBeUndefined();
        expect(second.formData).toEqual(expect.objectContaining({
          applicantData: { applicantType: 'JURISTIC', companyName: 'คำตอบใหม่' },
        }));
        expect(mockStore.setApplicationId).toHaveBeenCalledWith('app-new-2');

        // Settles: no loop of saves, and nothing ever went to /applications/submit.
        await waitPastDebounce();
        expect(mockApi.post).toHaveBeenCalledTimes(2);
        expect(mockApi.post.mock.calls.every(([url]) => url === '/applications/draft')).toBe(true);
      });

      it('the submit gate refuses while the id is refused, then lets the id the next save returns through', async () => {
        mountWithLiveState({ ...SAVED_DRAFT, applicationId: 'app-X-filed' });
        serverRefusesX('app-new-3');
        const gateDeps = {
          getState: () => mockStore.state as never,
          setSyncStatus: mockStore.setSyncStatus as never,
          post: mockApi.post as never,
          detachApplication: mockStore.detachApplication as never,
        };

        storeBecomes({ applicantData: { applicantType: 'JURISTIC', companyName: 'ก่อนยื่น' } });
        let first: unknown;
        await act(async () => { first = await ensureLatestDraftSaved('app-X-filed', gateDeps); });
        expect(first).toBe('DETACHED');
        expect(mockApi.post).toHaveBeenCalledTimes(1);
        expect(mockStore.state.applicationId).toBeUndefined();

        await waitPastDebounce(); // the re-armed autosave saves without the id
        expect(mockApi.post).toHaveBeenCalledTimes(2);
        expect((mockApi.post.mock.calls[1]![1] as Record<string, unknown>).applicationId).toBeUndefined();
        expect(mockStore.state.applicationId).toBe('app-new-3');

        let second: unknown;
        await act(async () => { second = await ensureLatestDraftSaved('app-new-3', gateDeps); });
        expect(second).toBe('SAVED');
        expect(mockApi.post).toHaveBeenCalledTimes(2);
      });
    });

    it('a loaded state that itself records an unfinished save (syncStatus ERROR) is retried — that is unsaved work, not a clean draft', async () => {
      mountWithLiveState({ ...SAVED_DRAFT, syncStatus: 'ERROR' });
      mockApi.post.mockResolvedValueOnce({ success: true, data: { id: SAVED_DRAFT.applicationId } });
      await waitPastDebounce();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the backend id as draftId without inventing a client sync version on successful save', async () => {
    mockApi.post.mockResolvedValueOnce({
      success: true,
      data: { id: 'draft-from-backend-id' },
    });

    renderHookWithStore();
    await callSaveNow();

    expect(mockApi.post).toHaveBeenCalledWith('/applications/draft', expect.any(Object));
    expect(latestHook?.draftId).toBe('draft-from-backend-id');
    expect(latestHook?.syncState).toBe('SYNCED');
    expect(latestHook?.errorKind).toBeNull();
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(1, 'PENDING');
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(2, 'SYNCED');
  });

  it('posts the canonical 1-based step field alongside currentStep when saving drafts', async () => {
    mockApi.post.mockResolvedValueOnce({
      success: true,
      data: { draftId: 'draft-123' },
    });

    renderHookWithStore({ currentStep: 2 });
    await callSaveNow();

    expect(mockApi.post).toHaveBeenCalledWith(
      '/applications/draft',
      expect.objectContaining({
        currentStep: 2,
        step: 3,
      }),
    );
  });

  it('calls delete cleanup route with saved draftId and resets local autosave state', async () => {
    mockApi.post.mockResolvedValueOnce({
      success: true,
      data: { draftId: 'draft-123' },
    });
    mockApi.delete.mockResolvedValueOnce({ success: true });

    renderHookWithStore();
    await callSaveNow();
    await callClearDraft();

    expect(mockApi.delete).toHaveBeenCalledWith('/applications/draft/draft-123');
    expect(latestHook?.draftId).toBeNull();
    expect(latestHook?.isDirty).toBe(false);
    expect(latestHook?.error).toBeNull();
    expect(latestHook?.syncState).toBe('IDLE');
    expect(mockStore.setSyncStatus).toHaveBeenLastCalledWith('SYNCED');
  });

  it('classifies unsuccessful auth responses as error (not offline retry)', async () => {
    mockApi.post.mockResolvedValueOnce({
      success: false,
      error: 'Session expired. Please sign in again',
    });

    renderHookWithStore();
    await callSaveNow();

    expect(latestHook?.syncState).toBe('ERROR');
    expect(latestHook?.errorKind).toBe('AUTH');
    expect(latestHook?.isSaving).toBe(false);
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(1, 'PENDING');
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(2, 'ERROR');
  });

  it('classifies thrown network failures as offline retry when browser is offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    mockApi.post.mockRejectedValueOnce(new Error('network down'));

    renderHookWithStore();
    await callSaveNow();

    expect(latestHook?.syncState).toBe('OFFLINE_RETRY');
    expect(latestHook?.errorKind).toBe('OFFLINE');
    expect(latestHook?.isSaving).toBe(false);
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(1, 'PENDING');
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(2, 'ERROR');
  });

  it('classifies thrown online failures as server errors instead of offline retry', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    mockApi.post.mockRejectedValueOnce(new Error('Failed to save application'));

    renderHookWithStore();
    await callSaveNow();

    expect(latestHook?.syncState).toBe('ERROR');
    expect(latestHook?.errorKind).toBe('SERVER');
    expect(latestHook?.isSaving).toBe(false);
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(1, 'PENDING');
    expect(mockStore.setSyncStatus).toHaveBeenNthCalledWith(2, 'ERROR');
  });

  // ─── Optimistic concurrency (2-tab race protection) ──────────────────
  describe('R2 Task 15 - APPLICATION_HOLDER_REQUIRED', () => {
    it('shows the one holder sentence and posts nothing more within 3 debounce windows', async () => {
      mountWithLiveState({ plantId: null, requestType: null });
      mockApi.post.mockResolvedValue({ success: false, status: 400, errorCode: 'APPLICATION_HOLDER_REQUIRED', error: 'The holder (entityId) of a new application is required' } as never);

      storeBecomes({ requestType: 'NEW' });
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(latestHook!.error).toBe(
        'ยังไม่ได้เลือกว่าจะยื่นในนามใคร กรุณาเลือกที่ขั้นตอนที่ 1 หากเปิดหน้านี้ค้างไว้ ให้โหลดหน้าใหม่ก่อน',
      );

      await waitPastDebounce();
      await waitPastDebounce();
      await waitPastDebounce();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('optimistic concurrency', () => {
    it('captures version from server response and echoes it on next save', async () => {
      mockApi.post
        .mockResolvedValueOnce({ success: true, data: { id: 'd1', version: 1 } })
        .mockResolvedValueOnce({ success: true, data: { id: 'd1', version: 2 } });

      renderHookWithStore();
      await callSaveNow();
      expect(latestHook?.draftVersion).toBe(1);

      await callSaveNow();
      expect(latestHook?.draftVersion).toBe(2);
      // Second call must echo the v1 it captured from the first.
      expect(mockApi.post).toHaveBeenNthCalledWith(
        2,
        '/applications/draft',
        expect.objectContaining({ expectedVersion: 1 }),
      );
    });

    it('does not send expectedVersion on the very first save (no version yet)', async () => {
      mockApi.post.mockResolvedValueOnce({
        success: true,
        data: { id: 'd1', version: 1 },
      });

      renderHookWithStore();
      await callSaveNow();

      // expectedVersion should be `undefined` (omitted), not 0.
      const firstCallPayload = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(firstCallPayload.expectedVersion).toBeUndefined();
    });

    it('surfaces DRAFT_VERSION_CONFLICT as a CONFLICT error kind', async () => {
      mockApi.post
        .mockResolvedValueOnce({ success: true, data: { id: 'd1', version: 1 } })
        .mockResolvedValueOnce({ success: false, error: 'DRAFT_VERSION_CONFLICT' });

      renderHookWithStore();
      await callSaveNow();
      await callSaveNow();

      expect(latestHook?.hasConflict).toBe(true);
      expect(latestHook?.errorKind).toBe('CONFLICT');
      expect(latestHook?.syncState).toBe('ERROR');
    });

    it('acknowledgeConflict() drops the conflict state for retry', async () => {
      mockApi.post
        .mockResolvedValueOnce({ success: true, data: { id: 'd1', version: 1 } })
        .mockResolvedValueOnce({ success: false, error: 'DRAFT_VERSION_CONFLICT' });

      renderHookWithStore();
      await callSaveNow();
      await callSaveNow();

      expect(latestHook?.hasConflict).toBe(true);

      act(() => {
        latestHook?.acknowledgeConflict();
      });

      expect(latestHook?.hasConflict).toBe(false);
      expect(latestHook?.errorKind).toBeNull();
      expect(latestHook?.syncState).toBe('IDLE');
    });
  });
});

/**
 * Round 3 — the submit gate. Submit posts only {applicationId}; the server files what it
 * HOLDS. An edit the client has not saved yet (PENDING, or held by the resume fetch) would
 * be filed stale. ensureLatestDraftSaved answers "is the server's copy the latest?" and
 * makes it so when it can.
 */
/**
 * Client bookkeeping never leaves the browser. The backend guard
 * (wizard-answers-are-writable.test.js NOT_AN_ANSWER) declares these as "never sent"; this
 * pins that claim on the side that does the sending.
 */
describe('R2 Task 15 - the holder travels with the first save', () => {
  const state = { requestType: 'NEW', currentStep: 0, plantId: 'cannabis', holderEntityId: 'e-company' } as never;

  it('the first save (no applicationId) sends entityId at the top of the body, not inside formData', () => {
    const body = buildDraftPayload(state) as Record<string, unknown>;
    expect(body.entityId).toBe('e-company');
    expect((body.formData as Record<string, unknown>).holderEntityId).toBeUndefined();
  });

  it('a save of an existing application does not name a holder again', () => {
    const body = buildDraftPayload({ ...(state as object), applicationId: 'app-1' } as never) as Record<string, unknown>;
    expect(body.entityId).toBeUndefined();
  });
});

describe('bookkeeping fields are never sent', () => {
  it('hydrationEpoch, resumePending and ownerUserId are in NOT_SENT_KEYS and absent from the payload', () => {
    const state = {
      requestType: 'NEW', plantId: 'cannabis', currentStep: 2, syncStatus: 'PENDING',
      hydrationEpoch: 7, resumePending: true, ownerUserId: 'user-A', applicationId: 'app-1',
    } as unknown as Parameters<typeof buildDraftPayload>[0];
    for (const key of ['hydrationEpoch', 'resumePending', 'ownerUserId']) {
      expect(NOT_SENT_KEYS).toContain(key);
    }
    const payload = buildDraftPayload(state) as unknown as Record<string, unknown> & { formData: Record<string, unknown> };
    for (const key of ['hydrationEpoch', 'resumePending', 'ownerUserId']) {
      expect(payload).not.toHaveProperty(key);
      expect(payload.formData).not.toHaveProperty(key);
    }
  });
});

describe('ensureLatestDraftSaved (round 3 submit gate)', () => {
  type Probe = { applicationId?: string; syncStatus: string; resumePending?: boolean; requestType?: string | null; plantId?: string | null };
  function deps(state: Probe, post: jest.Mock<(...args: never[]) => Promise<unknown>> = jest.fn(async () => ({ success: true, data: { id: 'app-1' } }))) {
    const store = { state: { ...state } };
    return {
      store,
      post,
      deps: {
        getState: () => store.state as never,
        setSyncStatus: (status: string) => { store.state = { ...store.state, syncStatus: status }; },
        post: post as never,
        detachApplication: () => { store.state = { ...store.state, applicationId: undefined, syncStatus: 'PENDING' }; },
      },
    };
  }

  it('nothing pending for this application: no save, filing may go ahead', async () => {
    const { post, deps: d } = deps({ applicationId: 'app-1', syncStatus: 'SYNCED', requestType: 'NEW' });
    await expect(ensureLatestDraftSaved('app-1', d)).resolves.toBe('SAVED');
    expect(post).not.toHaveBeenCalled();
  });

  it('the store is about another application: not this filing\'s business', async () => {
    const { post, deps: d } = deps({ applicationId: 'other', syncStatus: 'PENDING', requestType: 'NEW' });
    await expect(ensureLatestDraftSaved('app-1', d)).resolves.toBe('SAVED');
    expect(post).not.toHaveBeenCalled();
  });

  it('round 4: the gate\'s own save names the application it is for', async () => {
    const { post, deps: d } = deps({ applicationId: 'app-X-revision', syncStatus: 'PENDING', requestType: 'NEW', plantId: 'cannabis' });
    await expect(ensureLatestDraftSaved('app-X-revision', d)).resolves.toBe('SAVED');
    expect(post).toHaveBeenCalledWith('/applications/draft', expect.objectContaining({ applicationId: 'app-X-revision' }));
  });

  it('an unsaved edit and no wizard on screen: saves it first, then lets the filing go', async () => {
    const { post, store, deps: d } = deps({ applicationId: 'app-1', syncStatus: 'PENDING', requestType: 'RENEWAL', plantId: 'cannabis' });
    await expect(ensureLatestDraftSaved('app-1', d)).resolves.toBe('SAVED');
    expect(post).toHaveBeenCalledWith('/applications/draft', expect.objectContaining({ formData: expect.objectContaining({ requestType: 'RENEWAL' }) }));
    expect(store.state.syncStatus).toBe('SYNCED');
  });

  it('the save fails: the filing is blocked', async () => {
    const failing = jest.fn(async () => ({ success: false, error: 'boom' }));
    const { deps: d } = deps({ applicationId: 'app-1', syncStatus: 'ERROR', requestType: 'NEW' }, failing);
    await expect(ensureLatestDraftSaved('app-1', d)).resolves.toBe('NOT_SAVED');
  });

  it('held by an unresolved resume fetch: blocked, nothing posted over the server draft', async () => {
    const { post, deps: d } = deps({ applicationId: 'app-1', syncStatus: 'PENDING', resumePending: true, requestType: 'NEW' });
    await expect(ensureLatestDraftSaved('app-1', d)).resolves.toBe('NOT_SAVED');
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['APPLICATION_NOT_EDITABLE', 'APPLICATION_NOT_FOUND'])('round 5: no wizard on screen and the id is refused (%s): blocked, the id dropped, the answers kept', async (code) => {
    const refused = jest.fn(async () => ({ success: false, error: code, code }));
    const { store, deps: d } = deps({ applicationId: 'app-X', syncStatus: 'PENDING', requestType: 'RENEWAL', plantId: 'cannabis' }, refused);
    await expect(ensureLatestDraftSaved('app-X', d)).resolves.toBe('DETACHED');
    expect(refused).toHaveBeenCalledTimes(1);
    expect(store.state.applicationId).toBeUndefined();
    expect(store.state.requestType).toBe('RENEWAL');
    // Still marked unsent: the next wizard mount saves the answers without the id.
    expect(store.state.syncStatus).toBe('PENDING');
  });
});
