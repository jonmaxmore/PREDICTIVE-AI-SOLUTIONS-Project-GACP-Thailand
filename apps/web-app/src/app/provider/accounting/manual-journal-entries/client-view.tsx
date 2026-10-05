'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowLeft,
    IconNotebook,
    IconPlus,
    IconRefresh,
} from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import {
    DataTable,
    PageToolbar,
    StatusBadge,
    type DataColumn,
} from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { canViewAccounting, canWriteAccounting } from '@/lib/constants/canonical-roles';
import { formatTHB, formatThaiDate } from '@/lib/services/accounting-service';
import {
    ManualJournalEntryService,
    type ManualJournalEntryDraft,
    type ManualJournalEntryStatus,
} from '@/lib/services/finance-orphans-service';
import { toast } from 'sonner';
import { CreateDraftModal } from './create-draft-modal';
import { DraftDetailModal } from './draft-detail-modal';

/**
 * Manual Journal Entry — client view. R1-C, 2026-05-17.
 *
 * Role gating:
 *   - read (canViewAccounting): both finance roles see the same drafts
 *     (operator 2026-09-11); other roles get the rose forbidden callout.
 *   - create (canWriteAccounting = backend CREATE_ROLES): finance_officer_platform
 *     + system_admin_dtam. The DTAM finance role reads only — the create button
 *     is not rendered for it (operator 2026-09-27 "กรมฯ ดูอย่างเดียว").
 *
 * Capabilities:
 *   - Lists drafts via ManualJournalEntryService.listDrafts(...)
 *   - Status filter chips: ALL / DRAFT / APPROVED / POSTED / REJECTED
 *   - "สร้างร่างใหม่" opens CreateDraftModal (write roles only)
 *   - Row click opens DraftDetailModal (ADMIN can approve/post/reject)
 *   - Refetches on any successful mutation
 */

type StatusFilter = 'ALL' | ManualJournalEntryStatus;

const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
    { id: 'ALL', label: 'ทั้งหมด' },
    { id: 'DRAFT', label: 'ร่าง' },
    { id: 'APPROVED', label: 'อนุมัติแล้ว' },
    { id: 'POSTED', label: 'ลงบัญชีแล้ว' },
    { id: 'REJECTED', label: 'ถูกปฏิเสธ' },
];

function toNum(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

export default function ClientView() {
    const { user, isLoading: authLoading } = useAuth();
    const canRead = canViewAccounting(user?.role);
    const canCreate = canWriteAccounting(user?.role);

    const [drafts, setDrafts] = useState<ManualJournalEntryDraft[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [createOpen, setCreateOpen] = useState<boolean>(false);
    const [activeDraft, setActiveDraft] = useState<ManualJournalEntryDraft | null>(null);

    // R5-D: mountedRef sentinel guards refresh-button + modal-callback paths
    // that the R3-A useEffect-local `cancelled` flag could not reach.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Hook order must be stable across renders — keep callbacks/effects
    // declared BEFORE any early-return role gate below.
    const fetchDrafts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await ManualJournalEntryService.listDrafts({
                status: statusFilter,
            });
            if (!mountedRef.current) return;
            setDrafts(rows);
        } catch (err) {
            if (!mountedRef.current) return;
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดรายการ Manual Journal Entry ได้ กรุณาลองอีกครั้ง',
            );
            setDrafts([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        // Only fire data fetch when the user is allowed to read.
        if (!canRead) return;
        // R3-A: cancelled-flag guard avoids "setState on unmounted component"
        // when the user navigates away mid-fetch (R1 review M-2).
        let cancelled = false;
        void (async () => {
            setLoading(true);
            setError(null);
            try {
                const rows = await ManualJournalEntryService.listDrafts({
                    status: statusFilter,
                });
                if (cancelled) return;
                setDrafts(rows);
            } catch (err) {
                if (cancelled) return;
                setError(
                    err instanceof Error
                        ? err.message
                        : 'ไม่สามารถโหลดรายการ Manual Journal Entry ได้ กรุณาลองอีกครั้ง',
                );
                setDrafts([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canRead, statusFilter]);

    const columns: DataColumn<ManualJournalEntryDraft>[] = useMemo(
        () => [
            {
                key: 'draftNumber',
                header: 'เลขที่ร่าง',
                render: (row) => (
                    <span className="font-mono text-xs font-semibold text-foreground">
                        {row.draftNumber}
                    </span>
                ),
            },
            {
                key: 'description',
                header: 'คำอธิบาย',
                render: (row) => (
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                            {row.description}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{row.reason}</p>
                    </div>
                ),
            },
            {
                key: 'postingDate',
                header: 'วันที่บันทึก',
                type: 'date',
                render: (row) => (
                    <span className="text-sm text-foreground">
                        {formatThaiDate(row.postingDate)}
                    </span>
                ),
                mobileHidden: true,
            },
            {
                key: 'totalDebit',
                header: 'เดบิต (THB)',
                type: 'money',
                render: (row) => formatTHB(toNum(row.totalDebit), false),
            },
            {
                key: 'totalCredit',
                header: 'เครดิต (THB)',
                type: 'money',
                render: (row) => formatTHB(toNum(row.totalCredit), false),
                mobileHidden: true,
            },
            {
                key: 'status',
                header: 'สถานะ',
                type: 'status',
                render: (row) => <StatusBadge status={row.status} />,
            },
            {
                key: 'createdBy',
                header: 'ผู้สร้าง',
                render: (row) => (
                    <span className="font-mono text-xs text-muted-foreground">
                        {row.createdBy ? row.createdBy.slice(0, 8) : '-'}
                    </span>
                ),
                mobileHidden: true,
            },
        ],
        [],
    );

    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 callout at legitimately authorized finance staff.
    if (authLoading) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <p
                        role="status"
                        aria-live="polite"
                        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
                    >
                        กำลังตรวจสอบสิทธิ์การเข้าถึง...
                    </p>
                </div>
            </ProviderLayout>
        );
    }

    // Read gate — both finance roles see the same drafts.
    if (!canRead) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <div className="rounded-lg border border-rose-300 bg-rose-50 p-8 text-center">
                        <h2 className="text-xl font-bold text-rose-900">ไม่มีสิทธิ์เข้าถึง</h2>
                        <p className="mt-3 text-sm text-rose-800">
                            หน้านี้สำหรับเจ้าหน้าที่การเงินเท่านั้น
                        </p>
                    </div>
                </div>
            </ProviderLayout>
        );
    }

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6">
                <PageToolbar
                    eyebrow="บัญชี · ใบสำคัญทั่วไป"
                    title="ใบสำคัญทั่วไป (Manual Journal Entry)"
                    subtitle="บันทึกรายการที่ไม่ผ่านการชำระอัตโนมัติ ค่าธรรมเนียมธนาคาร, FX gain/loss,
                        การแก้ไขปรับปรุง ตามมาตรฐาน TFRS for NPAEs ch.2 (segregation of duties)"
                    actions={[
                        ...(canCreate
                            ? [{
                                key: 'create',
                                label: 'สร้างร่างใหม่',
                                description: 'เริ่มร่าง Manual Journal Entry ใหม่',
                                icon: <IconPlus size={16} />,
                                onClick: () => setCreateOpen(true),
                                variant: 'primary' as const,
                            }]
                            : []),
                        {
                            key: 'refresh',
                            label: 'รีเฟรชข้อมูล',
                            description: 'โหลดรายการล่าสุด',
                            icon: <IconRefresh size={16} />,
                            onClick: fetchDrafts,
                            variant: 'outline',
                            disabled: loading,
                        },
                        {
                            key: 'back',
                            label: 'กลับไปหน้าบัญชี',
                            href: '/provider/accounting',
                            icon: <IconArrowLeft size={16} />,
                            variant: 'ghost',
                        },
                    ]}
                />

                {/* Workflow context banner */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-foreground">
                        <span className="font-bold text-foreground">การแยกหน้าที่ (Segregation of Duties)</span>{' '}
                         ผู้สร้างร่าง (DRAFT) ไม่สามารถอนุมัติร่างของตนเองได้
                        การอนุมัติ / ลงบัญชี / ปฏิเสธ เป็นสิทธิ์เฉพาะ ADMIN เท่านั้น
                        เป็นไปตาม TFRS for NPAEs ch.2 internal-control guidance
                        และ ป.รัษฎากร ม.86/4 / ม.87/3
                    </p>
                </div>

                {/* Status filter chips */}
                <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
                    role="tablist"
                    aria-label="กรองตามสถานะ"
                >
                    <span className="mr-2 text-xs font-semibold text-muted-foreground">
                        สถานะ:
                    </span>
                    {STATUS_FILTERS.map((f) => {
                        const active = statusFilter === f.id;
                        return (
                            <button
                                key={f.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setStatusFilter(f.id)}
                                className={[
                                    'inline-flex h-8 items-center rounded-md border px-3 text-xs transition-colors',
                                    active
                                        ? 'border-primary/40 bg-muted font-semibold text-foreground'
                                        : 'border-border bg-card text-muted-foreground hover:bg-muted',
                                ].join(' ')}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>

                {/* Error banner */}
                {error ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                        <p className="font-semibold">{error}</p>
                        <button
                            type="button"
                            onClick={fetchDrafts}
                            className="mt-2 inline-flex h-8 items-center rounded-lg border border-rose-300 bg-card px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                            ลองอีกครั้ง
                        </button>
                    </div>
                ) : null}

                {/* Data table */}
                <DataTable
                    columns={columns}
                    rows={drafts}
                    getRowKey={(row) => row.id}
                    onRowClick={(row) => setActiveDraft(row)}
                    loading={loading}
                    emptyTitle="ยังไม่มีร่าง Manual Journal Entry"
                    emptyDescription={
                        canCreate
                            ? 'คลิก “สร้างร่างใหม่” เพื่อเริ่มต้นบันทึกรายการแรก'
                            : 'รอเจ้าหน้าที่การเงินสร้างร่างก่อน'
                    }
                    emptyIcon={<IconNotebook size={36} />}
                />
            </div>

            {/* Create modal — write roles only */}
            {canCreate ? (<CreateDraftModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={() => {
                    // X4-FIX-C / M-2 — consistent success toast across mutate flows.
                    toast.success('สร้างร่างรายการบัญชีเรียบร้อยแล้ว');
                    void fetchDrafts();
                }}
            />) : null}

            {/* Detail / action modal */}
            <DraftDetailModal
                draft={activeDraft}
                onClose={() => setActiveDraft(null)}
                onRefresh={fetchDrafts}
            />
        </ProviderLayout>
    );
}
