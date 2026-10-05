/**
 * Routes: /api/provider/admin/work-config/*
 *
 * Admin-only management of WorkActivity orchestration config (ADR-016 Phase 1D).
 *
 *   GET    /                             — full config dump (stage configs + SLA policies)
 *   POST   /stage-configs                — create new stage activity config
 *   PUT    /stage-configs/:id            — update one (label, isActive, etc.)
 *   DELETE /stage-configs/:id            — remove one
 *   PUT    /sla-policies/:workType       — update SLA hours
 *
 * Every mutation writes an AuditLog row (category=ADMIN) so changes
 * are traceable. There's no DELETE for sla_policies — workType is the
 * identifier and removing it would orphan future activities; instead
 * set isActive=false via PUT.
 *
 * Validation: workflow stages constrained to WORKFLOW_STATES; canonical
 * group constrained via normalizeRole; targetHours bounded [1, 8760]
 * (1h .. 1y) so a typo doesn't disable SLAs by setting target=0.
 */

'use strict';

const express = require('express');
const {
    authenticateProvider,
    logger,
} = require('./handlers/shared');
const { CANONICAL_ROLES, normalizeRole } = require('../../../shared/canonical-rbac');
const { WORKFLOW_STATES } = require('../../../services/workflow-transition-service');
const { auditLogger, AuditCategory, ResourceType, AuditSeverity } = require('../../../middleware/audit-logger');
const { getRequestIp } = require('../../../utils/client-ip');
const { respondError } = require('../../../shared/api-response');
// Batch 14 (2026-05-16): the work-config tables (StageActivityConfig + SlaPolicy)
// are owned by services/work-config-service.js; this route should never reach
// for the Prisma client directly. The route still validates inputs and emits
// AuditLog rows for the change — the service layer only persists.
const workConfigService = require('../../../services/work-config-service');

const router = express.Router();
router.use(authenticateProvider);

function requireAdmin(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return res.status(403).json({ success: false, error: 'Admin only' });
    }
    return next();
}
router.use(requireAdmin);

// Bounds for SLA hours: 1h is the floor (anything less is impractical),
// 8760h is one year. Outside this range almost certainly indicates a typo.
const SLA_HOURS_MIN = 1;
const SLA_HOURS_MAX = 8760;

function validateHours(value, fieldName) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < SLA_HOURS_MIN || n > SLA_HOURS_MAX) {
        throw new Error(`${fieldName} must be an integer in [${SLA_HOURS_MIN}, ${SLA_HOURS_MAX}]`);
    }
    return n;
}

function validateOptionalHours(value, fieldName) {
    if (value === null || value === undefined || value === '') {return null;}
    return validateHours(value, fieldName);
}

async function emitAudit(req, action, resourceId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity: AuditSeverity.INFO,
            actorId: req.user.id,
            actorEmail: req.user.email || null,
            actorRole: normalizeRole(req.user.canonicalRole || req.user.role),
            resourceType: ResourceType.SYSTEM,
            resourceId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
            metadata,
        });
    } catch (e) {
        // audit-logger already swallows DB errors and falls back to console;
        // we just guard against unexpected throws so the API stays up.
        logger.warn(`[admin/work-config] audit log failed (non-fatal): ${e?.message}`);
    }
}

router.get('/', async (req, res) => {
    try {
        const [stageConfigs, slaPolicies] = await Promise.all([
            workConfigService.listStageConfigs(),
            workConfigService.listSlaPolicies(),
        ]);
        return res.json({
            success: true,
            data: {
                stageConfigs,
                slaPolicies,
                workflowStages: WORKFLOW_STATES,
                candidateGroups: [
                    // เดิมเป็นคำเปล่า `account` ซึ่งแทน "ฝ่ายบัญชี" ทั้งก้อน ⇒ หลังแยกคำ
                    // ต้องเสนอทั้งสองฝั่ง ไม่ใช่เลือกข้างให้ผู้ดูแลเงียบ ๆ
                    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
                    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
                    CANONICAL_ROLES.DISPATCHER,
                    CANONICAL_ROLES.DOCUMENT_REVIEWER,
                    CANONICAL_ROLES.FIELD_INSPECTOR,
                    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
                ],
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/work-config] list', message: 'Failed to load work config' });
    }
});

router.post('/stage-configs', async (req, res) => {
    try {
        const body = req.body || {};
        const workflowStage = String(body.workflowStage || '').toUpperCase();
        const workType = String(body.workType || '').toUpperCase();
        const candidateGroup = normalizeRole(body.candidateGroup);

        if (!WORKFLOW_STATES.includes(workflowStage)) {
            return res.status(400).json({ success: false, error: `workflowStage must be one of WORKFLOW_STATES` });
        }
        if (!workType || workType.length > 50) {
            return res.status(400).json({ success: false, error: 'workType required (max 50 chars)' });
        }
        if (!candidateGroup) {
            return res.status(400).json({ success: false, error: 'candidateGroup must be a canonical role' });
        }

        const created = await workConfigService.createStageConfig({
            workflowStage,
            workType,
            candidateGroup,
            displayOrder: Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0,
            labelTH: String(body.labelTH || workType).slice(0, 200),
            labelEN: String(body.labelEN || workType).slice(0, 200),
            descriptionTH: body.descriptionTH ? String(body.descriptionTH).slice(0, 1000) : null,
            isActive: body.isActive !== false,
        });

        await emitAudit(req, 'WORK_CONFIG_STAGE_CREATED', created.id, {
            workflowStage, workType, candidateGroup,
        });

        return res.json({ success: true, data: created });
    } catch (e) {
        if (e?.code === 'P2002') {
            return res.status(409).json({
                success: false,
                error: 'A config for this (workflowStage, workType) already exists',
            });
        }
        return respondError(res, req, e, { label: '[admin/work-config] create stage-config', message: 'Failed to create stage config' });
    }
});

router.put('/stage-configs/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const data = {};

        if (body.candidateGroup !== undefined) {
            const cg = normalizeRole(body.candidateGroup);
            if (!cg) {return res.status(400).json({ success: false, error: 'candidateGroup must be a canonical role' });}
            data.candidateGroup = cg;
        }
        if (body.displayOrder !== undefined) {data.displayOrder = Number(body.displayOrder) || 0;}
        if (body.labelTH !== undefined) {data.labelTH = String(body.labelTH).slice(0, 200);}
        if (body.labelEN !== undefined) {data.labelEN = String(body.labelEN).slice(0, 200);}
        if (body.descriptionTH !== undefined) {
            data.descriptionTH = body.descriptionTH ? String(body.descriptionTH).slice(0, 1000) : null;
        }
        if (body.isActive !== undefined) {data.isActive = !!body.isActive;}

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'No editable fields provided' });
        }

        const updated = await workConfigService.updateStageConfig(req.params.id, data);

        await emitAudit(req, 'WORK_CONFIG_STAGE_UPDATED', req.params.id, { changes: data });
        return res.json({ success: true, data: updated });
    } catch (e) {
        if (e?.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Stage config not found' });
        }
        return respondError(res, req, e, { label: '[admin/work-config] update stage-config', message: 'Failed to update stage config' });
    }
});

// Phase 2: bulk export — current state of both tables in one JSON.
router.get('/export', async (req, res) => {
    try {
        const [stageConfigs, slaPolicies] = await Promise.all([
            workConfigService.exportStageConfigs(),
            workConfigService.exportSlaPolicies(),
        ]);
        return res.json({
            success: true,
            data: { exportedAt: new Date().toISOString(), stageConfigs, slaPolicies },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/work-config] export', message: 'Failed to export work config' });
    }
});

// Phase 2: bulk import — upsert by unique key. Never deletes; admins
// remove rows via the individual DELETE endpoint. Atomic per-table:
// either the whole import succeeds or none of it lands.
router.post('/import', async (req, res) => {
    try {
        const body = req.body || {};
        const stageConfigs = Array.isArray(body.stageConfigs) ? body.stageConfigs : [];
        const slaPolicies = Array.isArray(body.slaPolicies) ? body.slaPolicies : [];

        if (stageConfigs.length === 0 && slaPolicies.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Body must include non-empty stageConfigs[] or slaPolicies[]',
            });
        }

        // Pre-validate before opening the transaction so a single bad row
        // can't leave us with a partial commit attempt.
        for (const sc of stageConfigs) {
            if (!WORKFLOW_STATES.includes(String(sc.workflowStage || '').toUpperCase())) {
                return res.status(400).json({
                    success: false,
                    error: `stageConfigs: workflowStage "${sc.workflowStage}" not in WORKFLOW_STATES`,
                });
            }
            const cg = normalizeRole(sc.candidateGroup);
            if (!cg) {
                return res.status(400).json({
                    success: false,
                    error: `stageConfigs: candidateGroup "${sc.candidateGroup}" is not a canonical role`,
                });
            }
        }
        for (const sp of slaPolicies) {
            try {
                if (sp.targetHours !== undefined) {validateHours(sp.targetHours, 'targetHours');}
                if (sp.warningHours !== undefined && sp.warningHours !== null) {validateHours(sp.warningHours, 'warningHours');}
                if (sp.escalationHours !== undefined && sp.escalationHours !== null) {validateHours(sp.escalationHours, 'escalationHours');}
                if (sp.warningHours != null && sp.targetHours != null && sp.warningHours >= sp.targetHours) {
                    throw new Error(`slaPolicies[${sp.workType}]: warningHours must be < targetHours`);
                }
            } catch (vErr) {
                return res.status(400).json({ success: false, error: vErr.message });
            }
        }

        // Pre-shape each row in the route layer (where the canonical-role
        // mapping lives via normalizeRole). The service performs the upsert
        // verbatim inside a single $transaction so a half-apply cannot
        // leave the work-config tables inconsistent (see service header).
        const stagePayload = stageConfigs.map((sc) => {
            const workflowStage = String(sc.workflowStage).toUpperCase();
            const workType = String(sc.workType).toUpperCase();
            const sharedColumns = {
                candidateGroup: normalizeRole(sc.candidateGroup),
                displayOrder: Number(sc.displayOrder) || 0,
                labelTH: String(sc.labelTH || workType).slice(0, 200),
                labelEN: String(sc.labelEN || workType).slice(0, 200),
                descriptionTH: sc.descriptionTH ? String(sc.descriptionTH).slice(0, 1000) : null,
                isActive: sc.isActive !== false,
            };
            return {
                workflowStage,
                workType,
                createData: { workflowStage, workType, ...sharedColumns },
                updateData: { ...sharedColumns },
            };
        });
        const slaPayload = slaPolicies.map((sp) => {
            const workType = String(sp.workType).toUpperCase();
            return {
                workType,
                createData: {
                    workType,
                    targetHours: Number(sp.targetHours) || 24,
                    warningHours: sp.warningHours == null ? null : Number(sp.warningHours),
                    escalationHours: sp.escalationHours == null ? null : Number(sp.escalationHours),
                    labelTH: String(sp.labelTH || workType).slice(0, 200),
                    labelEN: String(sp.labelEN || workType).slice(0, 200),
                    isActive: sp.isActive !== false,
                },
                updateData: {
                    targetHours: sp.targetHours == null ? undefined : Number(sp.targetHours),
                    warningHours: sp.warningHours === undefined ? undefined : (sp.warningHours == null ? null : Number(sp.warningHours)),
                    escalationHours: sp.escalationHours === undefined ? undefined : (sp.escalationHours == null ? null : Number(sp.escalationHours)),
                    labelTH: sp.labelTH == null ? undefined : String(sp.labelTH).slice(0, 200),
                    labelEN: sp.labelEN == null ? undefined : String(sp.labelEN).slice(0, 200),
                    isActive: sp.isActive === undefined ? undefined : !!sp.isActive,
                },
            };
        });
        const result = await workConfigService.bulkImportConfigs({
            stageConfigs: stagePayload,
            slaPolicies: slaPayload,
        });

        await emitAudit(req, 'WORK_CONFIG_BULK_IMPORTED', null, {
            stagesUpserted: result.stagesUpserted,
            slaUpserted: result.slaUpserted,
        });

        return res.json({ success: true, data: result });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/work-config] import', message: 'Failed to import work config' });
    }
});

router.delete('/stage-configs/:id', async (req, res) => {
    try {
        const existing = await workConfigService.findStageConfigById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Stage config not found' });
        }
        await workConfigService.deleteStageConfig(req.params.id);
        await emitAudit(req, 'WORK_CONFIG_STAGE_DELETED', existing.id, {
            workflowStage: existing.workflowStage,
            workType: existing.workType,
        });
        return res.json({ success: true });
    } catch (e) {
        return respondError(res, req, e, { label: '[admin/work-config] delete stage-config', message: 'Failed to delete stage config' });
    }
});

router.put('/sla-policies/:workType', async (req, res) => {
    try {
        const workType = String(req.params.workType || '').toUpperCase();
        const body = req.body || {};
        const data = {};

        if (body.targetHours !== undefined) {
            data.targetHours = validateHours(body.targetHours, 'targetHours');
        }
        if (body.warningHours !== undefined) {
            data.warningHours = validateOptionalHours(body.warningHours, 'warningHours');
        }
        if (body.escalationHours !== undefined) {
            data.escalationHours = validateOptionalHours(body.escalationHours, 'escalationHours');
        }
        if (body.labelTH !== undefined) {data.labelTH = String(body.labelTH).slice(0, 200);}
        if (body.labelEN !== undefined) {data.labelEN = String(body.labelEN).slice(0, 200);}
        if (body.isActive !== undefined) {data.isActive = !!body.isActive;}

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: 'No editable fields provided' });
        }

        // Cross-field check: warning must be earlier than target.
        if (data.warningHours != null && data.targetHours != null && data.warningHours >= data.targetHours) {
            return res.status(400).json({
                success: false,
                error: 'warningHours must be < targetHours',
            });
        }

        const updated = await workConfigService.updateSlaPolicy(workType, data);
        await emitAudit(req, 'WORK_CONFIG_SLA_UPDATED', updated.id, { workType, changes: data });
        return res.json({ success: true, data: updated });
    } catch (e) {
        if (e?.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'SLA policy not found for this workType' });
        }
        if (/must be/.test(e.message)) {
            return res.status(400).json({ success: false, error: e.message });
        }
        return respondError(res, req, e, { label: '[admin/work-config] update sla-policy', message: 'Failed to update SLA policy' });
    }
});

module.exports = router;
