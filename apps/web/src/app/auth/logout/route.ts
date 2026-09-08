import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/session.ts';

// biome-ignore lint/style/useNamingConvention: Next.js กำหนดให้ route handler ชื่อตาม HTTP method
export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.redirect(new URL('/auth/login', request.url), { status: 303 });
}
