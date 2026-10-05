/**
 * entity-switcher-workspace-identity.test.tsx
 *
 * reports/design-cleanup-2026-08-21/01-IDENTITY-AND-VOCABULARY.md U3 + U4.
 *
 * U3 — the header chip showed only the entity display name next to the
 * user's own name in the avatar dropdown, with nothing telling the farmer
 * which one is "the workspace you're submitting as". The only explanation
 * lived in a `title=` attribute (hover-only, invisible on touch).
 *
 * U4 — when `/entities/mine` fails, the chip fell back to a vague
 * "ไม่มีพื้นที่ใช้งาน" (no workspace) with no way to tell "load failed" from
 * "you truly have zero workspaces" (impossible per the Phase-68 invariant:
 * every health user gets a personal INDIVIDUAL entity), and no retry.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockRouter = { refresh: jest.fn(), push: jest.fn() };

jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    usePathname: () => '/health/home',
}));

const mockUseActiveEntity = jest.fn();
jest.mock('@/lib/services/active-entity-provider', () => ({
    useActiveEntity: (...args: unknown[]) => mockUseActiveEntity(...args),
}));

import { EntitySwitcher } from '../entity-switcher';

const PERSONAL_ENTITY = {
    id: 'ent-personal',
    type: 'INDIVIDUAL' as const,
    displayName: 'สมชาย ใจดี',
    slug: 'somchai',
    role: 'OWNER' as const,
    membershipStatus: 'ACTIVE' as const,
    isPersonal: true,
    organizationId: 'org-1',
    permissions: [],
};

describe('EntitySwitcher — workspace identity (U3) + honest load failure (U4)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root!.render(<EntitySwitcher />);
        });
    }

    it('U3: labels the chip so the workspace identity reads at a glance (not just a bare name)', () => {
        mockUseActiveEntity.mockReturnValue({
            entities: [PERSONAL_ENTITY],
            activeEntity: PERSONAL_ENTITY,
            isLoading: false,
            setActiveEntity: jest.fn(),
            refresh: jest.fn(),
        });

        mount();

        const button = container!.querySelector('button[aria-haspopup], button');
        expect(button).not.toBeNull();
        // The rendered text must say WHICH thing the entity name is — not just
        // float the name next to the user's own name with zero label.
        expect(container!.textContent).toContain('ยื่นในนาม');
        expect(container!.textContent).toContain(PERSONAL_ENTITY.displayName);
    });

    it('U4: shows an honest "load failed" state (not the generic empty-workspace copy) when /entities/mine came back empty after loading', () => {
        // Per the Phase-68 invariant every health user has a personal
        // INDIVIDUAL entity — entities=[] after isLoading resolves to false
        // can only mean the fetch failed, never a genuine empty state.
        const refresh = jest.fn();
        mockUseActiveEntity.mockReturnValue({
            entities: [],
            activeEntity: null,
            isLoading: false,
            setActiveEntity: jest.fn(),
            refresh,
        });

        mount();

        // Must NOT claim there is definitively no workspace (that's false —
        // the invariant guarantees one exists; this is a load failure).
        expect(container!.textContent).not.toContain('ไม่มีพื้นที่ใช้งาน');
        // Must state cause + retry per repo Thai-copy rules.
        expect(container!.textContent).toContain('โหลดพื้นที่ทำงานไม่สำเร็จ');
        const retryButton = container!.querySelector('button[data-testid="entity-switcher-retry"]');
        expect(retryButton).not.toBeNull();

        act(() => {
            retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
