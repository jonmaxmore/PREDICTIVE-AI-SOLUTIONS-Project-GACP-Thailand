import { IdentityProvider } from '@gacp/contracts';
import { NextResponse } from 'next/server';
import { loginIntentFrom, publicBaseUrl, safeNextPath } from '@/lib/identity/auth-routes.ts';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { storeLoginState } from '@/lib/identity/login-state.ts';

// เริ่มล็อกอินด้วย Health ID ของหมอพร้อม (OAuth2 code flow ไม่มี nonce/PKCE ตามคู่มือ MOPH): state เก็บใน cookie ชั่วคราว
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const intent = loginIntentFrom(url);
  const redirectUri = `${publicBaseUrl(request)}/auth/morphrom/callback`;
  const state = crypto.randomUUID();
  await storeLoginState({
    intent,
    provider: IdentityProvider.MORPHROM_HEALTH_ID,
    state,
    nonce: null,
    pkceCodeVerifier: null,
    redirectUri,
    next: safeNextPath(url.searchParams.get('next')),
  });
  return NextResponse.redirect(identityClients().morphrom.authorizationUrl(redirectUri, state), {
    status: 302,
  });
}
