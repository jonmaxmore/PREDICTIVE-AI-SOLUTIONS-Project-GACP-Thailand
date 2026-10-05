import { classifyAutoSaveFailure } from './auto-save-status';

describe('classifyAutoSaveFailure', () => {
  it('classifies network failures as offline retry', () => {
    expect(classifyAutoSaveFailure('Unable to connect to server')).toEqual({
      syncState: 'OFFLINE_RETRY',
      errorKind: 'OFFLINE',
    });
  });

  it('classifies auth failures separately from offline failures', () => {
    expect(classifyAutoSaveFailure('Session expired. Please sign in again')).toEqual({
      syncState: 'ERROR',
      errorKind: 'AUTH',
    });
  });

  it('classifies generic backend failures as server errors', () => {
    expect(classifyAutoSaveFailure('Failed to save application')).toEqual({
      syncState: 'ERROR',
      errorKind: 'SERVER',
    });
  });
});

import { classifyDraftSaveFailure, autoSaveRetryDelay, AUTO_SAVE_COPY_TH } from './auto-save-status';

describe('classifyDraftSaveFailure (autosave-lost-reply)', () => {
  it.each([
    [{ transportFailure: 'UNREADABLE_REPLY', error: 'Invalid server response' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ transportFailure: 'NETWORK', error: 'Unable to connect to server' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ transportFailure: 'TIMEOUT', error: 'Request timeout. Please try again' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ status: 502, error: 'x' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ status: 503, error: 'x' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ status: 504, error: 'x' }, 'AUTO', 'OFFLINE_RETRY'],
    [{ status: 400, error: 'Validation failed' }, 'NONE', 'ERROR'],
    [{ status: 403, error: 'x' }, 'NONE', 'ERROR'],
    [{ status: 409, error: 'x' }, 'NONE', 'ERROR'],
    [{ status: 422, error: 'x' }, 'NONE', 'ERROR'],
    [{ status: 429, error: 'x' }, 'MANUAL', 'ERROR'],
    [{ status: 500, error: 'x' }, 'MANUAL', 'ERROR'],
    [{ error: 'Session expired. Please sign in again' }, 'NONE', 'ERROR'],
  ])('%j → retry %s, %s', (response, retry, syncState) => {
    const result = classifyDraftSaveFailure(response, { isOnline: true });
    expect(result.retry).toBe(retry);
    expect(result.syncState).toBe(syncState);
    expect(Object.values(AUTO_SAVE_COPY_TH)).toContain(result.message);
  });

  it('every message is Thai copy with คุณ register and no em dash', () => {
    for (const message of Object.values(AUTO_SAVE_COPY_TH)) {
      expect(message).toMatch(/คุณ/);
      expect(message).not.toMatch(/—/);
    }
  });

  it('offline wins over everything', () => {
    expect(classifyDraftSaveFailure({ status: 400 }, { isOnline: false }).retry).toBe('AUTO');
  });

  it('backoff: 2 s, 4 s, 8 s, 16 s, 30 s (cap), then none', () => {
    expect([0, 1, 2, 3, 4, 5].map(autoSaveRetryDelay)).toEqual([2000, 4000, 8000, 16000, 30000, null]);
  });
});
