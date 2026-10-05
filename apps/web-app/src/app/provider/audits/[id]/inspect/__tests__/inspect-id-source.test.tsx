import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const CLIENT = fs.readFileSync(path.resolve(__dirname, '..', 'client-view.tsx'), 'utf8');
const PAGE = fs.readFileSync(path.resolve(__dirname, '..', 'page.tsx'), 'utf8');

describe('inspect uses ctx.audit.id for writes, applicationId for context', () => {
    it('page passes applicationId (not auditId)', () => {
        expect(PAGE).toContain('applicationId={id}');
    });
    it('client resolves auditId from context, not the route prop', () => {
        expect(CLIENT).toMatch(/const\s+auditId\s*=\s*context[?.]+audit[?.]+id/);
        // the route prop is applicationId, only used for the context fetch
        expect(CLIENT).toContain('getOnsiteContext(applicationId)');
    });
});
