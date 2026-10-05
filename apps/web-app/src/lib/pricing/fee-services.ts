/**
 * What each charge is called and what it covers — as the SERVER says.
 *
 * Operator ruling 2026-10-03: one service fee, never split into a DTAM part and a
 * platform part, and every document and screen names each line the same way and
 * states what it covers. The catalogue lives in the backend
 * (apps/backend/shared/instalment-service-names.js) and is served by
 * GET /api/pricing/fees `services` and GET /applications/:id/quotations
 * `copy.services`. Screens read those.
 *
 * FEE_SERVICES_FALLBACK is the web's ONE copy, for the moments the server cannot
 * be read (a marketing page while the backend is down, status and button labels
 * that have no server answer at hand). It is a JSON file so the backend suite can
 * compare it to the catalogue field for field, and this module is the only web
 * source allowed to hand its words to a screen: every other web file imports
 * SERVICE_NAME / SERVICE_NOUN / FEE_SERVICES_FALLBACK from here.
 * apps/backend/__tests__/unit/fee-service-catalogue-web-mirror.test.js scans web
 * and mobile sources and fails on any catalogue name, noun or coverage spelled
 * anywhere else (round 5 — the earlier version of this comment claimed that while
 * ~20 files spelled the names).
 */

import catalogue from '@/constants/fee-service-catalogue.json';

export interface FeeService {
    name: string;
    nameEn: string;
    coverage: string;
    coverageEn: string;
}

export interface FeeVatLine {
    name: string;
    nameEn: string;
}

export interface FeeServiceCatalogue {
    PHASE_1: FeeService;
    PHASE_2: FeeService;
    RENEWAL: FeeService;
    /** Absent from the fallback: its wording carries the served rate. */
    VAT?: FeeVatLine;
}

/** The services of ONE application's quotation: a renewal has no งวดที่ 1. */
export interface QuotationServices {
    PHASE_1: FeeService | null;
    PHASE_2: FeeService;
    VAT?: FeeVatLine;
}

export const FEE_SERVICES_FALLBACK: FeeServiceCatalogue = catalogue;

/** The catalogue name of each service ("งวดที่ 1 ค่าบริการตรวจสอบเอกสาร", ...). */
export const SERVICE_NAME = Object.freeze({
    PHASE_1: FEE_SERVICES_FALLBACK.PHASE_1.name,
    PHASE_2: FEE_SERVICES_FALLBACK.PHASE_2.name,
    RENEWAL: FEE_SERVICES_FALLBACK.RENEWAL.name,
});

/**
 * The name without its "งวดที่ N " prefix — the only permitted short form
 * (operator 2026-10-03: shorten by dropping the instalment, never a new noun).
 */
const nounOf = (name: string) => name.replace(/^งวดที่ \d+ /, '');
export const SERVICE_NOUN = Object.freeze({
    PHASE_1: nounOf(SERVICE_NAME.PHASE_1),
    PHASE_2: nounOf(SERVICE_NAME.PHASE_2),
    RENEWAL: nounOf(SERVICE_NAME.RENEWAL),
});

/** The service a register row bills, as GET /invoices/my sends it (`service`). */
export interface RowService {
    key: 'PHASE_1' | 'PHASE_2' | 'RENEWAL';
    name: string;
    coverage: string;
}

/** A served `service` value, or null when absent/malformed. */
export function parseRowService(v: unknown): RowService | null {
    if (!v || typeof v !== 'object') return null;
    const d = v as Record<string, unknown>;
    const key = d.key;
    if (key !== 'PHASE_1' && key !== 'PHASE_2' && key !== 'RENEWAL') return null;
    if (!isText(d.name)) return null;
    return { key, name: d.name, coverage: isText(d.coverage) ? d.coverage : '' };
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function parseService(v: unknown): FeeService | null {
    if (!v || typeof v !== 'object') return null;
    const d = v as Record<string, unknown>;
    if (!isText(d.name) || !isText(d.nameEn) || !isText(d.coverage) || !isText(d.coverageEn)) return null;
    return { name: d.name, nameEn: d.nameEn, coverage: d.coverage, coverageEn: d.coverageEn };
}

function parseVat(v: unknown): FeeVatLine | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const d = v as Record<string, unknown>;
    return isText(d.name) && isText(d.nameEn) ? { name: d.name, nameEn: d.nameEn } : undefined;
}

/** The served catalogue, or null when any entry is missing (then use the fallback). */
export function parseFeeServices(data: unknown): FeeServiceCatalogue | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    const p1 = parseService(d.PHASE_1);
    const p2 = parseService(d.PHASE_2);
    const rn = parseService(d.RENEWAL);
    if (!p1 || !p2 || !rn) return null;
    const vat = parseVat(d.VAT);
    return { PHASE_1: p1, PHASE_2: p2, RENEWAL: rn, ...(vat ? { VAT: vat } : {}) };
}

/** A quotation's services as served, or the new-filing fallback when none came. */
export function quotationServicesOrFallback(data: unknown): QuotationServices {
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        const p2 = parseService(d.PHASE_2);
        if (p2) {
            const vat = parseVat(d.VAT);
            return { PHASE_1: d.PHASE_1 === null ? null : parseService(d.PHASE_1), PHASE_2: p2, ...(vat ? { VAT: vat } : {}) };
        }
    }
    return { PHASE_1: FEE_SERVICES_FALLBACK.PHASE_1, PHASE_2: FEE_SERVICES_FALLBACK.PHASE_2 };
}
