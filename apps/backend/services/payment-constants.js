/**
 * Re-export shim — Phase A6 §A6-2 (2026-04-29).
 *
 * The canonical home is now
 * `apps/backend/modules/billing/internal/payment-constants.js`. Public
 * exports live behind the `apps/backend/modules/billing` barrel.
 *
 * Keeps existing imports working without a full rewrite:
 *
 *   const { CONFIG, PAYMENT_STATUS } = require('../services/payment-constants');
 *
 * New code should import the barrel:
 *
 *   const { CONFIG } = require('../modules/billing');
 *
 * Shim will be deleted once consumers are migrated.
 */

'use strict';

module.exports = require('../modules/billing');
