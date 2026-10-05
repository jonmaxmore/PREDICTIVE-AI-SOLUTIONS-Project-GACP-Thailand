/**
 * Component: Application Submission Methods
 * Extracted from wizard-controller to enforce Service-Layer Architecture.
 */
const { getEntityContext } = require('../entity-context');
const { AREA_UNIT } = require('../../shared/area-utils');
const { normalizeCultivationMethod, mostControlledMethod } = require('../../shared/cultivation-method');
const { submittedAreaSqm } = require('../certificate/submitted-area');
// ONE map from a filing's own answers to the Farm columns that describe a place, shared
// with the v2 submit door (routes/api/applications/applications.js POST /submit). Two
// copies of it is how F-QA-06 happened: this door minted the farm, that one did not, and
// the certificate — which reads the FARM, never formData — had no place to name.
const { readFilingSite } = require('./application-farm-materialization');
const { localYear } = require('../../utils/working-days');

function createApplicationSubmissionMethods({ prisma, feeService, logger: _logger }) {
    return {
        /**
         * Submits a GACP application, executing transactions for User, Farm, Plots, and App creation.
         * @param {string} userId - ID of the creating user
         * @param {string} actorHealthId - Health ID of the creator
         * @param {object} payload - The normalized JSON payload payload from the wizard
         */
        async executeWizardSubmission(userId, actorHealthId, payload) {
            const {
                applicantData,
                farmData,
                plots,
                documents,
                locationType,
                cultivationMethods,
            } = payload;
            
            const fees = feeService.calculateApplicationFees(payload || {});
            // Where this filing says it is. Read through the shared map so this door and
            // the v2 door cannot drift apart on which key holds the address.
            const site = readFilingSite(payload);

            // Transaction: User -> Farm -> Plots -> Application -> Delete Draft
            const newApp = await prisma.$transaction(async (tx) => {
                // 1. Update User Profile if needed (Address, etc.)
                if (applicantData) {
                    await tx.user.update({
                        where: { id: userId },
                        data: {
                            address: applicantData.address,
                            province: applicantData.province,
                            district: applicantData.district,
                            subdistrict: applicantData.subdistrict,
                            zipCode: applicantData.postalCode,
                            firstName: applicantData.firstName,
                            lastName: applicantData.lastName,
                            phoneNumber: applicantData.phone,
                        },
                    });
                }

                // 2. Create/Update Farm
                // Wave A chunk 2 — stamp the workspace dimension. The ALS
                // entity context propagates from the route (bindScopes)
                // through the $transaction callback; null-safe for headless
                // callers (scripts/tests) where no scope is bound.
                const newFarm = await tx.farm.create({
                    data: {
                        ownerId: userId,
                        entityId: getEntityContext()?.entityId || null,
                        farmName: site.farmName || 'My GACP Farm',
                        farmType: 'CULTIVATION',
                        // `|| undefined`, not `|| ''`: these four are NOT NULL columns and
                        // this door has always let Prisma REFUSE a filing that states no
                        // address rather than birth a farm with blanks in it. The shared
                        // map answers '' for "not stated", so the refusal is preserved
                        // explicitly instead of being downgraded into a silent blank row.
                        address: site.address || undefined,
                        province: site.province || undefined,
                        district: site.district || undefined,
                        subDistrict: site.subDistrict || undefined,
                        postalCode: site.postalCode || undefined,
                        // NULL when the farmer gave no coordinates — never 0. `parseFloat(x || 0)`
                        // turned "not provided" into 0°N 0°E, a real point in the Gulf of Guinea,
                        // and every downstream reader (GPS check-in tolerance, per-photo distance)
                        // would then have compared a Thai farm against West Africa and called it
                        // 9,000 km off. A missing value must read as missing (F-G4-33).
                        // Both halves or neither now that the pair comes from the shared map:
                        // a farm with a latitude and no longitude is unlocated, not
                        // half-located (shared/coordinates.js).
                        latitude: site.latitude,
                        longitude: site.longitude,
                        // Square metres. The wizard collects them; drafts started
                        // before the switch carry their own unit and are read with
                        // it rather than reinterpreted.
                        totalArea: submittedAreaSqm(farmData.totalAreaSize, farmData.totalAreaUnit || AREA_UNIT, 'farmData.totalAreaSize'),
                        cultivationArea: submittedAreaSqm(farmData.totalAreaSize, farmData.totalAreaUnit || AREA_UNIT, 'farmData.totalAreaSize'),
                        areaUnit: AREA_UNIT,
                        cultivationMethod: cultivationMethods?.[0] || 'outdoor',
                        soilType: farmData.soilType,
                        waterSource: farmData.waterSource,
                        landDocuments: farmData.documents ? JSON.stringify(farmData.documents) : undefined,
                        status: 'ACTIVE',
                    },
                });

                // 3. Create Plots — one insert for the whole wizard batch.
                if (plots && plots.length > 0) {
                    await tx.plot.createMany({
                        data: plots.map((plot) => {
                            const sqm = submittedAreaSqm(plot.areaSize, plot.areaUnit || AREA_UNIT, 'plot.areaSize');
                            return {
                                farmId: newFarm.id,
                                name: plot.name,
                                areaSqm: sqm,
                                // `area` + `areaUnit` are the retired pair, written
                                // from the same converted number so a process still
                                // serving the previous image reads a correct plot;
                                // the contract migration drops both.
                                area: sqm,
                                areaUnit: AREA_UNIT,
                                solarSystem: 'OUTDOOR',
                            };
                        }),
                    });
                }

                // 4. Create Application
                const submissionTimestamp = new Date().toISOString();
                
                // STRICT DTO MAPPING (Preventing Blind Mass Assignment)
                const strictFormData = {
                    applicantData: {
                        firstName: String(applicantData?.firstName || ''),
                        lastName: String(applicantData?.lastName || ''),
                        phone: String(applicantData?.phone || ''),
                        address: String(applicantData?.address || ''),
                        province: String(applicantData?.province || ''),
                        district: String(applicantData?.district || ''),
                        subdistrict: String(applicantData?.subdistrict || ''),
                        postalCode: String(applicantData?.postalCode || ''),
                    },
                    farmData: {
                        id: newFarm.id,
                        farmName: String(farmData?.farmName || ''),
                        totalAreaSize: parseFloat(farmData?.totalAreaSize || 0),
                        gpsLat: parseFloat(farmData?.gpsLat || 0),
                        gpsLng: parseFloat(farmData?.gpsLng || 0),
                    },
                    plots: Array.isArray(plots) ? plots.map(p => ({
                        name: String(p.name || ''),
                        areaSize: parseFloat(p.areaSize || 0),
                    })) : [],
                    // Null when the applicant stated nothing, so downstream can
                    // tell "not answered" from "outdoor". It used to be the
                    // latter for every application the web wizard submitted.
                    locationType: normalizeCultivationMethod(locationType)
                        || mostControlledMethod(cultivationMethods)
                        || null,
                    cultivationMethods: Array.isArray(cultivationMethods) ? cultivationMethods.map(String) : [],
                };

                const app = await tx.application.create({
                    data: {
                        applicationNumber: `APP-${localYear()}-${Date.now().toString().substr(-6)}`,
                        healthId: actorHealthId,
                        // Wave A fix S3 — stamp the workspace dimension from the
                        // same ALS context the farm stamp above uses (flag-dead
                        // path today; consistency so a later enable does not
                        // birth entityId=null applications). Null-safe.
                        entityId: getEntityContext()?.entityId || null,
                        phase1Status: 'PENDING',
                        phase1Amount: fees.phase1.total,
                        phase2Amount: fees.phase2.total,
                        areaType: strictFormData.locationType,
                        cultivationScopeCount: fees.scopeCount,
                        // `totalAreaTypes` is the retired name for the same
                        // number. Written in step so a process still serving the
                        // previous image prices correctly; the contract migration
                        // drops it.
                        totalAreaTypes: fees.scopeCount,
                        // Canonical SSOT state. This wrote 'PAYMENT_1_PENDING'
                        // until PR 2b — a string that is in no WORKFLOW_STATES
                        // entry, so every wizard submission landed in the
                        // database needing STATE_BY_LEGACY_STATUS to be read
                        // back correctly. The alias meant the same thing
                        // ('PENDING_DOC_FEE'); it just could not be written
                        // down anywhere the state machine could see it.
                        status: 'PENDING_DOC_FEE',
                        workflowHistory: [
                            {
                                timestamp: submissionTimestamp,
                                action: 'APPLICATION_PREPARED',
                                fromStatus: null,
                                toStatus: 'PENDING_DOC_FEE',
                                actorId: userId,
                                source: 'WIZARD',
                                amount: fees.phase1.total,
                                scopeCount: fees.scopeCount,
                            },
                        ],
                        formData: strictFormData,
                        personnelHygiene: applicantData?.personnelHygiene ? JSON.stringify(applicantData.personnelHygiene) : undefined,
                        attachments: Array.isArray(documents) ? documents : undefined,
                    },
                });

                // 5. Delete Draft
                await tx.applicationDraft.deleteMany({
                    where: {
                        userId: userId,
                        status: 'DRAFT',
                    },
                });

                return app;
            });
            
            return newApp;
        },
    };
}

module.exports = { createApplicationSubmissionMethods };
