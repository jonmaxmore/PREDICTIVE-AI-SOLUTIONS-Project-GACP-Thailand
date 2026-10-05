'use client';

/**
 * Step 3 — สถานที่ปลูกและสิทธิในที่ดิน (กทล.1 ส่วนที่ ๒ ข้อ ๑-๒).
 *
 * Two of the answers on this screen are DIMENSIONS the requirement register matches
 * rules on: `landOwnership` and `areaType`. Changing either changes which papers the
 * filing owes — a lease pulls in the landlord's consent, an อาคารระบบปิด pulls in the
 * building plan. So the container re-ASKS the server after they change instead of
 * keeping its own idea of the required set, and every card says why it appeared.
 *
 * The field list is the paper's and only the paper's. v1's site step had grown a water
 * system and an expected-yield estimate, neither of which กทล.1 asks; each was a thing a
 * farmer had to answer before they could file and that nobody was entitled to require.
 */

import { useEffect } from 'react';
import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { useRequirementSlots, SLOTS_LOADING_TH, SLOTS_PENDING_TH } from '../hooks/use-requirement-slots';
import { RequirementSlotCard } from './requirement-slot-card';
import {
    LAND_TENURE_OPTIONS,
    AREA_TYPE_OPTIONS,
    LAND_DOCUMENT_FIELDS,
    STEP3_SITE_SLOT_IDS,
    STEP3_COPY_TH,
    needsLandlordName,
    type LandTenure,
    type SiteAreaType,
} from './step3-site-land-config';
import type { RequirementSlot } from '@/lib/services/application-requirements';

export interface Step3SiteLandProps {
    farmData: Record<string, unknown>;
    /** The server's answer. Never a list this screen keeps. */
    slots: readonly RequirementSlot[];
    appId: string;
    onChange: (key: string, value: unknown) => void;
    onChanged: () => void;
    /** The server's word that this filing still takes document writes (delete control). */
    editable?: boolean;
}

function Text({ id, label, value, onChange, required = false, type = 'text' }: {
    id: string; label: string; value: string; onChange: (v: string) => void;
    required?: boolean; type?: string;
}) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-sm font-medium text-foreground">
                {label}
                {required && <span aria-hidden className="ml-1 text-destructive">*</span>}
                {required && <span className="sr-only"> (บังคับ)</span>}
            </label>
            <input
                id={id}
                type={type}
                inputMode={type === 'number' ? 'numeric' : undefined}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-xl border-2 border-muted bg-card px-4 py-2.5 text-sm text-foreground focus:border-leaf-700 focus:outline-none"
            />
        </div>
    );
}

export function Step3SiteLand({ farmData, slots, appId, onChange, onChanged, editable = false }: Step3SiteLandProps) {
    const str = (key: string) => String(farmData[key] ?? '');
    const landOwnership = (farmData.landOwnership as LandTenure | undefined) ?? null;
    const areaTypes = Array.isArray(farmData.areaTypes) ? (farmData.areaTypes as SiteAreaType[]) : [];
    const landDoc = (farmData.landDocumentDetail ?? {}) as Record<string, string>;

    const toggleAreaType = (value: SiteAreaType) => {
        // A checkbox row on the paper: a farm with a greenhouse standing in an open
        // field ticks two, and owes the papers of both.
        const next = areaTypes.includes(value)
            ? areaTypes.filter((v) => v !== value)
            : [...areaTypes, value];
        onChange('areaTypes', next);
    };

    const siteSlots = STEP3_SITE_SLOT_IDS
        .map((id) => slots.find((s) => s.slotId === id))
        .filter((s): s is RequirementSlot => Boolean(s));

    return (
        <div className="space-y-8">
            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{STEP3_COPY_TH.siteHeading}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Text id="site-name" label={STEP3_COPY_TH.siteName} value={str('siteName')} onChange={(v) => onChange('siteName', v)} required />
                    <Text id="site-phone" label={STEP3_COPY_TH.sitePhone} value={str('sitePhone')} onChange={(v) => onChange('sitePhone', v)} type="tel" />
                    <div className="sm:col-span-2">
                        <Text id="site-address" label={STEP3_COPY_TH.siteAddress} value={str('siteAddress')} onChange={(v) => onChange('siteAddress', v)} required />
                    </div>
                    <Text id="site-subdistrict" label={STEP3_COPY_TH.siteSubDistrict} value={str('subDistrict')} onChange={(v) => onChange('subDistrict', v)} required />
                    <Text id="site-district" label={STEP3_COPY_TH.siteDistrict} value={str('district')} onChange={(v) => onChange('district', v)} required />
                    <Text id="site-province" label={STEP3_COPY_TH.siteProvince} value={str('province')} onChange={(v) => onChange('province', v)} required />
                    <Text id="site-postal-code" label={STEP3_COPY_TH.sitePostalCode} value={str('postalCode')} onChange={(v) => onChange('postalCode', v)} />
                    <Text id="coordinates" label={STEP3_COPY_TH.coordinates} value={str('coordinates')} onChange={(v) => onChange('coordinates', v)} />
                </div>
            </section>

            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{STEP3_COPY_TH.landHeading}</h3>
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">{STEP3_COPY_TH.landOwnership}</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {LAND_TENURE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={landOwnership === option.value}
                                onClick={() => onChange('landOwnership', option.value)}
                                className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                                    landOwnership === option.value
                                        ? 'bg-leaf-soft border-leaf-700 text-foreground'
                                        : 'border-muted bg-card text-muted-foreground hover:border-leaf-300'
                                }`}
                            >
                                {option.labelTH}
                            </button>
                        ))}
                    </div>
                </fieldset>

                {needsLandlordName(landOwnership) && (
                    <Text
                        id="landlord-name"
                        label={STEP3_COPY_TH.landlordName}
                        value={str('landlordName')}
                        onChange={(v) => onChange('landlordName', v)}
                        required
                    />
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                    {LAND_DOCUMENT_FIELDS.map((field) => (
                        <Text
                            key={field.key}
                            id={`land-doc-${field.key}`}
                            label={field.labelTH}
                            value={String(landDoc[field.key] ?? '')}
                            onChange={(v) => onChange('landDocumentDetail', { ...landDoc, [field.key]: v })}
                            required={field.required}
                        />
                    ))}
                </div>
            </section>

            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{STEP3_COPY_TH.scaleHeading}</h3>
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">{STEP3_COPY_TH.areaType}</legend>
                    <div className="grid gap-2 sm:grid-cols-4">
                        {AREA_TYPE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={areaTypes.includes(option.value)}
                                onClick={() => toggleAreaType(option.value)}
                                className={`rounded-xl border-2 p-3 text-sm transition-colors ${
                                    areaTypes.includes(option.value)
                                        ? 'bg-leaf-soft border-leaf-700 text-foreground'
                                        : 'border-muted bg-card text-muted-foreground hover:border-leaf-300'
                                }`}
                            >
                                {option.labelTH}
                            </button>
                        ))}
                    </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-3">
                    <Text id="area-sqm" label={STEP3_COPY_TH.areaSqm} value={str('areaSqm')} onChange={(v) => onChange('areaSqm', v)} type="number" required />
                    <Text id="plants-per-cycle" label={STEP3_COPY_TH.plantsPerCycle} value={str('plantsPerCycle')} onChange={(v) => onChange('plantsPerCycle', v)} type="number" />
                    <Text id="cycles-per-year" label={STEP3_COPY_TH.cyclesPerYear} value={str('cyclesPerYear')} onChange={(v) => onChange('cyclesPerYear', v)} type="number" />
                </div>
            </section>

            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{STEP3_COPY_TH.documentsHeading}</h3>
                <p role="status" className="border-leaf-300 bg-leaf-soft rounded-xl border px-4 py-3 text-xs leading-relaxed text-foreground">
                    {STEP3_COPY_TH.conditionalExplainer}
                </p>
                <div className="space-y-3">
                    {siteSlots.map((slot) => (
                        <RequirementSlotCard key={slot.slotId} slot={slot} appId={appId} onChanged={onChanged} editable={editable} stepKey="site-land" />
                    ))}
                </div>
            </section>
        </div>
    );
}

export default Step3SiteLand;

/**
 * The routed step. Re-asks the server whenever a dimension changes, because the answer
 * to "which papers does this filing owe" is the server's and changes with these fields.
 */
export function Step3SiteLandStep() {
    const { state, setFarmData } = useApplicationFlowStore();

    const appId = state.applicationId ?? '';
    const farmData = (state.farmData ?? {}) as unknown as Record<string, unknown>;
    // Honest states (2026-09-06): a missing appId or an in-flight read must never
    // render this step's conditional-documents section as empty-because-nothing-owed.
    const { slots, loading, error: loadError, pending, editable, reload } = useRequirementSlots(appId);
    // The two dimensions. Re-fetch keys off them so a changed answer re-asks the law.
    const dimensionKey = `${String(farmData.landOwnership ?? '')}|${JSON.stringify(farmData.areaTypes ?? [])}`;
    useEffect(() => { void reload(); }, [reload, dimensionKey]);

    return (
        <div className="space-y-4">
            {loading && (
                <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-3 text-center text-sm text-muted-foreground">
                    {SLOTS_LOADING_TH}
                </p>
            )}
            {!loading && pending && (
                <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    {SLOTS_PENDING_TH}
                </p>
            )}
            {!loading && !pending && loadError && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {loadError}
                    <button
                        type="button"
                        onClick={() => { void reload(); }}
                        className="ms-2 font-semibold underline underline-offset-2"
                    >
                        ลองใหม่
                    </button>
                </p>
            )}
            <Step3SiteLand
                farmData={farmData}
                slots={[...slots]}
                editable={editable}
                appId={appId}
                onChange={(key, value) => { setFarmData({ ...farmData, [key]: value } as never); }}
                onChanged={() => { void reload(); }}
            />
        </div>
    );
}
