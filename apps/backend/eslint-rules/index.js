/**
 * gacp local ESLint plugin — Phase A6 §A6-1 module-boundary rule.
 *
 * Exposes rules under the `gacp/` prefix in eslint.config.js:
 *
 *   const gacp = require('./eslint-rules/index.js');
 *   { plugins: { gacp }, rules: { 'gacp/no-cross-module-internal': 'warn' } }
 */

'use strict';

module.exports = {
    rules: {
        'no-cross-module-internal': require('./no-cross-module-internal'),
        'no-direct-application-status-write': require('./no-direct-application-status-write'),
        'no-direct-audit-or-notification-write': require('./no-direct-audit-or-notification-write'),
        'no-legacy-status-vocabulary': require('./no-legacy-status-vocabulary'),
    },
};
