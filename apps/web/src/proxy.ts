import { type NextRequest, NextResponse } from 'next/server';
import { loginPathForPathname, roleForPathname } from './lib/roles.ts';
import { openSession, SESSION_COOKIE_NAME } from './lib/session.ts';

// ประตูเดียวของทุกหน้าที่ผูกกับบทบาท: ไม่มี session → ไปหน้าเข้าสู่ระบบของฝั่งนั้น, บทบาทไม่ตรง → 403
// /platform-operator/login ไม่ผูกกับบทบาท (roleForPathname คืน undefined) จึงผ่านได้เสมอ
export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const requiredRole = roleForPathname(pathname);
  if (!requiredRole) return NextResponse.next();

  const session = await openSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    const loginUrl = new URL(loginPathForPathname(pathname), request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (!session.roles.includes(requiredRole)) {
    return NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/applicant/:path*', '/certification-body/:path*', '/platform-operator/:path*'],
};
