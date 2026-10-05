'use client';

/**
 * /health/workspaces — list every Entity the user is a member of with
 * role badges + a CTA to create a new JURISTIC / COMMUNITY workspace.
 *
 * Wave C PR-4. The list comes from useMyEntities() which already has it
 * cached from /api/entities/mine. There is no "active" entity: the entity an
 * application is filed for is chosen when the application starts.
 *
 * Wave D — top of the page now shows a "Pending Invitations" section
 * (when any) sourced from GET /api/entities/invitations. Each row has
 * Accept + Decline buttons that call
 *   POST /api/entities/:id/accept-invitation  (PR #155)
 *   POST /api/entities/:id/decline-invitation (PR #155)
 * After accept/decline, we refresh both the invitations list AND the
 * provider's entity list so the new workspace appears in the picker.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Users as UsersIcon, User as UserIcon, Plus, ArrowRight, Mail, Check, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { logger } from '@/lib/logger';
import { useMyEntities, type EntityMembership } from '@/lib/services/my-entities-provider';
import { ConfirmDialog, SummaryHeader } from '@/components/feature';

interface PendingInvitation {
    entityId: string;
    slug: string | null;
    type: EntityMembership['type'];
    displayName: string;
    role: EntityMembership['role'];
    invitedAt: string | null;
    invitedBy: { id: string; displayName: string | null } | null;
}

const TYPE_LABEL_TH: Record<EntityMembership['type'], string> = {
    INDIVIDUAL: 'บุคคลธรรมดา',
    JURISTIC: 'นิติบุคคล',
    COMMUNITY_ENTERPRISE: 'วิสาหกิจชุมชน',
};

const ROLE_LABEL_TH: Record<EntityMembership['role'], string> = {
    OWNER: 'เจ้าของ',
    ADMIN: 'ผู้ดูแล',
    MANAGER: 'ผู้จัดการ',
    VIEWER: 'ผู้ดู',
};

const ROLE_BADGE: Record<EntityMembership['role'], string> = {
    OWNER:   'bg-leaf-soft text-leaf-onSoft dark:bg-primary-900/40 dark:text-primary-300',
    ADMIN:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    MANAGER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    VIEWER:  'bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
};

function TypeIcon({ type, className }: { type: EntityMembership['type']; className?: string }) {
    if (type === 'INDIVIDUAL') return <UserIcon className={className} />;
    if (type === 'JURISTIC') return <Building2 className={className} />;
    return <UsersIcon className={className} />;
}

export default function WorkspacesListPage() {
    const { entities: myEntities, isLoading, refresh } = useMyEntities();
    const router = useRouter();
    // The person themself first, then the entities they belong to.
    const entities = [...myEntities].sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal));

    const onOpen = (e: EntityMembership) => {
        const target = e.slug ? `/health/workspaces/${e.slug}/members` : `/health/workspaces`;
        router.push(target);
    };

    // Wave D — pending invitations.
    const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
    const [invitationsLoading, setInvitationsLoading] = useState(true);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
    // Wave E.3-C follow-up: ConfirmDialog state for "decline invitation".
    const [pendingDecline, setPendingDecline] = useState<PendingInvitation | null>(null);

    const fetchInvitations = useCallback(async () => {
        try {
            const res = await apiClient.get<PendingInvitation[]>('/entities/invitations');
            if (res.success && res.data) setInvitations(res.data);
        } catch (err) {
            logger.error('[Workspaces] fetch invitations failed', err);
        } finally {
            setInvitationsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInvitations();
    }, [fetchInvitations]);

    const accept = async (inv: PendingInvitation) => {
        setActingOn(inv.entityId);
        setFlash(null);
        try {
            const res = await apiClient.post(`/entities/${inv.entityId}/accept-invitation`, {});
            if (!res.success) {
                setFlash({ ok: false, msg: res.error || 'รับคำเชิญไม่สำเร็จ' });
                return;
            }
            setFlash({ ok: true, msg: `เข้าร่วม "${inv.displayName}" เรียบร้อย` });
            await Promise.all([fetchInvitations(), refresh()]);
        } finally {
            setActingOn(null);
        }
    };

    const performDecline = async (inv: PendingInvitation) => {
        setActingOn(inv.entityId);
        setFlash(null);
        try {
            const res = await apiClient.post(`/entities/${inv.entityId}/decline-invitation`, {});
            if (!res.success) {
                setFlash({ ok: false, msg: res.error || 'ปฏิเสธคำเชิญไม่สำเร็จ' });
                return;
            }
            setFlash({ ok: true, msg: `ปฏิเสธคำเชิญ "${inv.displayName}" แล้ว` });
            await fetchInvitations();
        } finally {
            setActingOn(null);
            setPendingDecline(null);
        }
    };

    // Wave E.3-C follow-up: button now opens a state-driven dialog instead of
    // a native confirm. Dialog's onConfirm calls performDecline.
    const decline = (inv: PendingInvitation) => {
        setPendingDecline(inv);
    };

    return (
        // Wave E.2-B (batch 7): SummaryHeader replaces inline
        // h1+p+CTA. Outer max-w-4xl removed — DashboardLayout
        // already provides max-w-6xl + p-4/lg:p-8 padding.
        // Workspace count surfaces as a metric so the picker is
        // discoverable even when user has only one entity.
        <div className="space-y-6">
            <SummaryHeader
                eyebrow="ผู้ขอรับรอง"
                title="นิติบุคคลและวิสาหกิจชุมชนของคุณ"
                description="จัดการนิติบุคคลและวิสาหกิจชุมชนที่คุณเป็นสมาชิก ระบบจะให้เลือกผู้ยื่นคำขอตอนเริ่มสร้างใบสมัคร"
                {...(!isLoading
                    ? {
                          metrics: [
                              { label: 'ทั้งหมด', value: entities.length.toLocaleString('th-TH') },
                              ...(invitations.length > 0
                                  ? [{ label: 'คำเชิญรอตอบรับ', value: invitations.length.toLocaleString('th-TH') }]
                                  : []),
                          ],
                      }
                    : {})}
                actions={
                    <Link
                        href="/health/workspaces/new"
                        className="inline-flex items-center gap-2 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-leaf-800"
                    >
                        <Plus className="h-4 w-4" />
                        สร้างนิติบุคคลหรือวิสาหกิจชุมชนใหม่
                    </Link>
                }
            />

            {/* Wave D — pending invitations. Hidden when none. */}
            {!invitationsLoading && invitations.length > 0 && (
                <section className="mb-6 rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                        <Mail className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                        คำเชิญที่รอการตอบรับ ({invitations.length})
                    </h2>
                    <ul className="space-y-2">
                        {invitations.map((inv) => {
                            const busy = actingOn === inv.entityId;
                            return (
                                <li key={inv.entityId} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-card p-3 dark:border-amber-800">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-800/40 dark:text-amber-300">
                                        <TypeIcon type={inv.type} className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-foreground">
                                            {inv.displayName}
                                            <span className={cn('ml-2 rounded-md px-2 py-0.5 text-[11px] font-semibold', ROLE_BADGE[inv.role])}>
                                                {ROLE_LABEL_TH[inv.role]}
                                            </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {TYPE_LABEL_TH[inv.type]}
                                            {inv.invitedBy?.displayName && (
                                                <> · เชิญโดย <strong className="text-foreground">{inv.invitedBy.displayName}</strong></>
                                            )}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => accept(inv)}
                                        disabled={busy}
                                        className="inline-flex items-center gap-1 rounded-lg bg-leaf-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-leaf-800 disabled:opacity-50"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                        รับคำเชิญ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => decline(inv)}
                                        disabled={busy}
                                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-900/20"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                        ปฏิเสธ
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {flash && (
                        <div className={cn(
                            'mt-3 flex items-start gap-2 rounded-lg p-3 text-sm',
                            flash.ok
                                ? 'border border-leaf-300 bg-leaf-soft text-leaf-onSoft dark:border-leaf-800 dark:bg-primary-900/20 dark:text-primary-300'
                                : 'border border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                        )}>
                            {flash.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                            <span>{flash.msg}</span>
                        </div>
                    )}
                </section>
            )}

            {isLoading && (
                <div className="rounded-xl border border-zinc-200 bg-card p-8 text-center text-sm text-muted-foreground dark:border-zinc-700">
                    กำลังโหลด…
                </div>
            )}

            {!isLoading && entities.length === 0 && (
                <div className="rounded-xl border border-zinc-200 bg-card p-8 text-center dark:border-zinc-700">
                    <p className="text-sm text-muted-foreground">ยังไม่มีนิติบุคคลหรือวิสาหกิจชุมชน</p>
                    <Link
                        href="/health/workspaces/new"
                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-leaf-700 hover:underline dark:text-primary-300"
                    >
                        เริ่มต้นโดยสร้างนิติบุคคลหรือวิสาหกิจชุมชนแรก
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            )}

            {!isLoading && entities.length > 0 && (
                <ul className="space-y-3">
                    {entities.map((e) => {
                        return (
                            <li
                                key={e.id}
                                className="rounded-xl border border-zinc-200 bg-card p-4 transition-shadow hover:shadow-sm dark:border-zinc-700"
                            >
                                <div className="flex items-start gap-4">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                        <TypeIcon type={e.type} className="h-6 w-6" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-base font-semibold text-foreground">
                                                {e.isPersonal ? 'ตัวคุณเอง (บุคคลธรรมดา)' : e.displayName}
                                            </h3>
                                            <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', ROLE_BADGE[e.role])}>
                                                {ROLE_LABEL_TH[e.role]}
                                            </span>
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {TYPE_LABEL_TH[e.type]}
                                            
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onOpen(e)}
                                        className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/40"
                                    >
                                        เปิด
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Wave E.3-C follow-up: replacement for window.confirm() on decline. */}
            <ConfirmDialog
                open={pendingDecline !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDecline(null);
                }}
                onConfirm={() => {
                    if (pendingDecline) performDecline(pendingDecline);
                }}
                title="ปฏิเสธคำเชิญ?"
                description={`ปฏิเสธคำเชิญเข้าร่วม "${pendingDecline?.displayName ?? ''}"?`}
                confirmLabel="ปฏิเสธคำเชิญ"
                variant="destructive"
            />
        </div>
    );
}
