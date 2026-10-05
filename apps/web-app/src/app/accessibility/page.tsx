/**
 * Accessibility statement — Phase A5 §4.4.
 *
 * Placeholder draft (per timeline memo Decision 2 option `c`). Once the
 * ministry's preferred legal copy lands (or a translation of the gov.uk
 * model statement passes legal review), replace the copy in the
 * `accessibilityStatement` dictionary section rather than this file.
 *
 * Server component: it owns `metadata`, which a client component may not
 * declare. The body lives in client-view.tsx because the copy is driven by
 * `useLanguage()`.
 */

import type { Metadata } from 'next';
import AccessibilityClientView from './client-view';

export const metadata: Metadata = {
  title: 'นโยบายการเข้าถึงเว็บไซต์ · GACP Thailand',
  description:
    'แถลงการณ์นโยบายการเข้าถึงสำหรับเว็บไซต์ระบบรับรองมาตรฐาน GACP สำหรับสมุนไพร ตามมาตรฐาน WCAG 2.2 AA',
  alternates: { canonical: '/accessibility' },
};

export default function AccessibilityPage() {
  return <AccessibilityClientView />;
}
