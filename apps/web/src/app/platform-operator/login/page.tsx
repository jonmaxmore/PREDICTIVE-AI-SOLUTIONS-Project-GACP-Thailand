import { LoginIntent, RoleSide, readEnv, roleSideOf, UserRole } from '@gacp/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ThaidButton } from '@/components/auth/identity-buttons.tsx';
import {
  IdentityCard,
  IdentityFootnote,
  IdentityShell,
} from '@/components/auth/identity-shell.tsx';
import { DevLoginForm } from '@/components/dev-login-form.tsx';
import { currentSession } from '@/lib/current-session.ts';
import { identityProvidersConfigured } from '@/lib/identity/identity-clients.ts';
import { homePathForIntent, PUBLIC_LOGIN_PATH } from '@/lib/roles.ts';
import { messages } from '@/messages/th.ts';

type PlatformOperatorLoginPageProps = {
  readonly searchParams: Promise<{ readonly next?: string; readonly error?: string }>;
};

// หน้าเข้าสู่ระบบของบริษัทผู้ให้บริการแพลตฟอร์ม: โครงเดียวกับหน้าสาธารณะ แต่มีทางเข้าเดียวคือ ThaID
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
          <h1 className="text-2xl font-bold text-navy">{login.platformOperatorTitle}</h1>
          <p className="text-sm leading-relaxed text-muted">{login.platformOperatorLead}</p>
        </div>
        <ThaidButton href={`/auth/thaid/start?${query.toString()}`} enabled={providersConfigured} />
        <p className="text-center text-[13px] text-muted">
          {login.platformOperatorNotYou}{' '}
          <Link href={PUBLIC_LOGIN_PATH} className="font-semibold text-leaf underline">
            {login.title}
          </Link>
        </p>
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
            sides={[RoleSide.PLATFORM_OPERATOR]}
            defaultRole={UserRole.PLATFORM_OPERATOR_ADMIN}
            next={nextPath}
            errorMessage={errorMessage}
          />
        </div>
      ) : null}
    </IdentityShell>
  );
}
