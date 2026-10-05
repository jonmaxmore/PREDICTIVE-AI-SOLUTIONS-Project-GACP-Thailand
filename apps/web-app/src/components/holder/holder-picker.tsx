'use client';

/**
 * HolderPicker — "ยื่นในนาม". One question, used by step 1 of the application
 * (purpose 'file') and by the farm-create form (purpose 'farm').
 *
 * The server decides what a membership may do (`can` on /entities/mine); this
 * component only shows it. A holder is never chosen for the user: with exactly one
 * holder the screen states it as a fact, with several the user picks, and there is
 * no default (spec §3.2).
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { EntityMembership } from '@/lib/services/my-entities-provider';
import { ADD_ENTITY_HREF, HOLDER_COPY_TH, ROLE_LINE_TH, holderTypeLine, orderHolders } from './holder-labels';

export type HolderPurpose = 'file' | 'farm';

export interface HolderPickerProps {
    entities: readonly EntityMembership[];
    value: string | null;
    onChange: (entityId: string) => void;
    purpose: HolderPurpose;
}

/** May the user act for this holder for this purpose? */
export function mayUseHolder(e: EntityMembership, purpose: HolderPurpose): boolean {
    return purpose === 'farm' ? e.can.createFarm : e.can.edit;
}

export function HolderPicker({ entities, value, onChange, purpose }: HolderPickerProps) {
    const holders = orderHolders(entities);
    const usable = holders.filter((e) => mayUseHolder(e, purpose));
    const title = purpose === 'farm' ? HOLDER_COPY_TH.farmTitle : HOLDER_COPY_TH.title;
    const help = purpose === 'farm' ? HOLDER_COPY_TH.farmHelp : HOLDER_COPY_TH.help;
    const onlyOne = usable.length === 1 ? usable[0]! : null;

    const noteFor = (e: EntityMembership): string | null => {
        if (!mayUseHolder(e, purpose)) {
            return purpose === 'farm' ? HOLDER_COPY_TH.noFarmRight : HOLDER_COPY_TH.viewerOnly;
        }
        if (purpose === 'file' && !e.can.submit) { return HOLDER_COPY_TH.editNotSubmit; }
        return null;
    };

    return (
        <section aria-label={title}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{help}</p>

            {onlyOne ? (
                <div className="rounded-xl border border-leaf-300 bg-leaf-soft px-4 py-3 text-sm text-foreground">
                    <p className="font-semibold">
                        {purpose === 'farm'
                            ? `${title} ${onlyOne.displayName} · สถานที่ปลูกจะอยู่ในนามนี้`
                            : `${title} ${onlyOne.displayName} · ใบรับรองจะออกในนามนี้`}
                    </p>
                    {noteFor(onlyOne) && (
                        <p className="mt-1 text-xs text-muted-foreground">{noteFor(onlyOne)}</p>
                    )}
                </div>
            ) : usable.length === 0 ? (
                <p role="status" className="rounded-xl border border-muted bg-card px-4 py-3 text-sm text-foreground">
                    {purpose === 'farm' ? HOLDER_COPY_TH.noHolderForFarm : HOLDER_COPY_TH.noHolderForFile}
                </p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                    {holders.map((e) => {
                        const usableHere = mayUseHolder(e, purpose);
                        const selected = value === e.id;
                        const note = noteFor(e);
                        return (
                            <button
                                key={e.id}
                                type="button"
                                aria-pressed={selected}
                                disabled={!usableHere}
                                onClick={() => onChange(e.id)}
                                className={cn(
                                    'flex w-full flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all duration-200',
                                    selected ? 'bg-leaf-soft border-leaf-700' : 'border-muted bg-card hover:border-leaf-300',
                                    !usableHere && 'cursor-not-allowed opacity-60 hover:border-muted',
                                )}
                            >
                                <span className="text-sm font-semibold text-foreground">{e.displayName}</span>
                                <span className="text-xs text-muted-foreground">
                                    {holderTypeLine(e)} · {ROLE_LINE_TH[e.role]}
                                </span>
                                {note && <span className="text-xs leading-relaxed text-muted-foreground">{note}</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            <p className="mt-3 text-xs">
                <Link href={ADD_ENTITY_HREF} className="font-semibold text-leaf-700 underline underline-offset-2">
                    {HOLDER_COPY_TH.addEntityLink}
                </Link>
            </p>
        </section>
    );
}
