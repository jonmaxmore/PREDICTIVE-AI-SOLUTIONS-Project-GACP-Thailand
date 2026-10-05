'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';

/**
 * TraceUnavailable — the shared NEUTRAL state every public /trace/** surface
 * renders when NO verdict was reached (backend down / 5xx / network failure).
 *
 * Mirrors the amber ServiceUnavailable pattern of /verify/[cert-number]:
 * role="status", Thai headline + English subline, and a full-reload retry
 * anchor (Button href renders a plain <a>, so retrying re-runs the fetch from
 * scratch). These pages are QR-scan trust surfaces on product packaging —
 * a transport failure must NEVER be presented as a red "ไม่พบข้อมูล /
 * not found" verdict against a genuine product.
 */
export function TraceUnavailable({ retryHref, code }: { retryHref: string; code?: string }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-20">
            <div
                role="status"
                className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm"
            >
                <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-white">
                    <AlertTriangle className="h-8 w-8" aria-hidden="true" />
                </span>
                <h2 className="text-xl font-bold text-amber-800">ไม่สามารถตรวจสอบได้ในขณะนี้</h2>
                <p className="mt-2 text-sm leading-relaxed text-amber-700">
                    ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง
                </p>
                <p className="mt-1 text-xs text-amber-700">
                    Verification temporarily unavailable — please try again.
                </p>
                {code ? (
                    <p className="mt-4 font-mono text-xs text-muted-foreground">ID: {code}</p>
                ) : null}
                <div className="mt-6 flex flex-col gap-2">
                    {/* Full-reload anchor (not a client-side <Link>) so the retry
                        re-runs the trace fetch even if the SPA state is wedged. */}
                    <Button
                        href={retryHref}
                        variant="outline"
                        className="h-11 w-full rounded-xl border-amber-300 font-bold text-amber-700 hover:bg-amber-100"
                    >
                        ลองตรวจสอบอีกครั้ง
                    </Button>
                    <Button href="/" variant="ghost" className="h-11 w-full rounded-xl text-muted-foreground">
                        กลับหน้าแรก
                    </Button>
                </div>
            </div>
        </div>
    );
}
