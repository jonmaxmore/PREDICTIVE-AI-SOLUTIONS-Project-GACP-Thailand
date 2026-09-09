import { ROLES_BY_SIDE, RoleSide, UserRole } from '@gacp/contracts';
import { formatThaiDateTime } from '@gacp/ui';
import {
  AssignRoleForm,
  HeldRoles,
  RevokeButton,
} from '@/components/admin/staff-role-controls.tsx';
import {
  buttonPrimaryClassName,
  Note,
  smallButtonPrimaryClassName,
  Tag,
} from '@/components/application-form/primitives.tsx';
import { RoleShell } from '@/components/role-shell.tsx';
import {
  listCertificationBodyStaff,
  listPlatformOperatorMemberships,
} from '@/lib/account-admin.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { messages, roleHomeIntro, roleLabels } from '@/messages/th.ts';
import {
  addPlatformOperatorMembership,
  assignRole,
  revokePlatformOperatorMembership,
  revokeRole,
} from './actions.ts';

const PAGE = '/platform-operator/admin';

type PageProps = { readonly searchParams: Promise<{ readonly error?: string }> };

function errorMessageFor(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const errors = messages.admin.errors as Record<string, string>;
  return errors[code] ?? messages.admin.errors.invalid;
}

// ผู้ดูแลระบบของบริษัท: รายชื่อพนักงาน บทบาทฝั่งบริษัท และการตั้งผู้ดูแลระบบให้กรม (ไม่มีเงิน ไม่มีการตัดสินคำขอ)
export default async function PlatformOperatorAdminPage({ searchParams }: PageProps) {
  const actor = await requireUserWithRole(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE);
  const [{ error }, memberships, certificationBodyStaff] = await Promise.all([
    searchParams,
    listPlatformOperatorMemberships(),
    listCertificationBodyStaff(),
  ]);
  const admin = messages.admin;
  const errorMessage = errorMessageFor(error);
  const inputClassName = 'h-11 rounded-md border border-border bg-surface px-3 font-normal';
  const headClassName = 'border-b border-border px-4 py-3';
  const cellClassName = 'border-b border-border-soft px-4 py-3 align-top';

  return (
    <RoleShell role={UserRole.PLATFORM_OPERATOR_ADMIN}>
      <h1 className="text-2xl font-bold text-forest-green">
        {roleLabels[UserRole.PLATFORM_OPERATOR_ADMIN]}
      </h1>
      <p className="mt-1 text-muted">{roleHomeIntro[UserRole.PLATFORM_OPERATOR_ADMIN]}</p>
      <p className="mt-2 text-xs text-quiet">{admin.auditNotice}</p>

      {errorMessage ? (
        <Note tone="danger" className="mt-6">
          <span className="font-bold">{admin.errorTitle}</span> {errorMessage}
        </Note>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink">{admin.membershipsTitle}</h2>
        <p className="mt-1 text-sm text-muted">{admin.membershipsIntro}</p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[12.5px] font-semibold text-muted">
                <th className={headClassName}>{admin.columns.name}</th>
                <th className={headClassName}>{admin.columns.status}</th>
                <th className={headClassName}>{admin.columns.roles}</th>
                <th className={headClassName}>{admin.columns.assign}</th>
                <th className={headClassName} />
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-quiet">
                    {admin.emptyMemberships}
                  </td>
                </tr>
              ) : (
                memberships.map((membership) => (
                  <tr key={membership.membershipId}>
                    <td className={cellClassName}>
                      <span className="font-semibold text-ink">{membership.displayName}</span>
                      <span className="block text-xs text-quiet">
                        {admin.columns.addedAt} {formatThaiDateTime(membership.addedAt)}
                      </span>
                    </td>
                    <td className={cellClassName}>
                      <div className="flex flex-wrap gap-1.5">
                        <Tag tone={membership.active ? 'ok' : 'danger'}>
                          {membership.active ? admin.active : admin.revoked}
                        </Tag>
                        <Tag tone={membership.userId ? 'info' : 'quiet'}>
                          {membership.userId ? admin.signedIn : admin.neverSignedIn}
                        </Tag>
                      </div>
                    </td>
                    <td className={cellClassName}>
                      {membership.userId ? (
                        <HeldRoles
                          userId={membership.userId}
                          heldRoles={membership.roles}
                          revokeAction={revokeRole}
                        />
                      ) : (
                        <span className="text-sm text-quiet">{admin.noRoles}</span>
                      )}
                    </td>
                    <td className={cellClassName}>
                      {membership.userId && membership.active ? (
                        <AssignRoleForm
                          userId={membership.userId}
                          heldRoles={membership.roles}
                          assignableRoles={ROLES_BY_SIDE[RoleSide.PLATFORM_OPERATOR]}
                          assignAction={assignRole}
                        />
                      ) : (
                        <span className="text-sm text-quiet">{admin.neverSignedIn}</span>
                      )}
                    </td>
                    <td className={`${cellClassName} text-right`}>
                      {membership.active && membership.userId !== actor.id ? (
                        <RevokeButton
                          action={revokePlatformOperatorMembership}
                          hiddenName="membershipId"
                          hiddenValue={membership.membershipId}
                          label={admin.revokeMembership}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <form
          action={addPlatformOperatorMembership}
          className="mt-4 grid gap-4 rounded-lg border border-border bg-surface p-5 shadow-card sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {admin.displayNameLabel}
            <input name="displayName" required maxLength={120} className={inputClassName} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {admin.nationalIdLabel}
            <input
              name="nationalId"
              required
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9 -]{13,17}"
              className={inputClassName}
            />
            <span className="text-xs font-normal text-quiet">{admin.nationalIdHint}</span>
          </label>
          <button type="submit" className={`${buttonPrimaryClassName} h-11`}>
            {admin.addMembership}
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink">{admin.certificationBodyAdminTitle}</h2>
        <p className="mt-1 text-sm text-muted">{admin.certificationBodyAdminIntro}</p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[12.5px] font-semibold text-muted">
                <th className={headClassName}>{admin.columns.name}</th>
                <th className={headClassName}>{admin.columns.providerId}</th>
                <th className={headClassName}>{admin.columns.credential}</th>
                <th className={headClassName}>{admin.columns.roles}</th>
                <th className={headClassName} />
              </tr>
            </thead>
            <tbody>
              {certificationBodyStaff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-quiet">
                    {admin.emptyStaff}
                  </td>
                </tr>
              ) : (
                certificationBodyStaff.map((staff) => {
                  const isAdmin = staff.roles.includes(UserRole.CERTIFICATION_BODY_ADMIN);
                  return (
                    <tr key={staff.userId}>
                      <td className={`${cellClassName} font-semibold text-ink`}>
                        {staff.displayName}
                      </td>
                      <td className={cellClassName}>
                        <span className="block">{staff.providerId}</span>
                        <span className="block text-xs text-muted">
                          {staff.agencyNameTh ?? admin.unknownAgency}
                        </span>
                      </td>
                      <td className={cellClassName}>
                        <Tag tone={staff.credentialActive ? 'ok' : 'danger'}>
                          {staff.credentialActive
                            ? admin.credentialActive
                            : admin.credentialRevoked}
                        </Tag>
                      </td>
                      <td className={cellClassName}>
                        <HeldRoles
                          userId={staff.userId}
                          heldRoles={staff.roles}
                          revokeAction={revokeRole}
                        />
                      </td>
                      <td className={`${cellClassName} text-right`}>
                        {isAdmin ? null : (
                          <form action={assignRole}>
                            <input type="hidden" name="userId" value={staff.userId} />
                            <input
                              type="hidden"
                              name="role"
                              value={UserRole.CERTIFICATION_BODY_ADMIN}
                            />
                            <button type="submit" className={smallButtonPrimaryClassName}>
                              {admin.setCertificationBodyAdmin}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </RoleShell>
  );
}
