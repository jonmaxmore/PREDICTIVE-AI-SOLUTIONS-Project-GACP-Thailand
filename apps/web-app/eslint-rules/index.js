/**
 * gacp local ESLint plugin — Phase A5 §4.3 + future custom rules.
 *
 * Exposes rules under the `gacp/` prefix in eslint.config.mjs:
 *
 *   import gacp from './eslint-rules/index.js';
 *   {
 *     plugins: { gacp },
 *     rules: { 'gacp/no-raw-color': 'warn' }
 *   }
 */

'use strict';

module.exports = {
  rules: {
    'no-raw-color': require('./no-raw-color'),
    'no-thai-letterspacing': require('./no-thai-letterspacing'),
  },
};
