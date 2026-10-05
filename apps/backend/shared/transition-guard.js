/**
 * Application status transition guard
 * Wraps status-machine.js validateTransition for safe status mutations
 *
 * Usage:
 *   const { guardTransition } = require('../shared/transition-guard');
 *   await guardTransition(prisma, applicationId, newStatus, 'application');
 */

const { validateTransition, InvalidTransitionError } = require('./status-machine');
const logger = require('../shared/logger');

/**
 * Safely validate and log an application status transition.
 * Throws InvalidTransitionError if the transition is not allowed.
 *
 * @param {import('@prisma/client').PrismaClient} db - Prisma client (or tx)
 * @param {string} applicationId - Application ID
 * @param {string} newStatus - Target status
 * @param {string} [entity='application'] - Entity type in status-machine
 * @returns {Promise<{currentStatus: string, newStatus: string}>} The validated transition
 */
async function guardTransition(db, applicationId, newStatus, entity = 'application') {
    const app = await db.application.findUnique({
        where: { id: applicationId },
        select: { status: true },
    });

    if (!app) {
        throw new Error(`Application ${applicationId} not found`);
    }

    const currentStatus = String(app.status || '').toLowerCase();
    const targetStatus = String(newStatus || '').toLowerCase();

    try {
        validateTransition(entity, currentStatus, targetStatus);
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            logger.warn('[TransitionGuard] Invalid transition blocked', {
                applicationId,
                entity,
                from: currentStatus,
                to: targetStatus,
                allowed: error.allowedTransitions,
            });
        }
        throw error;
    }

    logger.info('[TransitionGuard] Transition validated', {
        applicationId,
        entity,
        from: currentStatus,
        to: targetStatus,
    });

    return { currentStatus, newStatus: targetStatus };
}

module.exports = { guardTransition };
