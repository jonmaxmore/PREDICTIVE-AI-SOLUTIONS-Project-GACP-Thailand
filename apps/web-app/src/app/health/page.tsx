export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

export default function HealthRootPage() {
    redirect('/health/home');
}
