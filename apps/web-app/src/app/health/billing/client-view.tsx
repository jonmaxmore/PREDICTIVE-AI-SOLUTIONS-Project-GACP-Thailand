'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPrinter } from '@tabler/icons-react';

import { AuthService } from '@/lib/services/auth-service';
import { api } from '@/lib/api/api-client';
import {
    PageToolbar,
    SummaryCard as FlowSummaryCard,
    StatusBadge as FlowStatusBadge,
} from '@/components/finance';
import {
    pickBillingAppId,
    billingAppKey,
    type MyApplication,
} from './billing-app-select';

// ── Types — mirror the customer-statement-service shape ────────────────

type SideSummary = {
    billed: number;
    paid: number;
    outstanding: number;
    invoiceCount: number;
} | null;

type StatementInvoice = {
    id: string;
    invoiceNumber: string;
    receiptNumber: string | null;
    serviceType: string;
    bookSide: 'DTAM' | 'PLATFORM';
    status: string;
    isPaid: boolean;
    totalAmount: number;
    subtotal: number;
    vat: number;
    dueDate: string | null;
    paidAt: string | null;
    paymentMethod: string | null;
};

type StatementQuotation = {
    id: string;
    quotationNumber: string | null;
    issuerType: 'DTAM' | 'PLATFORM';
    status: string | null;
    totalAmount: number;
    issueDate: string | null;
    validUntil: string | null;
    acceptedAt: string | null;
};

type StatementApplication = {
    id: string;
    applicationNumber: string;
    status: string;
    createdAt: string;
    phase1Status: string | null;
    phase2Status: string | null;
    phase1PaidAt: string | null;
    phase2PaidAt: string | null;
    quotations: StatementQuotation[];
    invoices: StatementInvoice[];
    summary: {
        dtamSide: SideSummary;
        platformSide: SideSummary;
    };
};

type CustomerStatement = {
    applicant: {
        id: string | null;
        name: string | null;
        healthIdMasked: string | null;
        phoneNumberMasked: string | null;
        emailMasked: string | null;
    } | null;
    asOfDate: string;
    organizationId: string;
    summary: {
        dtamSide: SideSummary;
        platformSide: SideSummary;
    };
    applications: StatementApplication[];
};

type ApiResponse = {
    success: boolean;
    data?: CustomerStatement;
    error?: string;
};

// MyApplication is imported from ./billing-app-select — its identifier field is
// `id` (the shape emitted by the backend `mapHealthApplication`).
// Reading `.id` here (bug 4.1) yielded undefined → permanent spinner + colliding
// picker keys.

// ── Helpers ────────────────────────────────────────────────────────────

function fmtBaht(value: number | null | undefined) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 2,
    }).format(value || 0);
}

function fmtDate(value: string | null | undefined) {
    if (!value) return '-';
    try {
        return new Date(value).toLocaleDateString('th-TH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '-';
    }
}

// Status labels now resolved via the shared <FlowStatusBadge /> component
// (see @/components/finance). This file no longer ships its own mapping.

// ── Page ──────────────────────────────────────────────────────────────

export default function HealthBillingClientView() {
    const router = useRouter();

    const [applications, setApplications] = useState<MyApplication[]>([]);
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
    const [statement, setStatement] = useState<CustomerStatement | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 1) Initial load — fetch the applicant's applications. Each
    //    application has its own statement; we surface a list so the
    //    applicant can switch between them.
    useEffect(() => {
        const user = AuthService.getUser();
        if (!user) {
            router.push('/auth/health/login');
            return;
        }
        (async () => {
            try {
                const result = await api.get<{ data: MyApplication[] }>('/applications/my');
                const list: MyApplication[] = Array.isArray((result as unknown as { data?: MyApplication[] })?.data)
                    ? ((result as unknown as { data: MyApplication[] }).data)
                    : [];
                setApplications(list);
                // Bug 4.1 — derive the initial target from `id` (the shape the
                // backend emits). Reading `list[0].id` was always undefined →
                // loadStatement never fired → permanent spinner.
                const firstId = pickBillingAppId(list);
                if (firstId) {
                    setSelectedAppId(firstId);
                } else {
                    setLoading(false);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการคำขอได้');
                setLoading(false);
            }
        })();
    }, [router]);

    // 2) When an application is selected, fetch its statement.
    const loadStatement = useCallback(async (applicationId: string) => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.get<ApiResponse>(`/applications/${encodeURIComponent(applicationId)}/statement`);
            const inner = result as unknown as ApiResponse;
            if (inner?.success && inner.data) {
                setStatement(inner.data);
            } else {
                setError(inner?.error || 'ไม่สามารถโหลดสรุปยอดได้');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedAppId) {
            void loadStatement(selectedAppId);
        }
    }, [selectedAppId, loadStatement]);

    const grandTotals = useMemo(() => {
        if (!statement) return { billed: 0, paid: 0, outstanding: 0 };
        const dtam = statement.summary.dtamSide || { billed: 0, paid: 0, outstanding: 0, invoiceCount: 0 };
        const platform = statement.summary.platformSide || { billed: 0, paid: 0, outstanding: 0, invoiceCount: 0 };
        return {
            billed: dtam.billed + platform.billed,
            paid: dtam.paid + platform.paid,
            outstanding: dtam.outstanding + platform.outstanding,
        };
    }, [statement]);

    return (
        <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 print:max-w-full print:space-y-3 print:px-0 print:py-0">
            <PageToolbar
                eyebrow="ใบแจ้งหนี้และการชำระเงิน"
                title="สรุปยอดของฉัน"
                subtitle="ดูใบแจ้งหนี้ การชำระเงิน และยอดค้างชำระสำหรับคำขอ GACP ของคุณทั้งหมด"
                actions={[
                    {
                        key: 'print',
                        label: 'พิมพ์สรุปยอด',
                        description: 'พิมพ์เป็น PDF/A4 สำหรับเก็บไว้',
                        icon: <IconPrinter className="h-4 w-4" />,
                        onClick: () => typeof window !== 'undefined' && window.print(),
                        variant: 'primary',
                    },
                ]}
            />

            {statement?.applicant ? (
                <FlowSummaryCard
                    org={statement.applicant.name || 'ผู้สมัคร'}
                    contextPill={`ข้อมูล ณ ${fmtDate(statement.asOfDate)}`}
                    totals={[
                        {
                            label: 'ยอดออกใบแจ้งหนี้รวม',
                            value: fmtBaht(grandTotals.billed),
                            emphasis: 'primary',
                            hint: 'ยอดทั้งหมดในระบบ',
                        },
                        {
                            label: 'ชำระแล้ว',
                            value: fmtBaht(grandTotals.paid),
                            emphasis: 'muted',
                            hint: 'ชำระและออกใบเสร็จเรียบร้อย',
                        },
                        {
                            label: 'ค้างชำระ',
                            value: fmtBaht(grandTotals.outstanding),
                            emphasis: 'muted',
                            hint: 'รวมถึงที่ยังไม่ชำระ',
                        },
                    ]}
                    meta={[
                        { label: 'เลขประจำตัว (ซ่อนบางส่วน)', value: statement.applicant.healthIdMasked || '-' },
                        { label: 'จำนวนคำขอทั้งหมด', value: `${statement.applications.length} คำขอ` },
                    ]}
                />
            ) : null}

            {/* ── Application picker ───────────────────────────────────── */}
            {applications.length > 0 ? (
                <nav className="flex flex-wrap gap-2 print:hidden" aria-label="เลือกคำขอ">
                    {applications.map((app) => (
                        <button
                            key={billingAppKey(app)}
                            type="button"
                            onClick={() => setSelectedAppId(app.id)}
                            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                                selectedAppId === app.id
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            {app.applicationNumber}
                        </button>
                    ))}
                </nav>
            ) : null}

            {loading ? (
                <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
                    กำลังโหลดสรุปยอด...
                </p>
            ) : null}

            {error ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                    {error}
                </p>
            ) : null}

            {statement && !loading ? (
                <>
                    {/* ── Side summaries ──────────────────────────────────── */}
                    {/* มติ operator 2026-09-07: "ไม่มีตัวแทนแล้ว บริษัทเป็นคนจัดการทั้งหมด"
                        ต่อจาก W14 — หนึ่งคำขอมีใบเสนอราคาใบเดียว ออกในนามบริษัท ถือราคาทั้งก้อน
                        รวมค่าธรรมเนียมรัฐไว้ข้างใน แล้วบริษัทเคลียร์กับกรมนอกระบบ
                        ⇒ ฝั่งกรมฯ ไม่มีเอกสารเลยสำหรับคำขอใหม่ทุกใบ · การ์ดที่ค้างอยู่ ฿0.00
                        พร้อมบรรทัด "VAT-exempt" อ่านได้ว่า "ไม่มีค่าธรรมเนียมรัฐ" ทั้งที่ค่ารัฐ
                        คือส่วนใหญ่ของบิล และไม่มีอะไรในการ์ดนั้นให้ยกเว้นภาษี
                        คำขอก่อน W14 ที่มีคู่ DTAM+PLATFORM จริง ยังแสดงทั้งสองใบเหมือนเดิม

                        มติต่อเนื่อง 2026-09-07 (ปิด F-MONEY-UI-02): "ไม่ต้อง เราแยกตามบริการ …
                        เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง" ⇒ หน้าจอของเกษตรกรไม่พูดว่าเงินก้อนนี้
                        แบ่งเป็นค่ารัฐเท่าไร ค่าแพลตฟอร์มเท่าไร — นั่นเป็นเรื่องหลังบ้าน สิ่งที่เขาต้อง
                        อ่านออกคือ "ค่าบริการอะไร เท่าไร รวมภาษีหรือยัง" · รายละเอียดว่าซื้อบริการใด
                        อยู่บนบรรทัดของใบเสนอราคา (buildQuotationComponents) */}
                    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {statement.summary.dtamSide && statement.summary.dtamSide.invoiceCount > 0 ? (
                            <SideSummaryCard
                                title="ค่าธรรมเนียมรัฐ (กรมการแพทย์แผนไทยฯ)"
                                subtitle="ผู้ออกเอกสาร: กรมฯ · VAT-exempt ตาม ป.รัษฎากร ม.77/1 (10)"
                                summary={statement.summary.dtamSide}
                                accent="border-sky-200"
                                badgeColorClass="bg-sky-100 text-sky-800"
                            />
                        ) : null}
                        {statement.summary.platformSide && statement.summary.platformSide.invoiceCount > 0 ? (
                            <SideSummaryCard
                                title="ยอดค่าบริการทั้งหมด"
                                subtitle="ออกเอกสารโดยบริษัท · ราคารวมภาษีมูลค่าเพิ่มแล้ว"
                                summary={statement.summary.platformSide}
                                accent="border-violet-200"
                                badgeColorClass="bg-violet-100 text-violet-800"
                            />
                        ) : null}
                    </section>

                    {/* ── Per-application breakdown ───────────────────────── */}
                    {statement.applications.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                            <p className="text-base font-semibold text-slate-700">ยังไม่มีใบแจ้งหนี้</p>
                            <p className="mt-1 text-sm text-slate-500">
                                เมื่อมีการสร้างใบแจ้งหนี้สำหรับคำขอนี้ ระบบจะแสดงรายการที่นี่
                            </p>
                        </div>
                    ) : null}

                    {statement.applications.map((app) => (
                        <article
                            key={app.id}
                            className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm print:break-inside-avoid"
                        >
                            <header className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <h2 className="text-base font-semibold text-slate-900">
                                        คำขอเลขที่ {app.applicationNumber}
                                    </h2>
                                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                        <FlowStatusBadge status={app.status} />
                                        <span>ยื่นเมื่อ {fmtDate(app.createdAt)}</span>
                                    </p>
                                </div>
                            </header>

                            {/* Quotations */}
                            {app.quotations.length > 0 ? (
                                <div className="border-b border-slate-200 px-4 py-3">
                                    <h3 className="text-sm font-semibold text-slate-700">ใบเสนอราคา (QT)</h3>
                                    <ul className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                                        {app.quotations.map((q) => (
                                            <li
                                                key={q.id}
                                                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                                            >
                                                <div className="font-mono text-slate-700">{q.quotationNumber || q.id}</div>
                                                <div className="text-slate-600">
                                                    ผู้ออก: {q.issuerType === 'DTAM' ? 'DTAM (รัฐ)' : 'PLATFORM (บริษัท)'} ·{' '}
                                                    ยอด {fmtBaht(q.totalAmount)}
                                                </div>
                                                <div className="text-slate-500">
                                                    สถานะ: {q.status || '-'} · ออก {fmtDate(q.issueDate)} ·{' '}
                                                    ใช้ได้ถึง {fmtDate(q.validUntil)}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            {/* Invoices table */}
                            <div className="overflow-x-auto px-4 py-3">
                                <h3 className="mb-2 text-sm font-semibold text-slate-700">ใบแจ้งหนี้ + การชำระ</h3>
                                {app.invoices.length === 0 ? (
                                    <p className="text-sm text-slate-500">ยังไม่มีใบแจ้งหนี้</p>
                                ) : (
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                                            <tr>
                                                <th className="px-3 py-2 text-left">เลขที่ INV</th>
                                                <th className="px-3 py-2 text-left">ประเภท</th>
                                                <th className="px-3 py-2 text-right">จำนวนเงิน</th>
                                                <th className="px-3 py-2 text-left">ครบกำหนด</th>
                                                <th className="px-3 py-2 text-left">สถานะ</th>
                                                <th className="px-3 py-2 text-left">เลขที่ใบเสร็จ</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {app.invoices.map((inv) => (
                                                <tr key={inv.id} className="transition-colors hover:bg-slate-50">
                                                    <td className="px-3 py-2 font-mono text-sm font-semibold text-teal-700">{inv.invoiceNumber}</td>
                                                    <td className="px-3 py-2">
                                                        {inv.bookSide === 'DTAM'
                                                            ? 'รัฐ (DTAM)'
                                                            : 'แพลตฟอร์ม (PLATFORM)'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                                                        {fmtBaht(inv.totalAmount)}
                                                    </td>
                                                    <td className="px-3 py-2">{fmtDate(inv.dueDate)}</td>
                                                    <td className="px-3 py-2">
                                                        <FlowStatusBadge status={inv.status} />
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs">
                                                        {inv.receiptNumber || '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </article>
                    ))}
                </>
            ) : null}

            {/* Print stylesheet — A4 portrait, hide nav, keep cards together. */}
            <style jsx global>{`
                @media print {
                    @page { size: A4 portrait; margin: 12mm; }
                    body { background: #fff !important; }
                    nav, button { display: none !important; }
                }
            `}</style>
        </div>
    );
}

function SideSummaryCard({
    title,
    subtitle,
    summary,
    accent,
    badgeColorClass,
}: {
    title: string;
    subtitle: string;
    summary: SideSummary;
    accent: string;
    badgeColorClass?: string;
}) {
    if (!summary) {
        return (
            <div className={`rounded-2xl border bg-white p-5 shadow-sm ${accent}`}>
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
                <p className="mt-4 text-sm text-slate-500">ไม่ได้รับสิทธิ์ดูส่วนนี้</p>
            </div>
        );
    }
    return (
        <div className={`rounded-2xl border bg-white p-5 shadow-sm ${accent}`}>
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                {badgeColorClass ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeColorClass}`}>
                        {summary.invoiceCount} ฉบับ
                    </span>
                ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div>
                    <dt className="text-slate-500">ยอดออก</dt>
                    <dd className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{fmtBaht(summary.billed)}</dd>
                </div>
                <div>
                    <dt className="text-slate-500">ชำระแล้ว</dt>
                    <dd className="font-semibold tabular-nums text-leaf-700">{fmtBaht(summary.paid)}</dd>
                </div>
                <div>
                    <dt className="text-slate-500">ค้างชำระ</dt>
                    <dd className="font-semibold tabular-nums text-rose-700">{fmtBaht(summary.outstanding)}</dd>
                </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">ใบแจ้งหนี้ {summary.invoiceCount} ฉบับ</p>
        </div>
    );
}
