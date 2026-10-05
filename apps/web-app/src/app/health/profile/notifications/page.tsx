'use client';

import { NotificationPreferences } from '@/components/feature/notification-preferences';
import { PageContainer } from '@/components/layout/page-system';

export const dynamic = 'force-dynamic';

export default function HealthNotificationsPrefsPage() {
  // B1 (audit 2026-06-10): was a nested <main> (DashboardLayout already provides
  // the page <main> → invalid landmark nesting) at an ad-hoc max-w-4xl. Adopt the
  // standard PageContainer (max-w-6xl shell width, single <main>).
  return (
    <PageContainer>
      <NotificationPreferences portal="health" apiBase="/auth/health" />
    </PageContainer>
  );
}
