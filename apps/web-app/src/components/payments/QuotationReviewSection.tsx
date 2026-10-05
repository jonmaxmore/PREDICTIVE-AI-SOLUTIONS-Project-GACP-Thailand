'use client';

/**
 * QuotationReviewSection — "ใบเสนอราคา" review/accept panel on /health/payments.
 *
 * The DTAM workflow issues a quotation (ใบเสนอราคา) the moment an application is
 * SUBMITTED, BEFORE any payment. The farmer must review the per-cultivation-type
 * line items and ACCEPT before the Phase-1 invoice/payment gate opens (the hard
 * gate itself lands in a later change — this panel is the review/accept surface).
 *
 * Two quotations per application, rendered as separate cards because the two
 * money flows are legally distinct (ม.86 "one document = one seller"):
 *   - DTAM     — state fee (ค่าธรรมเนียมรัฐ, VAT-exempt ม.77/1(10))
 *   - PLATFORM — Predictive AI service fee + VAT 7%
 *
 * Each quotation splits into two phases that mirror the official DTAM form and
 * the two-phase payment schedule:
 *   - งวดที่ 1 — ค่าตรวจสอบและประเมินคำขอ (5,000/ระบบ for DTAM)
 *   - งวดที่ 2 — ค่ารับรองผลและจัดทำหนังสือรับรอง (25,000/ระบบ for DTAM)
 * One row per cultivation type (Indoor/Greenhouse/Outdoor) — the same rows the
 * PDF prints — sourced from the API `lineItems` (canonical fee math, no client
 * re-implementation).
 *
 * The section hides itself entirely when no quotation has been issued yet
 * (both sides null) so applicants who haven't reached SUBMITTED don't see an
 * empty panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
    isQuotationAccepted,
    isQuotationAcceptable,
    isQuotationLapsed,
    PaymentService,
    quotationAcceptFailureMessage,
    quotationLapsedNoticeTh,
    type LapsedNoticeSurface,
    type QuotationIssuerType,
    type QuotationRecord,
    type QuotationLineItem,
    type QuotationsBySide,
    type QuotationStatus,
} from '@/lib/services/payment-service';
import { quotationServicesOrFallback, type QuotationServices } from '@/lib/pricing/fee-services';

interface QuotationReviewSectionProps {
    applicationId: string;
    // Called after a successful accept so the parent can refresh invoices —
    // accepting a quotation is what unlocks the Phase-1 invoice.
    onAccepted?: () => void;
    /**
     * F-G4-64 — the rows, when the PARENT already fetched them. The payments
     * page gates its pay button on the same answer, and GET
     * /api/applications/:id/quotations is also the door that re-issues a
     * missing quotation, so the page fetches once and hands the result down
     * instead of two components racing two issuance attempts.
     *
     *   undefined → this component fetches for itself (its original behaviour)
     *   null      → the parent has not answered yet (loading)
     */
    quotations?: QuotationsBySide | null;
    /**
     * Which screen this section is standing on, for the lapsed-offer notice.
     *
     * The 'payments-list' sentence tells the applicant to press รีเฟรช, which is
     * true on /health/payments and only there — that page draws the button, and
     * its own GET is what replaces the offer. Since R23 this same component is
     * also the renewal wizard's quotation screen, whose only controls are
     * ย้อนกลับ / ถัดไป, so the surface travels with the mount instead of being
     * assumed (review r1, minor 1). Defaults to the page it was written for.
     */
    lapsedSurface?: LapsedNoticeSurface;
}

function toNumber(value: number | string | null | undefined): number {
    const n = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(n) ? (n as number) : 0;
}

function formatCurrency(value: number | string) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 2,
    }).format(toNumber(value));
}

// One panel shell for both branches (busy placeholder and loaded cards) so the
// section keeps the same footprint while it loads.
const SECTION_CLASS =
    'rounded-2xl border border-slate-200 bg-card p-4 shadow-[0_16px_36px_-26px_rgba(15,23,42,0.3)] sm:p-5';

const ISSUER_META: Record<
    QuotationIssuerType,
    { title: string; subtitle: string; accent: string; chipBg: string }
> = {
    // W14: legacy only. Applications quoted BEFORE the single-issuer ruling
    // still carry a DTAM row and must keep rendering with their own wording and
    // their own frozen numbers. Nothing new is issued under this key.
    DTAM: {
        title: 'ใบเสนอราคา ค่าธรรมเนียมภาครัฐ (ฉบับเดิม)',
        subtitle: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (ยกเว้น VAT)',
        accent: 'border-leaf-300 bg-leaf-soft/40',
        chipBg: 'bg-leaf-soft text-leaf-onSoft',
    },
    // W14 (มติ operator 2026-08-22, the change log c28355ea): ใบเสนอราคาใบเดียว
    // ครอบคลุมค่าบริการทั้งก้อน ไม่ใช่เฉพาะส่วนแพลตฟอร์ม
    // หัวข้อเดิม 'ค่าบริการแพลตฟอร์ม' จึงต่ำกว่าสิ่งที่เอกสารครอบคลุมจริง
    //
    // คำบรรยายใต้หัวข้อเคยเขียนว่า "(ราคาเต็ม + ค่าแพลตฟอร์ม 10% + VAT 7%)" — กาง
    // องค์ประกอบบัญชีของผู้ขายให้เกษตรกรอ่าน · มติ operator 2026-09-07 (F-MONEY-UI-02)
    // และย้ำ 2026-09-12: "เรารวมเป็นแจ้งว่าค่าบริการ แยกตามวัตถุประสงค์การปลูก"
    //
    // สิ่งที่ต่างกันจริงในสายตาเกษตรกรคือ **รูปแบบการปลูก** ซึ่งบรรทัดในใบเสนอราคา
    // แสดงอยู่แล้ว (กลางแจ้ง / โรงเรือน / อาคารระบบปิด พร้อมราคาของแต่ละแบบ)
    PLATFORM: {
        title: 'ใบเสนอราคา ค่าบริการ',
        subtitle: 'บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด · ค่าบริการรวมภาษีมูลค่าเพิ่มแล้ว',
        accent: 'border-sky-200 bg-sky-50/40',
        chipBg: 'bg-sky-100 text-sky-800',
    },
};

// Status pill — the applicant can only accept a PENDING/SENT/DRAFT quotation.
// It takes the ROW (with the status the card currently believes), not the
// status alone, because two rows can hold the same status for different
// reasons and the screen has to say which one this is.
function statusPill(
    quotation: { status: QuotationStatus; acceptedAt?: string | null; validUntil?: string | null },
): { label: string; tone: string } {
    // Final round R21 — a row still in an acceptable status whose validity date
    // has passed is refused by the acceptance door itself (markQuotationAccepted,
    // QUOTATION_EXPIRED). "รอการยอมรับ" would describe a wait that has ended.
    if (isQuotationLapsed(quotation)) {
        return { label: 'เกินกำหนดยืนราคา', tone: 'bg-muted text-muted-foreground' };
    }
    switch (quotation.status) {
        case 'ACCEPTED':
            return { label: 'ยอมรับแล้ว', tone: 'bg-leaf-soft text-leaf-onSoft' };
        case 'INVOICED':
            // F-G4-64 spec §3.7 — a row closed by the repair script is INVOICED
            // with acceptedAt null on purpose: the money is a fact, the
            // acceptance is not, and minting an acceptedAt would be minting a
            // record of a human act that never happened. Say which of the two
            // this row is.
            return quotation.acceptedAt
                ? { label: 'ออกใบแจ้งหนี้แล้ว', tone: 'bg-violet-100 text-violet-800' }
                : {
                    label: 'ออกใบแจ้งหนี้แล้ว (ชำระก่อนมีขั้นตอนยอมรับ)',
                    tone: 'bg-muted text-muted-foreground',
                };
        case 'REJECTED':
            return { label: 'ปฏิเสธ', tone: 'bg-rose-100 text-rose-800' };
        case 'EXPIRED':
            return { label: 'หมดอายุ', tone: 'bg-slate-200 text-slate-600' };
        default:
            return { label: 'รอการยอมรับ', tone: 'bg-amber-100 text-amber-800' };
    }
}

// The predicate that decides whether an accept button is drawn now lives beside
// the accepted-states one in payment-service (F-G4-64 review r0 minor 5): the
// pay entry on /health/payments points at this card, so it has to ask the same
// question this card answers rather than a lookalike of its own.

// A per-phase block: one row per cultivation type with its amount + a subtotal.
function PhaseBreakdown({
    heading,
    coverage,
    note,
    items,
    amountField,
}: {
    heading: string;
    /** What the service covers, from the server's catalogue (operator 2026-10-03). */
    coverage: string;
    note: string;
    items: QuotationLineItem[];
    amountField: 'phase1Amount' | 'phase2Amount';
}) {
    const subtotal = items.reduce((sum, it) => sum + toNumber(it[amountField]), 0);
    return (
        <div className="rounded-xl border border-slate-100 bg-card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{heading}</p>
                <p className="text-sm font-semibold text-foreground">{formatCurrency(subtotal)}</p>
            </div>
            <p className="mb-1 text-xs text-foreground">{coverage}</p>
            <p className="mb-2 text-[11px] text-muted-foreground">{note}</p>
            <ul className="space-y-1">
                {items.map((it) => (
                    <li key={`${it.method}-${amountField}`} className="flex justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">{it.label}</span>
                        <span className="whitespace-nowrap text-foreground">
                            {formatCurrency(it[amountField])}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function QuotationCard({
    applicationId,
    issuerType,
    quotation,
    lapsedNotice,
    services,
    onAccepted,
}: {
    applicationId: string;
    issuerType: QuotationIssuerType;
    quotation: QuotationRecord;
    /** The services this application's quotation sells; PHASE_1 null = a renewal. */
    services: QuotationServices;
    /*
      What to say when THIS application's offer window has closed. Decided by
      the section, because the answer depends on how many rows the application
      holds: the backend replaces a lapsed offer only for a single live row
      (_lapsedOfferToReplace, apps/backend/services/quotation-issuance-on-submit.js),
      and a card that saw only itself promised a replacement to pre-W14 pairs
      that never get one (fix round 1, reviewer MINOR).
    */
    lapsedNotice: string;
    onAccepted?: () => void;
}) {
    const [accepting, setAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QuotationStatus>(quotation.status);

    const meta = ISSUER_META[issuerType];
    // The card's own `status` wins over the row's: it holds what the accept
    // call just returned. Everything else on the pill comes from the row.
    const shown = { ...quotation, status };
    const pill = statusPill(shown);
    const lineItems = quotation.lineItems ?? [];
    const lapsed = isQuotationLapsed(shown);
    const isRenewal = services.PHASE_1 === null;

    async function handleAccept() {
        setError(null);
        setAccepting(true);
        try {
            const result = await PaymentService.acceptQuotation(applicationId, issuerType);
            if (result.ok) {
                setStatus(result.row.status);
                onAccepted?.();
                return;
            }
            // Final round R20 — say WHICH refusal, with the number that
            // identifies the document, instead of asking for a retry that two
            // of these three can never satisfy.
            setError(quotationAcceptFailureMessage(result.code, quotation.quotationNumber));
            if (result.code === 'INVALID_QUOTATION_STATUS') {
                // Somebody else moved the row on. Re-read it so the pill stops
                // describing a state the register left behind.
                const rows = await PaymentService.getQuotations(applicationId);
                const fresh = issuerType === 'DTAM' ? rows?.dtam : rows?.platform;
                if (fresh) { setStatus(fresh.status); }
            }
        } catch {
            setError(quotationAcceptFailureMessage(undefined, quotation.quotationNumber));
        } finally {
            setAccepting(false);
        }
    }

    async function handleViewPdf(phase: 1 | 2) {
        const ok = await PaymentService.viewQuotationPdf(applicationId, issuerType, phase);
        if (!ok) setError('ไม่สามารถเปิดเอกสาร PDF ได้ กรุณาลองใหม่อีกครั้ง');
    }

    return (
        <article className={`rounded-2xl border p-4 sm:p-5 ${meta.accent}`}>
            <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">{meta.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.subtitle}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                        เลขที่: {quotation.quotationNumber}
                    </p>
                    {/*
                        Final round R21 — the date the offer stands until. It is
                        not decoration: past it the acceptance door refuses the
                        row (markQuotationAccepted, QUOTATION_EXPIRED), so the
                        applicant is entitled to see the deadline on the screen
                        that asks for the acceptance. Same helper the staff
                        billing view uses (billing/client-view.tsx).
                    */}
                    {quotation.validUntil ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            ใช้ได้ถึง {formatThaiDate(quotation.validUntil)}
                        </p>
                    ) : null}
                </div>
                <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${pill.tone}`}>
                    {pill.label}
                </span>
            </header>

            {/*
                Coordinator ruling 12 — the row decides how many lines its
                document has; the application's current methods only name them.
                When the two disagree the applicant revised the form after this
                quotation was priced, so the card says so rather than letting
                the figures read as a description of today's form. The charge
                side is caught separately by the drift gate
                (CHECKOUT_PRICE_DRIFT); here the only honest next action is to
                ask staff, quoting the number that identifies this document.

                Review r2 minor 4: the notice no longer promises a NEW document.
                Nothing in the product can void and re-issue a quotation for a
                mismatched row — there is no quotation route under
                routes/api/admin or routes/api/provider and no staff screen for
                one — so the old ending named a function nobody has.
            */}
            {quotation.scopeMismatch ? (
                <p
                    role="status"
                    className="mb-3 rounded-lg border border-border bg-card p-3 text-xs text-foreground"
                >
                    เอกสารฉบับนี้ออกตามจำนวนรูปแบบการปลูกที่คำขอระบุไว้ในวันที่ออกใบ
                    ซึ่งต่างจากที่คำขอระบุอยู่ตอนนี้ ยอดในเอกสารจึงเป็นยอดที่ตรึงไว้ ณ วันออกใบ
                    หากต้องการให้ตรงกับคำขอปัจจุบัน กรุณาติดต่อเจ้าหน้าที่
                    พร้อมแจ้งเลขที่เอกสาร {quotation.quotationNumber}
                </p>
            ) : null}

            {lineItems.length > 0 ? (
                <div className="space-y-3">
                    {/* fix/fee-line-descriptions (operator 2026-10-03) — each
                        block is named, and says what it covers, in the server's
                        catalogue words (GET /quotations `copy.services`), the same
                        words the PDF prints. A renewal is one service: the server
                        sends no งวดที่ 1, so no งวดที่ 1 block is drawn. */}
                    {services.PHASE_1 ? (
                        <PhaseBreakdown
                            heading={services.PHASE_1.name}
                            coverage={services.PHASE_1.coverage}
                            note="ชำระเมื่อยอมรับใบเสนอราคา (ต่อระบบการเพาะปลูก)"
                            items={lineItems}
                            amountField="phase1Amount"
                        />
                    ) : null}
                    <PhaseBreakdown
                        heading={services.PHASE_2.name}
                        coverage={services.PHASE_2.coverage}
                        note={isRenewal
                            ? 'ชำระครั้งเดียว (ต่อระบบการเพาะปลูก)'
                            : 'ชำระเมื่อผ่านการตรวจประเมินหน้างาน (ต่อระบบการเพาะปลูก)'}
                        items={lineItems}
                        amountField="phase2Amount"
                    />
                </div>
            ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
                    ยังไม่มีรายการประเมินราคา กรุณาดูเอกสาร PDF เพื่อดูรายละเอียด
                </p>
            )}

            <div className="mt-3 flex items-center justify-between rounded-xl bg-card px-3 py-2">
                <span className="text-sm font-semibold text-foreground">{isRenewal ? 'รวมทั้งสิ้น' : 'รวมทั้งสิ้น (2 งวด)'}</span>
                <span className={`rounded-lg px-3 py-1 text-sm font-bold ${meta.chipBg}`}>
                    {formatCurrency(quotation.totalAmount)}
                </span>
            </div>

            {/*
                Final round R21 — the offer window closed on a row nobody
                accepted. The button below is gone (the door would answer 409),
                so the card has to say why, and name the act that replaces it.
                The system performs that act itself on this page's own GET
                (ensureQuotationForIssuedApplication); no staff surface can
                issue a quotation (ledger F-G4-71), so none is named.
            */}
            {lapsed ? (
                <p
                    role="status"
                    className="mt-3 rounded-lg border border-border bg-muted p-3 text-xs text-foreground"
                >
                    {lapsedNotice}
                </p>
            ) : null}

            {/*
                Final round R19 (C12) — the tick that IS the acceptance can fail,
                and focus stays on the (now unchecked) control, so without a live
                region a screen-reader user heard nothing at all.
            */}
            {error ? (
                <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {error}
                </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                    {/* A renewal prices PHASE_2 only; its phase-1 document is refused
                        (QUOTATION_PHASE_NOT_PRICED), so no button points at it. */}
                    {isRenewal ? null : (
                        <button
                            type="button"
                            onClick={() => void handleViewPdf(1)}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/80"
                        >
                            ดูเอกสาร งวดที่ 1
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void handleViewPdf(2)}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/80"
                    >
                        {isRenewal ? 'ดูเอกสาร' : 'ดูเอกสาร งวดที่ 2'}
                    </button>
                </div>

                {isQuotationAcceptable(shown) ? (
                    <button
                        type="button"
                        disabled={accepting}
                        onClick={() => void handleAccept()}
                        className={`inline-flex min-h-[44px] items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold text-white transition ${
                            accepting
                                ? 'cursor-not-allowed bg-leaf-300'
                                : 'bg-leaf-700 hover:bg-leaf-800'
                        }`}
                    >
                        {accepting ? 'กำลังยอมรับ…' : 'ยอมรับใบเสนอราคา'}
                    </button>
                ) : isQuotationAccepted(shown) ? (
                    <span className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-leaf-soft px-4 py-2 text-sm font-medium text-leaf-onSoft">
                        ✓ {pill.label}
                    </span>
                ) : (
                    // Final round R21 — a lapsed, rejected or expired row is not
                    // an achievement: the ✓ on a leaf-green chip read as "done"
                    // over the word เกินกำหนดยืนราคา.
                    <span className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
                        {pill.label}
                    </span>
                )}
            </div>
        </article>
    );
}

export default function QuotationReviewSection({
    applicationId,
    onAccepted,
    quotations,
    lapsedSurface = 'payments-list',
}: QuotationReviewSectionProps) {
    // `undefined` is the only value that means "no parent answer is coming".
    const parentOwnsData = quotations !== undefined;
    const [fetched, setFetched] = useState<QuotationsBySide | null>(null);
    const [selfLoading, setSelfLoading] = useState(!parentOwnsData);

    const load = useCallback(async () => {
        if (parentOwnsData) return;
        if (!applicationId) {
            setSelfLoading(false);
            return;
        }
        setSelfLoading(true);
        try {
            // `null` = the lookup failed. This panel hides itself when it has no
            // rows to show, which is what it already did for that case; the
            // page's own pay entry is where a failed lookup is named.
            setFetched((await PaymentService.getQuotations(applicationId)) ?? { dtam: null, platform: null });
        } catch {
            setFetched({ dtam: null, platform: null });
        } finally {
            setSelfLoading(false);
        }
    }, [applicationId, parentOwnsData]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await load();
            if (cancelled) return;
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    const dtam = (parentOwnsData ? quotations?.dtam : fetched?.dtam) ?? null;
    const platform = (parentOwnsData ? quotations?.platform : fetched?.platform) ?? null;
    const loading = parentOwnsData ? quotations === null : selfLoading;
    const services = quotationServicesOrFallback((parentOwnsData ? quotations : fetched)?.copy?.services);

    function handleAccepted() {
        // Re-fetch so the pills/buttons reflect the new ACCEPTED state, then
        // bubble up so the parent refreshes the (now-unlocked) invoices. When
        // the parent owns the data, its own refresh is that re-fetch.
        void load();
        onAccepted?.();
    }

    // No quotation issued yet (e.g. application not SUBMITTED) — hide the panel.
    if (!loading && !dtam && !platform) return null;

    // F-G4-55: while the fetch is in flight we do not yet know whether a
    // quotation exists at all, so the panel may not instruct anyone to accept
    // one. On a CERTIFIED application the old loading header told the farmer to
    // accept a quotation before paying phase 1 above two empty grey boxes
    // (evidence/g4-rebuild-2026-08-25/c02-b/C02-01-payments-after-repair.png).
    // A loading state says only that it is loading.
    if (loading) {
        return (
            <section
                data-testid="quotation-review-section"
                aria-busy="true"
                className={SECTION_CLASS}
            >
                {/* Two grey boxes on their own look like an empty panel. The
                    wait is named on screen, not only to a screen reader. */}
                <p className="mb-3 text-sm text-muted-foreground">กำลังโหลดใบเสนอราคา</p>
                <div className="space-y-3">
                    <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
                    <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
                </div>
            </section>
        );
    }

    // The instruction asks for an action, so it may only appear while that
    // action is still open. On a CERTIFIED application both quotations are long
    // ACCEPTED/INVOICED and telling the farmer to accept one before paying
    // งวดที่ 1 describes a step that no longer exists. The h2 stays either way:
    // it names the panel, it does not ask for anything.
    const somethingToAccept = isQuotationAcceptable(dtam) || isQuotationAcceptable(platform);
    // One answer for the whole application, handed to both cards: whether a
    // replacement is really issued depends on how many rows the application
    // holds, which a single card cannot see (fix round 1).
    const lapsedNotice = quotationLapsedNoticeTh({ dtam, platform }, lapsedSurface);

    return (
        <section data-testid="quotation-review-section" className={SECTION_CLASS}>
            <header className="mb-4">
                <h2 className="text-lg font-semibold text-foreground">ใบเสนอราคา (Quotation)</h2>
                {somethingToAccept ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        กรุณาตรวจสอบรายละเอียดค่าบริการ แล้ว<strong>ยอมรับใบเสนอราคา</strong>{services.PHASE_1 ? 'ก่อนชำระเงินงวดที่ 1' : 'ก่อนชำระเงิน'}
                    </p>
                ) : null}
            </header>

            <div className="space-y-4">
                {dtam ? (
                    <QuotationCard
                        // Review follow-up (post-approval, fix/checkout-ux) —
                        // QuotationCard owns `status` in its own useState,
                        // which does not re-run on a prop change. Without an
                        // identity key, switching `quotationApplicationId`
                        // (client-view.tsx: ?app= or the resolved active
                        // application) re-renders this section with a
                        // DIFFERENT quotation in the SAME tree position, and
                        // the card kept the PREVIOUS application's status.
                        // `quotation.id` is a real row id, so a different
                        // document always forces a fresh instance; the SAME
                        // document across renders (e.g. just-accepted, prop
                        // still catching up) keeps the same key and keeps the
                        // card's optimistic local state — the fix this
                        // follow-up sits next to (client-view.tsx's
                        // `!loading` mount gate) depends on that staying true.
                        key={dtam.id}
                        applicationId={applicationId}
                        issuerType="DTAM"
                        quotation={dtam}
                        lapsedNotice={lapsedNotice}
                        services={services}
                        onAccepted={handleAccepted}
                    />
                ) : null}
                {platform ? (
                    <QuotationCard
                        key={platform.id}
                        applicationId={applicationId}
                        issuerType="PLATFORM"
                        quotation={platform}
                        lapsedNotice={lapsedNotice}
                        services={services}
                        onAccepted={handleAccepted}
                    />
                ) : null}
            </div>
        </section>
    );
}
