/**
 * Applicant document routes — the health user's own uploaded documents.
 *
 * POST /verify (OCR + keyword classifier over one upload) was removed with
 * services/document-analysis-service.js on 2026-09-28: it had no caller in the
 * web or mobile app, and the document pre-check (services/document-precheck/)
 * checks every upload in the queue instead.
 */
const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const documentService = require('../../../services/document-service');
const authModule = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');

/**
 * Detokenize STAGE A (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md,
 * breaker 3c): Application.healthId is an FK to User.canonicalId and stores the
 * keyed-HMAC TOKEN once APP_FK_USE_TOKEN is on (LIVE on prod 2026-06-29), while
 * req.user.healthId is the DECRYPTED PLAINTEXT national ID. Passing the
 * plaintext as the ownership predicate never matches the token → the documents
 * list came back empty and the /documents/[id] viewer 404'd for every
 * applicant. Scope by the `applicant: { id }` relation join (User.id is a UUID
 * that is never re-keyed → correct in BOTH data states); the fallback is the
 * live FK key (canonicalId), never the plaintext.
 */
async function buildApplicantDocScope(req) {
    const user = req.user;
    // Spec 2026-09-30 §3.1: the holder scope decides which filings are read.
    const { holderScope } = require('../../../services/holder-access');
    return {
        userId: String(user?.userId || user?.id || '').trim() || undefined,
        healthId: String(user?.canonicalId || '').trim() || undefined,
        holderScope: await holderScope(req),
    };
}

/**
 * GET /api/documents
 * List documents for authenticated user
 */
router.get('/', authModule.authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Get documents from applications (draft documents). Goes through
        // document-service so the soft-delete + ownership predicates live
        // at the service boundary (Batch 15 prisma-bypass cleanup). STAGE-A
        // token-safe scope — see buildApplicantDocScope above; the plaintext
        // national ID (req.user.healthId) must never reach a query.
        const applications = await documentService.listApplicantApplicationsForDraftDocs(
            await buildApplicantDocScope(req),
        );

        const documents = [];
        for (const app of applications) {
            const formData = app.formData && typeof app.formData === 'object' ? app.formData : {};
            const draftDocs = Array.isArray(formData.draftDocuments) ? formData.draftDocuments : [];
            for (const doc of draftDocs) {
                documents.push({
                    id: doc.documentId || doc.id,
                    fileName: doc.fileName,
                    fileUrl: doc.fileUrl,
                    type: doc.stepKey || 'application',
                    applicationId: app.id,
                    applicationNumber: app.applicationNumber,
                    uploadedAt: doc.uploadedAt,
                });
            }
        }

        return res.json({
            success: true,
            data: documents,
            total: documents.length,
        });
    } catch (error) {
        logger.error('[Documents] List Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * GET /api/documents/:id
 * Single document detail for the health /documents/[id] viewer.
 *
 * A "document" = a draftDocuments[] entry in Application.formData. Ownership is
 * enforced at the service boundary (findApplicantDraftDocument only scans the
 * caller's own owner-scoped applications), so a cross-owner / nonexistent id
 * yields 404 (anti-IDOR) — never a fabricated document.
 */
router.get('/:id', authModule.authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        // STAGE-A token-safe ownership scope — see buildApplicantDocScope above.
        // Empty scope fails closed inside the service (null → 404).
        const document = await documentService.findApplicantDraftDocument(
            await buildApplicantDocScope(req),
            req.params.id,
        );
        if (!document) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }

        return res.json({ success: true, data: document });
    } catch (error) {
        logger.error('[Documents] Get-by-id Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
