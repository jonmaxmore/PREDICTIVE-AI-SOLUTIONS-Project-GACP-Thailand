const { prisma } = require('./prisma-database');
const feeService = require('./fee-service');
const { sendNotification, NotifyType } = require('./notification-service');
const logger = require('../shared/logger');
// หกรายการที่เคยถูก require ตรงนี้ (crypto · getServiceTypesForPhaseComponent ·
// getCanonicalServiceTypeForComponent · isInvoicePaidStatus · isPhaseSplitInvoicingRetired ·
// getFrozenPhaseFees) ถูกถอดพร้อม application-phase-invoice-methods เมื่อ 2026-09-11
// — ทั้งหมดมีไว้ป้อนเครื่องแยกใบรัฐ/บริษัท ซึ่งไม่มีอยู่แล้ว
const { createApplicationIdentityMethods } = require('./application-service/application-identity-methods');
const { createApplicationDraftQueryMethods } = require('./application-service/application-draft-query-methods');
const { createApplicationReviewRevisionMethods } = require('./application-service/application-review-revision-methods');
const { createApplicationProviderQueryMethods } = require('./application-service/application-provider-query-methods');
const { createApplicationApplicantQueryMethods } = require('./application-service/application-applicant-query-methods');

/**
 * Service for managing GACP Applications
 * Encapsulates all business logic for creation, updates, and retrieval.
 */
class ApplicationService {}

Object.assign(
    ApplicationService.prototype,
    createApplicationIdentityMethods({ prisma, logger }),
    createApplicationDraftQueryMethods({
        prisma,
        feeService,
        sendNotification,
        NotifyType,
        logger,
    }),
    createApplicationReviewRevisionMethods({
        prisma,
        feeService,
        sendNotification,
        NotifyType,
        logger,
    }),
    createApplicationProviderQueryMethods({ prisma }),
    createApplicationApplicantQueryMethods({ prisma }),
);

module.exports = new ApplicationService();
