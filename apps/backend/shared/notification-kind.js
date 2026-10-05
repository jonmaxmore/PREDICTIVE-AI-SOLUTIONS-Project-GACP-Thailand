'use strict';

/**
 * Notification letter-class SSOT — R2 M1 (operator decision D-9, 2026-08-03;
 * evidence/R2-special-reopen/decisions-final.md).
 *
 * `Notification.kind` separates ephemeral notices from official letters:
 *
 *   GENERAL          default — every pre-existing row and every notice
 *                    created by the existing notification pipelines.
 *   OFFICIAL_LETTER  จดหมายราชการในระบบ — permanent archive (D-9 "เก็บถาวร").
 *                    Rows of this kind are EXCLUDED from all three deletion
 *                    paths (weekly cleanup in scheduler/job-scheduler.js,
 *                    PDPA erasure in pdpa-erasure-service.js, and the
 *                    per-user opt-out gate in notification-service.js) and
 *                    are written only via
 *                    notification-service.createOfficialLetter.
 *
 * Same discipline as shared/checkout-status.js: ONE frozen String vocabulary
 * in ONE defining file; consumers import — never re-spell the literals
 * (the project rules Law 3.5/3.6; grep-pinned by __tests__/unit/official-letter.test.js).
 * The matching Postgres CHECK constraint lives in migration
 * 20260803120000_add_notification_kind.
 */

const NOTIFICATION_KINDS = Object.freeze(['GENERAL', 'OFFICIAL_LETTER']);

const NOTIFICATION_KIND = Object.freeze({
    GENERAL: 'GENERAL',
    OFFICIAL_LETTER: 'OFFICIAL_LETTER',
});

module.exports = { NOTIFICATION_KINDS, NOTIFICATION_KIND };
