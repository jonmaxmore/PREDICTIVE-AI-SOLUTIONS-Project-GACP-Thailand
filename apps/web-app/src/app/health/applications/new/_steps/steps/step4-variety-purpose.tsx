'use client';

/**
 * Step 4 — สายพันธุ์และวัตถุประสงค์ (กทล.1 ข้อ ๓). ชนิดพืชย้ายไปขั้น 1 (F-QA-04).
 *
 * Nothing on this screen is answered for the applicant. The objective is a legal
 * declaration about what the produce is for — it is what decides which issued ภ.ท.
 * licence is demanded. A default is not a tick.
 *
 * The plant is the load-bearing field: กทล.1 law is filed PER PLANT, so a filing that
 * names none is refused by the submit gate rather than judged leniently. Asking here is
 * what stops an applicant reaching the review page only to be turned away.
 *
 * Presentational; the routed container below owns the store.
 */

import { useEffect, useMemo, useState } from 'react';
import { useApplicationFlowStore, type WizardState } from '../hooks/use-application-flow-store';
import { FALLBACK_PLANTS } from './plant-selection-config';
import {
    OBJECTIVE_OPTIONS,
    VARIETY_KIND_OPTIONS,
    VARIETY_ORIGIN_OPTIONS,
    emptyVarietyRow,
    needsVarietiesNote,
    needsOriginCountry,
    licenceNoticeFor,
    staleObjectivesNotice,
    STALE_PURPOSES_KEY,
    STEP4_COPY_TH,
    type VarietyRow,
    type CertificationObjective,
} from './step4-variety-purpose-config';

export interface Step4VarietyPurposeProps {
    plantId: string | null;
    objectives: readonly string[];
    /** Stored purpose words the vocabulary no longer knows — shown, never silently dropped. */
    staleObjectives?: readonly string[];
    varieties: readonly VarietyRow[];
    varietiesNote: string;
    certScope: 'PLANTING' | 'PROCESSING' | null;
    processing: Record<string, unknown>;
    onChange: (key: string, value: unknown) => void;
}

function Chip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                pressed ? 'bg-leaf-soft border-leaf-700 text-foreground'
                    : 'border-muted bg-card text-muted-foreground hover:border-leaf-300'
            }`}
        >
            {label}
        </button>
    );
}

function Field({ id, label, value, onChange }: {
    id: string; label: string; value: string; onChange: (v: string) => void;
}) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-xs font-medium text-foreground">{label}</label>
            <input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg border-2 border-muted bg-card px-3 py-2 text-sm text-foreground focus:border-leaf-700 focus:outline-none"
            />
        </div>
    );
}

export function Step4VarietyPurpose({
    plantId, objectives, staleObjectives = [], varieties, varietiesNote, certScope, processing, onChange,
}: Step4VarietyPurposeProps) {
    const staleNotice = staleObjectivesNotice(staleObjectives);
    const licenceNotice = licenceNoticeFor(objectives, plantId);
    const rows = varieties.length > 0 ? varieties : [emptyVarietyRow()];
    const openPlants = useMemo(() => FALLBACK_PLANTS.filter((p) => p.enabled), []);

    const toggleObjective = (value: CertificationObjective) => {
        const next = objectives.includes(value)
            ? objectives.filter((v) => v !== value)
            : [...objectives, value];
        onChange('certificationPurposes', next);
    };

    const patchRow = (index: number, patch: Partial<VarietyRow>) => {
        onChange('varieties', rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    };

    return (
        <div className="space-y-8">
            {/* ชนิดพืชย้ายไปขั้น 1 แล้ว (F-QA-04, มติ operator 2026-09-06): กติกาเอกสารทั้งชุด
                ห้อยจากพืช ถ้าถามที่นี่ ขั้น 2-3 จะไม่มีเอกสารให้แนบเลยสำหรับคนยื่นครั้งแรก */}

            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{STEP4_COPY_TH.objectiveHeading}</h3>
                {staleNotice && (
                    <p role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-foreground">
                        {staleNotice}
                    </p>
                )}
                <div className="grid gap-2">
                    {OBJECTIVE_OPTIONS.map((option) => (
                        <Chip
                            key={option.value}
                            label={option.labelTH}
                            pressed={objectives.includes(option.value)}
                            onClick={() => toggleObjective(option.value)}
                        />
                    ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{STEP4_COPY_TH.purposeHint}</p>
                {licenceNotice && (
                    <p role="status" className="rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-foreground">
                        {licenceNotice}
                    </p>
                )}
            </section>

            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{STEP4_COPY_TH.varietiesHeading}</h3>
                {rows.map((row, index) => (
                    <div key={index} className="space-y-3 rounded-xl border-2 border-muted bg-card p-4">
                        <div className="grid gap-2 sm:grid-cols-2">
                            {VARIETY_KIND_OPTIONS.map((option) => (
                                <Chip
                                    key={option.value}
                                    label={option.labelTH}
                                    pressed={row.kind === option.value}
                                    onClick={() => patchRow(index, { kind: option.value })}
                                />
                            ))}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field id={`variety-name-${index}`} label="ชื่อสายพันธุ์" value={row.name} onChange={(v) => patchRow(index, { name: v })} />
                            <Field id={`variety-source-${index}`} label="แหล่งที่มา" value={row.source} onChange={(v) => patchRow(index, { source: v })} />
                            <Field id={`variety-qty-${index}`} label="จำนวน" value={row.quantity} onChange={(v) => patchRow(index, { quantity: v })} />
                            <Field id={`variety-unit-${index}`} label="หน่วย" value={row.unit} onChange={(v) => patchRow(index, { unit: v })} />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {VARIETY_ORIGIN_OPTIONS.map((option) => (
                                <Chip
                                    key={option.value}
                                    label={option.labelTH}
                                    pressed={row.origin === option.value}
                                    onClick={() => patchRow(index, { origin: option.value })}
                                />
                            ))}
                        </div>
                        {needsOriginCountry(row.origin) && (
                            <Field
                                id={`variety-country-${index}`}
                                label={STEP4_COPY_TH.originCountry}
                                value={row.originCountry ?? ''}
                                onChange={(v) => patchRow(index, { originCountry: v })}
                            />
                        )}
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => onChange('varieties', [...rows, emptyVarietyRow()])}
                    className="hover:bg-leaf-soft rounded-lg border border-leaf-300 px-3 py-1.5 text-xs text-leaf-700"
                >
                    {STEP4_COPY_TH.addVariety}
                </button>

                {needsVarietiesNote(rows) && (
                    <div className="space-y-1">
                        <label htmlFor="varieties-note" className="block text-sm font-medium text-foreground">
                            {STEP4_COPY_TH.varietiesNote}
                        </label>
                        <textarea
                            id="varieties-note"
                            value={varietiesNote}
                            onChange={(e) => onChange('varietiesNote', e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border-2 border-muted bg-card px-4 py-2.5 text-sm text-foreground focus:border-leaf-700 focus:outline-none"
                        />
                        <p className="text-xs text-muted-foreground">{STEP4_COPY_TH.varietiesNoteHelp}</p>
                    </div>
                )}
            </section>

            {certScope === 'PROCESSING' && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{STEP4_COPY_TH.processingHeading}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {([
                            ['plantPart', 'ส่วนของพืชที่นำมาแปรรูป'],
                            ['strain', 'สายพันธุ์ที่นำมาแปรรูป'],
                            ['source', 'แหล่งที่มาของวัตถุดิบ'],
                            ['quantity', 'ปริมาณ'],
                            ['unit', 'หน่วย'],
                        ] as const).map(([key, label]) => (
                            <Field
                                key={key}
                                id={`processing-${key}`}
                                label={label}
                                value={String(processing[key] ?? '')}
                                onChange={(v) => onChange('processing', { ...processing, [key]: v })}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

export default Step4VarietyPurpose;

/** The routed step. */
export function Step4VarietyPurposeStep() {
    const { state, updateState } = useApplicationFlowStore();
    // Words the edit page could not carry into the wizard (STALE_PURPOSES_KEY). Read once on
    // mount; cleared the moment the applicant has chosen again.
    const [stale, setStale] = useState<string[]>([]);
    useEffect(() => {
        try {
            const raw = window.sessionStorage.getItem(STALE_PURPOSES_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            setStale(Array.isArray(parsed) ? parsed.map(String) : []);
        } catch {
            setStale([]);
        }
    }, []);
    const chosen = state.certificationPurposes ?? [];
    useEffect(() => {
        if (chosen.length > 0 && stale.length > 0) {
            window.sessionStorage.removeItem(STALE_PURPOSES_KEY);
            setStale([]);
        }
    }, [chosen.length, stale.length]);

    // 2026-09-06: อ่านผ่าน `state as Record<string, unknown>` และเขียนด้วย `as never` มาก่อน
    // ⇒ สามฟิลด์นี้มีอยู่จริงตอนรัน แต่ไม่มีในชนิดของสถานะ ทุกรายการที่สร้างจากชนิดนั้น
    // (payload ที่ส่งขึ้นเซิร์ฟเวอร์ · รายการคีย์ที่เซิร์ฟเวอร์ยอมให้เขียน) จึงมองไม่เห็น
    // และพันธุ์ที่ผู้ยื่นกรอกไม่เคยไปถึงฐานข้อมูล · ประกาศชนิดแล้ว จึงอ่าน/เขียนตรง ๆ ได้
    return (
        <Step4VarietyPurpose
            plantId={state.plantId ?? null}
            objectives={chosen}
            staleObjectives={stale}
            varieties={state.varieties ?? []}
            varietiesNote={state.varietiesNote ?? ''}
            certScope={state.certScope}
            processing={state.processing ?? {}}
            onChange={(key, value) => updateState({ [key]: value } as Partial<WizardState>)}
        />
    );
}
