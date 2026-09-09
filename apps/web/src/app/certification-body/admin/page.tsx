import { ROLES_BY_SIDE, RoleSide, UserRole } from '@gacp/contracts';
import { formatThaiDateTime } from '@gacp/ui';
import {
  AssignRoleForm,
  HeldRoles,
  RevokeButton,
} from '@/components/admin/staff-role-controls.tsx';
import { buttonPrimaryClassName, Note, Tag } from '@/components/application-form/primitives.tsx';
import { RoleShell } from '@/components/role-shell.tsx';
import { listAuthorizedProviderAgencies, listCertificationBodyStaff } from '@/lib/account-admin.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { messages, roleHomeIntro, roleLabels } from '@/messages/th.ts';
import {
  addAuthorizedProviderAgency,
  assignRole,
  revokeAuthorizedProviderAgency,
  revokeRole,
} from './actions.ts';

const PAGE = '/certification-body/admin';

type PageProps = { readonly searchParams: Promise<{ readonly error?: string }> };

function errorMessageFor(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const errors = messages.admin.errors as Record<string, string>;
  return errors[code] ?? messages.admin.errors.invalid;
}

// ผู้ดูแลระบบของกรม: สังกัดที่รับเป็นเจ้าหน้าที่ และบทบาทฝั่งกรมของคนที่มี Provider ID (ไม่มีเงิน ไม่มีการตัดสินคำขอ)
export default async function CertificationBodyAdminPage({ searchParams }: PageProps) {
  await requireUserWithRole(UserRole.CERTIFICATION_BODY_ADMIN, PAGE);
  const [{ error }, agencies, staff] = await Promise.all([
    searchParams,
    listAuthorizedProviderAgencies(),
    listCertificationBodyStaff(),
  ]);
  const admin = messages.admin;
  const errorMessage = errorMessageFor(error);
  const inputClassName = 'h-11 rounded-md border border-border bg-surface px-3 font-normal';
  const headClassName = 'border-b border-border px-4 py-3';
  const cellClassName = 'border-b border-border-soft px-4 py-3 align-top';

  return (
    <RoleShell role={UserRole.CERTIFICATION_BODY_ADMIN}>
      <h1 className="text-2xl font-bold text-forest-green">
        {roleLabels[UserRole.CERTIFICATION_BODY_ADMIN]}
      </h1>
      <p className="mt-1 text-muted">{roleHomeIntro[UserRole.CERTIFICATION_BODY_ADMIN]}</p>
      <p className="mt-2 text-xs text-quiet">{admin.auditNotice}</p>

      {errorMessage ? (
        <Note tone="danger" className="mt-6">
          <span className="font-bold">{admin.errorTitle}</span> {errorMessage}
        </Note>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink">{admin.agenciesTitle}</h2>
        <p className="mt-1 text-sm text-muted">{admin.agenciesIntro}</p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[12.5px] font-semibold text-muted">
                <th className={headClassName}>{admin.columns.businessId}</th>
                <th className={headClassName}>{admin.columns.agencyCode}</th>
                <th className={headClassName}>{admin.columns.agencyName}</th>
                <th className={headClassName}>{admin.columns.status}</th>
                <th className={headClassName} />
              </tr>
            </thead>
            <tbody>
              {agencies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-quiet">
                    {admin.emptyAgencies}
                  </td>
                </tr>
              ) : (
                agencies.map((agency) => (
                  <tr key={agency.id}>
                    <td className={`${cellClassName} font-semibold text-ink`}>
                      {agency.businessId}
                    </td>
                    <td className={cellClassName}>{agency.agencyCode ?? ''}</td>
                    <td className={cellClassName}>
                      <span className="block">{agency.nameTh}</span>
                      <span className="block text-xs text-quiet">
                        {admin.columns.addedAt} {formatThaiDateTime(agency.addedAt)}
                      </span>
                    </td>
                    <td className={cellClassName}>
                      <Tag tone={agency.active ? 'ok' : 'danger'}>
                        {agency.active ? admin.active : admin.revoked}
                      </Tag>
                    </td>
                    <td className={`${cellClassName} text-right`}>
                      {agency.active ? (
                        <RevokeButton
                          action={revokeAuthorizedProviderAgency}
                          hiddenName="agencyId"
                          hiddenValue={agency.id}
                          label={admin.revokeAgency}
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
          action={addAuthorizedProviderAgency}
          className="mt-4 grid gap-4 rounded-lg border border-border bg-surface p-5 shadow-card sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {admin.businessIdLabel}
            <input name="businessId" required maxLength={64} className={inputClassName} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {admin.agencyCodeLabel}
            <input name="agencyCode" maxLength={32} className={inputClassName} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {admin.agencyNameLabel}
            <input name="nameTh" required maxLength={200} className={inputClassName} />
          </label>
          <button type="submit" className={`${buttonPrimaryClassName} h-11`}>
            {admin.addAgency}
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink">{admin.staffTitle}</h2>
        <p className="mt-1 text-sm text-muted">{admin.staffIntro}</p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[12.5px] font-semibold text-muted">
                <th className={headClassName}>{admin.columns.name}</th>
                <th className={headClassName}>{admin.columns.providerId}</th>
                <th className={headClassName}>{admin.columns.credential}</th>
                <th className={headClassName}>{admin.columns.roles}</th>
                <th className={headClassName}>{admin.columns.assign}</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-quiet">
                    {admin.emptyStaff}
                  </td>
                </tr>
              ) : (
                staff.map((person) => (
                  <tr key={person.userId}>
                    <td className={`${cellClassName} font-semibold text-ink`}>
                      {person.displayName}
                    </td>
                    <td className={cellClassName}>
                      <span className="block">{person.providerId}</span>
                      <span className="block text-xs text-muted">
                        {person.agencyNameTh ?? admin.unknownAgency}
                      </span>
                    </td>
                    <td className={cellClassName}>
                      <Tag tone={person.credentialActive ? 'ok' : 'danger'}>
                        {person.credentialActive ? admin.credentialActive : admin.credentialRevoked}
                      </Tag>
                    </td>
                    <td className={cellClassName}>
                      <HeldRoles
                        userId={person.userId}
                        heldRoles={person.roles}
                        revokeAction={revokeRole}
                      />
                    </td>
                    <td className={cellClassName}>
                      <AssignRoleForm
                        userId={person.userId}
                        heldRoles={person.roles}
                        assignableRoles={ROLES_BY_SIDE[RoleSide.CERTIFICATION_BODY]}
                        assignAction={assignRole}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </RoleShell>
  );
}
