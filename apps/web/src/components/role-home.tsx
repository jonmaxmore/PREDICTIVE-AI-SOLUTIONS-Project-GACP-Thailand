import type { UserRole } from '@gacp/contracts';
import { messages, roleHomeIntro, roleLabels } from '@/messages/th.ts';
import { RoleShell } from './role-shell.tsx';

// หน้าหลักของบทบาทใน M0: บอกตรง ๆ ว่ายังไม่มีรายการ ไม่มีข้อมูลตัวอย่างปลอม
export function RoleHome({ role }: { readonly role: UserRole }) {
  return (
    <RoleShell role={role}>
      <h1 className="text-2xl font-bold text-forest-green">{roleLabels[role]}</h1>
      <p className="mt-1 text-muted">{roleHomeIntro[role]}</p>
      <section className="mt-8 rounded-xl border border-dashed border-border bg-surface p-8 text-center shadow-card">
        <h2 className="text-lg font-bold text-ink-soft">{messages.emptyState.title}</h2>
        <p className="mt-1 text-sm text-quiet">{messages.emptyState.description}</p>
      </section>
    </RoleShell>
  );
}
