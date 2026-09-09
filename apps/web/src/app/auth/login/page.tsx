import { LoginIntent, RoleSide, readEnv, UserRole } from '@gacp/contracts';
import { redirect } from 'next/navigation';
import {
  HealthIdButton,
  OrDivider,
  ProviderIdButton,
  ThaidButton,
} from '@/components/auth/identity-buttons.tsx';
import {
  IdentityCard,
  IdentityFootnote,
  IdentityShell,
} from '@/components/auth/identity-shell.tsx';
import { DevLoginForm } from '@/components/dev-login-form.tsx';
import { currentSession } from '@/lib/current-session.ts';
import { identityProvidersConfigured } from '@/lib/identity/identity-clients.ts';
import { PUBLIC_LOGIN_PATH, roleHomePath } from '@/lib/roles.ts';
import { messages } from '@/messages/th.ts';

type LoginTab = 'applicant' | 'staff';

type LoginPageProps = {
  readonly searchParams: Promise<{
    readonly next?: string;
    readonly error?: string;
    readonly tab?: string;
  }>;
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

function tabPath(tab: LoginTab, next: string | undefined) {
  const query = new URLSearchParams({ tab });
  if (next) query.set('next', next);
  return `${PUBLIC_LOGIN_PATH}?${query.toString()}`;
}

// หน้าเข้าสู่ระบบสาธารณะ (แบบ ข. ที่ operator เลือก): แท็บ ผู้ขอรับรอง (Health ID หรือ ThaID) / เจ้าหน้าที่กรม (Provider ID)
// พนักงานบริษัทมีหน้าของตัวเองที่ /platform-operator/login
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await currentSession();
  const firstRole = session?.roles[0];
  if (firstRole) redirect(roleHomePath(firstRole));

  const { next, error, tab } = await searchParams;
  const nextPath = safeNext(next);
  const activeTab: LoginTab = tab === 'staff' ? 'staff' : 'applicant';
  const devLoginEnabled = readEnv().GACP_AUTH_DEV_LOGIN_ENABLED;
  const providersConfigured = identityProvidersConfigured();
  const login = messages.login;
  const errorMessage =
    error === 'displayName'
      ? login.displayNameRequired
      : error === 'role'
        ? login.roleRequired
        : undefined;

  return (
    <IdentityShell>
      <IdentityCard>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-forest-green">{login.title}</h1>
          <p className="text-sm text-muted">{login.chooseRole}</p>
        </div>

        <nav aria-label={login.tabsLabel} className="grid grid-cols-2 border-b border-border">
          <TabLink href={tabPath('applicant', nextPath)} active={activeTab === 'applicant'}>
            {login.tabApplicant}
          </TabLink>
          <TabLink href={tabPath('staff', nextPath)} active={activeTab === 'staff'}>
            {login.tabStaff}
          </TabLink>
        </nav>

        {activeTab === 'applicant' ? (
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] leading-relaxed text-muted">{login.applicantLead}</p>
            <HealthIdButton
              href={startPath('morphrom', LoginIntent.APPLICANT, nextPath)}
              enabled={providersConfigured}
            />
            <OrDivider />
            <ThaidButton
              href={startPath('thaid', LoginIntent.APPLICANT, nextPath)}
              enabled={providersConfigured}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-muted">{login.staffLead}</p>
            <ProviderIdButton
              href={startPath('morphrom', LoginIntent.CERTIFICATION_BODY_STAFF, nextPath)}
              enabled={providersConfigured}
            />
            <div className="flex flex-col gap-3 rounded-md bg-paper px-5 py-4">
              <p className="text-sm font-bold text-ink">{login.providerIdStepsTitle}</p>
              <ol className="flex flex-col gap-3">
                {login.providerIdSteps.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-health-id text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="text-[13px] leading-relaxed text-ink-soft">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </IdentityCard>

      {providersConfigured ? null : (
        <IdentityFootnote>
          <span role="status">{login.notConfigured}</span>
        </IdentityFootnote>
      )}
      <IdentityFootnote>{login.noPasswordNote}</IdentityFootnote>

      {devLoginEnabled ? (
        <div className="w-full max-w-[560px]">
          <DevLoginForm
            sides={[RoleSide.APPLICANT, RoleSide.CERTIFICATION_BODY, RoleSide.PLATFORM_OPERATOR]}
            defaultRole={UserRole.APPLICANT}
            next={nextPath}
            errorMessage={errorMessage}
          />
        </div>
      ) : null}
    </IdentityShell>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly children: string;
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? '-mb-px flex h-11 items-center justify-center border-b-[3px] border-health-id text-[15px] font-bold text-health-id'
          : 'flex h-11 items-center justify-center text-[15px] font-semibold text-muted hover:text-ink'
      }
    >
      {children}
    </a>
  );
}
