import { LoginIntent, RoleSide, readEnv, roleSideOf, UserRole } from '@gacp/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DevLoginForm } from '@/components/dev-login-form.tsx';
import { IdentityProviderButton } from '@/components/identity-provider-button.tsx';
import { currentSession } from '@/lib/current-session.ts';
import { identityProvidersConfigured } from '@/lib/identity/identity-clients.ts';
import { homePathForIntent, PUBLIC_LOGIN_PATH } from '@/lib/roles.ts';
import { messages } from '@/messages/th.ts';

type PlatformOperatorLoginPageProps = {
  readonly searchParams: Promise<{ readonly next?: string; readonly error?: string }>;
};

// หน้าเข้าสู่ระบบของบริษัทผู้ให้บริการแพลตฟอร์ม: แยกจากผู้ขอรับรองและเจ้าหน้าที่กรม เข้าด้วย ThaID อย่างเดียว
// (คนของบริษัทไม่ใช่ผู้รับบริการและไม่ใช่เจ้าหน้าที่สาธารณสุข จึงไม่ใช้ Health ID / Provider ID)
export default async function PlatformOperatorLoginPage({
  searchParams,
}: PlatformOperatorLoginPageProps) {
  const session = await currentSession();
  if (session?.roles.some((role) => roleSideOf(role) === RoleSide.PLATFORM_OPERATOR)) {
    redirect(homePathForIntent(LoginIntent.PLATFORM_OPERATOR_STAFF, session.roles));
  }

  const { next, error } = await searchParams;
  const nextPath = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;
  const devLoginEnabled = readEnv().GACP_AUTH_DEV_LOGIN_ENABLED;
  const providersConfigured = identityProvidersConfigured();
  const query = new URLSearchParams({ intent: LoginIntent.PLATFORM_OPERATOR_STAFF });
  if (nextPath) query.set('next', nextPath);
  const errorMessage =
    error === 'displayName'
      ? messages.login.displayNameRequired
      : error === 'role'
        ? messages.login.roleRequired
        : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-1">
        <p className="inline-flex rounded-full bg-navy px-3 py-1 text-sm font-bold text-white">
          {messages.appName}
        </p>
        <h1 className="text-2xl font-bold text-navy">{messages.login.platformOperatorTitle}</h1>
        <p className="text-sm leading-relaxed text-muted">{messages.login.platformOperatorLead}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <IdentityProviderButton
          href={`/auth/thaid/start?${query.toString()}`}
          label={messages.login.thaid}
          enabled={providersConfigured}
          tone="primary"
        />
        {providersConfigured ? null : (
          <p role="status" className="mt-3 text-sm leading-relaxed text-quiet">
            {messages.login.notConfigured}
          </p>
        )}
      </section>

      <p className="text-sm text-muted">
        {messages.login.platformOperatorNotYou}{' '}
        <Link href={PUBLIC_LOGIN_PATH} className="font-semibold text-leaf underline">
          {messages.login.title}
        </Link>
      </p>

      {devLoginEnabled ? (
        <DevLoginForm
          sides={[RoleSide.PLATFORM_OPERATOR]}
          defaultRole={UserRole.PLATFORM_OPERATOR_ADMIN}
          next={nextPath}
          errorMessage={errorMessage}
        />
      ) : null}
    </main>
  );
}
