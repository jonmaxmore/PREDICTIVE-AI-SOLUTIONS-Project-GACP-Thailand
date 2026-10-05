import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'ตัวชี้วัดคิวงาน | GACP Provider',
};

export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
