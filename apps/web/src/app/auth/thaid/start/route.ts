import { IdentityProvider } from '@gacp/contracts';
import { NextResponse } from 'next/server';
import { loginIntentFrom, publicBaseUrl, safeNextPath } from '@/lib/identity/auth-routes.ts';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { storeLoginState } from '@/lib/identity/login-state.ts';

// เริ่มล็อกอินด้วย ThaID (OpenID Connect): เก็บ state/nonce/PKCE ไว้ใน cookie ชั่วคราวแล้วพาไปกรมการปกครอง
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const intent = loginIntentFrom(url);
  const redirectUri = `${publicBaseUrl(request)}/auth/thaid/callback`;
  const start = await identityClients().thaid.startAuthorization(redirectUri);
  await storeLoginState({
    intent,
    provider: IdentityProvider.THAID,
    state: start.state,
    nonce: start.nonce,
    pkceCodeVerifier: start.pkceCodeVerifier,
    redirectUri,
    next: safeNextPath(url.searchParams.get('next')),
  });
  return NextResponse.redirect(start.url, { status: 302 });
}
