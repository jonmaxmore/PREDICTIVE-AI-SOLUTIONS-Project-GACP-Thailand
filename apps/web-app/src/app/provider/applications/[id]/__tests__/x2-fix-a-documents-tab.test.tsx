/**
 * x2-fix-a-documents-tab.test.tsx — X2-FIX-A (H-3) wiring test.
 *
 * Locks the contract that the DOCUMENT_FIELDS Thai names actually
 * surface in the Documents tab rendered markup. The config-level
 * test in `x2-fix-a-detail-config.test.tsx` validates the source of
 * truth; this test confirms the tab consumes it correctly so a
 * future refactor of the tab cannot silently regress to a hard-coded
 * English list.
 *
 * Shape — SSR via renderToStaticMarkup with shims for the primitives
 * (Card / Badge / Button / Dialog / lucide icons). Mirrors the
 * approach used by review-decision-modal-thai-copy.test.tsx.
 */

import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/components/ui/primitives/badge', () => ({
    Badge: ({ children }: { children?: React.ReactNode }) => (
        <span data-testid="badge">{children}</span>
    ),
}));

jest.mock('@/components/ui/primitives/button', () => ({
    Button: ({
        children,
        asChild: _asChild,
    }: {
        children?: React.ReactNode;
        asChild?: boolean;
        onClick?: () => void;
        size?: string;
        variant?: string;
        className?: string;
    }) => <button data-testid="button">{children}</button>,
}));

jest.mock('@/components/ui/primitives/card', () => ({
    Card: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="card">{children}</div>
    ),
    CardContent: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="card-content">{children}</div>
    ),
    CardHeader: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="card-header">{children}</div>
    ),
    CardTitle: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="card-title">{children}</div>
    ),
}));

jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="dialog">{children}</div>
    ),
    DialogContent: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="dialog-content">{children}</div>
    ),
    DialogDescription: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="dialog-description">{children}</div>
    ),
    DialogHeader: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="dialog-header">{children}</div>
    ),
    DialogTitle: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="dialog-title">{children}</div>
    ),
}));

jest.mock('lucide-react', () => ({
    CheckCircle2: () => <span data-testid="i-check" />,
    Eye: () => <span data-testid="i-eye" />,
    ExternalLink: () => <span data-testid="i-link" />,
    FileText: () => <span data-testid="i-file" />,
    Unlock: () => <span data-testid="i-unlock" />,
    X: () => <span data-testid="i-x" />,
}));

import { DocumentsTabPanel } from '../documents-tab-panel';

describe('X2-FIX-A H-3 — Documents tab renders DOCUMENT_FIELDS Thai names', () => {
    it('renders the canonical Thai checklist entries', () => {
        const html = renderToStaticMarkup(
            <DocumentsTabPanel formData={{}} revisionRequest={null} />,
        );
        // Smoke a handful of well-known Thai document names. The full
        // 14-entry list is locked by the config-level test.
        expect(html).toContain('บัตรประจำตัวประชาชน');
        expect(html).toContain('ทะเบียนบ้าน');
        expect(html).toContain('หนังสือรับรองประวัติอาชญากรรม');
        expect(html).toContain('ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 11)');
        expect(html).toContain('ใบประกาศนียบัตรอบรม GACP');
    });

    it('does NOT leak the legacy English document names', () => {
        const html = renderToStaticMarkup(
            <DocumentsTabPanel formData={{}} revisionRequest={null} />,
        );
        expect(html).not.toContain('Citizen ID');
        expect(html).not.toContain('House Registration');
        expect(html).not.toContain('Criminal Record Check');
        expect(html).not.toContain('PT.11 License');
        expect(html).not.toContain('GACP Training Certificate');
    });
});
