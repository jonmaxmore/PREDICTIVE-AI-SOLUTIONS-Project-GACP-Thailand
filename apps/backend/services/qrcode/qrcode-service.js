/**
 * QR Code Service
 * Generates and manages QR codes for batch/lot tracking
 * 
 * @module services/qrcode/qrcode-service
 */

const QRCode = require('qrcode');
const crypto = require('crypto');
const logger = require('../../shared/logger');
const { prisma } = require('../prisma-database');
const { getSignatureService } = require('../crypto/signature-service');

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

function normalizeBaseUrl(rawUrl) {
    const candidate = String(rawUrl || '').trim();
    if (!candidate) {
        return 'http://localhost/trace';
    }

    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol === 'http:' && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
        parsed.protocol = 'https:';
    }
    // For local environments, prefer default 80/443 entrypoints so QR URLs resolve
    // through nginx/public host instead of an internal dev port.
    if (LOCAL_HOSTNAMES.has(parsed.hostname) && parsed.port && !['80', '443'].includes(parsed.port)) {
        parsed.port = '';
    }
    return parsed.toString().replace(/\/$/, '');
}

function sortObjectKeys(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sortObjectKeys(item));
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sortObjectKeys(value[key]);
                return acc;
            }, {});
    }
    return value;
}

function stableStringify(value) {
    return JSON.stringify(sortObjectKeys(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeEntityType(entityType) {
    const normalized = String(entityType || '').trim().toUpperCase();
    if (!normalized) {
        return 'UNKNOWN';
    }
    return normalized;
}

class QRCodeService {
    constructor() {
        this.baseUrl = this.resolveTraceBaseUrl();
        this.signatureService = getSignatureService();
    }

    resolveTraceBaseUrl() {
        if (process.env.PUBLIC_TRACE_URL) {
            return normalizeBaseUrl(process.env.PUBLIC_TRACE_URL);
        }

        const root = String(process.env.TRACE_BASE_URL || process.env.APP_PUBLIC_URL || '').trim().replace(/\/$/, '');

        // PR-1.8: in production, refuse to fall back to http://localhost.
        // A QR code with a localhost URL is undscannable in the wild and
        // silently breaks every downstream consumer. Force an explicit
        // env var.
        if (!root) {
            if (process.env.NODE_ENV === 'production') {
                const err = new Error(
                    'PUBLIC_TRACE_URL or TRACE_BASE_URL or APP_PUBLIC_URL is required in production. '
                    + 'Refusing to generate QR codes pointing at http://localhost.',
                );
                err.code = 'TRACE_URL_REQUIRED_IN_PROD';
                throw err;
            }
            return normalizeBaseUrl('http://localhost/trace');
        }
        return normalizeBaseUrl(`${root}/trace`);
    }

    /**
     * Generate a unique QR code identifier
     * @returns {string} UUID for QR lookup
     */
    generateQRCodeId() {
        return crypto.randomUUID();
    }

    /**
     * Generate tracking URL for a QR code
     * @param {string} qrCodeId - UUID for the QR code
     * @param {object} options - URL options
     * @returns {string} Full tracking URL
     */
    generateTrackingUrl(qrCodeId, options = {}) {
        if (options.path) {
            return this.generatePublicTraceUrl(options.path);
        }
        return this.generatePublicTraceUrl(qrCodeId);
    }

    /**
     * Build a public trace URL from a path fragment.
     * Examples:
     * - lot/<id>
     * - batch/<id>
     */
    generatePublicTraceUrl(pathFragment) {
        const path = String(pathFragment || '').trim().replace(/^\/+/, '');
        return path ? `${this.baseUrl}/${path}` : this.baseUrl;
    }

    /**
     * Generate QR code as data URL (Base64)
     * @param {string} qrCodeId - UUID for the QR code
     * @param {object} options - QR code options
     * @returns {Promise<string>} Data URL string
     */
    async generateDataUrl(qrCodeId, options = {}) {
        const url = options.url || this.generateTrackingUrl(qrCodeId, options);
        const qrOptions = {
            type: 'image/png',
            color: {
                dark: options.darkColor || '#000000',
                light: options.lightColor || '#FFFFFF',
            },
            width: options.width || 300,
            margin: options.margin || 2,
            errorCorrectionLevel: 'M',
        };

        try {
            logger.info(`[QRCodeService] Generating Data URL for ID: ${qrCodeId}...`);
            const dataUrl = await QRCode.toDataURL(url, qrOptions);
            logger.info(`[QRCodeService] Data URL Generated.`);
            return dataUrl;
        } catch (error) {
            logger.error('[QRCodeService] QR Code generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate QR code as Buffer (PNG)
     * @param {string} qrCodeId - UUID for the QR code
     * @param {object} options - QR code options
     * @returns {Promise<Buffer>} PNG image buffer
     */
    async generateBuffer(qrCodeId, options = {}) {
        const url = options.url || this.generateTrackingUrl(qrCodeId, options);
        const qrOptions = {
            type: 'png',
            color: {
                dark: options.darkColor || '#000000',
                light: options.lightColor || '#FFFFFF',
            },
            width: options.width || 300,
            margin: options.margin || 2,
            errorCorrectionLevel: 'M',
        };

        try {
            const buffer = await QRCode.toBuffer(url, qrOptions);
            return buffer;
        } catch (error) {
            logger.error('QR Code buffer generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate QR code for a batch or lot
     * @param {string} type - 'BATCH' or 'LOT'
     * @param {string} id - Batch or Lot ID
     * @param {object} options - QR options
     * @returns {object} QR code data
     */
    async generateForRecord(type, id, options = {}) {
        const qrCodeId = this.generateQRCodeId();
        const trackingUrl = options.trackingUrl || this.generateTrackingUrl(qrCodeId, options);
        const dataUrl = options.skipDataUrl ? null : await this.generateDataUrl(qrCodeId, { ...options, url: trackingUrl });

        return {
            qrCode: qrCodeId,
            trackingUrl,
            dataUrl,
            type,
            recordId: id,
            generatedAt: new Date().toISOString(),
        };
    }

    supportsIntegrityPersistence() {
        return Boolean(prisma?.traceQrSecurity && prisma?.traceQrScan);
    }

    async getPreviousChainHash(entityType) {
        if (!this.supportsIntegrityPersistence()) {
            return null;
        }

        const previous = await prisma.traceQrSecurity.findFirst({
            where: { entityType: normalizeEntityType(entityType), status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            select: { chainHash: true },
        });
        return previous?.chainHash || null;
    }

    /**
     * Resolve the QR HMAC fallback secret. MUST be a dedicated key — never
     * the JWT secret — so a JWT leak does not let an attacker forge QR
     * signatures and vice versa.
     *
     *   - Production: requires `QR_SIGNATURE_FALLBACK_SECRET` to be set
     *     explicitly (≥32 chars). Falls back to RSA only; if RSA also fails
     *     in prod, signing is rejected.
     *   - Dev/test: derives a key from `QR_SIGNATURE_FALLBACK_SECRET` if
     *     present, otherwise from a fixed dev placeholder.
     */
    _resolveQrFallbackSecret() {
        const explicit = String(process.env.QR_SIGNATURE_FALLBACK_SECRET || '').trim();
        const isProduction = process.env.NODE_ENV === 'production';
        if (explicit) {
            if (isProduction && explicit.length < 32) {
                const err = new Error(
                    'QR_SIGNATURE_FALLBACK_SECRET must be ≥32 chars in production',
                );
                err.code = 'QR_SECRET_WEAK';
                throw err;
            }
            return explicit;
        }
        if (isProduction) {
            const err = new Error(
                'QR_SIGNATURE_FALLBACK_SECRET is required in production. '
                + 'Either configure RSA signing or set this env var explicitly. '
                + 'JWT secrets MUST NOT be reused for QR signing.',
            );
            err.code = 'QR_SECRET_MISSING';
            throw err;
        }
        return 'gacp-dev-qr-fallback-secret';
    }

    async signDigest(digest) {
        try {
            await this.signatureService.ensureInitialized();
            const signature = await this.signatureService.sign(digest);
            const publicKey = await this.signatureService.getPublicKey();
            return {
                signature,
                signatureAlgorithm: 'RSA-SHA256',
                keyFingerprint: sha256(publicKey),
            };
        } catch (rsaError) {
            const isProduction = process.env.NODE_ENV === 'production';
            // PR-1.7: production never silently degrades to HMAC.
            // Even if QR_SIGNATURE_FALLBACK_SECRET is set, RSA failure in
            // production is fatal — the signature trust chain must not
            // weaken without an operator visibly removing the RSA key.
            // verifyDigestSignature() still accepts HMAC-SHA256 so legacy
            // HMAC-signed QR codes (issued before this commit landed)
            // continue to verify; new signatures are RSA-only in prod.
            if (isProduction) {
                logger.error('[QRCodeService] RSA signing unavailable in production — refusing to sign with HMAC fallback.', {
                    reason: rsaError.message,
                });
                const err = new Error(
                    'QR signing requires RSA in production. RSA key initialization failed; '
                    + 'HMAC fallback is intentionally NOT used. Restore the RSA key and retry.',
                );
                err.code = 'QR_RSA_REQUIRED_IN_PROD';
                err.cause = rsaError;
                throw err;
            }
            const fallbackSecret = this._resolveQrFallbackSecret();
            logger.warn('[QRCodeService] RSA signature unavailable in dev/test. Using HMAC fallback.', {
                reason: rsaError.message,
            });
            return {
                signature: crypto.createHmac('sha256', fallbackSecret).update(digest).digest('hex'),
                signatureAlgorithm: 'HMAC-SHA256',
                keyFingerprint: sha256('HMAC-SHA256'),
            };
        }
    }

    async verifyDigestSignature(digest, signature, signatureAlgorithm) {
        if (signatureAlgorithm === 'HMAC-SHA256') {
            try {
                const fallbackSecret = this._resolveQrFallbackSecret();
                const expected = crypto.createHmac('sha256', fallbackSecret).update(digest).digest('hex');
                // Constant-time compare to avoid timing oracle.
                const a = Buffer.from(expected, 'hex');
                const b = Buffer.from(String(signature || ''), 'hex');
                if (a.length !== b.length) { return false; }
                return crypto.timingSafeEqual(a, b);
            } catch (err) {
                logger.warn('[QRCodeService] HMAC verification unavailable', { reason: err.message });
                return false;
            }
        }

        try {
            await this.signatureService.ensureInitialized();
            return this.signatureService.verify(digest, signature);
        } catch (error) {
            logger.warn('[QRCodeService] Signature verification failed', { reason: error.message });
            return false;
        }
    }

    async buildTraceIntegrity({
        entityType,
        entityId,
        qrCode,
        publicUrl,
        payload,
    }) {
        const normalizedEntityType = normalizeEntityType(entityType);
        const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
        const payloadData = sortObjectKeys(normalizedPayload);
        const payloadDigest = sha256(stableStringify(payloadData));
        const previousHash = await this.getPreviousChainHash(normalizedEntityType);
        const chainHash = sha256(`${previousHash || ''}:${payloadDigest}`);
        const signed = await this.signDigest(chainHash);
        const timestampData = {
            timestamp: new Date().toISOString(),
            unix: Math.floor(Date.now() / 1000),
        };

        return {
            entityType: normalizedEntityType,
            entityId: String(entityId || ''),
            qrCode: qrCode || null,
            publicUrl,
            payload: payloadData,
            dataHash: payloadDigest,
            previousHash,
            chainHash,
            signature: signed.signature,
            signatureAlgorithm: signed.signatureAlgorithm,
            keyFingerprint: signed.keyFingerprint,
            timestampData,
            status: 'ACTIVE',
        };
    }

    async registerTraceIntegrity({
        entityType,
        entityId,
        qrCode,
        publicUrl,
        payload,
    }) {
        const integrity = await this.buildTraceIntegrity({
            entityType,
            entityId,
            qrCode,
            publicUrl,
            payload,
        });

        if (!this.supportsIntegrityPersistence()) {
            return {
                persisted: false,
                ...integrity,
            };
        }

        const existing = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: integrity.entityType,
                entityId: integrity.entityId,
            },
            select: { id: true },
        });

        const saved = existing
            ? await prisma.traceQrSecurity.update({
                where: { id: existing.id },
                data: {
                    qrCode: integrity.qrCode,
                    publicUrl: integrity.publicUrl,
                    payload: integrity.payload,
                    dataHash: integrity.dataHash,
                    previousHash: integrity.previousHash,
                    chainHash: integrity.chainHash,
                    signature: integrity.signature,
                    signatureAlgorithm: integrity.signatureAlgorithm,
                    timestampData: integrity.timestampData,
                    keyFingerprint: integrity.keyFingerprint,
                    status: integrity.status,
                },
                select: {
                    id: true,
                    entityType: true,
                    entityId: true,
                    chainHash: true,
                    dataHash: true,
                    signatureAlgorithm: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })
            : await prisma.traceQrSecurity.create({
                data: integrity,
                select: {
                    id: true,
                    entityType: true,
                    entityId: true,
                    chainHash: true,
                    dataHash: true,
                    signatureAlgorithm: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

        return {
            persisted: true,
            id: saved.id,
            entityType: saved.entityType,
            entityId: saved.entityId,
            chainHash: saved.chainHash,
            dataHash: saved.dataHash,
            signatureAlgorithm: saved.signatureAlgorithm,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
        };
    }

    async verifyTraceIntegrity(entityType, entityId) {
        if (!this.supportsIntegrityPersistence()) {
            return {
                available: false,
                valid: null,
                reason: 'trace_qr_security_unavailable',
            };
        }

        const record = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: normalizeEntityType(entityType),
                entityId: String(entityId || ''),
                status: 'ACTIVE',
            },
            select: {
                id: true,
                entityType: true,
                entityId: true,
                payload: true,
                dataHash: true,
                previousHash: true,
                chainHash: true,
                signature: true,
                signatureAlgorithm: true,
                keyFingerprint: true,
                publicUrl: true,
                scanCount: true,
                createdAt: true,
            },
        });

        if (!record) {
            return {
                available: false,
                valid: null,
                reason: 'not_found',
            };
        }

        const expectedDataHash = sha256(stableStringify(sortObjectKeys(record.payload || {})));
        const expectedChainHash = sha256(`${record.previousHash || ''}:${expectedDataHash}`);
        const signatureValid = await this.verifyDigestSignature(
            record.chainHash,
            record.signature,
            record.signatureAlgorithm,
        );
        const hashValid = expectedDataHash === record.dataHash;
        const chainValid = expectedChainHash === record.chainHash;

        return {
            available: true,
            valid: hashValid && chainValid && signatureValid,
            signatureValid,
            hashValid,
            chainValid,
            signatureAlgorithm: record.signatureAlgorithm,
            keyFingerprint: record.keyFingerprint || null,
            chainHash: record.chainHash,
            dataHash: record.dataHash,
            publicUrl: record.publicUrl,
            scanCount: record.scanCount,
            createdAt: record.createdAt,
            recordId: record.id,
        };
    }

    async recordTraceScan(entityType, entityId, scanContext = {}) {
        if (!this.supportsIntegrityPersistence()) {
            return null;
        }

        const verification = await this.verifyTraceIntegrity(entityType, entityId);
        if (!verification.available) {
            return verification;
        }

        // Pull organizationId from the parent TraceQrSecurity row so the
        // scan record inherits the secured entity's tenant. This function
        // is called from public unauthenticated trace-verification routes
        // (no tenant context bound) — without an explicit organizationId,
        // the create() throws "Argument `organization` is missing" because
        // TraceQrScan.organizationId is NOT NULL in schema. Caught in the
        // post-PR-#199/200 untenanted-create sweep.
        const record = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: normalizeEntityType(entityType),
                entityId: String(entityId || ''),
                status: 'ACTIVE',
            },
            select: { id: true, organizationId: true },
        });

        if (!record?.id) {
            return verification;
        }

        await prisma.$transaction([
            prisma.traceQrScan.create({
                data: {
                    qrSecurityId: record.id,
                    requestIp: scanContext.requestIp || null,
                    userAgent: scanContext.userAgent || null,
                    requestPath: scanContext.requestPath || null,
                    verification: verification,
                    verified: verification.valid === true,
                    organizationId: record.organizationId,
                },
            }),
            prisma.traceQrSecurity.update({
                where: { id: record.id },
                data: { scanCount: { increment: 1 } },
            }),
        ]);

        return verification;
    }
}

module.exports = new QRCodeService();
