"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProviderLayout from "../../components/provider-layout";
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { LaunchpadHeader } from '@/components/provider/launchpad';
import { AlertCircle, ChevronLeft } from "lucide-react";
import { providerApiPaths } from "@/lib/services/provider-api";
import { PROVIDERRequest } from "../../audits/auditor-types";
import { DecisionFileView } from "./decision-file-view";
import type { DecisionFile } from "./decision-file-types";

/**
 * แฟ้มคำขอของผู้อนุมัติใบรับรอง (อ่านอย่างเดียว) — เปิดจากปุ่ม "รายละเอียด" ในหน้าตัดสินให้การรับรอง
 * การอนุมัติ/ส่งกลับยังอยู่ที่หน้ารายการ หน้านี้ไม่แก้ข้อมูลใด ๆ
 */
export default function CertificationDecisionFilePage() {
    const params = useParams<{ id: string }>();
    const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
    const [file, setFile] = useState<DecisionFile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!id) { return; }
        setIsLoading(true);
        setError(null);
        try {
            const result = await PROVIDERRequest<DecisionFile>(providerApiPaths.auditorDecisionFile(id));
            if (result.success && result.data) {
                setFile(result.data);
            } else {
                setFile(null);
                setError(result.error || "ไม่สามารถโหลดแฟ้มคำขอได้");
            }
        } catch (e: unknown) {
            setFile(null);
            setError(e instanceof Error && e.message ? e.message : "ไม่สามารถโหลดแฟ้มคำขอได้");
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    return (
        <ProviderLayout>
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
                <LaunchpadHeader
                    greeting="ผู้อนุมัติใบรับรอง"
                    title={file ? `แฟ้มคำขอ ${file.application.applicationNumber}` : "แฟ้มคำขอ"}
                    subtitle="ดูหลักฐานทั้งหมดก่อนตัดสิน (อ่านอย่างเดียว) · อนุมัติหรือส่งกลับได้ที่หน้ารายการ"
                    actions={(
                        <Button href="/provider/certification-decisions" variant="outline" size="sm">
                            <ChevronLeft size={16} className="mr-1" />
                            กลับไปหน้ารายการ
                        </Button>
                    )}
                />
                {isLoading ? (
                    <div className="flex justify-center py-16"><Spinner /></div>
                ) : error ? (
                    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
                        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
                        <p className="text-sm text-foreground">{error}</p>
                        <Button type="button" variant="outline" className="mt-4 min-h-[44px]" onClick={() => void load()}>ลองอีกครั้ง</Button>
                    </div>
                ) : file ? (
                    <DecisionFileView file={file} />
                ) : null}
            </div>
        </ProviderLayout>
    );
}
