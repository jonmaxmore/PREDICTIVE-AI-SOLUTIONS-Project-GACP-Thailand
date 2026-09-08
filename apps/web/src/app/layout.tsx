import type { Metadata } from 'next';
import { Sarabun } from 'next/font/google';
import type { ReactNode } from 'react';
import '@gacp/ui/tokens.css';
import './globals.css';
import { messages } from '@/messages/th.ts';

// ฟอนต์เดียวของระบบ next/font ดาวน์โหลดตอน build และเสิร์ฟจาก origin ของเราเอง ไม่มี runtime call ไป Google
const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sarabun',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: messages.appName, template: `%s · ${messages.appName}` },
  description: messages.appTagline,
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
