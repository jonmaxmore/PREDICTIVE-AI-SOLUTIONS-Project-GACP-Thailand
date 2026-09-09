import { IdentityProvider, LoginIntent, type MorphromProviderProfile } from '@gacp/contracts';
import { NextResponse } from 'next/server';
import {
  finishSignIn,
  logIdentityProviderFailure,
  loginPathForIntent,
  publicBaseUrl,
  redirectToOutcome,
  SignInFailure,
} from '@/lib/identity/auth-routes.ts';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { takeLoginState } from '@/lib/identity/login-state.ts';
import { completeSignIn } from '@/lib/identity/sign-in.ts';

// กลับจาก Health ID: ตรวจ state, แลก code, และถ้าตั้งใจเข้าฝั่งกรมให้ถาม Provider ID ต่อด้วย access token เดิม
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const loginState = await takeLoginState(IdentityProvider.MORPHROM_HEALTH_ID);
  if (!loginState) return redirectToOutcome(request, SignInFailure.STATE_MISMATCH);
  if (url.searchParams.get('error')) {
    return NextResponse.redirect(
      new URL(loginPathForIntent(loginState.intent), publicBaseUrl(request)),
      { status: 303 },
    );
  }
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== loginState.state) {
    return redirectToOutcome(request, SignInFailure.STATE_MISMATCH);
  }

  const { morphrom } = identityClients();
  let accountId: string;
  let healthIdDisplayName: string | null;
  let healthIdHashCid: string | null;
  let profile: MorphromProviderProfile | null = null;
  try {
    const { accessToken, identity } = await morphrom.exchangeCode(code, loginState.redirectUri);
    accountId = identity.accountId;
    healthIdDisplayName = identity.displayName;
    healthIdHashCid = identity.hashCid;
    if (loginState.intent === LoginIntent.CERTIFICATION_BODY_STAFF) {
      const lookup = await morphrom.lookupProvider(accessToken);
      profile = lookup.kind === 'PROVIDER' ? lookup.profile : null;
    }
  } catch (error) {
    logIdentityProviderFailure('Health ID / Provider ID', error);
    return redirectToOutcome(request, SignInFailure.PROVIDER_ERROR);
  }

  const result = await completeSignIn({
    provider: IdentityProvider.MORPHROM_HEALTH_ID,
    subject: accountId,
    nationalId: null,
    hashCid: profile?.hashCid ?? healthIdHashCid,
    displayName: profile?.nameTh ?? healthIdDisplayName ?? 'ผู้ใช้ Health ID',
    identityAssuranceLevel: null,
    intent: loginState.intent,
    providerProfile: profile,
  });
  return finishSignIn(request, loginState, result);
}
