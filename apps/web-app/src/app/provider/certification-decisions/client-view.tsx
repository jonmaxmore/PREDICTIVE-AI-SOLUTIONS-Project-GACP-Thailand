"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from "react";
import ProviderLayout from "../components/provider-layout";
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { LaunchpadHeader } from '@/components/provider/launchpad';
import { AlertCircle, RefreshCcw } from "lucide-react";
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from "@/lib/services/provider-api";
import {
    type FinalApprovalItem,
    PROVIDERRequest,
} from "../audits/auditor-types";
import { FinalApprovalList } from "../audits/final-approval-list";

/**
 * คิวตัดสินให้การรับรอง — หน้าจอเดียวของบทบาท certificate_approver
 *
 * ใช้ <FinalApprovalList> ตัวเดียวกับแท็บ "อนุมัติ" ในหน้าผู้ตรวจ: การตัดสินใบเดียวกัน
 * ควรหน้าตาเหมือนกันไม่ว่าใครเปิด · ที่ไม่เหมือนคือหน้านี้ไม่แตะ endpoint ของผู้ตรวจเลย
 * (ดูเหตุผลใน page.tsx) จึงไม่มีวันขึ้น error เพราะสิทธิ์ที่บทบาทนี้ตั้งใจไม่มี
 */
export default function CertificationDecisionsPage() {
    const [items, setItems] = useState<FinalApprovalItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    const fetchQueue = useCallback(async () => {
        setFetchError(null);
        try {
            const result = await PROVIDERRequest<{ total: number; items: FinalApprovalItem[] }>(
                providerApiPaths.auditorFinalApprovalQueue,
            );
            if (result.success && result.data) {
                setItems(result.data.items || []);
            } else {
                setFetchError(result.error || "ไม่สามารถโหลดคิวรอการตัดสินได้");
                setItems([]);
            }
        } catch (error: unknown) {
            const message = error instanceof Error && error.message
                ? error.message
                : "ไม่สามารถโหลดคิวรอการตัดสินได้";
            setFetchError(message);
            setItems([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void fetchQueue(); }, [fetchQueue]);

    const handleFinalApprove = async (applicationId: string) => {
        setIsApproving(applicationId);
        try {
            const result = await PROVIDERRequest(providerApiPaths.auditorFinalApproval(applicationId), {
                method: "POST",
                body: JSON.stringify({ comment: "ตัดสินให้การรับรองโดยผู้อนุมัติใบรับรอง" }),
            });
            if (!result.success) {
                // ด่านแยกหน้าที่ตอบเป็นข้อความไทยที่บอกเหตุและสิ่งที่ต้องทำต่อ
                // (certification-decision-separation.js) — แสดงข้อความนั้นตรง ๆ ไม่ทับ
                notifications.show({
                    color: "red",
                    title: "ตัดสินให้การรับรองไม่สำเร็จ",
                    message: result.error || "ไม่สามารถอนุมัติได้",
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: "teal",
                title: "ตัดสินให้การรับรองแล้ว",
                message: "คำขอได้รับการรับรอง และใบรับรองถูกออกให้แล้ว",
            });
            await fetchQueue();
        } catch {
            notifications.show({
                color: "red",
                title: "ข้อผิดพลาด",
                message: "เกิดข้อผิดพลาดระหว่างตัดสินให้การรับรอง",
                icon: <AlertCircle size={16} />,
            });
        } finally {
            setIsApproving(null);
        }
    };

    const handleReject = async () => {
        if (!rejectingId || !rejectReason.trim()) { return; }
        setIsApproving(rejectingId);
        try {
            const result = await PROVIDERRequest(providerApiPaths.auditorRejectToAuditor(rejectingId), {
                method: "POST",
                body: JSON.stringify({ comment: rejectReason.trim() }),
            });
            if (!result.success) {
                notifications.show({
                    color: "red",
                    title: "ส่งกลับไม่สำเร็จ",
                    message: result.error || "ไม่สามารถส่งกลับให้ทบทวนได้",
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: "orange",
                title: "ส่งกลับให้ทบทวนแล้ว",
                message: "คำขอถูกส่งกลับไปยังผู้ตรวจประเมินแปลง และใบรับรองที่ออกไปแล้วถูกยกเลิก",
            });
            setRejectingId(null);
            setRejectReason("");
            await fetchQueue();
        } catch {
            notifications.show({
                color: "red",
                title: "ข้อผิดพลาด",
                message: "เกิดข้อผิดพลาดระหว่างส่งกลับ",
                icon: <AlertCircle size={16} />,
            });
        } finally {
            setIsApproving(null);
        }
    };

    return (
        <ProviderLayout>
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
                <LaunchpadHeader
                    greeting="ผู้อนุมัติใบรับรอง"
                    title="ตัดสินให้การรับรอง"
                    subtitle={`คำขอที่ผ่านการตรวจประเมินแล้ว รอการตัดสิน · ${items.length} รายการ`}
                    actions={(
                        <Button variant="outline" size="sm" onClick={() => void fetchQueue()}>
                            <RefreshCcw size={16} className="mr-2" />
                            รีเฟรช
                        </Button>
                    )}
                />

                {isLoading ? (
                    <div className="flex justify-center py-16"><Spinner /></div>
                ) : (
                    <FinalApprovalList
                        items={items}
                        isApproving={isApproving}
                        rejectingId={rejectingId}
                        rejectReason={rejectReason}
                        setRejectingId={setRejectingId}
                        setRejectReason={setRejectReason}
                        handleFinalApprove={handleFinalApprove}
                        handleReject={handleReject}
                        fetchError={fetchError}
                        onRetry={fetchQueue}
                    />
                )}
            </div>
        </ProviderLayout>
    );
}
