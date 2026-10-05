"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Save } from 'lucide-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import { SummaryHeader } from '@/components/feature/summary-header';

// External-services cleanup, Task 4 (2026-08-19): the email/SMS channel
// concept is gone from the backend — notification-preferences-service.js
// only tracks an `inApp` toggle per notification type now (business
// email/SMS dispatch was retired in Tasks 1-3; see
// shared/notification-view.js:16-19 for the operator decision this
// executes). This UI drops the email/SMS columns to match. A stored or
// in-flight payload may still carry legacy `email`/`sms` sub-keys from
// before the cleanup — they are simply never read or written back here,
// so an old value cannot crash this component.
interface PrefsPayload {
    channels: Record<string, { inApp?: boolean }>;
}

interface TypeRow {
    code: string;
    label: string;
    description?: string;
}

interface TypeGroup {
    title: string;
    rows: TypeRow[];
}

const HEALTH_GROUPS: TypeGroup[] = [
    {
        title: 'การชำระเงิน',
        rows: [
            { code: 'PAYMENT_REMINDER', label: 'แจ้งเตือนชำระเงิน' },
            { code: 'PAYMENT_PHASE1_SUCCESS', label: 'ยืนยันชำระค่าเอกสาร' },
            { code: 'PAYMENT_PHASE2_SUCCESS', label: 'ยืนยันการชำระค่าบริการก่อนตรวจแปลง' },
        ],
    },
    {
        title: 'สถานะคำขอ',
        rows: [
            { code: 'APPLICATION_SUBMITTED', label: 'ส่งคำขอสำเร็จ' },
            { code: 'APPLICATION_APPROVED', label: 'คำขอได้รับการอนุมัติ' },
            { code: 'APPLICATION_REJECTED', label: 'คำขอไม่ผ่าน' },
            { code: 'REVISION_REQUIRED', label: 'ต้องแก้ไขเอกสาร' },
            { code: 'REVISION_DEADLINE_APPROACHING', label: 'ใกล้ครบกำหนดแก้ไข' },
        ],
    },
    {
        title: 'การตรวจประเมิน + ใบรับรอง',
        rows: [
            { code: 'AUDIT_SCHEDULED', label: 'นัดหมายการตรวจประเมิน' },
            { code: 'CERTIFICATE_EXPIRING', label: 'ใบรับรองใกล้หมดอายุ' },
        ],
    },
];

const PROVIDER_GROUPS: TypeGroup[] = [
    {
        title: 'งานในระบบ Work Queue (ADR-016)',
        rows: [
            { code: 'WORK_ACTIVITY_ASSIGNED', label: 'ได้รับมอบหมายงานใหม่' },
            { code: 'WORK_ACTIVITY_WARNING', label: 'งานใกล้ครบกำหนด SLA' },
            { code: 'WORK_ACTIVITY_BREACH', label: 'งานเลย SLA แล้ว' },
        ],
    },
    {
        title: 'การมอบหมาย + workflow',
        rows: [
            { code: 'NEW_APPLICATION_ASSIGNED', label: 'คำขอใหม่รอจ่ายงาน' },
            { code: 'WORK_ASSIGNED_TO_REVIEWER', label: 'ได้รับมอบหมายตรวจเอกสาร' },
            { code: 'AUDIT_ASSIGNED', label: 'ได้รับมอบหมายตรวจประเมิน' },
            { code: 'AUDIT_REASSIGNED', label: 'งานถูกย้ายมือผู้ตรวจ' },
            { code: 'CAR_SUBMITTED', label: 'CAR ส่งกลับมาให้ตรวจ' },
        ],
    },
];

interface Props {
    portal: 'health' | 'provider';
    apiBase: string; // e.g. "/auth/health" or "/auth/provider"
}

export function NotificationPreferences({ portal, apiBase }: Props) {
    const [prefs, setPrefs] = useState<PrefsPayload>({ channels: {} });
    const [isLoading, setIsLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const groups = portal === 'health' ? HEALTH_GROUPS : PROVIDER_GROUPS;

    const fetchPrefs = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<PrefsPayload>(`${apiBase}/me/notification-prefs`);
            if (res.success && res.data) {
                setPrefs(res.data);
            } else {
                setPrefs({ channels: {} });
            }
        } finally {
            setIsLoading(false);
        }
    }, [apiBase]);

    useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

    // A legacy-shaped entry (from before this cleanup) may still carry
    // `email`/`sms` keys alongside — or instead of — `inApp`. Reading only
    // `.inApp` here tolerates that shape without crashing or echoing the
    // retired fields back to the server.
    function getValue(type: string): boolean {
        const entry = prefs.channels[type];
        if (!entry || entry.inApp === undefined) return true; // default-allow
        return entry.inApp !== false;
    }

    function toggle(type: string) {
        const current = getValue(type);
        setPrefs((prev) => {
            const next = { ...prev, channels: { ...prev.channels } };
            next.channels[type] = { inApp: !current };
            return next;
        });
    }

    async function save() {
        setBusy(true);
        try {
            const res = await apiClient.put<PrefsPayload>(`${apiBase}/me/notification-prefs`, prefs);
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'บันทึกล้มเหลว',
                    message: res.error || 'ไม่สามารถบันทึกการตั้งค่าได้',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: 'teal',
                title: 'บันทึกเรียบร้อย',
                message: 'การตั้งค่าการแจ้งเตือนถูกบันทึกแล้ว',
            });
        } finally {
            setBusy(false);
        }
    }

    if (isLoading) {
        return (
            <Card className="rounded-2xl border-border bg-card p-12 text-center shadow-sm">
                <Spinner />
            </Card>
        );
    }

    return (
        // Wave E.2-B (batch 9): SummaryHeader replaces inline h1+p Card
        // (used by both /health/profile/notifications and
        // /provider/profile/notifications). Eyebrow swaps based on
        // the portal prop the parent already passes for HEALTH_GROUPS
        // vs PROVIDER_GROUPS selection.
        <div className="space-y-4">
            <SummaryHeader
                eyebrow={portal === 'health' ? 'ผู้ขอรับรอง · การแจ้งเตือน' : 'ผู้ให้บริการ · การแจ้งเตือน'}
                title="การแจ้งเตือน"
                description="เลือกว่าต้องการรับการแจ้งเตือนในแอปสำหรับเหตุการณ์แต่ละประเภทหรือไม่ (อีเมลและ SMS ยกเลิกแล้ว การแจ้งเตือนทั้งหมดอยู่ในแอปเท่านั้น)"
            />

            {groups.map((group) => (
                <Card key={group.title} className="rounded-2xl border-border bg-card p-6 shadow-sm">
                    <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                        {group.title}
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-xs text-muted-foreground">
                                    <th className="px-3 py-2">เหตุการณ์</th>
                                    <th className="px-3 py-2 text-center">ในแอป</th>
                                </tr>
                            </thead>
                            <tbody>
                                {group.rows.map((row) => (
                                    <tr key={row.code} className="border-b last:border-0">
                                        <td className="px-3 py-3">
                                            <p className="font-medium">{row.label}</p>
                                            <p className="font-mono text-[10px] text-muted-foreground">{row.code}</p>
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <input
                                                type="checkbox"
                                                checked={getValue(row.code)}
                                                onChange={() => toggle(row.code)}
                                                className="h-4 w-4 rounded"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            ))}

            <div className="flex justify-end">
                <Button onClick={save} disabled={busy}>
                    <Save size={14} className="mr-1" /> บันทึกการตั้งค่า
                </Button>
            </div>
        </div>
    );
}
