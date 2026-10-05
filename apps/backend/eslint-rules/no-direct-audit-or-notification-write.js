/**
 * gacp/no-direct-audit-or-notification-write
 *
 * Flags any direct `prisma.auditLog.create(...)` /
 * `prisma.notification.create(...)` / `prisma.notification.createMany(...)`
 * call from a file OTHER than the canonical writer.
 *
 * Background: PRs #199, #201, #202 fixed a recurring bug class where
 * direct creates on these two tenant-scoped tables silently failed at
 * runtime because:
 *   1. AuditLog.organizationId and Notification.organizationId are NOT NULL
 *      in schema.
 *   2. The tenant-prisma-extension only auto-injects organizationId when
 *      the AsyncLocalStorage tenant context is bound.
 *   3. Cron paths, public unauthenticated endpoints, and pre-tenant-bind
 *      auth flow paths have no tenant context.
 *   4. Direct creates from those contexts hit Prisma's "Argument
 *      `organization` is missing" rejection.
 *   5. The wrapping `.catch` blocks silently swallowed every failure.
 *
 * The fix in #199/#201/#202 was to route through the canonical writers
 * (`auditLogger.log` / `createNotification` / `createBulkNotifications`)
 * which know how to resolve organizationId from explicit caller arg →
 * AsyncLocalStorage context → User.organizationId lookup → cached
 * default-org id.
 *
 * Allowed:
 *   - `prisma.auditLog.create` from `middleware/audit-logger.js`
 *   - `prisma.notification.create` / `createMany` from
 *     `services/notification-service.js`
 *   - Tests that import the canonical writers (matched by filename)
 *
 * Severity: `error` from day one. The codebase had 16 direct sites at
 * the time of writing; PRs #199/#201/#202 reduced them to 0 (counted
 * via this rule). Lock the regression in.
 */

'use strict';

const CANONICAL_AUDIT_LOG_FILES = [
    /\/apps\/backend\/middleware\/audit-logger\.js$/i,
    /\/apps\/backend\/__tests__\/.*audit-logger\.test\.js$/i,
];

const CANONICAL_NOTIFICATION_FILES = [
    /\/apps\/backend\/services\/notification-service\.js$/i,
    /\/apps\/backend\/__tests__\/.*notification-service\.test\.js$/i,
];

function matches(filename, patterns) {
    if (!filename) {return false;}
    const norm = filename.replace(/\\/g, '/');
    return patterns.some((re) => re.test(norm));
}

/**
 * Decide whether a CallExpression matches `<x>.<model>.<method>(...)`
 * where model and method are the names we care about. Returns
 * { model, method } on match, else null.
 *
 * Accepts any leading identifier chain: `prisma`, `tx`, `this.prisma`,
 * `_prisma`, `db.prisma`, etc. — the regex on the receiver chain is
 * intentionally permissive because tx handles get aliased differently
 * across the codebase.
 */
function matchPrismaCreate(callExpr, modelToMethods) {
    const callee = callExpr.callee;
    if (!callee || callee.type !== 'MemberExpression') {return null;}
    if (callee.property.type !== 'Identifier') {return null;}
    const methodName = callee.property.name;

    const inner = callee.object;
    if (!inner || inner.type !== 'MemberExpression') {return null;}
    if (inner.property.type !== 'Identifier') {return null;}
    const modelName = inner.property.name;

    // hasOwnProperty guard: `modelName` comes from arbitrary AST and could
    // match an Object.prototype member like `toString` or `constructor` —
    // a bracket lookup would return the prototype method (not an array)
    // and `.includes` would throw "is not a function".
    if (!Object.prototype.hasOwnProperty.call(modelToMethods, modelName)) {return null;}
    const allowedMethods = modelToMethods[modelName];
    if (!Array.isArray(allowedMethods)) {return null;}
    if (!allowedMethods.includes(methodName)) {return null;}

    return { model: modelName, method: methodName };
}

const TARGET_MODELS_AND_METHODS = {
    auditLog: ['create', 'createMany'],
    notification: ['create', 'createMany'],
};

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Direct prisma.auditLog.create / prisma.notification.create must go ' +
                'through the canonical writers (auditLogger.log / createNotification) ' +
                'which handle organizationId resolution for unauthenticated and ' +
                'pre-tenant-bind callers.',
            category: 'Best Practices',
            recommended: false,
        },
        schema: [],
        messages: {
            directAuditLogWrite:
                'Direct prisma.auditLog.{{ method }} detected. Use ' +
                'auditLogger.log() from middleware/audit-logger.js — it resolves ' +
                'organizationId via tenant context → user lookup → default-org ' +
                'fallback, and handles all required hash-chain fields. Direct ' +
                'creates 500 silently from cron / public / pre-auth paths ' +
                '(see PR #199 for context).',
            directNotificationWrite:
                'Direct prisma.notification.{{ method }} detected. Use ' +
                'createNotification() / createBulkNotifications() from ' +
                'services/notification-service.js — they resolve organizationId ' +
                'via tenant context → User.organizationId lookup. Direct creates ' +
                'silently drop notifications from cron paths ' +
                '(see PR #202 for context).',
        },
    },

    create(context) {
        const filename = context.filename || context.getFilename();
        const isCanonicalAuditLog = matches(filename, CANONICAL_AUDIT_LOG_FILES);
        const isCanonicalNotification = matches(filename, CANONICAL_NOTIFICATION_FILES);

        return {
            CallExpression(node) {
                const m = matchPrismaCreate(node, TARGET_MODELS_AND_METHODS);
                if (!m) {return;}
                if (m.model === 'auditLog' && isCanonicalAuditLog) {return;}
                if (m.model === 'notification' && isCanonicalNotification) {return;}
                context.report({
                    node,
                    messageId: m.model === 'auditLog'
                        ? 'directAuditLogWrite'
                        : 'directNotificationWrite',
                    data: { method: m.method },
                });
            },
        };
    },
};

// Exposed for unit tests.
module.exports.__test = {
    matches,
    matchPrismaCreate,
    CANONICAL_AUDIT_LOG_FILES,
    CANONICAL_NOTIFICATION_FILES,
    TARGET_MODELS_AND_METHODS,
};
