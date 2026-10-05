/**
 * Work Config Service
 *
 * Owns read/write access for the work-orchestration config tables introduced
 * by ADR-016 Phase 1D:
 *
 *   - StageActivityConfig — maps each (workflowStage, workType) tuple to the
 *     candidate group that should pick up the activity when the application
 *     enters that stage.
 *   - SlaPolicy — per-workType target / warning / escalation hours for SLA
 *     breach calculations on the WorkActivity rows.
 *
 * Extracted from `routes/api/provider/admin-work-config.js` during the batch 14
 * Prisma-bypass cleanup. Each method header cites the call site it replaces so
 * future auditors can trace the canonical path. Bulk import is wrapped in a
 * single `$transaction` to preserve the "all-or-none" semantics the admin UI
 * relies on (a half-applied import would leave the work-config tables
 * inconsistent and stage routing would silently misroute new activities).
 */

'use strict';

const { prisma } = require('./prisma-database');

// Replaces prisma.stageActivityConfig.findMany at admin-work-config.js:90.
async function listStageConfigs() {
    return prisma.stageActivityConfig.findMany({
        orderBy: [{ workflowStage: 'asc' }, { displayOrder: 'asc' }],
    });
}

// Replaces prisma.slaPolicy.findMany at admin-work-config.js:93.
async function listSlaPolicies() {
    return prisma.slaPolicy.findMany({
        orderBy: { workType: 'asc' },
    });
}

// Replaces prisma.stageActivityConfig.findMany (export shape) at admin-work-config.js:207.
async function exportStageConfigs() {
    return prisma.stageActivityConfig.findMany({
        orderBy: [{ workflowStage: 'asc' }, { displayOrder: 'asc' }],
        select: {
            workflowStage: true,
            workType: true,
            candidateGroup: true,
            displayOrder: true,
            labelTH: true,
            labelEN: true,
            descriptionTH: true,
            isActive: true,
        },
    });
}

// Replaces prisma.slaPolicy.findMany (export shape) at admin-work-config.js:215.
async function exportSlaPolicies() {
    return prisma.slaPolicy.findMany({
        orderBy: { workType: 'asc' },
        select: {
            workType: true,
            targetHours: true,
            warningHours: true,
            escalationHours: true,
            labelTH: true,
            labelEN: true,
            isActive: true,
        },
    });
}

// Replaces prisma.stageActivityConfig.create at admin-work-config.js:135.
async function createStageConfig(data) {
    return prisma.stageActivityConfig.create({ data });
}

// Replaces prisma.stageActivityConfig.update at admin-work-config.js:187.
async function updateStageConfig(id, data) {
    return prisma.stageActivityConfig.update({
        where: { id },
        data,
    });
}

// Replaces prisma.stageActivityConfig.findUnique at admin-work-config.js:349.
async function findStageConfigById(id) {
    return prisma.stageActivityConfig.findUnique({
        where: { id },
        select: { id: true, workflowStage: true, workType: true },
    });
}

// Replaces prisma.stageActivityConfig.delete at admin-work-config.js:356.
async function deleteStageConfig(id) {
    return prisma.stageActivityConfig.delete({ where: { id } });
}

// Replaces prisma.slaPolicy.update at admin-work-config.js:399.
async function updateSlaPolicy(workType, data) {
    return prisma.slaPolicy.update({
        where: { workType },
        data,
    });
}

/**
 * Bulk-upsert stage configs + SLA policies in a single transaction.
 * Replaces the prisma.$transaction at admin-work-config.js:279 (which used
 * tx.stageActivityConfig.upsert + tx.slaPolicy.upsert). The atomicity matters:
 * a partial commit would leave the workflow-activity router inconsistent with
 * the SLA-breach calculator, and breach detection would silently misreport.
 */
async function bulkImportConfigs({ stageConfigs = [], slaPolicies = [] } = {}) {
    return prisma.$transaction(async (tx) => {
        let stagesUpserted = 0;
        let slaUpserted = 0;
        for (const sc of stageConfigs) {
            await tx.stageActivityConfig.upsert({
                where: { workflowStage_workType: { workflowStage: sc.workflowStage, workType: sc.workType } },
                create: sc.createData,
                update: sc.updateData,
            });
            stagesUpserted += 1;
        }
        for (const sp of slaPolicies) {
            await tx.slaPolicy.upsert({
                where: { workType: sp.workType },
                create: sp.createData,
                update: sp.updateData,
            });
            slaUpserted += 1;
        }
        return { stagesUpserted, slaUpserted };
    });
}

module.exports = {
    listStageConfigs,
    listSlaPolicies,
    exportStageConfigs,
    exportSlaPolicies,
    createStageConfig,
    updateStageConfig,
    findStageConfigById,
    deleteStageConfig,
    updateSlaPolicy,
    bulkImportConfigs,
};
