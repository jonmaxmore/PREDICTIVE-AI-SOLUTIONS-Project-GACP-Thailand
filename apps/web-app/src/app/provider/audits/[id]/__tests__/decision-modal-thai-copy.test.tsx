/**
 * decision-modal-thai-copy.test.tsx — V3-C (DI-4) regression.
 *
 * Purpose: lock the contract that every user-facing label inside the
 * AUDITOR decision modal is Thai. V3-C translated the modal title,
 * notes textarea, evidence upload block, and Cancel / Confirm buttons.
 * This test renders the modal in all 3 decision branches
 * (PASS / MINOR / MAJOR) and asserts the Thai strings appear AND
 * the legacy English copy does NOT — so a future refactor cannot
 * silently re-introduce the English labels.
 *
 * Shape — mirrors V2-A's `review-decision-modal-thai-copy.test.tsx`
 * pattern. The repo pulls in `@testing-library/jest-dom` but not
 * `@testing-library/react`; the modal renders via Radix Dialog which
 * portals away under jsdom. We stub the Modal primitive so the body
 * content renders inline and `renderToStaticMarkup` can see it.
 */

import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuditDecision, AuditEvidenceFile } from '../provider-audit-job-sheet-config';
import type { CARFinding } from '../audit-decision-modal';

// Stable next/navigation router per I-016 (per-file factory).
jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => stableRouter,
        useSearchParams: () => new URLSearchParams(),
        usePathname: () => '/provider/audits/test-id',
        useParams: () => ({ id: 'test-id' }),
    };
});

// Render the modal body inline so SSR can see it (Radix Dialog portals
// otherwise — invisible to renderToStaticMarkup).
jest.mock('@/components/ui/overlays', () => ({
    Modal: ({
        children,
        title,
        opened,
    }: {
        children?: React.ReactNode;
        title?: React.ReactNode;
        opened?: boolean;
    }) => {
        if (!opened) return null;
        return (
            <div data-testid="modal-mock">
                {title ? <h2 data-testid="modal-title">{title}</h2> : null}
                <div data-testid="modal-body">{children}</div>
            </div>
        );
    },
}));

jest.mock('@/components/ui/primitives/badge', () => ({
    Badge: ({ children }: { children?: React.ReactNode }) => (
        <span data-testid="badge">{children}</span>
    ),
}));

jest.mock('@/components/ui/primitives/button', () => ({
    Button: ({ children }: { children?: React.ReactNode }) => (
        <button data-testid="button">{children}</button>
    ),
}));

jest.mock('@/components/ui/icon-buttons', () => ({
    ThemeIcon: ({ children }: { children?: React.ReactNode }) => (
        <span data-testid="theme-icon">{children}</span>
    ),
}));

jest.mock('@/components/ui/textarea', () => ({
    Textarea: ({
        label,
        placeholder,
    }: {
        label?: React.ReactNode;
        placeholder?: string;
        value?: string;
        onChange?: (e: unknown) => void;
    }) => (
        <label data-testid="textarea">
            {label}
            <textarea data-testid="textarea-input" placeholder={placeholder} readOnly />
        </label>
    ),
}));

jest.mock('@tabler/icons-react', () => ({
    IconCheck: () => <span data-testid="icon-check" />,
    IconPhoto: () => <span data-testid="icon-photo" />,
    IconPlus: () => <span data-testid="icon-plus" />,
    IconTrash: () => <span data-testid="icon-trash" />,
    IconUpload: () => <span data-testid="icon-upload" />,
    IconX: () => <span data-testid="icon-x" />,
}));

import { AuditDecisionModal } from '../audit-decision-modal';

const baseProps = {
    opened: true,
    decisionNotes: '',
    evidenceFiles: [] as AuditEvidenceFile[],
    findings: [] as CARFinding[],
    isCompressing: false,
    isSubmitting: false,
    onClose: () => {},
    onDecisionNotesChange: () => {},
    onEvidenceUpload: () => {},
    onRemoveEvidence: () => {},
    onFindingsChange: () => {},
    formatBytes: (n: number) => `${n}B`,
    onSubmit: () => {},
};

function renderModal(decision: AuditDecision) {
    return renderToStaticMarkup(
        <AuditDecisionModal {...baseProps} decision={decision} />,
    );
}

describe('AuditDecisionModal — DI-4 Thai copy (V3-C)', () => {
    it('renders Thai title with the decision code for PASS', () => {
        const html = renderModal('PASS');
        expect(html).toContain('ส่งผลการตรวจ');
        expect(html).toContain('PASS');
    });

    it('renders Thai title with the decision code for MINOR', () => {
        const html = renderModal('MINOR');
        expect(html).toContain('ส่งผลการตรวจ');
        expect(html).toContain('MINOR');
    });

    it('renders Thai title with the decision code for MAJOR', () => {
        const html = renderModal('MAJOR');
        expect(html).toContain('ส่งผลการตรวจ');
        expect(html).toContain('MAJOR');
    });

    it('renders Thai body labels: notes / evidence / actions', () => {
        const html = renderModal('PASS');
        expect(html).toContain('บันทึกผลการตัดสิน');
        expect(html).toContain('ระบุรายละเอียดผลการตัดสิน');
        expect(html).toContain('ภาพถ่ายหลักฐาน');
        expect(html).toContain('เลือกภาพ');
        expect(html).toContain('ยกเลิก');
        expect(html).toContain('ยืนยัน');
    });

    it('does NOT leak the legacy English copy (regression guard)', () => {
        const passHtml = renderModal('PASS');
        expect(passHtml).not.toContain('Submit decision');
        expect(passHtml).not.toContain('Decision notes');
        expect(passHtml).not.toContain('Enter decision details');
        expect(passHtml).not.toContain('Audit Evidence Photos');
        expect(passHtml).not.toContain('Select Photos');
        expect(passHtml).not.toContain('Cancel');
        // "Confirm " (with trailing space) — the modal previously had
        // "Confirm PASS"; now "ยืนยัน PASS". The decision code itself
        // is allowed to be English (technical identifier).
        expect(passHtml).not.toContain('Confirm PASS');
        expect(passHtml).not.toContain('Confirm MINOR');
        expect(passHtml).not.toContain('Confirm MAJOR');
    });

    it('renders the Thai CAR findings block when decision is MINOR or MAJOR', () => {
        const minorHtml = renderModal('MINOR');
        expect(minorHtml).toContain('สิ่งที่ไม่เป็นไปตามข้อกำหนด (CAR)');
        expect(minorHtml).toContain('ระบุจุดที่ผิดและสิ่งที่ต้องแก้ไข');
        expect(minorHtml).toContain('เพิ่มรายการ');
    });

    it('renders nothing when opened=false (Modal shim returns null)', () => {
        const html = renderToStaticMarkup(
            <AuditDecisionModal {...baseProps} opened={false} decision="PASS" />,
        );
        expect(html).toBe('');
    });
});
