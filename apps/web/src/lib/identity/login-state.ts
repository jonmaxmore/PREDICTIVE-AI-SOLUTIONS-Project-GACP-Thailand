import 'server-only';
import { IdentityProvider, loginIntentSchema, readEnv } from '@gacp/contracts';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { z } from 'zod';

// cookie ชั่วคราวระหว่าง redirect ไปผู้ให้บริการยืนยันตัวตนและกลับมา:
// กัน CSRF ด้วย state และเก็บ nonce / PKCE verifier ไว้ฝั่ง server เท่านั้น ใช้ได้ครั้งเดียว อายุ 10 นาที
export const LOGIN_STATE_COOKIE_NAME = 'gacp_login_state';
const LOGIN_STATE_TTL_SECONDS = 10 * 60;

const loginStateSchema = z.object({
  intent: loginIntentSchema,
  provider: z.enum([IdentityProvider.THAID, IdentityProvider.MORPHROM_HEALTH_ID]),
  state: z.string().min(1),
  nonce: z.string().min(1).nullable(),
  pkceCodeVerifier: z.string().min(1).nullable(),
  redirectUri: z.url(),
  next: z.string().nullable(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

let cachedKey: Uint8Array | undefined;

// คนละ key กับ session cookie (derive จาก secret เดียวกันแต่ต่าง label) กันเอา token ข้ามชนิดมาใช้แทนกัน
async function loginStateKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`login-state:${readEnv().GACP_SESSION_SECRET}`),
  );
  cachedKey = new Uint8Array(digest);
  return cachedKey;
}

export async function storeLoginState(state: LoginState): Promise<void> {
  const token = await new EncryptJWT(loginStateSchema.parse(state))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${LOGIN_STATE_TTL_SECONDS}s`)
    .encrypt(await loginStateKey());
  const cookieStore = await cookies();
  cookieStore.set(LOGIN_STATE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth',
    maxAge: LOGIN_STATE_TTL_SECONDS,
  });
}

// อ่านแล้วลบทันที (ใช้ได้ครั้งเดียว) คืน undefined เมื่อไม่มี หมดอายุ ถูกแก้ หรือเป็นของผู้ให้บริการอื่น
export async function takeLoginState(
  expectedProvider: IdentityProvider,
): Promise<LoginState | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(LOGIN_STATE_COOKIE_NAME)?.value;
  cookieStore.delete(LOGIN_STATE_COOKIE_NAME);
  if (!token) return undefined;
  try {
    const { payload } = await jwtDecrypt(token, await loginStateKey());
    const parsed = loginStateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.provider !== expectedProvider) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}
