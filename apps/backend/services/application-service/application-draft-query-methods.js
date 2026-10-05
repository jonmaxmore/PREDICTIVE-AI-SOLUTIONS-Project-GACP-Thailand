const { maskThaiId } = require('../../utils/field-encryption');
const { localYear } = require('../../utils/working-days');
const { holderReadWhere, resolveHolderOwnerOrCreator } = require('../holder-access');
const { ENTITY_PERMISSION_DENIED_EN } = require('../../shared/entity-permission-denied');

/**
 * The holder fragment for an applicant-side Application read (spec
 * 2026-09-30 §3.1), or null when the caller passed no scope. A null means
 * "not a health caller": health-only reads then fail closed without a query,
 * and the shared by-id read keeps its staff where. Only an object with a
 * readIds array counts as a scope, so a leftover positional filer id
 * (healthId / userId string) can never widen a read.
 * @param {{ holderScope?: { userId: string, readIds: string[] } }} [options]
 * @returns {object|null}
 */
// Every applicant read below carries the holder fragment alone (R2 Task 12
// removed the R1 filer pins). What the caller may DO with a row it can read is
// decided by the submit guard, the capability gates and §3.3 (deleteDraft).
function applicationHolderWhere(options) {
    const scope = options && typeof options === 'object' ? options.holderScope : null;
    if (!scope || typeof scope !== 'object' || !Array.isArray(scope.readIds)) {
        return null;
    }
    return holderReadWhere(scope, 'Application');
}

function createApplicationDraftQueryMethods({
    prisma,
    feeService,
    sendNotification,
    NotifyType,
    logger,
}) {
    const auditTrail = require('../audit-trail');
    return {
        /**
         * Create or Update a Draft Application
         * @param {string} identityRef
         * @param {object} data
         * @returns {Promise<object>} Created/Updated Application
         */
        async saveDraft(identityRef, data, options = {}) {
            const healthIdentity = await this.resolveHealthIdentity(identityRef, options);
            const healthUserId = healthIdentity.userId;
            const actorHealthId = healthIdentity.healthId;
            logger.debug('[ApplicationService.saveDraft] START', { userId: healthUserId, healthIdMasked: maskThaiId(actorHealthId), status: data.status });

            const {
                plantId, plantName,
                purpose, areaType, serviceType,
                applicantData, locationData, productionData, harvestData,
                documents, youtubeUrl,
                requestedInspectionDate,
                estimatedProcessingDays, estimatedFee,
                cultivationMethods,
                personnelHygiene, // [NEW] GACP Hygiene Data
            } = data;

            logger.debug('[ApplicationService.saveDraft] Fields:', { plantId, serviceType, areaType, status: data.status });

            // Validation
            if (!plantId || !serviceType) {
                logger.warn('[ApplicationService.saveDraft] Validation Failed - Missing required fields');
                throw new Error('Missing required fields: plantId, serviceType');
            }

            // Check for existing draft
            logger.debug('[ApplicationService.saveDraft] Checking for existing draft...');
            const existingDraft = await prisma.application.findFirst({
                where: {
                    healthId: actorHealthId,
                    status: 'DRAFT',
                    isDeleted: false,
                },
                orderBy: { createdAt: 'desc' },
            });
            logger.debug('[ApplicationService.saveDraft] Existing Draft:', existingDraft ? 'Found' : 'Not Found');

            // Generate application number if new
            const year = localYear() + 543; // Bangkok year
            const globalCount = await prisma.application.count();
            const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
            const applicationNumber = `GACP-${year}-${String(globalCount + 1).padStart(5, '0')}-${timestamp}`;
            const fees = feeService.calculateApplicationFees(data || {
                cultivationMethods,
            });

            const applicationData = {
                healthId: actorHealthId,
                applicationNumber: existingDraft ? undefined : applicationNumber, // Don't overwrite if exists
                serviceType,
                areaType,
                status: 'DRAFT', // Should probably check if completing
                phase1Amount: fees.phase1.total,
                phase2Amount: fees.phase2.total,
                cultivationScopeCount: fees.scopeCount,
                // `totalAreaTypes` is the retired name for the same number.
                // Written in step so a process still serving the previous image
                // prices correctly; the contract migration drops it.
                totalAreaTypes: fees.scopeCount,
                personnelHygiene, // [NEW] Save to top-level column
                formData: {
                    plantId,
                    plantName: plantName || plantId,
                    purpose,
                    applicantData,
                    locationData,
                    farmId: locationData?.farmId || null,
                    productionData,
                    harvestData, // Add Harvest Data
                    documents,
                    youtubeUrl,
                    estimatedFee,
                    estimatedProcessingDays,
                    requestedInspectionDate,
                    submissionDate: new Date(),
                    fees: {
                        phase1: fees.phase1,
                        phase2: fees.phase2,
                        total: fees.total,
                    },
                },
            };

            let application;

            // Determine if this is a submission (status changes from DRAFT to SUBMITTED)
            // Note: The UI usually sets status in the payload, but here it sets 'DRAFT' hardcoded in line 50 of original code.
            // Assuming 'data.status' might be passed or inferred.
            // The original code hardcoded status: 'DRAFT'.
            // If the user INTENDS to submit, we should allow status override or separate submit method.
            // For now, I will modify the status assignment to respect input OR check context.
            // Looking at line 86 of original: if (application.status === 'SUBMITTED')
            // This suggests status WAS mutable or passed in.
            // I'll update line 50 to use data.status or default to DRAFT.

            const targetStatus = data.status || 'DRAFT';
            applicationData.status = targetStatus;

            if (existingDraft) {
                application = await prisma.application.update({
                    where: { id: existingDraft.id },
                    data: applicationData,
                });
            } else {
                application = await prisma.application.create({
                    data: applicationData,
                });
            }

            // Auto-generate Invoice & Notify if Submitted
            if (targetStatus === 'SUBMITTED') {
                // 1. Generate Invoice (which will trigger its own notification)
                await this._generatePhase1Invoice(application, healthIdentity);

                // 2. Notify Application Received
                await sendNotification(healthUserId, NotifyType.APPLICATION_SUBMITTED, {
                    applicationId: application.id,
                    applicationNumber: application.applicationNumber,
                    plantName: application.formData.plantName,
                });

                // 3. Audit trail
                auditTrail.logAction({
                    action: auditTrail.ACTIONS.SUBMIT,
                    entityType: auditTrail.ENTITIES.APPLICATION,
                    entityId: application.id,
                    userId: healthUserId,
                    description: `Application ${application.applicationNumber} submitted`,
                    applicationId: application.id,
                    severity: auditTrail.SEVERITY.INFO,
                });
            }

            return application;
        },

        /**
         * Submit Application (Finalize Step 12)
         * Wraps saveDraft but forces status to SUBMITTED
         */
        async submitApplication(identityRef, data, options = {}) {
            logger.info('[ApplicationService.submitApplication] START', { identityRef, healthIdMasked: maskThaiId(options.healthId) || null, keys: Object.keys(data) });

            // Force status to SUBMITTED
            // This triggers Invoice Generation in saveDraft
            const result = await this.saveDraft(identityRef, { ...data, status: 'SUBMITTED' }, options);

            logger.info('[ApplicationService.submitApplication] SUCCESS', { id: result.id, applicationNumber: result.applicationNumber, status: result.status });

            return result;
        },

        /**
         * Get Current Draft for health account — the latest DRAFT within the
         * caller's holders (spec 2026-09-30 §3.1). `identityRef` is kept for the
         * call shape; the scope is `options.holderScope`.
         * @param {string} identityRef
         * @param {{ holderScope?: object }} [options]
         */
        async getDraft(identityRef, options = {}) {
            const holderWhere = applicationHolderWhere(options);
            if (!holderWhere) {
                return null;
            }

            // R2 Task 9: the fragment alone (buildHealthWhereClause is deleted).
            return prisma.application.findFirst({
                where: {
                    ...holderWhere,
                    status: 'DRAFT',
                    isDeleted: false,
                },
                orderBy: { createdAt: 'desc' },
            });
        },

        /**
         * Soft-delete a draft by id (spec 2026-09-30 §3.3, R2 Task 9).
         *
         * The draft is read within the caller's holder scope (a draft the caller
         * cannot see → null, nothing written). Deleting is destructive-grade: only
         * the draft's creator (`submitterId`) with an ACTIVE non-VIEWER membership
         * on its holder, or the holder's ACTIVE OWNER, may delete it
         * (resolveHolderOwnerOrCreator, the rule farm delete already applies).
         * Anyone else who can see it → 403 ENTITY_PERMISSION_DENIED, nothing written.
         * This replaces the strict filer pin (`strictApplicantPin`), which let a
         * holder OWNER delete nothing of a co-member's and let a filer delete a
         * draft after losing the holder.
         * @param {string} identityRef — kept for the call shape
         * @param {string} draftId
         * @param {{ holderScope?: object }} [options]
         * @returns {Promise<{ id: string }|null>}
         * @throws {Error} 403 ENTITY_PERMISSION_DENIED
         */
        async deleteDraft(identityRef, draftId, options = {}) {
            const normalizedDraftId = String(draftId || '').trim();
            if (!normalizedDraftId) {
                return null;
            }

            const holderWhere = applicationHolderWhere(options);
            if (!holderWhere) {
                return null;
            }

            const existingDraft = await prisma.application.findFirst({
                where: {
                    ...holderWhere,
                    id: normalizedDraftId,
                    status: 'DRAFT',
                    isDeleted: false,
                },
                select: { id: true, entityId: true, submitterId: true },
            });

            if (!existingDraft) {
                return null;
            }

            if (!(await resolveHolderOwnerOrCreator(existingDraft, options.holderScope.userId))) {
                // Only the draft creator or the holder OWNER may delete it (spec §3.3).
                const err = new Error(ENTITY_PERMISSION_DENIED_EN);
                err.statusCode = 403;
                err.code = 'ENTITY_PERMISSION_DENIED';
                throw err;
            }

            return prisma.application.update({
                where: { id: existingDraft.id },
                data: {
                    isDeleted: true,
                    deletedAt: new Date(),
                },
                select: { id: true },
            });
        },

        /**
         * Get All Applications for health account — every filing whose holder
         * is in the caller's scope (spec 2026-09-30 §3.1). `identityRef` is kept
         * for the call shape; the scope is `options.holderScope`.
         * @param {string} identityRef
         * @param {{ holderScope?: object, take?: number }} [options]
         */
        async getHealthApplications(identityRef, options = {}) {
            const holderWhere = applicationHolderWhere(options);
            if (!holderWhere) {
                return [];
            }

            const take = Number.isFinite(options.take) && Number(options.take) > 0
                ? Number(options.take)
                : undefined;

            return prisma.application.findMany({
                where: {
                    ...holderWhere, // R2 Task 9: the fragment alone (buildHealthWhereClause is deleted)
                    isDeleted: false,
                },
                orderBy: { createdAt: 'desc' },
                ...(take ? { take } : {}),
                include: {
                    certificates: {
                        where: {
                            isDeleted: false,
                            status: { in: ['active', 'ACTIVE'] },
                        },
                        select: {
                            id: true,
                        },
                        take: 1,
                    },
                },
            });
        },

        // Backward-compatible alias (to be removed after full migration)
        async getHealthUserApplications(identityRef, options = {}) {
            return this.getHealthApplications(identityRef, options);
        },

        /**
         * Get Application by ID. A health caller passes `options.holderScope`
         * and reads findFirst({ where: { id, ...fragment } }) (spec 2026-09-30
         * §3.1); a staff caller passes nothing and keeps where { id }.
         *
         * Note: application-service.js assembles the provider-query methods
         * after these, so the service's public `getById` is the provider one
         * (application-provider-query-methods.js); this one is reached only
         * through the factory.
         * @param {string} id
         * @param {string} [identityRef]
         * @param {{ holderScope?: object }} [options]
         */
        async getById(id, identityRef, options = {}) {
            const holderWhere = applicationHolderWhere(options);
            // R2 Task 9: the fragment alone (buildHealthWhereClause is deleted).
            const where = holderWhere ? { id, ...holderWhere } : { id };

            return prisma.application.findFirst({
                where,
                include: {
                    applicant: {
                        select: {
                            id: true,
                            healthId: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phoneNumber: true,
                            province: true,
                        },
                    },
                },
            });
        },

        /**
         * Lean lookup for the payments flow. Returns just `{ id, status }` when
         * the application's holder is in the caller's scope and it is not
         * soft-deleted, otherwise null (no scope → null, no query). We
         * deliberately do NOT return applicant fields here — route-level callers
         * (notably finance/payments.js) only need the status to decide which
         * phase invoice to create, and shrinking the result surface keeps PII
         * from accidentally being logged or echoed back.
         * @param {string} applicationId
         * @param {{ holderScope?: object }} [options]
         */
        async findForPaymentOwnership(applicationId, options = {}) {
            const holderWhere = applicationHolderWhere(options);
            if (!applicationId || !holderWhere) {return null;}
            return prisma.application.findFirst({
                where: {
                    id: applicationId,
                    ...holderWhere,
                    isDeleted: false,
                },
                select: { id: true, status: true },
            });
        },

        /**
         * Applicant-side by-id lookup with the full record (formData, workflow
         * history), used by the revision, CAR and quotation doors. It carries the
         * holder fragment alone (spec 2026-09-30 §3.1): any ACTIVE member of the
         * holder reads it, and what the caller may DO with the row stays with the
         * submit guard (revision PUT, CAR) or the doors' own gates. No scope → null.
         * @param {string} applicationId
         * @param {{ holderScope?: object }} [options]
         */
        async findOwnedApplicationForApplicant(applicationId, options = {}) {
            const holderWhere = applicationHolderWhere(options);
            if (!applicationId || !holderWhere) {return null;}
            return prisma.application.findFirst({
                where: {
                    id: applicationId,
                    ...holderWhere,
                },
            });
        },
    };
}

module.exports = { createApplicationDraftQueryMethods, applicationHolderWhere };
