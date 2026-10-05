'use client';

/**
 * Direct entry of a farm's GPS coordinates.
 *
 * The farm-location wizard step requires coordinates before an applicant can
 * continue. Two of the three ways to supply them depend on things we cannot
 * assume: a rendered map (which needs an in-country tile source the operator
 * has configured — see `lib/config/map-tiles`) and the device's own
 * geolocation (which needs the applicant to be standing on the farm). This is
 * the third way, and the only one that always works: type the numbers.
 *
 * It is shown whenever the map cannot be drawn, so that removing the foreign
 * tile server closes a privacy hole without closing the application form.
 */

import { useId, useMemo } from 'react';

/**
 * Thailand's land extent, rounded outward by a small margin.
 *
 * Bounds are not pedantry. `13.7563, 100.5018` typed in the wrong order is
 * `100.5018, 13.7563` — a perfectly well-formed coordinate in the Indian
 * Ocean, which would be stored against a real certification and then sent to
 * an auditor as the place to go. A range check is the only thing standing
 * between that typo and a wasted site visit.
 */
const THAILAND_BOUNDS = {
    minLat: 5.0,
    maxLat: 21.0,
    minLng: 97.0,
    maxLng: 106.0,
} as const;

export type CoordinateCheck =
    /** At least one field is still empty — nothing to judge yet. */
    | { status: 'incomplete' }
    | { status: 'invalid'; message: string }
    | { status: 'ok'; lat: string; lng: string };

/**
 * Validate a typed coordinate pair.
 *
 * Exported separately from the component because this is where the decision
 * lives, and a decision that matters this much deserves to be testable
 * without a DOM.
 */
export function checkThaiCoordinates(latInput: string, lngInput: string): CoordinateCheck {
    const latText = latInput.trim();
    const lngText = lngInput.trim();

    if (!latText || !lngText) {
        return { status: 'incomplete' };
    }

    const lat = Number(latText);
    const lng = Number(lngText);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { status: 'invalid', message: 'กรุณากรอกพิกัดเป็นตัวเลข เช่น 13.756300' };
    }

    const inThailand =
        lat >= THAILAND_BOUNDS.minLat
        && lat <= THAILAND_BOUNDS.maxLat
        && lng >= THAILAND_BOUNDS.minLng
        && lng <= THAILAND_BOUNDS.maxLng;

    if (!inThailand) {
        return {
            status: 'invalid',
            message: 'พิกัดอยู่นอกขอบเขตประเทศไทย กรุณาตรวจสอบว่าสลับค่าละติจูดกับลองจิจูดหรือไม่',
        };
    }

    return { status: 'ok', lat: latText, lng: lngText };
}

interface ManualCoordinateEntryProps {
    lat: string;
    lng: string;
    /** Called only with a pair that passed validation. */
    onChange: (lat: string, lng: string) => void;
}

export function ManualCoordinateEntry({ lat, lng, onChange }: ManualCoordinateEntryProps) {
    const baseId = useId();
    const latId = `${baseId}-lat`;
    const lngId = `${baseId}-lng`;
    const errorId = `${baseId}-error`;

    const check = useMemo(() => checkThaiCoordinates(lat, lng), [lat, lng]);
    const errorMessage = check.status === 'invalid' ? check.message : null;

    const handle = (nextLat: string, nextLng: string) => {
        // Always propagate the raw text so the fields stay controlled and the
        // applicant can see what they typed; the parent decides what to do
        // with an invalid pair by running the same check.
        onChange(nextLat, nextLng);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-foreground" htmlFor={latId}>
                        ละติจูด
                    </label>
                    <input
                        id={latId}
                        type="text"
                        inputMode="decimal"
                        value={lat}
                        placeholder="13.756300"
                        aria-invalid={errorMessage ? true : undefined}
                        aria-describedby={errorMessage ? errorId : undefined}
                        onChange={(event) => handle(event.target.value, lng)}
                        className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm tabular-nums text-foreground"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-foreground" htmlFor={lngId}>
                        ลองจิจูด
                    </label>
                    <input
                        id={lngId}
                        type="text"
                        inputMode="decimal"
                        value={lng}
                        placeholder="100.501800"
                        aria-invalid={errorMessage ? true : undefined}
                        aria-describedby={errorMessage ? errorId : undefined}
                        onChange={(event) => handle(lat, event.target.value)}
                        className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm tabular-nums text-foreground"
                    />
                </div>
            </div>
            {errorMessage ? (
                <p className="text-xs font-medium text-destructive" id={errorId} role="alert">
                    {errorMessage}
                </p>
            ) : null}
        </div>
    );
}

export default ManualCoordinateEntry;
