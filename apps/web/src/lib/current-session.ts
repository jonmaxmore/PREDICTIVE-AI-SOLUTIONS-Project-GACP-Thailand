import 'server-only';
import { cookies } from 'next/headers';
import { openSession, SESSION_COOKIE_NAME, type SessionPayload } from './session.ts';

// อ่าน session ของ request ปัจจุบันฝั่ง server เท่านั้น
export async function currentSession(): Promise<SessionPayload | undefined> {
  const cookieStore = await cookies();
  return openSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
