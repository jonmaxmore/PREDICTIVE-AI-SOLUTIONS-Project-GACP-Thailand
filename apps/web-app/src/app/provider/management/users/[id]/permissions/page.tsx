import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'สิทธิ์รายบุคคล (Per-User Permissions) | GACP Provider',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientView userId={id} />;
}
