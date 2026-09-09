import 'server-only';
import { LoginIntent, loginIntentSchema, readEnv } from '@gacp/contracts';
import { NextResponse } from 'next/server';
import {
  homePathForIntent,
  outcomePath,
  PLATFORM_OPERATOR_LOGIN_PATH,
  PUBLIC_LOGIN_PATH,
} from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/session.ts';
import type { LoginState } from './login-state.ts';
import { SignInOutcome, type SignInResult } from './sign-in.ts';

// ของใช้ร่วมของ Route Handler ล็อกอิน (thaid/* และ morphrom/*)

// รหัสผลลัพธ์ที่ไม่ใช่การเข้าได้ นอกเหนือจาก SignInOutcome: state ไม่ตรง / ผู้ให้บริการยืนยันตัวตนล้มเหลว
export const SignInFailure = {
  STATE_MISMATCH: 'STATE_MISMATCH',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;
export type SignInFailure = (typeof SignInFailure)[keyof typeof SignInFailure];

// URL สาธารณะของแอป (หลัง proxy/Vercel) ใช้ประกอบ redirect_uri ให้ตรงกับที่ลงทะเบียนไว้กับผู้ให้บริการ
export function publicBaseUrl(request: Request): string {
  return readEnv().GACP_PUBLIC_BASE_URL ?? new URL(request.url).origin;
}

export function loginIntentFrom(url: URL): LoginIntent {
  return loginIntentSchema
    .catch(LoginIntent.APPLICANT)
    .parse(url.searchParams.get('intent') ?? LoginIntent.APPLICANT);
}

// รับเฉพาะ path ภายใน (กัน open redirect)
export function safeNextPath(value: string | null): string | null {
  return value?.startsWith('/') && !value.startsWith('//') ? value : null;
}

export function loginPathForIntent(intent: LoginIntent): string {
  return intent === LoginIntent.PLATFORM_OPERATOR_STAFF
    ? PLATFORM_OPERATOR_LOGIN_PATH
    : PUBLIC_LOGIN_PATH;
}

export function redirectToOutcome(request: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(outcomePath(code), publicBaseUrl(request)), { status: 303 });
}

// ปลายทางร่วมของทุก callback: เข้าได้ → ตั้ง session cookie แล้วไปหน้าที่ตั้งใจ, ไม่ได้ → หน้าผลลัพธ์พร้อมเหตุผล
export function finishSignIn(
  request: Request,
  loginState: LoginState,
  result: SignInResult,
): NextResponse {
  if (result.outcome !== SignInOutcome.SIGNED_IN || !result.sessionToken) {
    return redirectToOutcome(request, result.outcome);
  }
  const destination = loginState.next ?? homePathForIntent(loginState.intent, result.roles);
  const response = NextResponse.redirect(new URL(destination, publicBaseUrl(request)), {
    status: 303,
  });
  response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions);
  return response;
}

// บันทึกความล้มเหลวของผู้ให้บริการยืนยันตัวตนโดยไม่ log claims หรือ token
export function logIdentityProviderFailure(step: string, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[identity] ${step} ล้มเหลว: ${message}`);
}
