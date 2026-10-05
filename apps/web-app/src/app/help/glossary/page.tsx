import type { Metadata } from 'next';
import { th } from '@/lib/i18n/dictionaries/th';
import GlossaryClient from './glossary-client';

/**
 * Server shell: metadata only. The body lives in `glossary-client.tsx`
 * because the language is held in localStorage and therefore unknown
 * until the client mounts.
 *
 * The metadata stays Thai. Next.js resolves it on the server, where the
 * visitor's preference does not exist yet, and this is a Thai government
 * service whose search presence is Thai-first. Taking the strings from
 * the dictionary keeps them in one place instead of duplicating them.
 */
export const metadata: Metadata = {
    title: th.health.help.glossary.metaTitle,
    description: th.health.help.glossary.metaDesc,
};

export default function GlossaryPage() {
    return <GlossaryClient />;
}
