'use strict';

/**
 * product-detail-builder.js — "รายละเอียดสินค้า" block for the financial
 * documents (ใบเสนอราคา / ใบวางบิล / ใบเสร็จ).
 *
 * Owner request 2026-06-25: the quotation, invoice and receipt should describe
 * WHAT is being certified — not just "ค่าตรวจเอกสาร GACP". This module turns an
 * Application's product data (plant, cultivation systems, plots, farm) into a
 * compact set of detail lines that each template renders under the line-item
 * description. Pure (no DB / I/O) — unit-testable.
 */

// Pilot crops — keep in sync with the FE PLANT_LABELS (application-detail-page-config.ts)
// and seed-plants.js thaiName. plantId may carry a -NNN suffix (e.g. CANNABIS-001).
const PLANT_LABELS_TH = Object.freeze({
    cannabis: 'กัญชา',
    kratom: 'กระท่อม',
    turmeric: 'ขมิ้นชัน',
    ginger: 'ขิง',
    black_galangal: 'กระชายดำ',
    plai: 'ไพล',
});

// Same normalized keys as fee-service.collectUniqueCultivationMethods.
//
// 2026-09-07 — this was a THIRD private copy of the cultivation labels, named _TH while
// holding English-first values ('Outdoor (กลางแจ้ง)') — the name lied about the words.
// The label vocabulary lives in quotation-line-items.js (labelForMethod, Thai-first per
// the operator's wording ruling); this file borrows it instead of keeping its own.
const { labelForMethod: cultivationLabelForMethod } = require('../quotation-line-items');

// fix/fee-line-descriptions (operator 2026-10-03): this block used to open with its own
// phase label ("งวดที่ 1 · ..."), a second name for a charge the line above it already
// names. It now opens with what the service COVERS, read from the one catalogue
// (shared/instalment-service-names.js), renewal-aware — a renewal is its own service.
const { serviceFor, isRenewalFiling } = require('../../shared/instalment-service-names');

function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function plantLabel(plantId) {
    const raw = String(plantId || '').trim();
    if (!raw) { return '-'; }
    const key = raw.toLowerCase().replace(/-\d+$/, ''); // CANNABIS-001 -> cannabis
    return PLANT_LABELS_TH[key] || raw;
}

function cultivationLabels(methods) {
    if (!Array.isArray(methods)) { return []; }
    const seen = new Set();
    const out = [];
    for (const m of methods) {
        const key = String(m || '').trim().toUpperCase();
        if (!key || seen.has(key)) { continue; }
        seen.add(key);
        out.push(cultivationLabelForMethod(key));
    }
    return out;
}

function resolvePhase(input) {
    const s = String(input || '').toUpperCase();
    // The serviceType checkout mints (stripe-checkout-service checkoutInvoiceServiceType):
    // CERTIFICATION_CHECKOUT_M1 / _M2. Neither matched below, so a real invoice printed
    // no instalment detail at all.
    const checkout = /CHECKOUT_M([12])$/.exec(s);
    if (checkout) { return `PHASE_${checkout[1]}`; }
    if (s.includes('PHASE_2') || s.includes('PHASE2') || s.includes('AUDIT')) { return 'PHASE_2'; }
    if (s.includes('PHASE_1') || s.includes('PHASE1') || s.includes('APPLICATION') || s.includes('DOC')) { return 'PHASE_1'; }
    return null;
}

/**
 * Build the "รายละเอียดสินค้า" detail lines for one application + phase.
 *
 * @param {object} application  Prisma Application (with `formData`, `applicationNumber`)
 * @param {object} [opts]
 * @param {string} [opts.phase]      'PHASE_1'|'PHASE_2' or a serviceType string
 * @param {number} [opts.scopeCount] number of cultivation scopes billed
 * @param {number} [opts.perScope]   state fee per scope (for the "ระบบละ X" line)
 * @param {boolean} [opts.coverage]  false = omit the coverage line (the caller prints it)
 * @returns {string[]} plain-text label lines (caller escapes + renders)
 */
function buildProductDetailLines(application, opts = {}) {
    const app = asRecord(application);
    const fd = asRecord(app.formData);
    const farmData = asRecord(fd.farmData || fd.siteData);
    const lines = [];

    const phase = resolvePhase(opts.phase);
    if (phase && opts.coverage !== false) {
        lines.push(serviceFor(phase, { isRenewal: isRenewalFiling(app) }).coverage);
    }

    const plant = plantLabel(fd.plantId || fd.plantName);
    if (plant && plant !== '-') {
        lines.push(`พืชที่ขอรับรอง: ${plant}`);
    }

    // The quotation already lists ONE row per cultivation system, so it passes
    // compact:true to skip the systems summary + the per-scope money line (which
    // its rows + grand total already convey). The single-line invoice/receipt
    // needs the full block.
    const systems = cultivationLabels(fd.cultivationMethods);
    if (!opts.compact && systems.length) {
        lines.push(`ระบบปลูก: ${systems.join(', ')} (${systems.length} ระบบ)`);
    }

    const appNo = app.applicationNumber || app.id;
    if (appNo) {
        lines.push(`คำขอเลขที่: ${appNo}`);
    }

    const farmName = farmData.farmName || farmData.siteName;
    const plots = Array.isArray(fd.plots) ? fd.plots : (Array.isArray(farmData.plots) ? farmData.plots : []);
    const plotNames = plots.map((p) => asRecord(p).name).filter(Boolean);
    if (farmName || plotNames.length) {
        const parts = [];
        if (farmName) { parts.push(`ฟาร์ม: ${farmName}`); }
        if (plotNames.length) { parts.push(`แปลง: ${plotNames.join(', ')}`); }
        lines.push(parts.join(' · '));
    }

    if (!opts.compact) {
        const scope = Number(opts.scopeCount) > 0 ? Math.floor(Number(opts.scopeCount)) : (systems.length || null);
        const perScope = Number(opts.perScope) > 0 ? Number(opts.perScope) : null;
        if (scope && perScope) {
            const total = scope * perScope;
            lines.push(`จำนวน ${scope} ระบบ · ระบบละ ${perScope.toLocaleString('en-US')} · รวม ${total.toLocaleString('en-US')} บาท`);
        } else if (scope) {
            lines.push(`จำนวน ${scope} ระบบปลูก`);
        }
    }

    return lines;
}

module.exports = {
    buildProductDetailLines,
    resolvePhase,
    plantLabel,
    cultivationLabels,
    PLANT_LABELS_TH,
};
