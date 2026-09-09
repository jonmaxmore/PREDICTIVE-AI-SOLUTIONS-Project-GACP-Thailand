import { LoginIntent, RoleSide, readEnv, UserRole } from '@gacp/contracts';
import { redirect } from 'next/navigation';
import { DevLoginForm } from '@/components/dev-login-form.tsx';
import { IdentityProviderButton } from '@/components/identity-provider-button.tsx';
import { currentSession } from '@/lib/current-session.ts';
import { identityProvidersConfigured } from '@/lib/identity/identity-clients.ts';
import { roleHomePath } from '@/lib/roles.ts';
import { messages } from '@/messages/th.ts';

type LoginPageProps = {
  readonly searchParams: Promise<{ readonly next?: string; readonly error?: string }>;
};

function safeNext(next: string | undefined): string | undefined {
  return next?.startsWith('/') && !next.startsWith('//') ? next : undefined;
}

// URL เริ่มล็อกอินกับผู้ให้บริการยืนยันตัวตน: บอกฝั่งที่ตั้งใจเข้า (intent) และหน้าที่จะกลับไป (next)
function startPath(provider: 'thaid' | 'morphrom', intent: LoginIntent, next: string | undefined) {
  const query = new URLSearchParams({ intent });
  if (next) query.set('next', next);
  return `/auth/${provider}/start?${query.toString()}`;
}

// หน้าเข้าสู่ระบบสาธารณะ: ผู้ขอรับรอง (Health ID หรือ ThaID) และเจ้าหน้าที่กรม (Health ID ที่มี Provider ID)
// พนักงานบริษัทมีหน้าของตัวเองที่ /platform-operator/login
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await currentSession();
  const firstRole = session?.roles[0];
  if (firstRole) redirect(roleHomePath(firstRole));

  const { next, error } = await searchParams;
  const nextPath = safeNext(next);
  const devLoginEnabled = readEnv().GACP_AUTH_DEV_LOGIN_ENABLED;
  const providersConfigured = identityProvidersConfigured();
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
        <h2 className="text-lg font-bold text-ink">{messages.login.applicantTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{messages.login.applicantLead}</p>
        <div className="mt-4 flex flex-col gap-3">
          <IdentityProviderButton
            href={startPath('morphrom', LoginIntent.APPLICANT, nextPath)}
            label={messages.login.healthId}
            enabled={providersConfigured}
            tone="primary"
          />
          <IdentityProviderButton
            href={startPath('thaid', LoginIntent.APPLICANT, nextPath)}
            label={messages.login.thaid}
            enabled={providersConfigured}
            tone="secondary"
          />
        </div>
      </section>

      <section className="rounded-xl border border-officer-tint bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold text-officer">{messages.login.staffTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{messages.login.staffLead}</p>
        <div className="mt-4">
          <IdentityProviderButton
            href={startPath('morphrom', LoginIntent.CERTIFICATION_BODY_STAFF, nextPath)}
            label={messages.login.providerId}
            enabled={providersConfigured}
            tone="secondary"
          />
        </div>
      </section>

      {providersConfigured ? null : (
        <p role="status" className="text-sm leading-relaxed text-quiet">
          {messages.login.notConfigured}
        </p>
      )}

      {devLoginEnabled ? (
        <DevLoginForm
          sides={[RoleSide.APPLICANT, RoleSide.CERTIFICATION_BODY, RoleSide.PLATFORM_OPERATOR]}
          defaultRole={UserRole.APPLICANT}
          next={nextPath}
          errorMessage={errorMessage}
        />
      ) : null}
    </main>
  );
}
