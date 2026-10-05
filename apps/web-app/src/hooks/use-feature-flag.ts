/**
 * Feature Flag Hook — ใช้ SystemConfig ที่มีอยู่เดิม ไม่ต้องสร้าง table ใหม่
 *
 * Usage:
 *   const isEnabled = useFeatureFlag('feature.task_router');
 *   const { enabled, loading } = useFeatureFlags(['feature.task_router', 'feature.report_center']);
 */
import { useState, useEffect } from 'react';
import { getPublicSystemConfig, invalidatePublicSystemConfig } from '@/lib/system-config-cache';

// Feature flag keys ที่ระบบรองรับ
export const FEATURE_FLAGS = {
  TASK_ROUTER: 'feature.task_router',
  READINESS_CHECK: 'feature.readiness_check',
  DOCUMENT_REPO: 'feature.document_repo',
  SOP_LIBRARY: 'feature.sop_library',
  REPORT_CENTER: 'feature.report_center',
  OFFICIAL_TEMPLATES: 'feature.official_templates',
  EXPORT_DOCUMENTS: 'feature.export_documents',
  PERMIT_FORMS: 'feature.permit_forms',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

// Default values — ใช้เมื่อ API ยังโหลดไม่เสร็จ หรือ key ไม่มีใน DB
const FLAG_DEFAULTS: Record<string, boolean> = {
  [FEATURE_FLAGS.TASK_ROUTER]: true,
  [FEATURE_FLAGS.READINESS_CHECK]: true,
  [FEATURE_FLAGS.DOCUMENT_REPO]: true,
  [FEATURE_FLAGS.SOP_LIBRARY]: true,       // ON — 8 SOP templates ready
  [FEATURE_FLAGS.REPORT_CENTER]: true,
  [FEATURE_FLAGS.OFFICIAL_TEMPLATES]: true,
  [FEATURE_FLAGS.EXPORT_DOCUMENTS]: true,   // ON — unlocked for full-loop testing
  [FEATURE_FLAGS.PERMIT_FORMS]: true,       // ON — unlocked for full-loop testing
};

// Cache แบบ module-level เพื่อไม่ต้อง fetch ทุก component
let cachedFlags: Record<string, boolean> | null = null;
let fetchPromise: Promise<Record<string, boolean>> | null = null;

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return null;
}

async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    // W3-C: goes through the shared system-config session cache, so this
    // hook and ConfigProvider share ONE network request per page load.
    const data = await getPublicSystemConfig();
    if (!data) return { ...FLAG_DEFAULTS };

    const flags = { ...FLAG_DEFAULTS };
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('feature.')) {
        const parsed = parseBoolean(value);
        if (parsed !== null) {
          flags[key] = parsed;
        }
      }
    }
    return flags;
  } catch {
    return { ...FLAG_DEFAULTS };
  }
}

/**
 * Hook เดี่ยว — ตรวจ feature flag 1 ตัว
 *
 * @example
 * const isTaskRouterEnabled = useFeatureFlag('feature.task_router');
 */
export function useFeatureFlag(key: string): boolean {
  const defaultValue = FLAG_DEFAULTS[key] ?? false;
  const [enabled, setEnabled] = useState<boolean>(cachedFlags?.[key] ?? defaultValue);

  useEffect(() => {
    if (cachedFlags) {
      setEnabled(cachedFlags[key] ?? defaultValue);
      return;
    }

    // Deduplicate fetches
    if (!fetchPromise) {
      fetchPromise = fetchFeatureFlags().then(flags => {
        cachedFlags = flags;
        fetchPromise = null;
        return flags;
      });
    }

    fetchPromise.then(flags => {
      setEnabled(flags[key] ?? defaultValue);
    });
  }, [key, defaultValue]);

  return enabled;
}

/**
 * Hook หลายตัว — ตรวจ feature flags หลาย key พร้อมกัน
 *
 * @example
 * const { flags, loading } = useFeatureFlags(['feature.task_router', 'feature.sop_library']);
 * if (flags['feature.task_router']) { ... }
 */
export function useFeatureFlags(keys: string[]): { flags: Record<string, boolean>; loading: boolean } {
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of keys) {
      initial[key] = cachedFlags?.[key] ?? FLAG_DEFAULTS[key] ?? false;
    }
    return initial;
  });
  const [loading, setLoading] = useState(!cachedFlags);

  useEffect(() => {
    if (cachedFlags) {
      const result: Record<string, boolean> = {};
      for (const key of keys) {
        result[key] = cachedFlags[key] ?? FLAG_DEFAULTS[key] ?? false;
      }
      setFlags(result);
      setLoading(false);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetchFeatureFlags().then(f => {
        cachedFlags = f;
        fetchPromise = null;
        return f;
      });
    }

    fetchPromise.then(f => {
      const result: Record<string, boolean> = {};
      for (const key of keys) {
        result[key] = f[key] ?? FLAG_DEFAULTS[key] ?? false;
      }
      setFlags(result);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(keys)]);

  return { flags, loading };
}

/**
 * Invalidate cache — เรียกเมื่อ admin เปลี่ยน flag
 */
export function invalidateFeatureFlags(): void {
  cachedFlags = null;
  fetchPromise = null;
  // Flags derive from the shared system-config payload — drop that too so
  // the refetch actually hits the network instead of the stale cache.
  invalidatePublicSystemConfig();
}
