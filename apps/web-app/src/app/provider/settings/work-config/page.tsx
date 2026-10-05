import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'ตั้งค่าคิวงาน | GACP Provider',
};

export default function Page() {
  // <div>, not <main> — DashboardLayout already renders the single <main>
  // landmark; nesting another is invalid landmark nesting.
  return (
    <div className="h-full w-full">
      <ClientView />
    </div>
  );
}
