import {
  ActorKind,
  ApplicationStatus,
  FeeStage,
  RequestType,
  TERMINAL_APPLICATION_STATUSES,
  UserRole,
} from '@gacp/contracts';

// ผู้กระทำ: คนที่มีบทบาท หรือระบบ (webhook ของ Stripe, Automation)
export type Actor =
  | { readonly kind: typeof ActorKind.USER; readonly role: UserRole }
  | { readonly kind: typeof ActorKind.SYSTEM };

export const SYSTEM_ACTOR: Actor = { kind: ActorKind.SYSTEM };

// เหตุการณ์ที่ทำให้สถานะเปลี่ยน บันทึกลง application_status_transitions.event
export const ApplicationEvent = {
  APPLICANT_CONFIRMED: 'APPLICANT_CONFIRMED',
  APPLICANT_REOPENED_DRAFT: 'APPLICANT_REOPENED_DRAFT',
  APPLICANT_WITHDREW: 'APPLICANT_WITHDREW',
  DOCUMENT_REVIEW_FEE_SETTLED: 'DOCUMENT_REVIEW_FEE_SETTLED',
  DOCUMENT_REVIEW_STARTED: 'DOCUMENT_REVIEW_STARTED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  REVISION_RESUBMITTED: 'REVISION_RESUBMITTED',
  DOCUMENTS_ACCEPTED: 'DOCUMENTS_ACCEPTED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  INSPECTION_FEE_QUOTED: 'INSPECTION_FEE_QUOTED',
  INSPECTION_FEE_SETTLED: 'INSPECTION_FEE_SETTLED',
  RENEWAL_SKIPPED_INSPECTION_FEE: 'RENEWAL_SKIPPED_INSPECTION_FEE',
  INSPECTION_SCHEDULED: 'INSPECTION_SCHEDULED',
  INSPECTION_STARTED: 'INSPECTION_STARTED',
  INSPECTION_REPORT_SUBMITTED: 'INSPECTION_REPORT_SUBMITTED',
  CERTIFICATE_APPROVED: 'CERTIFICATE_APPROVED',
  CERTIFICATE_DENIED: 'CERTIFICATE_DENIED',
  REINSPECTION_ORDERED: 'REINSPECTION_ORDERED',
  CERTIFICATE_REVOKED: 'CERTIFICATE_REVOKED',
  CERTIFICATE_EXPIRED: 'CERTIFICATE_EXPIRED',
} as const;
export type ApplicationEvent = (typeof ApplicationEvent)[keyof typeof ApplicationEvent];

export type TransitionContext = {
  readonly requestType: RequestType;
};

type TransitionRule = {
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;
  readonly event: ApplicationEvent;
  readonly allowedRoles: ReadonlySet<UserRole> | 'SYSTEM';
  readonly guard?: (context: TransitionContext) => boolean;
};

const roles = (...list: UserRole[]): ReadonlySet<UserRole> => new Set(list);

// ตารางเดียวของเส้นงาน (แผน §6.1) ไม่มีที่อื่นเขียนสถานะได้
const TRANSITION_RULES: readonly TransitionRule[] = [
  {
    from: ApplicationStatus.DRAFT,
    to: ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
    event: ApplicationEvent.APPLICANT_CONFIRMED,
    allowedRoles: roles(UserRole.APPLICANT),
  },
  {
    from: ApplicationStatus.DRAFT,
    to: ApplicationStatus.WITHDRAWN,
    event: ApplicationEvent.APPLICANT_WITHDREW,
    allowedRoles: roles(UserRole.APPLICANT),
  },
  {
    from: ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
    to: ApplicationStatus.SUBMITTED,
    event: ApplicationEvent.DOCUMENT_REVIEW_FEE_SETTLED,
    allowedRoles: 'SYSTEM',
  },
  {
    from: ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
    to: ApplicationStatus.DRAFT,
    event: ApplicationEvent.APPLICANT_REOPENED_DRAFT,
    allowedRoles: roles(UserRole.APPLICANT),
  },
  {
    from: ApplicationStatus.AWAITING_DOCUMENT_REVIEW_FEE,
    to: ApplicationStatus.WITHDRAWN,
    event: ApplicationEvent.APPLICANT_WITHDREW,
    allowedRoles: roles(UserRole.APPLICANT),
  },
  {
    from: ApplicationStatus.SUBMITTED,
    to: ApplicationStatus.UNDER_DOCUMENT_REVIEW,
    event: ApplicationEvent.DOCUMENT_REVIEW_STARTED,
    allowedRoles: roles(UserRole.DOCUMENT_REVIEWER),
  },
  {
    from: ApplicationStatus.UNDER_DOCUMENT_REVIEW,
    to: ApplicationStatus.REVISION_REQUESTED,
    event: ApplicationEvent.REVISION_REQUESTED,
    allowedRoles: roles(UserRole.DOCUMENT_REVIEWER),
  },
  {
    from: ApplicationStatus.UNDER_DOCUMENT_REVIEW,
    to: ApplicationStatus.DOCUMENTS_ACCEPTED,
    event: ApplicationEvent.DOCUMENTS_ACCEPTED,
    allowedRoles: roles(UserRole.DOCUMENT_REVIEWER),
  },
  {
    from: ApplicationStatus.UNDER_DOCUMENT_REVIEW,
    to: ApplicationStatus.REJECTED,
    event: ApplicationEvent.APPLICATION_REJECTED,
    allowedRoles: roles(UserRole.DOCUMENT_REVIEWER),
  },
  {
    from: ApplicationStatus.REVISION_REQUESTED,
    to: ApplicationStatus.UNDER_DOCUMENT_REVIEW,
    event: ApplicationEvent.REVISION_RESUBMITTED,
    allowedRoles: roles(UserRole.APPLICANT),
  },
  {
    from: ApplicationStatus.REVISION_REQUESTED,
    to: ApplicationStatus.REJECTED,
    event: ApplicationEvent.APPLICATION_REJECTED,
    allowedRoles: roles(UserRole.DOCUMENT_REVIEWER),
  },
  {
    from: ApplicationStatus.DOCUMENTS_ACCEPTED,
    to: ApplicationStatus.AWAITING_INSPECTION_FEE,
    event: ApplicationEvent.INSPECTION_FEE_QUOTED,
    allowedRoles: 'SYSTEM',
    guard: (context) => context.requestType !== RequestType.RENEWAL,
  },
  {
    from: ApplicationStatus.DOCUMENTS_ACCEPTED,
    to: ApplicationStatus.AWAITING_INSPECTION,
    event: ApplicationEvent.RENEWAL_SKIPPED_INSPECTION_FEE,
    allowedRoles: 'SYSTEM',
    guard: (context) => context.requestType === RequestType.RENEWAL,
  },
  {
    from: ApplicationStatus.AWAITING_INSPECTION_FEE,
    to: ApplicationStatus.AWAITING_INSPECTION,
    event: ApplicationEvent.INSPECTION_FEE_SETTLED,
    allowedRoles: 'SYSTEM',
  },
  {
    from: ApplicationStatus.AWAITING_INSPECTION,
    to: ApplicationStatus.INSPECTION_SCHEDULED,
    event: ApplicationEvent.INSPECTION_SCHEDULED,
    allowedRoles: roles(UserRole.FIELD_INSPECTOR),
  },
  {
    from: ApplicationStatus.INSPECTION_SCHEDULED,
    to: ApplicationStatus.UNDER_INSPECTION,
    event: ApplicationEvent.INSPECTION_STARTED,
    allowedRoles: roles(UserRole.FIELD_INSPECTOR),
  },
  {
    from: ApplicationStatus.UNDER_INSPECTION,
    to: ApplicationStatus.AWAITING_APPROVAL,
    event: ApplicationEvent.INSPECTION_REPORT_SUBMITTED,
    allowedRoles: roles(UserRole.FIELD_INSPECTOR),
  },
  {
    from: ApplicationStatus.AWAITING_APPROVAL,
    to: ApplicationStatus.CERTIFIED,
    event: ApplicationEvent.CERTIFICATE_APPROVED,
    allowedRoles: roles(UserRole.CERTIFICATE_APPROVER),
  },
  {
    from: ApplicationStatus.AWAITING_APPROVAL,
    to: ApplicationStatus.NOT_CERTIFIED,
    event: ApplicationEvent.CERTIFICATE_DENIED,
    allowedRoles: roles(UserRole.CERTIFICATE_APPROVER),
  },
  {
    from: ApplicationStatus.AWAITING_APPROVAL,
    to: ApplicationStatus.AWAITING_INSPECTION,
    event: ApplicationEvent.REINSPECTION_ORDERED,
    allowedRoles: roles(UserRole.CERTIFICATE_APPROVER),
  },
  {
    from: ApplicationStatus.CERTIFIED,
    to: ApplicationStatus.REVOKED,
    event: ApplicationEvent.CERTIFICATE_REVOKED,
    allowedRoles: roles(UserRole.CERTIFICATE_APPROVER),
  },
  {
    from: ApplicationStatus.CERTIFIED,
    to: ApplicationStatus.EXPIRED,
    event: ApplicationEvent.CERTIFICATE_EXPIRED,
    allowedRoles: 'SYSTEM',
  },
];

export const TransitionErrorCode = {
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ACTOR_NOT_ALLOWED: 'ACTOR_NOT_ALLOWED',
  TERMINAL_STATUS: 'TERMINAL_STATUS',
} as const;
export type TransitionErrorCode = (typeof TransitionErrorCode)[keyof typeof TransitionErrorCode];

export type TransitionResult =
  | {
      readonly ok: true;
      readonly from: ApplicationStatus;
      readonly to: ApplicationStatus;
      readonly event: ApplicationEvent;
    }
  | { readonly ok: false; readonly code: TransitionErrorCode; readonly messageTh: string };

function actorMayPerform(rule: TransitionRule, actor: Actor): boolean {
  if (rule.allowedRoles === 'SYSTEM') return actor.kind === ActorKind.SYSTEM;
  return actor.kind === ActorKind.USER && rule.allowedRoles.has(actor.role);
}

export function transition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actor: Actor,
  context: TransitionContext,
): TransitionResult {
  if (TERMINAL_APPLICATION_STATUSES.has(from)) {
    return {
      ok: false,
      code: TransitionErrorCode.TERMINAL_STATUS,
      messageTh: 'คำขอนี้ถึงสถานะปลายทางแล้ว เปลี่ยนต่อไม่ได้',
    };
  }
  const candidates = TRANSITION_RULES.filter(
    (rule) => rule.from === from && rule.to === to && (rule.guard?.(context) ?? true),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      code: TransitionErrorCode.INVALID_TRANSITION,
      messageTh: 'เส้นงานไม่อนุญาตให้เปลี่ยนสถานะแบบนี้',
    };
  }
  const rule = candidates.find((candidate) => actorMayPerform(candidate, actor));
  if (!rule) {
    return {
      ok: false,
      code: TransitionErrorCode.ACTOR_NOT_ALLOWED,
      messageTh: 'บทบาทนี้ไม่มีสิทธิ์เปลี่ยนสถานะคำขอในขั้นนี้',
    };
  }
  return { ok: true, from, to, event: rule.event };
}

// สถานะถัดไปเมื่อเงินงวดหนึ่งเข้า: จุดเชื่อมเส้นเงินกับเส้นงานมีสองจุดเท่านั้น
export function statusAfterPaymentSettled(feeStage: FeeStage): ApplicationStatus {
  return feeStage === FeeStage.DOCUMENT_REVIEW
    ? ApplicationStatus.SUBMITTED
    : ApplicationStatus.AWAITING_INSPECTION;
}

export function allowedTransitionsFrom(
  from: ApplicationStatus,
  context: TransitionContext,
): readonly TransitionRule[] {
  return TRANSITION_RULES.filter((rule) => rule.from === from && (rule.guard?.(context) ?? true));
}
