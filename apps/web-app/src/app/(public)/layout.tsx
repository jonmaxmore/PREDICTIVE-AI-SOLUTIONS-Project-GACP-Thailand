import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | GACP Thai',
    default: 'ตรวจสอบผลิตภัณฑ์ GACP',
  },
  description: 'ระบบตรวจสอบย้อนกลับผลิตภัณฑ์สมุนไพร GACP Thai Standard',
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
