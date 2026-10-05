/**
 * application-applicant-query-methods
 *
 * Encapsulates the queries that the applicant-facing wizard / draft
 * routes (`routes/api/applications/applications.js`) previously issued
 * directly against the Prisma client. Extracted during the batch 11
 * Prisma-bypass cleanup (2026-05-16) so the route layer no longer
 * reaches into prisma.application / prisma.entity / prisma.user / prisma.farm
 * directly.
 *
 * Every method preserves the original HTTP-contract behaviour:
 *   - column projection / `select` is left where the route already had it
 *   - `isDeleted: false` and ownership predicates are enforced here
 *   - return shapes are identical so callers do not need to adapt
 *
 * Method-level comments cite the exact prisma call site in
 * applications.js that they replace (line numbers as of pre-refactor).
 *
 * Service composition: these methods are wired into ApplicationService
 * by `application-service.js`. They depend only on `prisma` (injected so
 * tests can stub the client).
 */

const { applicationHolderWhere } = require('./application-draft-query-methods');
const { holderReadWhereIfScoped } = require('../holder-access');

/**
 * Final review I1 (2026-10-03): the options-object lookups refuse the pre-R1
 * positional call (a filer healthId where the options belong). Without this a
 * caller written against the old shape (e.g. a branch merged after R1) gets a
 * silent null and the draft door refuses or mints instead of saving.
 * @param {string} method
 * @param {unknown} options
 */
function assertOptionsObject(method, options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError(
            `${method}: expected an options object { holderScope, submitterId, editIds }, got ${options === null ? 'null' : Array.isArray(options) ? 'an array' : typeof options}`
            + ' — the pre-R1 positional healthId form is gone',
        );
    }
}

function createApplicationApplicantQueryMethods({ prisma }) {
    return {
        /**
         * Replaces applications.js:112 prisma.application.findFirst (by id + healthId)
         *
         * Locate an application by id within the caller's holders (spec
         * 2026-09-30 §3.1: findFirst({ where: { id, ...fragment } })), filtered
         * for soft-deletes. Used by the draft/prepare/upload flows when the
         * client supplies an explicit applicationId or draftId. No scope → null.
         * R2 Task 9 (spec §3.2 draft edits): the fragment alone, so a co-member
         * who may edit the holder reaches the draft whoever filed it. The editIds
         * rule is the caller's (findOrCreateApplicationForHealth: not readable →
         * 404, readable but not editable → 403).
         * @param {string} applicationId
         * @param {{ holderScope?: object }} [options]
         */
        async findApplicationByIdForHealth(applicationId, options) {
            assertOptionsObject('findApplicationByIdForHealth', options);
            const holderWhere = applicationHolderWhere(options);
            if (!applicationId || !holderWhere) {
                return null;
            }
            return prisma.application.findFirst({
                where: {
                    id: applicationId,
                    ...holderWhere,
                    isDeleted: false,
                },
            });
        },

        /**
         * The holder of one application the caller can read (spec 2026-09-30 §3.1:
         * findFirst({ where: { id, ...fragment } })), for a door that then asks
         * the permission engine what the caller may DO on that holder (R2 Task 9:
         * the checkout gate, operator Q3). Returns `{ id, entityId }` or null;
         * no scope → null, no query.
         * @param {string} applicationId
         * @param {{ holderScope?: object }} options
         * @returns {Promise<{ id: string, entityId: string|null }|null>}
         */
        async findApplicationHolderForHealth(applicationId, options) {
            assertOptionsObject('findApplicationHolderForHealth', options);
            const holderWhere = applicationHolderWhere(options);
            if (!applicationId || !holderWhere) {
                return null;
            }
            return prisma.application.findFirst({
                where: { id: applicationId, ...holderWhere, isDeleted: false },
                select: { id: true, entityId: true },
            });
        },

        /**
         * Replaces applications.js:122 prisma.application.findFirst (latest DRAFT/REGISTERED)
         *
         * The caller's most recent open draft within the caller's holders,
         * ordered by `updatedAt desc`. Used as a fallback when the client did not
         * supply an explicit applicationId (the wizard auto-resumes the last
         * draft). No scope → null, no query.
         * Task 8 (spec §3.2 resume): only the caller's own draft (`submitterId`)
         * on a holder in `editIds`; a missing submitterId or editIds → null.
         * @param {{ holderScope?: object, submitterId?: string, editIds?: string[] }} [options]
         */
        async findLatestOpenDraftForHealth(options) {
            assertOptionsObject('findLatestOpenDraftForHealth', options);
            const holderWhere = applicationHolderWhere(options);
            const submitterId = String(options.submitterId || '').trim();
            if (!holderWhere || !submitterId || !Array.isArray(options.editIds)) {
                return null;
            }
            return prisma.application.findFirst({
                where: {
                    ...holderWhere,
                    // Task 8 (spec §3.2 resume): the caller's own draft, on a holder it may
                    // edit. Inside AND, so it can never widen the fragment.
                    AND: [{ submitterId, entityId: { in: [...options.editIds] } }],
                    isDeleted: false,
                    status: { in: ['DRAFT'] },
                },
                orderBy: { updatedAt: 'desc' },
            });
        },

        /**
         * Replaces applications.js:160 prisma.application.create (new draft)
         *
         * Create a brand-new DRAFT row for a health user. The caller passes the
         * holder the applicant chose (`entityId`, spec 2026-09-30 §3.2); there is
         * no default holder.
         */
        async createDraftForHealth(data) {
            return prisma.application.create({ data });
        },

        /**
         * Task 8 (spec 2026-09-30 §3.2): the holder a new draft is filed for —
         * `{ id, type }` of a live (not deleted) Entity, or null. The draft door
         * has already checked the caller may edit for it (scope.editIds).
         * @param {string} entityId
         */
        async findHolderEntity(entityId) {
            if (!entityId) { return null; }
            return prisma.entity.findFirst({
                where: { id: entityId, isDeleted: false },
                select: { id: true, type: true },
            });
        },

        /**
         * Replaces applications.js:288 prisma.application.update (draft save)
         * Replaces applications.js:556 prisma.application.update (prepare)
         * Replaces applications.js:591 prisma.application.update (upload draft doc)
         * Replaces applications.js:627 prisma.application.update (delete draft doc)
         *
         * Generic column-scoped update. The applicant-facing wizard routes
         * patch a small set of fields without changing the application's
         * canonical `status` (status transitions must flow through
         * writeApplicationStatus). Keeping this in one place ensures the
         * route can't accidentally widen the column set or skip the
         * select-narrowing the caller specified.
         */
        async updateApplicantDraftColumns(applicationId, data, { select } = {}) {
            const query = { where: { id: applicationId }, data };
            if (select) {
                query.select = select;
            }
            return prisma.application.update(query);
        },

        /**
         * autosave-lost-reply (C1, fix round 2): the wizard's draft save, in order and merged
         * onto the row as it is NOW.
         *
         * `clock` is `{ session, seq }` sent by the wizard beside applicationId. The last one
         * applied lives in the application's own `formData.draftSaveClock` (the JSON the draft
         * door already stamps with lastDraftSavedAt / lastDraftStep), so no schema change.
         *
         * One transaction, one connection:
         *   1. lock the row (SELECT ... FOR UPDATE) and read the columns the merge starts from;
         *   2. refuse (409 DRAFT_OUT_OF_ORDER, nothing written) a seq not newer than the stored
         *      one from the same session; another session is not compared (last writer wins);
         *   3. `compute(freshRow)` builds the write FROM the locked row, so a document upload or
         *      another save that committed after the route's first read is merged, not lost;
         *   4. write with raw SQL on the same transaction.
         * Raw SQL on purpose: a model call (tx.application.update) goes through the tenant
         * extension, which under RLS_SHADOW_GUC=true runs it in its own batch transaction on
         * another connection; that one waits for the lock held here and the save dies (P2028).
         *
         * `options.editIds` is required (Task 8): a row whose holder is not in it is
         * 404 APPLICATION_NOT_FOUND under the lock, nothing written.
         *
         * Returns `{ built }` when compute refused (nothing written), else `{ built, row }`.
         */
        async saveApplicantDraftInOrder(applicationId, clock, compute, options) {
            // Task 8: the raw-SQL write must not bypass the holder rule. The caller
            // passes its scope's editIds; the row's holder is re-checked under the lock.
            const editIds = options && Array.isArray(options.editIds) ? options.editIds : null;
            if (!editIds) {
                throw new TypeError('saveApplicantDraftInOrder: options.editIds (holderScope(req).editIds) is required');
            }
            return prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw`SELECT "formData", "workflowHistory", "serviceType", "areaType", "entityId" FROM applications WHERE id = ${applicationId} FOR UPDATE`;
                const fresh = rows && rows[0];
                if (!fresh || !editIds.includes(fresh.entityId)) {
                    const err = new Error('Application not found');
                    err.statusCode = 404;
                    err.code = 'APPLICATION_NOT_FOUND';
                    throw err;
                }
                const stored = fresh.formData && typeof fresh.formData === 'object' ? fresh.formData.draftSaveClock : null;
                if (stored && stored.session === clock.session && Number(stored.seq) >= clock.seq) {
                    const err = new Error('Draft save is older than the last one applied');
                    err.statusCode = 409;
                    err.code = 'DRAFT_OUT_OF_ORDER';
                    throw err;
                }
                const built = await compute(fresh);
                if (built.refusal) { return { built }; }
                const d = built.data;
                const written = await tx.$queryRaw`UPDATE applications SET
                    "serviceType" = ${d.serviceType},
                    "areaType" = ${d.areaType},
                    "certificationPurpose" = ${d.certificationPurpose},
                    "certificationPurposes" = ${d.certificationPurposes}::text[],
                    "previousCertNumber" = ${d.previousCertNumber},
                    "consentedPDPA" = ${d.consentedPDPA},
                    "formData" = ${JSON.stringify(d.formData)}::jsonb,
                    "workflowHistory" = ${JSON.stringify(d.workflowHistory)}::jsonb,
                    "updatedBy" = ${d.updatedBy},
                    "updatedAt" = NOW()
                    WHERE id = ${applicationId}
                    RETURNING id, "applicationNumber", status::text AS status, "updatedAt"`;
                return { built, row: written[0] };
            }, { timeout: 15000 });
        },

        /**
         * Replaces applications.js:341 prisma.application.findFirst (submit lookup)
         *
         * Submit-time draft lookup. Caller supplies the optional
         * applicationId; the predicate always carries `isDeleted: false`
         * and `healthId` from the resolved identity. Ordered by
         * `updatedAt desc` so the most recent draft wins when no id is
         * supplied.
         */
        async findDraftForSubmit({ applicationId, healthId, holderScope } = {}) {
            // Spec 2026-09-30 §3.1: within the caller's holder scope (no scope =
            // closed, no query). By id: the fragment alone (R2 Task 9). Id-less:
            // the caller's own latest filing (submitterId = the scope's user) within
            // the fragment, the same "own draft" rule as resume (§3.2; R2 Task 12).
            const fragment = applicationHolderWhere({ holderScope });
            if (!fragment) {
                return null;
            }
            if (applicationId) {
                // Exact application requested — look it up by id. The /submit
                // handler then validates THAT application's status (idempotent
                // return for SUBMITTED/PENDING_DOC_FEE, 409 for anything the
                // state machine can't submit from), so no status filter here.
                // R2 Task 9 (spec §3.2 Submit): the fragment alone; who may submit
                // is the submit guard's question (SUBMIT_APPLICATION on the holder).
                return prisma.application.findFirst({
                    where: { id: applicationId, ...fragment, isDeleted: false },
                    orderBy: { updatedAt: 'desc' },
                });
            }
            const submitterId = String(holderScope?.userId || '').trim();
            if (!healthId || !submitterId) {
                return null;
            }
            const where = {
                ...fragment,
                submitterId,
                isDeleted: false,
            };
            // Bug 8.3: id-less fallback picks the applicant's most-recently
            // updated application. Without a status filter it could return a
            // CERTIFIED / EXPIRED / in-review application (touched more
            // recently than the working DRAFT) → a confusing 409 or a wrong
            // idempotent response instead of submitting the actual draft.
            // Restrict to the SOURCE states /submit can transition from
            // (RESUBMIT_TARGET keys in applications.js).
            where.status = { in: ['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING'] };
            return prisma.application.findFirst({
                where,
                orderBy: { updatedAt: 'desc' },
            });
        },

        /**
         * Replaces applications.js:472 prisma.application.findUnique
         *
         * Re-fetch a projected slice of an application after
         * `writeApplicationStatus` has run, since the canonical writer
         * does not expose `select`. Used by the submit endpoint to return
         * `{ id, applicationNumber, status }` to the client.
         */
        async getApplicationSlice(applicationId, { select, holderScope } = {}) {
            // A health door (submit, the applicant's quotation GET/PDF) passes its
            // holder scope after its own ownership gate: findFirst + the fragment
            // (spec 2026-09-30 §3.1). Staff callers and the renewals door (Task 8)
            // pass none and keep findUnique.
            const fragment = applicationHolderWhere({ holderScope });
            if (fragment) {
                const scoped = {
                    where: { id: applicationId, ...fragment },
                };
                if (select) {
                    scoped.select = select;
                }
                return prisma.application.findFirst(scoped);
            }
            const query = { where: { id: applicationId } };
            if (select) {
                query.select = select;
            }
            return prisma.application.findUnique(query);
        },

        /**
         * Replaces applications.js:541 prisma.user.findUnique
         *
         * Fetch the organizationId for a user when the JWT does not already
         * carry one (legacy clients).
         *
         * M1.5 H1 — the sentence that used to end this comment named the
         * entity-service wizard-glue helper behind /prepare's legacy materialise
         * fallback. Both that branch and that helper are gone (spec §H1), so
         * this method has no production caller today; it is kept as the
         * org-resolution primitive rather than deleted in the same wave.
         */
        async findUserOrganizationId(userId) {
            if (!userId) {
                return null;
            }
            const row = await prisma.user.findUnique({
                where: { id: userId },
                select: { organizationId: true },
            });
            return row?.organizationId || null;
        },

        /**
         * Replaces applications.js:209 prisma.user.findUnique (readiness)
         * Replaces applications.js:210 prisma.farm.findMany (readiness)
         * Replaces applications.js:215 prisma.application.findMany (readiness)
         * Plus the optional-chain reads for establishment / document
         * (kept defensive — those models may not exist in the current schema).
         *
         * Assemble the readiness snapshot for the wizard's pre-submit
         * checklist. Returns `{ user, farms, establishments, applications,
         * documents }`. Establishment and Document tables are not part of
         * the current schema in every deploy, so the corresponding queries
         * are wrapped in optional access + catch and default to empty
         * arrays — verified 2026-05-03 via grep of prisma/schema.
         */
        async getApplicantReadinessSnapshot(userId, { canonicalHealthId, holderScope = null } = {}) {
            if (!userId) {
                return {
                    user: null,
                    farms: [],
                    establishments: [],
                    applications: [],
                    documents: [],
                };
            }

            const establishmentsPromise = prisma.establishment?.findMany?.({
                where: { userId },
                select: { id: true, name: true },
            })?.catch?.(() => []) ?? Promise.resolve([]);

            const documentsPromise = prisma.document?.findMany?.({
                where: { userId },
                select: { id: true, type: true, status: true },
            })?.catch?.(() => []) ?? Promise.resolve([]);

            const [user, farms, establishmentsResult, applications, documentsResult] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: userId },
                    select: { firstName: true, lastName: true, idCard: true, accountType: true },
                }),
                prisma.farm.findMany({
                    // A health door passes its holder scope: the farms of its holders
                    // (spec 2026-09-30 §3.1). Without one the owner where stays.
                    where: holderScope && Array.isArray(holderScope.readIds)
                        ? holderReadWhereIfScoped(holderScope, 'Farm')
                        : { ownerId: userId },
                    select: { id: true, farmName: true },
                }),
                establishmentsPromise,
                // Application.healthId FK references User.canonicalId — JWT no longer
                // carries `healthId` (closed in batch 3, PDPA Phase D prep), so the
                // canonical identifier is User.canonicalId.
                canonicalHealthId
                    ? prisma.application.findMany({
                        where: {
                            ...(holderScope && Array.isArray(holderScope.readIds)
                                ? holderReadWhereIfScoped(holderScope, 'Application')
                                : { healthId: canonicalHealthId }),
                            status: { not: 'EXPIRED' },
                        },
                        select: { id: true, status: true },
                        take: 5,
                    })
                    : Promise.resolve([]),
                documentsPromise,
            ]);

            return {
                user,
                farms: Array.isArray(farms) ? farms : [],
                establishments: Array.isArray(establishmentsResult) ? establishmentsResult : [],
                applications: Array.isArray(applications) ? applications : [],
                documents: Array.isArray(documentsResult) ? documentsResult : [],
            };
        },

        /**
         * Replaces applications.js:642 prisma.application.findFirst (draft GET)
         *
         * Fetch the latest open draft for the health user, including the
         * fields the GET /draft endpoint returns. Same predicate as
         * findLatestOpenDraftForHealth — kept as a thin alias because the
         * routes' GET shape is exercised by an explicit test and binding it
         * to a separate name makes the assertion-target call site obvious.
         */
        async getLatestOpenDraftForApplicant(options) {
            return this.findLatestOpenDraftForHealth(options);
        },
    };
}

module.exports = { createApplicationApplicantQueryMethods };
