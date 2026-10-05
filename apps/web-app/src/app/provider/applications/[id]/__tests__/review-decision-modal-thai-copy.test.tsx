/**
 * review-decision-modal-thai-copy.test.tsx — V2-A (DR-3) regression.
 *
 * Purpose: lock the contract that every user-facing label inside the
 * doc-review decision modal is Thai. The rest of the DTAM staff
 * surface (scheduler queue, reassign page, reviewer dashboard) is
 * Thai-first; the modal was the last English-only outlier. This test
 * uses `renderToStaticMarkup` to render the modal in BOTH branches
 * (approve / revision) and asserts the Thai strings AND the absence
 * of the legacy English copy.
 *
 * Why this shape — the project pulls in `@testing-library/jest-dom`
 * but NOT `@testing-library/react`; the modal renders via Radix
 * Dialog which portals away in jsdom. The Modal wrapper renders the
 * Dialog header (which includes the title) INSIDE the portal too.
 * Some content (the body Alert / buttons) does emit static markup
 * even via SSR — we assert on what we can see and rely on the
 * Playwright suite (out of scope here) for the portal-only nodes.
 *
 * To keep the SSR pass deterministic we mock the upstream Modal
 * primitive so the body content renders inline regardless of Radix
 * portaling. This is the same workaround pattern documented at the
 * head of `reopen-period-modal.test.tsx`.
 */

import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the modal body inline so SSR can see it (Radix Dialog portals
// to document.body otherwise — invisible to renderToStaticMarkup).
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

// Stub Alert / Select / Textarea / Button / Input so we get
// deterministic SSR output; the actual primitives pull in Tailwind +
// Radix which depend on a browser. The shims mirror the real ABI so
// the production import surface stays intact (`Alert color title`,
// `Select label data`, etc.) — V2-A does NOT change those signatures.
jest.mock('@/components/ui/alert', () => ({
    Alert: ({
        title,
        children,
    }: {
        title?: React.ReactNode;
        children?: React.ReactNode;
        icon?: React.ReactNode;
        color?: string;
    }) => (
        <div data-testid="alert">
            <span data-testid="alert-title">{title}</span>
            <span data-testid="alert-body">{children}</span>
        </div>
    ),
}));

jest.mock('@/components/ui/select', () => ({
    Select: ({ label }: { label?: React.ReactNode; data?: unknown; value?: string; onChange?: (v: string) => void }) => (
        <label data-testid="select">{label}</label>
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
        required?: boolean;
    }) => (
        <label data-testid="textarea">
            {label}
            <textarea data-testid="textarea-input" placeholder={placeholder} readOnly />
        </label>
    ),
}));

jest.mock('@/components/ui/primitives/button', () => ({
    Button: ({ children }: { children?: React.ReactNode }) => (
        <button data-testid="button">{children}</button>
    ),
}));

jest.mock('@/components/ui/primitives/input', () => ({
    Input: ({ placeholder }: { placeholder?: string }) => (
        <input data-testid="input" placeholder={placeholder} readOnly />
    ),
}));

jest.mock('@/components/ui/icon-buttons', () => ({
    ActionIcon: ({ children }: { children?: React.ReactNode }) => (
        <button data-testid="action-icon">{children}</button>
    ),
}));

jest.mock('@tabler/icons-react', () => ({
    IconAlertTriangle: () => <span data-testid="icon-alert" />,
    IconCheck: () => <span data-testid="icon-check" />,
    IconPlus: () => <span data-testid="icon-plus" />,
    IconSend: () => <span data-testid="icon-send" />,
    IconTrash: () => <span data-testid="icon-trash" />,
}));

import { ReviewDecisionModal } from '../review-decision-modal';

const baseProps = {
    opened: true,
    onClose: () => {},
    reviewComment: '',
    onReviewCommentChange: () => {},
    revisionCategory: 'MISSING_DOCUMENT',
    onRevisionCategoryChange: () => {},
    revisionItems: [] as string[],
    onAddRevisionItem: () => {},
    onUpdateRevisionItem: () => {},
    onRemoveRevisionItem: () => {},
    onSubmit: () => {},
    isSubmitting: false,
};

describe('ReviewDecisionModal — DR-3 Thai copy (V2-A)', () => {
    it('renders the Thai approval title and body when reviewAction = approve', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal {...baseProps} reviewAction="approve" />,
        );
        expect(html).toContain('ยืนยันการอนุมัติเอกสาร');
        expect(html).toContain('อนุมัติเอกสาร');
        expect(html).toContain('เอกสารบังคับครบถ้วนและถูกต้อง');
        expect(html).toContain('บันทึกเพิ่มเติม (ถ้ามี)');
        expect(html).toContain('ยกเลิก');
        expect(html).toContain('ยืนยันอนุมัติ');
    });

    it('renders the Thai revision-request title and body when reviewAction = revision', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={['']}
            />,
        );
        expect(html).toContain('ขอให้แก้ไขเอกสาร');
        expect(html).toContain('คำขอการแก้ไข');
        expect(html).toContain('กรุณาระบุประเภทปัญหาและรายการที่ต้องแก้ไขให้ชัดเจน');
        expect(html).toContain('ประเภทการแก้ไข');
        expect(html).toContain('รายการที่ต้องแก้ไข');
        expect(html).toContain('เพิ่มรายการ');
        expect(html).toContain('หมายเหตุ');
        expect(html).toContain('อธิบายสิ่งที่ต้องแก้ไข');
        expect(html).toContain('ยกเลิก');
        expect(html).toContain('ส่งคำขอแก้ไข');
        expect(html).toContain('รายการที่ 1');
    });

    it('shows the Thai empty-state hint when reviewAction = revision and no items', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={[]}
            />,
        );
        expect(html).toContain('เพิ่มรายการที่ต้องแก้ไขอย่างน้อย 1 รายการ');
    });

    it('does NOT leak the legacy English copy (regression guard)', () => {
        // If a refactor accidentally re-introduces the English strings
        // we catch it here before merging.
        const approveHtml = renderToStaticMarkup(
            <ReviewDecisionModal {...baseProps} reviewAction="approve" />,
        );
        expect(approveHtml).not.toContain('Confirm document approval');
        expect(approveHtml).not.toContain('All mandatory documents');
        expect(approveHtml).not.toContain('Confirm Approval');
        expect(approveHtml).not.toContain('Cancel');
        expect(approveHtml).not.toContain('Additional note (optional)');

        const revisionHtml = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={['']}
            />,
        );
        expect(revisionHtml).not.toContain('Request revision');
        expect(revisionHtml).not.toContain('Revision Request');
        expect(revisionHtml).not.toContain('Revision category');
        expect(revisionHtml).not.toContain('Revision items');
        expect(revisionHtml).not.toContain('Add item');
        expect(revisionHtml).not.toContain('Add at least one revision item');
        expect(revisionHtml).not.toContain('Submit Revision Request');
        expect(revisionHtml).not.toContain('Explain what must be revised');
    });

    it('renders nothing when opened=false (Modal shim returns null)', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal {...baseProps} opened={false} reviewAction="approve" />,
        );
        expect(html).toBe('');
    });
});
