/**
 * x2-fix-a-modal-autofocus.test.tsx — X2-FIX-A (H-2 dropdown + M-13)
 * regression test.
 *
 * Covers:
 *   - H-2 wired through the modal: when reviewAction = 'revision',
 *     the category Select renders with Thai option labels (the
 *     `data` prop comes from REVISION_CATEGORIES).
 *   - M-13: the comment Textarea inside the modal has `autoFocus`
 *     so keyboard reviewers land on the writeable surface rather
 *     than the Cancel button (Radix Dialog's default focus target).
 *
 * Shape — SSR via renderToStaticMarkup with the same primitive shims
 * as `review-decision-modal-thai-copy.test.tsx`. The Textarea shim
 * forwards `autoFocus` onto a real <textarea> so we can assert it
 * appears in the static markup.
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

// Select shim — render the option labels into the static markup so we
// can assert H-2 reaches the modal. Mantine's `data` shape is
// `{value,label}[]`.
jest.mock('@/components/ui/select', () => ({
    Select: ({
        label,
        data,
    }: {
        label?: React.ReactNode;
        data?: Array<{ value: string; label: string }>;
        value?: string;
        onChange?: (v: string) => void;
    }) => (
        <label data-testid="select">
            {label}
            <ul data-testid="select-options">
                {(data ?? []).map((option) => (
                    <li key={option.value} data-value={option.value}>
                        {option.label}
                    </li>
                ))}
            </ul>
        </label>
    ),
}));

// Textarea shim — forward autoFocus to the underlying textarea so we
// can assert M-13 lands on the markup.
jest.mock('@/components/ui/textarea', () => ({
    Textarea: ({
        label,
        placeholder,
        autoFocus,
        'data-testid': dataTestid,
    }: {
        label?: React.ReactNode;
        placeholder?: string;
        value?: string;
        onChange?: (e: unknown) => void;
        required?: boolean;
        autoFocus?: boolean;
        'data-testid'?: string;
    }) => (
        <label data-testid="textarea">
            {label}
            <textarea
                data-testid={dataTestid ?? 'textarea-input'}
                placeholder={placeholder}
                readOnly
                {...(autoFocus ? { autoFocus: true } : {})}
            />
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

describe('X2-FIX-A H-2 (modal) — REVISION_CATEGORIES Thai options reach the dropdown', () => {
    it('renders the four Thai revision-category options inside the Select', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={['']}
            />,
        );
        expect(html).toContain('เอกสารขาด');
        expect(html).toContain('เอกสารไม่ถูกต้อง');
        expect(html).toContain('ข้อมูลไม่ตรงกัน');
        expect(html).toContain('อื่น ๆ');
    });

    it('does NOT leak the legacy English category labels', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={['']}
            />,
        );
        expect(html).not.toContain('Missing document');
        expect(html).not.toContain('Invalid document');
        expect(html).not.toContain('Data mismatch');
    });

    it('omits the Select altogether when reviewAction = approve', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal {...baseProps} reviewAction="approve" />,
        );
        // The Select renders `เอกสารขาด` only in revision mode.
        expect(html).not.toContain('เอกสารขาด');
    });
});

describe('X2-FIX-A M-13 — modal autoFocus on first input', () => {
    it('marks the comment textarea with autoFocus in approve mode', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal {...baseProps} reviewAction="approve" />,
        );
        // React serialises the boolean `autofocus` attribute as the
        // bare attribute name. Either spelling is acceptable in SSR
        // output (`autofocus` lower-case in HTML5). We match the
        // attribute on the testid-marked textarea.
        expect(html).toMatch(
            /data-testid="review-comment-textarea"[^>]*\bautofocus\b/i,
        );
    });

    it('marks the comment textarea with autoFocus in revision mode', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                reviewAction="revision"
                revisionItems={['']}
            />,
        );
        expect(html).toMatch(
            /data-testid="review-comment-textarea"[^>]*\bautofocus\b/i,
        );
    });

    it('renders nothing when the modal is closed', () => {
        const html = renderToStaticMarkup(
            <ReviewDecisionModal
                {...baseProps}
                opened={false}
                reviewAction="approve"
            />,
        );
        expect(html).toBe('');
    });
});
