/**
 * FeatureGate — ซ่อน/แสดง UI ตาม feature flag จาก SystemConfig
 *
 * Usage:
 *   <FeatureGate flag="feature.task_router">
 *     <TaskRouterPage />
 *   </FeatureGate>
 *
 *   <FeatureGate flag="feature.sop_library" fallback={<ComingSoon />}>
 *     <SOPLibrary />
 *   </FeatureGate>
 */
'use client';

import { type ReactNode } from 'react';
import { useFeatureFlag, type FeatureFlagKey } from '@/hooks/use-feature-flag';

interface FeatureGateProps {
  /** Feature flag key เช่น 'feature.task_router' */
  flag: FeatureFlagKey | string;
  /** Content ที่จะแสดงเมื่อ flag เปิด */
  children: ReactNode;
  /** Content ที่จะแสดงเมื่อ flag ปิด (optional) */
  fallback?: ReactNode;
}

export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeatureFlag(flag);

  if (!enabled) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
