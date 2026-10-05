/**
 * The application purposes — the web's ONE copy of the backend vocabulary
 * (apps/backend/shared/certification-purposes.js).
 *
 * Operator ruling 2026-10-05: a purpose is valid only when a ภ.ท. licence for controlled
 * herbs backs it, and what the applicant attaches is the ISSUED licence. The words,
 * labels, licence codes and licence names live in constants/certification-purposes.json
 * (a JSON file so the backend suite can compare it field for field —
 * apps/backend/__tests__/unit/certification-purposes-vocabulary.test.js); this module is
 * the only web source that hands them to a screen.
 */

import vocabulary from '@/constants/certification-purposes.json';

export type CertificationPurpose = 'RESEARCH' | 'EXPORT' | 'PROCESSING';

export interface CertificationPurposeEntry {
    code: CertificationPurpose;
    label: string;
    licenceCode: string;
    licenceName: string;
    slotId: string;
}

export const CERTIFICATION_PURPOSES: ReadonlyArray<CertificationPurposeEntry> = Object.freeze(
    vocabulary as CertificationPurposeEntry[],
);

export const PURPOSE_CODES: ReadonlyArray<CertificationPurpose> = Object.freeze(
    CERTIFICATION_PURPOSES.map((entry) => entry.code),
);

export function isPurposeCode(value: unknown): value is CertificationPurpose {
    return typeof value === 'string' && (PURPOSE_CODES as readonly string[]).includes(value);
}

/** Option text: the label with its licence code, e.g. "ศึกษาวิจัย (ภ.ท. 09)". */
export function purposeOptionLabel(code: CertificationPurpose): string {
    const entry = CERTIFICATION_PURPOSES.find((candidate) => candidate.code === code);
    return entry ? `${entry.label} (${entry.licenceCode})` : code;
}

/** The labelled option for a stored word, or null when the word is not in the vocabulary. */
export function purposeOptionLabelOf(value: unknown): string | null {
    return isPurposeCode(value) ? purposeOptionLabel(value) : null;
}

/**
 * Words a stored list carries that the vocabulary does not know. They are reported, never
 * mapped to another word and never silently dropped: the applicant has to choose again.
 */
export function unknownPurposes(stored: unknown): string[] {
    if (!Array.isArray(stored)) { return []; }
    return stored.filter((word) => !isPurposeCode(word)).map(String);
}

/** A stored list split into what the wizard can carry and what it must ask the applicant again. */
export function splitStoredPurposes(stored: unknown): { valid: CertificationPurpose[]; stale: string[] } {
    const list = Array.isArray(stored) ? stored : [];
    return { valid: list.filter(isPurposeCode), stale: unknownPurposes(list) };
}

/**
 * The issued licence behind each purpose, keyed the way application_documents stores it
 * (the upper-cased canonical slot id) — the rows the officer's document lists show.
 */
export const PURPOSE_LICENCE_DOCUMENTS: ReadonlyArray<{ key: string; name: string }> = Object.freeze(
    CERTIFICATION_PURPOSES.map((purpose) => ({
        key: purpose.slotId.toUpperCase(),
        name: `${purpose.licenceName} (${purpose.licenceCode})`,
    })).concat([
        // กระท่อมส่งออก: ไม่ใช่ ภ.ท. (มติ operator 2026-10-05, ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม)
        { key: 'KRATOM_EXPORT_LICENCE', name: 'ใบอนุญาตส่งออกพืชกระท่อม' },
    ]),
);
