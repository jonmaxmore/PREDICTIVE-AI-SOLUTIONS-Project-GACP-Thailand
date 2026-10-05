'use client';

import { useId, useState } from 'react';
import { Icons } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import type {
  AutoSaveErrorKind,
  AutoSaveSyncState,
} from '@/app/health/applications/hooks/auto-save-status';
import type { AutoSaveRetryPhase } from '@/app/health/applications/new/_steps/hooks/use-auto-save';

interface AutoSaveIndicatorProps {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
  errorKind?: AutoSaveErrorKind | null;
  syncState?: AutoSaveSyncState;
  syncStatus?: 'SYNCED' | 'PENDING' | 'ERROR';
  /** autosave-lost-reply: where a failed save stands with respect to retrying. */
  retryPhase?: AutoSaveRetryPhase | null;
  /** Retry the failed save now (the exhausted pill's button, the red pill's MANUAL retry). */
  onRetry?: () => void | Promise<void>;
}

// Show CONFLICT before generic ERROR — it has a different recovery
// path (reload server data) and a different message tone.

function formatTime(date: Date): string {
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function AutoSaveIndicator({
  isDirty,
  isSaving,
  lastSavedAt,
  error,
  errorKind,
  syncState,
  syncStatus,
  retryPhase,
  onRetry,
}: AutoSaveIndicatorProps) {
  // The red pill's cause, opened by a tap: `title` alone never shows on a phone.
  const [causeOpen, setCauseOpen] = useState(false);
  // Fix round 1 (M4): the visible label stays the accessible name; the cause is the
  // description (aria-describedby), read after the name, never in place of it.
  const causeId = useId();
  const effectiveSyncState: AutoSaveSyncState | undefined = syncState
    ?? (syncStatus === 'PENDING' ? (isSaving ? 'SYNCING' : isDirty ? 'DIRTY_LOCAL' : 'SYNCING')
      : syncStatus === 'ERROR' ? 'ERROR'
        : syncStatus === 'SYNCED' ? 'SYNCED'
          : undefined);
  if (effectiveSyncState === 'OFFLINE_RETRY' && retryPhase === 'EXHAUSTED') {
    return (
      <>
      <button
        type="button"
        data-testid="auto-save-indicator"
        data-state="retry-exhausted"
        onClick={() => { void onRetry?.(); }}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        title={error ?? undefined}
        aria-describedby={error ? causeId : undefined}
      >
        <Icons.RefreshCcw size={13} />
        ลองบันทึกอีกครั้ง
      </button>
      {error ? <span id={causeId} className="sr-only">{error}</span> : null}
      </>
    );
  }

  if (effectiveSyncState === 'OFFLINE_RETRY' && retryPhase === 'SCHEDULED') {
    return (
      <>
      <span
        data-testid="auto-save-indicator"
        data-state="retrying"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
        title={error ?? undefined}
        role="status"
        aria-describedby={error ? causeId : undefined}
      >
        <Icons.RefreshCcw size={13} />
        กำลังลองบันทึกใหม่
      </span>
      {error ? <span id={causeId} className="sr-only">{error}</span> : null}
      </>
    );
  }

  if (effectiveSyncState === 'OFFLINE_RETRY') {
    return (
      <span
        data-testid="auto-save-indicator"
        data-state="offline-retry"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
        title={error || 'ระบบออฟไลน์ ข้อมูลถูกเก็บไว้ในเครื่องและจะลองซิงค์ใหม่'}
      >
        <Icons.AlertTriangle size={13} />
        รอซิงค์เมื่อออนไลน์
      </span>
    );
  }

  if (errorKind === 'CONFLICT') {
    return (
      <span
        data-testid="auto-save-indicator"
        data-state="conflict"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
        title={error ?? 'อีกแท็บได้บันทึกร่างไปก่อนหน้านี้แล้ว โปรดโหลดข้อมูลล่าสุด'}
      >
        <Icons.AlertTriangle size={13} />
        แท็บอื่นบันทึกแล้ว โปรดรีโหลด
      </span>
    );
  }

  if (effectiveSyncState === 'ERROR' || error) {
    const label = errorKind === 'AUTH' ? 'เซสชันหมดอายุ' : errorKind === 'OWNER' ? 'บันทึกในบัญชีนี้ไม่ได้' : 'บันทึกไม่สำเร็จ';
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          data-testid="auto-save-indicator"
          data-state={errorKind === 'AUTH' ? 'auth-error' : 'error'}
          aria-expanded={causeOpen}
          aria-describedby={error ? causeId : undefined}
          onClick={() => setCauseOpen((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          title={error ?? undefined}
        >
          <Icons.AlertTriangle size={13} />
          {label}
        </button>
        {error && !causeOpen ? <span id={causeId} className="sr-only">{error}</span> : null}
        {causeOpen && error ? (
          <span
            id={causeId}
            role="status"
            data-testid="auto-save-cause"
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-3 text-left text-xs font-medium leading-relaxed text-popover-foreground shadow-lg"
          >
            {error}
            {retryPhase === 'MANUAL' && onRetry ? (
              <button
                type="button"
                onClick={() => { setCauseOpen(false); void onRetry(); }}
                className="mt-2 block rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                ลองบันทึกอีกครั้ง
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
    );
  }

  if (isSaving || effectiveSyncState === 'SYNCING') {
    return (
      <span
        data-testid="auto-save-indicator"
        data-state="syncing"
        className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700"
      >
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" aria-hidden="true" />
        กำลังซิงค์ข้อมูล...
      </span>
    );
  }

  if (isDirty || effectiveSyncState === 'DIRTY_LOCAL') {
    return (
      <span
        data-testid="auto-save-indicator"
        data-state="dirty-local"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
      >
        <Icons.Edit size={13} />
        มีการเปลี่ยนแปลง (รอบันทึก)
      </span>
    );
  }

  return (
    <span
      data-testid="auto-save-indicator"
      data-state={lastSavedAt ? 'synced' : 'idle'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
        lastSavedAt ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-muted text-muted-foreground',
      )}
      title={lastSavedAt ? `บันทึกล่าสุด ${lastSavedAt.toLocaleString('th-TH')}` : 'ยังไม่มีการบันทึก'}
    >
      {lastSavedAt ? <Icons.Check size={13} /> : <Icons.Clock size={13} />}
      {lastSavedAt ? `บันทึกแล้ว ${formatTime(lastSavedAt)}` : 'พร้อมบันทึก'}
    </span>
  );
}

export default AutoSaveIndicator;
