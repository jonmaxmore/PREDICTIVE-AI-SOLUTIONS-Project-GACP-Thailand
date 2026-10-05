'use client';

import { useState, useCallback } from 'react';
import { z } from 'zod';
import { checkThaiId } from '@gacp/validation/thai-id-checksum';

/**
 * Shared Form Step Hook
 * Extracts the repeated handleChange / validation boilerplate from every wizard step.
 *
 * Previously each step (general-step, farm-info-step, production-info-step)
 * duplicated the same ~40 lines of handleChange + validate + field error logic.
 */

// ─── Shared Schemas ──────────────────────────────────────
const requiredText = z.string().trim().min(1, 'Required');
const phoneSchema = z.string().trim().regex(/^[0-9+\-\s()]{8,}$/, 'Invalid phone');
const emailSchema = z.string().trim().email('Invalid email');
const postalCodeSchema = z.string().regex(/^\d{5}$/, 'Must be 5 digits');
const positiveNumber = z.coerce.number().positive('Must be greater than zero');

// ─── Validation Helpers ──────────────────────────────────

interface FieldErrorMap {
    [field: string]: string;
}

function addFieldError(errors: FieldErrorMap, field: string, message: string) {
    if (!errors[field]) {
        errors[field] = message;
    }
}

/**
 * Messages that describe a value the farmer DID enter being wrong, as opposed to
 * a box they left blank.
 *
 * The step banner has always said "complete highlighted required fields", which
 * is true for a blank box and a lie for a filled one: a national ID that fails
 * its check digit is complete, and telling that farmer to "complete" the field
 * sends them looking for an empty box that does not exist. `apply()` below
 * surfaces the first entry here instead when there is one. (The English wording
 * of the required-field banner itself is ledger F-LQA-06, not this fix.)
 */
const valueErrors: WeakMap<FieldErrorMap, string[]> = new WeakMap();

function addValueError(errors: FieldErrorMap, field: string, message: string) {
    const before = errors[field];
    addFieldError(errors, field, message);
    if (!before) {
        const list = valueErrors.get(errors) || [];
        list.push(message);
        valueErrors.set(errors, list);
    }
}

export function requireField(errors: FieldErrorMap, field: string, value: unknown) {
    const parsed = requiredText.safeParse(String(value ?? ''));
    if (!parsed.success) {
        addFieldError(errors, field, parsed.error.issues[0]?.message || 'Required');
    }
}

/**
 * Judge a Thai 13-digit ID with the SAME rule registration uses.
 *
 * F-G4-10: this used to be `/^\d{13}$/` and nothing more, so a farmer who would
 * have been turned away at sign-up could type an invented number onto the
 * application — and the application is what the certificate is minted from. The
 * check digit now comes from `@gacp/validation/thai-id-checksum`, the one copy
 * in the repo, which the server's submit door calls too. A client-only check is
 * a courtesy that answers instantly; the server's is the one that counts, and
 * they must be the same rule or the courtesy becomes a lie.
 *
 * Emptiness is still `require`'s job, not this function's — an optional ID field
 * left blank is not a checksum failure.
 *
 * @param label what this form calls the number, so the refusal quotes the box
 *   the farmer typed into (a company's is เลขประจำตัวผู้เสียภาษี, not เลขบัตรประชาชน)
 */
export function validateThaiIdChecksum(
    errors: FieldErrorMap,
    field: string,
    value: unknown,
    label?: string,
) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return;
    const result = checkThaiId(normalized, label ? { label } : undefined);
    if (!result.ok) {
        addValueError(errors, field, result.message);
    }
}

export function validatePhone(errors: FieldErrorMap, field: string, value: unknown) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return;
    const parsed = phoneSchema.safeParse(normalized);
    if (!parsed.success) {
        addFieldError(errors, field, parsed.error.issues[0]?.message || 'Invalid phone');
    }
}

export function validateEmail(errors: FieldErrorMap, field: string, value: unknown) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return;
    const parsed = emailSchema.safeParse(normalized);
    if (!parsed.success) {
        addFieldError(errors, field, parsed.error.issues[0]?.message || 'Invalid email');
    }
}

export function validatePostalCode(errors: FieldErrorMap, field: string, value: unknown) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return;
    const parsed = postalCodeSchema.safeParse(normalized);
    if (!parsed.success) {
        addFieldError(errors, field, parsed.error.issues[0]?.message || 'Invalid format');
    }
}

export function validatePositiveNumber(errors: FieldErrorMap, field: string, value: unknown) {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const parsed = positiveNumber.safeParse(raw);
    if (!parsed.success) {
        addFieldError(errors, field, parsed.error.issues[0]?.message || 'Invalid number');
    }
}

// ─── Standalone Error Collector Factory ──────────────────
// Can be used without useFormStep (e.g., general-step.tsx manages its own state)

export function createFieldErrorCollector(applyTo?: (errors: FieldErrorMap) => void) {
    const errors: FieldErrorMap = {};
    return {
        errors,
        require: (field: string, value: unknown) => requireField(errors, field, value),
        // `healthId` is this repo's established marker for a national-ID-class
        // field; apps/backend/utils/formdata-pii.js:32-44 reads these call sites
        // to decide which formData keys get encrypted at rest. Kept as the name
        // so that cross-reference keeps resolving.
        healthId: (field: string, value: unknown, label?: string) =>
            validateThaiIdChecksum(errors, field, value, label),
        phone: (field: string, value: unknown) => validatePhone(errors, field, value),
        email: (field: string, value: unknown) => validateEmail(errors, field, value),
        postalCode: (field: string, value: unknown) => validatePostalCode(errors, field, value),
        positiveNumber: (field: string, value: unknown) => validatePositiveNumber(errors, field, value),
        hasErrors: () => Object.keys(errors).length > 0,
        apply: (): string | null => {
            if (Object.keys(errors).length > 0) {
                applyTo?.(errors);
                // A wrong value is not a missing one — say which it is.
                return valueErrors.get(errors)?.[0]
                    ?? 'Please complete highlighted required fields.';
            }
            applyTo?.({});
            return null;
        },
    };
}

// ─── Hook ────────────────────────────────────────────────

export function useFormStep<T extends Record<string, unknown>>(initialData: T | (() => T)) {
    const [formData, setFormData] = useState<T>(initialData);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});

    const handleChange = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError(null);
        setFieldErrors(prev => {
            const key = String(field);
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const clearErrors = useCallback(() => {
        setError(null);
        setFieldErrors({});
    }, []);

    const setValidationError = useCallback((message: string) => {
        setError(message);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const hookCreateCollector = useCallback(
        () => createFieldErrorCollector(setFieldErrors),
        [],
    );

    return {
        formData,
        setFormData,
        error,
        setError,
        fieldErrors,
        setFieldErrors,
        handleChange,
        clearErrors,
        setValidationError,
        createFieldErrorCollector: hookCreateCollector,
    };
}

export type { FieldErrorMap };
