import Link from 'next/link';
import { messages } from '@/messages/th.ts';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold text-danger">{messages.forbidden.title}</h1>
      <p className="text-muted">{messages.forbidden.description}</p>
      <Link href="/" className="font-semibold text-leaf underline">
        {messages.forbidden.backHome}
      </Link>
    </main>
  );
}
