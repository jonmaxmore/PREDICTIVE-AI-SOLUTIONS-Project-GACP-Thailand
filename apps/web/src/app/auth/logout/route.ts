import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { loginPathForPathname } from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME } from '@/lib/session.ts';

// ออกจากระบบแล้วกลับไปหน้าเข้าสู่ระบบของฝั่งที่ออกมา (?from= คือ path ของหน้าที่กดออก)
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดให้ route handler ชื่อตาม HTTP method
export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  const from = new URL(request.url).searchParams.get('from') ?? '/';
  const loginPath = loginPathForPathname(
    from.startsWith('/') && !from.startsWith('//') ? from : '/',
  );
  return NextResponse.redirect(new URL(loginPath, request.url), { status: 303 });
}
