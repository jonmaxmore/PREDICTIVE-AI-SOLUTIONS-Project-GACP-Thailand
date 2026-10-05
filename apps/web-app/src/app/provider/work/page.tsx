import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'งานของฉัน | GACP Provider',
  description: 'Unified work queue (BPMN-aligned) — claim, complete, and track activities across stages.',
};

export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
