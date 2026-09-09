import { ApplicationStatus, UserRole } from '@gacp/contracts';
import { formatThaiDateTime } from '@gacp/ui';
import Link from 'next/link';
import { PlusIcon } from '@/components/application-form/icons.tsx';
import { buttonPrimaryClassName, Note, Tag } from '@/components/application-form/primitives.tsx';
import { RoleShell } from '@/components/role-shell.tsx';
import { listOwnedApplications } from '@/lib/application-form/queries.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { messages, requestTypeLabels } from '@/messages/th.ts';

type ApplicantHomePageProps = {
  readonly searchParams: Promise<{ readonly notice?: string }>;
};

// หน้าหลักผู้ขอรับรอง: รายการคำขอของตน (จริงจากฐานข้อมูล ไม่มีตัวอย่างปลอม) และปุ่มเริ่มคำขอใหม่
export default async function ApplicantHomePage({ searchParams }: ApplicantHomePageProps) {
  const user = await requireUserWithRole(UserRole.APPLICANT, '/applicant');
  const [applications, { notice }] = await Promise.all([
    listOwnedApplications(user.id),
    searchParams,
  ]);
  const home = messages.applicantHome;

  return (
    <RoleShell role={UserRole.APPLICANT}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-forest-green">{home.title}</h1>
          <p className="mt-1 text-muted">{home.intro}</p>
        </div>
        <div className="text-right">
          <Link href="/applicant/applications/new" className={`${buttonPrimaryClassName} h-11`}>
            <PlusIcon size={16} />
            {home.startNew}
          </Link>
          <p className="mt-1.5 text-xs text-quiet">{home.startNewHint}</p>
        </div>
      </div>

      {notice === 'not-editable' ? (
        <Note tone="info" className="mt-6">
          {home.notEditableNotice}
        </Note>
      ) : null}

      {applications.length === 0 ? (
        <section className="mt-8 rounded-xl border border-dashed border-border bg-surface p-8 text-center shadow-card">
          <h2 className="text-lg font-bold text-ink-soft">{home.noApplications}</h2>
          <p className="mt-1 text-sm text-quiet">{home.startNewHint}</p>
        </section>
      ) : (
        <section className="mt-8 overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[12.5px] font-semibold text-muted">
                <th className="border-b border-border px-4 py-3">{home.columns.reference}</th>
                <th className="border-b border-border px-4 py-3">{home.columns.requestType}</th>
                <th className="border-b border-border px-4 py-3">{home.columns.status}</th>
                <th className="border-b border-border px-4 py-3">{home.columns.updatedAt}</th>
                <th className="border-b border-border px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => {
                const draft = application.status === ApplicationStatus.DRAFT;
                return (
                  <tr key={application.id} className="align-middle">
                    <td className="border-b border-border-soft px-4 py-3">
                      <span className="font-semibold text-ink">{application.referenceNumber}</span>
                      {application.applicant.legalName ? (
                        <span className="block text-xs text-muted">
                          {application.applicant.legalName}
                        </span>
                      ) : null}
                    </td>
                    <td className="border-b border-border-soft px-4 py-3">
                      {requestTypeLabels[application.requestType]}
                    </td>
                    <td className="border-b border-border-soft px-4 py-3">
                      <Tag tone={draft ? 'quiet' : 'info'}>
                        {messages.applicationStatus[application.status]}
                      </Tag>
                    </td>
                    <td className="border-b border-border-soft px-4 py-3 text-muted">
                      {formatThaiDateTime(application.updatedAt)}
                    </td>
                    <td className="border-b border-border-soft px-4 py-3 text-right">
                      <Link
                        href={`/applicant/applications/${application.id}/steps/${draft ? 1 : 6}`}
                        className="font-semibold text-leaf hover:underline"
                      >
                        {draft ? home.continueDraft : home.open}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </RoleShell>
  );
}
