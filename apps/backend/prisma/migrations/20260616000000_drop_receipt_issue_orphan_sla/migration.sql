-- Drop the orphaned RECEIPT_ISSUE work-activity SLA policy + defensive config.
--
-- WHY: receipt / tax-invoice issuance in GACP is a fully AUTOMATIC system action,
-- not a human worklist task. On ACCOUNT slip approval, payment-slip-service.approveSlip()
-- fires fire-and-forget autoIssueReceiptTracked() + receipt-auto-sign-service.signReceiptOnApproval()
-- after the tx commits — no human in the loop. The only human receipt path is
-- invoiceService.retryReceiptIssue, surfaced via listReceiptFailures() as a separate
-- exception queue (error recovery, not a routine per-payment task).
--
-- The RECEIPT_ISSUE SLA policy seeded by 20260430160000 (id sla_receipt_issue) is
-- therefore UNREACHABLE: work-activity-service.createForStage() only spawns a row when a
-- stage_activity_configs row matches the entered stage, and NONE of the 8 seeded configs
-- carries workType=RECEIPT_ISSUE. Standard BPMN (service-task vs user-task), ERP AP/AR
-- straight-through-with-exceptions, and the Thai e-Tax/e-Receipt auto-issue-on-payment norm
-- all model issuance-on-payment as an automated system action — so this is dead config.
--
-- We add a NEW forward migration rather than editing the already-applied 20260430160000
-- migration in place. No behavior change: the workType is unreachable.

BEGIN;

DELETE FROM "sla_policies" WHERE "workType" = 'RECEIPT_ISSUE';            -- id sla_receipt_issue
DELETE FROM "stage_activity_configs" WHERE "workType" = 'RECEIPT_ISSUE';  -- defensive; none seeded

COMMIT;
