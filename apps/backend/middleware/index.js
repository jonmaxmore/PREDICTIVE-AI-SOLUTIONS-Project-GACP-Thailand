/**
 * Middleware Index
 *
 * Centralizes active middleware exports.
 * Dead code removed during v3.0.0 audit — 25 unused middleware files deleted.
 */
const authMiddleware = require('./auth-middleware');
const roleMiddleware = require('./role-middleware');

module.exports = {
  auth: authMiddleware,
  role: roleMiddleware,
  // Legacy export alias kept for compatibility with older imports.
  inspectorAuth: roleMiddleware.auditorOnly,
};
