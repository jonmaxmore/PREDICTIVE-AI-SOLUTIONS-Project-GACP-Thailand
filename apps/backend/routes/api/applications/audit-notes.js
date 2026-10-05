'use strict';

/**
 * GET /api/applications/:id/audit-notes — PDPA ม.30, the applicant's own copy.
 *
 * Health auth, and the service scopes the read to the caller's holders (spec 2026-09-30 §3.1). A filing that
 * is not theirs answers 404 rather than 403, because confirming that an application
 * exists is already a disclosure about someone else.
 *
 * The response carries withheld rows too, marked and with their reason. See
 * services/audit-notes-disclosure.js for why a withheld row is declared rather than
 * dropped: an access right that cannot be checked is not one.
 */

const express = require('express');

const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const applicationService = require('../../../services/application-service');
const { getHealthScopeOptions } = require('../helpers/applications-helpers');
const { holderScope } = require('../../../services/holder-access');
const { listAuditNotesForApplicant } = require('../../../services/audit-notes-disclosure');

const router = express.Router();

router.get('/:id/audit-notes', authenticateHealth, async (req, res) => {
    try {
        const identity = await applicationService.resolveHealthIdentity(
            req.user.id, getHealthScopeOptions(req.user),
        );
        const payload = await listAuditNotesForApplicant({
            prisma,
            applicationId: req.params.id,
            holderScope: await holderScope(req),
            healthId: identity.healthId, // R1-legacy-pin: removed in Task 12
        });
        return res.json({ success: true, data: payload });
    } catch (error) {
        if (error && error.statusCode) {
            // `messageTh` rather than `message`: the envelope strips `message` from every
            // non-2xx body (api-client.ts), which is how a refusal reaches a farmer as a
            // bare code. Learned the hard way at the requirements door (d183f506).
            return res.status(error.statusCode).json({
                success: false,
                error: error.code,
                code: error.code,
                messageTh: error.messageTh,
            });
        }
        logger.error('[audit-notes] read failed:', error);
        return res.status(500).json({ success: false, error: 'AUDIT_NOTES_UNAVAILABLE' });
    }
});

module.exports = router;
