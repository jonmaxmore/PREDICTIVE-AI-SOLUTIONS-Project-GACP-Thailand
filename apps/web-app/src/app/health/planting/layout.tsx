import { PlantingCertGate } from './planting-cert-gate';

export const dynamic = 'force-dynamic';

// The cert gate itself needs hooks/context (useNavChips, NavCertLockContext
// from the ancestor DashboardLayout) so it lives in a 'use client' component
// (planting-cert-gate.tsx). This file stays a server component so the
// `dynamic` route-segment config above keeps working — see
// planting-cert-gate.tsx for the actual gate logic and its rationale.
export default function PlantingLayout({ children }: { children: React.ReactNode }) {
  return <PlantingCertGate>{children}</PlantingCertGate>;
}
