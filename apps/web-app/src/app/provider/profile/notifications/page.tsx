'use client';

import ProviderLayout from '../../components/provider-layout';
import { NotificationPreferences } from '@/components/feature/notification-preferences';
import { PageContainer } from '@/components/layout/page-system';

export const dynamic = 'force-dynamic';

export default function ProviderNotificationsPrefsPage() {
  // B1 (audit 2026-06-10): ProviderLayout → DashboardLayout already provides the
  // page <main>; the inner <main> here was invalid landmark nesting at an ad-hoc
  // max-w-4xl. Adopt the standard PageContainer (max-w-6xl shell width).
  return (
    <ProviderLayout>
      <PageContainer>
        <NotificationPreferences portal="provider" apiBase="/auth/provider" />
      </PageContainer>
    </ProviderLayout>
  );
}
