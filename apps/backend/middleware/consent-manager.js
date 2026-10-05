/**
 * Consent Management Service
 * PDPA (Personal Data Protection Act) Compliant
 * 
 * Features:
 * - Granular consent categories
 * - Version tracking
 * - Easy withdrawal
 * - Audit trail integration
 */

const { prisma } = require('../services/prisma-database');
const { auditLogger, AuditCategory } = require('./audit-logger');

// Consent Categories per PDPA
const ConsentCategory = {
    // Required for service (cannot withdraw)
    TERMS_OF_SERVICE: 'TERMS_OF_SERVICE',
    PRIVACY_POLICY: 'PRIVACY_POLICY',

    // Optional (can withdraw anytime)
    MARKETING_EMAIL: 'MARKETING_EMAIL',
    MARKETING_SMS: 'MARKETING_SMS',
    DATA_ANALYTICS: 'DATA_ANALYTICS',
    THIRD_PARTY_SHARING: 'THIRD_PARTY_SHARING',
    LOCATION_TRACKING: 'LOCATION_TRACKING',

    // Q4 pre-payment disclosure (owner ruling 2026-07-08): fee structure +
    // no-refund scope + leniency + platform-fault lane + 5-working-day
    // deadline — acknowledged before every APPLICATION payment-slip upload
    // (subscription slips are intentionally out of the v1 terms scope; gate:
    // payment-slip-service.assertPaymentTermsAcceptedForSlip). Terms text:
    // docs/legal/payment-terms-th-v1.2.md (v1 and v1.1 are SUPERSEDED). NOT in RequiredConsents — it gates
    // payment, not platform access.
    PAYMENT_TERMS: 'PAYMENT_TERMS',
};

// Current versions of consent documents.
//
// Two sources, in this order. A category listed in PUBLISHED_CONSENT_VERSIONS
// (below) defaults to the version of the document PUBLISHED in this repository,
// so publishing and bumping are the same commit; every other category falls
// back to '1.0.0', the historical baseline for documents this repository does
// not hold. The env var `CONSENT_VERSION_<CATEGORY>`
// (e.g. CONSENT_VERSION_PRIVACY_POLICY=2.0.0) OVERRIDES both, and exists for
// pinning a version deliberately — it is not how a new document is rolled out,
// and both env templates ship it commented out for that reason.
// Whichever source wins, recordConsent stamps that version on fresh grants and
// every "is this consent current?" check compares against it.
// PDPA พ.ศ. 2562 มาตรา 19: consent is bound to the specific
// purpose/version it was given for.
const DEFAULT_CONSENT_VERSION = '1.0.0';

// Categories whose document lives in this repository default to the version
// that is PUBLISHED here, not to the historical baseline.
//
// F-G4-64 (2026-08-29): with a single '1.0.0' fallback, publishing
// docs/legal/payment-terms-th-v1.1.md and forgetting the env var on one deploy
// left ConsentVersions.PAYMENT_TERMS at '1.0.0'. Nothing raised, and three
// things quietly went wrong at once: payment-terms-gate.js read every v1-era
// grant as current so nobody re-consented to the corrected price;
// checkout_orders.paymentTermsVersion stamped the superseded version onto the
// money row that is the no-refund evidence; and the document's own promise to
// the applicant ("ผู้ที่เคยกดยอมรับฉบับที่ 1 ไว้ จะถูกขอให้ … กดยอมรับฉบับนี้อีกหนึ่งครั้ง")
// was false. The default now ships with the document; the env var stays an
// override for the case where ops must pin an older version deliberately.
// Pinned to the newest docs/legal/payment-terms-th-v*.md by
// __tests__/unit/consent-version-matches-the-published-document.test.js.
//
// v1.2 (operator 2026-10-03, effective 4 ตุลาคม 2569): one ค่าบริการ with the
// catalogue names, replacing v1.1's state/platform split. A v1.1 grant no longer
// matches, so the applicant accepts v1.2 before the next payment; orders already
// stamped v1.1 keep that stamp (settlement never reads it).
const PUBLISHED_CONSENT_VERSIONS = Object.freeze({
    PAYMENT_TERMS: 'payment-terms-th-v1.2',
});

function _resolveConsentVersion(category) {
    const raw = process.env[`CONSENT_VERSION_${category}`];
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    return PUBLISHED_CONSENT_VERSIONS[category] || DEFAULT_CONSENT_VERSION;
}

const ConsentVersions = Object.freeze({
    TERMS_OF_SERVICE: _resolveConsentVersion('TERMS_OF_SERVICE'),
    PRIVACY_POLICY: _resolveConsentVersion('PRIVACY_POLICY'),
    MARKETING_EMAIL: _resolveConsentVersion('MARKETING_EMAIL'),
    MARKETING_SMS: _resolveConsentVersion('MARKETING_SMS'),
    DATA_ANALYTICS: _resolveConsentVersion('DATA_ANALYTICS'),
    THIRD_PARTY_SHARING: _resolveConsentVersion('THIRD_PARTY_SHARING'),
    LOCATION_TRACKING: _resolveConsentVersion('LOCATION_TRACKING'),
    PAYMENT_TERMS: _resolveConsentVersion('PAYMENT_TERMS'),
});

// Required consents (cannot use service without)
const RequiredConsents = [
    ConsentCategory.TERMS_OF_SERVICE,
    ConsentCategory.PRIVACY_POLICY,
];

class ConsentManager {
    constructor() {
        this.prisma = prisma;
    }

    /**
     * The PAYMENT_TERMS withdrawal guard — one chokepoint for every writer.
     *
     * S4 (2026-07-08): PAYMENT_TERMS is a contractual acknowledgment
     * (มาตรา 24(3) contract basis) — the disclosure-before-payment evidence the
     * no-refund policy stands on. Un-granting would overwrite the single row
     * (grantedAt nulled, version replaced) and destroy that evidence after
     * money moved. This also blocks withdrawConsent + DELETE
     * /consent/PAYMENT_TERMS.
     */
    _assertWithdrawable(category, granted) {
        if (category === ConsentCategory.PAYMENT_TERMS && granted === false) {
            throw Object.assign(
                new Error('การยอมรับเงื่อนไขการชำระเงินเป็นหลักฐานทางสัญญา ถอนไม่ได้'),
                { code: 'PAYMENT_TERMS_NOT_WITHDRAWABLE', statusCode: 400, status: 400 },
            );
        }
    }

    /**
     * Resolve the tenant that owns a consent row.
     *
     * UserConsent.organizationId is a REQUIRED FK (ADR-014 multi-tenancy, no
     * default). Callers that already hold the user's organizationId (e.g. the
     * registration controller, which just created the row) pass it in and skip
     * the lookup entirely — one DB round trip less on a path that pays
     * inter-region latency (F-QA-01). Everyone else resolves it from the user,
     * exactly as before. Omitting it used to make every create throw Prisma
     * "Argument `organizationId` is missing", caught non-fatally by the
     * registration controller — so consent was SILENTLY never persisted (PDPA
     * COMP-006 gap).
     */
    async _resolveConsentOrganizationId(userId, known) {
        if (typeof known === 'string' && known.length > 0) {
            return known;
        }
        const owner = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true },
        });
        if (!owner?.organizationId) {
            throw new Error(
                `recordConsent: cannot resolve organizationId for user ${userId}`,
            );
        }
        return owner.organizationId;
    }

    /**
     * Write ONE consent row (insert or overwrite) and return it, WITHOUT
     * touching the audit log — the caller owns that.
     *
     * A single `upsert` on @@unique([userId, category]) replaces the old
     * read-then-branch (findFirst → create | update): same two outcomes, same
     * two payloads, one DB round trip instead of two, and no lost-update race
     * between the read and the write.
     */
    async _upsertConsent({ userId, organizationId, category, granted, ipAddress, userAgent, metadata }) {
        const version = ConsentVersions[category] || '1.0.0';
        const now = new Date();
        return this.prisma.userConsent.upsert({
            where: { userId_category: { userId, category } },
            update: {
                granted,
                version,
                grantedAt: granted ? now : null,
                withdrawnAt: !granted ? now : null,
                ipAddress,
                userAgent,
                metadata: JSON.stringify(metadata),
                updatedAt: now,
            },
            create: {
                userId,
                organizationId,
                category,
                granted,
                version,
                grantedAt: granted ? now : null,
                withdrawnAt: !granted ? now : null,
                ipAddress,
                userAgent: userAgent?.substring(0, 500),
                metadata: JSON.stringify(metadata),
            },
        });
    }

    /** The audit event a consent write emits. Pure — writing it is the caller's job. */
    _buildConsentAuditEvent(consent, { userId, category, granted, ipAddress, userAgent }) {
        return {
            category: AuditCategory.SECURITY,
            action: granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
            actorId: userId,
            actorRole: 'HEALTH',
            resourceType: 'CONSENT',
            resourceId: consent.id,
            ipAddress,
            userAgent,
            metadata: { consentCategory: category, version: ConsentVersions[category] || '1.0.0' },
        };
    }

    /**
     * Record user consent
     *
     * @param {object} [options]
     * @param {string} [options.organizationId] — the user's tenant, when the
     *   caller already knows it (skips one lookup; must be the SAME value the
     *   lookup would have returned).
     */
    async recordConsent(userId, category, granted, ipAddress, userAgent, metadata = {}, options = {}) {
        this._assertWithdrawable(category, granted);

        const organizationId = await this._resolveConsentOrganizationId(userId, options.organizationId);
        const consent = await this._upsertConsent({
            userId, organizationId, category, granted, ipAddress, userAgent, metadata,
        });

        // Log consent event
        await auditLogger.log(
            this._buildConsentAuditEvent(consent, { userId, category, granted, ipAddress, userAgent }),
        );

        return consent;
    }

    /**
     * Registration-time consent capture (PDPA COMP-006).
     *
     * Persists every required consent for a brand-new account and RETURNS the
     * audit events instead of writing them, so the caller can put them in the
     * same audit batch as REGISTER_SUCCESS (auditLogger.logMany) — one locked
     * transaction for the whole registration instead of one per event.
     *
     * The consent rows themselves are still written before this resolves: a
     * caller that drops the returned events loses the audit trail, not the
     * consent record.
     *
     * One category failing must not cost the others their audit row, so the
     * writes are settled independently and the failures are reported back
     * rather than thrown.
     *
     * @returns {Promise<{ consents: object[], auditEvents: object[], failures: Array<{category: string, error: Error}> }>}
     */
    async recordRegistrationConsents({ userId, organizationId, categories, ipAddress, userAgent, metadata = {} }) {
        const wanted = Array.isArray(categories) ? categories : [];
        for (const category of wanted) {
            this._assertWithdrawable(category, true);
        }
        const orgId = await this._resolveConsentOrganizationId(userId, organizationId);

        // Independent rows, independent connections — one round trip of
        // latency for the whole set instead of one per category.
        const settled = await Promise.allSettled(wanted.map((category) => this._upsertConsent({
            userId, organizationId: orgId, category, granted: true, ipAddress, userAgent, metadata,
        })));

        const consents = [];
        const auditEvents = [];
        const failures = [];
        settled.forEach((outcome, i) => {
            const category = wanted[i];
            if (outcome.status === 'fulfilled') {
                consents.push(outcome.value);
                auditEvents.push(this._buildConsentAuditEvent(outcome.value, {
                    userId, category, granted: true, ipAddress, userAgent,
                }));
            } else {
                failures.push({ category, error: outcome.reason });
            }
        });

        return { consents, auditEvents, failures };
    }

    /**
     * Record multiple consents at once (registration)
     */
    async recordBulkConsent(userId, consents, ipAddress, userAgent) {
        const results = [];

        for (const { category, granted } of consents) {
            const result = await this.recordConsent(
                userId, category, granted, ipAddress, userAgent,
            );
            results.push(result);
        }

        return results;
    }

    /**
     * Check if user has all required consents
     */
    async hasRequiredConsents(userId) {
        const consents = await this.prisma.userConsent.findMany({
            where: {
                userId,
                category: { in: RequiredConsents },
                granted: true,
            },
        });

        const grantedCategories = new Set(consents.map(c => c.category));
        return RequiredConsents.every(cat => grantedCategories.has(cat));
    }

    /**
     * Get all user consents
     */
    async getUserConsents(userId) {
        const consents = await this.prisma.userConsent.findMany({
            where: { userId },
            orderBy: { category: 'asc' },
        });

        // Build consent status object
        const status = {};
        for (const category of Object.values(ConsentCategory)) {
            const consent = consents.find(c => c.category === category);
            status[category] = {
                granted: consent?.granted || false,
                version: consent?.version || null,
                // The version a NEW grant would be recorded under, beside the
                // version this grant carries. Without it a client cannot tell a
                // current acknowledgment from a superseded one, and both payment
                // rails hide their acknowledgment checkbox on `granted === true`
                // — so a version bump would leave the applicant looking at
                // "ยอมรับไว้แล้ว" while the gate refuses the payment
                // (payment-terms-gate.js compares these two values).
                currentVersion: ConsentVersions[category] || null,
                grantedAt: consent?.grantedAt || null,
                withdrawnAt: consent?.withdrawnAt || null,
                required: RequiredConsents.includes(category),
            };
        }

        return status;
    }

    /**
     * Withdraw consent (PDPA right)
     */
    async withdrawConsent(userId, category, ipAddress, userAgent) {
        // Cannot withdraw required consents
        if (RequiredConsents.includes(category)) {
            throw new Error('Cannot withdraw required consent. Please delete your account instead.');
        }

        return this.recordConsent(userId, category, false, ipAddress, userAgent, {
            withdrawalReason: 'USER_REQUEST',
        });
    }

    /**
     * Get consent document content
     */
    getConsentDocument(category, language = 'th') {
        const documents = {
            TERMS_OF_SERVICE: {
                th: {
                    title: 'ข้อกำหนดและเงื่อนไขการใช้บริการ',
                    summary: 'เงื่อนไขการใช้งานระบบรับรองมาตรฐาน GACP',
                    url: '/legal/terms-of-service',
                },
                en: {
                    title: 'Terms of Service',
                    summary: 'Terms for using GACP Certification System',
                    url: '/legal/terms-of-service',
                },
            },
            PRIVACY_POLICY: {
                th: {
                    title: 'นโยบายความเป็นส่วนตัว',
                    summary: 'การเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล',
                    url: '/legal/privacy-policy',
                },
                en: {
                    title: 'Privacy Policy',
                    summary: 'Collection, use, and disclosure of personal data under PDPA',
                    url: '/legal/privacy-policy',
                },
            },
            MARKETING_EMAIL: {
                th: {
                    title: 'รับข่าวสารทางอีเมล',
                    summary: 'รับข้อมูลข่าวสาร โปรโมชั่น และการแจ้งเตือนทางอีเมล',
                },
                en: {
                    title: 'Email Marketing',
                    summary: 'Receive news, promotions, and notifications via email',
                },
            },
            MARKETING_SMS: {
                th: {
                    title: 'รับข่าวสารทาง SMS',
                    summary: 'รับการแจ้งเตือนและข่าวสารทาง SMS',
                },
                en: {
                    title: 'SMS Marketing',
                    summary: 'Receive notifications and news via SMS',
                },
            },
            DATA_ANALYTICS: {
                th: {
                    title: 'การวิเคราะห์ข้อมูล',
                    summary: 'อนุญาตให้ใช้ข้อมูลเพื่อปรับปรุงบริการ',
                },
                en: {
                    title: 'Data Analytics',
                    summary: 'Allow data usage for service improvement',
                },
            },
            PAYMENT_TERMS: {
                th: {
                    title: 'เงื่อนไขการชำระเงินและการคืนเงิน',
                    summary: 'โครงสร้างค่าธรรมเนียม ขอบเขตการไม่คืนเงิน (เฉพาะบริการที่ดำเนินการแล้ว) เงื่อนไขเคสอนุโลม การคุ้มครองกรณีความผิดพลาดของแพลตฟอร์ม และกำหนดแก้ไข 5 วันทำการ',
                    url: '/legal/payment-terms',
                },
                en: {
                    title: 'Payment & Refund Terms',
                    summary: 'Fee structure, no-refund scope (delivered services only), leniency reopen conditions, platform-fault protections, and the 5-working-day revision deadline',
                    url: '/legal/payment-terms',
                },
            },
        };

        return documents[category]?.[language] || documents[category]?.th || null;
    }

    /**
     * Close Prisma connection (no-op: shared singleton)
     */
    async disconnect() {
        // No-op: using shared prisma-database singleton
    }
}

// Singleton instance
const consentManager = new ConsentManager();

// Routes that are explicitly exempt from the consent gate. These must be
// accessible before the user has consented (the consent flow itself, auth
// endpoints that cannot require prior state, health probes, public APIs).
const CONSENT_BYPASS_PREFIXES = Object.freeze([
    // AUTH-09-02: the consent router mounts at `/consent` (→ /api/consent and
    // /api/v1/consent), NOT `/api/identity/consent`. The old prefix never
    // matched, so an app-level gate would have blocked the consent flow itself.
    '/api/consent',            // consent grant/withdraw endpoints (legacy /api mount)
    '/api/v1/consent',         // consent grant/withdraw endpoints (canonical mount)
    '/api/auth/',              // login / refresh / logout
    '/api/v1/auth/',
    '/api/public/',            // public certificate verify
    '/api/v1/public/',
    '/health',                 // service health probe
    '/api/pdpa/',              // PDPA erasure / export
    '/api/v1/pdpa/',
]);

/**
 * Express middleware — blocks access with 403 CONSENT_REQUIRED if the
 * authenticated user has not granted all required PDPA consents.
 *
 * PDPA พ.ศ. 2562 มาตรา 16: consent must precede personal data processing.
 *
 * Placement: apply AFTER authenticateHealth / authenticateProvider.
 * Skip: unauthenticated routes, provider/admin roles, consent-bypass routes.
 *
 * Frontend behaviour: on 403+code='CONSENT_REQUIRED', redirect to /consent.
 */
async function requireConsent(req, res, next) {
    // Not authenticated — the auth middleware handles this separately.
    if (!req.user || !req.user.id) {
        return next();
    }

    // Provider / admin roles operate on behalf of the platform and are not
    // individual data subjects for the TERMS_OF_SERVICE / PRIVACY_POLICY gate.
    const { isProviderRole } = require('../shared/canonical-rbac');
    if (isProviderRole(req.user.role)) {
        return next();
    }

    // Bypass for routes that must work before consent (consent flow, auth, health).
    const path = req.path || '';
    if (CONSENT_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        return next();
    }

    try {
        const hasConsents = await consentManager.hasRequiredConsents(req.user.id);
        if (!hasConsents) {
            return res.status(403).json({
                success: false,
                error: 'Required PDPA consents (TERMS_OF_SERVICE, PRIVACY_POLICY) have not been granted.',
                code: 'CONSENT_REQUIRED',
                requiredConsents: RequiredConsents,
            });
        }
        return next();
    } catch (err) {
        // Consent check failure must not block authenticated access — log and
        // pass through. A DB outage during consent check should not lock users
        // out of the system; PDPA obligation is met by the initial consent
        // recording, not by this runtime gate.
        const logger = require('../shared/logger');
        logger.warn(`[consent] requireConsent check failed (non-fatal): ${err?.message}`);
        return next();
    }
}

module.exports = {
    consentManager,
    ConsentCategory,
    ConsentVersions,
    RequiredConsents,
    requireConsent,
};
