'use client';

/**
 * Holder surfaces for the list pages (applications, payments, certificates, farms):
 * filter chips "ทั้งหมด" + one per entity (only with more than one entity) and the
 * "ยื่นในนาม" label for a row. No page has an "active" holder any more (spec §3.6).
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMyEntities, type EntityMembership } from '@/lib/services/my-entities-provider';
import { HOLDER_COPY_TH, orderHolders } from './holder-labels';

export function HolderFilterChips({ entities, selectedId, onSelect }: {
    entities: readonly EntityMembership[];
    selectedId: string | null;
    onSelect: (entityId: string | null) => void;
}) {
    const holders = orderHolders(entities);
    if (holders.length < 2) { return null; }
    const chip = (active: boolean) => cn(
        'min-h-[44px] rounded-full border px-4 py-2 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5',
        active ? 'border-leaf-700 bg-leaf-soft text-foreground' : 'border-muted bg-card text-muted-foreground hover:border-leaf-300',
    );
    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label={HOLDER_COPY_TH.column}>
            <button type="button" aria-pressed={selectedId === null} className={chip(selectedId === null)} onClick={() => onSelect(null)}>
                {HOLDER_COPY_TH.all}
            </button>
            {holders.map((e) => (
                <button key={e.id} type="button" aria-pressed={selectedId === e.id} className={chip(selectedId === e.id)} onClick={() => onSelect(e.id)}>
                    {e.displayName}
                </button>
            ))}
        </div>
    );
}

/**
 * State for one list page. `holderOf(row)` is the holder's display name when the row
 * carries an `entityId` the user belongs to, else null (the column then stays empty
 * rather than guessing).
 */
export function useHolderFilter() {
    const { entities } = useMyEntities();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const nameById = useMemo(() => new Map(entities.map((e) => [e.id, e.displayName])), [entities]);
    return {
        entities,
        selectedId,
        setSelectedId,
        holderOf: (row: { entityId?: string | null }): string | null =>
            (row.entityId ? nameById.get(row.entityId) ?? null : null),
        matches: (row: { entityId?: string | null }): boolean =>
            selectedId === null || row.entityId === selectedId,
    };
}

/** The "ยื่นในนาม {name}" line of one list row; renders nothing when the holder is unknown. */
export function HolderLine({ name }: { name: string | null }) {
    if (!name) { return null; }
    return <p className="mt-0.5 text-xs text-muted-foreground">{`${HOLDER_COPY_TH.column} ${name}`}</p>;
}
