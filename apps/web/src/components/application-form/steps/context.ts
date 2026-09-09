import type { FeeEstimate } from '@/lib/application-form/fee-estimate.ts';
import type {
  ApplicationForForm,
  FormRequirements,
  StepProgress,
} from '@/lib/application-form/queries.ts';
import type { CurrentUser } from '@/lib/current-user.ts';

// ข้อมูลที่ทุกขั้นของฟอร์มได้รับจากหน้า (โหลดครั้งเดียวต่อ request)
export type StepPageContext = {
  readonly application: ApplicationForForm;
  readonly requirements: FormRequirements;
  readonly progress: readonly StepProgress[];
  readonly user: CurrentUser;
  readonly editable: boolean;
  readonly feeEstimates: readonly FeeEstimate[];
  // จาก query string หลัง redirect ของ Server Action
  readonly errorCode: string | null;
  readonly errorSlot: string | null;
  readonly highlightMissing: boolean;
};

export function stepPath(applicationId: string, step: number): string {
  return `/applicant/applications/${applicationId}/steps/${step}`;
}

export type PlantOption = { readonly code: string; readonly nameTh: string };
