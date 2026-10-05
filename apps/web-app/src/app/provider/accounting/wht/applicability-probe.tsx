'use client';

import { useState, type FormEvent } from 'react';
import {
    IconCheck,
    IconInfoCircle,
    IconSearch,
    IconX,
} from '@tabler/icons-react';
import {
    WhtCertificateService,
    type WhtApplicabilityResult,
} from '@/lib/services/finance-orphans-service';
import { formatTHB } from '@/lib/format/thb';

/**
 * ApplicabilityProbe — "Is WHT applicable for invoice X?" tool.
 *
 * Calls GET /api/finance/wht/applicable/:invoiceId via
 * WhtCertificateService.checkApplicable() and renders a coloured
 * result banner matching the `reason` codes from the backend:
 *
 *   CORPORATE_BUYER_PLATFORM_PAID  → green  (applicable)
 *   INDIVIDUAL_BUYER               → grey   (not applicable — individual)
 *   INVOICE_NOT_PAID               → amber  (cannot withhold until paid)
 *   NOT_PLATFORM_INVOICE           → amber  (state-fee, never WHT)
 *   INVOICE_NOT_FOUND              → grey   (not found)
 *   DB_UNAVAILABLE                 → amber  (system error)
 *
 * Reference: apps/backend/services/wht-service.js
 *   isWhtApplicableForInvoice() lines 531-580
 */

type ProbeState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'result'; result: WhtApplicabilityResult; invoiceId: string }
    | { kind: 'error'; message: string };

const REASON_COPY: Record<string, { tone: 'success' | 'warning' | 'neutral'; title: string; body: string }> = {
    CORPORATE_BUYER_PLATFORM_PAID: {
        tone: 'success',
        title: 'มี WHT บันทึก ทบ.50 ทวิ ได้',
        body: 'ใบกำกับภาษีนี้ออกให้ผู้ซื้อนิติบุคคลและชำระเงินแล้ว ผู้ซื้อมีหน้าที่หัก 3% (ป.รัษฎากร ม.50) สามารถบันทึกหนังสือรับรองได้ทันทีที่ได้รับ',
    },
    INDIVIDUAL_BUYER: {
        tone: 'neutral',
        title: 'ไม่เข้าข่าย WHT ผู้ซื้อเป็นบุคคลธรรมดา',
        body: 'ผู้ซื้อเป็นบุคคลธรรมดา จึงไม่มีหน้าที่หักภาษี ณ ที่จ่าย ตาม ป.รัษฎากร ม.50 (ใช้กับนิติบุคคลกับนิติบุคคลเท่านั้น)',
    },
    INVOICE_NOT_PAID: {
        tone: 'warning',
        title: 'ยังบันทึก WHT ไม่ได้ ใบกำกับภาษียังไม่ได้ชำระ',
        body: 'การหัก ณ ที่จ่ายเกิดขึ้นที่จุดชำระเงิน (RD practice ม.50 + ม.65/2) ใบกำกับภาษีต้องมีสถานะ paid ก่อนจึงจะบันทึก ทบ.50 ทวิ ได้',
    },
    NOT_PLATFORM_INVOICE: {
        tone: 'warning',
        title: 'ไม่เข้าข่าย WHT ไม่ใช่ใบกำกับภาษีฝั่งแพลตฟอร์ม',
        body: 'WHT 3% ใช้กับใบกำกับภาษีค่าบริการแพลตฟอร์มเท่านั้น ใบเสร็จเงินรายได้รัฐ (state-fee) เป็นรายได้รัฐได้รับยกเว้น VAT และไม่อยู่ในขอบเขต ม.50',
    },
    INVOICE_NOT_FOUND: {
        tone: 'neutral',
        title: 'ไม่พบใบกำกับภาษี',
        body: 'ตรวจสอบ invoiceId ที่ระบุอีกครั้ง อาจถูกลบหรือพิมพ์ผิด',
    },
    DB_UNAVAILABLE: {
        tone: 'warning',
        title: 'ระบบฐานข้อมูลใช้งานไม่ได้',
        body: 'ไม่สามารถเชื่อมต่อฐานข้อมูลในตอนนี้ กรุณาลองอีกครั้งในไม่กี่นาที',
    },
};

const TONE_STYLES: Record<'success' | 'warning' | 'neutral', { wrapper: string; icon: string; Icon: typeof IconCheck }> = {
    success: {
        wrapper: 'border-leaf-300 bg-leaf-soft text-primary-900',
        icon: 'text-leaf-700',
        Icon: IconCheck,
    },
    warning: {
        wrapper: 'border-amber-300 bg-amber-50 text-amber-900',
        icon: 'text-amber-700',
        Icon: IconInfoCircle,
    },
    neutral: {
        wrapper: 'border-border bg-muted/40 text-foreground',
        icon: 'text-muted-foreground',
        Icon: IconX,
    },
};

// X4-FIX-C H-5 — adopt the canonical formatTHB. The probe historically
// rendered "฿1,234.56" (prefix + 2dp) for the indicative WHT amount;
// formatTHB with `{ decimals: 2, prefix: true }` matches that shape.
function formatThb(amount: number): string {
    return formatTHB(amount, { decimals: 2, prefix: true });
}

/**
 * [R6-B] CUID/CUID2 precheck pattern. cuid is `c` + 24 alphanumerics
 * (25 chars total); cuid2 is 24 chars without the `c` prefix. We tolerate
 * both by allowing 20-30 trailing characters after the leading `c`. This
 * precheck cuts a wasted network round-trip + the transient 404 for typos
 * (e.g., a user pasting a UUID instead of a cuid) and surfaces a clearer
 * inline message before the fetch.
 */
const CUID_PATTERN = /^c[a-z0-9]{20,30}$/i;

export function ApplicabilityProbe() {
    const [invoiceId, setInvoiceId] = useState('');
    const [state, setState] = useState<ProbeState>({ kind: 'idle' });

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const id = invoiceId.trim();
        if (!id) {
            setState({ kind: 'error', message: 'กรุณากรอก invoiceId' });
            return;
        }
        if (!CUID_PATTERN.test(id)) {
            setState({
                kind: 'error',
                message: 'รูปแบบ invoiceId ไม่ถูกต้อง (ต้องเป็น cuid/cuid2)',
            });
            return;
        }
        setState({ kind: 'loading' });
        try {
            const result = await WhtCertificateService.checkApplicable(id);
            setState({ kind: 'result', result, invoiceId: id });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'ไม่สามารถตรวจสอบได้';
            setState({ kind: 'error', message });
        }
    }

    function handleReset() {
        setInvoiceId('');
        setState({ kind: 'idle' });
    }

    return (
        <section
            aria-label="ตรวจสอบการเข้าข่าย WHT"
            className="space-y-3 rounded-lg border border-border bg-card p-5"
        >
            <header className="space-y-1">
                <h2 className="text-base font-bold text-foreground">
                    ตรวจสอบการเข้าข่าย WHT
                </h2>
                <p className="text-xs text-muted-foreground">
                    วาง invoiceId ของแพลตฟอร์มเพื่อตรวจสอบว่ามีหน้าที่หัก 3% หรือไม่ก่อนบันทึก ทบ.50 ทวิ
                </p>
            </header>

            <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3"
            >
                <div className="flex flex-1 flex-col gap-1">
                    <label
                        htmlFor="wht-applicability-invoice-id"
                        className="text-xs font-semibold text-muted-foreground"
                    >
                        Invoice ID
                    </label>
                    <input
                        id="wht-applicability-invoice-id"
                        type="text"
                        value={invoiceId}
                        onChange={(e) => setInvoiceId(e.target.value)}
                        placeholder="เช่น clx9abc1234..."
                        className="h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="submit"
                        disabled={state.kind === 'loading'}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-leaf-800 disabled:pointer-events-none disabled:bg-leaf-300"
                    >
                        <IconSearch size={16} aria-hidden="true" />
                        ตรวจสอบ
                    </button>
                    {state.kind !== 'idle' ? (
                        <button
                            type="button"
                            onClick={handleReset}
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
                        >
                            ล้าง
                        </button>
                    ) : null}
                </div>
            </form>

            {state.kind === 'loading' ? (
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    กำลังตรวจสอบ...
                </div>
            ) : null}

            {state.kind === 'error' ? (
                <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
                    {state.message}
                </div>
            ) : null}

            {state.kind === 'result' ? (
                <ResultPanel result={state.result} invoiceId={state.invoiceId} />
            ) : null}
        </section>
    );
}

function ResultPanel({
    result,
    invoiceId,
}: {
    result: WhtApplicabilityResult;
    invoiceId: string;
}) {
    const copy = REASON_COPY[result.reason] ?? {
        tone: 'neutral' as const,
        title: 'ผลการตรวจสอบ',
        body: `เหตุผล: ${result.reason}`,
    };
    const styles = TONE_STYLES[copy.tone];
    const Icon = styles.Icon;
    return (
        <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border-2 p-4 ${styles.wrapper}`}
        >
            <div className="flex items-start gap-3">
                <Icon size={20} className={`mt-0.5 shrink-0 ${styles.icon}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <p className="font-bold">{copy.title}</p>
                    <p>{copy.body}</p>

                    <dl className="border-current/20 grid grid-cols-1 gap-2 border-t pt-2 text-xs md:grid-cols-3">
                        <div>
                            <dt className="font-semibold opacity-75">
                                Invoice ID
                            </dt>
                            <dd className="mt-0.5 break-all font-mono">{invoiceId}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold opacity-75">
                                Reason code
                            </dt>
                            <dd className="mt-0.5 font-mono">{result.reason}</dd>
                        </div>
                        {typeof result.indicativeWht === 'number' ? (
                            <div>
                                <dt className="font-semibold opacity-75">
                                    WHT โดยประมาณ (3%)
                                </dt>
                                <dd className="mt-0.5 font-mono tabular-nums">
                                    {formatThb(result.indicativeWht)}
                                </dd>
                            </div>
                        ) : null}
                    </dl>

                    {result.alreadyRecorded ? (
                        <p className="bg-current/10 rounded-md px-2 py-1 text-xs font-semibold">
                            ใบกำกับภาษีนี้มีการบันทึก ทบ.50 ทวิ ไว้แล้ว
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default ApplicabilityProbe;
