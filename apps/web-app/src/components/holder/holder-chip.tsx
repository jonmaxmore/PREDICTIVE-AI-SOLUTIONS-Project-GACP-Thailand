'use client';

/**
 * HolderChip — shown on steps 2-6: whom this application is filed for, and the one
 * way to fix a wrong choice (delete the draft, start again). There is no "change
 * holder" control anywhere (spec §3.2): the holder is fixed once the draft exists.
 */

import { useState } from 'react';
import { HOLDER_COPY_TH } from './holder-labels';

export interface HolderChipProps {
    displayName: string;
    onRestart: () => Promise<void>;
}

export function HolderChip({ displayName, onRestart }: HolderChipProps) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setBusy(true);
        try { await onRestart(); } finally { setBusy(false); setConfirming(false); }
    };

    return (
        <div className="mb-4 rounded-xl border border-leaf-300 bg-leaf-soft px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{`${HOLDER_COPY_TH.title} ${displayName}`}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{HOLDER_COPY_TH.chipHint}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                {confirming ? (
                    <>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => { void run(); }}
                            className="min-h-[44px] rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-white sm:min-h-0"
                        >
                            {HOLDER_COPY_TH.restartConfirm}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirming(false)}
                            className="min-h-[44px] rounded-full border border-muted px-4 py-2 text-xs font-semibold text-foreground sm:min-h-0"
                        >
                            {HOLDER_COPY_TH.restartCancel}
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        className="min-h-[44px] rounded-full border border-muted px-4 py-2 text-xs font-semibold text-foreground sm:min-h-0"
                    >
                        {HOLDER_COPY_TH.restart}
                    </button>
                )}
            </div>
        </div>
    );
}
