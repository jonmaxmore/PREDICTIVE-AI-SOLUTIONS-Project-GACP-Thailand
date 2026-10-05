/**
 * Application Quotation Routes — Tier 18 / B18-A (2026-05-16)
 *
 * Endpoints:
 *   GET    /api/applications/:applicationId/quotations
 *   GET    /api/applications/:applicationId/quotations/:issuerType/pdf
 *   POST   /api/applications/:applicationId/quotations/:issuerType/accept
 *
 * Two-issuer billing model (B16-A confirmed by owner):
 *   - DTAM     → state fee, VAT-exempt (ม.77/1 (10) ป.รัษฎากร)
 *   - PLATFORM → platform fee + VAT 7% (ม.86/4 ป.รัษฎากร)
 *
 * Role gating:
 *   - health applicant — their own application only
 *   - staff            — only QUOTATION_STAFF_READ_ROLES: both finance roles + both admin
 *     roles (operator 2026-09-27: "ปิด เห็นได้เฉพาะผู้ยื่น+การเงิน+แอดมิน")
 *
 * Accept route is applicant-only — the platform/state accountants don't
 * accept quotations on the applicant's behalf.
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const {
    authenticateAny,
    authenticateHealth,
} = require('../../../middleware/auth-middleware');
// ชุดบทบาทเจ้าหน้าที่สร้างจาก CANONICAL_ROLES ของตัวกลาง ไม่เขียนคำเองในไฟล์นี้ — ไฟล์นี้เคยมีฉบับ
// ของตัวเองที่เขียนคำเก่าไว้ตรง ๆ ('admin' · 'account' · 'account_dtam' · 'account_platform') ⇒
// หลังเปลี่ยนคำศัพท์ 2026-09-10 ฝ่ายบัญชีถูกปฏิเสธด้วย 403 ทั้งที่ประตูกลางอนุญาต
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const logger = require('../../../shared/logger');
const quotationService = require('../../../services/quotation-service');
const applicationService = require('../../../services/application-service');
const { holderScope, assertHolderCapability } = require('../../../services/holder-access');
const { entityPermissionDeniedBody } = require('../../../shared/entity-permission-denied');
const { ISSUER_TYPES } = require('../../../config/invoice-issuers');
const invoiceTemplateService = require('../../../services/pdf/invoice-template-service');
const { collectUniqueCultivationMethods } = require('../../../modules/billing');
const {
    buildQuotationLineItemsFromRow, resolveRowScopes,
} = require('../../../services/quotation-line-items');
const { getMessage, lookup } = require('../../../shared/error-codes');
// The payer block's one source (operator rule 2026-09-27): what it needs from
// the application (formData + entity, never thaiCitizenId) and the block the
// web renders verbatim.
const { PAYER_APPLICATION_SELECT, payerBlockForApi } = require('../../../utils/applicant-resolver');

/**
 * The HTTP status a catalogued refusal answers with. Reading it here keeps the
 * route from re-declaring a status the catalogue already owns; an uncatalogued
 * code can only mean a server-side defect, so it answers 500.
 */
function catalogueStatus(code) {
    return lookup(code)?.httpStatus || 500;
}

// ── Role helpers ────────────────────────────────────────────────────────────

/**
 * Staff roles admitted at both quotation doors — everyone else (besides the owning
 * applicant) is refused before the self-heal write. operator 2026-09-27:
 * "ปิด เห็นได้เฉพาะผู้ยื่น+การเงิน+แอดมิน" — a quotation is prices and line items.
 * No provider screen calls these doors (every web caller is under /health).
 */
const QUOTATION_STAFF_READ_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
]);

/**
 * Resolve which issuer side(s) the authenticated user is allowed to see.
 *   - HEALTH applicant     → both (but ownership-gated later)
 *   - ADMIN                → both
 * ── ผู้ออกเอกสารรายเดียว และ **ฝ่ายการเงินทั้งสองฝั่งเห็นเหมือนกัน** ───────────
 *
 * operator 2026-09-11: *"finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอด
 * ต้องเท่ากัน เพื่อแสดงความโปร่งใส คือทั้งคู่จะเห็น เป็นรูปแบบ billing ที่จะเห็น
 * transaction, status ต่าง ๆ หมายเลขคำขอ เลขจ่ายเงิน หรืออะไรที่ต้องมีที่บัญชี
 * หรือระบบ billing ต้องมี"*
 *
 * เดิมฟังก์ชันนี้ตอบว่าบทบาทไหนเห็นเอกสารของ "ฝั่ง" ใด: บัญชีกรมเห็นฝั่งกรม บัญชีบริษัท
 * เห็นฝั่งบริษัท · ทั้งสองอย่างที่ทำให้ด่านนี้มีเหตุผลหายไปพร้อมกัน — ไม่มีสองฝั่งแล้ว
 * และ operator สั่งว่าให้เห็นตรงกันเพื่อกระทบยอดกันได้
 *
 * มตินี้ **กลับ** มติ 2026-09-05 ข้อ D3 ("กรมดูตัวเลขของตัวเองได้ แต่ไม่เห็นค่าบริการ
 * ของบริษัท") ซึ่งตั้งอยู่บนสมมติฐานว่ามีเงินสองก้อน · เมื่อเหลือก้อนเดียว การซ่อนมัน
 * จากฝั่งหนึ่งแปลว่าฝั่งนั้นกระทบยอดไม่ได้เลย ซึ่งตรงข้ามกับเหตุผลที่แยกไว้แต่แรก
 *
 * เหลือไว้เป็นด่าน **ว่าบทบาทนี้เป็นเจ้าหน้าที่หรือไม่** เท่านั้น
 */
function resolveAllowedIssuerSides(user) {
    const role = normalizeRole(user?.canonicalRole || user?.role || '');
    if (!role) { return null; }
    return new Set([ISSUER_TYPES.PLATFORM]);
}

/**
 * Applicant ownership check — applicant may only act on quotations
 * attached to their own application (matched on application.healthId).
 * Returns true when allowed, false otherwise.
 */
/**
 * เจ้าของคำขอ — ใช้ตัวตัดสินเดียวกับทุกประตูของเกษตรกร
 *
 * เดิมประตูนี้เขียนกติกาของตัวเอง โดยเทียบ `application.healthId` กับ
 * `req.user.canonicalId` · วัดจริงบน demo 2026-09-07 ด้วยโทเคนใบเดียวกัน คำขอใบเดียวกัน:
 *     200  /applications/:id · /requirements · /statement
 *     404  /applications/:id/quotations
 * สามประตูแรกถามผ่าน findOwnedApplicationForApplicant ซึ่งเทียบด้วยความสัมพันธ์
 * applicant → User.id · หัวข้อของฟังก์ชันนั้นอธิบายไว้เองว่าทำไมวิธี healthId ใช้ไม่ได้:
 * "User.id is a non-encrypted UUID FK that survives PDPA field encryption, whereas
 *  healthId may be redacted at the column level depending on tenant"
 *
 * ผลของการมีสองกติกา: บนผู้เช่าที่ redact คอลัมน์นั้น เจ้าของตัวจริงถูกตอบว่าไม่พบใบเสนอราคา
 * และนี่คือประตูที่กั้นการจ่ายเงิน — เปิดใบเสนอราคาไม่ได้ ก็ยอมรับราคาไม่ได้ จ่ายไม่ได้
 * คำขอค้างถาวรโดยไม่มีใครรู้ว่าเพราะอะไร
 */
//
// Spec 2026-09-30 §3.1 (R2 Task 12): the application is read within the
// caller's holder scope alone (holderScope, called here inside the handler):
// any ACTIVE member of its holder reads its quotations. Accepting one is an
// act for the holder and is gated separately (SUBMIT_APPLICATION, below).
async function readableApplication(applicationId, req) {
    const userId = String(req?.user?.id || '').trim();
    if (!applicationId || !userId) { return null; }
    const owned = await applicationService.findOwnedApplicationForApplicant(applicationId, {
        holderScope: await holderScope(req),
    });
    return owned && !owned.isDeleted ? owned : null;
}

async function isApplicantOwnerOfApplication(applicationId, req) {
    return Boolean(await readableApplication(applicationId, req));
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/applications/:applicationId/quotations
 *
 * Returns both DTAM + PLATFORM quotations for the application, filtered to
 * the caller's allowed issuer sides. HEALTH applicants are ownership-gated;
 * staff must be in QUOTATION_STAFF_READ_ROLES (finance + admin) and see any
 * application.
 */
router.get('/', authenticateAny, async (req, res) => {
    try {
        const { applicationId } = req.params;
        if (!applicationId) {
            return res.status(400).json({
                success: false, error: 'applicationId is required',
            });
        }

        const role = normalizeRole(req.user?.canonicalRole || req.user?.role || '');
        const allowedSides = resolveAllowedIssuerSides(req.user);
        if (!allowedSides) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        // HEALTH applicants — ownership gate. Finance + admin staff skip
        // ownership because they work across applications; every other
        // staff role is refused here, before the self-heal write below.
        // The applicant's reads below carry the holder scope (spec 2026-09-30
        // §3.1); finance and admin staff read as before (no scope).
        let applicantScope = null;
        if (role === 'health') {
            const owns = await isApplicantOwnerOfApplication(applicationId, req);
            if (!owns) {
                // Generic 404 — don't leak existence to non-owners.
                return res.status(404).json({
                    success: false, error: 'Quotations not found',
                });
            }
            applicantScope = await holderScope(req);
        } else if (!QUOTATION_STAFF_READ_ROLES.has(role)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        // The application slice is needed for the labels anyway; read it first
        // so the self-heal can see the status. ONE read serves both — the
        // labels below and the past-DRAFT test inside the self-heal.
        const app = await applicationService.getApplicationSlice(applicationId, {
            select: {
                id: true, status: true, applicationNumber: true, organizationId: true,
                cultivationScopeCount: true, totalAreaTypes: true,
                ...PAYER_APPLICATION_SELECT,
            },
            ...(applicantScope ? { holderScope: applicantScope } : {}),
        });
        // F-G4-64 R3 — this door is where an applicant whose issuance failed at
        // submit gets a quotation at all, which is what makes the "กดรีเฟรช" in
        // QUOTATION_NOT_ISSUED's copy true. Narrow and idempotent: past DRAFT,
        // no row. It never fails the read.
        const { ensureQuotationForIssuedApplication } =
            require('../../../services/quotation-issuance-on-submit');
        const { platform } = await ensureQuotationForIssuedApplication({
            application: { id: applicationId, ...(app || {}) },
            actorId: req.user?.id || null,
            actorRole: req.user?.canonicalRole || req.user?.role || null,
            ...(applicantScope ? { holderScope: applicantScope } : {}),
        });

        // F-G4-64 — render the ROW, not the current rate table. The previous
        // code called calculateApplicationFees here, so an application quoted
        // before a rate change was SHOWN the new price while the row held the
        // old one, against docs/legal/payment-terms-th-v1.2.md §3.4 (the
        // accepted quotation's price binds every instalment; v1.1 said "ล็อกราคา
        // ณ วันยื่นคำขอ"). `methods` is still read from the application because it
        // is a label, not a price.
        const methods = collectUniqueCultivationMethods(app?.formData || {});
        // Ruling 12 — the row decides how many lines its document has; the
        // application's current methods only name them. When the counts
        // disagree the applicant revised the form after this quotation was
        // priced, so the response SAYS so (the lines stay the row's, named
        // generically) instead of quietly repricing to today's methods.
        const withLineItems = (row) => {
            if (!row) { return null; }
            const { scopeMismatch, applicationScopeCount } = resolveRowScopes(row, methods);
            return {
                ...row,
                lineItems: buildQuotationLineItemsFromRow(row, methods),
                scopeMismatch,
                applicationScopeCount,
            };
        };

        // ช่อง `dtam` ถูกถอด 2026-09-11 — ไม่มีเอกสารในนามกรมอีกแล้ว
        //
        // `payer` + `signatory` (payer-block-by-type, operator rule 2026-09-27):
        // the web quotation prints what the server resolved — the same resolver
        // and issuer config the PDF uses — instead of building the block from
        // wizard state (which printed an individual's national ID, L-089) and a
        // hardcoded signatory (L-091). Same door, same readers: owner, finance,
        // admin (the ownership/role gate above is unchanged).
        const data = {
            // the backlog ~line 611 — the checkout screen had no source
            // for the human-facing application number and fell back to the
            // raw UUID from the URL under "เลขคำขอ". `app` above already
            // selects `applicationNumber` (for the payer/copy blocks); this
            // is that same read put on the wire, not a second query.
            applicationNumber: app?.applicationNumber ?? null,
            platform: allowedSides.has(ISSUER_TYPES.PLATFORM) ? withLineItems(platform) : null,
            payer: app ? payerBlockForApi(app) : null,
            signatory: invoiceTemplateService.buildQuotationSignatory(),
            // `issuer` + `copy` (fix/web-quotation-truth, operator-approved
            // 2026-09-28): the company header and the paragraph/payment wording
            // the PDF prints, from the same builders — the web used to print the
            // retired ministry header and a hardcoded "พืชกัญชา".
            issuer: invoiceTemplateService.buildQuotationIssuer(),
            copy: invoiceTemplateService.buildQuotationCopy(app || {}),
        };
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Quotations] list error:', error?.message || error);
        return res.status(500).json({
            success: false, error: 'Failed to fetch quotations',
        });
    }
});

/**
 * GET /api/applications/:applicationId/quotations/:issuerType/pdf
 *
 * Renders the quotation PDF for one issuer side. Reuses
 * invoice-template-service.generateQuotationPdf which already enforces
 * INVALID_ISSUER_SIDE if `issuerSide` is missing — we surface that
 * error code to the client so the issue is debuggable.
 *
 * The PDF generator currently takes `{ application, phase, issuerSide }`
 * rather than the DB quotation row, so we fan out the existing
 * installments to render the canonical two-phase document. (Generating
 * one PDF per phase is the next refactor — out of scope for B18-A.)
 */
router.get('/:issuerType/pdf', authenticateAny, async (req, res) => {
    try {
        const { applicationId, issuerType } = req.params;
        const upper = String(issuerType || '').toUpperCase();
        if (upper !== ISSUER_TYPES.PLATFORM) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ISSUER_TYPE',
                message: `issuerType must be one of: ${Object.values(ISSUER_TYPES).join(', ')}`,
            });
        }

        const role = normalizeRole(req.user?.canonicalRole || req.user?.role || '');
        const allowedSides = resolveAllowedIssuerSides(req.user);
        if (!allowedSides || !allowedSides.has(upper)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        let applicantScope = null;
        if (role === 'health') {
            const owns = await isApplicantOwnerOfApplication(applicationId, req);
            if (!owns) {
                return res.status(404).json({ success: false, error: 'Quotation not found' });
            }
            applicantScope = await holderScope(req);
        } else if (!QUOTATION_STAFF_READ_ROLES.has(role)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        const scoped = applicantScope ? { holderScope: applicantScope } : {};

        // Confirm the quotation row exists & matches the side requested.
        const { platform } = await quotationService
            .findQuotationsByApplicationId(applicationId, scoped);
        const row = platform;
        if (!row) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        // W14 (2026-08-22) — เอกสารในนามกรมฯ ถูกยกเลิกไปพร้อมโมเดลผู้ออกสองราย · แถวที่ออก
        // *ก่อน* มติยังเปิดดูได้ตามเดิม (staging ถือไว้ 16 ใบ และ VAT = 0 บนใบเหล่านั้น
        // ถูกต้องตามกฎหมาย ณ เวลานั้น) แต่แถวฝั่งกรมฯ ที่เกิดหลังมติ ไม่มีทางถูกต้อง —
        // ไม่มีอะไรสร้างมันวันนี้ และการปล่อยให้เรนเดอร์ได้ แปลว่าสคริปต์ซ่อมข้อมูลที่พลาด
        // จะออกใบ VAT = 0 ให้คำขอที่ราคารวม VAT ไปแล้ว โดยไม่มีใครเห็น
        try {
            const { assertIssuerSideRenderable } = require('../../../services/billing/w14-boundary');
            assertIssuerSideRenderable({ issuerSide: upper, row });
        } catch (w14Error) {
            if (w14Error?.code !== 'W14_ISSUER_SIDE_RETIRED') { throw w14Error; }
            return res.status(w14Error.statusCode || 409).json({
                success: false, error: w14Error.code, code: w14Error.code,
                message: w14Error.messageTh, messageTh: w14Error.messageTh,
            });
        }

        // Pull the application — the quotation PDF shows the FULL price (both
        // phases) as one line per cultivation type, stamped with the persisted
        // Quotation.quotationNumber so the PDF matches the stored row.
        const application = await applicationService.getApplicationSlice(applicationId, {
            // PAYER_APPLICATION_SELECT = formData + entity (L-085: this select had
            // no entity, so every quotation fell to the person-shaped fallback).
            select: {
                id: true, applicationNumber: true, cultivationScopeCount: true, totalAreaTypes: true,
                ...PAYER_APPLICATION_SELECT,
            },
            ...scoped,
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // ?phase=1|2 selects which per-phase quotation document to render
        // (Phase 1 = ค่าตรวจสอบและประเมิน; Phase 2 = ค่ารับรองผล). Default 1.
        const phase = Number.parseInt(req.query.phase, 10) === 2 ? 2 : 1;
        // F-G4-64 — hand the generator the stored row so an accepted quotation
        // renders its frozen snapshot instead of today's rate table.
        const buffer = await invoiceTemplateService.generateQuotationPdf(
            { application, issuerSide: upper, phase, quotationRow: row },
            { quotationNumber: row.quotationNumber },
        );

        res.set('Content-Type', 'application/pdf');
        res.set(
            'Content-Disposition',
            `inline; filename="${row.quotationNumber}.pdf"`,
        );
        return res.send(buffer);
    } catch (error) {
        if (error?.code === 'INVALID_ISSUER_SIDE') {
            return res.status(400).json({
                success: false, error: error.code, message: error.message,
            });
        }
        // F-G4-64 — a quotation that does not price the requested instalment is
        // a refusal, not a 0.00 THB document with a real quotation number on it.
        if (error?.code === 'QUOTATION_PHASE_NOT_PRICED') {
            return res.status(catalogueStatus(error.code)).json({
                success: false,
                error: error.code,
                message: getMessage(error.code, 'th'),
            });
        }
        logger.error('[Quotations] pdf error:', error?.message || error);
        return res.status(500).json({
            success: false, error: 'Failed to render quotation PDF',
        });
    }
});

/**
 * POST /api/applications/:applicationId/quotations/:issuerType/accept
 *
 * Applicant accepts a quotation. Flips PENDING/SENT/DRAFT → ACCEPTED.
 * Audit-logged via the logger sink (audit table write happens
 * asynchronously through the middleware layer that ingests notifications).
 *
 * Only the applicant (HEALTH role + ownership) may accept. Provider
 * roles cannot accept on the applicant's behalf — that would defeat the
 * "applicant authorises the bill" semantic. Admin override may be added
 * in a later patch if Ops requires it.
 */
router.post('/:issuerType/accept', authenticateHealth, async (req, res) => {
    try {
        const { applicationId, issuerType } = req.params;
        const upper = String(issuerType || '').toUpperCase();
        if (upper !== ISSUER_TYPES.PLATFORM) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ISSUER_TYPE',
                message: `issuerType must be one of: ${Object.values(ISSUER_TYPES).join(', ')}`,
            });
        }

        const filing = await readableApplication(applicationId, req);
        if (!filing) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }
        // Accepting the price commits the holder to the filing, as paying does
        // (operator Q3, 2026-10-03): SUBMIT_APPLICATION on the holder. Reading the
        // quotation is open to every member; accepting it is not (R2 Task 12: the
        // filer pin that used to keep co-members out of this door is gone).
        try {
            await assertHolderCapability(req.user?.id, filing.entityId, 'SUBMIT_APPLICATION');
        } catch (gateErr) {
            if (gateErr?.code === 'ENTITY_PERMISSION_DENIED') {
                return res.status(403).json(entityPermissionDeniedBody(gateErr.permission || 'SUBMIT_APPLICATION'));
            }
            throw gateErr;
        }
        const applicantScope = await holderScope(req);

        const { platform } = await quotationService
            .findQuotationsByApplicationId(applicationId, { holderScope: applicantScope });
        const row = platform;
        if (!row) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        try {
            // Build the snapshot from the row the applicant is accepting, at
            // this instant, and let the service hash it. Nothing here consults
            // the fee service: the applicant is agreeing to THIS document.
            const snapshot = quotationService.buildAcceptanceSnapshot(row, { renderedAt: new Date() });
            const accepted = await quotationService.markQuotationAccepted(row.id, {
                acceptedBy: req.user?.id || null,
                snapshot,
                holderScope: applicantScope,
            });
            // Lightweight audit breadcrumb. The full audit-chain write is
            // produced by audit-middleware on the request boundary; this
            // log emits the structured event for log aggregation tools.
            logger.info('[Quotations] accept', {
                applicationId,
                quotationId: row.id,
                issuerType: upper,
                actorId: req.user?.id,
            });

            // Accepting the quotation is what unlocks Phase-1 payment, so the
            // เดิมตรงนี้เรียก ensurePhaseInvoices('PHASE_1') หลังผู้ยื่นกดยอมรับใบเสนอราคา
            // เพื่อให้มีใบแจ้งหนี้คู่รัฐ/บริษัทไว้ให้จ่าย · การแยกใบถูกปิดไปตั้งแต่ F-G4-35
            // (ฟังก์ชันกลายเป็น no-op คืน skipped: 'CHECKOUT_RAIL') และถูกลบทั้งเครื่อง
            // เมื่อ 2026-09-11 ตอน operator สั่งเลิกแยกค่าธรรมเนียมรัฐกับค่าบริการ
            // ใบแจ้งหนี้จริงมินต์ที่ /api/payments/checkout ใบเดียวต่องวด ตอนผู้ยื่นกดจ่าย

            return res.json({ success: true, data: accepted });
        } catch (err) {
            if (err?.code === 'INVALID_QUOTATION_STATUS') {
                return res.status(409).json({
                    success: false,
                    error: err.code,
                    message: err.message,
                });
            }
            // Both refusals answer from the catalogue: the status AND the copy
            // live in the row, which is where the gate module reads them too,
            // so there is one source for one message.
            //
            // QUOTATION_EXPIRED (final round R1) is raised here as well as at
            // the payment gate. Without it the applicant cleared the gate's
            // expiry refusal by pressing ยอมรับ on the same screen. The copy on
            // this row names the remedy the GET above performs by itself:
            // the lapsed document is retired and replaced.
            if (err?.code === 'SNAPSHOT_REQUIRED' || err?.code === 'QUOTATION_EXPIRED') {
                return res.status(catalogueStatus(err.code)).json({
                    success: false,
                    error: err.code,
                    message: getMessage(err.code, 'th'),
                });
            }
            throw err;
        }
    } catch (error) {
        logger.error('[Quotations] accept error:', error?.message || error);
        return res.status(500).json({
            success: false, error: 'Failed to accept quotation',
        });
    }
});

module.exports = router;
