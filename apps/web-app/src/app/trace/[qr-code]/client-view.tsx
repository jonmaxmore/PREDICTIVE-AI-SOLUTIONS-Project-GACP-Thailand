'use client';


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/primitives/button';
import { useDisclosure } from '@/hooks/use-disclosure';
import { type TraceData } from './trace-page-types';
import { fetchTraceEnvelope } from '../trace-fetch';
import { TraceUnavailable } from '../trace-unavailable';
import { deriveTraceTrust, traceVerificationCaption } from '@/lib/verify/trace-trust';
import { deriveLabAssurance } from '../lab-assurance';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
    IconX, IconShieldCheck, IconShieldOff, IconLeaf,
    IconMapPin, IconCalendar, IconFlask, IconCertificate, IconChevronDown,
    IconQrcode, IconShare, IconPhone, IconExternalLink, IconAlertCircle
} from '@tabler/icons-react';

interface TraceApiResponse extends TraceData {
    success?: boolean;
    message?: string;
}

export default function TracePage({ initialData = null }: { initialData?: TraceData | null }) {
    const params = useParams();
    const qrCode = String((params as Record<string, string | string[] | undefined>)?.['qr-code'] || (params as Record<string, string | string[] | undefined>)?.qrCode || '');

    // `initialData` arrives from the server render (page.tsx), so the certified/
    // not-certified answer is already in the first HTML and the citizen does not
    // wait for the bundle plus a 2.7s round trip. When it is null — server fetch
    // failed, or the backend gave a definitive not-found — the effect below runs
    // exactly as it always did, so every failure path is unchanged.
    const [loading, setLoading] = useState(initialData === null);
    const [error, setError] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [traceData, setTraceData] = useState<TraceData | null>(initialData);
    const [detailsOpen, { toggle: toggleDetails }] = useDisclosure(false);

    useEffect(() => {
        if (!qrCode) return;
        if (initialData !== null) return;

        async function fetchTraceData() {
            // W1-TRACE: classify the outcome. A definitive backend verdict
            // (404 not-found, 410 revoked/expired — whose body.message carries
            // the honest reason, or 2xx + success:false) renders the red
            // not-found card; a transport/5xx failure (backend down) renders
            // the neutral amber "cannot verify right now" state instead —
            // NEVER a "not found" claim on this public QR trust surface.
            const outcome = await fetchTraceEnvelope<TraceApiResponse>(`/api/trace/${qrCode}`);
            if (outcome.kind === 'unavailable') {
                setUnavailable(true);
            } else if (outcome.kind === 'not-found') {
                setError(outcome.message || 'ไม่พบข้อมูลผลิตภัณฑ์');
            } else {
                setTraceData(outcome.payload);
            }
            setLoading(false);
        }

        fetchTraceData();
    }, [qrCode, initialData]);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-3">
                    <Spinner color="teal" size="lg" type="bars" />
                    <p className="text-sm font-medium text-slate-500">กำลังตรวจสอบความถูกต้อง...</p>
                </div>
            </div>
        );
    }

    if (unavailable) {
        return <TraceUnavailable retryHref={`/trace/${encodeURIComponent(qrCode)}`} code={qrCode} />;
    }

    if (error || !traceData) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
                <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-500">
                        <IconX size={40} />
                    </div>
                    <h2 className="mb-2 text-xl font-semibold text-slate-900">ไม่พบข้อมูลผลิตภัณฑ์</h2>
                    <p className="mb-6 text-sm text-slate-600">{error || 'ไม่พบข้อมูล Trace สำหรับรหัสนี้ในระบบ'}</p>
                    <Badge variant="dot" color="gray">ID: {qrCode}</Badge>
                </div>
            </div>
        );
    }

    const { data, type } = traceData;
    const cert = data.certificate;
    const isLot = type === 'LOT';
    // CORE INVARIANT (M3): keep the two trust signals SEPARATE.
    //   trust.certified    ← cert.isValid (certification STATUS) gates the green
    //                        "GACP Certified" badge / hero shield / cert timeline
    //                        step.
    //   trust.sealVerified ← verification.valid (the FAIL-CLOSED cryptographic QR
    //                        seal) gates ONLY the seal caption at the bottom.
    // A certified product whose QR seal can't be confirmed (e.g. a cycle-level
    // scan, which carries no seal at its own granularity) stays "GACP Certified"
    // with a separate neutral seal note — it is NOT flipped to a red product.
    const trust = deriveTraceTrust(cert?.isValid, data.verification?.valid);
    // SEC-TRACE-PII-002 / R9: existence-only lab assurance (no values, no
    // report file, no pass/fail verdict — see ../lab-assurance.ts).
    const labAssurance = deriveLabAssurance(data, isLot);

    // This page commits to ONE visual world on purpose: it is a passport-style
    // document a stranger opens from a QR code on a product, and it should look the
    // same in a shop whatever theme the phone is set to. Committing means painting
    // explicitly — `text-slate-900` on the container so no descendant inherits
    // --foreground, which is near-white in dark and produced 1.11:1 on the farm name
    // and the lot number (evidence/apple-qa-audit-2026-09-07). Elements that want
    // another colour still set one; this only catches the unpainted.
    return (
        <div className="min-h-screen bg-green-50 pb-20 text-slate-900">
            {/* --- Hero Header (Passport Style) --- */}
            <div
                className="relative min-h-[320px] pb-[76px] rounded-b-[2rem] bg-[radial-gradient(circle_at_center,theme(colors.mantine.teal.9),theme(colors.mantine.green.9))]"
                /* The hero was h-[320px] with overflow:hidden while the card below is
                   pulled up by -mt-[60px]. On a phone the Thai headline wraps to two
                   lines and the second one fell inside the overlap: 16px of
                   "ผ่านการรับรองมาตรฐาน GACP" — the sentence this whole page exists to
                   say — was cut off (evidence/apple-qa-audit-2026-09-07). min-h plus a
                   bottom pad equal to the pull-up means the card can only ever eat
                   padding, never type, at any headline length. */
            >
                {/* Decorative Pattern */}
                <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]" />

                <div className="relative z-10 mx-auto w-full max-w-xs px-4 pt-6">
                    <div className="flex flex-col items-center gap-2">
                        {/* Product badge — gated on certification STATUS only */}
                        <Badge tone={trust.certified ? 'success' : 'warning'} className="font-extrabold">
                            {trust.certified ? 'ได้รับการรับรอง GACP (GACP Certified)' : 'ยังไม่ได้รับการรับรอง (Not Certified)'}
                        </Badge>

                        <div>
                            <div
                                className={`mt-4 flex h-[120px] w-[120px] items-center justify-center rounded-full border-4 border-white/20 ${trust.certified ? 'bg-primary' : 'bg-white/15'}`}
                            >
                                {trust.certified ? (
                                    <IconShieldCheck size={64} color="white" />
                                ) : (
                                    <IconShieldOff size={64} color="white" />
                                )}
                            </div>
                        </div>

                        <h2 className="mt-3 min-h-[2.6em] text-2xl font-semibold leading-snug text-white">
                            {trust.titleTH}
                        </h2>
                        <p className="text-sm text-white opacity-90">
                            {trust.captionTH}
                        </p>

                        {/* Seal line — SEPARATE chip gated on the cryptographic QR verdict.
                            Never invalidates the product; just states the seal status. */}
                        <Badge
                            tone={trust.sealVerified ? 'success' : 'neutral'}
                            className="mt-1 text-[10px] font-bold"
                        >
                            {trust.sealVerified
                                ? 'ยืนยันลายเซ็น QR แล้ว (QR Seal Verified)'
                                : 'ยังไม่ได้ยืนยันลายเซ็น QR (Not Verified)'}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="relative z-20 mx-auto -mt-[60px] w-full max-w-xs px-4">
                <div className="flex flex-col gap-5">

                    {/* --- Product Identity Card --- */}
                    <div className="rounded-lg bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-start justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-500">ชื่อผลิตภัณฑ์</p>
                                <h2 className="text-lg font-semibold text-slate-900">{data.plant.nameEN || data.plant.nameTH}</h2>
                                <p className="text-sm font-semibold text-teal-700">{data.plant.variety}</p>
                            </div>
                            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600 transition-colors hover:bg-teal-100" aria-label="แชร์ข้อมูลการตรวจสอบย้อนกลับ">
                                <IconShare size={20} />
                            </button>
                        </div>

                        <hr className="mb-4 h-px border-0 bg-slate-200/60" />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="mb-1 flex items-center gap-1.5">
                                    <IconLeaf size={14} className="text-gray-400" />
                                    <p className="text-xs text-slate-500">แหล่งที่มา</p>
                                </div>
                                <p className="truncate text-sm font-semibold text-slate-900">{data.farm.name}</p>
                            </div>
                            <div>
                                <div className="mb-1 flex items-center gap-1.5">
                                    <IconMapPin size={14} className="text-gray-400" />
                                    <p className="text-xs text-slate-500">สถานที่</p>
                                </div>
                                <p className="truncate text-sm font-semibold">{data.farm.location.split(',')[0]}</p>
                            </div>
                            {isLot && (
                                <>
                                    <div>
                                        <div className="mb-1 flex items-center gap-1.5">
                                            <IconQrcode size={14} className="text-gray-400" />
                                            <p className="text-xs text-slate-500">เลขล็อต</p>
                                        </div>
                                        <p className="font-mono text-sm font-semibold">{data.lot?.lotNumber}</p>
                                    </div>
                                    <div>
                                        <div className="mb-1 flex items-center gap-1.5">
                                            <IconCalendar size={14} className="text-gray-400" />
                                            <p className="text-xs text-slate-500">วันหมดอายุ</p>
                                        </div>
                                        <p className={`text-sm font-semibold ${data.lot?.expiryDate && new Date(data.lot.expiryDate) < new Date() ? 'text-red-600' : 'text-slate-900'}`}>
                                            {data.lot?.expiryDate ? formatDate(data.lot.expiryDate) : '-'}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* --- Lab Assurance (existence only — SEC-TRACE-PII-002 / R9) ---
                        Public page states ONLY whether a lab test exists. No
                        measured values, no report file, no pass/fail verdict —
                        the buyer requests the full COA from the farmer directly. */}
                    {labAssurance.show && (
                        <div className="rounded-lg bg-white p-5 shadow-sm">
                            <div className="mb-3 flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                    <IconFlask size={18} />
                                </div>
                                <p className="font-bold">ผลตรวจวิเคราะห์</p>
                                <Badge color={labAssurance.tested ? 'blue' : 'gray'}>
                                    {labAssurance.tested ? 'มีผลตรวจ' : 'ยังไม่มีผลตรวจ'}
                                </Badge>
                            </div>
                            <div className="rounded-xl bg-slate-100/70 p-4">
                                <p className="text-sm font-semibold text-slate-900">
                                    {labAssurance.captionTH}
                                </p>
                                <p className="mt-2 text-xs text-slate-600">
                                    {labAssurance.noteTH}
                                </p>
                                {/* มติ 2026-09-05: เอกสารต้องเปิดดูได้จริงจากหน้าสแกน
                                    ไม่ใช่แค่มีคำว่า "มีผลตรวจ" — คนที่ถือถุงอยู่ต้องอ่านฉบับจริงได้ */}
                                {labAssurance.fileUrl && (
                                    <div className="mt-3 border-t border-border/50 pt-3">
                                        <a
                                            href={labAssurance.fileUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-sm font-semibold text-blue-700 underline"
                                        >
                                            เปิดผลวิเคราะห์ (COA)
                                            {labAssurance.reportNumber ? ` เลขที่ ${labAssurance.reportNumber}` : ''}
                                        </a>
                                        {labAssurance.verificationStatus === 'FARMER_UPLOADED' && (
                                            <p className="mt-1 text-xs text-slate-600">
                                                เอกสารนี้เกษตรกรเป็นผู้แนบ ยังไม่ได้ผ่านการตรวจสอบโดยเจ้าหน้าที่
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- Journey Timeline --- */}
                    <div className="rounded-lg bg-white p-5 shadow-sm">
                        <div className="mb-4 flex cursor-pointer items-center justify-between" onClick={toggleDetails} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetails(); } }}>
                            <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                                    <IconCertificate size={18} />
                                </div>
                                <p className="font-bold">เส้นทางและใบรับรอง</p>
                            </div>
                            <div className="text-gray-400">
                                <IconChevronDown size={20} style={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                            </div>
                        </div>

                        <ol className="relative ml-3 flex flex-col gap-4 border-l-2 border-slate-200">
                            <li className="ml-4">
                                <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-teal-600 ring-4 ring-white">
                                    <IconMapPin size={12} />
                                </span>
                                <p className="text-sm font-semibold">เพาะปลูก</p>
                                <p className="text-xs text-slate-500">{data.dates?.plantedTH || 'บันทึกวันที่แล้ว'}</p>
                                <p className="mt-1 text-xs">ปลูกที่ {data.farm.name}, {data.farm.location.split(',')[0]}</p>
                            </li>

                            <li className="ml-4">
                                <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600 ring-4 ring-white">
                                    <IconLeaf size={12} />
                                </span>
                                <p className="text-sm font-semibold">เก็บเกี่ยว</p>
                                <p className="text-xs text-slate-500">{data.dates?.actualHarvestTH || 'ดำเนินการแล้ว'}</p>
                                <p className="mt-1 text-xs">เก็บเกี่ยวและคัดคุณภาพ</p>
                            </li>

                            <li className="ml-4">
                                <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 ring-4 ring-white">
                                    <IconFlask size={12} />
                                </span>
                                <p className="text-sm font-semibold">ตรวจวิเคราะห์คุณภาพ</p>
                                <p className="text-xs text-slate-500">ผลตรวจจากห้องปฏิบัติการ</p>
                                <p className="mt-1 text-xs">ตรวจสอบความปลอดภัยและคุณภาพตามมาตรฐาน</p>
                            </li>

                            <li className="ml-4">
                                <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-4 ring-white">
                                    <IconQrcode size={12} />
                                </span>
                                <p className="text-sm font-semibold">บรรจุภัณฑ์</p>
                                <p className="text-xs text-slate-500">{isLot ? `ล็อต: ${data.lot?.lotNumber}` : 'แบ่งบรรจุตามมาตรฐาน'}</p>
                                <p className="mt-1 text-xs">ติด QR Code สำหรับตรวจสอบย้อนกลับ</p>
                            </li>

                            {/* Certified timeline step — completed/green ONLY when the
                                certification STATUS is valid (trust.certified). When not
                                certified, render a neutral/incomplete step rather than a
                                false "completed" green cert milestone. */}
                            <li className="ml-4">
                                <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${trust.certified ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>
                                    {trust.certified ? <IconCertificate size={12} /> : <IconShieldOff size={12} />}
                                </span>
                                <p className={`text-sm font-semibold ${trust.certified ? 'text-teal-700' : 'text-slate-500'}`}>
                                    {trust.certified ? 'รับรอง GACP' : 'ยังไม่ได้รับรอง GACP'}
                                </p>
                                {trust.certified ? (
                                    <>
                                        <p className="text-xs text-slate-500">เลขที่: {cert?.number}</p>
                                        <p className="mt-1 text-xs">ระบบรับรองมาตรฐาน GACP สมุนไพร</p>
                                    </>
                                ) : (
                                    <p className="mt-1 text-xs text-slate-500">ยังไม่มีใบรับรอง GACP ที่ใช้งานได้สำหรับผลิตภัณฑ์นี้</p>
                                )}
                            </li>
                        </ol>
                    </div>

                    {/* --- Safety Disclaimer & FDA Referral --- */}
                    <Alert

                        color="yellow"
                        icon={<IconAlertCircle size={24} />}
                    >
                        <div className="flex flex-col gap-2">
                            <p className="text-sm font-semibold text-yellow-900">
                                คำเตือนด้านความปลอดภัย / Safety Notice
                            </p>
                            <p className="text-xs text-slate-500">
                                {traceData?.data?.disclaimers?.notMedicalAdvice ||
                                    'ข้อมูลนี้เป็นการรับรองแหล่งผลิตและกระบวนการเพาะปลูก ไม่ใช่คำแนะนำทางการแพทย์'}
                            </p>
                            <p className="text-xs font-medium text-orange-700">
                                {traceData?.data?.disclaimers?.consultDoctor ||
                                    'กรุณาปรึกษาแพทย์หรือเภสัชกรก่อนใช้สมุนไพร'}
                            </p>
                        </div>
                    </Alert>

                    {/* --- FDA Referral Card --- */}
                    <div className="rounded-lg bg-slate-50 p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                                <IconPhone size={18} />
                            </div>
                            <p className="font-bold text-red-900">ติดต่อ อย. สำหรับข้อมูลความปลอดภัย</p>
                        </div>

                        <div className="flex flex-col gap-3">
                            <p className="text-sm text-slate-500">
                                {traceData?.data?.referrals?.safety?.scopeNote ||
                                    'สำหรับข้อมูลความปลอดภัย อาการไม่พึงประสงค์ หรือปัญหาการใช้ยา กรุณาติดต่อ อย.'}
                            </p>

                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    asChild

                                    size="sm"
                                >
                                    <a href={`tel:${traceData?.data?.referrals?.safety?.phone || '1556'}`}>
                                        <IconPhone size={16} className="mr-1" />
                                        โทร {traceData?.data?.referrals?.safety?.phone || '1556'}
                                    </a>
                                </Button>
                                <Button
                                    asChild

                                    size="sm"
                                >
                                    <a
                                        href={traceData?.data?.referrals?.safety?.yellowCardReporting || 'https://thaidrug.fda.moph.go.th/report'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <IconExternalLink size={16} className="mr-1" />
                                        แจ้งอาการไม่พึงประสงค์
                                    </a>
                                </Button>
                            </div>

                            <p className="mt-2 text-center text-xs text-slate-500">
                                {traceData?.data?.disclaimers?.reportAdverse ||
                                    'หากพบอาการไม่พึงประสงค์ กรุณาแจ้ง อย. ที่ 1556 หรือผ่านระบบ Yellow Card'}
                            </p>
                        </div>
                    </div>

                    {/* --- Medical Emergency Notice --- */}
                    <Alert
                        variant="destructive"
                        color="red"
                        icon={<IconPhone size={24} />}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                                {/* The Alert paints a PALE red ground (#fef2f2), not the
                                    solid red these classes assumed: text-white measured
                                    1.09:1 and text-red-100 1.11:1 on the live public scan
                                    page — a safety line on a cannabis product that nobody
                                    could read (evidence/apple-qa-audit-2026-09-07). */}
                                <p className="text-sm font-semibold text-red-800">
                                    หากเป็นเหตุฉุกเฉิน / Medical Emergency
                                </p>
                                <p className="text-xs text-red-700">
                                    {traceData?.data?.referrals?.medicalEmergency?.note || 'หากเป็นเหตุฉุกเฉิน โทร 1669'}
                                </p>
                            </div>
                            <Button
                                asChild
                                variant="secondary"
                                size="sm"
                            >
                                <a href={`tel:${traceData?.data?.referrals?.medicalEmergency?.phone || '1669'}`}>
                                    โทร {traceData?.data?.referrals?.medicalEmergency?.phone || '1669'}
                                </a>
                            </Button>
                        </div>
                    </Alert>

                    <p className="mt-6 text-center text-xs text-slate-500">
                        {traceVerificationCaption(trust)}<br />
                        รหัสสแกน: {qrCode} • {formatThaiDate(new Date())}<br />
                        <span className="text-xs text-slate-600">
                            ระบบรับรองมาตรฐาน GACP สมุนไพร
                        </span>
                    </p>

                </div>
            </div>
        </div>
    );
}
