'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Award, Ban, Copy, FilePenLine, History, Loader2 } from 'lucide-react';

import {
    PageToolbar,
    SummaryCard,
} from '@/components/finance';
import {
    CertificateStatusBadge,
    StaffIdentityText,
    applicationLabel,
    normalizeCertificateStatus,
    placeLabel,
} from '../certificate-display';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/primitives/textarea';
import { useAuth } from '@/lib/services/auth-provider';
import { CANONICAL_ROLES, normalizeRole } from '@/lib/constants/canonical-roles';
import {
    AdminService,
    CERTIFICATE_REVISION_FIELDS,
    REVISION_REASON_MAX_LENGTH,
    REVOCATION_REASON_MAX_LENGTH,
    certificateActionMessageFor,
    certificateRevisionReasonLabel,
    type CertificateDetail,
    type CertificateRevisionPreview,
} from '@/lib/services/admin-service';

/**
 * /admin/certificates/[id] client view — R7-A.
 *
 * Renders the cross-tenant certificate detail behind an ADMIN-only
 * gate (mirrors the list page at ../client-view.tsx). Fetches from
 * `GET /api/certificates/:id` which routes to either:
 *   • provider-role branch → `certificateService.findById` (no
 *     ownership filter — the route gates by isProviderRole)
 *   • health-user branch  → `getCertificateForUser` (IDOR-safe)
 *
 * Revocation: the "เพิกถอนใบรับรอง" button opens a dialog that takes a
 * required reason (max 500 chars) and calls
 * `AdminService.revokeCertificate` → `POST /api/admin/certificates/:id/revoke`.
 * On success the dialog closes, the row is reloaded through `load()` so
 * the revoked panel below renders from the backend's own columns, and a
 * role="status" line announces it. On failure the dialog stays open and
 * the cause + next action show in a role="alert" line.
 *
 * Revision (ฉบับแก้ไขภายใต้เลขเดิม): the "ออกฉบับแก้ไขจากบันทึกต้นทาง" button
 * (active rows only) opens a dialog that first reads the diff from
 * `GET /api/admin/certificates/:id/revise-location/preview` and shows it as
 * an เดิม / ใหม่ table over CERTIFICATE_REVISION_FIELDS (the plant from the
 * species register first, then the four farm-row location fields —
 * F-G4-58); the admin never types register values, only a reason.
 * Confirm calls `AdminService.reviseCertificateLocation` →
 * `POST /api/admin/certificates/:id/revise-location`; on success the row is
 * reloaded and the hero shows "ฉบับแก้ไขครั้งที่ n · <date>".
 *
 * Status + identities (ledger F-G4-46 / F-G4-47): the header chip and
 * the list page share ONE status mapper (../certificate-display.tsx) over
 * the canonical lowercase vocabulary certificate-service writes; the
 * application shows as its number (linked), officers as display names
 * or a role label + short handle, province as 'ไม่ระบุ' when unset. No
 * raw uuid reaches this screen.
 *
 * Trade-dress (I-010): reuses ONLY @/components/finance and primitives
 * — same convention as the list page; no FlowAccount-style corner
 * triangles or signature palettes.
 */

const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * Mirrors formatThaiDate from ../client-view.tsx (R3-C). Inlined per
 * the orchestrator's "copy, don't import" convention so the admin
 * detail page does not couple to the list page's internals.
 */
function formatThaiDate(dateStr: string | Date | null | undefined): string {
    if (!dateStr) return '-';
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/**
 * Best-effort clipboard copy. Falls back silently if the API is not
 * available (e.g. non-secure context) — the user can still select +
 * copy the certificate number manually.
 */
/**
 * A register value as the diff table prints it: the stored text verbatim
 * (the admin must see exactly what the document says, placeholder
 * included) or '-' when the column is blank.
 */
function registerValue(value: string | null | undefined): string {
    const text = (value || '').trim();
    return text || '-';
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // ignore — fall through to false
    }
    return false;
}

export default function DetailView() {
    const params = useParams();
    const certId = String(params?.id || '');

    const { user, isLoading: authLoading } = useAuth();
    const role = normalizeRole(user?.role);
    const isAdmin = role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;

    const [cert, setCert] = useState<CertificateDetail | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [revokeDialogOpen, setRevokeDialogOpen] = useState<boolean>(false);
    const [revokeReason, setRevokeReason] = useState<string>('');
    const [revokeSubmitting, setRevokeSubmitting] = useState<boolean>(false);
    const [revokeError, setRevokeError] = useState<string | null>(null);
    const [revokeNotice, setRevokeNotice] = useState<string | null>(null);
    const [reviseDialogOpen, setReviseDialogOpen] = useState<boolean>(false);
    const [revisePreview, setRevisePreview] = useState<CertificateRevisionPreview | null>(null);
    const [revisePreviewLoading, setRevisePreviewLoading] = useState<boolean>(false);
    const [reviseReason, setReviseReason] = useState<string>('');
    const [revising, setRevising] = useState<boolean>(false);
    const [reviseError, setReviseError] = useState<string | null>(null);
    const [reviseNotice, setReviseNotice] = useState<string | null>(null);
    // Sequence of preview reads: a response that lands after the dialog
    // was closed or reopened is dropped instead of rendering a stale diff.
    const revisePreviewSeq = useRef<number>(0);

    const load = useCallback(async () => {
        if (!isAdmin || !certId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await AdminService.getCertificate(certId);
            if (!data) {
                setError('ไม่พบใบรับรองนี้ หรือถูกลบจากระบบแล้ว');
                setCert(null);
                return;
            }
            setCert(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'โหลดรายละเอียดใบรับรองไม่สำเร็จ';
            setError(message);
            setCert(null);
        } finally {
            setLoading(false);
        }
    }, [isAdmin, certId]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleCopy = useCallback(async () => {
        if (!cert?.certificateNumber) return;
        const ok = await copyToClipboard(cert.certificateNumber);
        if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        }
    }, [cert?.certificateNumber]);

    const trimmedRevokeReason = revokeReason.trim();
    const revokeReasonRemaining = REVOCATION_REASON_MAX_LENGTH - revokeReason.length;

    // Closing the dialog (cancel, Escape, overlay, X) drops the draft and
    // the last error; a submit in flight keeps the dialog open so the
    // outcome is never lost behind a closed window.
    const handleRevokeDialogOpenChange = useCallback((open: boolean) => {
        if (!open && revokeSubmitting) return;
        setRevokeDialogOpen(open);
        if (!open) {
            setRevokeReason('');
            setRevokeError(null);
        }
    }, [revokeSubmitting]);

    const handleRevoke = useCallback(async () => {
        if (!certId || !trimmedRevokeReason || revokeSubmitting) return;
        setRevokeSubmitting(true);
        setRevokeError(null);
        const result = await AdminService.revokeCertificate(certId, trimmedRevokeReason);
        if (!result.ok) {
            // A known code (e.g. 409: the row already moved under us) maps
            // to its Thai cause + next action rather than echoing the raw
            // backend text.
            setRevokeError(certificateActionMessageFor(result.error) ?? result.message);
            setRevokeSubmitting(false);
            return;
        }
        setRevokeSubmitting(false);
        setRevokeDialogOpen(false);
        setRevokeReason('');
        setRevokeNotice(`เพิกถอนใบรับรอง ${result.data.certificateNumber || certId} แล้ว`);
        // Reload through the same door the page reads from so the revoked
        // panel renders the backend's own columns, not a local guess.
        await load();
    }, [certId, trimmedRevokeReason, revokeSubmitting, load]);

    const trimmedReviseReason = reviseReason.trim();
    const reviseReasonRemaining = REVISION_REASON_MAX_LENGTH - reviseReason.length;
    const reviseHasChanges = !!revisePreview && revisePreview.changed.length > 0;
    const reviseNoChange = !!revisePreview && revisePreview.changed.length === 0;
    // 'ฉบับแก้ไขครั้งที่ n' counts revisions issued; the row's revisionNo
    // counts documents (1 = the original), so n = revisionNo - 1.
    const revisionsIssued = Math.max(0, (cert?.revisionNo ?? 1) - 1);

    const handleReviseDialogOpenChange = useCallback((open: boolean) => {
        if (!open && revising) return;
        setReviseDialogOpen(open);
        if (!open) {
            revisePreviewSeq.current += 1;
            setRevisePreview(null);
            setRevisePreviewLoading(false);
            setReviseReason('');
            setReviseError(null);
        }
    }, [revising]);

    // Opening the dialog reads the diff from the preview endpoint. Nothing
    // is written until the admin confirms with a reason.
    const openReviseDialog = useCallback(async () => {
        if (!certId) return;
        const seq = revisePreviewSeq.current + 1;
        revisePreviewSeq.current = seq;
        setReviseDialogOpen(true);
        setRevisePreview(null);
        setReviseReason('');
        setReviseError(null);
        setRevisePreviewLoading(true);
        const result = await AdminService.previewCertificateRevision(certId);
        if (revisePreviewSeq.current !== seq) return;
        setRevisePreviewLoading(false);
        if (!result.ok) {
            setReviseError(certificateActionMessageFor(result.error) ?? result.message);
            return;
        }
        setRevisePreview(result.data);
    }, [certId]);

    const handleRevise = useCallback(async () => {
        if (!certId || !trimmedReviseReason || revising || !reviseHasChanges) return;
        setRevising(true);
        setReviseError(null);
        const result = await AdminService.reviseCertificateLocation(certId, trimmedReviseReason);
        if (!result.ok) {
            setReviseError(certificateActionMessageFor(result.error) ?? result.message);
            setRevising(false);
            return;
        }
        const issued = Math.max(1, result.data.revisionNo - 1);
        setRevising(false);
        setReviseDialogOpen(false);
        setRevisePreview(null);
        setReviseReason('');
        setReviseNotice(`ออกฉบับแก้ไขครั้งที่ ${issued} ของใบรับรอง ${result.data.certificateNumber || certId} แล้ว`);
        // Reload through the same door the page reads from so the hero and
        // the history render the backend's own revision columns.
        await load();
    }, [certId, trimmedReviseReason, revising, reviseHasChanges, load]);

    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 card at legitimately authorized admins.
    if (authLoading) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-sm"
                >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    กำลังตรวจสอบสิทธิ์การเข้าถึง…
                </div>
            </div>
        );
    }

    // Non-ADMIN gate — render the Thai 403 callout and stop. Mirrors
    // the list page's gate so the surface stays consistent.
    if (!isAdmin) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-8 text-center">
                    <h2 className="text-xl font-bold text-rose-900">ไม่มีสิทธิ์เข้าถึง</h2>
                    <p className="mt-3 text-sm text-rose-800">
                        หน้านี้สำหรับผู้ดูแลระบบ (ADMIN) เท่านั้น
                        บัญชีของคุณ (<span className="font-mono">{role || 'unknown'}</span>) ไม่มีสิทธิ์ดูใบรับรอง
                    </p>
                    <Link
                        href="/admin/dashboard"
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                    >
                        กลับไปหน้าผู้ดูแลระบบ
                    </Link>
                </div>
            </div>
        );
    }

    const certStatus = normalizeCertificateStatus(cert?.status);
    const isRevoked = certStatus === 'revoked';
    // Only a live certificate can be revised (the door refuses every other
    // status with CERTIFICATE_NOT_REVISABLE); hide the button elsewhere.
    const isActive = certStatus === 'active';

    return (
        <div className="space-y-5 p-4 md:p-6">
            {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
            <PageToolbar
                eyebrow="ผู้ดูแลระบบ · รายละเอียดใบรับรอง"
                title={cert?.certificateNumber || 'รายละเอียดใบรับรอง'}
                subtitle={
                    cert?.farmName
                        ? `${cert.farmName} · ${cert.cropType || '—'}`
                        : 'กำลังโหลดข้อมูลใบรับรอง…'
                }
                actions={[
                    {
                        key: 'back',
                        label: 'กลับไปหน้ารายการ',
                        icon: <ArrowLeft className="h-4 w-4" aria-hidden="true" />,
                        variant: 'outline',
                        href: '/admin/certificates',
                    },
                ]}
                className="gov-gradient border-none shadow-xl shadow-primary/20"
            />

            {loading ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-sm"
                >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    กำลังโหลดรายละเอียดใบรับรอง…
                </div>
            ) : null}

            {error && !loading ? (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                    {error}
                    <div className="mt-3">
                        <Link
                            href="/admin/certificates"
                            className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            กลับไปหน้ารายการ
                        </Link>
                    </div>
                </div>
            ) : null}

            {!loading && !error && cert ? (
                <>
                    {revokeNotice ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="rounded-xl border border-leaf-300 bg-leaf-soft px-4 py-3 text-sm text-leaf-onSoft"
                        >
                            {revokeNotice}
                        </div>
                    ) : null}

                    {reviseNotice ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="rounded-xl border border-leaf-300 bg-leaf-soft px-4 py-3 text-sm text-leaf-onSoft"
                        >
                            {reviseNotice}
                        </div>
                    ) : null}

                    {/* Certificate-number hero — large + copyable. */}
                    <section
                        className="rounded-2xl border border-leaf-300 bg-leaf-soft/50 p-5 shadow-sm md:p-6"
                        aria-labelledby="cert-number-heading"
                    >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-xs font-semibold text-leaf-700">
                                    <Award className="h-4 w-4" aria-hidden="true" />
                                    เลขที่ใบรับรอง
                                </div>
                                <h2
                                    id="cert-number-heading"
                                    className="mt-2 break-all font-mono text-2xl font-bold text-primary-900 md:text-3xl"
                                >
                                    {cert.certificateNumber}
                                </h2>
                                {revisionsIssued > 0 ? (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        ฉบับแก้ไขครั้งที่ {revisionsIssued} · {formatThaiDate(cert.revisedAt)}
                                    </p>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => void handleCopy()}
                                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-leaf-300 bg-white px-3 py-1.5 text-xs font-semibold text-leaf-onSoft hover:bg-leaf-soft"
                                    aria-label={`คัดลอกเลขที่ใบรับรอง ${cert.certificateNumber}`}
                                >
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                    {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                                </button>
                            </div>
                            <div className="flex shrink-0 items-start gap-3">
                                <CertificateStatusBadge status={cert.status} />
                            </div>
                        </div>
                    </section>

                    {/* Farm + crop + key dates strip. */}
                    <SummaryCard
                        contextPill={`ออก ${formatThaiDate(cert.issuedDate)} · หมดอายุ ${formatThaiDate(cert.expiryDate)}`}
                        totals={[
                            {
                                label: 'ฟาร์ม',
                                value: cert.farmName || '—',
                                emphasis: 'primary',
                            },
                            {
                                label: 'พืช',
                                value: cert.cropType || '—',
                            },
                            {
                                label: 'มาตรฐาน',
                                value: cert.standardName || 'GACP Thailand',
                            },
                            {
                                label: 'อายุใบรับรอง (ปี)',
                                value: String(cert.validityYears ?? 3),
                            },
                        ]}
                        meta={[
                            { label: 'วันที่ออก', value: formatThaiDate(cert.issuedDate) },
                            { label: 'วันหมดอายุ', value: formatThaiDate(cert.expiryDate) },
                            {
                                label: 'จังหวัด',
                                value: placeLabel(cert.province),
                            },
                            {
                                label: 'อำเภอ',
                                value: placeLabel(cert.district),
                            },
                        ]}
                    />

                    {/* Provenance — the application this certificate came from
                        and the officer who issued it. Numbers and names only
                        (F-G4-47): the row's uuids never reach the screen. The
                        link target is the admin application page the
                        'เปิดหน้าใบสมัคร' button already used. */}
                    <section
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                        aria-labelledby="provenance-heading"
                    >
                        <h3
                            id="provenance-heading"
                            className="text-sm font-semibold text-slate-700"
                        >
                            ที่มาของใบรับรอง
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                            ใบรับรองนี้ออกจากใบสมัครด้านล่าง กดเลขที่ใบสมัครเพื่อดูรายละเอียด
                        </p>
                        <dl className="mt-3 grid gap-3 text-sm text-foreground md:grid-cols-2">
                            <div>
                                <dt className="text-xs font-semibold text-muted-foreground">ใบสมัคร</dt>
                                <dd className="mt-1">
                                    {cert.applicationId ? (
                                        <Link
                                            href={`/admin/applications/${encodeURIComponent(cert.applicationId)}/force-status`}
                                            className="font-mono font-semibold text-primary underline-offset-2 hover:underline"
                                        >
                                            {applicationLabel(cert.application, cert.applicationId)}
                                        </Link>
                                    ) : (
                                        '-'
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs font-semibold text-muted-foreground">ออกโดย</dt>
                                <dd className="mt-1">
                                    <StaffIdentityText
                                        id={cert.issuedBy}
                                        displayName={cert.issuer?.displayName}
                                    />
                                </dd>
                            </div>
                        </dl>
                        {cert.applicationId ? (
                            <div className="mt-4">
                                <Link
                                    href={`/admin/applications/${encodeURIComponent(cert.applicationId)}/force-status`}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    เปิดหน้าใบสมัคร
                                </Link>
                            </div>
                        ) : null}
                    </section>

                    {/* Revision history — visible once a revision was issued
                        under this number. The detail row carries the latest
                        revision only (revisionNo / revisedAt / revisionReason);
                        the reason shows as its Thai label, never the code. */}
                    {revisionsIssued > 0 ? (
                        <section
                            className="rounded-xl border border-border bg-card p-5 shadow-sm"
                            aria-labelledby="revision-history-heading"
                        >
                            <h3
                                id="revision-history-heading"
                                className="flex items-center gap-2 text-sm font-semibold text-foreground"
                            >
                                <History className="h-4 w-4" aria-hidden="true" />
                                ประวัติการแก้ไข
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                ใบรับรองนี้ออกฉบับแก้ไขภายใต้เลขที่เดิม ฉบับก่อนหน้าถูกเก็บไว้เป็นประวัติและตรวจสอบย้อนหลังได้
                            </p>
                            <ul className="mt-3 divide-y divide-border text-sm text-foreground">
                                <li className="flex flex-col gap-1 py-2 md:flex-row md:items-center md:justify-between">
                                    <span className="font-semibold">ฉบับแก้ไขครั้งที่ {revisionsIssued}</span>
                                    <span className="text-muted-foreground">
                                        {formatThaiDate(cert.revisedAt)} · {certificateRevisionReasonLabel(cert.revisionReason)}
                                    </span>
                                </li>
                            </ul>
                        </section>
                    ) : null}

                    {/* Revocation block — visible only when status === REVOKED. */}
                    {isRevoked ? (
                        <section
                            className="rounded-xl border border-rose-300 bg-rose-50 p-5 shadow-sm"
                            aria-labelledby="revoke-info-heading"
                        >
                            <h3
                                id="revoke-info-heading"
                                className="flex items-center gap-2 text-sm font-bold text-rose-900"
                            >
                                <Ban className="h-4 w-4" aria-hidden="true" />
                                ใบรับรองนี้ถูกเพิกถอน
                            </h3>
                            <dl className="mt-3 grid gap-3 text-sm text-rose-900 md:grid-cols-2">
                                <div>
                                    <dt className="text-xs font-semibold text-rose-700">
                                        วันที่เพิกถอน
                                    </dt>
                                    <dd className="mt-1">{formatThaiDate(cert.revokedAt)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-rose-700">
                                        ผู้ดำเนินการ
                                    </dt>
                                    <dd className="mt-1">
                                        <StaffIdentityText
                                            id={cert.revokedBy}
                                            displayName={cert.revoker?.displayName}
                                        />
                                    </dd>
                                </div>
                                <div className="md:col-span-2">
                                    <dt className="text-xs font-semibold text-rose-700">
                                        เหตุผลการเพิกถอน
                                    </dt>
                                    <dd className="mt-1 whitespace-pre-wrap">
                                        {cert.revokedReason || '-'}
                                    </dd>
                                </div>
                            </dl>
                        </section>
                    ) : null}

                    {/* Footer action row — back + revoke. */}
                    <section
                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
                        aria-label="การดำเนินการ"
                    >
                        <Link
                            href="/admin/certificates"
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            กลับไปหน้ารายการ
                        </Link>

                        <div className="flex flex-col gap-3 md:flex-row md:items-center">
                            {isActive ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void openReviseDialog()}
                                    leftSection={<FilePenLine className="h-4 w-4" aria-hidden="true" />}
                                    aria-label="ออกฉบับแก้ไขจากบันทึกต้นทาง"
                                >
                                    ออกฉบับแก้ไขจากบันทึกต้นทาง
                                </Button>
                            ) : null}

                            {!isRevoked ? (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={() => handleRevokeDialogOpenChange(true)}
                                    leftSection={<Ban className="h-4 w-4" aria-hidden="true" />}
                                    aria-label="เพิกถอนใบรับรอง"
                                >
                                    เพิกถอนใบรับรอง
                                </Button>
                            ) : null}
                        </div>
                    </section>
                </>
            ) : null}

            {/* Revocation dialog — POST /api/admin/certificates/:id/revoke. */}
            <Dialog open={revokeDialogOpen} onOpenChange={handleRevokeDialogOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>เพิกถอนใบรับรอง</DialogTitle>
                        <DialogDescription>
                            การเพิกถอนมีผลทันทีและย้อนกลับไม่ได้ ใบรับรอง{' '}
                            <span className="font-mono">{cert?.certificateNumber || certId}</span>{' '}
                            จะตรวจสอบไม่ผ่านตั้งแต่นี้ไป คุณต้องระบุเหตุผลเพื่อบันทึกลงประวัติ
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        id="revoke-reason"
                        label="เหตุผลการเพิกถอน"
                        name="reason"
                        required
                        maxLength={REVOCATION_REASON_MAX_LENGTH}
                        value={revokeReason}
                        onChange={(e) => setRevokeReason(e.target.value)}
                        disabled={revokeSubmitting}
                        placeholder="เช่น ตรวจพบการปลอมแปลงเอกสารประกอบคำขอ"
                        description={`พิมพ์ได้อีก ${revokeReasonRemaining} ตัวอักษร (สูงสุด ${REVOCATION_REASON_MAX_LENGTH})`}
                    />
                    {revokeError ? (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                        >
                            {revokeError}
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleRevokeDialogOpenChange(false)}
                            disabled={revokeSubmitting}
                        >
                            ยกเลิก
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => void handleRevoke()}
                            disabled={!trimmedRevokeReason || revokeSubmitting}
                            aria-busy={revokeSubmitting || undefined}
                            leftSection={
                                revokeSubmitting
                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    : <Ban className="h-4 w-4" aria-hidden="true" />
                            }
                        >
                            ยืนยันการเพิกถอน
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revision dialog — GET .../revise-location/preview on open,
                POST /api/admin/certificates/:id/revise-location on confirm. */}
            <Dialog open={reviseDialogOpen} onOpenChange={handleReviseDialogOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>ออกฉบับแก้ไขครั้งที่ {revisionsIssued + 1}</DialogTitle>
                        <DialogDescription>
                            ใบรับรอง{' '}
                            <span className="font-mono">{cert?.certificateNumber || certId}</span>{' '}
                            จะคงเลขที่เดิม ฉบับที่ลงลายมือชื่อแล้วจะถูกเก็บเป็นประวัติ
                            ค่าใหม่มาจากบันทึกต้นทางเท่านั้น (บันทึกฟาร์มและทะเบียนพืช) คุณไม่ต้องพิมพ์ค่าเอง
                        </DialogDescription>
                    </DialogHeader>

                    {revisePreviewLoading ? (
                        <div
                            role="status"
                            aria-live="polite"
                            className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground"
                        >
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            กำลังเปรียบเทียบใบรับรองกับบันทึกต้นทาง…
                        </div>
                    ) : null}

                    {revisePreview ? (
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <caption className="sr-only">
                                    เปรียบเทียบข้อมูลบนใบรับรอง (เดิม) กับบันทึกต้นทาง (ใหม่)
                                </caption>
                                <thead className="bg-muted text-xs font-semibold text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="px-3 py-2 text-left">รายการ</th>
                                        <th scope="col" className="px-3 py-2 text-left">เดิม</th>
                                        <th scope="col" className="px-3 py-2 text-left">ใหม่</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {CERTIFICATE_REVISION_FIELDS.map(({ key, label }) => {
                                        const changed = revisePreview.changed.includes(key);
                                        return (
                                            <tr
                                                key={key}
                                                className={changed ? 'text-foreground' : 'text-muted-foreground'}
                                            >
                                                <th scope="row" className="px-3 py-2 text-left font-semibold">
                                                    {label}
                                                </th>
                                                <td className="whitespace-pre-wrap px-3 py-2">
                                                    {registerValue(revisePreview.current[key])}
                                                </td>
                                                <td className={`whitespace-pre-wrap px-3 py-2${changed ? ' font-semibold' : ''}`}>
                                                    {registerValue(revisePreview.corrected[key])}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : null}

                    {reviseNoChange ? (
                        <p
                            role="status"
                            className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground"
                        >
                            ข้อมูลตรงกันอยู่แล้ว ไม่มีอะไรต้องแก้ไข หากบันทึกต้นทางผิด กรุณาแก้ไขบันทึกต้นทางก่อนแล้วเปิดหน้าต่างนี้อีกครั้ง
                        </p>
                    ) : null}

                    {reviseHasChanges ? (
                        <Textarea
                            id="revise-reason"
                            label="เหตุผลการออกฉบับแก้ไข"
                            name="reason"
                            required
                            maxLength={REVISION_REASON_MAX_LENGTH}
                            value={reviseReason}
                            onChange={(e) => setReviseReason(e.target.value)}
                            disabled={revising}
                            placeholder="เช่น ระบบบันทึกจังหวัดเป็น Unknown ตอนออกใบรับรอง"
                            description={`พิมพ์ได้อีก ${reviseReasonRemaining} ตัวอักษร (สูงสุด ${REVISION_REASON_MAX_LENGTH})`}
                        />
                    ) : null}

                    {reviseError ? (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                        >
                            {reviseError}
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleReviseDialogOpenChange(false)}
                            disabled={revising}
                        >
                            {reviseHasChanges ? 'ยกเลิก' : 'ปิด'}
                        </Button>
                        {reviseHasChanges ? (
                            <Button
                                type="button"
                                variant="primary"
                                onClick={() => void handleRevise()}
                                disabled={!trimmedReviseReason || revising}
                                aria-busy={revising || undefined}
                                leftSection={
                                    revising
                                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                        : <FilePenLine className="h-4 w-4" aria-hidden="true" />
                                }
                            >
                                ยืนยันออกฉบับแก้ไข
                            </Button>
                        ) : null}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
