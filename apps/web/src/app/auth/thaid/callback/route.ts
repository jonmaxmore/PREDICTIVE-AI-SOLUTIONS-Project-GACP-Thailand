import { IdentityProvider, type ThaidIdentityClaims } from '@gacp/contracts';
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

// กลับจาก ThaID: ตรวจ state/nonce/PKCE และ id_token แล้วส่งต่อ completeSignIn (เลขบัตรจาก claim pid เก็บเป็น HMAC เท่านั้น)
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const loginState = await takeLoginState(IdentityProvider.THAID);
  if (!loginState) return redirectToOutcome(request, SignInFailure.STATE_MISMATCH);

  const callbackUrl = new URL(request.url);
  if (callbackUrl.searchParams.get('error')) {
    // ผู้ใช้ยกเลิกหรือกรมการปกครองปฏิเสธ: กลับหน้าเข้าสู่ระบบเดิมเงียบ ๆ
    return NextResponse.redirect(
      new URL(loginPathForIntent(loginState.intent), publicBaseUrl(request)),
      { status: 303 },
    );
  }
  // ให้ URL ที่ตรวจตรงกับ redirect_uri ที่ลงทะเบียน (หลัง proxy host/protocol อาจต่างจากที่แอปเห็น)
  const registered = new URL(loginState.redirectUri);
  callbackUrl.protocol = registered.protocol;
  callbackUrl.host = registered.host;

  let claims: ThaidIdentityClaims;
  try {
    claims = await identityClients().thaid.completeAuthorization(callbackUrl, {
      state: loginState.state,
      nonce: loginState.nonce ?? '',
      pkceCodeVerifier: loginState.pkceCodeVerifier,
    });
  } catch (error) {
    logIdentityProviderFailure('ThaID completeAuthorization', error);
    return redirectToOutcome(request, SignInFailure.PROVIDER_ERROR);
  }

  const fullName = [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  const displayName = claims.name ?? (fullName || 'ผู้ใช้ ThaID');
  const result = await completeSignIn({
    provider: IdentityProvider.THAID,
    subject: claims.sub,
    nationalId: claims.pid ?? null,
    hashCid: null,
    displayName,
    identityAssuranceLevel: claims.ial ?? null,
    intent: loginState.intent,
    providerProfile: null,
  });
  return finishSignIn(request, loginState, result);
}
