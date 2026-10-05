"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProviderLayout from '../../../../components/provider-layout';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, ArrowLeft, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { ConfirmDialog } from '@/components/feature';
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { ADMIN_ROLE_OPTIONS } from '@/lib/constants/admin-role-options';

interface Membership {
    userId: string;
    groupCode: string;
    titleTH: string;
    titleEN: string;
    isActive: boolean;
    assignedAt: string;
    assignedBy: string | null;
}

/**
 * X5-FIX-A / H-6 (UG-1): group list now derives from the canonical
 * `ADMIN_ROLE_OPTIONS` (Tier 16-aware). The previous static 5-entry
 * list was missing `account_dtam` + `account_platform`, so admins
 * could not add split-finance group memberships from the user-groups
 * page. Backend membership tables now accept the split-role group
 * codes (B16-B migration); the UI catches up here.
 *
 * `health` is filtered out because health = applicant, never a staff
 * group. `system` is filtered out (hidden in canonical source).
 */
const ALL_GROUPS = ADMIN_ROLE_OPTIONS
    .filter((option) => !option.hidden && option.canonical !== 'health')
    .map((option) => ({
        code: option.canonical,
        titleTH: option.label,
    }));

const apiPath = (full: string) => full.replace(/^\/api\//, '');

interface Props {
    userId: string;
}

export default function UserGroupsClient({ userId }: Props) {
    const [memberships, setMemberships] = useState<Membership[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState('document_reviewer');
    // Wave E.3-C follow-up: ConfirmDialog state for group removal.
    const [pendingRemoveGroup, setPendingRemoveGroup] = useState<string | null>(null);

    const fetchMemberships = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<Membership[]>(apiPath(providerApiPaths.userGroups(userId)));
            if (res.success && Array.isArray(res.data)) {
                setMemberships(res.data);
            } else {
                notifications.show({
                    color: 'red',
                    title: 'โหลดไม่สำเร็จ',
                    message: res.error || '',
                    icon: <AlertCircle size={16} />,
                });
            }
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    useEffect(() => { fetchMemberships(); }, [fetchMemberships]);

    async function addGroup() {
        if (!selectedGroup) return;
        if (memberships.some((m) => m.groupCode === selectedGroup && m.isActive)) {
            notifications.show({
                color: 'yellow',
                title: 'ผู้ใช้อยู่ใน group นี้แล้ว',
                message: '',
            });
            return;
        }
        setBusy(true);
        try {
            const res = await apiClient.post<Membership>(
                apiPath(providerApiPaths.userGroups(userId)),
                { groupCode: selectedGroup },
            );
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'เพิ่ม group ล้มเหลว',
                    message: res.error || '',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            // X5-FIX-B H-1: teal → green (Mantine canonical positive palette).
            notifications.show({ color: 'green', title: 'เพิ่มเรียบร้อย', message: '' });
            await fetchMemberships();
        } finally {
            setBusy(false);
        }
    }

    // Wave E.3-C follow-up: removeGroup now opens a state-driven dialog.
    function removeGroup(groupCode: string) {
        setPendingRemoveGroup(groupCode);
    }

    async function performRemoveGroup(groupCode: string) {
        setBusy(true);
        try {
            const res = await apiClient.delete<{ success: boolean }>(
                apiPath(providerApiPaths.userGroupRemove(userId, groupCode)),
            );
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'ลบล้มเหลว',
                    message: res.error || '',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            // X5-FIX-B H-1: teal → green (Mantine canonical positive palette).
            notifications.show({ color: 'green', title: 'ลบเรียบร้อย', message: '' });
            await fetchMemberships();
        } finally {
            setBusy(false);
            setPendingRemoveGroup(null);
        }
    }

    const availableToAdd = ALL_GROUPS.filter(
        (g) => !memberships.some((m) => m.groupCode === g.code && m.isActive),
    );

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 sm:p-6">
                <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="subtle">
                        <Link href="/provider/management">
                            <ArrowLeft size={14} className="mr-1" /> กลับไปจัดการพนักงาน
                        </Link>
                    </Button>
                </div>

                {/* Minimal-redesign pass (2026-07-24): the forest→leaf gradient hero
                    banner is gone — a plain page title on the page background reads
                    calmer and keeps the same title / user id / RBAC explainer. */}
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-foreground">จัดการ Group ของผู้ใช้</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        User ID: <span className="font-mono text-xs">{userId}</span>
                    </p>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                        ผู้ใช้ 1 คนสามารถอยู่ในหลาย group พร้อมกันได้ Auditor ที่ทำทั้ง doc-review + field-audit
                        ให้เพิ่ม group ทั้งสองตัว เพื่อให้เห็นงานทั้งสองประเภทใน /provider/work
                    </p>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20"><Spinner /></div>
                ) : (
                    <>
                        <Card className="p-5 sm:p-6">
                            <div className="mb-4 flex items-center gap-2.5">
                                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <h2 className="text-sm font-medium text-foreground">
                                    Group ปัจจุบัน ({memberships.filter((m) => m.isActive).length})
                                </h2>
                            </div>
                            {memberships.length === 0 ? (
                                <div className="px-4 py-8 text-center">
                                    <p className="text-sm italic text-muted-foreground">
                                        ผู้ใช้นี้ยังไม่มี membership ระบบจะ fallback ไปใช้ User.role เดิม
                                    </p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border border-t border-border">
                                    {memberships.map((m) => (
                                        <div
                                            key={m.groupCode}
                                            className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-medium text-foreground">{m.titleTH}</p>
                                                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${m.isActive ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-muted text-muted-foreground'}`}>
                                                            {m.isActive ? 'active' : 'inactive'}
                                                        </span>
                                                    </div>
                                                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{m.groupCode}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                                                <p className="text-xs text-muted-foreground">
                                                    เพิ่มเมื่อ {new Date(m.assignedAt).toLocaleDateString('th-TH')}
                                                </p>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    disabled={busy || !m.isActive}
                                                    onClick={() => removeGroup(m.groupCode)}
                                                >
                                                    <Trash2 size={14} className="mr-1" /> ลบออก
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        {availableToAdd.length > 0 ? (
                            <Card className="p-5 sm:p-6">
                                <div className="mb-4 flex items-center gap-2.5">
                                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <h2 className="text-sm font-medium text-foreground">
                                        เพิ่ม Group
                                    </h2>
                                </div>
                                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                                    <select
                                        value={selectedGroup}
                                        onChange={(e) => setSelectedGroup(e.target.value)}
                                        aria-label="เลือกกลุ่มผู้ใช้ที่จะเพิ่ม"
                                        className="min-h-[44px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-leaf sm:w-auto sm:flex-1"
                                    >
                                        {availableToAdd.map((g) => (
                                            <option key={g.code} value={g.code}>
                                                {g.titleTH} ({g.code})
                                            </option>
                                        ))}
                                    </select>
                                    <Button onClick={addGroup} disabled={busy} className="w-full sm:w-auto">
                                        <Plus size={14} className="mr-1" /> เพิ่ม
                                    </Button>
                                </div>
                            </Card>
                        ) : (
                            <Card className="p-8 text-center">
                                <Users className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    ผู้ใช้นี้อยู่ในทุก group แล้ว
                                </p>
                            </Card>
                        )}
                    </>
                )}
            </div>

            {/* Wave E.3-C follow-up: replacement for window.confirm() on group removal. */}
            <ConfirmDialog
                open={pendingRemoveGroup !== null}
                onOpenChange={(open) => { if (!open && !busy) setPendingRemoveGroup(null); }}
                onConfirm={() => { if (pendingRemoveGroup) performRemoveGroup(pendingRemoveGroup); }}
                title="ลบผู้ใช้ออกจาก group?"
                description={pendingRemoveGroup ? `จะลบผู้ใช้ออกจาก group ${pendingRemoveGroup}` : ''}
                confirmLabel="ลบ"
                variant="destructive"
            />
        </ProviderLayout>
    );
}
