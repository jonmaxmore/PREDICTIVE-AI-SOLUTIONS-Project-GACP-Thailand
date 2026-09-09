import type { UserRole } from '@gacp/contracts';
import {
  smallButtonOutlineClassName,
  smallButtonPrimaryClassName,
  Tag,
} from '@/components/application-form/primitives.tsx';
import { messages, roleLabels } from '@/messages/th.ts';

type StaffRoleControlsProps = {
  readonly userId: string;
  readonly heldRoles: readonly UserRole[];
  readonly assignableRoles: readonly UserRole[];
  readonly assignAction: (formData: FormData) => Promise<void>;
  readonly revokeAction: (formData: FormData) => Promise<void>;
};

// บทบาทที่ถืออยู่ (พร้อมปุ่มถอดต่อบทบาท) และฟอร์มมอบบทบาทที่ยังไม่ถือ ใช้ร่วมกันทั้งฝั่งกรมและฝั่งบริษัท
// กติกาว่ามอบ/ถอดได้หรือไม่ตัดสินใน domain ตอนกด ไม่ใช่ที่นี่
export function HeldRoles({
  userId,
  heldRoles,
  revokeAction,
}: Pick<StaffRoleControlsProps, 'userId' | 'heldRoles' | 'revokeAction'>) {
  if (heldRoles.length === 0) {
    return <span className="text-sm text-quiet">{messages.admin.noRoles}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {heldRoles.map((role) => (
        <li key={role} className="inline-flex items-center gap-1.5">
          <Tag tone="info">{roleLabels[role]}</Tag>
          <form action={revokeAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="role" value={role} />
            <button
              type="submit"
              className="text-xs font-semibold text-danger underline-offset-2 hover:underline"
              aria-label={`${messages.admin.revoke} ${roleLabels[role]}`}
            >
              {messages.admin.revoke}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

export function AssignRoleForm({
  userId,
  heldRoles,
  assignableRoles,
  assignAction,
}: Pick<StaffRoleControlsProps, 'userId' | 'heldRoles' | 'assignableRoles' | 'assignAction'>) {
  const options = assignableRoles.filter((role) => !heldRoles.includes(role));
  if (options.length === 0) {
    return <span className="text-sm text-quiet">{messages.admin.allRolesHeld}</span>;
  }
  return (
    <form action={assignAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={options[0]}
        aria-label={messages.admin.columns.assign}
        className="h-[34px] rounded-[10px] border border-border bg-surface px-2 text-[13px]"
      >
        {options.map((role) => (
          <option key={role} value={role}>
            {roleLabels[role]}
          </option>
        ))}
      </select>
      <button type="submit" className={smallButtonPrimaryClassName}>
        {messages.admin.assign}
      </button>
    </form>
  );
}

// ปุ่มถอดแบบยืนยันในตัว (ใช้กับรายชื่อพนักงานและสังกัด)
export function RevokeButton({
  action,
  hiddenName,
  hiddenValue,
  label,
}: {
  readonly action: (formData: FormData) => Promise<void>;
  readonly hiddenName: string;
  readonly hiddenValue: string;
  readonly label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <button type="submit" className={smallButtonOutlineClassName}>
        {label}
      </button>
    </form>
  );
}
