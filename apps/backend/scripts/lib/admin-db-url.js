'use strict';
// Privileged operator scripts (TRUNCATE/ALTER/DROP) must NOT use the app's
// gacp_app DATABASE_URL after the Phase-1 cutover — gacp_app lacks those rights.
function resolveAdminDbUrl(env = process.env) {
  if (env.ADMIN_DATABASE_URL) { return { url: env.ADMIN_DATABASE_URL, usedFallback: false }; }
  if (env.DATABASE_URL) { return { url: env.DATABASE_URL, usedFallback: true }; }
  throw new Error('resolveAdminDbUrl: set ADMIN_DATABASE_URL (a superuser connection) for privileged maintenance scripts.');
}
module.exports = { resolveAdminDbUrl };
