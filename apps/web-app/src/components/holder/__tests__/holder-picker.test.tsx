/**
 * R2 Task 15 — the holder picker ("ยื่นในนาม") and the chip.
 * Strings are spec 2026-09-30-remove-workspace-mode §3.6, verbatim.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HolderPicker } from '../holder-picker';
import { HolderChip } from '../holder-chip';
import { HolderFilterChips } from '../holder-list';
import { PERSONAL, COMPANY, COMMUNITY, VIEWER, FORBIDDEN_COPY } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (el: React.ReactElement) => act(() => { root.render(el); });
const buttons = () => Array.from(container.querySelectorAll('button'));

describe('HolderPicker purpose=file', () => {
    it('prints the title, the help line, the type lines and the personal holder first', () => {
        render(<HolderPicker entities={[COMPANY, COMMUNITY, PERSONAL]} value={null} onChange={() => {}} purpose="file" />);
        const text = container.textContent ?? '';
        expect(text).toContain('ยื่นในนาม');
        expect(text).toContain('ใบรับรองจะออกในนามที่คุณเลือก และเปลี่ยนภายหลังไม่ได้');
        expect(text).toContain('ตัวคุณเอง (บุคคลธรรมดา)');
        expect(text).toContain('นิติบุคคล');
        expect(text).toContain('วิสาหกิจชุมชน');
        const names = buttons().map((b) => b.textContent ?? '');
        expect(names[0]).toContain('สมชาย ใจดี');
    });

    it('calls onChange with the entity id when a card is pressed, and marks the chosen one', () => {
        const onChange = jest.fn();
        render(<HolderPicker entities={[PERSONAL, COMPANY, COMMUNITY]} value="e-company" onChange={onChange} purpose="file" />);
        const company = buttons().find((b) => (b.textContent ?? '').includes('บริษัท สมุนไพรไทย'))!;
        expect(company.getAttribute('aria-pressed')).toBe('true');
        act(() => { buttons().find((b) => (b.textContent ?? '').includes('วิสาหกิจชุมชนบ้านสวน'))!.click(); });
        expect(onChange).toHaveBeenCalledWith('e-community');
    });

    it('exactly one editable entity: a fact line, no choice', () => {
        render(<HolderPicker entities={[PERSONAL]} value={null} onChange={() => {}} purpose="file" />);
        expect(container.textContent).toContain('ยื่นในนาม สมชาย ใจดี · ใบรับรองจะออกในนามนี้');
        expect(container.querySelectorAll('button').length).toBe(0);
    });

    it('edit but no submit: says who must press submit', () => {
        render(<HolderPicker entities={[PERSONAL, COMMUNITY]} value={null} onChange={() => {}} purpose="file" />);
        expect(container.textContent).toContain('คุณกรอกคำขอในนามนี้ได้ แต่ผู้มีสิทธิ์ยื่นต้องเป็นผู้กดยื่น');
    });

    it('a VIEWER card is disabled and says why', () => {
        const onChange = jest.fn();
        render(<HolderPicker entities={[PERSONAL, COMPANY, VIEWER]} value={null} onChange={onChange} purpose="file" />);
        const viewer = buttons().find((b) => (b.textContent ?? '').includes('ห้างหุ้นส่วนดูอย่างเดียว'))!;
        expect(viewer.disabled).toBe(true);
        expect(viewer.textContent).toContain('คุณมีสิทธิ์ดูอย่างเดียวในนามนี้');
        act(() => { viewer.click(); });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('links to the create page and asks it to come back to the application', () => {
        render(<HolderPicker entities={[PERSONAL]} value={null} onChange={() => {}} purpose="file" />);
        const link = container.querySelector('a')!;
        expect(link.textContent).toContain('เพิ่มนิติบุคคลหรือวิสาหกิจชุมชน');
        expect(link.getAttribute('href')).toBe('/health/workspaces/new?from=application');
    });

    it('never offers a pending or revoked membership', () => {
        render(<HolderPicker
            entities={[PERSONAL, { ...COMPANY, membershipStatus: 'PENDING', can: { edit: false, submit: false, createFarm: false } }]}
            value={null} onChange={() => {}} purpose="file"
        />);
        expect(container.textContent).not.toContain('บริษัท สมุนไพรไทย');
    });

    it('prints no workspace word and no emoji, in any state', () => {
        const states = [
            [PERSONAL],
            [PERSONAL, COMPANY, COMMUNITY, VIEWER],
        ];
        for (const entities of states) {
            render(<HolderPicker entities={entities} value="e-company" onChange={() => {}} purpose="file" />);
            expect(container.textContent).not.toMatch(FORBIDDEN_COPY);
        }
    });
});

describe('HolderPicker purpose=farm', () => {
    it('offers only the holders that may create a farm', () => {
        render(<HolderPicker entities={[PERSONAL, COMPANY, COMMUNITY]} value={null} onChange={() => {}} purpose="farm" />);
        const byName = (n: string) => buttons().find((b) => (b.textContent ?? '').includes(n))!;
        expect(byName('บริษัท สมุนไพรไทย').disabled).toBe(false);
        expect(byName('วิสาหกิจชุมชนบ้านสวน').disabled).toBe(true);
        expect(byName('วิสาหกิจชุมชนบ้านสวน').textContent).toContain('คุณไม่มีสิทธิ์เพิ่มสถานที่ปลูกในนามนี้');
        expect(container.textContent).not.toMatch(FORBIDDEN_COPY);
    });
});

describe('HolderChip (steps 2 to 6)', () => {
    it('names the holder, warns how to fix a wrong choice, and offers no change control', () => {
        render(<HolderChip displayName="บริษัท สมุนไพรไทย จำกัด" onRestart={async () => {}} />);
        const text = container.textContent ?? '';
        expect(text).toContain('ยื่นในนาม บริษัท สมุนไพรไทย จำกัด');
        expect(text).toContain('ถ้าเลือกผิด ให้ลบฉบับร่างนี้แล้วเริ่มคำขอใหม่');
        expect(text).not.toMatch(FORBIDDEN_COPY);
        expect(text).not.toMatch(/เปลี่ยน(ผู้|ในนาม)/);
    });

    it('delete-and-restart asks to confirm, then runs onRestart once', async () => {
        const onRestart = jest.fn(async () => {});
        render(<HolderChip displayName="บริษัท สมุนไพรไทย จำกัด" onRestart={onRestart} />);
        const first = buttons().find((b) => (b.textContent ?? '').includes('ลบฉบับร่างนี้แล้วเริ่มใหม่'))!;
        act(() => { first.click(); });
        expect(onRestart).not.toHaveBeenCalled();
        const confirm = buttons().find((b) => (b.textContent ?? '').includes('ยืนยันลบฉบับร่าง'))!;
        await act(async () => { confirm.click(); });
        expect(onRestart).toHaveBeenCalledTimes(1);
    });
});

describe('HolderFilterChips', () => {
    it('appear only with more than one entity', () => {
        render(<HolderFilterChips entities={[PERSONAL]} selectedId={null} onSelect={() => {}} />);
        expect(container.textContent).toBe('');
        render(<HolderFilterChips entities={[PERSONAL, COMPANY]} selectedId={null} onSelect={() => {}} />);
        const labels = buttons().map((b) => b.textContent);
        expect(labels).toEqual(['ทั้งหมด', 'สมชาย ใจดี', 'บริษัท สมุนไพรไทย จำกัด']);
        expect(container.textContent).not.toMatch(FORBIDDEN_COPY);
    });

    it('pressing a chip selects that entity, ทั้งหมด clears it', () => {
        const onSelect = jest.fn();
        render(<HolderFilterChips entities={[PERSONAL, COMPANY]} selectedId="e-company" onSelect={onSelect} />);
        act(() => { buttons()[0]!.click(); });
        expect(onSelect).toHaveBeenCalledWith(null);
        act(() => { buttons()[1]!.click(); });
        expect(onSelect).toHaveBeenCalledWith('e-personal');
    });
});
