'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HolderChip } from '@/components/holder/holder-chip';
import { HOLDER_COPY_TH } from '@/components/holder/holder-labels';
import { apiClient } from '@/lib/api/api-client';
import { useMyEntities } from '@/lib/services/my-entities-provider';
import { useApplicationFlowStore } from './hooks/use-application-flow-store';
import { restartFromStep1 } from './hooks/restart-draft';

/** The chip of steps 2-6: whom this filing is for, and the delete-and-restart exit. */
export function ConnectedHolderChip({ step }: { step: number }) {
    const { state, resetWizard } = useApplicationFlowStore();
    const { entities } = useMyEntities();
    const router = useRouter();
    const [failed, setFailed] = useState(false);

    if (step < 2 || !state.holderEntityId) { return null; }
    const holder = entities.find((e) => e.id === state.holderEntityId);
    if (!holder) { return null; }

    const onRestart = async () => {
        setFailed(false);
        const outcome = await restartFromStep1({
            applicationId: state.applicationId ?? null,
            deleteDraft: (url) => apiClient.delete<unknown>(url),
            resetWizard: () => resetWizard(),
            navigate: (url) => router.push(url),
        });
        if (outcome === 'FAILED') { setFailed(true); }
    };

    return (
        <>
            <HolderChip displayName={holder.displayName} onRestart={onRestart} />
            {failed && <p role="alert" className="mb-4 text-xs text-destructive">{HOLDER_COPY_TH.restartFailed}</p>}
        </>
    );
}
