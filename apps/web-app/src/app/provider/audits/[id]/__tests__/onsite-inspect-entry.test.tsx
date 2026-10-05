import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'page.tsx'), 'utf8');

describe('ONSITE tab is the inspect entry, not the broken field-tools panel', () => {
    it('links into the inspect flow', () => {
        expect(SRC).toContain('/inspect');
        expect(SRC).toMatch(/audits\/\$\{application\.id\}\/inspect/);
    });
    it('does not render AuditFieldToolsPanel in the ONSITE tab content', () => {
        // AuditFieldToolsPanel must no longer be instantiated (FK-violating photo path).
        expect(SRC).not.toContain('<AuditFieldToolsPanel');
    });
});
