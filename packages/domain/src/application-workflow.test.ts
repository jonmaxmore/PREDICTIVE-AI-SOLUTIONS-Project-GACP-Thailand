import { ActorKind, ApplicationStatus, FeeStage, RequestType, UserRole } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import {
  type Actor,
  ApplicationEvent,
  SYSTEM_ACTOR,
  statusAfterPaymentSettled,
  TransitionErrorCode,
  transition,
} from './application-workflow.ts';

const asRole = (role: UserRole): Actor => ({ kind: ActorKind.USER, role });
const newRequest = { requestType: RequestType.NEW };
const renewal = { requestType: RequestType.RENEWAL };

describe('เส้นงานคำขอ', () => {
  it('เดินครบจากร่างถึงใบรับรองด้วยผู้กระทำที่ถูกต้องทุกขั้น', () => {
    const path: Array<[ApplicationStatus, ApplicationStatus, Actor, ApplicationEvent]> = [
      [
        ApplicationStatus.DRAFT,
        ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
        asRole(UserRole.APPLICANT),
        ApplicationEvent.APPLICANT_CONFIRMED,
      ],
      [
        ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
        ApplicationStatus.SUBMITTED,
        SYSTEM_ACTOR,
        ApplicationEvent.DOCUMENT_REVIEW_FEE_SETTLED,
      ],
      [
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.UNDER_DOCUMENT_REVIEW,
        asRole(UserRole.DOCUMENT_REVIEWER),
        ApplicationEvent.DOCUMENT_REVIEW_STARTED,
      ],
      [
        ApplicationStatus.UNDER_DOCUMENT_REVIEW,
        ApplicationStatus.REVISION_REQUESTED,
        asRole(UserRole.DOCUMENT_REVIEWER),
        ApplicationEvent.REVISION_REQUESTED,
      ],
      [
        ApplicationStatus.REVISION_REQUESTED,
        ApplicationStatus.UNDER_DOCUMENT_REVIEW,
        asRole(UserRole.APPLICANT),
        ApplicationEvent.REVISION_RESUBMITTED,
      ],
      [
        ApplicationStatus.UNDER_DOCUMENT_REVIEW,
        ApplicationStatus.DOCUMENTS_ACCEPTED,
        asRole(UserRole.DOCUMENT_REVIEWER),
        ApplicationEvent.DOCUMENTS_ACCEPTED,
      ],
      [
        ApplicationStatus.DOCUMENTS_ACCEPTED,
        ApplicationStatus.AWAITING_INSPECTION_FEE,
        SYSTEM_ACTOR,
        ApplicationEvent.INSPECTION_FEE_QUOTED,
      ],
      [
        ApplicationStatus.AWAITING_INSPECTION_FEE,
        ApplicationStatus.AWAITING_INSPECTION,
        SYSTEM_ACTOR,
        ApplicationEvent.INSPECTION_FEE_SETTLED,
      ],
      [
        ApplicationStatus.AWAITING_INSPECTION,
        ApplicationStatus.INSPECTION_SCHEDULED,
        asRole(UserRole.FIELD_INSPECTOR),
        ApplicationEvent.INSPECTION_SCHEDULED,
      ],
      [
        ApplicationStatus.INSPECTION_SCHEDULED,
        ApplicationStatus.UNDER_INSPECTION,
        asRole(UserRole.FIELD_INSPECTOR),
        ApplicationEvent.INSPECTION_STARTED,
      ],
      [
        ApplicationStatus.UNDER_INSPECTION,
        ApplicationStatus.AWAITING_APPROVAL,
        asRole(UserRole.FIELD_INSPECTOR),
        ApplicationEvent.INSPECTION_REPORT_SUBMITTED,
      ],
      [
        ApplicationStatus.AWAITING_APPROVAL,
        ApplicationStatus.CERTIFIED,
        asRole(UserRole.CERTIFICATE_APPROVER),
        ApplicationEvent.CERTIFICATE_APPROVED,
      ],
    ];
    for (const [from, to, actor, event] of path) {
      const result = transition(from, to, actor, newRequest);
      expect(result.ok, `${from} → ${to}`).toBe(true);
      if (result.ok) expect(result.event).toBe(event);
    }
  });

  it('ปฏิเสธการกระโดดข้ามขั้น', () => {
    const result = transition(
      ApplicationStatus.DRAFT,
      ApplicationStatus.SUBMITTED,
      SYSTEM_ACTOR,
      newRequest,
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.INVALID_TRANSITION });
  });

  it('การเงินไม่มีสิทธิ์เปลี่ยนสถานะคำขอเลย', () => {
    const finance = asRole(UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER);
    const attempt = transition(
      ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
      ApplicationStatus.SUBMITTED,
      finance,
      newRequest,
    );
    expect(attempt).toMatchObject({ ok: false, code: TransitionErrorCode.ACTOR_NOT_ALLOWED });
  });

  it('เงินเข้าเปลี่ยนสถานะได้เฉพาะระบบ ไม่ใช่คน', () => {
    const admin = asRole(UserRole.PLATFORM_OPERATOR_ADMIN);
    const attempt = transition(
      ApplicationStatus.AWAITING_INSPECTION_FEE,
      ApplicationStatus.AWAITING_INSPECTION,
      admin,
      newRequest,
    );
    expect(attempt).toMatchObject({ ok: false, code: TransitionErrorCode.ACTOR_NOT_ALLOWED });
  });

  it('ต่ออายุข้ามงวดที่ 2 ไปรอตรวจแปลงทันที และคำขอใหม่ข้ามไม่ได้', () => {
    const renewalSkip = transition(
      ApplicationStatus.DOCUMENTS_ACCEPTED,
      ApplicationStatus.AWAITING_INSPECTION,
      SYSTEM_ACTOR,
      renewal,
    );
    expect(renewalSkip).toMatchObject({
      ok: true,
      event: ApplicationEvent.RENEWAL_SKIPPED_INSPECTION_FEE,
    });
    const newSkip = transition(
      ApplicationStatus.DOCUMENTS_ACCEPTED,
      ApplicationStatus.AWAITING_INSPECTION,
      SYSTEM_ACTOR,
      newRequest,
    );
    expect(newSkip).toMatchObject({ ok: false, code: TransitionErrorCode.INVALID_TRANSITION });
  });

  it('สถานะปลายทางเปลี่ยนต่อไม่ได้', () => {
    const result = transition(
      ApplicationStatus.REJECTED,
      ApplicationStatus.DRAFT,
      asRole(UserRole.APPLICANT),
      newRequest,
    );
    expect(result).toMatchObject({ ok: false, code: TransitionErrorCode.TERMINAL_STATUS });
  });

  it('จุดเชื่อมเส้นเงินมีสองจุด', () => {
    expect(statusAfterPaymentSettled(FeeStage.DOCUMENT_REVIEW)).toBe(ApplicationStatus.SUBMITTED);
    expect(statusAfterPaymentSettled(FeeStage.ONSITE_INSPECTION)).toBe(
      ApplicationStatus.AWAITING_INSPECTION,
    );
  });
});
