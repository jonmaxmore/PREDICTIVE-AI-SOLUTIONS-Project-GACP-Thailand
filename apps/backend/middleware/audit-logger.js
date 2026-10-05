/**
 * Audit Logging System - ISO 27799 Compliant
 * Matches Prisma AuditLog schema with Hash Chain for immutability
 */

const { prisma } = require('../services/prisma-database');
const { getTenantContext } = require('../services/tenant-context');
const { maskThaiIdsInText } = require('../utils/field-encryption');
const crypto = require('crypto');

// B3 (PDPA-LEAK cluster, carpet-bomb-inversion-audit-2026-07-06) — audit metadata
// is caller-supplied JSON that can carry a national ID (the router audit
// middleware writes `query: req.query` verbatim, so an applicant search by 13-digit
// citizen ID lands cleartext in `audit_logs.metadata`, dump- and CSV-readable).
// Mask every standalone 13-digit run in the metadata VALUES at this single writer
// chokepoint so ALL metadata sources are covered, not just the search query.
// metadata is NOT part of the audit hash chain (buildHashPayload excludes it), so
// masking is chain-safe. Deep-walk plain objects + arrays (the query can be
// nested); leave non-plain objects (Date, etc.) untouched so JSON.stringify keeps
// its existing serialization (a Date → ISO string, not `{}`).
function _isPlainObject(value) {
    if (value === null || typeof value !== 'object') { return false; }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function maskMetadataPii(value) {
    if (typeof value === 'string') { return maskThaiIdsInText(value); }
    if (Array.isArray(value)) { return value.map((el) => maskMetadataPii(el)); }
    if (_isPlainObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) { out[key] = maskMetadataPii(value[key]); }
        return out;
    }
    // numbers / booleans / null / undefined / Date / other class instances — as-is.
    return value;
}

// Categories matching Prisma schema
const AuditCategory = {
    AUTHENTICATION: 'AUTHENTICATION',
    APPLICATION: 'APPLICATION',
    PAYMENT: 'PAYMENT',
    CERTIFICATE: 'CERTIFICATE',
    ADMIN: 'ADMIN',
    SECURITY: 'SECURITY',
    SYSTEM: 'SYSTEM',
    // T5 (2026-09-05) — a staff member READING somebody's farm data. Kept apart
    // from SECURITY, which means an incident: a tracking officer opening a farm
    // they were never assigned is now ordinary, permitted work (operator ruling
    // "ฟาร์มทุกประเทศ"), and filing it as a security event would bury the real
    // ones. PDPA s.39 asks for a record of access, not an alarm.
    DATA_ACCESS: 'DATA_ACCESS',
};

// Severity levels
const AuditSeverity = {
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL',
};

// Resource types matching Prisma schema
const ResourceType = {
    USER: 'USER',
    // T5 — the subject of a DATA_ACCESS row. The columns are plain strings in
    // prisma/schema/audit.prisma, so this needs no migration; the comment there
    // lists the same values and is updated with it.
    FARM: 'FARM',
    APPLICATION: 'APPLICATION',
    INVOICE: 'INVOICE',
    PAYMENT: 'PAYMENT',
    CERTIFICATE: 'CERTIFICATE',
    DOCUMENT: 'DOCUMENT',
    SYSTEM: 'SYSTEM',
};

// Advisory-lock namespace (int4 key1) for the per-tenant audit hash chain.
// Distinguishes audit-chain locks from any other pg_advisory_xact_lock the app
// takes, so a hashtext(orgId) collision can't entangle with an unrelated lock.
// 0x41554454 = "AUDT".
const AUDIT_CHAIN_LOCK_NS = 0x41554454;

// Hash-payload version (audit gap #14, carpet-bomb-inversion-audit-2026-07-06).
//   v1 = the legacy NARROW payload — hashed only a skeleton (logId,
//        sequenceNumber, category, action, actorId, resourceType, resourceId,
//        timestamp). metadata/result/actorRole/errorCode/severity/actorType/
//        actorEmail/ipAddress/userAgent/errorMessage were persisted-but-unhashed,
//        so a privileged DB write could mutate an approved payment amount, flip
//        result SUCCESS↔FAILURE, escalate actorRole ACCOUNT→ADMIN, or rewrite a
//        CAR reason WITHOUT breaking the chain — verifyChain still said verified.
//   v2 = the WIDE payload — folds every tamper-relevant PERSISTED column into
//        the hash so any such single-column edit breaks it.
// The version is intentionally NOT stored in a schema column: NEW rows are
// hashed under v2; verifyChain recomputes each row under v2 first and falls
// back to v1, so pre-cutover (legacy) rows keep verifying green without a
// history re-key, while any post-write mutation of a v2 field is detected.
// AuditLog is append-only (no update/delete anywhere in runtime code), so none
// of the widened fields legitimately mutate after insert. NOTE: the hash is
// still UNKEYED (SHA-256) — this raises the bar against a targeted single-column
// UPDATE, not against an adversary who recomputes the whole chain; keying (HMAC)
// is the follow-up the audit pairs with this.
const HASH_PAYLOAD_VERSION = 2;

class AuditLogger {
    constructor() {
        this.prisma = prisma; // Use singleton
        this.lastHash = null;
        this.sequenceCounter = 0;
        // Cached default-org id — looked up lazily on first audit event for
        // a request path that has neither an explicit organizationId nor a
        // tenant context bound (e.g., LOGIN_SUCCESS fires before the auth
        // middleware sets the tenant scope). Cached for the process
        // lifetime; the `default` org is seeded once and never deleted.
        this._defaultOrgIdPromise = null;
    }

    /**
     * Resolve the organizationId to write on an audit row.
     *
     * Priority:
     *   1. Explicit `event.organizationId` (preferred — caller already knew
     *      the tenant when they fired the audit, e.g., login flow after
     *      finding the user record).
     *   2. AsyncLocalStorage tenant context (most authenticated routes).
     *   3. Default-org fallback (boot-time-seeded `default` org). Used for
     *      pre-tenant-bind events: LOGIN_SUCCESS / LOGIN_FAILED / LOGOUT /
     *      unauthenticated public actions.
     *
     * Returning null is fatal — AuditLog.organizationId is NOT NULL in
     * schema, so a missing value would crash the create. Throw a clear
     * error instead so the caller's `.catch` logs a meaningful message
     * rather than the raw Prisma validation noise.
     *
     * Bug history: PR #197 / sweep #4 caught that audit_logs were dropping
     * 100% of authentication events because the create() call lacked
     * organizationId, the tenant-prisma-extension had no context to inject
     * (auth fires before tenant binds), and the .catch wrapper hid the
     * Prisma rejection from server logs. Login/logout audit trail had been
     * silently dead for ~46+ minutes when the fix was authored — likely
     * weeks/months in production.
     */
    async _resolveOrganizationId(explicit) {
        if (typeof explicit === 'string' && explicit.length > 0) {
            return explicit;
        }
        const ctx = getTenantContext();
        if (ctx?.organizationId) {
            return ctx.organizationId;
        }
        if (!this._defaultOrgIdPromise) {
            this._defaultOrgIdPromise = (async () => {
                const org = await this.prisma.organization.findUnique({
                    where: { slug: 'default' },
                    select: { id: true },
                });
                if (!org) {
                    throw new Error(
                        '[audit-logger] default organization not seeded — ' +
                        'cannot resolve organizationId for audit row. ' +
                        'Run apps/backend/prisma/seed.js or the multi-tenancy backfill migration.',
                    );
                }
                return org.id;
            })();
            // If the lookup fails we want the next call to retry instead
            // of permanently caching the rejection.
            this._defaultOrgIdPromise.catch(() => { this._defaultOrgIdPromise = null; });
        }
        return this._defaultOrgIdPromise;
    }

    /**
     * Generate unique log ID
     */
    generateLogId() {
        return `LOG-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    /**
     * Generate hash for immutability
     */
    generateHash(data, previousHash) {
        const content = JSON.stringify({ ...data, previousHash });
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Derive the stable key for v3 HMAC audit hashes (audit gap #14 keying
     * follow-up — see the HASH_PAYLOAD_VERSION comment). Prefers an explicit
     * AUDIT_HASH_KEY; otherwise domain-separates the always-present,
     * boot-required ENCRYPTION_KEY (same style as
     * utils/field-encryption.computeLookupHmac) so there is NO new secret to
     * provision or rotate — the key is exactly as stable as ENCRYPTION_KEY,
     * which must already stay fixed (it also keys PDPA field-encryption + the
     * *Hmac national-ID lookups). Returns null when neither source is present
     * so a key-less process cleanly falls back to the unkeyed v2/v1 path
     * instead of throwing. Cached (reset in tests via `_auditHashKeyCache`).
     */
    _auditHashKey() {
        if (this._auditHashKeyCache !== undefined) { return this._auditHashKeyCache; }
        const explicit = process.env.AUDIT_HASH_KEY;
        if (explicit && explicit.length > 0) {
            this._auditHashKeyCache = Buffer.from(explicit, 'utf8');
            return this._auditHashKeyCache;
        }
        const base = process.env.ENCRYPTION_KEY;
        this._auditHashKeyCache = (base && base.length > 0)
            ? crypto.createHmac('sha256', base).update('audit-hash-chain-v3').digest()
            : null;
        return this._auditHashKeyCache;
    }

    /**
     * v3 — keyed (HMAC-SHA256) variant of generateHash. Same canonical content
     * assembly as generateHash, but HMAC under _auditHashKey() so the hash
     * cannot be recomputed — and therefore a forged/edited row cannot be
     * re-sealed — without the key, which lives only in env, NOT in the
     * audit_logs table. This makes the chain tamper-EVIDENT, not merely
     * tamper-detectable against accidental single-column edits.
     */
    generateHashV3(data, previousHash) {
        const content = JSON.stringify({ ...data, previousHash });
        return crypto.createHmac('sha256', this._auditHashKey()).update(content).digest('hex');
    }

    /**
     * Coerce a metadata value to the STABLE string that gets hashed, at BOTH
     * write and verify time. _buildAuditRow persists metadata as
     * `JSON.stringify(maskMetadataPii(metadata))` (a string) and Prisma reads a
     * JSON-string column back as that same string (see
     * workflow-audit-timelines-handler.js which JSON.parses entry.metadata), so
     * the persisted string equals the read value byte-for-byte. This helper is
     * a defensive normalizer: strings pass through unchanged; the object branch
     * only fires for a hypothetical non-string read and re-stringifies it.
     */
    _stableMetadataForHash(value) {
        if (typeof value === 'string') { return value; }
        if (value === null || value === undefined) { return 'null'; }
        try { return JSON.stringify(value); } catch { return String(value); }
    }

    /**
     * Canonical payload used for audit hash generation/recomputation.
     * Property order must remain stable for deterministic JSON hashing.
     *
     * Versioned (audit gap #14):
     *   - v1 = the legacy NARROW field set + order — DO NOT MODIFY; historical
     *     rows recompute byte-identically off it so they keep verifying green.
     *   - v2 (current) = WIDE — folds the tamper-relevant persisted columns in
     *     so a post-write single-column edit breaks the hash.
     *
     * The caller passes the SUPERSET of fields; each version projects the
     * subset it hashes. Nullable fields are normalized to null so JSON.stringify
     * always emits the key (an `undefined` value would be dropped, shifting the
     * serialized payload).
     */
    buildHashPayload(fields, version = HASH_PAYLOAD_VERSION) {
        const {
            logId,
            sequenceNumber,
            category,
            action,
            actorId,
            resourceType,
            resourceId,
            timestamp,
            severity,
            actorType,
            actorEmail,
            actorRole,
            ipAddress,
            userAgent,
            metadata,
            result,
            errorCode,
            errorMessage,
        } = fields;

        if (version === 1) {
            // LEGACY narrow payload — frozen. Any change here would re-key every
            // pre-v2 row and make verifyChain report all history as tampered.
            return {
                logId,
                sequenceNumber,
                category,
                action,
                actorId,
                resourceType,
                resourceId,
                timestamp,
            };
        }

        // v2/v3 — wide, tamper-evident payload. `hashVersion` domain-separates
        // versions so cross-version collisions can't silently downgrade a row's
        // protected field set. v3 hashes this SAME field set; the upgrade is the
        // HMAC KEYING at hash time (generateHashV3), not the payload shape.
        return {
            hashVersion: version === 3 ? 3 : 2,
            logId,
            sequenceNumber,
            category,
            action,
            severity: severity ?? null,
            actorId,
            actorType: actorType ?? null,
            actorEmail: actorEmail ?? null,
            actorRole: actorRole ?? null,
            resourceType,
            resourceId,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
            metadata: this._stableMetadataForHash(metadata),
            result: result ?? null,
            errorCode: errorCode ?? null,
            errorMessage: errorMessage ?? null,
            timestamp,
        };
    }

    getIsoTimestamp(value) {
        if (!value) {
            return null;
        }
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    /**
     * Get last hash from database. Optionally scoped to a transaction
     * client so the read sees only rows already visible inside that tx
     * (and locked with it under SERIALIZABLE isolation).
     */
    async getLastHash(client = this.prisma, organizationId = null) {
        const lastLog = await client.auditLog.findFirst({
            // Per-tenant chain (ADR-014): the "previous" link and the next
            // sequence number are scoped to the organization so every tenant
            // owns an independent, gap-free hash chain. organizationId is always
            // supplied by log()/logWithin (resolved to the default org when the
            // caller omits it); a null orgId falls back to the legacy global
            // scan only for ad-hoc/diagnostic callers.
            where: organizationId ? { organizationId } : undefined,
            orderBy: { sequenceNumber: 'desc' },
            select: { currentHash: true, sequenceNumber: true },
        });
        return {
            hash: lastLog?.currentHash || 'GENESIS',
            sequence: lastLog?.sequenceNumber || 0,
        };
    }

    /**
     * Build the data row for an audit insert. Shared between `log()` and
     * `logWithin()` so the two paths cannot drift (hash payload, sanitization,
     * default fields). The PII surface is intentionally narrow: metadata is
     * caller-supplied JSON, so we cap user-agent at 500 chars and stringify
     * metadata exactly the same way regardless of the caller. If/when a
     * field-level masker is added it MUST live here so both paths inherit it.
     */
    _buildAuditRow({
        event,
        resolvedOrgId,
        previousHash,
        sequenceNumber,
    }) {
        const {
            category,
            action,
            severity = AuditSeverity.INFO,
            actorId,
            actorEmail = null,
            actorRole,
            actorType = 'USER',
            resourceType,
            resourceId,
            ipAddress,
            userAgent,
            metadata = {},
            result = 'SUCCESS',
            errorCode = null,
            errorMessage = null,
        } = event;

        const timestamp = new Date().toISOString();
        const logId = this.generateLogId();

        // Compute the EXACT values that will be PERSISTED once, then hash those
        // same values (audit gap #14). Several columns are normalized/truncated
        // before persist (ipAddress defaulted, userAgent capped at 500 chars,
        // metadata masked + stringified) — the hash MUST cover the stored form,
        // not the raw input, or verifyChain (which recomputes from the persisted
        // row) would mismatch every row.
        const persistedSeverity = severity;
        const persistedActorType = actorType;
        const persistedActorEmail = actorEmail ?? null;
        const persistedActorRole = actorRole ?? null;
        const persistedIpAddress = ipAddress || 'unknown';
        const persistedUserAgent = userAgent?.substring(0, 500) || 'unknown';
        // B3 — mask national IDs in metadata values before persisting (see
        // maskMetadataPii above). Deterministic: the SAME masked string is both
        // persisted AND hashed, so verifyChain stays consistent.
        const persistedMetadata = JSON.stringify(maskMetadataPii(metadata));
        const persistedResult = result;
        const persistedErrorCode = errorCode ?? null;
        const persistedErrorMessage = errorMessage ?? null;

        // v3 keying (audit gap #14 follow-up) is opt-in + typo-safe: only when
        // AUDIT_HASH_HMAC === 'true' AND a key is derivable. Default/unset → v2
        // (unchanged). Read at write-time so a flag flip needs only a recreate
        // (mirrors AUTH_LOOKUP_USE_HMAC). Legacy v2/v1 rows keep verifying via
        // the v3→v2→v1 fallback in _rowHashMatchesAnyVersion.
        const useV3 = process.env.AUDIT_HASH_HMAC === 'true' && this._auditHashKey() != null;
        const hashPayload = this.buildHashPayload({
            logId,
            sequenceNumber,
            category,
            action,
            actorId,
            resourceType,
            resourceId,
            timestamp,
            // v2 widened fields (audit gap #14) — hashed in their persisted form.
            severity: persistedSeverity,
            actorType: persistedActorType,
            actorEmail: persistedActorEmail,
            actorRole: persistedActorRole,
            ipAddress: persistedIpAddress,
            userAgent: persistedUserAgent,
            metadata: persistedMetadata,
            result: persistedResult,
            errorCode: persistedErrorCode,
            errorMessage: persistedErrorMessage,
        }, useV3 ? 3 : HASH_PAYLOAD_VERSION);
        const currentHash = useV3
            ? this.generateHashV3(hashPayload, previousHash)
            : this.generateHash(hashPayload, previousHash);

        return {
            logId,
            currentHash,
            data: {
                logId,
                sequenceNumber,
                category,
                action,
                severity: persistedSeverity,
                actorId,
                actorType: persistedActorType,
                actorEmail: persistedActorEmail,
                actorRole: persistedActorRole,
                resourceType,
                resourceId,
                ipAddress: persistedIpAddress,
                userAgent: persistedUserAgent,
                metadata: persistedMetadata,
                result: persistedResult,
                errorCode: persistedErrorCode,
                errorMessage: persistedErrorMessage,
                previousHash,
                currentHash,
                hashAlgorithm: 'SHA-256',
                organizationId: resolvedOrgId,
                // Persist the EXACT timestamp that was hashed into currentHash
                // (above). verifyChain recomputes the hash from createdAt — if we
                // let Prisma default createdAt to now() it would be a different
                // ms-instant than the hashed `timestamp`, so EVERY row's content
                // hash would fail to recompute (the chain became content-
                // unverifiable). createdAt @map("timestamp") is settable (no
                // @updatedAt), so write the hashed instant verbatim.
                createdAt: new Date(timestamp),
            },
        };
    }

    isSequenceConflictError(error) {
        const targets = Array.isArray(error?.meta?.target) ? error.meta.target : [];
        return error?.code === 'P2002'
            && (
                targets.includes('sequenceNumber')
                || String(error?.message || '').includes('sequenceNumber')
            );
    }

    /**
     * Log an audit event with hash chain
     */
    async log(event) {
        const { category, action, severity = AuditSeverity.INFO, actorId, organizationId = null } = event;

        // Resolve tenant outside the retry loop — the value is the same
        // across attempts and the lookup may hit the DB once.
        let resolvedOrgId;
        try {
            resolvedOrgId = await this._resolveOrganizationId(organizationId);
        } catch (resolveErr) {
            console.error('[audit-logger]', resolveErr.message);
            return null;
        }

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                // Serialize per-tenant chain writers so the read-last-hash →
                // assign-sequence → insert critical section is atomic. Two
                // concurrent writers otherwise read the same tail sequence and
                // collide on @@unique([organizationId, sequenceNumber]) — a noisy
                // prisma P2002 and, under burst, retry-exhaustion that DROPS a
                // compliance audit row. pg_advisory_xact_lock is cluster-wide
                // (serializes across ALL backend instances) and auto-releases
                // when this short tx commits/aborts; keyed per-org so different
                // tenants never contend. The retry loop below stays as a
                // backstop for any non-lock P2002.
                const auditRecord = await this.prisma.$transaction(async (tx) => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_NS}::int4, hashtext(${resolvedOrgId}))`;
                    // Read the (now lock-stable) chain tail. Scoped to the
                    // resolved tenant — per-tenant chain (ADR-014).
                    const last = await this.getLastHash(tx, resolvedOrgId);
                    const { data } = this._buildAuditRow({
                        event,
                        resolvedOrgId,
                        previousHash: last.hash,
                        sequenceNumber: last.sequence + 1,
                    });
                    // Create immutable audit record inside the locked tx.
                    return tx.auditLog.create({ data });
                });

                // Alert for critical events
                if (severity === AuditSeverity.CRITICAL) {
                    console.error(`[AUDIT_CRITICAL] ${category}:${action} by ${actorId}`);
                }

                return auditRecord;
            } catch (error) {
                if (this.isSequenceConflictError(error) && attempt < maxAttempts) {
                    continue;
                }

                // Fallback to console
                console.error('[AUDIT_FALLBACK]', {
                    category, action, severity,
                    error: error.message,
                    code: error.code || null,
                    attempt,
                    timestamp: new Date().toISOString(),
                });
                return null;
            }
        }
        return null;
    }

    /**
     * Log SEVERAL audit events as ONE chain segment, in ONE transaction.
     *
     * Why this exists (F-QA-01, deep-qa 2026-09-06): `log()` costs a whole
     * transaction per event — BEGIN, advisory lock, tail read, INSERT, COMMIT.
     * A single registration emits three events (REGISTER_SUCCESS + one
     * CONSENT_GRANTED per required consent), so on an app/DB pair that sits in
     * two different regions the audit trail alone cost ~15 network round trips.
     * The chain does NOT need one transaction per row: it needs the tail read,
     * the sequence assignment and the inserts to be atomic and serialized
     * against other writers. Batching keeps all three properties.
     *
     * Chain semantics are IDENTICAL to calling log() N times in order:
     *   - one pg advisory lock on the same per-org key,
     *   - one tail read inside the locked tx,
     *   - sequence numbers assigned contiguously from the tail,
     *   - each row's previousHash is the PRECEDING row's currentHash
     *     (computed in memory, exactly what the next log() call would have
     *     read back from the DB),
     *   - one INSERT for the whole segment.
     * verifyChain() therefore sees no difference between a batched segment
     * and N sequential log() calls.
     *
     * Events are grouped by resolved organizationId (chains are per-tenant,
     * ADR-014) and each group is written as its own segment.
     *
     * Failure behaviour mirrors log(): never throws, falls back to the console
     * so a broken audit sink cannot break the business request.
     *
     * @param {object[]} events
     * @returns {Promise<number>} number of rows written (0 on total failure)
     */
    async logMany(events) {
        if (!Array.isArray(events) || events.length === 0) {
            return 0;
        }
        if (events.length === 1) {
            const single = await this.log(events[0]);
            return single ? 1 : 0;
        }

        // Group by tenant — one hash chain per organization (ADR-014).
        const groups = new Map();
        for (const event of events) {
            let resolvedOrgId;
            try {
                resolvedOrgId = await this._resolveOrganizationId(event?.organizationId || null);
            } catch (resolveErr) {
                console.error('[audit-logger]', resolveErr.message);
                continue;
            }
            if (!groups.has(resolvedOrgId)) {
                groups.set(resolvedOrgId, []);
            }
            groups.get(resolvedOrgId).push(event);
        }

        let written = 0;
        for (const [resolvedOrgId, groupEvents] of groups) {
            written += await this._logSegment(resolvedOrgId, groupEvents);
        }
        return written;
    }

    /** One tenant's batch → one locked transaction. See logMany(). */
    async _logSegment(resolvedOrgId, groupEvents) {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const rows = await this.prisma.$transaction(async (tx) => {
                    // Same lock, same scope, same reason as log().
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_NS}::int4, hashtext(${resolvedOrgId}))`;
                    const last = await this.getLastHash(tx, resolvedOrgId);
                    let previousHash = last.hash;
                    let sequenceNumber = last.sequence;
                    const batch = [];
                    for (const event of groupEvents) {
                        sequenceNumber += 1;
                        const { data } = this._buildAuditRow({
                            event,
                            resolvedOrgId,
                            previousHash,
                            sequenceNumber,
                        });
                        batch.push(data);
                        // The next row links to this one — exactly what a
                        // following log() call would have read from the DB.
                        previousHash = data.currentHash;
                    }
                    await tx.auditLog.createMany({ data: batch });
                    return batch;
                });

                for (const event of groupEvents) {
                    if ((event.severity || AuditSeverity.INFO) === AuditSeverity.CRITICAL) {
                        console.error(`[AUDIT_CRITICAL] ${event.category}:${event.action} by ${event.actorId}`);
                    }
                }
                return rows.length;
            } catch (error) {
                if (this.isSequenceConflictError(error) && attempt < maxAttempts) {
                    continue;
                }
                console.error('[AUDIT_FALLBACK]', {
                    batch: groupEvents.map((e) => `${e.category}:${e.action}`),
                    error: error.message,
                    code: error.code || null,
                    attempt,
                    timestamp: new Date().toISOString(),
                });
                return 0;
            }
        }
        return 0;
    }

    /**
     * Log an audit event INSIDE a caller-supplied Prisma transaction client.
     *
     * Unlike `log()`, this method:
     *   - Does NOT have an internal retry loop. A retry would require its
     *     own tx (the outer one is poisoned after the conflicting create()).
     *     The caller owns the tx and is responsible for retrying the whole
     *     business transaction if needed (see admin status-override route).
     *   - Does NOT swallow errors. The whole point of `logWithin` is to bind
     *     audit success to the business mutation: if the audit insert fails,
     *     the caller's $transaction MUST abort so the business write rolls
     *     back. Re-throwing is therefore essential — silently returning null
     *     here would silently break atomicity.
     *   - Refuses to fall back to the global `prisma` when `tx` is missing.
     *     A missing tx is a programmer bug; defaulting to global prisma
     *     would defeat the purpose of this method.
     *
     * Hash-chain integrity: the previous chainHash is read THROUGH `tx`, so
     * under SERIALIZABLE isolation the read participates in the transaction's
     * snapshot — concurrent inserters serialize behind us. The downstream
     * unique constraint on `sequenceNumber` is the durable backstop if two
     * txs ever do race past serialization (Prisma surfaces it as P2002 →
     * caller's outer retry).
     */
    async logWithin(event, tx) {
        if (!tx || typeof tx !== 'object' || !tx.auditLog || typeof tx.auditLog.create !== 'function') {
            throw new Error(
                '[audit-logger] logWithin(event, tx) requires a Prisma transaction client ' +
                '(with auditLog.create). Pass the `tx` argument from prisma.$transaction(async (tx) => ...). ' +
                'If you want the non-transactional path, call log(event) instead.',
            );
        }
        if (!event || typeof event !== 'object') {
            throw new TypeError('[audit-logger] logWithin: event object is required');
        }

        const { category, action, severity = AuditSeverity.INFO, actorId, organizationId = null } = event;

        // Resolve tenant. We still allow the global prisma to be consulted
        // for the default-org fallback because the `default` Organization
        // row is seeded at boot and is always visible to any tx — using
        // `tx` here would needlessly couple the lookup to the caller's
        // serialization scope without any safety benefit.
        const resolvedOrgId = await this._resolveOrganizationId(organizationId);

        // Hardening batch 2026-07-09 (#664 follow-up): serialize the
        // read-tail → assign-seq → insert critical section with the SAME
        // per-org advisory lock log() takes — the docstring's SERIALIZABLE
        // assumption holds for only ONE caller; the statusTransitionAuditHook
        // callers run default READ COMMITTED, where two concurrent same-org
        // in-tx writers both read tail N, both insert N+1, and the loser's
        // P2002 POISONS the caller's tx (25P02) — best-effort swallows then
        // turn the business COMMIT into a silent ROLLBACK. The lock is held
        // until the CALLER's tx commits/aborts. Contracts:
        //   (1) reentrant — pg xact advisory locks are reentrant within the
        //       owning session, and a Prisma interactive tx pins one
        //       connection, so the writer's rollback path calling logWithin
        //       twice in one tx acquires instantly;
        //   (2) a tx holding this lock must NOT await auditLogger.log()
        //       (separate connection, same lock) before commit — that would
        //       stall log() until its itx timeout. Not reachable today.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_NS}::int4, hashtext(${resolvedOrgId}))`;

        // Read last hash THROUGH the tx so it participates in the transaction
        // snapshot (now lock-stable — same guarantee as log()'s own tx).
        // Scoped to the resolved tenant — per-tenant chain (ADR-014).
        const last = await this.getLastHash(tx, resolvedOrgId);
        const previousHash = last.hash;
        const sequenceNumber = last.sequence + 1;

        const { data } = this._buildAuditRow({
            event,
            resolvedOrgId,
            previousHash,
            sequenceNumber,
        });

        // Insert through the tx client — the row is invisible until the
        // outer $transaction commits, so a downstream failure aborts both
        // the business mutation AND the audit row atomically.
        const auditRecord = await tx.auditLog.create({ data });

        if (severity === AuditSeverity.CRITICAL) {
            console.error(`[AUDIT_CRITICAL] ${category}:${action} by ${actorId}`);
        }

        return auditRecord;
    }

    /**
     * Build (but do not write) an authentication event.
     *
     * Split out of logAuth so a caller that emits SEVERAL events for one
     * request can hand them all to logMany() as a single chain segment
     * without re-deriving the event shape (and drifting from logAuth).
     */
    authEvent(action, actorId, actorRole, outcome, ipAddress, userAgent, metadata = {}) {
        return {
            category: AuditCategory.AUTHENTICATION,
            action,
            actorId,
            actorEmail: metadata.email,
            actorRole,
            resourceType: ResourceType.USER,
            resourceId: actorId,
            ipAddress,
            userAgent,
            metadata,
            result: outcome,
            severity: outcome === 'FAILURE' ? AuditSeverity.WARNING : AuditSeverity.INFO,
        };
    }

    /**
     * Log authentication events
     */
    async logAuth(action, actorId, actorRole, outcome, ipAddress, userAgent, metadata = {}) {
        return this.log(this.authEvent(action, actorId, actorRole, outcome, ipAddress, userAgent, metadata));
    }

    /**
     * Log security events
     */
    async logSecurity(action, actorId, actorRole, ipAddress, userAgent, metadata = {}) {
        return this.log({
            category: AuditCategory.SECURITY,
            action,
            actorId: actorId || 'ANONYMOUS',
            actorRole: actorRole || 'UNKNOWN',
            resourceType: ResourceType.SYSTEM,
            resourceId: 'SECURITY',
            ipAddress,
            userAgent,
            metadata,
            severity: AuditSeverity.WARNING,
        });
    }

    /**
     * Recompute a persisted row's expected currentHash under a specific
     * payload version. Shared by verifyChain's v2-then-v1 fallback.
     */
    _expectedHashForRow(log, timestamp, version) {
        const payload = this.buildHashPayload({
            logId: log.logId,
            sequenceNumber: log.sequenceNumber,
            category: log.category,
            action: log.action,
            actorId: log.actorId,
            resourceType: log.resourceType,
            resourceId: log.resourceId,
            timestamp,
            // v2 columns — ignored by the v1 projection, hashed by v2/v3.
            severity: log.severity,
            actorType: log.actorType,
            actorEmail: log.actorEmail,
            actorRole: log.actorRole,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            metadata: log.metadata,
            result: log.result,
            errorCode: log.errorCode,
            errorMessage: log.errorMessage,
        }, version);
        // v3 recomputes under the keyed HMAC; v2/v1 under the unkeyed sha256.
        return version === 3
            ? this.generateHashV3(payload, log.previousHash)
            : this.generateHash(payload, log.previousHash);
    }

    /**
     * A row is authentic if its stored currentHash matches the recompute under
     * the CURRENT wide payload (v2 — new rows) OR the legacy narrow payload (v1
     * — pre-cutover rows). Try v2 first (the going-forward case). Neither
     * matching ⇒ the row's hashed content was mutated after insert (TAMPERED).
     */
    _rowHashMatchesAnyVersion(log, timestamp) {
        // v3 (keyed HMAC) first — the going-forward case once AUDIT_HASH_HMAC is
        // on. Gated on key availability so a key-less verifier skips v3 instead
        // of throwing in generateHashV3. v2/v1 (unkeyed) keep pre-keying rows
        // green across the cut-over.
        if (this._auditHashKey() != null
            && log.currentHash === this._expectedHashForRow(log, timestamp, 3)) { return true; }
        if (log.currentHash === this._expectedHashForRow(log, timestamp, 2)) { return true; }
        if (log.currentHash === this._expectedHashForRow(log, timestamp, 1)) { return true; }
        return false;
    }

    /**
     * Verify hash chain integrity.
     *
     * Per-tenant (ADR-014): pass `{ organizationId }` to verify that tenant's
     * chain in isolation — its rows form a contiguous GENESIS-rooted chain. A
     * null organizationId scans globally (legacy / diagnostic; only meaningful
     * before per-tenant cut-over or for single-tenant deployments).
     *
     * Each row's currentHash is recomputed and matched under v2 (wide) then v1
     * (legacy narrow) — see _rowHashMatchesAnyVersion — so widening the hashed
     * field set (audit gap #14) does NOT false-flag pre-cutover rows.
     *
     * @param {{ organizationId?: string|null, startSequence?: number, endSequence?: number|null }} [opts]
     */
    async verifyChain({ organizationId = null, startSequence = 1, endSequence = null } = {}) {
        const logs = await this.prisma.auditLog.findMany({
            where: {
                ...(organizationId ? { organizationId } : {}),
                sequenceNumber: {
                    gte: startSequence,
                    ...(endSequence && { lte: endSequence }),
                },
            },
            orderBy: { sequenceNumber: 'asc' },
        });

        let previousHash = 'GENESIS';
        // Windowed scan (caller passed an explicit startSequence > 1) may begin
        // MID-chain: the first in-window row's previousHash points at a row
        // OUTSIDE the window, so anchor the link check to it instead of GENESIS
        // to avoid a false LINK_MISMATCH. The per-row content hash below still
        // validates every row. A FULL scan (startSequence === 1, the default)
        // keeps the strict GENESIS root so a deleted genesis row still surfaces
        // as a LINK_MISMATCH on the new first row.
        if (startSequence > 1 && logs.length > 0) {
            previousHash = logs[0].previousHash;
        }
        const corrupted = [];
        let linkMismatches = 0;
        let hashMismatches = 0;

        for (const log of logs) {
            if (log.previousHash !== previousHash) {
                linkMismatches += 1;
                corrupted.push({
                    type: 'LINK_MISMATCH',
                    logId: log.logId,
                    sequenceNumber: log.sequenceNumber,
                    expected: previousHash,
                    found: log.previousHash,
                });
            }

            const timestamp = this.getIsoTimestamp(log.createdAt);
            if (!timestamp) {
                hashMismatches += 1;
                corrupted.push({
                    type: 'HASH_RECOMPUTE_ERROR',
                    logId: log.logId,
                    sequenceNumber: log.sequenceNumber,
                    expected: 'valid ISO timestamp',
                    found: log.createdAt ?? null,
                });
            } else if (!this._rowHashMatchesAnyVersion(log, timestamp)) {
                hashMismatches += 1;
                corrupted.push({
                    type: 'HASH_MISMATCH',
                    logId: log.logId,
                    sequenceNumber: log.sequenceNumber,
                    // Report the current-version (v2) recompute as the expected.
                    expected: this._expectedHashForRow(log, timestamp, HASH_PAYLOAD_VERSION),
                    found: log.currentHash,
                });
            }
            previousHash = log.currentHash;
        }

        return {
            verified: corrupted.length === 0,
            totalLogs: logs.length,
            linkMismatches,
            hashMismatches,
            corruptedLogs: corrupted,
        };
    }

    /**
     * Close Prisma connection
     */
    async disconnect() {
        await this.prisma.$disconnect();
    }
}

// Singleton instance
const auditLogger = new AuditLogger();

/**
 * WF-F8 — build an `onAudit` callback for application-status-writer's
 * writeApplicationStatus(). It records the canonical status transition as an
 * APPLICATION audit row so transitions driven through the writer (payment-slip
 * upload/approve/reject, onsite-audit result, ...) land in the AuditLog instead
 * of being silently absent. Pass the SAME `tx` the status write uses so the
 * audit row commits atomically with the status UPDATE (logWithin). The writer
 * treats this callback as best-effort and swallows any throw, so a degraded
 * audit backend (or a test stub whose tx lacks auditLog) never blocks the write.
 *
 * @param {object} opts
 * @param {object} opts.tx          — prisma transaction client the status write uses
 * @param {Record<string, unknown>} [opts.metadata] — extra metadata merged into the row
 * @returns {(entry: object) => Promise<unknown>} onAudit callback
 */
function statusTransitionAuditHook({ tx, metadata = {} } = {}) {
    return (entry) => auditLogger.logWithin({
        category: AuditCategory.APPLICATION,
        action: entry?.event || 'APPLICATION_STATUS_TRANSITION',
        severity: AuditSeverity.INFO,
        actorId: entry?.actorId || 'SYSTEM',
        actorRole: entry?.actorRole || 'UNKNOWN',
        resourceType: ResourceType.APPLICATION,
        resourceId: entry?.applicationId,
        metadata: {
            fromStatus: entry?.fromStatus ?? null,
            toStatus: entry?.toStatus ?? null,
            reason: entry?.reason ?? null,
            ...metadata,
        },
    }, tx);
}

module.exports = {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    statusTransitionAuditHook,
};
