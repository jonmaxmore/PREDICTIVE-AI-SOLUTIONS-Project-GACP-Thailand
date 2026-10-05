/**
 * The fee table as GET /api/pricing/fees serves it, and nothing else.
 *
 * The amount the platform bills comes from the fee engine's table in
 * apps/backend/config/business-rules.js (SystemConfig fee.* rows are not
 * applied: loader unwired, operator ruling 2026-10-03); GET /api/pricing/fees
 * serves it from the same engine that writes the invoices
 * (routes/api/finance/pricing.js). Server pages cache it up to 300 s.
 * Every price on the web reads this response. There is no local copy to fall
 * back on: when the response cannot be read, a screen shows FEES_UNAVAILABLE_TH
 * and no number, because a remembered price is the one that goes stale the day
 * the operator changes a fee (operator 2026-10-03, "ต้องปิดก่อนเปิดใช้จริง").
 *
 * No arithmetic on rates happens here. Totals are the server's; the VAT part of
 * a line is its served total minus its served ค่าบริการ.
 */

import { parseFeeServices, type FeeServiceCatalogue } from './fee-services';

export const PRICING_FEES_PATH = '/api/pricing/fees';

/** Shown in place of any amount when the served fees cannot be read. */
export const FEES_UNAVAILABLE_TH =
    'ไม่สามารถแสดงอัตราค่าบริการได้ในขณะนี้ ดูอัตราค่าบริการล่าสุดได้ที่ใบเสนอราคาในระบบ';

/** Shown in place of an amount while the request is in flight. */
export const FEES_LOADING_TH = 'กำลังโหลดอัตราค่าบริการ';

/** One cultivation scope, as served. All amounts in THB. */
export interface PublicFees {
    /** ค่าบริการงวดที่ 1 ก่อน VAT */
    applicationFee: number;
    /** ค่าบริการงวดที่ 2 ก่อน VAT */
    inspectionFee: number;
    /** ค่าบริการต่ออายุ ก่อน VAT: the base, never shown alone */
    renewalFee: number;
    /** ยอดงวดที่ 1 รวม VAT */
    phase1TotalPerScope: number;
    /** ยอดงวดที่ 2 รวม VAT */
    phase2TotalPerScope: number;
    /** ยอดต่ออายุรวม VAT */
    renewalTotalPerScope: number;
    /** e.g. 0.07 */
    vatRate: number;
    /**
     * What each charge is called and covers (fix/fee-line-descriptions). null when
     * the server sent none (an older backend): a screen then uses
     * FEE_SERVICES_FALLBACK. Words only — never a reason to refuse the amounts.
     */
    services?: FeeServiceCatalogue | null;
}

export type FeesState =
    | { status: 'loading' }
    | { status: 'ready'; fees: PublicFees }
    | { status: 'unavailable' };

const AMOUNT_KEYS = [
    'applicationFee',
    'inspectionFee',
    'renewalFee',
    'phase1TotalPerScope',
    'phase2TotalPerScope',
    'renewalTotalPerScope',
] as const;

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The served payload, or null when any figure a screen prints is missing or not
 * a positive number. A partial answer is treated as no answer: printing the
 * half that arrived beside a gap would state a price nobody verified.
 */
export function parsePublicFees(data: unknown): PublicFees | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    for (const key of AMOUNT_KEYS) {
        if (!isAmount(d[key])) return null;
    }
    const vatRate = d.vatRate;
    if (typeof vatRate !== 'number' || !Number.isFinite(vatRate) || vatRate < 0 || vatRate >= 1) return null;
    return {
        applicationFee: d.applicationFee as number,
        inspectionFee: d.inspectionFee as number,
        renewalFee: d.renewalFee as number,
        phase1TotalPerScope: d.phase1TotalPerScope as number,
        phase2TotalPerScope: d.phase2TotalPerScope as number,
        renewalTotalPerScope: d.renewalTotalPerScope as number,
        vatRate,
        services: parseFeeServices(d.services),
    };
}

/** "6,420" — whole baht, Thai grouping. */
export const formatBaht = (value: number): string => Math.round(value).toLocaleString('th-TH');

/** "7%" from the served rate. */
export const vatPercentLabel = (fees: PublicFees): string => `${Math.round(fees.vatRate * 100)}%`;

/** The line's VAT as served: its total minus its ค่าบริการ. */
export const servedVatPart = (serviceFee: number, total: number): number => total - serviceFee;

/** The text to show where an amount would be, when there is none. */
export function feesNotice(state: FeesState): string {
    return state.status === 'loading' ? FEES_LOADING_TH : FEES_UNAVAILABLE_TH;
}
