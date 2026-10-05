'use client';

/**
 * /health/workspaces/[slug]/members — list members + invite + revoke.
 *
 * Wave C PR-4. Switches the active entity on mount so the api-client
 * scopes the rest of the page to this workspace, then queries the
 * /api/entities/:slug surface for entity + member list.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, UserPlus, X, AlertCircle, Check, Crown, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { maskHealthIdCard } from '@/utils/validation';
import { ConfirmDialog, SummaryHeader } from '@/components/feature';
import { notifications } from '@/lib/notifications';
import MemberPermissionMatrix from './member-permission-matrix';
import { isPersonalEntity, ROLE_CAPABILITY_SUMMARY_TH, eyebrowFor, descriptionFor } from './personal-workspace-copy';

interface EntityResponse {
    id: string;
    type: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';
    slug: string | null;
    displayName: string;
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'VIEWER';
    permissions: string[];
}

interface MemberRow {
    membershipId: string;
    userId: string;
    healthId: string | null;
    displayName: string;
    email: string | null;
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'VIEWER';
    permissions: string[];
    status: 'ACTIVE' | 'PENDING' | 'REVOKED';
    invitedAt: string | null;
    acceptedAt: string | null;
}

const ROLE_LABEL: Record<MemberRow['role'], string> = {
    OWNER: 'เจ้าของ', ADMIN: 'ผู้ดูแล', MANAGER: 'ผู้จัดการ', VIEWER: 'ผู้ดู',
};
const STATUS_LABEL: Record<MemberRow['status'], string> = {
    ACTIVE: 'ใช้งาน', PENDING: 'รอยืนยัน', REVOKED: 'ถอนสิทธิ์แล้ว',
};

export default function WorkspaceMembersPage() {
    const params = useParams();
    const slug = String((params as Record<string, string>).slug || '');

    const [entity, setEntity] = useState<EntityResponse | null>(null);
    const [members, setMembers] = useState<MemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Wave E.3-C follow-up: ConfirmDialog state for revoke + transfer-ownership.
    const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
    const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; displayName: string } | null>(null);
    // Farm-worker Wave C chunk 2 — which member row has the OWNER-only
    // permission matrix expanded (one at a time keeps the list scannable).
    const [permissionsOpenFor, setPermissionsOpenFor] = useState<string | null>(null);

    // Invite form
    // W8 personal-workspace-team (item 3): default is phone, not national
    // ID — the 2026-08-17 org-model ruling is "invite by phone/short-code,
    // NOT national-ID/name/long-numeric". National ID (healthId) is
    // REMOVED as an invite channel entirely (PDPA: this form must never
    // solicit someone's national ID) — email stays as the one secondary
    // channel the backend also supports (entity-service.js:1868-1906
    // findInviteeByIdentifier: healthId/email/phone are all live, but only
    // phone + email belong in this UI per the ruling).
    const [identifierType, setIdentifierType] = useState<'phone' | 'email'>('phone');
    const [identifierValue, setIdentifierValue] = useState('');
    const [newRole, setNewRole] = useState<'ADMIN' | 'MANAGER' | 'VIEWER'>('MANAGER');
    const [inviteSubmitting, setInviteSubmitting] = useState(false);
    const [inviteFlash, setInviteFlash] = useState<{ ok: boolean; msg: string } | null>(null);

    const refresh = async () => {
        try {
            setError(null);
            const ent = await apiClient.get<EntityResponse>(`/entities/${slug}`);
            if (!ent.success || !ent.data) {
                setError(ent.error || 'ไม่พบนิติบุคคลหรือวิสาหกิจชุมชนนี้');
                setLoading(false);
                return;
            }
            setEntity(ent.data);
            const mem = await apiClient.get<MemberRow[]>(`/entities/${ent.data.id}/members`);
            if (mem.success && mem.data) setMembers(mem.data);
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refresh(); }, [slug]);

    const canInvite = entity && (entity.role === 'OWNER' || entity.role === 'ADMIN');
    const canRevoke = canInvite;

    const submitInvite = async () => {
        if (!entity) return;
        setInviteFlash(null);
        if (!identifierValue.trim()) {
            setInviteFlash({ ok: false, msg: 'กรอกข้อมูลผู้เชิญก่อน' });
            return;
        }
        setInviteSubmitting(true);
        try {
            const res = await apiClient.post(`/entities/${entity.id}/members`, {
                inviteIdentifier: { type: identifierType, value: identifierValue.trim() },
                role: newRole,
            });
            if (!res.success) {
                setInviteFlash({ ok: false, msg: res.error || 'เชิญไม่สำเร็จ' });
                return;
            }
            setInviteFlash({ ok: true, msg: 'ส่งคำเชิญแล้ว รอผู้ใช้ยอมรับ' });
            setIdentifierValue('');
            await refresh();
        } finally {
            setInviteSubmitting(false);
        }
    };

    // Wave E.3-C follow-up: revoke now opens a state-driven dialog;
    // performRevoke executes after confirmation. alert() → notifications.
    const revoke = (memberUserId: string) => {
        if (!entity) return;
        setPendingRevoke(memberUserId);
    };

    const performRevoke = async (memberUserId: string) => {
        if (!entity) return;
        const res = await apiClient.delete(`/entities/${entity.id}/members/${memberUserId}`);
        setPendingRevoke(null);
        if (!res.success) {
            notifications.show({ color: 'red', title: 'ถอนสิทธิ์ไม่สำเร็จ', message: res.error || 'กรุณาลองใหม่' });
            return;
        }
        await refresh();
    };

    const transferOwnership = (memberUserId: string, memberDisplayName: string) => {
        if (!entity) return;
        setPendingTransfer({ userId: memberUserId, displayName: memberDisplayName });
    };

    const performTransferOwnership = async (memberUserId: string) => {
        if (!entity) return;
        const res = await apiClient.post(`/entities/${entity.id}/transfer-ownership`, {
            toUserId: memberUserId,
        });
        setPendingTransfer(null);
        if (!res.success) {
            notifications.show({ color: 'red', title: 'โอน OWNER ไม่สำเร็จ', message: res.error || 'กรุณาลองใหม่' });
            return;
        }
        await refresh();
    };

    // W8 personal-workspace-team (item 2) — entity.type === INDIVIDUAL means
    // this is a person's own farm (the operator's case: grows cannabis as a
    // side business, farm in their own name), not a registered organisation.
    // Swaps the page's copy register (personal-workspace-copy.ts).
    const personal = isPersonalEntity(entity?.type ?? null);

    const canTransfer = entity?.role === 'OWNER';
    // Farm-worker Wave C chunk 2 — per-member permission matrix is
    // OWNER-only (owner decision, stricter than ADMIN); the per-row
    // self-guard (never on the OWNER's own row) mirrors the BE's
    // SELF_PERMISSION_CHANGE_FORBIDDEN + the admin GET is 404 on
    // non-ACTIVE targets, so only ACTIVE rows get the expander.
    const canManagePermissions = entity?.role === 'OWNER';

    return (
        // Wave E.2-B (batch 9): SummaryHeader replaces inline h1+p
        // (entity name + role line). Member count is surfaced as
        // a metric. Outer max-w-4xl preserved — member-management
        // is intentionally narrower than dashboard width.
        <div className="w-full space-y-6">
            <Link href="/health/workspaces" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                นิติบุคคลและวิสาหกิจชุมชนทั้งหมด
            </Link>

            {loading && <div className="text-sm text-muted-foreground">กำลังโหลด…</div>}

            {!loading && error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && entity && (
                <>
                    <SummaryHeader
                        eyebrow={eyebrowFor(personal)}
                        title={entity.displayName}
                        description={descriptionFor(personal, ROLE_LABEL[entity.role])}
                        metrics={[
                            { label: 'สมาชิกทั้งหมด', value: members.length.toLocaleString('th-TH') },
                            { label: 'ใช้งาน', value: members.filter(m => m.status === 'ACTIVE').length.toLocaleString('th-TH') },
                            { label: 'รอยืนยัน', value: members.filter(m => m.status === 'PENDING').length.toLocaleString('th-TH') },
                        ]}
                    />

                    {/* Invite form */}
                    {canInvite && (
                        <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
                            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                                <UserPlus className="h-4 w-4" />
                                เชิญสมาชิกใหม่
                            </h2>
                            <div className="grid gap-3 md:grid-cols-[160px_1fr_140px_120px]">
                                <select
                                    value={identifierType}
                                    onChange={(e) => setIdentifierType(e.target.value as 'phone' | 'email')}
                                    aria-label="ประเภทตัวระบุผู้ถูกเชิญ"
                                    className="rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm dark:border-zinc-700"
                                >
                                    <option value="phone">เบอร์โทร</option>
                                    <option value="email">อีเมล</option>
                                </select>
                                <input
                                    type="text"
                                    value={identifierValue}
                                    onChange={(e) => setIdentifierValue(e.target.value)}
                                    placeholder={identifierType === 'email' ? 'someone@example.com' : '0812345678'}
                                    aria-label="ค่าตัวระบุผู้ถูกเชิญ (เบอร์โทร / อีเมล)"
                                    className="w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 font-mono text-sm dark:border-zinc-700"
                                />
                                <select
                                    value={newRole}
                                    onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'MANAGER' | 'VIEWER')}
                                    aria-label="บทบาทของสมาชิกที่เชิญ"
                                    className="rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm dark:border-zinc-700"
                                >
                                    <option value="VIEWER">ผู้ดู (Viewer)</option>
                                    <option value="MANAGER">ผู้จัดการ (Manager)</option>
                                    {entity.role === 'OWNER' && <option value="system_admin_dtam">ผู้ดูแล (Admin)</option>}
                                </select>
                                <button
                                    type="button"
                                    onClick={submitInvite}
                                    disabled={inviteSubmitting}
                                    className="rounded-lg bg-leaf-700 px-3 py-2 text-sm font-semibold text-white hover:bg-leaf-800 disabled:opacity-50"
                                >
                                    {inviteSubmitting ? 'กำลังเชิญ…' : 'เชิญ'}
                                </button>
                            </div>
                            {/* W8 personal-workspace-team (item 2) — one-line explanation of
                                what the SELECTED role can/cannot do, in operator terms, derived
                                from entity-service.js's real default capability sets
                                (personal-workspace-copy.ts). */}
                            <p className="mt-2 text-xs text-muted-foreground">
                                {ROLE_CAPABILITY_SUMMARY_TH[newRole]}
                            </p>
                            {inviteFlash && (
                                <div className={cn(
                                    'mt-3 flex items-start gap-2 rounded-lg p-3 text-sm',
                                    inviteFlash.ok
                                        ? 'border border-leaf-300 bg-leaf-soft text-leaf-onSoft dark:border-leaf-800 dark:bg-primary-900/20 dark:text-primary-300'
                                        : 'border border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                                )}>
                                    {inviteFlash.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                                    <span>{inviteFlash.msg}</span>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Members list */}
                    <section>
                        <h2 className="mb-3 text-sm font-bold text-foreground">สมาชิก ({members.length})</h2>
                        <ul className="space-y-2">
                            {members.map((m) => (
                                <li key={m.membershipId} className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                            {m.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold text-foreground">{m.displayName}</span>
                                                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                                    {ROLE_LABEL[m.role]}
                                                </span>
                                                <span className="rounded-md bg-zinc-50 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-zinc-900/40">
                                                    {STATUS_LABEL[m.status]}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {/* BUG C (PDPA): mask a co-member's national ID — an OWNER
                                                    does not need the full 13 digits. Display-layer only;
                                                    at-rest crypto is untouched. */}
                                                {m.healthId && <>เลขบัตร: <span className="font-mono">{maskHealthIdCard(m.healthId)}</span> · </>}
                                                {m.email}
                                            </p>
                                        </div>
                                        {/* Per-member permission matrix — Wave C chunk 2.
                                            OWNER-only + never on the OWNER row (self-guard
                                            mirrors BE) + ACTIVE targets only. */}
                                        {canManagePermissions && m.role !== 'OWNER' && m.status === 'ACTIVE' && (
                                            <button
                                                type="button"
                                                onClick={() => setPermissionsOpenFor(permissionsOpenFor === m.userId ? null : m.userId)}
                                                aria-expanded={permissionsOpenFor === m.userId}
                                                className={cn(
                                                    'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors',
                                                    permissionsOpenFor === m.userId
                                                        ? 'border-leaf-700 bg-leaf-700 text-white hover:bg-leaf-800'
                                                        : 'border-leaf-300 text-leaf-onSoft hover:bg-leaf-soft dark:border-leaf-800 dark:text-primary-300 dark:hover:bg-primary-900/20',
                                                )}
                                                aria-label={`จัดการสิทธิ์ของ ${m.displayName}`}
                                            >
                                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                                จัดการสิทธิ์
                                            </button>
                                        )}
                                        {/* Transfer ownership — OWNER-only, target
                                            must be active non-OWNER. Wave D. */}
                                        {canTransfer && m.role !== 'OWNER' && m.status === 'ACTIVE' && (
                                            <button
                                                type="button"
                                                onClick={() => transferOwnership(m.userId, m.displayName)}
                                                className="shrink-0 rounded-lg border border-leaf-300 px-2 py-1 text-xs font-medium text-leaf-onSoft transition-colors hover:bg-leaf-soft dark:border-leaf-800 dark:text-primary-300 dark:hover:bg-primary-900/20"
                                                aria-label="โอน OWNER"
                                                title="โอนความเป็น OWNER มายังสมาชิกคนนี้"
                                            >
                                                <Crown className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        {canRevoke && m.role !== 'OWNER' && m.status === 'ACTIVE' && (
                                            <button
                                                type="button"
                                                onClick={() => revoke(m.userId)}
                                                className="shrink-0 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-900/20"
                                                aria-label="ถอนสิทธิ์"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    {canManagePermissions && m.role !== 'OWNER' && m.status === 'ACTIVE'
                                        && permissionsOpenFor === m.userId && entity && (
                                        <MemberPermissionMatrix
                                            entityId={entity.id}
                                            memberUserId={m.userId}
                                            memberDisplayName={m.displayName}
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            )}

            {/* Wave E.3-C follow-up: confirm dialogs for revoke + transfer-ownership. */}
            <ConfirmDialog
                open={pendingRevoke !== null}
                onOpenChange={(open) => { if (!open) setPendingRevoke(null); }}
                onConfirm={() => { if (pendingRevoke) performRevoke(pendingRevoke); }}
                title="ถอนสิทธิ์สมาชิก?"
                description="สมาชิกคนนี้จะถูกถอดออกจากนิติบุคคลหรือวิสาหกิจชุมชนนี้ทันที"
                confirmLabel="ถอนสิทธิ์"
                variant="destructive"
            />
            <ConfirmDialog
                open={pendingTransfer !== null}
                onOpenChange={(open) => { if (!open) setPendingTransfer(null); }}
                onConfirm={() => { if (pendingTransfer) performTransferOwnership(pendingTransfer.userId); }}
                title="โอน OWNER ?"
                description={
                    pendingTransfer
                        ? `โอน OWNER ไปยัง "${pendingTransfer.displayName}" บัญชีของคุณจะถูกลดเหลือ ADMIN ทันที (ทำในธุรกรรมเดียวเพื่อไม่ให้ขาด OWNER)`
                        : ''
                }
                confirmLabel="โอน OWNER"
                variant="destructive"
            />
        </div>
    );
}
