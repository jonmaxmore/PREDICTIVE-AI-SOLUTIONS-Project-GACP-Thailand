/**
 * ChecklistItem.test.tsx — Iter 25 step 7 component smoke test.
 *
 * Mirrors the repo convention of SSR-only assertions (see
 * `Footer.test.tsx`) — no jsdom DOM events, just markup checks. This
 * keeps the test cheap to run and avoids the radix-ui / portal
 * machinery that needs a full DOM.
 *
 * What we assert:
 *   1. The three answer buttons render with Thai labels.
 *   2. The required marker shows when `required` is true.
 *   3. The photo button uses `capture="environment"` so we get the
 *      native rear-camera intent on mobile devices.
 *   4. The photos list shows the count + each entry.
 */

import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChecklistItem, type ChecklistItemValue } from '../ChecklistItem';

const emptyValue: ChecklistItemValue = { answer: null, notes: '', photos: [] };

describe('ChecklistItem (Iter 25)', () => {
    it('renders all three Thai answer options', () => {
        const html = renderToStaticMarkup(
            <ChecklistItem
                itemId="g1"
                index={1}
                title="การใช้สารเคมีเกษตร"
                description="ไม่มีการใช้สารเคมีต้องห้าม"
                value={emptyValue}
                onChange={() => {}}
                onPhotoCapture={() => {}}
            />,
        );
        expect(html).toContain('ใช่');
        expect(html).toContain('ไม่ใช่');
        expect(html).toContain('ไม่เกี่ยวข้อง');
    });

    it('shows a "จำเป็น" marker when required', () => {
        const html = renderToStaticMarkup(
            <ChecklistItem
                itemId="g1"
                index={1}
                title="x"
                description="y"
                required
                value={emptyValue}
                onChange={() => {}}
                onPhotoCapture={() => {}}
            />,
        );
        expect(html).toMatch(/จำเป็น/);
    });

    it('exposes the native camera intent via capture="environment"', () => {
        const html = renderToStaticMarkup(
            <ChecklistItem
                itemId="g1"
                index={1}
                title="x"
                description="y"
                value={emptyValue}
                onChange={() => {}}
                onPhotoCapture={() => {}}
            />,
        );
        // Both `capture="environment"` and `accept="image/*"` must be
        // present on the underlying file input or mobile devices
        // won't open the back camera directly.
        expect(html).toContain('capture="environment"');
        expect(html).toContain('accept="image/*"');
    });

    it('renders the photo count and listed photos', () => {
        const html = renderToStaticMarkup(
            <ChecklistItem
                itemId="g1"
                index={1}
                title="x"
                description="y"
                value={{
                    answer: 'YES',
                    notes: '',
                    photos: [
                        { id: 'p1', name: 'farm-1.jpg' },
                        { id: 'p2', name: 'farm-2.jpg' },
                    ],
                }}
                onChange={() => {}}
                onPhotoCapture={() => {}}
            />,
        );
        expect(html).toContain('ภาพถ่ายหลักฐาน (2)');
        expect(html).toContain('farm-1.jpg');
        expect(html).toContain('farm-2.jpg');
    });

    it('renders the index badge from the prop', () => {
        const html = renderToStaticMarkup(
            <ChecklistItem
                itemId="g1"
                index={7}
                title="x"
                description="y"
                value={emptyValue}
                onChange={() => {}}
                onPhotoCapture={() => {}}
            />,
        );
        expect(html).toContain('>7<');
    });
});
