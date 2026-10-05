"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ProviderLayout from '../../../../components/provider-layout';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/api-client';
import { providerApiPaths } from '@/lib/services/provider-api';
import { getRoleLabelTH } from '@/lib/role-utils';
import {
    type CatalogEntry,
    type CellState,
    type GrantEffect,
    CELL_OPTIONS,
    cellStateFor,
    groupCatalog,
} from './permission-matrix-config';

interface Grant {
    permission: string;
    effect: GrantEffect | string;
}

interface PermissionPayload {
    userId: string;
    role: string;
    rolePermissions: string[];
    grants: Grant[];
    effective: string[];
    catalog: CatalogEntry[];
}

// apiClient baseUrl='' auto-prefixes /api → strip the /api the path helper adds.
const apiPath = (full: string) => full.replace(/^\/api\//, '');

interface Props {
    userId: string;
}

// tone → design-token cell classes for the ACTIVE segment of the 3-state
// control. Semantic tokens only (gacp/no-raw-color): grant = success,
// revoke = destructive, inherit = neutral surface.
const ACTIVE_SEGMENT_CLASSES: Record<CellState, string> = {
    inherit: 'bg-muted text-foreground',
    GRANT: 'bg-success text-white',
    REVOKE: 'bg-destructive text-white',
};

export default function UserPermissionsClient({ userId }: Props) {
    const [payload, setPayload] = useState<PermissionPayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);

    // Reason-capture dialog state. A cell change stages the pending mutation
    // here; the operator supplies a reason before it is committed (PUT/DELETE).
    const [pending, setPending] = useState<{ permission: string; label: string; next: CellState } | null>(null);
    const [reason, setReason] = useState('');

    const fetchPermissions = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const res = await apiClient.get<PermissionPayload>(apiPath(providerApiPaths.userPermissions(userId)));
            if (res.success && res.data) {
                setPayload(res.data);
            } else {
                setLoadError(res.error || 'โหลดสิทธิ์ไม่สำเร็จ');
            }
        } catch {
            setLoadError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    useEffect(() => { fetchPermissions(); }, [fetchPermissions]);

    const roleBaseline = useMemo(() => new Set(payload?.rolePermissions ?? []), [payload]);
    const effectiveSet = useMemo(() => new Set(payload?.effective ?? []), [payload]);
    const grants = payload?.grants ?? [];
    const groups = useMemo(() => (payload ? groupCatalog(payload.catalog) : []), [payload]);

    function openCellChange(permission: string, label: string, next: CellState, current: CellState) {
        if (next === current) return;
        // DELETE (revert to inherit) needs no reason; PUT (grant/revoke) does.
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
            const path = apiPath(providerApiPaths.userPermission(userId, permission));
            const res = next === 'inherit'
                ? await apiClient.delete<PermissionPayload>(path)
                : await apiClient.put<PermissionPayload>(path, { effect: next, reason: reasonText });
            if (!res.success || !res.data) {
                toast.error(res.error || 'อัปเดตสิทธิ์ไม่สำเร็จ');
                return;
            }
            // Optimistic re-render straight from the fresh payload the write returns.
            setPayload(res.data);
            const verb = next === 'inherit' ? 'คืนค่าเป็นสืบทอด' : next === 'GRANT' ? 'ให้สิทธิ์' : 'เพิกถอน';
            toast.success(`${verb} “${label}” เรียบร้อย`);
        } catch {
            toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        } finally {
            setBusyKey(null);
            setPending(null);
        }
    }

    const roleLabel = payload ? getRoleLabelTH(payload.role) : '';

    return (
        <ProviderLayout title="สิทธิ์รายบุคคล" subtitle="ปรับสิทธิ์เฉพาะบุคคลทับบนสิทธิ์พื้นฐานของบทบาท (GRANT / REVOKE)">
            <div className="mb-4">
                <Button asChild size="sm" variant="subtle">
                    <Link href="/provider/management">
                        <ArrowLeft size={14} className="mr-1" /> กลับไปจัดการพนักงาน
                    </Link>
                </Button>
            </div>

            {/* Fiori object-header band — flat, structured, token-only (NOT the
                friendly HEALTH gradient hero). */}
            <div className="mb-5 rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <ShieldCheck className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-sm font-semibold text-foreground">เมทริกซ์สิทธิ์รายบุคคล</h2>
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">User ID: {userId}</p>
                        </div>
                    </div>
                    {payload && (
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-xs text-muted-foreground">บทบาท (baseline)</span>
                            <span className="inline-flex items-center rounded-md bg-info px-2.5 py-1 text-xs font-semibold text-white">
                                {roleLabel || payload.role}
                            </span>
                        </div>
                    )}
                </div>
                <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                    “สืบทอด” = ใช้สิทธิ์ตามบทบาท · “ให้สิทธิ์” = เพิ่มสิทธิ์นอกเหนือบทบาท · “เพิกถอน” = ตัดสิทธิ์ที่บทบาทมี.
                    การเปลี่ยนแปลงมีผลกับคำขอถัดไปทันที (ไม่ต้องเข้าสู่ระบบใหม่).
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20"><Spinner /></div>
            ) : loadError ? (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
                    <p className="text-sm text-destructive">{loadError}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={fetchPermissions}>ลองอีกครั้ง</Button>
                </div>
            ) : payload ? (
                <div className="space-y-5" data-testid="permission-matrix">
                    {groups.map((group) => (
                        <section
                            key={group.id}
                            data-group={group.id}
                            className="overflow-hidden rounded-lg border border-border bg-card"
                        >
                            <header className="border-b border-border bg-muted/40 px-4 py-2.5">
                                <h3 className="text-sm font-medium text-foreground">
                                    {group.titleTH}
                                </h3>
                            </header>
                            <div className="divide-y divide-border">
                                {group.entries.map((entry) => {
                                    // The permission STRING is the catalog key (e.g. 'report.export').
                                    const permission = entry.key;
                                    const current = cellStateFor(permission, grants);
                                    const inRole = roleBaseline.has(permission);
                                    const isEffective = effectiveSet.has(permission);
                                    const rowBusy = busyKey === permission;
                                    return (
                                        <div
                                            key={entry.key}
                                            data-permission={entry.key}
                                            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-sm font-medium text-foreground">{entry.label}</p>
                                                    {/* effective indicator */}
                                                    <span
                                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${isEffective ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                                                        title={isEffective ? 'มีสิทธิ์ (effective)' : 'ไม่มีสิทธิ์'}
                                                    >
                                                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${isEffective ? 'bg-success' : 'bg-muted-foreground'}`} />
                                                        {isEffective ? 'มีสิทธิ์' : 'ไม่มีสิทธิ์'}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                                    {entry.key}
                                                    {inRole ? ' · สืบทอด = มีสิทธิ์' : ' · สืบทอด = ไม่มีสิทธิ์'}
                                                </p>
                                            </div>
                                            {/* 3-state segmented control */}
                                            <div
                                                role="group"
                                                aria-label={`สิทธิ์ ${entry.label}`}
                                                className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
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
                                                            className={`min-h-[36px] px-3 text-xs font-medium transition-colors ${active ? ACTIVE_SEGMENT_CLASSES[opt.state] : 'bg-card text-muted-foreground hover:bg-muted'} ${rowBusy ? 'opacity-60' : ''}`}
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
            ) : null}

            {/* Reason-capture dialog (GRANT / REVOKE require a reason ≥ 5 chars). */}
            {pending && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="ระบุเหตุผลในการเปลี่ยนสิทธิ์"
                >
                    <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
                        <h4 className="text-sm font-semibold text-foreground">
                            {pending.next === 'GRANT' ? 'ให้สิทธิ์เพิ่มเติม' : 'เพิกถอนสิทธิ์'}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                            “{pending.label}” โปรดระบุเหตุผล (อย่างน้อย 5 ตัวอักษร) เพื่อบันทึกใน audit log
                        </p>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            aria-label="เหตุผล"
                            className="mt-3 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-info"
                            placeholder="เช่น มอบหมายให้ดูแลงานส่งออกชั่วคราวตามคำสั่ง #1234"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPending(null)}>ยกเลิก</Button>
                            <Button
                                size="sm"
                                disabled={reason.trim().length < 5 || busyKey === pending.permission}
                                onClick={() => commit(pending.permission, pending.label, pending.next, reason.trim())}
                            >
                                ยืนยัน
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </ProviderLayout>
    );
}
