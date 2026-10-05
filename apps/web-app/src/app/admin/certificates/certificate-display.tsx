'use client';

import * as React from 'react';

import { StatusBadge, type StatusTone } from '@/components/finance';

/**
 * Shared presentation for the two admin certificate pages
 * (/admin/certificates and /admin/certificates/[id]) — ledger F-G4-46 /
 * F-G4-47. ONE place maps the certificate status vocabulary and ONE place
 * turns a stored id into something a person can read, so the list chip and
 * the detail chip can never drift apart again.
 *
 * Status vocabulary: certificate-service writes canonical lowercase
 * ('active', 'expired', 'revoked', 'renewed', 'suspended' — see
 * prisma/schema/certification.prisma Certificate.status); legacy and
 * interop rows carry uppercase. Case is normalised here, once.
 */

export type CertificateStatusKey =
    | 'active'
    | 'expired'
    | 'revoked'
    | 'suspended'
    | 'renewed'
    | 'unknown';

export interface CertificateStatusPresentation {
    key: CertificateStatusKey;
    label: string;
    tone: StatusTone;
    /**
     * Extra classes layered over the tone. Revoked reuses the rose pairing
     * the revoked panel on the detail page already wears (border-rose-300 /
     * bg-rose-50 / text-rose-900) — no new colour.
     */
    className?: string;
}

const KNOWN_STATUSES: ReadonlyArray<Exclude<CertificateStatusKey, 'unknown'>> = [
    'active',
    'expired',
    'revoked',
    'suspended',
    'renewed',
];

export function normalizeCertificateStatus(raw: string | null | undefined): CertificateStatusKey {
    const lower = String(raw || '').trim().toLowerCase();
    return (KNOWN_STATUSES as ReadonlyArray<string>).includes(lower)
        ? (lower as CertificateStatusKey)
        : 'unknown';
}

const STATUS_PRESENTATION: Record<CertificateStatusKey, CertificateStatusPresentation> = {
    active: { key: 'active', label: 'กำลังใช้งาน', tone: 'paid' },
    expired: { key: 'expired', label: 'หมดอายุ', tone: 'draft' },
    revoked: {
        key: 'revoked',
        label: 'เพิกถอนแล้ว',
        tone: 'overdue',
        className: 'border-rose-300 bg-rose-50 text-rose-900',
    },
    suspended: { key: 'suspended', label: 'ระงับชั่วคราว', tone: 'held' },
    renewed: { key: 'renewed', label: 'ต่ออายุแล้ว', tone: 'info' },
    unknown: { key: 'unknown', label: 'ไม่ทราบสถานะ', tone: 'draft' },
};

export function presentCertificateStatus(raw: string | null | undefined): CertificateStatusPresentation {
    return STATUS_PRESENTATION[normalizeCertificateStatus(raw)];
}

export function CertificateStatusBadge({
    status,
    className,
}: {
    status: string | null | undefined;
    className?: string | undefined;
}) {
    const presentation = presentCertificateStatus(status);
    const mergedClassName = [presentation.className, className].filter(Boolean).join(' ');
    return (
        <StatusBadge
            status={presentation.key}
            label={presentation.label}
            tone={presentation.tone}
            {...(mergedClassName ? { className: mergedClassName } : {})}
        />
    );
}

const SYSTEM_ACTOR_IDS: ReadonlyArray<string> = ['system', 'SYSTEM'];

/**
 * Renders a person the way the admin user list does (display name), and
 * never a raw uuid: without a name the role label 'เจ้าหน้าที่' plus the
 * last 6 characters of the id in a <code>. When no person acted the backend
 * stores a literal instead of a user id — 'system'
 * (certificate-service.js revokeCertificateForApplication default) or
 * 'SYSTEM' (revokeCertificate default, issuance) — and the same component
 * sits under both 'ออกโดย' and 'ผู้ดำเนินการ', so the label must not say
 * what was done: it reads plain 'ระบบ'.
 */
export function StaffIdentityText({
    id,
    displayName,
}: {
    id: string | null | undefined;
    displayName?: string | null | undefined;
}) {
    const trimmedId = String(id || '').trim();
    if (!trimmedId) return <>-</>;
    const name = String(displayName || '').trim();
    if (name) return <>{name}</>;
    if (SYSTEM_ACTOR_IDS.includes(trimmedId)) return <>ระบบ</>;
    return (
        <>
            เจ้าหน้าที่{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
                {trimmedId.slice(-6)}
            </code>
        </>
    );
}

/**
 * Issuance stores the literal placeholder 'Unknown' (or '-') when the
 * application carried no location — certificate-service.js
 * generateCertificate/resolveFarmForCertificate. The English word never
 * reaches the screen: null, empty, '-' and 'Unknown' all read 'ไม่ระบุ'.
 */
const PLACE_PLACEHOLDERS: ReadonlyArray<string> = ['', '-', 'unknown'];

export function placeLabel(value: string | null | undefined): string {
    const trimmed = String(value || '').trim();
    return PLACE_PLACEHOLDERS.includes(trimmed.toLowerCase()) ? 'ไม่ระบุ' : trimmed;
}

/**
 * The application as a person reads it: the application number when the
 * API supplies it, otherwise a short handle built from the id's last 6
 * characters (same convention as /health/applications) — never the uuid.
 */
export function applicationLabel(
    application: { applicationNumber?: string | null } | null | undefined,
    applicationId: string | null | undefined,
): string {
    const number = String(application?.applicationNumber || '').trim();
    if (number) return number;
    const id = String(applicationId || '').trim();
    return id ? `#${id.slice(-6).toUpperCase()}` : '-';
}
