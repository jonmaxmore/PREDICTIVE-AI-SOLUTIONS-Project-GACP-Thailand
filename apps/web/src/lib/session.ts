import { readEnv, userRoleSchema } from '@gacp/contracts';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { z } from 'zod';

// session cookie = JWE (A256GCM) ที่ห่อ payload สั้น ๆ อายุ 12 ชั่วโมง
// ใช้ได้ทั้งใน Server Component, Server Action และ proxy (ไม่พึ่ง API ที่มีเฉพาะฝั่งใดฝั่งหนึ่ง)
export const SESSION_COOKIE_NAME = 'gacp_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const sessionPayloadSchema = z.object({
  sub: z.string().min(1),
  displayName: z.string().min(1),
  roles: z.array(userRoleSchema).min(1),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

let cachedKey: Uint8Array | undefined;

async function sessionKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  const secret = new TextEncoder().encode(readEnv().GACP_SESSION_SECRET);
  const digest = await crypto.subtle.digest('SHA-256', secret);
  cachedKey = new Uint8Array(digest);
  return cachedKey;
}

export async function sealSession(payload: SessionPayload): Promise<string> {
  const key = await sessionKey();
  return new EncryptJWT(sessionPayloadSchema.parse(payload))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(key);
}

// คืน undefined เมื่อ cookie หาย หมดอายุ หรือถูกแก้ ไม่โยน error เพื่อให้เส้นทางปฏิเสธเป็นแบบเดียวกันเสมอ
export async function openSession(token: string | undefined): Promise<SessionPayload | undefined> {
  if (!token) return undefined;
  try {
    const key = await sessionKey();
    const { payload } = await jwtDecrypt(token, key);
    const parsed = sessionPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
} as const;
