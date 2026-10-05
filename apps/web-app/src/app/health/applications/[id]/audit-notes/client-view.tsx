'use client';

/**
 * บันทึกของผู้ตรวจเกี่ยวกับคำขอของคุณ — PDPA ม.30 วรรคหนึ่ง, on a screen.
 *
 * The right to see your own data is not exercised by a database column; it is exercised by
 * a page a person can open. This is that page.
 *
 * A WITHHELD ROW IS SHOWN, not skipped. ม.30 วรรคสอง lets the platform refuse when a note
 * would affect another person's rights, and the honest way to refuse is to say a note
 * exists, say it is withheld, and say why — so the applicant can dispute it. A list that
 * silently omits rows cannot be checked by the person it is about, which is the one thing
 * an access right has to allow.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { apiClient as api } from '@/lib/api';
import { Badge } from '@/components/ui/primitives/badge';
import { PageSkeleton } from '@/components/ui/page-skeleton';

interface AuditNote {
    id: string;
    itemCode: string;
    section: string;
    response: string;
    isCritical: boolean;
    recordedAt: string | null;
    withheld: boolean;
    notes: string | null;
    withholdReason: string | null;
}
interface Payload {
    applicationId: string;
    items: AuditNote[];
    total: number;
    withheldCount: number;
}

const VERDICT_TH: Record<string, string> = {
    PASS: 'ผ่าน',
    FAIL: 'ไม่ผ่าน',
    NA: 'ไม่เกี่ยวข้อง',
};

function verdictTone(response: string): 'default' | 'destructive' | 'secondary' {
    if (response === 'FAIL') return 'destructive';
    if (response === 'PASS') return 'default';
    return 'secondary';
}

export default function ClientView() {
    const params = useParams();
    const applicationId = String(params?.id || '');
    const [payload, setPayload] = useState<Payload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!applicationId) return;
        setLoading(true);
        try {
            const response = await api.get<Payload>(`/applications/${applicationId}/audit-notes`);
            if (response.success && response.data) {
                setPayload(response.data);
                setError(null);
            } else {
                // The server sends its Thai sentence as `messageTh`, because the envelope
                // strips `message` from every non-2xx body.
                const meta = response as unknown as { messageTh?: string };
                setError(meta.messageTh || 'เปิดบันทึกของผู้ตรวจไม่ได้ กรุณาลองใหม่อีกครั้ง');
            }
        } catch {
            setError('เปิดบันทึกของผู้ตรวจไม่ได้ กรุณาลองใหม่อีกครั้ง');
        } finally {
            setLoading(false);
        }
    }, [applicationId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) return <PageSkeleton />;

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            <header className="mb-6">
                <h1 className="text-2xl font-bold text-foreground">บันทึกของผู้ตรวจเกี่ยวกับคำขอของคุณ</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    คุณมีสิทธิขอเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคลของตนเอง ตาม
                    พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 30
                </p>
            </header>

            {error ? (
                <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                    {error}
                </div>
            ) : null}

            {payload && payload.total === 0 ? (
                <p className="rounded-xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    ยังไม่มีบันทึกของผู้ตรวจสำหรับคำขอนี้
                </p>
            ) : null}

            {payload && payload.withheldCount > 0 ? (
                <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
                    มี {payload.withheldCount} รายการจากทั้งหมด {payload.total} รายการที่ไม่เปิดเผยข้อความบันทึก
                    ตามมาตรา 30 วรรคสอง โดยแสดงเหตุผลไว้ในแต่ละรายการ
                </p>
            ) : null}

            <ul className="flex flex-col gap-3">
                {(payload?.items || []).map((item) => (
                    <li key={item.id} className="rounded-xl bg-card p-4 shadow-leaf-card">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{item.itemCode}</span>
                            <span className="text-sm font-semibold">{item.section}</span>
                            <Badge variant={verdictTone(item.response)}>
                                {VERDICT_TH[item.response] || item.response}
                            </Badge>
                            {item.isCritical ? <Badge variant="destructive">ข้อบังคับสำคัญ</Badge> : null}
                        </div>

                        {item.withheld ? (
                            <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/30">
                                <p className="font-semibold text-amber-900 dark:text-amber-100">
                                    ไม่เปิดเผยข้อความบันทึกนี้
                                </p>
                                <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                                    {item.withholdReason || 'ไม่ได้ระบุเหตุผลไว้'}
                                </p>
                            </div>
                        ) : (
                            <p className="whitespace-pre-wrap text-sm text-foreground">
                                {item.notes || <span className="text-muted-foreground">ผู้ตรวจไม่ได้เขียนบันทึกเพิ่มเติมในข้อนี้</span>}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
