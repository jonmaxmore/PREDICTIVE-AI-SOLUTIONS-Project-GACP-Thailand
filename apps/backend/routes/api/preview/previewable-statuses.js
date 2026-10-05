'use strict';

/**
 * States in which an applicant may render a preview of their own application.
 *
 * One list, two routes. GET /:id/prepare carried this whitelist inline while
 * POST /:id/prepare-preview scoped its lookup to `status: 'REGISTERED'` — a
 * value nothing writes — so the two disagreed and the POST route answered 404
 * for every real application. A shared constant makes them agree by
 * construction.
 *
 * REVISION_REQUESTED and CAR_PENDING are active, editable states — they
 * mirror EDITABLE_STATUSES (routes/api/applications/applications.js:212),
 * which already lets the farmer edit the application in both. The resubmit
 * button, however, lives ONLY on this preview page (client-view.tsx:425-450),
 * so leaving these two out of THIS list meant an auditor could send an
 * application back, the farmer could edit it, but never see the door to send
 * it forward again: the preview API 400'd "Application is not in previewable
 * state" and the button never rendered (F-PREVIEW-REVISION-CLOSED, found by
 * the s03 real-DB walk 2026-08-18). They belong here with the other
 * pre-certification states — distinct from the terminal states below, which
 * are excluded on purpose.
 *
 * Deliberately excludes the terminal states (REJECTED / EXPIRED /
 * CANCEL_EXPIRED / CERTIFIED): a preview of a closed file is not an action the
 * applicant can act on, and CERTIFIED has the certificate itself instead.
 *
 * Canonical WORKFLOW_STATES only — the legacy 'REGISTERED' spelling is gone
 * with PR 2b, which stopped every writer producing non-canonical values.
 */
const PREVIEWABLE_STATUSES = Object.freeze(new Set([
    'DRAFT',
    'SUBMITTED',
    'PENDING_DOC_FEE',
    'DOC_FEE_PAID',
    'REVISION_REQUESTED',
    'CAR_PENDING',
]));

module.exports = PREVIEWABLE_STATUSES;
