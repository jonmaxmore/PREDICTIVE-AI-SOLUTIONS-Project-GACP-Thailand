const crypto = require('crypto');

const { prisma } = require('../../../services/prisma-database');
const { getSignatureService } = require('../../../services/crypto/signature-service');
const authModule = require('../../../middleware/auth-middleware');
// B2 (PDPA-LEAK cluster) — `revokedReason` is operator free text a reviewer can
// type a 13-digit national ID into. It is encrypted at rest (prisma-pdpa-extension
// CERTIFICATE_PII_COLUMNS) but the extended client DECRYPTS it back to plaintext
// on read, so these projections would otherwise broadcast the ID on the
// UNAUTHENTICATED /verify endpoint + the partner feeds. Mask any 13-digit run
// before it leaves the projection (keeps the human reason minus the ID).
const { maskThaiIdsInText } = require('../../../utils/field-encryption');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');

const { toCanonicalCertificateNumber, toCertificateSlug } = require('../../../services/certificate-number-display');
const { ECERT_SCHEMA_VERSION } = require('./interoperability-contracts');

const ROUTE_BASE = '/api/interoperability/v1';

const TRUST_STATUS = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  INVALID: 'INVALID',
};

// 'PLANT_UNIT' is deliberately absent: R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking (2026-08-25), so a plant is not a traceable entity — traceability
// resolves to the planting cycle / plot and to the lot.
const TRACEABLE_ENTITY_TYPES = new Set([
  'CERTIFICATE',
  'PLANTING_CYCLE',
  'HARVEST_BATCH',
  'PACKAGING_LOT',
]);

const authenticatePROVIDER = (req, res, next) => {
  if (typeof authModule.authenticateProvider === 'function') {
    return authModule.authenticateProvider(req, res, next);
  }

  return res.status(500).json({
    success: false,
    error: 'Auth middleware not loaded',
  });
};

function requireAdminRole(req, res, next) {
  // Resolve through the RBAC single source of truth rather than comparing the
  // RAW role column against hand-listed spellings. ROLE_ALIASES maps several
  // spellings onto one canonical role, so an enumerated list only admits the
  // ones someone happened to think of: raw 'PLATFORM_OWNER' is a platform_admin
  // but matched none of ADMIN/SUPER_ADMIN/PLATFORM_ADMIN and was refused.
  // normalizeRole also collapses super_admin -> admin, so that case is
  // subsumed rather than dropped, and it returns null for unknown input so this
  // stays fail-closed.
  //
  // PLATFORM_ADMIN is admitted so the cross-tenant operator can reach the
  // revoke route; per-tenant ADMINs remain org-guarded inside the handler
  // (bug 1.2).
  const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
  if (role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM || role === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Forbidden',
    message: 'Admin role is required',
  });
}

function toPositiveInt(value, fallback) {
  const num = Number.parseInt(String(value || ''), 10);
  if (Number.isFinite(num) && num > 0) {
    return num;
  }

  return fallback;
}

function formatIso(value) {
  if (!value) {
    return null;
  }

  try {
    return new Date(value).toISOString();
  } catch (_error) {
    return null;
  }
}

function hashSha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeEntityType(raw) {
  const entityType = String(raw || '').trim().toUpperCase();
  return TRACEABLE_ENTITY_TYPES.has(entityType) ? entityType : null;
}

function computeTrustStatus(certificate) {
  if (!certificate || certificate.isDeleted) {
    return TRUST_STATUS.INVALID;
  }

  const status = String(certificate.status || '').toUpperCase();
  if (status === TRUST_STATUS.REVOKED || certificate.revokedAt || certificate.revokedReason) {
    return TRUST_STATUS.REVOKED;
  }

  if (certificate.expiryDate && new Date(certificate.expiryDate) < new Date()) {
    return TRUST_STATUS.EXPIRED;
  }

  if (status === TRUST_STATUS.ACTIVE) {
    return TRUST_STATUS.ACTIVE;
  }

  return status || TRUST_STATUS.INVALID;
}

function createEvent({
  eventType,
  entityType,
  entityId,
  occurredAt,
  actorType = 'SYSTEM',
  actorId = null,
  payload = {},
  signature = null,
}) {
  const safeOccurredAt = formatIso(occurredAt) || new Date().toISOString();

  return {
    eventId: crypto.randomUUID(),
    eventType,
    entityType,
    entityId: String(entityId || ''),
    occurredAt: safeOccurredAt,
    actorType,
    actorIdHash: actorId ? hashSha256(actorId) : null,
    payload,
    integrity: {
      hash: hashSha256(`${eventType}:${entityType}:${entityId}:${safeOccurredAt}:${JSON.stringify(payload)}`),
      signature,
    },
  };
}

async function fetchCertificateByLookup(certificateNumber) {
  return prisma.certificate.findFirst({
    where: {
      // The paper prints GACP-DTAM-…; the register stores GACP-TH-… (ruling 2026-10-05).
      OR: [{ certificateNumber: toCanonicalCertificateNumber(certificateNumber) }, { id: certificateNumber }, { uuid: certificateNumber }],
      isDeleted: false,
    },
    include: {
      application: {
        select: { id: true, applicationNumber: true, status: true, updatedAt: true },
      },
    },
  });
}

function buildTrustRecord(certificate) {
  const trustStatus = computeTrustStatus(certificate);

  return {
    certificateNumber: certificate.certificateNumber,
    trustStatus,
    issuedDate: formatIso(certificate.issuedDate),
    expiryDate: formatIso(certificate.expiryDate),
    revokedAt: formatIso(certificate.revokedAt),
    revokedReason: maskThaiIdsInText(certificate.revokedReason) || null,
    farm: {
      id: certificate.farmId,
      name: certificate.farmName,
      province: certificate.province || null,
      district: certificate.district || null,
    },
    standard: {
      code: certificate.standardCode || certificate.standardId || 'THAI_GACP',
      name: certificate.standardName || 'GACP',
    },
    verification: {
      verificationCount: certificate.verificationCount || 0,
      lastVerifiedAt: formatIso(certificate.lastVerifiedAt),
    },
    links: {
      verify: `${ROUTE_BASE}/verification?certificateNumber=${encodeURIComponent(toCertificateSlug(certificate.certificateNumber))}`,
      signedEnvelope: `${ROUTE_BASE}/certificates/${encodeURIComponent(toCertificateSlug(certificate.certificateNumber))}/signed-envelope`,
    },
    updatedAt: formatIso(certificate.updatedAt),
  };
}

function buildCertificateEnvelope(certificate, baseUrl) {
  const trustStatus = computeTrustStatus(certificate);

  return {
    schemaVersion: ECERT_SCHEMA_VERSION,
    envelopeType: 'GACP_E_CERTIFICATE',
    id: `urn:dtam:gacp:certificate:${certificate.certificateNumber}`,
    issuer: {
      organization: 'Department of Thai Traditional and Alternative Medicine (DTAM)',
      country: 'TH',
      platform: 'GACP Certification Platform',
    },
    subject: {
      certificateNumber: certificate.certificateNumber,
      applicantName: certificate.applicantName,
      farmName: certificate.farmName,
      cropType: certificate.cropType,
      userIdHash: hashSha256(certificate.userId),
      // M1 (plan D12, 2026-08-15) — ADDITIVE ONLY. The holder of the
      // certificate is the farm/entity; `applicantName` above keeps its old
      // name and its old value so no partner integration breaks. Emitted as
      // null (never dropped) for rows issued before the M1 backfill, so the
      // envelope shape is the same for every certificate.
      holderDisplayName: certificate.holderDisplayName ?? null,
      holderType: certificate.holderType ?? null,
    },
    certificate: {
      trustStatus,
      issuedDate: formatIso(certificate.issuedDate),
      expiryDate: formatIso(certificate.expiryDate),
      revokedAt: formatIso(certificate.revokedAt),
      revokedReason: maskThaiIdsInText(certificate.revokedReason) || null,
      standard: {
        code: certificate.standardCode || certificate.standardId || 'THAI_GACP',
        name: certificate.standardName || 'GACP',
      },
      location: {
        province: certificate.province || null,
        district: certificate.district || null,
        subDistrict: certificate.subDistrict || null,
      },
    },
    links: {
      verify: `${baseUrl}${ROUTE_BASE}/verification?certificateNumber=${encodeURIComponent(toCertificateSlug(certificate.certificateNumber))}`,
      trustRegistry: `${baseUrl}${ROUTE_BASE}/trust/registry`,
      revocations: `${baseUrl}${ROUTE_BASE}/trust/revocations`,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function signEnvelope(envelope) {
  const signatureService = getSignatureService();
  const serialized = JSON.stringify(envelope);
  const envelopeHash = hashSha256(serialized);
  const signature = await signatureService.sign(envelopeHash);
  const publicKey = await signatureService.getPublicKey();
  const publicKeyFingerprint = hashSha256(publicKey);

  return {
    envelopeHash,
    signature,
    signatureAlgorithm: 'RSA-SHA256',
    publicKey,
    publicKeyFingerprint,
  };
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = {
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
  createEvent,
  fetchCertificateByLookup,
  buildTrustRecord,
  buildCertificateEnvelope,
  signEnvelope,
  getBaseUrl,
};
