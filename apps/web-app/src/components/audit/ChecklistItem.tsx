'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ChecklistAnswer } from '@/lib/services/audit-service';
import { SignedImage } from '@/components/ui/signed-image';

/**
 * ChecklistItem — Iter 25 step 4.2 card.
 *
 * Each item is one row of the GACP onsite criteria. The auditor
 * picks yes/no/n/a, optionally writes a note, and attaches photos.
 * The card is mobile-first: large 44px+ tap targets for the radio
 * group, a vertically stacked layout, and a "แนบภาพ" button that
 * triggers the device camera via the native file input
 * (`capture="environment"`) so we don't need a custom camera UI.
 */

export interface ChecklistItemPhoto {
    id: string;
    name: string;
    url?: string;
}

export interface ChecklistItemValue {
    answer: ChecklistAnswer | null;
    notes: string;
    photos: ChecklistItemPhoto[];
}

export interface ChecklistItemProps {
    /** Stable id from the GACP criterion. */
    itemId: string;
    /** Step number (1-based) shown to the user. */
    index: number;
    /** Item title in Thai, e.g. "การใช้สารเคมีเกษตร". */
    title: string;
    /** Long-form description / acceptance criteria. */
    description: string;
    /** Optional category label, e.g. "GACP 4.3". */
    category?: string;
    /** Whether the row must be answered before submission. */
    required?: boolean;
    /** Current value (controlled). */
    value: ChecklistItemValue;
    /** Value change callback — receives the full updated value. */
    onChange: (next: ChecklistItemValue) => void;
    /**
     * Handle a fresh photo selected from the file input. The parent
     * uploads it and returns the persisted photo metadata so we can
     * track upload progress at the parent level.
     */
    onPhotoCapture: (files: FileList) => void | Promise<void>;
}

const ANSWER_OPTIONS: Array<{
    value: ChecklistAnswer;
    label: string;
    tone: string;
}> = [
    { value: 'YES', label: 'ใช่', tone: 'emerald' },
    { value: 'NO', label: 'ไม่ใช่', tone: 'rose' },
    { value: 'NA', label: 'ไม่เกี่ยวข้อง', tone: 'slate' },
];

const TONE_CLASSES: Record<string, { active: string; idle: string }> = {
    emerald: {
        active: 'border-leaf-700 bg-leaf-soft text-leaf-onSoft',
        idle: 'border-slate-300 bg-white text-slate-700 hover:bg-leaf-soft/40',
    },
    rose: {
        active: 'border-rose-600 bg-rose-50 text-rose-800',
        idle: 'border-slate-300 bg-white text-slate-700 hover:bg-rose-50/40',
    },
    slate: {
        active: 'border-slate-600 bg-slate-100 text-slate-800',
        idle: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    },
};

export function ChecklistItem({
    itemId,
    index,
    title,
    description,
    category,
    required,
    value,
    onChange,
    onPhotoCapture,
}: ChecklistItemProps) {
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const setAnswer = (answer: ChecklistAnswer) => {
        onChange({ ...value, answer });
    };

    const setNotes = (notes: string) => {
        onChange({ ...value, notes });
    };

    return (
        <article
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
            data-checklist-id={itemId}
        >
            <header className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-sm font-bold text-leaf-onSoft">
                    {index}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900 md:text-lg">
                            {title}
                        </h3>
                        {category ? (
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                {category}
                            </span>
                        ) : null}
                        {required ? (
                            <span className="text-xs font-semibold text-rose-700">
                                * จำเป็น
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{description}</p>
                </div>
            </header>

            <fieldset className="mt-4">
                <legend className="sr-only">เลือกผลการตรวจ</legend>
                <div className="grid grid-cols-3 gap-2">
                    {ANSWER_OPTIONS.map((opt) => {
                        const isActive = value.answer === opt.value;
                        const tone = TONE_CLASSES[opt.tone] ?? { active: '', idle: '' };
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setAnswer(opt.value)}
                                className={cn(
                                    'min-h-[48px] rounded-lg border-2 px-2 py-2 text-sm font-semibold transition-colors',
                                    isActive ? tone.active : tone.idle,
                                )}
                                role="radio"
                                aria-checked={isActive}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            <div className="mt-4 space-y-3">
                <label className="block">
                    <span className="text-xs font-semibold uppercase text-slate-600">
                        บันทึก
                    </span>
                    <textarea
                        value={value.notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        placeholder="ระบุข้อสังเกตจากภาคสนาม"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                    />
                </label>

                <div>
                    <span className="text-xs font-semibold uppercase text-slate-600">
                        ภาพถ่ายหลักฐาน ({value.photos.length})
                    </span>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex h-11 items-center gap-2 rounded-lg border-2 border-dashed border-leaf bg-leaf-soft px-4 text-sm font-semibold text-leaf-onSoft transition-colors hover:bg-leaf-soft"
                        >
                            <span aria-hidden="true">+</span>
                            แนบภาพ
                        </button>
                        {value.photos.map((p) => (
                            <span
                                key={p.id}
                                className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                            >
                                {p.url ? (
                                    // W1-2 — a stored photo url points at the gated
                                    // `/uploads/audits/...` mount, which a bare <img>
                                    // cannot authenticate to. SignedImage mints a
                                    // short-lived signed url per photo; a local data:
                                    // preview passes straight through unsigned.
                                    <SignedImage
                                        src={p.url}
                                        alt={p.name}
                                        className="h-7 w-7 rounded object-cover"
                                        placeholderClassName="h-7 w-7 rounded bg-slate-200"
                                    />
                                ) : null}
                                <span className="max-w-[120px] truncate">{p.name}</span>
                            </span>
                        ))}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="sr-only"
                        aria-label="แนบภาพหลักฐาน"
                        onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                                onPhotoCapture(e.target.files);
                                // Reset so the same file can be picked again
                                // immediately after.
                                e.target.value = '';
                            }
                        }}
                    />
                </div>
            </div>
        </article>
    );
}

export default ChecklistItem;
