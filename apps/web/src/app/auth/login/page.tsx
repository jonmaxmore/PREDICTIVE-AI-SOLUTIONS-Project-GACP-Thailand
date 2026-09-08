import { readEnv, UserRole } from '@gacp/contracts';
import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/current-session.ts';
import { roleHomePath } from '@/lib/roles.ts';
import { messages, roleLabels } from '@/messages/th.ts';
import { devLogin } from './actions.ts';

type LoginPageProps = {
  readonly searchParams: Promise<{ readonly next?: string; readonly error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await currentSession();
  const firstRole = session?.roles[0];
  if (firstRole) redirect(roleHomePath(firstRole));

  const { next, error } = await searchParams;
  const devLoginEnabled = readEnv().GACP_AUTH_DEV_LOGIN_ENABLED;
  const errorMessage =
    error === 'displayName'
      ? messages.login.displayNameRequired
      : error === 'role'
        ? messages.login.roleRequired
        : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-1">
        <p className="inline-flex rounded-full bg-leaf-tint px-3 py-1 text-sm font-bold text-leaf">
          {messages.appName}
        </p>
        <h1 className="text-2xl font-bold text-forest-green">{messages.login.title}</h1>
        <p className="text-sm text-muted">{messages.appTagline}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <p className="text-sm leading-relaxed text-ink-soft">{messages.login.thaidNotReady}</p>
      </section>

      {devLoginEnabled ? (
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
                defaultValue={UserRole.APPLICANT}
                className="h-11 rounded-md border border-border bg-surface px-3 font-normal"
              >
                {Object.values(UserRole).map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
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
      ) : null}
    </main>
  );
}
