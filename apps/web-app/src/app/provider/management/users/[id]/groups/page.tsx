import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'จัดการ Group ของผู้ใช้ | GACP Provider',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView userId={id} />
    </main>
  );
}
