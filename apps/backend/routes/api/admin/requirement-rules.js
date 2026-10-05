/**
 * Routes: /api/admin/requirement-rules/*
 *
 * The ministry edits the document law WITHOUT a deploy (operator ruling G2 —
 * design note 2026-08-15-membership-m2-documents-and-poa-design §3).
 * Every mandatory-document rule is a dated row in `requirement_rules`
 * (prisma/schema/requirement-rule.prisma), and this is the surface that writes it.
 *
 *   GET  /api/admin/requirement-rules            ?at=<ISO> &includeClosed=true
 *   POST /api/admin/requirement-rules            file a new rule           → 201
 *   POST /api/admin/requirement-rules/:id/close  retire a rule             → 200
 *
 * There is deliberately NO PUT/PATCH/DELETE. The table is append-only: a change
 * is "close the old row + file a new one", which leaves both rows readable side
 * by side, because a rule that has ever been in force is the law an application
 * was judged by on the day it was filed (AC3). services/requirement-rule-service.js
 * enforces that; this file merely refuses to offer a door the service does not have.
 *
 * Auth: authenticateProvider + requireAdmin come from the parent admin router
 * (routes/api/admin/index.js:8-9). This module installs NO guard of its own —
 * same convention as admin/audit-log.js:23-27 and admin/user-permissions.js:21-23:
 * a second, local gate would shadow the parent's and could silently weaken it.
 *
 * Responses carry whole rows. A requirement rule is national policy, not personal
 * data — there is nothing here to redact, and the provenance columns (createdBy /
 * closedBy / reason) are the point of showing it to an admin at all.
 *
 * VALIDATION (plan review M6 — "กันกฎหมายใบ้"): a rule whose slot or dimension is
 * misspelled is not a strict rule, it is a rule that never fires — silent, and
 * invisible until an application slips through. So every dimension is checked
 * against the real vocabulary here, at the only door where a human types it.
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../../../shared/logger');
const { prisma } = require('../../../services/prisma-database');
const { getAllSlotIds } = require('../../../constants/document-slots');
const { getCanonicalSlotId } = require('../applications/validation-slot-utils');
const { createRule, closeRule, RULE_DIMENSIONS } = require('../../../services/requirement-rule-service');

/**
 * Every slot the platform knows, in the canonical form rules are stored in.
 * Built from constants/document-slots.js (the SSOT catalog) through the SSOT
 * canonicalizer, so an alias-shaped catalog entry (e.g. 'license_bt11', whose
 * canonical form is 'controlled_herb_license') is admitted under either spelling instead of
 * being rejected by its own catalog.
 */
const KNOWN_SLOT_IDS = new Set(getAllSlotIds().map((slotId) => getCanonicalSlotId(slotId)));
const KNOWN_SLOT_ID_LIST = Object.freeze([...KNOWN_SLOT_IDS].sort());

/**
 * Entity.type — the holder the rule binds (prisma/schema/entity.prisma:35).
 * NULL/omitted = every holder type.
 */
const HOLDER_TYPES = Object.freeze(['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE']);

/**
 * ONE vocabulary, taken from constants/document-slots.js
 * (`requiredFor.applicationTypes`): NEW | RENEWAL | REPLACEMENT. Never 'RENEW' —
 * a fifth word would not be a synonym, it would be a rule that never fires.
 * NULL/omitted = every request type.
 */
const REQUEST_TYPES = Object.freeze(['NEW', 'RENEWAL', 'REPLACEMENT']);

/**
 * The three กทล.1 case dimensions (spec 2026-09-01 §2.1): what a case must
 * attach depends on how it holds its land, what kind of area it is, and which
 * scope it asks to be certified for. The vocabulary is NOT copied here — it is
 * read from the service that owns it (RULE_DIMENSIONS), because two lists of the
 * same words drift and a drifted word is a rule that never fires.
 *
 * Each entry is [body field, error code]; the accepted set comes from the
 * service. NULL/omitted = every value, exactly like the three dimensions above.
 */
const CASE_DIMENSION_CHECKS = Object.freeze([
    ['landTenure', 'INVALID_LAND_TENURE'],
    ['areaType', 'INVALID_AREA_TYPE'],
    ['certScope', 'INVALID_CERT_SCOPE'],
]);

/** '' / null / undefined all mean "this dimension is not restricted". */
function normalizeDimension(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text === '' ? null : text;
}

function parseInstant(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function badRequest(res, code, error, allowed) {
    const body = { success: false, code, error };
    if (allowed) {
        body.allowed = allowed;
    }
    return res.status(400).json(body);
}

/**
 * The service raises typed errors (400 invalid / 404 not found / 409 already
 * closed). Those are the admin's own mistake and are echoed back verbatim —
 * they carry no internals. Anything else is ours: logged with its cause,
 * answered with a generic 500 (C4-04).
 */
function respondFromServiceError(res, error, context, genericMessage) {
    const status = Number(error?.status || error?.statusCode || 0);
    if (status >= 400 && status < 500) {
        return res.status(status).json({
            success: false,
            code: error.code || 'REQUIREMENT_RULE_INVALID',
            error: error.message,
        });
    }
    logger.error(`${context}:`, error?.message);
    return res.status(500).json({ success: false, error: genericMessage });
}

// ── GET / ──────────────────────────────────────────────────────────────────
//
// The catalog view: which rules stood on a given day.
//
// This does NOT go through requirementRuleService.rulesAt on purpose. rulesAt
// answers a different question — "which rules bind THIS application" — where a
// dimension the caller did not name may only match dimension-agnostic rules
// (service:54-59). For a catalog listing that would hide every JURISTIC-specific
// rule from the admin who has to maintain them. The window below is the same one
// rulesAt applies (service:101-109); the dimensions are simply not filtered.
router.get('/', async (req, res) => {
    try {
        const includeClosed = String(req.query.includeClosed || '').toLowerCase() === 'true';

        let asOf = new Date();
        if (req.query.at !== undefined && String(req.query.at).trim() !== '') {
            const parsed = parseInstant(req.query.at);
            if (!parsed) {
                // Silently answering about "now" would answer a question the
                // admin did not ask — and they would not know.
                return badRequest(res, 'VALIDATION_ERROR', 'at must be a valid ISO datetime');
            }
            asOf = parsed;
        }

        const where = includeClosed
            ? {}
            : {
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
            };

        const rows = await prisma.requirementRule.findMany({
            where,
            orderBy: [{ slotId: 'asc' }, { effectiveFrom: 'asc' }],
        });

        return res.json({
            success: true,
            data: { rows, at: asOf.toISOString(), includeClosed },
        });
    } catch (error) {
        logger.error('[admin/requirement-rules] list failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to load requirement rules' });
    }
});

// ── POST / ─────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    const body = req.body || {};

    // slotId — canonicalized first, then checked against the catalog. Both sides
    // of the engine compare canonical forms, so 'LAND_TITLE' is stored (and later
    // matched) as 'land_deed' rather than becoming a rule about nothing.
    const rawSlotId = body.slotId === null || body.slotId === undefined ? '' : String(body.slotId).trim();
    const slotId = rawSlotId ? getCanonicalSlotId(rawSlotId) : '';
    if (!slotId || !KNOWN_SLOT_IDS.has(slotId)) {
        return badRequest(
            res,
            'INVALID_SLOT_ID',
            rawSlotId
                ? `Unknown document slot: ${rawSlotId}`
                : 'slotId is required',
            KNOWN_SLOT_ID_LIST,
        );
    }

    const holderType = normalizeDimension(body.holderType);
    if (holderType !== null && !HOLDER_TYPES.includes(holderType)) {
        return badRequest(res, 'INVALID_HOLDER_TYPE', `Unknown holderType: ${holderType}`, HOLDER_TYPES);
    }

    const requestType = normalizeDimension(body.requestType);
    if (requestType !== null && !REQUEST_TYPES.includes(requestType)) {
        return badRequest(res, 'INVALID_REQUEST_TYPE', `Unknown requestType: ${requestType}`, REQUEST_TYPES);
    }

    // The กทล.1 case dimensions (spec 2026-09-01 §2.1). Unlike plantCode below,
    // the half that CARRIES them to the submit gate ships in the same batch as
    // this door, which is what makes passing them through honest rather than the
    // plantCode trap: if that half were ever left behind, a rule filed here would
    // bind nobody. They are checked at the only door a human types the law
    // through: a rule that says 'LEASED' where the law says 'RENTED' is not a
    // stricter rule, it is a rule that never fires, and an admin answered 201
    // would never find out. The service refuses the same words for every other
    // writer (the seed job), so neither door can widen the vocabulary alone.
    const caseDimensions = {};
    for (const [field, code] of CASE_DIMENSION_CHECKS) {
        const value = normalizeDimension(body[field]);
        if (value !== null && !RULE_DIMENSIONS[field].includes(value)) {
            return badRequest(res, code, `Unknown ${field}: ${value}`, RULE_DIMENSIONS[field]);
        }
        caseDimensions[field] = value;
    }

    // plantCode — the column exists and the service stores it, but NOTHING asks
    // about it yet: the submit gate queries the law with holderType + requestType
    // only (services/application-document-requirements.js:201), and rulesAt pins
    // the dimension to {plantCode: null} for any caller who does not name it. A
    // per-plant rule filed today would answer 201, emit a REQUIREMENT_RULE_CREATED
    // audit row, sit in the table looking enforced — and bind nobody, forever
    // (audit M2a F3). The dimension stays inert like maxDocumentAgeMonths; the
    // difference is that this one is typed by a human who would never find out.
    // Refuse it until the gate carries the plant dimension (M2b+).
    const plantCode = normalizeDimension(body.plantCode);
    if (plantCode !== null) {
        return badRequest(
            res,
            'PLANT_DIMENSION_NOT_SUPPORTED',
            'plantCode is not enforced yet: the submit gate does not ask the law about a plant, '
            + 'so a per-plant rule would never bind anyone. File it without plantCode, or wait for '
            + 'the phase that carries the plant dimension to the gate (M2b+).',
        );
    }

    try {
        // Named fields only: `req.body` is never spread into the service, and the
        // service whitelists again on its side. createdBy comes from the session
        // (service normalizeActor) — a body may not claim authorship of policy.
        const created = await createRule({
            holderType,
            requestType,
            // always null here — a non-null plantCode was refused above.
            plantCode,
            landTenure: caseDimensions.landTenure,
            areaType: caseDimensions.areaType,
            certScope: caseDimensions.certScope,
            slotId,
            isRequired: body.isRequired,
            maxDocumentAgeMonths: body.maxDocumentAgeMonths,
            effectiveFrom: body.effectiveFrom,
            effectiveTo: body.effectiveTo,
            reason: body.reason,
        }, req.user);

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        return respondFromServiceError(
            res,
            error,
            '[admin/requirement-rules] insert failed',
            'Failed to create requirement rule',
        );
    }
});

// ── POST /:id/close ────────────────────────────────────────────────────────
//
// Retire a rule. The service stamps effectiveTo/closedBy/closedAt and nothing
// else; the reason lives in the REQUIREMENT_RULE_CLOSED audit row, never on the
// row body (overwriting `reason` would erase why the rule was CREATED).
router.post('/:id/close', async (req, res) => {
    try {
        const updated = await closeRule(req.params.id, req.user, req.body?.reason);
        return res.json({ success: true, data: updated });
    } catch (error) {
        return respondFromServiceError(
            res,
            error,
            '[admin/requirement-rules] close failed',
            'Failed to close requirement rule',
        );
    }
});

module.exports = router;
