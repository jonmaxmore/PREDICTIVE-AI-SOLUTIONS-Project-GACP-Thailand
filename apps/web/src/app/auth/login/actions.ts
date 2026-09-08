'use server';

import { readEnv, userRoleSchema } from '@gacp/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { roleHomePath } from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME, sealSession, sessionCookieOptions } from '@/lib/session.ts';

const devLoginSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  role: userRoleSchema,
  next: z.string().optional(),
});

// เข้าสู่ระบบแบบทดสอบ: สร้าง session ให้บทบาทที่เลือก ใช้ได้เฉพาะเมื่อ GACP_AUTH_DEV_LOGIN_ENABLED และไม่ใช่ production
export async function devLogin(formData: FormData): Promise<void> {
  if (!readEnv().GACP_AUTH_DEV_LOGIN_ENABLED) redirect('/auth/login');

  const parsed = devLoginSchema.safeParse({
    displayName: formData.get('displayName'),
    role: formData.get('role'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`/auth/login?error=${field === 'role' ? 'role' : 'displayName'}`);
  }

  const { displayName, role, next } = parsed.data;
  const token = await sealSession({
    sub: `dev-local:${role.toLowerCase()}`,
    displayName,
    roles: [role],
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);

  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : roleHomePath(role);
  redirect(safeNext);
}
