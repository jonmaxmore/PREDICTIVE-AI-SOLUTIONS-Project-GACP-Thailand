'use client';

/**
 * Auto-Save Status Indicator
 * Shows sync state: idle | syncing | synced | error
 */

import { useApplicationFormStore } from './use-application-form-store';

export function AutoSaveIndicator() {
  const syncStatus = useApplicationFormStore((s) => s.syncStatus);
  const lastError = useApplicationFormStore((s) => s.lastSyncError);

  if (syncStatus === 'idle') return null;

  const config = {
    syncing: { dot: 'bg-amber-400 animate-pulse', text: 'กำลังบันทึก...', color: 'text-amber-600' },
    synced: { dot: 'bg-leaf-600', text: 'บันทึกแล้ว', color: 'text-leaf-700' },
    error: { dot: 'bg-red-500', text: lastError || 'บันทึกไม่สำเร็จ', color: 'text-red-500' },
  }[syncStatus] || { dot: '', text: '', color: '' };

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.text}
    </span>
  );
}
