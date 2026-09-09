import { ROLES_BY_SIDE, type RoleSide, type UserRole } from '@gacp/contracts';
import { devLogin } from '@/app/auth/login/actions.ts';
import { messages, roleLabels, roleSideLabels } from '@/messages/th.ts';

type DevLoginFormProps = {
  readonly sides: readonly RoleSide[];
  readonly defaultRole: UserRole;
  readonly next: string | undefined;
  readonly errorMessage: string | undefined;
};

// ฟอร์มเข้าสู่ระบบแบบทดสอบ (เฉพาะเครื่องพัฒนา): เลือกบทบาทจากฝั่งที่หน้านั้นให้เลือก
// หน้าสาธารณะให้เลือกทั้ง 3 ฝั่ง หน้าบริษัทให้เลือกเฉพาะบทบาทฝั่งบริษัท
export function DevLoginForm({ sides, defaultRole, next, errorMessage }: DevLoginFormProps) {
  return (
    <section className="rounded-xl border border-warning-tint bg-surface p-5 shadow-card">
      <h2 className="text-base font-bold text-warning">{messages.login.devTitle}</h2>
      <p className="mt-1 text-sm text-muted">{messages.login.devDescription}</p>
      <form action={devLogin} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {messages.login.displayNameLabel}
          <input
            name="displayName"
            required
            minLength={1}
            maxLength={120}
            placeholder={messages.login.displayNamePlaceholder}
            className="h-11 rounded-md border border-border bg-surface px-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {messages.login.roleLabel}
          <select
            name="role"
            required
            defaultValue={defaultRole}
            className="h-11 rounded-md border border-border bg-surface px-3 font-normal"
          >
            {sides.map((side) => (
              <optgroup key={side} label={roleSideLabels[side]}>
                {ROLES_BY_SIDE[side].map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md bg-danger-tint px-3 py-2 text-sm font-semibold text-danger"
          >
            {errorMessage}
          </p>
        ) : null}
        <button
          type="submit"
          className="h-12 rounded-md bg-leaf px-6 font-bold text-white shadow-button transition-colors hover:bg-leaf-hover"
        >
          {messages.login.submit}
        </button>
      </form>
    </section>
  );
}
