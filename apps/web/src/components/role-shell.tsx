import { roleSideOf, type UserRole } from '@gacp/contracts';
import type { ReactNode } from 'react';
import { currentSession } from '@/lib/current-session.ts';
import { roleHomePath, type SideTone, sideToneOf } from '@/lib/roles.ts';
import { messages, roleLabels, roleSideLabels } from '@/messages/th.ts';

type RoleShellProps = {
  readonly role: UserRole;
  readonly children: ReactNode;
};

// โทนสีของป้ายบทบาทบอกฝั่ง: ผู้ขอรับรอง (เขียว) เจ้าหน้าที่กรม (น้ำเงินเขียวของราชการ) บริษัท (กรมท่า)
const ROLE_CHIP_CLASS: Readonly<Record<SideTone, string>> = {
  applicant: 'bg-leaf-tint text-leaf',
  officer: 'bg-officer-tint text-officer',
  operator: 'bg-navy text-white',
};

// โครงหน้าจอเดียวของทุกบทบาท: แถบบนบอกฝั่ง บทบาท และชื่อผู้ใช้ ปุ่มออกจากระบบ และพื้นที่เนื้อหา
export async function RoleShell({ role, children }: RoleShellProps) {
  const session = await currentSession();
  const logoutAction = `/auth/logout?from=${encodeURIComponent(roleHomePath(role))}`;
  // ฝั่งผู้ขอรับรองมีบทบาทเดียวชื่อเดียวกับฝั่ง ไม่ต้องพิมพ์ซ้ำ
  const sideLabel = roleSideLabels[roleSideOf(role)];
  const showSideLabel = sideLabel !== roleLabels[role];
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-forest-green">{messages.appName}</span>
            <span
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${ROLE_CHIP_CLASS[sideToneOf(role)]}`}
            >
              {showSideLabel ? (
                <>
                  <span className="font-normal opacity-80">{sideLabel}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span>{roleLabels[role]}</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {session ? (
              <span className="hidden text-muted sm:inline">
                {messages.shell.signedInAs}{' '}
                <span className="font-semibold text-ink">{session.displayName}</span>
              </span>
            ) : null}
            <form action={logoutAction} method="post">
              <button
                type="submit"
                className="h-10 whitespace-nowrap rounded-md border border-border px-4 font-semibold text-ink-soft hover:bg-paper"
              >
                {messages.shell.logout}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
