import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'รายละเอียดงาน | GACP Provider',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView activityId={id} />
    </main>
  );
}
