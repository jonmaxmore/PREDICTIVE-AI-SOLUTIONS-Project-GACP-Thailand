import type { UserRole } from '@gacp/contracts';
import type { ReactNode } from 'react';
import { currentSession } from '@/lib/current-session.ts';
import { messages, roleLabels } from '@/messages/th.ts';

type RoleShellProps = {
  readonly role: UserRole;
  readonly children: ReactNode;
};

// โครงหน้าจอเดียวของทุกบทบาท: แถบบนบอกบทบาทและชื่อผู้ใช้ ปุ่มออกจากระบบ และพื้นที่เนื้อหา
export async function RoleShell({ role, children }: RoleShellProps) {
  const session = await currentSession();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-forest-green">{messages.appName}</span>
            <span className="rounded-full bg-leaf-tint px-3 py-1 text-sm font-bold text-leaf">
              {roleLabels[role]}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {session ? (
              <span className="text-muted">
                {messages.shell.signedInAs}{' '}
                <span className="font-semibold text-ink">{session.displayName}</span>
              </span>
            ) : null}
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="h-10 rounded-md border border-border px-4 font-semibold text-ink-soft hover:bg-paper"
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
