const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();

const logger = require('../../../shared/logger');
const { getSignatureService } = require('../../../services/crypto/signature-service');

const {
  TRACEABILITY_EVENT_CONTRACT_VERSION,
  ECERT_SCHEMA_VERSION,
  buildTraceabilitySchema,
  buildTraceEventContract,
} = require('../interoperability/interoperability-contracts');

const {
  prisma,
  ROUTE_BASE,
  TRUST_STATUS,
  authenticatePROVIDER,
  requireAdminRole,
  toPositiveInt,
  formatIso,
  hashSha256,
  normalizeEntityType,
  computeTrustStatus,
  fetchCertificateByLookup,
  buildTrustRecord,
  buildCertificateEnvelope,
  signEnvelope,
  getBaseUrl,
} = require('../interoperability/interoperability-core');

const { collectTraceEvents } = require('../interoperability/interoperability-trace-events');
// B2 (PDPA-LEAK cluster) — mask any 13-digit national ID an operator typed into
// the (decrypted-on-read) revokedReason before it is broadcast on this partner
// revocation feed. Same fix as the buildTrustRecord / buildCertificateEnvelope
// projections in interoperability-core.js.
const { maskThaiIdsInText } = require('../../../utils/field-encryption');

// 1.2 org-guard: revoke goes through the shared service (org-scoped fetch +
// update + soft-delete + audit). crossTenant is resolved from the caller role.
const certificateService = require('../../../services/certificate-service');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');

// Mirror certificates.js isCrossTenantRole — only PLATFORM_ADMIN may act across
// tenants; every per-tenant ADMIN is bounded to its own organizationId.
function isCrossTenantRole(role) {
  return normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM;
}

// SEC-AUDIT-012: the bulk-export / full-envelope endpoints below disclose
// certificate data + PII and are partner-only (per-partner API key) with a
// dedicated rate limit. Single-certificate verification, data contracts, and
// the public key stay public for consumer transparency.
const { requirePartnerApiKey } = require('../../../middleware/partner-api-key');
const { createRateLimiter } = require('../../../middleware/rate-limiter');
const { toCanonicalCertificateNumber } = require('../../../services/certificate-number-display');
const { publicVerifyLimiter } = require('../../../middleware/public-verify-limiter');
const { getRequestIp } = require('../../../utils/client-ip');
const { recordPartnerAccess } = require('../../../services/partner-access-log');
const { resolveScannedCode } = require('../interoperability/interoperability-resolve');
const interopExportLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'Too many interoperability export requests, please slow down',
  // Runs AFTER requirePartnerApiKey on every partner route, so req.partner is
  // set: each partner gets its own quota per path instead of sharing an
  // IP/NAT bucket (DTAM Next integration, 2026-07-08).
  keyGenerator: (req) => (req.partner?.id ? `partner:${req.partner.id}:${req.path}` : null),
});

// Best-effort partner access audit (fires on response finish; a log fault can
// never fail the request — services/partner-access-log.js never throws, the
// .catch is belt-and-braces). Handlers may stamp res.locals.resolvedEntity*
// to enrich the row.
function partnerAccessLogger(req, res, next) {
  res.on('finish', () => {
    recordPartnerAccess({
      partnerId: req.partner?.id,
      method: req.method,
      path: (req.originalUrl || req.url || '').split('?')[0],
      code: typeof req.query?.code === 'string' ? req.query.code : null,
      entityType: res.locals?.resolvedEntityType || null,
      entityId: res.locals?.resolvedEntityId || null,
      status: res.statusCode,
      ip: getRequestIp(req),
    }).catch(() => {});
  });
  next();
}

router.get('/v1/data-contracts/traceability', (_req, res) => {
  return res.json({
    success: true,
    data: buildTraceabilitySchema(),
  });
});

router.get('/v1/event-contracts/trace-events', (_req, res) => {
  return res.json({
    success: true,
    data: buildTraceEventContract(),
  });
});

router.get('/v1/certificates/:certificateNumber/e-certificate', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  try {
    const certificateNumber = String(req.params.certificateNumber || '').trim();
    const certificate = await fetchCertificateByLookup(certificateNumber);
    if (!certificate) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    const envelope = buildCertificateEnvelope(certificate, getBaseUrl(req));
    const signed = await signEnvelope(envelope);

    // SEC-AUDIT-010: do NOT persist on this read path. The envelope is signed
    // deterministically and returned below; the certificate's integrity hash is
    // set at issuance (certificate-service buildCertificateDocumentHash) and must
    // not be overwritten here with the envelope hash — doing so made the cert
    // read as TAMPERED in certificate-service integrity checks.
    return res.json({
      success: true,
      data: {
        envelope,
        signature: {
          hash: signed.envelopeHash,
          signature: signed.signature,
          signatureAlgorithm: signed.signatureAlgorithm,
          publicKeyFingerprint: signed.publicKeyFingerprint,
        },
      },
    });
  } catch (error) {
    logger.error('[interoperability] e-certificate export error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to export e-certificate') });
  }
});

// Public (no partner key) lookup by number, so it answers only what
// /api/v1/public/verify answers: number, status, dates, and the farm facts
// only while the certificate is active. No farm id, revoke reason, counters or
// links. Rate-limited with the same per-IP limiter as the public door.
function buildPublicTrustRecord(certificate) {
  const record = buildTrustRecord(certificate);
  const active = record.trustStatus === TRUST_STATUS.ACTIVE;
  return {
    certificateNumber: record.certificateNumber,
    trustStatus: record.trustStatus,
    issuedDate: record.issuedDate,
    expiryDate: record.expiryDate,
    farm: active
      ? { name: record.farm.name, province: record.farm.province, district: record.farm.district }
      : null,
  };
}

function sendCertificateVerificationResult(certificate, res) {
  if (!certificate) {
    return res.json({
      success: true,
      valid: false,
      trustStatus: TRUST_STATUS.INVALID,
      reason: 'CERTIFICATE_NOT_FOUND',
    });
  }

  const trustStatus = computeTrustStatus(certificate);
  return res.json({
    success: true,
    valid: trustStatus === TRUST_STATUS.ACTIVE,
    trustStatus,
    data: buildPublicTrustRecord(certificate),
  });
}

// /v1/certificates/:n/verify and /v1/verification/certificate/:n were removed
// (round 3): no caller in apps/web-app or apps/mobile-app, duplicates of this.
router.get('/v1/verification', publicVerifyLimiter, async (req, res) => {
  try {
    const certificateNumber = String(req.query.certificateNumber || '').trim();
    if (!certificateNumber) {
      return res.status(400).json({
        success: false,
        message: 'certificateNumber query parameter is required',
      });
    }

    const certificate = await fetchCertificateByLookup(certificateNumber);
    return sendCertificateVerificationResult(certificate, res);
  } catch (error) {
    logger.error('[interoperability] query verification endpoint error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to verify certificate') });
  }
});

router.get('/v1/certificates/:certificateNumber/signed-envelope', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  try {
    const certificateNumber = String(req.params.certificateNumber || '').trim();
    const certificate = await fetchCertificateByLookup(certificateNumber);
    if (!certificate) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }

    const envelope = buildCertificateEnvelope(certificate, getBaseUrl(req));
    const signed = await signEnvelope(envelope);

    return res.json({
      success: true,
      data: {
        certificateNumber: certificate.certificateNumber,
        envelope,
        signature: {
          hash: signed.envelopeHash,
          signature: signed.signature,
          signatureAlgorithm: signed.signatureAlgorithm,
          publicKey: signed.publicKey,
          publicKeyFingerprint: signed.publicKeyFingerprint,
        },
      },
    });
  } catch (error) {
    logger.error('[interoperability] signed envelope error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to generate signed envelope') });
  }
});

router.post('/v1/signatures/verify', async (req, res) => {
  try {
    const payload = req.body?.payload;
    const payloadHash = String(req.body?.payloadHash || '').trim();
    const signature = String(req.body?.signature || '').trim();

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'signature is required',
      });
    }

    // SECURITY (finding F7): NEVER verify against a caller-supplied public key.
    // This is an unauthenticated public trust-verification oracle; accepting a
    // request-body publicKey lets an attacker self-sign a forged certificate/
    // envelope with their own keypair and have this endpoint return valid:true,
    // defeating authenticity for any partner that trusts it. Always verify
    // against the server's own pinned (DTAM) key by passing no key — verify()
    // falls back to keyCache.public / the KMS key.
    const computedHash = payloadHash || hashSha256(JSON.stringify(payload || {}));
    const signatureService = getSignatureService();
    const valid = await signatureService.verify(computedHash, signature);

    return res.json({
      success: true,
      valid,
      data: {
        hash: computedHash,
        signatureAlgorithm: 'RSA-SHA256',
      },
    });
  } catch (error) {
    logger.error('[interoperability] signature verify error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to verify signature') });
  }
});

router.get('/v1/trust/public-key', async (_req, res) => {
  try {
    const signatureService = getSignatureService();
    const publicKey = await signatureService.getPublicKey();

    return res.json({
      success: true,
      data: {
        publicKey,
        publicKeyFingerprint: hashSha256(publicKey),
        algorithm: 'RSA-SHA256',
      },
    });
  } catch (error) {
    logger.error('[interoperability] public key fetch error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to retrieve public key') });
  }
});

router.get('/v1/trust/registry', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const search = toCanonicalCertificateNumber(String(req.query.search || '').trim());
    const province = String(req.query.province || '').trim();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();

    const where = { isDeleted: false };
    if (search) {
      where.OR = [
        { certificateNumber: { contains: search, mode: 'insensitive' } },
        { farmName: { contains: search, mode: 'insensitive' } },
        { applicantName: { contains: search, mode: 'insensitive' } },
        // M1 (2026-08-15): a partner searching for the company/community
        // enterprise that HOLDS the certificate must find it. Additive — the
        // three columns above still match exactly what they matched before.
        { holderDisplayName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (province) {
      where.province = province;
    }

    const certificates = await prisma.certificate.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { issuedDate: 'desc' }],
      take: 1000,
    });

    let records = certificates.map(buildTrustRecord);
    if (statusFilter) {
      records = records.filter((item) => item.trustStatus === statusFilter);
    }

    const total = records.length;
    const start = (page - 1) * limit;
    const paged = records.slice(start, start + limit);

    return res.json({
      success: true,
      data: paged,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      contract: {
        schemaVersion: ECERT_SCHEMA_VERSION,
      },
    });
  } catch (error) {
    logger.error('[interoperability] trust registry error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to retrieve trust registry') });
  }
});

router.get('/v1/trust/revocations', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  try {
    const since = String(req.query.since || '').trim();
    const limit = Math.min(toPositiveInt(req.query.limit, 100), 500);
    const sinceDate = since ? new Date(since) : null;
    const hasValidSince = sinceDate && !Number.isNaN(sinceDate.getTime());

    const where = {
      isDeleted: false,
      OR: [{ revokedAt: { not: null } }, { status: { in: ['REVOKED', 'revoked'] } }],
    };
    if (hasValidSince) {
      where.AND = [{ revokedAt: { gte: sinceDate } }];
    }

    const revoked = await prisma.certificate.findMany({
      where,
      orderBy: [{ revokedAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        certificateNumber: true,
        revokedAt: true,
        revokedReason: true,
        revokedBy: true,
        updatedAt: true,
        farmName: true,
        province: true,
        district: true,
      },
    });

    return res.json({
      success: true,
      data: revoked.map((item) => ({
        certificateNumber: item.certificateNumber,
        revokedAt: formatIso(item.revokedAt || item.updatedAt),
        revokedReason: maskThaiIdsInText(item.revokedReason) || 'NOT_SPECIFIED',
        revokedByHash: item.revokedBy ? hashSha256(item.revokedBy) : null,
        farmName: item.farmName,
        province: item.province || null,
        district: item.district || null,
      })),
      contract: {
        schemaVersion: ECERT_SCHEMA_VERSION,
        feedType: 'REVOCATION_TRANSPARENCY',
      },
    });
  } catch (error) {
    logger.error('[interoperability] revocation feed error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to retrieve revocation feed') });
  }
});

router.post('/v1/certificates/:certificateNumber/revoke', authenticatePROVIDER, requireAdminRole, async (req, res) => {
  try {
    const certificateNumber = String(req.params.certificateNumber || '').trim();
    const reason = String(req.body?.reason || '').trim() || 'ADMIN_MANUAL_REVOCATION';
    // Certificate.revokedBy/updatedBy are plain scalars (NOT in the PDPA encrypt
    // hook). Drop the req.user.providerId fallback (a decrypted plaintext 13-digit
    // ID) — req.user.id (UUID) is always set for authenticatePROVIDER requests.
    const actorId = String(req.user?.id || 'SYSTEM');

    // 1.2/6.4/7.1: route through the shared service. It applies the ORG-GUARD
    // (per-tenant ADMIN can only revoke its own org's cert — cross-tenant OR
    // missing throws the SAME 404), soft-deletes (frees a replacement cert),
    // and writes the CERTIFICATE_REVOKED audit record.
    const updated = await certificateService.revokeCertificate(certificateNumber, {
      reason,
      actorId,
      callerOrganizationId: req.user?.organizationId || null,
      crossTenant: isCrossTenantRole(req.user?.role),
    });

    return res.json({
      success: true,
      data: {
        certificateNumber: updated.certificateNumber,
        trustStatus: computeTrustStatus(updated),
        revokedAt: formatIso(updated.revokedAt),
        revokedReason: updated.revokedReason,
      },
      links: {
        revocationFeed: `${ROUTE_BASE}/trust/revocations`,
      },
    });
  } catch (error) {
    // Map the service's thrown statusCode (400 missing reason / 404 not-found
    // OR cross-tenant / 409 already revoked) to HTTP. Anything else is a 500.
    const statusCode = Number(error?.statusCode);
    if (statusCode === 404) {
      return res.status(404).json({ success: false, message: 'Certificate not found' });
    }
    if (statusCode === 400) {
      return res.status(400).json({ success: false, message: safeErrorMessage(error, 'Invalid revocation request') });
    }
    if (statusCode === 409) {
      return res.status(409).json({ success: false, message: 'Certificate is already revoked' });
    }
    logger.error('[interoperability] certificate revocation error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to revoke certificate') });
  }
});

// ── Universal code resolver (DTAM Next integration, 2026-07-08) ─────────────
// "What is this scanned code + its provenance?" in ONE call — classifies any
// live identifier shape (cert number, plant code/QR, batch, lot, plot-cycle
// QR, trace URLs) via the documented probe precedence in
// routes/api/interoperability/interoperability-resolve.js. Partner-gated:
// same key + limiter + access log as the other export endpoints.
router.get('/v1/resolve', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  const raw = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!raw) {
    return res.status(400).json({
      success: false,
      code: 'RESOLVE_CODE_REQUIRED',
      error: 'Query parameter `code` is required (a scanned QR payload, URL, or identifier string)',
    });
  }
  try {
    const { result, probed } = await resolveScannedCode(raw);
    if (!result) {
      return res.status(404).json({ success: false, resolved: false, code: raw, probed });
    }
    res.locals.resolvedEntityType = result.matched.entityType;
    res.locals.resolvedEntityId = result.matched.entityId;
    return res.json({ success: true, resolved: true, code: raw, ...result });
  } catch (error) {
    // Fail LOUD (5xx), never a false "not found": DTAM Next must be able to
    // distinguish "unknown code" from "upstream fault".
    logger.error('[interoperability] resolve failed:', error?.message);
    return res.status(500).json({ success: false, error: safeErrorMessage(error), code: 'RESOLVE_FAILED' });
  }
});

router.get('/v1/trace/events/:entityType/:entityId', requirePartnerApiKey, interopExportLimiter, partnerAccessLogger, async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId = String(req.params.entityId || '').trim();

    if (!entityType || !entityId) {
      return res.status(400).json({
        success: false,
        message: 'entityType and entityId are required',
      });
    }

    const events = await collectTraceEvents(entityType, entityId);
    if (!events) {
      return res.status(404).json({ success: false, message: 'Entity not found' });
    }

    return res.json({
      success: true,
      data: {
        contractVersion: TRACEABILITY_EVENT_CONTRACT_VERSION,
        entityType,
        entityId,
        events,
      },
    });
  } catch (error) {
    logger.error('[interoperability] trace event export error', error);
    return res.status(500).json({ success: false, message: safeErrorMessage(error, 'Unable to retrieve trace events') });
  }
});

module.exports = router;
