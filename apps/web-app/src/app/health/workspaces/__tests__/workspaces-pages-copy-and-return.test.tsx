/**
 * Task 14 fix round 1.
 *  - Farmers never see the English word "workspace" or "พื้นที่ทำงาน" on the
 *    entity pages (list + create); the copy says นิติบุคคล / วิสาหกิจชุมชน.
 *  - Create returns to the new application with ?holder=<id> when the page was
 *    opened with ?from=application, otherwise it goes to the members page.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, beforeEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockPost = jest.fn<(url: string, body: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>>();
let mockEntities: unknown[] = [];

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
}));
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: async () => ({ success: true, data: [] }),
        post: (url: string, body: unknown) => mockPost(url, body),
    },
}));
jest.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: mockEntities, isLoading: false, error: null, refresh: mockRefresh }),
}));

import WorkspacesListPage from '../page';
import NewWorkspacePage from '../new/page';

const FORBIDDEN = /workspace|พื้นที่ทำงาน/i;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(ui: React.ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(ui); });
    return container;
}

function setValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillAndSubmit(c: HTMLElement) {
    const inputs = c.querySelectorAll('input');
    await act(async () => { setValue(inputs[0] as HTMLInputElement, 'บริษัท ทดสอบ จำกัด'); });
    await act(async () => { setValue(inputs[1] as HTMLInputElement, '0105561234560'); });
    const submit = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.startsWith('สร้าง'));
    await act(async () => { submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEntities = [];
});
afterEach(() => {
    act(() => { root?.unmount(); });
    container?.remove();
    root = null;
    container = null;
    window.history.replaceState({}, '', '/');
});

describe('entity pages: no "workspace" in what the farmer reads', () => {
    it('list page, empty state', async () => {
        const c = await mount(<WorkspacesListPage />);
        expect(c.textContent).not.toMatch(FORBIDDEN);
    });

    it('list page, with a juristic entity that has a slug', async () => {
        mockEntities = [{
            id: 'e1', type: 'JURISTIC', displayName: 'บริษัท ก จำกัด', slug: 'baan-ko', role: 'OWNER',
            membershipStatus: 'ACTIVE', isPersonal: false, organizationId: 'o1', permissions: [],
            can: { edit: true, submit: true, createFarm: true },
        }];
        const c = await mount(<WorkspacesListPage />);
        expect(c.textContent).not.toMatch(FORBIDDEN);
        expect(c.textContent).toContain('บริษัท ก จำกัด');
    });

    it('create page', async () => {
        const c = await mount(<NewWorkspacePage />);
        expect(c.textContent).not.toMatch(FORBIDDEN);
    });

    it('create page error messages (validation and API failure)', async () => {
        const c = await mount(<NewWorkspacePage />);
        const submit = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.startsWith('สร้าง'));
        await act(async () => { submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(c.textContent).not.toMatch(FORBIDDEN);

        mockPost.mockResolvedValue({ success: false });
        await fillAndSubmit(c);
        expect(c.textContent).toContain('ไม่สามารถสร้าง');
        expect(c.textContent).not.toMatch(FORBIDDEN);
    });

    it('members page and its copy helpers: no user-facing English word', () => {
        const dir = join(__dirname, '..', '[slug]', 'members');
        const copy = readFileSync(join(dir, 'personal-workspace-copy.ts'), 'utf8');
        const page = readFileSync(join(dir, 'page.tsx'), 'utf8');
        const matrix = readFileSync(join(dir, 'member-permission-matrix.tsx'), 'utf8');
        // Quoted/JSX/template text only: strip comments first.
        const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
        const literals = (s: string) => (strip(s).match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]*[ก-๙][^<>{}\n]*</g) || []).join('\n');
        const jsxText = (s: string) => (strip(s).match(/>[^<>{}]*</g) || []).join('\n');
        for (const src of [copy, page, matrix]) {
            const visible = literals(src) + '\n' + jsxText(src);
            const hits = visible.split('\n').filter((l) => FORBIDDEN.test(l) && !/^['"`]?(\.\/|\/health\/|@\/)/.test(l.trim()) && !/personal-workspace-copy|\/health\/workspaces/.test(l));
            expect(hits).toEqual([]);
        }
        expect(copy).not.toMatch(/'ผู้ขอรับรอง · Workspace'/);
    });
});

describe('entity pages: no emoji (government platform)', () => {
    const EMOJI = /\p{Extended_Pictographic}/u;

    it('list page renders no emoji, with entities and invitations metrics', async () => {
        mockEntities = [{
            id: 'e1', type: 'JURISTIC', displayName: 'บริษัท ก จำกัด', slug: 'baan-ko', role: 'OWNER',
            membershipStatus: 'ACTIVE', isPersonal: false, organizationId: 'o1', permissions: [],
            can: { edit: true, submit: true, createFarm: true },
        }];
        const c = await mount(<WorkspacesListPage />);
        expect(c.textContent).toContain('ทั้งหมด');
        expect(c.innerHTML).not.toMatch(EMOJI);
    });

    it('create page renders no emoji', async () => {
        const c = await mount(<NewWorkspacePage />);
        expect(c.innerHTML).not.toMatch(EMOJI);
    });

    it('members page, copy helper, matrix and logic sources contain no emoji', () => {
        const dir = join(__dirname, '..', '[slug]', 'members');
        for (const f of ['page.tsx', 'personal-workspace-copy.ts', 'member-permission-matrix.tsx', 'member-permission-matrix-logic.ts']) {
            expect([f, readFileSync(join(dir, f), 'utf8').match(EMOJI)?.[0] ?? null]).toEqual([f, null]);
        }
        expect(readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')).not.toMatch(EMOJI);
        expect(readFileSync(join(__dirname, '..', 'new', 'page.tsx'), 'utf8')).not.toMatch(EMOJI);
    });
});

describe('create entity: where it returns to', () => {
    it('with ?from=application goes back to the new application with the holder', async () => {
        window.history.replaceState({}, '', '/health/workspaces/new?from=application');
        mockPost.mockResolvedValue({ success: true, data: { id: 'ent 7', slug: 'abc' } });
        const c = await mount(<NewWorkspacePage />);
        await fillAndSubmit(c);
        expect(mockPost).toHaveBeenCalledWith('/entities', expect.objectContaining({ type: 'JURISTIC' }));
        expect(mockRefresh).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/health/applications/new?holder=ent%207');
    });

    it('without it goes to the new entity members page', async () => {
        mockPost.mockResolvedValue({ success: true, data: { id: 'e7', slug: 'abc' } });
        const c = await mount(<NewWorkspacePage />);
        await fillAndSubmit(c);
        expect(mockPush).toHaveBeenCalledWith('/health/workspaces/abc/members');
    });

    it('without it and without a slug goes to the list', async () => {
        mockPost.mockResolvedValue({ success: true, data: { id: 'e7', slug: null } });
        const c = await mount(<NewWorkspacePage />);
        await fillAndSubmit(c);
        expect(mockPush).toHaveBeenCalledWith('/health/workspaces');
    });
});
