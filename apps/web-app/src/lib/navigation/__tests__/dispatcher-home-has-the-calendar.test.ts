/**
 * Defect batch B item 8: the booking calendar (/provider/calendar) is where a dispatcher
 * moves an appointment, and it had no tile on the dispatcher's home. SCHEDULER_NAV carried
 * two tiles (จ่ายงานตรวจเอกสาร, จัดคิวแบ่งงาน); the calendar was reachable only from a link
 * inside another page. The route is already open to dispatcher (provider-role-config).
 */
import { SCHEDULER_NAV, getNavForRole } from '../nav-config';

describe('the dispatcher home has a way into the calendar', () => {
    it('SCHEDULER_NAV has a tile for /provider/calendar, in Thai, for the dispatcher', () => {
        const tile = SCHEDULER_NAV.find((n) => n.path === '/provider/calendar');
        expect(tile).toBeDefined();
        expect(tile?.labelTH).toMatch(/[ก-๙]/);
        expect(tile?.descTH).toMatch(/[ก-๙]/);
        expect(tile?.roles).toContain('dispatcher');
        expect(tile?.tier).toBe('primary');
    });

    it('the tile reaches the dispatcher through getNavForRole', () => {
        expect(getNavForRole('dispatcher').map((n) => n.path)).toContain('/provider/calendar');
    });

    it('the two tiles that were there stay', () => {
        const paths = SCHEDULER_NAV.map((n) => n.path);
        expect(paths).toContain('/provider/coordinator');
        expect(paths).toContain('/provider/scheduler/queue');
    });

    it('the tile uses plain Thai (no English jargon in its label)', () => {
        const tile = SCHEDULER_NAV.find((n) => n.path === '/provider/calendar');
        expect(`${tile?.labelTH} ${tile?.descTH}`).not.toMatch(/[A-Za-z]{3,}/);
    });
});
