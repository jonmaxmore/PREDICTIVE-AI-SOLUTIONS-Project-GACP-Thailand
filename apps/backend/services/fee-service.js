/**
 * Re-export shim — Phase A6 §A6-2 (2026-04-29).
 *
 * The canonical home for fee calculation is now
 * `apps/backend/modules/billing/internal/fee-service.js`. Public exports
 * live behind the `apps/backend/modules/billing` barrel.
 *
 * This shim exists so the ~10 existing consumers that
 * `require('../services/fee-service')` keep working without an
 * all-or-nothing rewrite. New code MUST import the barrel directly:
 *
 *   const { calculatePhase1Fee } = require('../modules/billing');
 *
 * The shim will be deleted once the per-consumer migration is complete
 * (planned: PR-A6-2.6 after the next backlog drain).
 */

'use strict';

module.exports = require('../modules/billing');
