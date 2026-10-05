import { ProfileClientView } from './profile-client';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'โปรไฟล์ | Health GACP',
  description: 'จัดการโปรไฟล์และการตั้งค่าบัญชี GACP ของคุณ',
};

/**
 * Health Profile Page (Server Component).
 * Server / Client component separation pattern — keeps the route
 * file as a thin Server Component for metadata + initial layout,
 * delegates interactive UI state to the Client island.
 */
export default function ProfilePage() {
  // Delegate UI state to the Client island so the route module stays
  // a pure Server Component (avoids "use client" cascading up the tree).
  return (
    <main className="h-full w-full p-4 md:p-8">
      <ProfileClientView />
    </main>
  );
}
