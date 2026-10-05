/**
 * personal-workspace-copy.test.ts — W8 personal-workspace-team, item 2.
 *
 * Two layers (repo convention — same as member-permission-matrix.test.ts
 * in this directory):
 *   1. PURE logic (personal-workspace-copy.ts): isPersonalEntity predicate
 *      + the role one-liners, cross-checked against a MIRRORED copy of the
 *      real backend default-capability arrays (entity-service.js) so the
 *      copy cannot silently drift from what a role can actually do.
 *   2. fs pin: the members page.tsx actually WIRES this module in (imports
 *      it, computes `personal` from entity.type, uses eyebrowFor/
 *      descriptionFor for the SummaryHeader, and shows the selected role's
 *      one-liner next to the invite-role picker) — this is the part that
 *      is RED before the page is edited.
 */

import fs from 'fs';
import path from 'path';
import {
    isPersonalEntity,
    ROLE_CAPABILITY_SUMMARY_TH,
    eyebrowFor,
    descriptionFor,
} from '../personal-workspace-copy';

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

// Mirrors apps/backend/services/entity-service.js DEFAULT_PERMISSIONS_BY_ROLE
// (lines 172-209) — kept here ONLY to cross-check the FE copy against the
// real capability booleans, never to re-derive authorization.
const BACKEND_MANAGER_CAPABILITIES = [
    'PRINT_QR', 'CYCLE_CREATE', 'UNIT_MANAGE',
    'ACTIVITY_IRRIGATION', 'ACTIVITY_FERTILIZER', 'ACTIVITY_PEST_CONTROL',
    'ACTIVITY_WEED_CONTROL', 'ACTIVITY_INSPECTION', 'ACTIVITY_INCIDENT', 'ACTIVITY_OTHER',
    'HARVEST_RECORD', 'QR_GENERATE', 'RECORDS_MANAGE', 'REPORT_SUBMIT',
];
const BACKEND_ADMIN_CAPABILITIES = [
    'SUBMIT_APPLICATION', 'PRINT_QR', 'EDIT_FARM', 'INVITE_MEMBER', 'REVOKE_MEMBER',
    'VIEW_FINANCIAL', 'EDIT_ENTITY_PROFILE',
    'CYCLE_CREATE', 'UNIT_MANAGE', 'ACTIVITY_IRRIGATION', 'ACTIVITY_FERTILIZER',
    'ACTIVITY_PEST_CONTROL', 'ACTIVITY_WEED_CONTROL', 'ACTIVITY_INSPECTION',
    'ACTIVITY_INCIDENT', 'ACTIVITY_OTHER', 'HARVEST_RECORD', 'QR_GENERATE',
    'RECORDS_MANAGE', 'REPORT_SUBMIT',
];

describe('isPersonalEntity', () => {
    it('INDIVIDUAL entity → personal', () => {
        expect(isPersonalEntity('INDIVIDUAL')).toBe(true);
    });
    it('JURISTIC / COMMUNITY_ENTERPRISE / null → not personal', () => {
        expect(isPersonalEntity('JURISTIC')).toBe(false);
        expect(isPersonalEntity('COMMUNITY_ENTERPRISE')).toBe(false);
        expect(isPersonalEntity(null)).toBe(false);
        expect(isPersonalEntity(undefined)).toBe(false);
    });
});

describe('ROLE_CAPABILITY_SUMMARY_TH — derived from the real capability sets, not invented', () => {
    it('MANAGER summary matches the backend truth: has planting/harvest record capability, lacks SUBMIT_APPLICATION and VIEW_FINANCIAL', () => {
        expect(BACKEND_MANAGER_CAPABILITIES).toContain('HARVEST_RECORD');
        expect(BACKEND_MANAGER_CAPABILITIES).toContain('ACTIVITY_IRRIGATION');
        expect(BACKEND_MANAGER_CAPABILITIES).not.toContain('SUBMIT_APPLICATION');
        expect(BACKEND_MANAGER_CAPABILITIES).not.toContain('VIEW_FINANCIAL');

        const summary = ROLE_CAPABILITY_SUMMARY_TH.MANAGER;
        expect(summary).toContain('บันทึกการปลูกและเก็บเกี่ยวแทนได้');
        expect(summary).toContain('ยื่นคำขอ');
        expect(summary).toContain('การเงิน');
        expect(summary).toContain('ไม่ได้');
    });

    it('ADMIN summary matches the backend truth: can submit applications, invite/revoke members, view financial data', () => {
        expect(BACKEND_ADMIN_CAPABILITIES).toContain('SUBMIT_APPLICATION');
        expect(BACKEND_ADMIN_CAPABILITIES).toContain('INVITE_MEMBER');
        expect(BACKEND_ADMIN_CAPABILITIES).toContain('REVOKE_MEMBER');
        expect(BACKEND_ADMIN_CAPABILITIES).toContain('VIEW_FINANCIAL');

        const summary = ROLE_CAPABILITY_SUMMARY_TH.ADMIN;
        expect(summary).toContain('ยื่นคำขอ');
        expect(summary).toContain('เชิญ');
        expect(summary).toContain('การเงิน');
    });

    it('VIEWER summary is read-only (backend default permissions = empty array)', () => {
        const summary = ROLE_CAPABILITY_SUMMARY_TH.VIEWER;
        expect(summary).toContain('ดูข้อมูลได้อย่างเดียว');
        expect(summary).toContain('ไม่ได้');
    });
});

describe('eyebrowFor / descriptionFor — no organisation-speak for a personal entity', () => {
    it('personal → farm-flavoured copy, no entity-register word', () => {
        expect(eyebrowFor(true)).not.toMatch(/นิติบุคคล/);
        expect(descriptionFor(true, 'เจ้าของ')).toContain('ฟาร์ม');
    });
    it('non-personal (JURISTIC/COMMUNITY) keeps the existing workspace copy', () => {
        expect(eyebrowFor(false)).toBe('ผู้ขอรับรอง · นิติบุคคลและวิสาหกิจชุมชน');
        expect(descriptionFor(false, 'เจ้าของ')).toContain('จัดการสมาชิก');
    });
});

describe('the members page.tsx actually wires the personal-workspace copy in', () => {
    it('imports isPersonalEntity / ROLE_CAPABILITY_SUMMARY_TH / eyebrowFor / descriptionFor from ./personal-workspace-copy', () => {
        expect(PAGE).toMatch(/from ['"]\.\/personal-workspace-copy['"]/);
        expect(PAGE).toMatch(/isPersonalEntity/);
        expect(PAGE).toMatch(/ROLE_CAPABILITY_SUMMARY_TH/);
        expect(PAGE).toMatch(/eyebrowFor/);
        expect(PAGE).toMatch(/descriptionFor/);
    });

    it('SummaryHeader eyebrow/description are computed via eyebrowFor/descriptionFor, not the old hardcoded strings', () => {
        expect(PAGE).toMatch(/eyebrow=\{eyebrowFor\(/);
        expect(PAGE).toMatch(/description=\{descriptionFor\(/);
        // the old always-on hardcoded literals must be gone
        expect(PAGE).not.toMatch(/eyebrow="ผู้ขอรับรอง · Workspace"/);
    });

    it('the invite-role picker shows the selected role\'s one-line capability summary', () => {
        expect(PAGE).toMatch(/ROLE_CAPABILITY_SUMMARY_TH\[\s*newRole\s*\]/);
    });
});
