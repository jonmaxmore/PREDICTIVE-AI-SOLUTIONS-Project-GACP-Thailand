'use strict';

/**
 * The notes-substring tags that mark the RETIRED per-phase preview documents
 * (the PHASE_1 state / platform quote+invoice pair of F-G4-35).
 *
 * They live in their own module, apart from preview-financial-utils.js, for one
 * reason: preview-financial-utils.js requires services/prisma-database, which
 * constructs a real PrismaClient — and, through @prisma/client, loads
 * apps/backend/.env into process.env. Anything that only wants to KNOW the tags
 * (the C05 evidence walk reads them to find the same rows the page's liveness
 * rule judges) would otherwise have to pay for a database client and an env
 * leak to learn two string constants. Two independently typed copies of a
 * notes tag is the other way to pay, and that one is worse: writer and reader
 * would drift silently and the reader would simply stop finding rows.
 *
 * Dependency-free on purpose. Keep it that way.
 */

const PHASE1_STATE_PREVIEW_TAG = 'AUTO_PHASE_1_STATE_PREVIEW';
const PHASE1_PLATFORM_PREVIEW_TAG = 'AUTO_PHASE_1_PLATFORM_PREVIEW';

module.exports = {
  PHASE1_STATE_PREVIEW_TAG,
  PHASE1_PLATFORM_PREVIEW_TAG,
};
