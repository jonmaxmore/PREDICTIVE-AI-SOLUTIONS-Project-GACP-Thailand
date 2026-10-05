'use client';

/**
 * MemberPermissionMatrix — Farm-worker Wave C chunk 2.
 *
 * OWNER-only expander section under a member row on
 * /health/workspaces/[slug]/members. Fetches the Wave-B admin view
 * (GET /entities/:id/members/:userId/permissions), renders the 15
 * farm-operation codes grouped with Thai labels from the API catalog, and
 * mutates via PUT (GRANT/REVOKE + optional reason) / DELETE (revert to
 * inherit). Both writes return the fresh GET payload, so the matrix
 * re-renders from the response without a second round-trip.
 *
 * Interaction pattern mirrors the provider matrix (3-state segmented
 * control, REVOKE wins, effective chip = net result); VISUALS follow the
 * HEALTH friendly ui_kit (leaf tones, rounded cards) like the rest of
 * the workspaces pages — NOT the provider Fiori shell.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { notifications } from '@/lib/notifications';
import {
    type CatalogEntry,
    type CellState,
    type GrantEffect,
    CELL_OPTIONS,
    cellStateFor,
    effectiveChipFor,
    groupCatalog,
    inheritedHas,
    validateReason,
} from './member-permission-matrix-logic';

interface Grant {
    permission: string;
    effect: GrantEffect | string;
}

interface MemberPermissionPayload {
    entityId: string;
    userId: string;
    membershipId: string;
    role: string;
    rolePermissions: string[];
    legacyPermissions: string[];
    grants: Grant[];
    effective: string[];
    catalog: CatalogEntry[];
}

interface Props {
    entityId: string;
    memberUserId: string;
    memberDisplayName: string;
}

// Active-segment tones — HEALTH ui_kit palette (leaf-green family for
// grant, rose for revoke, neutral zinc for inherit).
const ACTIVE_SEGMENT_CLASSES: Record<CellState, string> = {
    inherit: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100',
    GRANT: 'bg-leaf-700 text-white',
    REVOKE: 'bg-rose-600 text-white',
};

export default function MemberPermissionMatrix({ entityId, memberUserId, memberDisplayName }: Props) {
    const [payload, setPayload] = useState<MemberPermissionPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);

    // A GRANT/REVOKE cell change stages the pending mutation here so the
    // OWNER can attach an OPTIONAL reason (5-500 when provided) before it
    // commits. Revert-to-inherit (DELETE) commits immediately — no reason.
    const [pending, setPending] = useState<{ permission: string; label: string; next: CellState } | null>(null);
    const [reason, setReason] = useState('');

    const basePath = `/entities/${entityId}/members/${memberUserId}/permissions`;

    const fetchPermissions = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await apiClient.get<MemberPermissionPayload>(basePath);
            if (res.success && res.data) {
                setPayload(res.data);
            } else {
                setLoadError(res.error || 'โหลดสิทธิ์ไม่สำเร็จ');
            }
        } catch {
            setLoadError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setLoading(false);
        }
    }, [basePath]);

    useEffect(() => { fetchPermissions(); }, [fetchPermissions]);

    const grants = payload?.grants ?? [];
    const groups = useMemo(() => (payload ? groupCatalog(payload.catalog) : []), [payload]);
    const reasonCheck = validateReason(reason);

    function openCellChange(permission: string, label: string, next: CellState, current: CellState) {
        if (next === current || busyKey) return;
        if (next === 'inherit') {
            void commit(permission, label, next, '');
            return;
        }
        setPending({ permission, label, next });
        setReason('');
    }

    async function commit(permission: string, label: string, next: CellState, reasonText: string) {
        setBusyKey(permission);
        try {
            const trimmed = reasonText.trim();
            const res = next === 'inherit'
                ? await apiClient.delete<MemberPermissionPayload>(`${basePath}/${permission}`)
                : await apiClient.put<MemberPermissionPayload>(basePath, {
                    permission,
                    effect: next,
                    ...(trimmed ? { reason: trimmed } : {}),
                });
            if (!res.success || !res.data) {
                notifications.show({ color: 'red', title: 'อัปเดตสิทธิ์ไม่สำเร็จ', message: res.error || 'กรุณาลองใหม่' });
                return;
            }
            // Optimistic re-render straight from the fresh payload the write returns.
            setPayload(res.data);
            const verb = next === 'inherit' ? 'คืนค่าเป็นสืบทอดจาก role' : next === 'GRANT' ? 'ให้สิทธิ์' : 'เพิกถอนสิทธิ์';
            notifications.show({ color: 'green', title: `${verb} “${label}” เรียบร้อย`, message: memberDisplayName });
        } catch {
            notifications.show({ color: 'red', title: 'เกิดข้อผิดพลาดในการเชื่อมต่อ', message: 'กรุณาลองใหม่' });
        } finally {
            setBusyKey(null);
            setPending(null);
        }
    }

    return (
        <div className="mt-3 rounded-xl border border-leaf-soft bg-leaf-soft/40 p-3 dark:border-primary-900/40 dark:bg-primary-900/10">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-leaf-800 dark:text-primary-300">
                <ShieldCheck className="h-4 w-4" />
                สิทธิ์การทำงานฟาร์มของ {memberDisplayName}
            </div>
            {/* F3 — enforcement copy must not overstate: the engine's
                LEGACY_OWNER fast-path keeps FULL authority for an ACTIVE
                member on workspace farms THEY created (per-permission
                REVOKE doesn't bind there; removing the member from the
                workspace does). Disclose the exception. */}
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                “สืบทอดจาก role” = ตามบทบาท · “ให้สิทธิ์” = เพิ่มนอกเหนือบทบาท · “เพิกถอน” = ตัดสิทธิ์ (เพิกถอนชนะสิทธิ์ที่ให้/สืบทอด).
                มีผลกับคำขอถัดไปทันที (ยกเว้นฟาร์มที่สมาชิกคนนั้นเป็นผู้สร้างเอง ระบบยังให้สิทธิ์ผู้สร้างจนกว่าจะถอนสมาชิกออกจาก workspace)
            </p>

            {loading && <div className="py-4 text-sm text-muted-foreground">กำลังโหลดสิทธิ์…</div>}

            {!loading && loadError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{loadError}</span>
                    <button
                        type="button"
                        onClick={fetchPermissions}
                        className="ml-auto shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-900/30"
                    >
                        ลองอีกครั้ง
                    </button>
                </div>
            )}

            {!loading && payload && (
                <div className="space-y-3" data-testid="member-permission-matrix">
                    {groups.map((group) => (
                        <section
                            key={group.id}
                            data-group={group.id}
                            className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700"
                        >
                            <header className="border-b border-zinc-100 bg-zinc-50/70 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                                <h4 className="text-[11px] font-bold text-muted-foreground">
                                    {group.titleTH}
                                </h4>
                            </header>
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {group.entries.map((entry) => {
                                    const permission = entry.key;
                                    const current = cellStateFor(permission, grants);
                                    const inherited = inheritedHas(permission, payload.rolePermissions, payload.legacyPermissions);
                                    const chip = effectiveChipFor(permission, payload.effective);
                                    const rowBusy = busyKey === permission;
                                    return (
                                        <div
                                            key={entry.key}
                                            data-permission={entry.key}
                                            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-sm font-medium text-foreground">{entry.label}</p>
                                                    {/* effective chip = the NET result the BE computed */}
                                                    <span
                                                        className={cn(
                                                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                                                            chip.has
                                                                ? 'bg-leaf-soft text-leaf-onSoft dark:bg-primary-900/30 dark:text-primary-300'
                                                                : 'bg-zinc-100 text-muted-foreground dark:bg-zinc-800',
                                                        )}
                                                        title={chip.has ? 'มีสิทธิ์ (ผลสุทธิ)' : 'ไม่มีสิทธิ์ (ผลสุทธิ)'}
                                                    >
                                                        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', chip.has ? 'bg-leaf-600' : 'bg-zinc-400')} />
                                                        {chip.labelTH}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                                    {entry.key}
                                                    {inherited ? ' · สืบทอด = มีสิทธิ์' : ' · สืบทอด = ไม่มีสิทธิ์'}
                                                </p>
                                            </div>
                                            {/* 3-state segmented control */}
                                            <div
                                                role="group"
                                                aria-label={`สิทธิ์ ${entry.label} ของ ${memberDisplayName}`}
                                                className="inline-flex shrink-0 overflow-hidden rounded-full border border-zinc-200 dark:border-zinc-700"
                                            >
                                                {CELL_OPTIONS.map((opt) => {
                                                    const active = opt.state === current;
                                                    return (
                                                        <button
                                                            key={opt.state}
                                                            type="button"
                                                            disabled={rowBusy}
                                                            aria-pressed={active}
                                                            onClick={() => openCellChange(permission, entry.label, opt.state, current)}
                                                            className={cn(
                                                                'min-h-[36px] px-3 text-xs font-medium transition-colors',
                                                                active ? ACTIVE_SEGMENT_CLASSES[opt.state] : 'bg-card text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800',
                                                                rowBusy && 'opacity-60',
                                                            )}
                                                        >
                                                            {opt.labelTH}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            {/* Optional-reason confirm (GRANT / REVOKE). Reason may be blank;
                when provided it must satisfy the BE bounds (5-500). */}
            {pending && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="ยืนยันการเปลี่ยนสิทธิ์"
                >
                    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-card p-5 shadow-lg dark:border-zinc-700">
                        <h4 className="text-sm font-bold text-foreground">
                            {pending.next === 'GRANT' ? 'ให้สิทธิ์เพิ่มเติม' : 'เพิกถอนสิทธิ์'}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                            “{pending.label}” {memberDisplayName} · ระบุเหตุผลได้ (ไม่บังคับ, {`5-500`} ตัวอักษรเมื่อกรอก) เพื่อบันทึกใน audit log
                        </p>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            aria-label="เหตุผล (ไม่บังคับ)"
                            className="mt-3 w-full rounded-xl border border-zinc-200 bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-leaf-600 dark:border-zinc-700"
                            placeholder="เช่น ทดลองงานผ่านแล้ว ให้บันทึกเก็บเกี่ยวได้"
                        />
                        {!reasonCheck.ok && (
                            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{reasonCheck.messageTH}</p>
                        )}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-foreground hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="button"
                                disabled={!reasonCheck.ok || busyKey === pending.permission}
                                onClick={() => commit(pending.permission, pending.label, pending.next, reason)}
                                className={cn(
                                    'rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-50',
                                    pending.next === 'GRANT' ? 'bg-leaf-700 hover:bg-leaf-800' : 'bg-rose-600 hover:bg-rose-700',
                                )}
                            >
                                ยืนยัน
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
