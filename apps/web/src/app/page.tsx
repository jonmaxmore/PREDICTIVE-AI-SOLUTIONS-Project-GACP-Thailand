import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/current-session.ts';
import { roleHomePath } from '@/lib/roles.ts';

// หน้าแรกไม่มีเนื้อหาของตัวเอง: พาไปหน้าหลักของบทบาท หรือหน้าเข้าสู่ระบบ
export default async function HomePage() {
  const session = await currentSession();
  const firstRole = session?.roles[0];
  redirect(firstRole ? roleHomePath(firstRole) : '/auth/login');
}
