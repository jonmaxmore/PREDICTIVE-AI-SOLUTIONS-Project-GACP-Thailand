import { type NextRequest, NextResponse } from 'next/server';
import { roleForPathname } from './lib/roles.ts';
import { openSession, SESSION_COOKIE_NAME } from './lib/session.ts';

// ประตูเดียวของทุกหน้าที่ผูกกับบทบาท: ไม่มี session → ไปหน้าเข้าสู่ระบบ, บทบาทไม่ตรง → 403
export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const requiredRole = roleForPathname(request.nextUrl.pathname);
  if (!requiredRole) return NextResponse.next();

  const session = await openSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (!session.roles.includes(requiredRole)) {
    return NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/applicant/:path*',
    '/finance-officer/:path*',
    '/dispatcher/:path*',
    '/document-reviewer/:path*',
    '/field-inspector/:path*',
    '/certificate-approver/:path*',
    '/system-admin/:path*',
  ],
};
