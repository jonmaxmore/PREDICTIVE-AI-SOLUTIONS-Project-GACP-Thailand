/**
 * Defect batch B item 2 (+ the calendar's share of item 8) — the calendar must not steer a
 * dispatcher into an audit that can never lead to a certificate.
 *
 *   - the form defaulted to ONLINE_MEET, which arms no evidence chain (backend
 *     services/audit/arm-onsite-evidence.js), so the default produced a booking with no path
 *     to a certificate; it now defaults to ONSITE;
 *   - choosing ONLINE_MEET says so in Thai, before saving;
 *   - the backend answers every booking with `canLeadToCertificate` and `evidenceNote`, and no
 *     web code read either key; after saving, the note is shown, in a banner that stays until
 *     dismissed (a toast that vanishes in seconds is how this went unseen);
 *   - the mode labels and queue statuses are plain Thai, not "ONLINE_MEET" / "รอ CAR".
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/lib/api', () => ({
    apiClient: {
        get: (...a: unknown[]) => mockGet(...a),
        post: (...a: unknown[]) => mockPost(...a),
    },
}));
jest.mock('@/lib/notifications', () => ({ notifications: { show: jest.fn() } }));
jest.mock('../../components/provider-layout', () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    return { useRouter: () => router, usePathname: () => '/provider/calendar', useSearchParams: () => new URLSearchParams() };
});

import Page from '../client-view';
import { ScheduleModal } from '../schedule-modal';

const FUTURE = new Date(Date.now() + 10 * 86400000).toISOString();

function dashboard(items: Array<Record<string, unknown>>, bucket: 'readyToSchedule' | 'scheduledUpcoming') {
    const empty = { total: 0, items: [] };
    return {
        queues: { readyToSchedule: empty, scheduledUpcoming: empty, rescheduleRequired: empty, [bucket]: { total: items.length, items } },
        calendar: { events: [] },
        kpi: { scheduledToday: 0, scheduledThisWeek: 0, pendingScheduling: items.length, rescheduleBacklog: 0, onlineVsOnsite: { online: 0, onsite: 0, ratio: 0 } },
    };
}
const ITEM = {
    id: 'a1', applicationId: 'a1', applicationNumber: 'GACP-2569-0001', applicantName: 'สมชาย', status: 'AUDIT_FEE_PAID',
    workflowState: 'AUDIT_FEE_PAID', phase2Paid: true, receiptIssued: true, auditorId: null, auditorName: null,
    scheduledDate: null, inspectionMode: 'ONSITE', meetingLink: null, mapLink: null, location: null, notes: null,
    estimatedDuration: 120, isRescheduleRequired: false, overdueDays: 0,
};

let container: HTMLDivElement;
let root: Root;

async function flush(rounds = 10) {
    for (let i = 0; i < rounds; i += 1) { await act(async () => { await Promise.resolve(); }); }
}
function textOf(node: ParentNode = document.body) { return node.textContent || ''; }
function buttonByText(label: string, exact = false): HTMLButtonElement {
    const found = Array.from(document.body.querySelectorAll('button')).find((b) => (exact
        ? (b.textContent || '').trim() === label
        : (b.textContent || '').includes(label)));
    if (!found) { throw new Error(`no button "${label}" in: ${textOf().slice(0, 400)}`); }
    return found as HTMLButtonElement;
}

beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

async function mountWith(items: Array<Record<string, unknown>>, bucket: 'readyToSchedule' | 'scheduledUpcoming') {
    mockGet.mockImplementation(async (url: unknown) => {
        const u = String(url);
        if (u.includes('auditors')) { return { success: true, data: [{ id: 'insp-1', fullName: 'ผู้ตรวจ หนึ่ง', providerId: 'P1' }] }; }
        return { success: true, data: dashboard(items, bucket) };
    });
    await act(async () => { root.render(<Page />); });
    await flush();
}

describe('the form defaults to a visit that can lead to a certificate', () => {
    it('a new booking opens on the on-site fields (map link / place), not the meeting-link field', async () => {
        await mountWith([ITEM], 'readyToSchedule');
        await act(async () => { buttonByText('จัดคู่นัดตรวจ').click(); });
        await flush();
        const body = textOf();
        expect(body).toContain('ลิงก์แผนที่');
        expect(body).not.toContain('ลิงก์การประชุม');
    });

    it('the source default is ONSITE (initial state and the fallback when an item carries no mode)', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'client-view.tsx'), 'utf8') as string;
        expect(src).toMatch(/useState<"ONLINE_MEET" \| "ONSITE">\("ONSITE"\)/);
        expect(src).not.toMatch(/item\.inspectionMode \|\| "ONLINE_MEET"/);
    });
});

describe('choosing ONLINE_MEET is warned about, in Thai, before saving', () => {
    const props = {
        opened: true, setOpened: () => undefined, selectedItem: ITEM as never, scheduleDate: new Date(), setScheduleDate: () => undefined,
        scheduleTime: '09:00', setScheduleTime: () => undefined, auditorId: 'insp-1', setAuditorId: () => undefined,
        auditorOptions: [{ value: 'insp-1', label: 'ผู้ตรวจ หนึ่ง' }], setInspectionMode: () => undefined,
        meetingLink: '', setMeetingLink: () => undefined, mapLink: '', setMapLink: () => undefined, location: '', setLocation: () => undefined,
        notes: '', setNotes: () => undefined, estimatedDuration: 120, setEstimatedDuration: () => undefined, submitSchedule: () => undefined, isSubmitting: false,
    };

    it('online: a visible warning that no certificate can follow', async () => {
        await act(async () => { root.render(<ScheduleModal {...props} inspectionMode="ONLINE_MEET" />); });
        await flush();
        const warning = document.body.querySelector('[data-testid="online-meet-warning"]');
        expect(warning).not.toBeNull();
        expect(textOf(warning as Element)).toContain('ออกใบรับรอง');
        expect(warning?.getAttribute('role')).toBe('alert');
    });

    it('on-site: no warning', async () => {
        await act(async () => { root.render(<ScheduleModal {...props} inspectionMode="ONSITE" />); });
        await flush();
        expect(document.body.querySelector('[data-testid="online-meet-warning"]')).toBeNull();
    });

    it('the mode choices are plain Thai, with no enum names', async () => {
        await act(async () => { root.render(<ScheduleModal {...props} inspectionMode="ONSITE" />); });
        await flush();
        expect(textOf()).not.toMatch(/ONLINE_MEET|ONSITE/);
    });
});

describe("the backend's answer is shown", () => {
    const NOTE = 'การตรวจแบบ ONLINE_MEET ไม่สร้างหลักฐานการลงพื้นที่ จึงออกใบรับรองจากการตรวจครั้งนี้ไม่ได้ ต้องนัดตรวจแบบลงพื้นที่ (ONSITE)';
    const SCHEDULED = {
        ...ITEM, status: 'AUDIT_CONFIRMED', workflowState: 'AUDIT_CONFIRMED', auditorId: 'insp-1', auditorName: 'ผู้ตรวจ หนึ่ง',
        scheduledDate: FUTURE, inspectionMode: 'ONLINE_MEET', meetingLink: 'https://meet.example/x',
    };

    async function saveReschedule(responseData: Record<string, unknown>) {
        mockPost.mockResolvedValue({ success: true, data: responseData });
        await mountWith([SCHEDULED], 'scheduledUpcoming');
        // Radix tabs activate on mousedown, not click.
        await act(async () => { buttonByText('นัดแล้ว').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
        await flush();
        await act(async () => { buttonByText('เลื่อนนัด', true).click(); });
        await flush();
        await act(async () => { buttonByText('บันทึกนัดหมาย').click(); });
        await flush();
    }

    it('canLeadToCertificate:false puts evidenceNote on the page in a banner that stays', async () => {
        await saveReschedule({ canLeadToCertificate: false, evidenceNote: NOTE });
        expect(mockPost).toHaveBeenCalledTimes(1);
        const banner = document.body.querySelector('[data-testid="schedule-evidence-warning"]');
        expect(banner).not.toBeNull();
        expect(textOf(banner as Element)).toContain('ออกใบรับรองจากการตรวจครั้งนี้ไม่ได้');
        expect(banner?.getAttribute('role')).toBe('alert');
    });

    it('canLeadToCertificate:true shows no warning', async () => {
        await saveReschedule({ canLeadToCertificate: true, evidenceNote: null });
        expect(document.body.querySelector('[data-testid="schedule-evidence-warning"]')).toBeNull();
    });
});

describe('plain Thai in the queue statuses this screen shows', () => {
    it('no "CAR" jargon in the status labels', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getStatusLabel } = require('@/lib/constants/workflow-states') as { getStatusLabel: (s: string) => string };
        expect(getStatusLabel('CAR_PENDING')).not.toMatch(/CAR/);
        expect(getStatusLabel('CAR_REVIEWING')).not.toMatch(/CAR/);
    });
});
