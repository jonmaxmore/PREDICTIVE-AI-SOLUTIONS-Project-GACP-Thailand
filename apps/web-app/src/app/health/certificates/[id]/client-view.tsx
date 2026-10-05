'use client';

/**
 * Certificate detail (applicant view) — /health/certificates/[id].
 *
 * Iter 23 scope: applicants land here after their cert is issued. The
 * page makes the three most important actions one click away:
 *
 *   1. Download the official PDF (primary green CTA).
 *   2. Copy the public verify URL to share with buyers/auditors.
 *   3. Print directly from the browser (print CSS strips chrome).
 *
 * Layout:
 *   - Top: large green success card celebrating the issued cert.
 *   - Mid: 2-col grid (metadata left, QR + verify URL right) on
 *     desktop, single column on mobile.
 *   - Bottom: print + share row.
 *
 * The cert metadata block shows BE-year issue/expiry and a clear
 * status pill. The QR is rendered by the shared `<QrImage>` component
 * (fix-round 1, review 6712f985 — this page was the original source of
 * that approach, retrofitted onto the shared component so QrImage's own
 * "single client-side rendering path" docstring is actually true): it
 * generates client-side from the verify URL, falling back to the
 * backend-provided qrCode blob ONLY if generation errors (never trusted
 * as primary — it can be stale after the verify-base env var changes).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    CertificateService,
    type CertificateDetail,
} from '@/lib/services/certificate-service';
import { AuthService } from '@/lib/services/auth-service';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { StatusBadge, type StatusTone } from '@/components/finance';
import { QrImage } from '@/components/ui/qr-image';

// Thai BE year = Gregorian + 543.
function toBuddhistDate(value: string | null | undefined): string {
    if (!value) return '-';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        const dateStr = d.toLocaleDateString('th-TH', {
            day: '2-digit',
            month: 'long',
        });
        const beYear = d.getFullYear() + 543;
        return `${dateStr} ${beYear}`;
    } catch {
        return value;
    }
}

function certStatusBadge(status: string): { tone: StatusTone; label: string } {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'ACTIVE') return { tone: 'paid', label: 'ใช้งานได้ (ACTIVE)' };
    if (normalized === 'EXPIRED') return { tone: 'cancelled', label: 'หมดอายุ (EXPIRED)' };
    if (normalized === 'REVOKED') return { tone: 'overdue', label: 'ถูกเพิกถอน (REVOKED)' };
    if (normalized === 'SUSPENDED') return { tone: 'held', label: 'ถูกระงับ (SUSPENDED)' };
    return { tone: 'draft', label: normalized || 'ไม่ทราบสถานะ' };
}

interface ClientViewProps {
    id: string;
}

export default function CertificateDetailClientView({ id }: ClientViewProps) {
    const router = useRouter();
    const [cert, setCert] = useState<CertificateDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        const user = AuthService.getUser();
        if (!user) {
            router.push('/auth/health/login');
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        void (async () => {
            const res = await CertificateService.getCertificateById(id);
            if (cancelled) return;
            if (res.success && res.data) {
                setCert(res.data);
            } else {
                setError(res.error || 'ไม่พบใบรับรองนี้ หรือท่านไม่มีสิทธิ์เข้าถึง');
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [id, router]);

    async function handleDownload() {
        if (!cert) return;
        setDownloadError(null);
        setDownloading(true);
        try {
            const ok = await CertificateService.downloadCertificatePdf(
                cert.id,
                cert.certificateNumber,
            );
            if (!ok) {
                setDownloadError('ไม่สามารถดาวน์โหลดใบรับรองได้ กรุณาลองอีกครั้ง');
            }
        } finally {
            setDownloading(false);
        }
    }

    async function handleCopyVerifyUrl() {
        if (!cert) return;
        const url = CertificateService.getCertificateVerifyUrl(cert.certificateNumber);
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                // Fallback for old browsers / non-secure contexts.
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.setAttribute('readonly', '');
                ta.style.position = 'absolute';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopySuccess(true);
            window.setTimeout(() => setCopySuccess(false), 2400);
        } catch {
            setCopySuccess(false);
        }
    }

    function handlePrint() {
        if (typeof window === 'undefined') return;
        window.print();
    }

    if (loading) {
        return (
            <div className="mx-auto max-w-4xl p-4 sm:p-6">
                <PageSkeleton type="detail" />
            </div>
        );
    }

    if (error || !cert) {
        return (
            <div className="mx-auto max-w-3xl p-4 sm:p-6">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
                    <p className="text-base font-semibold text-rose-900">
                        ไม่สามารถแสดงรายละเอียดใบรับรองได้
                    </p>
                    <p className="mt-1 text-sm text-rose-800">{error}</p>
                    <Link
                        href="/health/certificates"
                        className="mt-4 inline-flex items-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                    >
                        กลับไปยังรายการใบรับรอง
                    </Link>
                </div>
            </div>
        );
    }

    const statusMeta = certStatusBadge(cert.status);
    const verifyUrl = CertificateService.getCertificateVerifyUrl(cert.certificateNumber);

    return (
        <div className="w-full space-y-5 p-4 sm:p-6">
            {/* Top — success card. The green card is the visual reward
                for the applicant completing the whole GACP pipeline. */}
            <section
                data-testid="cert-success-card"
                className="overflow-hidden rounded-2xl border border-leaf-300 bg-leaf-soft p-5 shadow-sm sm:p-6"
            >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-xs font-semibold text-leaf-700">
                            สถานะใบรับรอง
                        </p>
                        <h1 className="mt-1 text-2xl font-bold text-primary-900 sm:text-3xl">
                            ยินดีด้วย! ใบรับรอง GACP ของท่านพร้อมแล้ว
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm text-primary-900/80">
                            ใบรับรองมีผลตั้งแต่{' '}
                            <strong>{toBuddhistDate(cert.issuedDate)}</strong> ถึง{' '}
                            <strong>{toBuddhistDate(cert.expiryDate)}</strong>  
                            ดาวน์โหลดเอกสารฉบับเต็มเพื่อใช้ติดต่อหน่วยงานหรือคู่ค้า
                        </p>
                    </div>
                    <StatusBadge
                        status={cert.status}
                        tone={statusMeta.tone}
                        label={statusMeta.label}
                        className="self-start text-sm"
                    />
                </div>
            </section>

            {/* Metadata + QR. Two-column on md+, stacks on mobile. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                {/* Metadata — spans 3 cols on desktop. */}
                <section className="rounded-2xl border border-slate-100 bg-card p-5 shadow-sm lg:col-span-3">
                    <h2 className="text-sm font-semibold text-muted-foreground">
                        ข้อมูลใบรับรอง
                    </h2>
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                        <div>
                            <dt className="text-xs text-muted-foreground">เลขที่ใบรับรอง</dt>
                            <dd className="mt-0.5 font-mono text-base font-semibold text-foreground">
                                {cert.certificateNumber}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">สถานะ</dt>
                            <dd className="mt-0.5 font-semibold text-foreground">
                                {statusMeta.label}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">วันที่ออก</dt>
                            <dd className="mt-0.5 font-medium text-foreground">
                                {toBuddhistDate(cert.issuedDate)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">วันที่หมดอายุ</dt>
                            <dd className="mt-0.5 font-medium text-foreground">
                                {toBuddhistDate(cert.expiryDate)}
                            </dd>
                        </div>
                        {cert.siteName ? (
                            <div className="sm:col-span-2">
                                <dt className="text-xs text-muted-foreground">ชื่อแปลง / ฟาร์ม</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                    {cert.siteName}
                                </dd>
                            </div>
                        ) : null}
                        {cert.plantType ? (
                            <div>
                                <dt className="text-xs text-muted-foreground">พืชหลัก</dt>
                                <dd className="mt-0.5 font-medium text-foreground">
                                    {cert.plantType}
                                </dd>
                            </div>
                        ) : null}
                        {cert.farm?.location ? (
                            <div>
                                <dt className="text-xs text-muted-foreground">ที่ตั้ง</dt>
                                <dd className="mt-0.5 text-foreground">{cert.farm.location}</dd>
                            </div>
                        ) : null}
                    </dl>

                    {/* Primary CTA — download PDF. */}
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={() => void handleDownload()}
                            disabled={downloading}
                            className="inline-flex flex-1 items-center justify-center rounded-xl bg-leaf-700 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-leaf-800 disabled:cursor-not-allowed disabled:bg-leaf-300"
                        >
                            {downloading ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดใบรับรอง (PDF)'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleCopyVerifyUrl()}
                            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-card px-5 py-3 text-base font-semibold text-foreground transition hover:bg-slate-50"
                        >
                            {copySuccess ? 'คัดลอกลิงก์แล้ว ' : 'แชร์ใบรับรอง'}
                        </button>
                    </div>
                    {downloadError ? (
                        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {downloadError}
                        </p>
                    ) : null}
                </section>

                {/* QR + verify URL — 2 cols on desktop. */}
                <section className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-card p-5 shadow-sm lg:col-span-2">
                    <h2 className="text-sm font-semibold text-muted-foreground">
                        ตรวจสอบใบรับรองสาธารณะ
                    </h2>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 print:border-none">
                        <QrImage
                            value={verifyUrl}
                            alt={`QR ตรวจสอบใบรับรอง ${cert.certificateNumber}`}
                            size={224}
                            className="h-52 w-52 sm:h-56 sm:w-56"
                            fallbackSrc={cert.qrCode ?? null}
                        />
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                        สแกน QR หรือเปิดลิงก์เพื่อยืนยันความถูกต้องของใบรับรอง
                    </p>
                    <div className="w-full rounded-lg bg-slate-50 px-3 py-2 text-center">
                        <p className="text-[11px] text-muted-foreground">
                            ลิงก์ตรวจสอบ
                        </p>
                        <a
                            href={verifyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block break-all font-mono text-xs text-leaf-700 hover:underline"
                        >
                            {verifyUrl}
                        </a>
                    </div>
                </section>
            </div>

            {/* Bottom — small print/back links. The print button uses the
                browser print dialog so the page styles cleanly via the
                global print CSS. */}
            <footer className="flex flex-col items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:flex-row print:hidden">
                <Link
                    href="/health/certificates"
                    className="text-muted-foreground hover:text-foreground hover:underline"
                >
                    ← กลับไปยังรายการใบรับรอง
                </Link>
                <button
                    type="button"
                    onClick={handlePrint}
                    className="text-leaf-700 hover:text-leaf-800 hover:underline"
                >
                    พิมพ์ใบรับรอง
                </button>
            </footer>
        </div>
    );
}
