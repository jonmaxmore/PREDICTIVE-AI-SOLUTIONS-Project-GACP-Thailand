'use strict';

/**
 * Regression — fraud doc-scan must NOT include the non-existent `farm` relation
 * on model Application.
 *
 * Application has only `documents ApplicationDocument[]` (application.prisma) — no
 * `farm` / `farmId`. verifyDocument() used to `include: { application: { include:
 * { farm: true, documents: true } } }`, which threw PrismaClientValidationError
 * ("Unknown field `farm` for include statement on model Application") for EVERY
 * document. That made GET /api/v1/fraud-detection/applications/:id/documents return
 * 400 once any application_documents row existed (PR #318 lifted the old 501 and
 * uncovered this latent bug; staging UAT 2026-06-08 reproduced it with a real row).
 *
 * The GPS-vs-farm anomaly check in _analyzeMetadata reads
 * `document.application?.farm?.latitude` with optional chaining, so dropping the
 * include is safe (that check is dormant until the real farm linkage is wired).
 *
 * This pins the corrected include shape so the field-mismatch can't regress.
 */

const { createFraudDocumentVerificationMethods } = require('../../services/fraud-detection/document-verification-methods');

function makeMethods() {
  const findUnique = jest.fn().mockResolvedValue(null); // null → verifyDocument returns early after the query
  const prisma = { applicationDocument: { findUnique } };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const methods = createFraudDocumentVerificationMethods({
    prisma,
    logger,
    fs: require('fs'),
    path: require('path'),
    crypto: require('crypto'),
    calculateDistance: () => 0,
  });
  // ensureLibraries loads optional native libs (exif-parser, sharp); stub it so
  // the test exercises only the query shape.
  methods.ensureLibraries = async () => {};
  return { methods, findUnique };
}

describe('fraud verifyDocument — Application include field-mismatch guard', () => {
  it('includes application.documents but NOT the non-existent application.farm', async () => {
    const { methods, findUnique } = makeMethods();

    const res = await methods.verifyDocument('doc-1');

    expect(findUnique).toHaveBeenCalledTimes(1);
    const arg = findUnique.mock.calls[0][0];
    const appInclude = arg.include.application.include;
    expect(appInclude).toHaveProperty('documents', true);
    expect(appInclude).not.toHaveProperty('farm'); // <- the bug: Application has no `farm` relation
    // null document → graceful early return, never throws
    expect(res).toEqual({ error: 'Document not found' });
  });
});
