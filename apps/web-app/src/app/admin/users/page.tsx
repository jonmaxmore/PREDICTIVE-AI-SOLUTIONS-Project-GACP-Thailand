'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import Link from 'next/link';
import {
    Search,
    RefreshCcw,
    UserX,
    UserCheck,
    ShieldCheck,
    ExternalLink,
    Users as UsersIcon,
    MoreHorizontal,
} from 'lucide-react';

import {
    AdminPageShell,
    UserDisableModal,
    ChangeRoleModal,
} from '@/components/admin';
import {
    AdminB28Service,
    type AdminUserListParams,
    type AdminUserRow,
} from '@/lib/services/admin-service-b28';
import {
    DataTable,
    FilterBar,
    FilterField,
    SummaryCard,
    StatusBadge,
    type DataColumn,
} from '@/components/finance';
import { ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX } from '@/lib/constants/admin-role-options';

/**
 * /admin/users — Iter 28 B28-A admin tooling UI.
 *
 * Replaces the legacy stub that just redirected to /provider/management.
 * Surfaces the new server-side list + disable + role-change endpoints
 * behind a DataTable + modals. The /provider/management surface is
 * still linked as "เครื่องมือผู้ใช้ขั้นสูง" because it carries the
 * full create/edit form (G6 work). Most day-to-day ops happen here.
 *
 * X5-FIX-A / H-6 (V5-A finish): the role-filter dropdown previously
 * hardcoded a 7-entry list missing both Tier 16 split roles
 * (ACCOUNT_DTAM + ACCOUNT_PLATFORM). It now derives from
 * `ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX` (the V5-A canonical source) so
 * that adding/removing a role lands in exactly one place.
 */

const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
    ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX.map((option) => ({
        value: option.value,
        label: option.label,
    }));

const STATUS_OPTIONS: ReadonlyArray<{ value: AdminUserListParams['status']; label: string }> = [
    { value: 'ALL', label: 'ทุกสถานะ' },
    { value: 'ACTIVE', label: 'ใช้งานอยู่' },
    { value: 'DISABLED', label: 'ถูกระงับ' },
    { value: 'LOCKED', label: 'ถูกล็อก' },
];

function formatLastLogin(value?: string | null): string {
    if (!value) return 'ยังไม่เคยเข้าใช้';
    try {
        const d = new Date(value);
        return d.toLocaleString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return value;
    }
}

export default function AdminUsersPage() {
    const [rows, setRows] = React.useState<AdminUserRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const [query, setQuery] = React.useState('');
    const [role, setRole] = React.useState<string>('ALL');
    const [status, setStatus] = React.useState<AdminUserListParams['status']>('ALL');

    const [modalUser, setModalUser] = React.useState<{
        user: AdminUserRow;
        action: 'disable' | 'change-role';
    } | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await AdminB28Service.listUsers({
                ...(query ? { q: query } : {}),
                ...(role !== 'ALL' ? { role } : {}),
                ...(status !== undefined ? { status } : {}),
                limit: 100,
            });
            if (res.success) {
                // C4-01 (audit 2026-06-10): apiClient collapses the {success,data}
                // envelope, so res.data is the inner object { users, pagination }.
                // The array is under `.users` (NOT `.data`) — reading `.data` left
                // the table permanently empty. Tolerate a bare array defensively.
                const payload = res.data as
                    | AdminUserRow[]
                    | { users?: AdminUserRow[] }
                    | undefined;
                if (Array.isArray(payload)) {
                    setRows(payload);
                } else {
                    setRows(payload?.users ?? []);
                }
            } else {
                setError(res.error || 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้');
                setRows([]);
            }
        } catch {
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [query, role, status]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const counters = React.useMemo(() => {
        const active = rows.filter((r) => r.isActive && !r.isLocked).length;
        const disabled = rows.filter((r) => !r.isActive).length;
        const locked = rows.filter((r) => r.isLocked).length;
        return { total: rows.length, active, disabled, locked };
    }, [rows]);

    const columns = React.useMemo<ReadonlyArray<DataColumn<AdminUserRow>>>(
        () => [
            {
                key: 'name',
                header: 'ผู้ใช้',
                type: 'text',
                render: (r) => (
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                            {r.firstName} {r.lastName}
                        </p>
                        <p className="truncate text-xs text-slate-500">{r.email}</p>
                    </div>
                ),
            },
            {
                key: 'username',
                header: 'ชื่อผู้ใช้ (username)',
                type: 'text',
                mobileHidden: true,
                render: (r) => (
                    <span className="font-mono text-xs text-slate-600">{r.username}</span>
                ),
            },
            {
                key: 'role',
                header: 'บทบาท',
                type: 'text',
                render: (r) => (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {r.role}
                    </span>
                ),
            },
            {
                key: 'status',
                header: 'สถานะ',
                type: 'status',
                render: (r) => {
                    if (r.isLocked) {
                        return <StatusBadge status="HELD" label="ถูกล็อก" />;
                    }
                    if (!r.isActive) {
                        return <StatusBadge status="CANCELLED" label="ถูกระงับ" />;
                    }
                    return <StatusBadge status="ACTIVE" label="ใช้งานอยู่" />;
                },
            },
            {
                key: 'lastLogin',
                header: 'เข้าใช้ล่าสุด',
                type: 'date',
                mobileHidden: true,
                render: (r) => (
                    <span className="text-xs text-slate-600">
                        {formatLastLogin(r.lastLoginAt)}
                    </span>
                ),
            },
            {
                key: 'actions',
                header: 'การจัดการ',
                type: 'custom',
                align: 'right',
                render: (r) => (
                    <details className="relative inline-block text-left">
                        <summary
                            className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 marker:hidden hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
                            aria-label={`การจัดการสำหรับ ${r.email}`}
                        >
                            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                            จัดการ
                        </summary>
                        <div
                            className="absolute right-0 z-10 mt-1 flex w-48 flex-col rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
                            role="menu"
                        >
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => setModalUser({ user: r, action: 'disable' })}
                                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                                {r.isActive ? (
                                    <>
                                        <UserX
                                            className="h-3.5 w-3.5"
                                            aria-hidden="true"
                                        />
                                        ระงับการใช้งาน
                                    </>
                                ) : (
                                    <>
                                        <UserCheck
                                            className="h-3.5 w-3.5"
                                            aria-hidden="true"
                                        />
                                        เปิดการใช้งาน
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                    setModalUser({ user: r, action: 'change-role' })
                                }
                                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                                <UsersIcon
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                />
                                เปลี่ยนบทบาท
                            </button>
                            {/* ไม่มี "รีเซ็ต MFA": มติ operator 2026-09-26 "ถอดทั้งสองประตู" ไม่มีใครล้าง 2FA ของบัญชีอื่น
                                (การกู้ 2FA ไปที่หมอพร้อม) · เจ้าของบัญชีปิด 2FA ของตัวเองได้ด้วยรหัสจากแอปของตัวเอง */}
                        </div>
                    </details>
                ),
            },
        ],
        [],
    );

    return (
        <AdminPageShell
            eyebrow="ผู้ดูแลระบบ · จัดการผู้ใช้"
            title="จัดการผู้ใช้งานระบบ"
            subtitle="ค้นหา ระงับ และปรับบทบาทผู้ใช้ ทุกการกระทำถูกบันทึกในบันทึกการใช้งาน"
            actions={[
                {
                    label: 'รีเฟรช',
                    variant: 'outline',
                    onClick: () => void load(),
                    icon: <RefreshCcw className="h-4 w-4" aria-hidden="true" />,
                },
                {
                    label: 'เครื่องมือผู้ใช้ขั้นสูง',
                    variant: 'outline',
                    href: '/provider/management',
                    icon: <ExternalLink className="h-4 w-4" aria-hidden="true" />,
                    description: 'เพิ่ม/แก้ไข/ลบ ใน /provider/management',
                },
                {
                    label: 'ดู Audit Log',
                    variant: 'outline',
                    href: '/admin/audit-log',
                    icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
                },
            ]}
        >
            <SummaryCard
                org="GACP ฐานข้อมูลผู้ใช้งาน"
                contextPill={loading ? 'กำลังโหลด…' : 'อัปเดตเรียลไทม์'}
                totals={[
                    {
                        label: 'ผู้ใช้ทั้งหมด',
                        value: counters.total.toLocaleString('th-TH'),
                        emphasis: 'primary',
                    },
                    {
                        label: 'ใช้งานอยู่',
                        value: counters.active.toLocaleString('th-TH'),
                    },
                    {
                        label: 'ถูกระงับ',
                        value: counters.disabled.toLocaleString('th-TH'),
                    },
                    {
                        label: 'ถูกล็อก',
                        value: counters.locked.toLocaleString('th-TH'),
                    },
                ]}
            />

            <FilterBar
                chips={[
                    role !== 'ALL'
                        ? { key: 'role', label: `บทบาท: ${role}`, onRemove: () => setRole('ALL') }
                        : null,
                    status !== 'ALL'
                        ? {
                              key: 'status',
                              label: `สถานะ: ${
                                  STATUS_OPTIONS.find((s) => s.value === status)?.label || ''
                              }`,
                              onRemove: () => setStatus('ALL'),
                          }
                        : null,
                ].filter(Boolean) as Array<{
                    key: string;
                    label: string;
                    onRemove: () => void;
                }>}
                onApply={() => void load()}
            >
                <FilterField label="ค้นหา (ชื่อ / อีเมล / username)" htmlFor="admin-users-q">
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                            aria-hidden="true"
                        />
                        <input
                            id="admin-users-q"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="พิมพ์เพื่อค้นหา..."
                            className="h-10 w-64 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                    </div>
                </FilterField>
                <FilterField label="บทบาท" htmlFor="admin-users-role">
                    <select
                        id="admin-users-role"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="h-10 w-44 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    >
                        {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="สถานะบัญชี" htmlFor="admin-users-status">
                    <select
                        id="admin-users-status"
                        value={status}
                        onChange={(e) =>
                            setStatus(e.target.value as AdminUserListParams['status'])
                        }
                        className="h-10 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    >
                        {STATUS_OPTIONS.map((opt) => (
                            <option key={String(opt.value)} value={String(opt.value)}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
            </FilterBar>

            {error ? (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                    {error}{' '}
                    <Link href="/admin/dashboard" className="underline">
                        กลับไปหน้าหลัก
                    </Link>
                </div>
            ) : null}

            <DataTable<AdminUserRow>
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.id}
                loading={loading}
                emptyTitle="ไม่พบผู้ใช้งาน"
                emptyDescription="ลองเปลี่ยนคำค้นหา หรือเลือกบทบาท/สถานะอื่น"
            />

            {modalUser && modalUser.action === 'disable' ? (
                <UserDisableModal
                    userId={modalUser.user.id}
                    userLabel={`${modalUser.user.firstName} ${modalUser.user.lastName} (${modalUser.user.email})`}
                    isActive={modalUser.user.isActive}
                    open
                    onClose={() => setModalUser(null)}
                    onSuccess={() => void load()}
                />
            ) : null}
            {modalUser && modalUser.action === 'change-role' ? (
                <ChangeRoleModal
                    userId={modalUser.user.id}
                    userLabel={`${modalUser.user.firstName} ${modalUser.user.lastName} (${modalUser.user.email})`}
                    currentRole={modalUser.user.role}
                    open
                    onClose={() => setModalUser(null)}
                    onSuccess={() => void load()}
                />
            ) : null}
        </AdminPageShell>
    );
}
