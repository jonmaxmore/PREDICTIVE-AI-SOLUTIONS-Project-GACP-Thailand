'use client';

import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { useNavChips } from '@/lib/navigation/use-nav-chips';

/**
 * PlantingCertGate — /health/planting layout-level honesty gate (B-PLANTING
 * item 1, backlog #81 / B4, design doc R2 "ห้ามใช้ระบบบันทึกการปลูกก่อนได้
 * ใบรับรอง").
 *
 * Before this, /health/planting/layout.tsx was a 5-line pass-through: the
 * tile-home grid (app/health/home/client-view.tsx) hides the "การปลูก" tile
 * for a farmer with no usable certificate, but the ROUTE itself enforced
 * nothing — typing /health/planting/new directly reached a page that later
 * failed in confusing ways instead of an honest explanation up front.
 *
 * Reuses the EXACT SAME rule the tile-home lock uses, via the SAME hook —
 * getCertBadgeKind(...) !== 'expired' (see cert-status.ts), consumed here
 * as useNavChips()'s hasActiveCert/certsLoaded — rather than inventing a
 * second cert-lock computation. When nested under DashboardLayout (every
 * /health/* route, see components/layout/dashboard-layout.tsx), this reuses
 * the ALREADY-FETCHED value via NavCertLockContext instead of firing a
 * second /api/certificates/my GET.
 *
 * This is presentation/honesty only, not the real security boundary: the
 * server-side gate lives in planting-service.js (createCycle re-validates
 * an active, non-expired certificate independently). So this gate fails
 * OPEN — renders children, not a lock screen — while cert state is still
 * unknown (certsLoaded: false) or errored (certError: true); it only shows
 * the lock explanation once certsLoaded is true AND hasActiveCert is false,
 * exactly mirroring isTileLocked() in health/home/client-view.tsx and the
 * bottom-nav lock in dashboard-layout.tsx.
 */
export function PlantingCertGate({ children }: { children: React.ReactNode }) {
  const { hasActiveCert, certsLoaded } = useNavChips({ chips: false });
  const locked = certsLoaded && !hasActiveCert;

  if (!locked) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="h-7 w-7" aria-hidden="true" focusable="false" />
        </span>
        <h1 className="text-lg font-bold text-foreground">เมนูนี้ยังใช้งานไม่ได้</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          บันทึกการปลูกเปิดใช้เมื่อคุณได้รับใบรับรอง GACP ที่ยังไม่หมดอายุ
          ขณะนี้คุณยังไม่มีใบรับรอง GACP ที่ใช้งานได้
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button href="/health/status" variant="filled" className="w-full">
            ตรวจสอบสถานะคำขอของคุณ
          </Button>
          <Button href="/health/home" variant="outline" className="w-full">
            กลับหน้าหลัก
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default PlantingCertGate;
