/**
 * gacp/no-legacy-status-vocabulary — PR 2d ratchet.
 *
 * PR 2c deleted three translation tables (LEGACY_STATUS_BY_STATE,
 * STATE_BY_LEGACY_STATUS, STATE_INPUT_ALIASES — ~100 entries) and every legacy
 * `Application.status` spelling that fed them. This rule is what stops them
 * growing back.
 *
 * They did not arrive all at once. Each entry was added by someone who hit an
 * unrecognised status and reached for the smallest fix: one more alias, just
 * for this case. Individually reasonable, collectively a layer nobody could
 * remove, because at any moment some live code depended on some entry. The
 * only way out was to close the writer vocabulary (PR 2b), delete the layer
 * (PR 2c), and then make re-adding an entry fail the build.
 *
 * POSITIONAL, NOT A STRING SEARCH. The first draft of this rule matched the
 * words anywhere and produced 31 violations across the codebase, of which the
 * large majority were correct code:
 *
 *   _safeAudit('AUDIT_SCHEDULED', ...)              — an audit-log action
 *   fanout.send({ type: 'AUDIT_SCHEDULED' })        — a NotifyType
 *   write({ reason: 'AUDIT_SCHEDULED' })            — a transition reason code
 *   prisma.audit.findMany({ status: 'SCHEDULED' })  — Audit.status, another model
 *   config.workType === 'DOC_REVIEW'                — a WorkActivity workType
 *   STAGES = { REVISION_REQUIRED: ... }             — a dashboard stage name
 *
 * A gate that flags thirty things, most of them fine, teaches people to
 * disable it — and then it catches nothing. So the rule fires only where a
 * string actually occupies an Application-status position:
 *
 *   1. the value of a `status` / `toStatus` / `fromStatus` / `nextStatus`
 *      property — but only when it is not a different model's status (see
 *      MODEL_SCOPED_STATUS below);
 *   2. inside the `in:` array of such a property (a Prisma filter);
 *   3. an element of an array or Set assigned to an identifier whose name
 *      says it holds statuses or states (`EDITABLE_STATUSES`, `CLOSED_STATES`);
 *   4. the other side of a comparison against something `.status`.
 *
 * Prose is exempt for free: ESLint hands us the AST, so only real string
 * literals are examined. A comment explaining why a value was removed is
 * documentation, not a violation. Substrings do not count either —
 * 'NOT_REGISTERED_YET' is not 'REGISTERED'.
 */

'use strict';

/**
 * Legacy `Application.status` spellings, removed in PR 2c.
 *
 * Compared case-insensitively, because the deleted STATE_INPUT_ALIASES table
 * keyed on the lowercase forms.
 */
const LEGACY_STATUS_SPELLINGS = new Set([
    'PAYMENT_1_PENDING',
    'PAYMENT_1_PAID',
    'PAYMENT_2_PENDING',
    'PAYMENT_2_COMPLETED',
    'PAYMENT_PHASE_1',
    'PAYMENT_PHASE_2',
    // สลิปถูกปลดระวาง 2026-09-11 (operator: "ไม่อยากให้มีงานมาเรียกผิดอีกในปัจจุบัน
    // และอนาคต") · การจ่ายเป็น Stripe และ webhook ที่ยืนยันลายเซ็นแล้วเป็นผู้ตัดสถานะ
    // ไม่มีมนุษย์คนใดอนุมัติการชำระเงิน · แถวในฐานทั้งสามฐาน = 0 ก่อนลบ
    'PHASE_1_SLIP_UNDER_REVIEW',
    'PHASE_2_SLIP_UNDER_REVIEW',
    // ขั้นบนจอที่คู่กัน — "รอตรวจสอบการชำระเงิน" บอกผู้ยื่นว่ามีเจ้าหน้าที่กำลังตรวจเงินเขา
    // ซึ่งไม่มีอยู่จริง · แทนที่ด้วย PENDING_AUDIT_SCHEDULE (จ่ายงวดที่ 2 แล้ว รอนัดวัน)
    'PAYMENT_UNDER_REVIEW',
    'REGISTERED',
    'PENDING_REVIEW',
    'IN_REVIEW',
    'UNDER_REVIEW',
    'DOC_REVIEW',
    'DOC_REVIEW_IN_PROGRESS',
    'PENDING_DOCUMENT_REVIEW',
    'REVISION_REQUIRED',
    'REVISION_REQ',
    'DOCUMENT_APPROVED',
    'WAITING_PHASE2_PAYMENT',
    'AWAITING_SCHEDULE',
    'SCHEDULABLE',
    'SCHEDULING',
    'SCHEDULED',
    'AUDIT_SCHEDULED',
    'AUDIT_IN_PROGRESS',
    'PENDING_AUDIT',
    'INSPECTION_SCHEDULED',
    'INSPECTION_IN_PROGRESS',
    'INSPECTION_COMPLETED',
    'AUDITED',
    'FINAL_APPROVED',
    'FINAL_REJECTED',
    'AUDIT_FAILED',
    'CAR_SUBMITTED',
    'SLIP_UNDER_REVIEW',
    'PAYMENT_SLIP_REVIEW',
]);

/** The deleted translation tables, by name. */
const DELETED_TRANSLATION_SYMBOLS = new Set([
    'STATE_BY_LEGACY_STATUS',
    'LEGACY_STATUS_BY_STATE',
    'STATE_INPUT_ALIASES',
]);

/** Property keys that name an Application status. */
const STATUS_KEYS = new Set(['status', 'toStatus', 'fromStatus', 'nextStatus', 'newStatus']);

/**
 * Models whose OWN `status` column shares these words. A `status` key reached
 * through one of these is that model's vocabulary, not Application's.
 */
const MODEL_SCOPED_STATUS = new Set([
    'audit', 'auditSchedule', 'paymentSlip', 'purchaseInvoice', 'invoice',
    'payment', 'certificate', 'workActivity', 'revisionDeadline', 'notification',
    'subscription', 'subscriptionOrder', 'harvestBatch', 'plantingCycle',
]);

/**
 * Identifier names that say "this holds application statuses/states".
 *
 * Contains rather than ends-with, so `WORKFLOW_STATE_ALLOWLIST` and
 * `AUDIT_STATES` both match. A container named without either word (the real
 * `PHASE2_ELIGIBLE` was one) is outside the rule's reach by design — the fix
 * there is to name it for what it holds, which PR 2d did.
 */
const STATUS_CONTAINER_NAME = /(STATUS|STATE)/i;

function isLegacySpelling(node) {
    return node
        && node.type === 'Literal'
        && typeof node.value === 'string'
        && LEGACY_STATUS_SPELLINGS.has(node.value.toUpperCase());
}

function propertyKeyName(propertyNode) {
    const key = propertyNode.key;
    if (!key) { return null; }
    if (key.type === 'Identifier' && !propertyNode.computed) { return key.name; }
    if (key.type === 'Literal' && typeof key.value === 'string') { return key.value; }
    return null;
}

/**
 * Walk up from a `status`-keyed property to the Prisma model it belongs to, so
 * `prisma.audit.findMany({ where: { status: 'SCHEDULED' } })` is recognised as
 * Audit.status rather than Application.status. Returns a model name or null.
 */
function enclosingPrismaModel(node) {
    let current = node;
    for (let depth = 0; current && depth < 12; depth += 1) {
        if (current.type === 'CallExpression' && current.callee?.type === 'MemberExpression') {
            // prisma.<model>.<op>(...) / tx.<model>.<op>(...)
            const modelNode = current.callee.object;
            if (modelNode?.type === 'MemberExpression' && modelNode.property?.type === 'Identifier') {
                return modelNode.property.name;
            }
        }
        current = current.parent;
    }
    return null;
}

/** Is this literal the value of an Application-status property? */
function isStatusPropertyValue(node) {
    const parent = node.parent;
    if (!parent || parent.type !== 'Property' || parent.value !== node) { return false; }
    const key = propertyKeyName(parent);
    if (!key || !STATUS_KEYS.has(key)) { return false; }
    const model = enclosingPrismaModel(parent);
    return !(model && MODEL_SCOPED_STATUS.has(model));
}

/** Is this literal inside `status: { in: [...] }` (or notIn / equals / not)? */
function isStatusFilterMember(node) {
    const arrayNode = node.parent;
    if (!arrayNode || arrayNode.type !== 'ArrayExpression') { return false; }
    const filterProp = arrayNode.parent;
    if (!filterProp || filterProp.type !== 'Property') { return false; }
    const filterKey = propertyKeyName(filterProp);
    if (!['in', 'notIn', 'equals', 'not', 'hasSome', 'hasEvery'].includes(filterKey)) { return false; }
    const objectNode = filterProp.parent;
    const statusProp = objectNode?.parent;
    if (!statusProp || statusProp.type !== 'Property') { return false; }
    const key = propertyKeyName(statusProp);
    if (!key || !STATUS_KEYS.has(key)) { return false; }
    const model = enclosingPrismaModel(statusProp);
    return !(model && MODEL_SCOPED_STATUS.has(model));
}

/**
 * Is this literal an element of an array/Set assigned to a status-named
 * identifier? Catches `const EDITABLE_STATUSES = new Set([...])` and
 * `const CLOSED_STATES = [...]`.
 */
function isStatusContainerMember(node) {
    const arrayNode = node.parent;
    if (!arrayNode || arrayNode.type !== 'ArrayExpression') { return false; }

    let container = arrayNode.parent;
    // Unwrap `new Set([...])` / `Object.freeze([...])`.
    if (container && (container.type === 'NewExpression' || container.type === 'CallExpression')) {
        container = container.parent;
    }
    if (!container) { return false; }

    if (container.type === 'VariableDeclarator' && container.id?.type === 'Identifier') {
        return STATUS_CONTAINER_NAME.test(container.id.name);
    }
    if (container.type === 'Property') {
        const key = propertyKeyName(container);
        return Boolean(key) && STATUS_CONTAINER_NAME.test(key);
    }
    if (container.type === 'AssignmentExpression' && container.left?.type === 'Identifier') {
        return STATUS_CONTAINER_NAME.test(container.left.name);
    }
    return false;
}

/** Is this literal compared against something whose property is `.status`? */
function isStatusComparison(node) {
    const parent = node.parent;
    if (!parent || parent.type !== 'BinaryExpression') { return false; }
    if (!['===', '!==', '==', '!='].includes(parent.operator)) { return false; }
    const other = parent.left === node ? parent.right : parent.left;
    if (other?.type === 'MemberExpression' && other.property?.type === 'Identifier') {
        return STATUS_KEYS.has(other.property.name);
    }
    if (other?.type === 'Identifier') {
        return STATUS_KEYS.has(other.name);
    }
    return false;
}

function isApplicationStatusPosition(node) {
    return isStatusPropertyValue(node)
        || isStatusFilterMember(node)
        || isStatusContainerMember(node)
        || isStatusComparison(node);
}

/** Tests may name the deleted symbols in order to assert they are gone. */
function isTestFile(filename) {
    if (!filename) { return false; }
    const norm = filename.replace(/\\/g, '/');
    return /\/__tests__\//i.test(norm) || /\.test\.js$/i.test(norm) || /\/eslint-rules\//i.test(norm);
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Ban legacy Application.status spellings in status positions, and the '
                + 'translation tables deleted in PR 2c',
        },
        schema: [],
        messages: {
            legacyStatus:
                '"{{value}}" is a legacy Application.status spelling, removed in PR 2c. '
                + 'No writer produces it and no row holds it, so this can never match. '
                + 'Use a canonical state from WORKFLOW_STATES '
                + '(services/workflow-transition-service.js).',
            deletedSymbol:
                '{{name}} was deleted in PR 2c. The status column holds canonical states only, '
                + 'so there is nothing left to translate — re-introducing a legacy-to-canonical '
                + 'map restarts the layer that took three PRs to remove. '
                + 'Use normalizeWorkflowStateInput() instead; it is fail-closed by design.',
        },
    },

    create(context) {
        const filename = context.filename || context.getFilename();
        const inTest = isTestFile(filename);

        return {
            Literal(node) {
                // Tests must be able to name a banned value in order to assert
                // it is rejected, and this rule file declares the ban list
                // itself. Production code is covered here; test fixtures are
                // covered by the source scan in
                // __tests__/unit/legacy-status-translation-purge.test.js.
                if (inTest) { return; }
                if (!isLegacySpelling(node)) { return; }
                if (!isApplicationStatusPosition(node)) { return; }
                context.report({
                    node,
                    messageId: 'legacyStatus',
                    data: { value: node.value },
                });
            },

            Identifier(node) {
                if (inTest) { return; }
                if (!DELETED_TRANSLATION_SYMBOLS.has(node.name)) { return; }
                context.report({
                    node,
                    messageId: 'deletedSymbol',
                    data: { name: node.name },
                });
            },
        };
    },
};
