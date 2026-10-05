import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/language-context';
import { AlertCircle, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { formatThaiDate } from "@/lib/format/thai-date";
import {
    statusTone,
    STATUS_BADGE_CLASSES,
} from "../applications/[id]/provider-application-detail-config";
import { type FinalApprovalItem } from "./auditor-types";

interface FinalApprovalListProps {
    items: FinalApprovalItem[];
    isApproving: string | null;
    rejectingId: string | null;
    rejectReason: string;
    setRejectingId: (id: string | null) => void;
    setRejectReason: (reason: string) => void;
    handleFinalApprove: (id: string) => Promise<void>;
    handleReject: () => Promise<void>;
    // X3-FIX-A / H-3 — explicit fetch-error state for the final-approval
    // queue load. Mirrors the X1-FIX-C / X2-FIX-C error-card pattern from
    // health/dashboard + provider/dashboard. Before X3 the parent's
    // `fetchFinalApprovalQueue` swallowed network/5xx errors silently,
    // rendering the "ไม่มีรายการรออนุมัติขั้นสุดท้าย" empty state
    // indistinguishable from a true empty queue. AUDITOR had no retry
    // CTA and could miss certificates queued for final sign-off.
    //
    // These props are optional so the legacy call-site (`client-view.tsx`)
    // continues to work unchanged. When the parent later wires the catch
    // path through these props the error Card surfaces automatically.
    fetchError?: string | null;
    onRetry?: () => void | Promise<void>;
}

export function FinalApprovalList({
    items,
    isApproving,
    rejectingId,
    rejectReason,
    setRejectingId,
    setRejectReason,
    handleFinalApprove,
    handleReject,
    fetchError,
    onRetry,
}: FinalApprovalListProps) {
    const { dict } = useLanguage();
    return (
        <div className="space-y-4">
            {/* X3-FIX-A / H-3 — inline fetch-error card. Renders ONLY when
                the parent passed a non-null fetchError. Empty state below
                still handles the no-results case so the contracts stay
                independent (error ≠ empty). */}
            {fetchError ? (
                <Card
                    data-testid="final-approval-fetch-error"
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
                >
                    <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" aria-hidden="true" focusable="false" />
                    <h3 className="text-base font-bold text-destructive">
                        {dict.common?.fetchError?.title || 'ไม่สามารถโหลดข้อมูลได้'}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{fetchError}</p>
                    {onRetry ? (
                        <Button
                            type="button"
                            variant="outline"
                            className="mt-4 min-h-[44px]"
                            onClick={() => { void onRetry(); }}
                        >
                            {dict.common?.fetchError?.retry || 'ลองอีกครั้ง'}
                        </Button>
                    ) : null}
                </Card>
            ) : null}

            {items.map((item) => {
                const { label, tone } = statusTone(item.status);
                return (
                <div
                    className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
                    key={item.id}
                >
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground">
                            {item.applicationNumber}
                        </p>
                        <p className="font-bold text-foreground">{item.applicantName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className={cn(
                                "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold",
                                STATUS_BADGE_CLASSES[tone],
                            )}>
                                {label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                อัปเดต: {formatThaiDate(item.updatedAt)}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            loading={isApproving === item.id}
                            onClick={() => handleFinalApprove(item.id)}
                        >
                            <CheckCircle2 size={16} className="mr-1.5" />
                            อนุมัติ
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectingId(item.id); setRejectReason(""); }}
                        >
                            <XCircle size={16} className="mr-1.5" />
                            ตีกลับ
                        </Button>
                        <Button
                            href={`/provider/certification-decisions/${item.id}`}
                            size="sm"
                            variant="secondary"
                        >
                            รายละเอียด
                            <ChevronRight size={16} className="ml-1" />
                        </Button>
                    </div>
                </div>
                );
            })}

            {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-2 rounded-full bg-success/10 p-3">
                        <CheckCircle2 className="h-6 w-6 text-success" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                        ไม่มีรายการรออนุมัติขั้นสุดท้าย
                    </p>
                </div>
            )}

            {rejectingId && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                    <h4 className="mb-2 font-bold text-destructive">ตีกลับคำขอ</h4>
                    <textarea
                        className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/20"
                        rows={3}
                        placeholder="ระบุเหตุผลในการตีกลับ (จำเป็น)..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="mt-3 flex gap-2">
                        <Button
                            size="sm"
                            variant="destructive"
                            loading={isApproving === rejectingId}
                            disabled={!rejectReason.trim()}
                            onClick={handleReject}
                        >
                            ยืนยันตีกลับ
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectingId(null); setRejectReason(""); }}
                        >
                            ยกเลิก
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
