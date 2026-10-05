'use strict';

/**
 * PATCH /api/provider/applications/:id/form-fields
 *
 * Lets the ASSIGNED document reviewer (or ADMIN) edit the scalar/enum leaf
 * fields of an application in-place from the provider "เอกสารคำขอ (เต็ม)" view,
 * WITHOUT changing the workflow status. This is a data-correction affordance for
 * the reviewer — e.g. fixing an obvious typo in a phone number or selecting the
 * right enum the applicant fat-fingered — so the review can proceed without a
 * full REVISION_REQUESTED round-trip for trivial fixes.
 *
 * V1 scope: SCALAR + ENUM leaf values only. Array/table data (seedSources,
 * productionInputs, plantParts arrays, filtrationTypes, ipmMethods, …) is
 * STRIPPED from the incoming patch and left untouched — those collections are
 * NOT editable in V1 and must keep whatever the applicant submitted.
 *
 * Gates:
 *   - authenticateProvider (mounted on the route)
 *   - RBAC: Application.reviewerId === req.user.id OR canonical role ADMIN.
 *     Anything else → 403.
 *   - State: status ∈ { ASSIGNED_FOR_REVIEW, REVISION_REQUESTED } → else 422
 *     INVALID_STATE (you can only correct fields while the case is in the
 *     reviewer's hands).
 *
 * Audit: one APPLICATION audit row (APPLICATION_FORMDATA_EDITED_BY_REVIEWER)
 * with a diff payload of each changed leaf path (old → new). Best-effort, but
 * the cause is logged loudly (golden rule #3) before any generic catch.
 */

const { CANONICAL_ROLES, normalizeRole } = require('../../../../shared/canonical-rbac');
const { runWithTenantContext } = require('../../../../services/tenant-context');
const { getRequestIp } = require('../../../../utils/client-ip');

const {
    authenticateProvider,
    logger,
    obj,
    resolveUserIdFromHealthId,
} = require('./shared');
const applicationService = require('../../../../services/application-service');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../../middleware/audit-logger');

// The sub-objects of formData a reviewer may patch. Anything outside this set
// (plant/purpose, seed table, inputs table, documents, top-level keys) is
// ignored — V1 only edits §1/§3/§4/§7 scalar+enum fields.
const EDITABLE_SECTION_KEYS = ['applicantData', 'farmData', 'productionData', 'harvestData'];

const EDITABLE_STATES = new Set(['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED']);

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A leaf value we permit to be written: scalar (string/number/boolean) or
 * explicit null (clear a field). Arrays and nested objects are V1-out-of-scope
 * and dropped. `undefined` is also dropped (no-op).
 */
function isEditableLeaf(value) {
    return (
        value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    );
}

/**
 * Sanitise the caller-supplied `changes` into the set of scalar/enum leaves we
 * will deep-merge. Returns the cleaned per-section patch (only the editable
 * sections, only leaf values) plus the list of dropped (array/object) paths for
 * observability. Nested objects ARE recursed one level (e.g.
 * farmData.waterSourceDetail.sourceType) but their array/object children are
 * still dropped.
 */
function sanitizeChanges(changes) {
    const clean = {};
    const droppedPaths = [];

    if (!isPlainObject(changes)) {
        return { clean, droppedPaths };
    }

    for (const sectionKey of EDITABLE_SECTION_KEYS) {
        const section = changes[sectionKey];
        if (!isPlainObject(section)) {
            continue;
        }
        const cleanSection = {};
        for (const [field, value] of Object.entries(section)) {
            if (value === undefined) {
                continue;
            }
            if (isEditableLeaf(value)) {
                cleanSection[field] = value;
                continue;
            }
            if (isPlainObject(value)) {
                // One level of nesting (e.g. waterSourceDetail.sourceType).
                const cleanNested = {};
                for (const [nestedField, nestedValue] of Object.entries(value)) {
                    if (nestedValue === undefined) {
                        continue;
                    }
                    if (isEditableLeaf(nestedValue)) {
                        cleanNested[nestedField] = nestedValue;
                    } else {
                        droppedPaths.push(`${sectionKey}.${field}.${nestedField}`);
                    }
                }
                if (Object.keys(cleanNested).length > 0) {
                    cleanSection[field] = cleanNested;
                }
                continue;
            }
            // Arrays (seedSources, productionInputs, plantParts, …) and other
            // non-leaf values are V1-out-of-scope.
            droppedPaths.push(`${sectionKey}.${field}`);
        }
        if (Object.keys(cleanSection).length > 0) {
            clean[sectionKey] = cleanSection;
        }
    }

    return { clean, droppedPaths };
}

/**
 * Deep-merge the cleaned section patch into the existing formData, preserving
 * everything else (including arrays/tables) and recording the leaf-level diff
 * (path, old → new) of values that actually changed.
 */
function applyChanges(existingFormData, cleanChanges) {
    const next = { ...existingFormData };
    const diff = [];

    for (const [sectionKey, sectionPatch] of Object.entries(cleanChanges)) {
        const existingSection = isPlainObject(existingFormData[sectionKey])
            ? existingFormData[sectionKey]
            : {};
        const mergedSection = { ...existingSection };

        for (const [field, value] of Object.entries(sectionPatch)) {
            if (isPlainObject(value)) {
                const existingNested = isPlainObject(existingSection[field])
                    ? existingSection[field]
                    : {};
                const mergedNested = { ...existingNested };
                for (const [nestedField, nestedValue] of Object.entries(value)) {
                    const oldNested = existingNested[nestedField];
                    if (oldNested !== nestedValue) {
                        diff.push({
                            path: `${sectionKey}.${field}.${nestedField}`,
                            old: oldNested === undefined ? null : oldNested,
                            new: nestedValue,
                        });
                    }
                    mergedNested[nestedField] = nestedValue;
                }
                mergedSection[field] = mergedNested;
                continue;
            }
            const oldValue = existingSection[field];
            if (oldValue !== value) {
                diff.push({
                    path: `${sectionKey}.${field}`,
                    old: oldValue === undefined ? null : oldValue,
                    new: value,
                });
            }
            mergedSection[field] = value;
        }

        next[sectionKey] = mergedSection;
    }

    return { next, diff };
}

const applicationFormFieldsPatch = [
    authenticateProvider,
    async (req, res) => {
        try {
            const applicationId = String(req.params.id || '').trim();
            if (!applicationId) {
                return res.status(400).json({ success: false, error: 'Application id is required' });
            }

            const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
            const isAdmin = canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;

            const { clean, droppedPaths } = sanitizeChanges(req.body?.changes);

            const application = await applicationService.findFirstWithWhere({
                where: {
                    OR: [{ id: applicationId }, { applicationNumber: applicationId }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    reviewerId: true,
                    healthId: true,
                    organizationId: true,
                },
            });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // RBAC: only the assigned reviewer (or ADMIN) may correct fields.
            if (!isAdmin && (!application.reviewerId || application.reviewerId !== req.user.id)) {
                return res.status(403).json({
                    success: false,
                    error: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
                });
            }

            // State gate: editable only while the case is in the reviewer's hands.
            if (!EDITABLE_STATES.has(String(application.status || '').toUpperCase())) {
                return res.status(422).json({
                    success: false,
                    code: 'INVALID_STATE',
                    error: 'แก้ไขข้อมูลคำขอได้เฉพาะระหว่างขั้นตอนตรวจสอบเอกสาร (มอบหมายให้ตรวจ / ขอให้แก้ไข) เท่านั้น',
                });
            }

            if (Object.keys(clean).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'ไม่พบฟิลด์ที่แก้ไขได้ในคำขอที่ส่งมา',
                });
            }

            const existingFormData = obj(application.formData);
            const { next: nextFormData, diff } = applyChanges(existingFormData, clean);

            // No effective change — return current state without a write/audit row.
            if (diff.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        id: application.id,
                        applicationNumber: application.applicationNumber,
                        status: application.status,
                        formData: existingFormData,
                    },
                    meta: { changedFields: 0, droppedPaths },
                });
            }

            nextFormData.lastReviewerEditAt = new Date().toISOString();

            // Persist inside the tenant scope (route already binds it, but make
            // the mutation context explicit so headless/degraded paths are safe —
            // see the project rules tenant-extension note). organizationId is resolved
            // from the application row itself.
            const organizationId = application.organizationId || req.user?.organizationId || null;
            const writeFn = () => applicationService.updateApplicationColumns(
                application.id,
                { formData: nextFormData, updatedBy: req.user.id },
                {
                    select: {
                        id: true,
                        applicationNumber: true,
                        status: true,
                        formData: true,
                        updatedAt: true,
                    },
                },
            );
            const updated = organizationId
                ? await runWithTenantContext({ organizationId }, writeFn)
                : await writeFn();

            // AUDIT — one immutable row carrying the leaf-level diff. Best-effort:
            // log the cause loudly before swallowing so a degraded audit backend
            // never blocks the correction (golden rule #3).
            try {
                const healthUserId = await resolveUserIdFromHealthId(application.healthId).catch(() => null);
                await auditLogger.log({
                    category: AuditCategory.APPLICATION,
                    action: 'APPLICATION_FORMDATA_EDITED_BY_REVIEWER',
                    severity: AuditSeverity.INFO,
                    actorId: req.user.id || 'SYSTEM',
                    actorRole: canonicalRole || req.user.role || 'UNKNOWN',
                    actorType: 'PROVIDER',
                    resourceType: ResourceType.APPLICATION,
                    resourceId: application.id,
                    organizationId,
                    ipAddress: getRequestIp(req),
                    userAgent: req.get('user-agent'),
                    metadata: {
                        applicationNumber: application.applicationNumber,
                        status: application.status,
                        changedFields: diff,
                        droppedPaths,
                        healthUserId: healthUserId || null,
                    },
                });
            } catch (auditError) {
                logger.error('[provider] form-fields edit audit failed', {
                    message: auditError.message,
                    applicationId: application.id,
                });
            }

            logger.info('[provider] reviewer edited application form fields', {
                applicationId: application.id,
                actorId: req.user.id,
                changedFields: diff.length,
            });

            return res.json({
                success: true,
                data: updated,
                meta: { changedFields: diff.length, droppedPaths },
            });
        } catch (error) {
            logger.error('[provider] form-fields edit failed', {
                message: error?.message,
                stack: error?.stack,
            });
            return res.status(500).json({
                success: false,
                error: 'Failed to update application fields',
            });
        }
    },
];

module.exports = {
    applicationFormFieldsPatch,
    // Exported for unit testing the pure transforms.
    sanitizeChanges,
    applyChanges,
    EDITABLE_SECTION_KEYS,
    EDITABLE_STATES,
};
