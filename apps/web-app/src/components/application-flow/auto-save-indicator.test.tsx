import { renderToStaticMarkup } from 'react-dom/server';
import { AutoSaveIndicator } from './auto-save-indicator';

describe('AutoSaveIndicator', () => {
  it('shows dirty-local state without syncing spinner while waiting for debounce', () => {
    const html = renderToStaticMarkup(
      <AutoSaveIndicator
        isDirty
        isSaving={false}
        lastSavedAt={null}
        error={null}
        syncState="DIRTY_LOCAL"
      />,
    );

    expect(html).toContain('data-testid="auto-save-indicator"');
    expect(html).toContain('data-state="dirty-local"');
    expect(html).not.toContain('animate-spin');
  });

  it('shows syncing state when a request is in flight', () => {
    const html = renderToStaticMarkup(
      <AutoSaveIndicator
        isDirty
        isSaving={false}
        lastSavedAt={null}
        error={null}
        syncState="SYNCING"
      />,
    );

    expect(html).toContain('data-state="syncing"');
    expect(html).toContain('animate-spin');
  });

  it('shows offline-retry state distinctly from generic errors', () => {
    const html = renderToStaticMarkup(
      <AutoSaveIndicator
        isDirty
        isSaving={false}
        lastSavedAt={null}
        error="Unable to connect to server"
        errorKind="OFFLINE"
        syncState="OFFLINE_RETRY"
      />,
    );

    expect(html).toContain('data-state="offline-retry"');
  });

  it('shows auth errors as error state (not offline retry)', () => {
    const html = renderToStaticMarkup(
      <AutoSaveIndicator
        isDirty
        isSaving={false}
        lastSavedAt={null}
        error="Session expired. Please sign in again"
        errorKind="AUTH"
        syncState="ERROR"
      />,
    );

    expect(html).toContain('data-state="auth-error"');
    expect(html).not.toContain('data-state="offline-retry"');
  });
});

describe('AutoSaveIndicator accessible names (autosave-lost-reply fix round 1, M4)', () => {
  it.each([
    ['retry-exhausted', 'ลองบันทึกอีกครั้ง', { syncState: 'OFFLINE_RETRY', retryPhase: 'EXHAUSTED', errorKind: 'OFFLINE' }],
    ['retrying', 'กำลังลองบันทึกใหม่', { syncState: 'OFFLINE_RETRY', retryPhase: 'SCHEDULED', errorKind: 'OFFLINE' }],
    ['error', 'บันทึกไม่สำเร็จ', { syncState: 'ERROR', errorKind: 'SERVER' }],
  ] as const)('%s: the visible label is the name, the cause is the description', (state, label, props) => {
    const cause = 'สาเหตุภาษาไทย กดเพื่อลองบันทึกอีกครั้ง';
    const html = renderToStaticMarkup(
      <AutoSaveIndicator isDirty isSaving={false} lastSavedAt={null} error={cause} {...props} />,
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const pill = host.querySelector(`[data-state="${state}"]`)!;
    expect(pill.getAttribute('aria-label')).toBeNull();
    expect(pill.textContent?.trim()).toBe(label);
    const describedBy = pill.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`[id="${describedBy}"]`)?.textContent).toBe(cause);
  });
});
