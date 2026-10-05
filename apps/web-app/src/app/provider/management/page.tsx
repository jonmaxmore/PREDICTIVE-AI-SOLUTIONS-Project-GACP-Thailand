'use client';


import { Input as TextInput, Input as PasswordInput } from '@/components/ui/primitives/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/primitives/button';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { ActionIcon } from '@/components/ui/icon-buttons';
import { Avatar } from '@/components/ui/data-components';
import { Modal } from '@/components/ui/overlays';
import { Table } from '@/components/ui/primitives/table';
import { Badge } from '@/components/ui/primitives/badge';
import { ConfirmDialog } from '@/components/feature/confirm-dialog';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ProviderLayout from '../components/provider-layout';
import { getRoleLabelTH, getRoleColor } from '@/lib/role-utils';
import { normalizeRole, CANONICAL_ROLES, type CanonicalRole } from '@/lib/constants/canonical-roles';
import { ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX, ADMIN_ROLE_OPTIONS_FOR_NEW_USER } from '@/lib/constants/admin-role-options';
import { apiClient } from '@/lib/api/api-client';
import { buildCreateOfficerPayload, buildEditOfficerPayload } from './create-officer-payload';

import { IconSearch, IconPlus, IconEdit, IconTrash, IconCheck, IconUsers, IconLock, IconLockOpen, IconShieldCheck, IconShieldLock } from '@tabler/icons-react';
import { toast } from 'sonner';

/**
 * Wave B Phase 54 (G6) — short helper to render a user's last-login
 * timestamp in Thai locale. Falls back to "ยังไม่เคยล็อกอิน" so we
 * don't show a blank cell for accounts that haven't logged in yet.
 */
function formatLastLogin(iso: string | null | undefined): string {
    if (!iso) return 'ยังไม่เคยล็อกอิน';
    try {
        const d = new Date(iso);
        return d.toLocaleString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

interface providerMember {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: string;
    // Wave B Phase 54 (G6) — user lifecycle fields surfaced from
    // the backend in Phase 53 (#132). Optional because older API
    // responses might lack them.
    lastLoginAt?: string | null;
    loginAttempts?: number;
    isLocked?: boolean;
    lockedUntil?: string | null;
    twoFactorEnabled?: boolean;
}

interface _PROVIDERApiResponse<T> {
    success?: boolean;
    data?: T;
    error?: string;
}

/**
 * X5-FIX-C / H-2 (PM-1) — Pending-action discriminated union.
 *
 * Replaces the `window.confirm()` flows (delete / unlock) with a single
 * ConfirmDialog rendered against this state. Each branch carries the
 * target member so the dialog can render a meaningful description AND the
 * action handler still has the row data to call the right endpoint. (The
 * reset-token action was removed 2026-09-17 — operator: there is no account
 * recovery; the disable-2FA action 2026-09-26 — operator: "ถอดทั้งสองประตู",
 * no one clears another account's 2FA.)
 *
 * Native `window.confirm` was:
 *   - Browser-locale-locked (Thai dialog copy + English browser confirm
 *     button = jarring mixed-locale UX).
 *   - Not screen-reader friendly (no `role=dialog` semantics, no focus
 *     trap, no aria-modal contract).
 *   - Unstyleable / inconsistent across OS chrome.
 *   - Synchronous and blocked the React event loop, interfering with
 *     state flush on rapid clicks.
 *
 * The replacement ConfirmDialog (built on Radix Dialog) gives us focus
 * management, escape-to-close, ARIA roles, and locale-stable copy.
 */
type PendingProviderAction =
    | { kind: 'delete'; member: providerMember }
    | { kind: 'unlock'; member: providerMember };

// Role labels & colors imported from @/lib/role-utils (getRoleLabelTH, getRoleColor)

export default function PROVIDERManagementPage() {
    const router = useRouter();
    const [provider, setPROVIDER] = useState<providerMember[]>([]);
    const [loading, setLoading] = useState(true);
    // L3: distinguish a failed directory fetch from a genuinely empty directory.
    // The file's own comment documents a prior prod incident where a silent 404
    // left the table "dark"; without this an admin reads a fetch failure as
    // "no staff" and may conclude the directory was wiped.
    const [dirError, setDirError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('ALL');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingPROVIDER, setEditingPROVIDER] = useState<providerMember | null>(null);
    // X5-FIX-C / TSC reconciliation — X5-FIX-A's canonical role import
    // narrowed the inferred type to the single literal
    // `'document_reviewer'`. Widening to `CanonicalRole` lets the create
    // path keep `'reviewer'` alias (it canonicalises on submit) AND
    // honours the Tier 16 split-role values (`account_dtam`,
    // `account_platform`) without further per-call casts.
    const [formData, setFormData] = useState<{
        username: string;
        providerId: string;
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        role: CanonicalRole | 'reviewer';
    }>({
        username: '',
        providerId: '',
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: CANONICAL_ROLES.DOCUMENT_REVIEWER
    });
    const [submitting, setSubmitting] = useState(false);

    // X5-FIX-C / H-2 — hoisted above pendingDialogCopy so the dialog
    // description IIFE can call it without hitting the TDZ.
    const getFullName = (m: providerMember) => `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.username;

    useEffect(() => {
        apiClient.get('/auth/provider/me').then(res => {
            if (!res.success) { router.push("/auth/provider/login"); return; }
            fetchPROVIDER();
        }).catch(() => router.push("/auth/provider/login"));
    }, [router]);

    const fetchPROVIDER = async () => {
        setLoading(true);
        setDirError(null);
        try {
            // Wave B Phase 57 (hotfix) — provider directory routes are
            // mounted at /api/provider/directory (see apps/backend/
            // routes/api/index.js line 89). The bare /api/provider
            // namespace is reserved for the sub-router (reviewer/
            // scheduler/admin/etc.), so calling '/provider' silently
            // 404'd and the table stayed empty. All Phase 53-56 G6
            // work was effectively dark in production until this fix.
            const res = await apiClient.get<providerMember[]>('/provider/directory');
            if (res.success && res.data) {
                setPROVIDER(res.data);
            } else {
                setPROVIDER([]);
                setDirError(res.error || 'ไม่สามารถโหลดรายชื่อพนักงานได้');
            }
        } catch (e: unknown) {
            console.error('Failed to fetch provider:', e);
            setPROVIDER([]);
            setDirError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        }
        finally { setLoading(false); }
    };

    const handleOpenCreate = () => {
        setEditingPROVIDER(null);
        setFormData({ username: '', providerId: '', email: '', password: '', firstName: '', lastName: '', role: 'reviewer' });
        setShowModal(true);
    };

    const handleOpenEdit = (member: providerMember) => {
        setEditingPROVIDER(member);
        // X5-FIX-A / H-6: normalize the legacy stored role
        // (REVIEWER_AUDITOR / ACCOUNTANT / etc.) into the canonical form
        // the select-options now use, so the modal opens with the
        // current role pre-selected instead of falling back to the
        // first dropdown entry.
        const canonical = normalizeRole(member.role) || CANONICAL_ROLES.DOCUMENT_REVIEWER;
        setFormData({
            username: member.username,
            providerId: '',
            email: member.email,
            password: '',
            firstName: member.firstName,
            lastName: member.lastName,
            role: canonical
        });
        setShowModal(true);
    };

    const handleSubmit = async () => {
        // Create mode: the backend contract is providerId (13-digit) + email +
        // password (min 10) + names — NOT username, which the create route
        // ignores. The dialog shipped without providerId and every create
        // 400'd (2026-08-14, AC7 walk). buildCreateOfficerPayload is the
        // tested single source of that contract.
        let createPayload: ReturnType<typeof buildCreateOfficerPayload> | null = null;
        if (!editingPROVIDER) {
            createPayload = buildCreateOfficerPayload(formData);
            if (!createPayload.ok) {
                toast.warning(createPayload.messageTh);
                return;
            }
        } else if (!formData.username || !formData.email) {
            toast.warning('กรุณากรอกข้อมูลให้ครบถ้วน');
            return;
        }

        setSubmitting(true);
        try {
            // See fetchPROVIDER for routing note — same /directory mount.
            const url = editingPROVIDER ? `/provider/directory/${editingPROVIDER.id}` : '/provider/directory';
            const res = editingPROVIDER
                ? await apiClient.put<providerMember>(url, buildEditOfficerPayload(formData))
                : await apiClient.post<providerMember>(url, (createPayload as { ok: true; payload: object }).payload);

            if (res.success) {
                toast.success(editingPROVIDER ? 'แก้ไขข้อมูลสำเร็จ' : 'เพิ่มพนักงานสำเร็จ');
                setShowModal(false);
                fetchPROVIDER();
            } else {
                toast.error('เกิดข้อผิดพลาด: ' + (res.error || 'ไม่ทราบสาเหตุ'));
            }
        } catch (_e) {
            toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        } finally {
            setSubmitting(false);
        }
    };

    // X5-FIX-C / H-2 (PM-1) — pending-action state replaces 4 calls to
    // window.confirm(). The previous implementation called the native
    // browser dialog inside each handler, then performed the API call
    // only if the user clicked OK. Now each row click sets the pending
    // action; the ConfirmDialog at the bottom of the page reads this
    // state and, on confirm, dispatches to performPendingAction().
    const [pendingAction, setPendingAction] = useState<PendingProviderAction | null>(null);

    const handleDelete = (member: providerMember) => {
        setPendingAction({ kind: 'delete', member });
    };

    // Wave B Phase 56 (G6) — admin user lifecycle action handlers.
    // Backend endpoints (Phase 55) live on the provider directory
    // mount at /api/provider/directory/:id/unlock. The Phase 57 hotfix
    // corrected these paths after Phase 56 shipped pointing at
    // /provider/:id (404).
    //
    // No reset-token action: there is no account recovery (operator
    // 2026-09-17). The button used to mint a one-time token that no page
    // could redeem; the backend route is gone as well.
    // No disable-2FA action: no one clears another account's 2FA (operator
    // 2026-09-26, "ถอดทั้งสองประตู"); 2FA recovery belongs to หมอพร้อม. The
    // owner turns their own 2FA off at /provider/profile/security.
    const handleUnlock = (member: providerMember) => {
        setPendingAction({ kind: 'unlock', member });
    };

    /**
     * X5-FIX-C / H-2 — central dispatcher that runs after the
     * ConfirmDialog confirm-button is clicked. Each branch mirrors the
     * pre-X5 inline confirm() handler's body 1:1, just lifted out so
     * the dialog can wait for the user before firing the API call.
     */
    const performPendingAction = async () => {
        if (!pendingAction) return;
        const { kind, member } = pendingAction;
        try {
            if (kind === 'delete') {
                const res = await apiClient.delete<providerMember>(`/provider/directory/${member.id}`);
                if (res.success) {
                    toast.success('ลบพนักงานสำเร็จ');
                    fetchPROVIDER();
                } else {
                    toast.error('เกิดข้อผิดพลาด: ' + (res.error || 'ไม่ทราบสาเหตุ'));
                }
            } else if (kind === 'unlock') {
                const res = await apiClient.post<{ id: string; isLocked: boolean }>(`/provider/directory/${member.id}/unlock`, {});
                if (res.success) {
                    toast.success(`ปลดล็อก ${getFullName(member)} สำเร็จ`);
                    fetchPROVIDER();
                } else {
                    toast.error('ปลดล็อกไม่สำเร็จ: ' + (res.error || 'ไม่ทราบสาเหตุ'));
                }
            }
        } catch (_e) {
            toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        } finally {
            setPendingAction(null);
        }
    };

    /**
     * X5-FIX-C / H-2 — derive dialog copy from the pending action.
     * Returns a tuple of (title, description, confirmLabel, variant)
     * so the single ConfirmDialog instance can render the right copy
     * for each action without a separate dialog component per action.
     */
    const pendingDialogCopy = (() => {
        if (!pendingAction) {
            return null;
        }
        const name = getFullName(pendingAction.member);
        if (pendingAction.kind === 'delete') {
            return {
                title: 'ยืนยันการลบพนักงาน',
                description: `ลบบัญชีของ ${name}? การกระทำนี้ไม่สามารถย้อนกลับได้`,
                confirmLabel: 'ลบ',
                variant: 'destructive' as const,
            };
        }
        // unlock
        return {
            title: 'ปลดล็อกบัญชี',
            description: `ปลดล็อกบัญชี ${name}? ระบบจะรีเซ็ตจำนวนครั้งที่ล็อกอินผิดและอนุญาตให้เข้าใช้งานได้ทันที`,
            confirmLabel: 'ปลดล็อก',
            variant: 'default' as const,
        };
    })();

    // X5-FIX-A / H-6: filter compares CANONICAL roles so the same selected
    // value (e.g. ACCOUNT_DTAM) matches both legacy DB storage (rare,
    // post-migration) and the new split-role storage. Falls back to raw
    // string equality if either side fails to canonicalise (so unmapped
    // values still filter consistently). Empty searchTerm tolerated.
    const filteredPROVIDER = provider.filter((m) => {
        const matchesQuery = (
            getFullName(m).toLowerCase().includes(searchTerm.toLowerCase())
            || m.email.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (!matchesQuery) return false;
        if (filterRole === 'ALL') return true;
        const memberCanonical = normalizeRole(m.role);
        const filterCanonical = normalizeRole(filterRole);
        if (memberCanonical && filterCanonical) {
            return memberCanonical === filterCanonical;
        }
        return m.role === filterRole;
    });

    const totalPages = Math.max(1, Math.ceil(filteredPROVIDER.length / ITEMS_PER_PAGE));
    const currentPageIndex = Math.max(0, Math.min(currentPage - 1, totalPages - 1));
    const paginatedPROVIDER = filteredPROVIDER.slice(currentPageIndex * ITEMS_PER_PAGE, (currentPageIndex + 1) * ITEMS_PER_PAGE);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterRole]);

    if (loading) {
        return <ProviderLayout title="จัดการพนักงาน"><div className="flex items-center justify-center p-6"><p>กำลังโหลด...</p></div></ProviderLayout>;
    }

    return (
        <ProviderLayout title="จัดการพนักงาน" subtitle="จัดการบัญชีพนักงานในระบบ GACP">
            {/* Filters */}
            <div className="mb-4 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center">
                    <TextInput
                        placeholder="ค้นหาชื่อหรืออีเมล..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.currentTarget.value)}
                        leftSection={<IconSearch size={16} />}
                        style={{ flex: 1 }}
                    />
                    {/* X5-FIX-A / H-6 (V5-A finish): role-filter dropdown
                        was hardcoded with legacy labels (REVIEWER_AUDITOR /
                        ACCOUNTANT) missing the Tier 16 split roles
                        (ACCOUNT_DTAM + ACCOUNT_PLATFORM). It now derives
                        from the canonical `ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX`
                        source so the dropdown automatically picks up new
                        canonical roles. The filter comparison was switched
                        to canonical-normalised so it correctly matches
                        legacy upper-case (REVIEWER_AUDITOR) AND new
                        canonical (DOCUMENT_REVIEWER / ACCOUNT_DTAM /
                        ACCOUNT_PLATFORM) DB storage forms. */}
                    <Select
                        value={filterRole}
                        onChange={(val) => setFilterRole(val || 'ALL')}
                        data={ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX
                            .filter((opt) => !opt.hidden && opt.value !== 'HEALTH')
                            .map((opt) => ({ value: opt.value, label: opt.label }))}
                    />
                    {/* X2-FIX-B / H-8 — drop Mantine `color="teal"`; the
                        Button primitive ignores `color` and already defaults
                        to brand `variant="primary"` (deep forest green). */}
                    <Button leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>เพิ่มพนักงาน</Button>
                </div>
            </div>

            {/* Stats */}
            <SimpleGrid cols={6} spacing="md">
                {[
                    { label: "พนักงานทั้งหมด", value: provider.length, color: "primary" },
                    { label: "ผู้ตรวจสอบ", value: provider.filter(s => s.role === 'document_reviewer').length, color: "blue" },
                    { label: "ผู้จัดตาราง", value: provider.filter(s => s.role === 'dispatcher').length, color: "grape" },
                    { label: "บัญชี", value: provider.filter(s => s.role === 'finance_officer_platform').length, color: "green" },
                    // Wave B Phase 54 (G6) — surface lock + 2FA totals so
                    // admins can spot security drift at a glance.
                    { label: "บัญชีที่ถูกล็อก", value: provider.filter(s => s.isLocked).length, color: "red" },
                    // X2-FIX-B / H-8 — 2FA stat tile re-tinted from Mantine
                    // teal to brand `primary` (the inline stat object isn't
                    // actually consumed for color anywhere; kept for parity
                    // with the rest of the array shape).
                    { label: "เปิดใช้งาน 2FA", value: provider.filter(s => s.twoFactorEnabled).length, color: "primary" },
                ].map((stat, i) => (
                    <div className="rounded-lg border border-border bg-card p-4 text-center" key={i}>
                        <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                    </div>
                ))}
            </SimpleGrid>

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <Table.ScrollContainer>
                    <Table>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>ชื่อ</Table.Th>
                                <Table.Th>อีเมล</Table.Th>
                                <Table.Th>ตำแหน่ง</Table.Th>
                                <Table.Th>สถานะ</Table.Th>
                                <Table.Th>เข้าสู่ระบบล่าสุด</Table.Th>
                                <Table.Th>ความปลอดภัย</Table.Th>
                                <Table.Th className="text-center">จัดการ</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {paginatedPROVIDER.length > 0 ? (
                                paginatedPROVIDER.map(member => (
                                    <Table.Tr key={member.id}>
                                        <Table.Td>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <Avatar color="primary">
                                                    {(member.firstName || member.username || '?').charAt(0)}
                                                </Avatar>
                                                <div>
                                                    <p className="font-medium">{getFullName(member)}</p>
                                                    <p className="text-xs text-muted-foreground">@{member.username}</p>
                                                </div>
                                            </div>
                                        </Table.Td>
                                        <Table.Td>
                                            <p className="text-sm text-muted-foreground">{member.email}</p>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge color={getRoleColor(member.role)}>
                                                {getRoleLabelTH(member.role)}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge tone={member.isActive ? 'primary' : 'neutral'}>
                                                {member.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <p className="text-sm text-muted-foreground">
                                                {formatLastLogin(member.lastLoginAt)}
                                            </p>
                                            {(member.loginAttempts ?? 0) > 0 && (
                                                <p className="text-xs text-warning">
                                                    ล็อกอินผิดพลาด {member.loginAttempts} ครั้ง
                                                </p>
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {member.isLocked ? (
                                                    <Badge color="red">
                                                        <span className="inline-flex items-center gap-1">
                                                            <IconLock size={12} />
                                                            ถูกล็อก
                                                        </span>
                                                    </Badge>
                                                ) : null}
                                                {member.twoFactorEnabled ? (
                                                    <Badge tone="primary">
                                                        <span className="inline-flex items-center gap-1">
                                                            <IconShieldCheck size={12} />
                                                            2FA
                                                        </span>
                                                    </Badge>
                                                ) : null}
                                                {!member.isLocked && !member.twoFactorEnabled && (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </div>
                                        </Table.Td>
                                        <Table.Td className="text-center">
                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                                <ActionIcon

                                                    color="violet"
                                                    aria-label={`Manage groups for ${member.firstName} ${member.lastName}`}
                                                    onClick={() => router.push(`/provider/management/users/${member.id}/groups`)}
                                                >
                                                    <IconUsers size={16} />
                                                </ActionIcon>
                                                {/* feat/backoffice-per-permission-grants — per-user
                                                    permission GRANT/REVOKE matrix (admin). */}
                                                <ActionIcon

                                                    color="grape"
                                                    aria-label={`Manage permissions for ${member.firstName} ${member.lastName}`}
                                                    onClick={() => router.push(`/provider/management/users/${member.id}/permissions`)}
                                                >
                                                    <IconShieldLock size={16} />
                                                </ActionIcon>
                                                <ActionIcon

                                                    color="blue"
                                                    aria-label={`แก้ไขพนักงาน ${member.firstName} ${member.lastName}`}
                                                    onClick={() => handleOpenEdit(member)}
                                                >
                                                    <IconEdit size={16} />
                                                </ActionIcon>
                                                {/* Wave B Phase 56 (G6) — admin lifecycle actions.
                                                    Unlock only renders when the account is locked,
                                                    so the row stays compact for healthy accounts.
                                                    There is no reset-token action (no account
                                                    recovery, operator 2026-09-17) and no disable-2FA
                                                    action (no one clears another account's 2FA,
                                                    operator 2026-09-26). */}
                                                {member.isLocked && (
                                                    <ActionIcon

                                                        color="orange"
                                                        aria-label={`Unlock account for ${member.firstName} ${member.lastName}`}
                                                        onClick={() => handleUnlock(member)}
                                                    >
                                                        <IconLockOpen size={16} />
                                                    </ActionIcon>
                                                )}
                                                <ActionIcon

                                                    color="red"
                                                    aria-label={`ลบพนักงาน ${member.firstName} ${member.lastName}`}
                                                    data-testid={`mgmt-delete-${member.id}`}
                                                    onClick={() => handleDelete(member)}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </div>
                                        </Table.Td>
                                    </Table.Tr>
                                ))
                            ) : (
                                <Table.Tr>
                                    <Table.Td colSpan={7}>
                                        {dirError ? (
                                            <div role="alert" aria-live="polite" className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                                                <p className="text-sm text-destructive">{dirError}</p>
                                                <Button variant="outline" size="sm" className="min-h-[44px]" onClick={fetchPROVIDER}>
                                                    ลองอีกครั้ง
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center p-6"><p className="text-muted-foreground">ไม่พบข้อมูลพนักงาน</p></div>
                                        )}
                                    </Table.Td>
                                </Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row">
                    <p className="text-sm text-muted-foreground">
                        แสดง {(currentPageIndex * ITEMS_PER_PAGE) + 1} ถึง {Math.min((currentPageIndex + 1) * ITEMS_PER_PAGE, filteredPROVIDER.length)} จากทั้งหมด {filteredPROVIDER.length} รายการ
                    </p>
                    <div className="flex items-center gap-2">
                        <Button 
 
                            disabled={currentPage === 1} 
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        >
                            ก่อนหน้า
                        </Button>
                        <div className="flex items-center gap-1.5 px-2">
                            {Array.from({ length: totalPages }).map((_, i) => {
                                const pageNumber = i + 1;
                                // Simple logic to show only relevant pages when there are many
                                if (
                                    totalPages <= 7 ||
                                    pageNumber === 1 ||
                                    pageNumber === totalPages ||
                                    Math.abs(currentPage - pageNumber) <= 1
                                ) {
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => setCurrentPage(pageNumber)}
                                            className={`flex h-8 min-h-[44px] w-8 min-w-[44px] items-center justify-center rounded-md text-sm font-medium transition-colors sm:min-h-0 sm:min-w-0 ${
                                                currentPage === pageNumber
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        >
                                            {pageNumber}
                                        </button>
                                    );
                                }
                                if (
                                    (pageNumber === 2 && currentPage > 3) ||
                                    (pageNumber === totalPages - 1 && currentPage < totalPages - 2)
                                ) {
                                    return <span key={i} className="px-1 text-muted-foreground">...</span>;
                                }
                                return null;
                            })}
                        </div>
                        <Button 
 
                            disabled={currentPage === totalPages} 
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        >
                            ถัดไป
                        </Button>
                    </div>
                </div>
            )}

            {/* Create/Edit Modal */}
            <Modal
                opened={showModal}
                onClose={() => setShowModal(false)}
                title={editingPROVIDER ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
                centered
                size="md"
            >
                <div className="flex flex-col">
                    {editingPROVIDER ? (
                        <TextInput
                            label="ชื่อผู้ใช้ (Username)"
                            placeholder="ชื่อผู้ใช้"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.currentTarget.value })}
                            required
                            disabled
                        />
                    ) : (
                        <TextInput
                            label="เลขบัตรประชาชน (13 หลัก)"
                            placeholder="1234567890123"
                            description="เจ้าหน้าที่ใช้เลขนี้เข้าสู่ระบบคู่กับรหัสผ่าน"
                            value={formData.providerId}
                            onChange={(e) => setFormData({ ...formData, providerId: e.currentTarget.value.replace(/\D/g, '').slice(0, 13) })}
                            required
                            inputMode="numeric"
                        />
                    )}
                    <div className="flex flex-wrap items-center">
                        <TextInput
                            label="ชื่อจริง"
                            placeholder="ชื่อ"
                            value={formData.firstName}
                            onChange={(e) => setFormData({ ...formData, firstName: e.currentTarget.value })}
                        />
                        <TextInput
                            label="นามสกุล"
                            placeholder="นามสกุล"
                            value={formData.lastName}
                            onChange={(e) => setFormData({ ...formData, lastName: e.currentTarget.value })}
                        />
                    </div>
                    <TextInput
                        label="อีเมล"
                        placeholder="email@example.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.currentTarget.value })}
                        required
                    />
                    {/* รหัสผ่านตั้งได้ครั้งเดียวตอนสร้างบัญชี มติ operator 2026-09-26 "ปิด": หน้าแก้ไขตั้งรหัสผ่าน
                        ให้คนอื่นไม่ได้ (backend ตอบ DIRECTORY_PASSWORD_WRITE_FORBIDDEN) เจ้าหน้าที่เปลี่ยนรหัสของตัวเองที่
                        /provider/profile/security โดยใช้รหัสผ่านปัจจุบัน */}
                    {!editingPROVIDER && (
                        <PasswordInput
                            type="password"
                            autoComplete="new-password"
                            label="รหัสผ่าน"
                            placeholder="********"
                            description="อย่างน้อย 10 ตัวอักษร"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.currentTarget.value })}
                            required
                        />
                    )}
                    {/* X5-FIX-A / H-6 (PM-3): role-picker for create/edit
                        now derives from canonical `ADMIN_ROLE_OPTIONS_FOR_NEW_USER`
                        so new provider accounts can be provisioned as
                        ACCOUNT_DTAM or ACCOUNT_PLATFORM directly (Tier 16
                        split). The legacy lower-case values ('reviewer',
                        'finance_officer_platform') were ALSO blocking new-user
                        provisioning into split-finance roles; lower-case
                        canonical names are now used (admin / document_reviewer
                        / auditor / scheduler / account_dtam / account_platform
                        / account), and the backend `createProviderUser`
                        canonicalises before persisting. The legacy
                        ACCOUNT option is excluded for new users — operators
                        must pick the split-finance variant. */}
                    <Select
                        label="ตำแหน่ง"
                        value={formData.role}
                        onChange={val => setFormData({ ...formData, role: ((val || CANONICAL_ROLES.DOCUMENT_REVIEWER) as CanonicalRole) })}
                        data={ADMIN_ROLE_OPTIONS_FOR_NEW_USER
                            .filter((opt) => opt.canonical !== 'health')
                            .map((opt) => ({ value: opt.canonical, label: opt.label }))}
                    />
                    <div className="mt-4 flex flex-wrap items-center">
                        <Button onClick={() => setShowModal(false)}>ยกเลิก</Button>
                        <Button onClick={handleSubmit} loading={submitting} leftSection={<IconCheck size={16} />}>
                            {editingPROVIDER ? 'บันทึก' : 'เพิ่มพนักงาน'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* X5-FIX-C / H-2 (PM-1) — ConfirmDialog replaces the
                window.confirm() flows (delete / unlock).
                A single dialog instance is
                rendered conditionally against `pendingAction` state
                with action-specific copy. The native confirm() popups
                were locale-locked to the browser language, not screen-
                reader friendly, blocked the JS event loop, and could
                not be styled to match the design system. */}
            {pendingDialogCopy ? (
                <ConfirmDialog
                    open={pendingAction !== null}
                    onOpenChange={(open) => {
                        if (!open) setPendingAction(null);
                    }}
                    onConfirm={performPendingAction}
                    title={pendingDialogCopy.title}
                    description={pendingDialogCopy.description}
                    confirmLabel={pendingDialogCopy.confirmLabel}
                    variant={pendingDialogCopy.variant}
                />
            ) : null}
        </ProviderLayout>
    );
}
