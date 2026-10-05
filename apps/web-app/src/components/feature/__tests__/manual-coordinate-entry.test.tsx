/**
 * manual-coordinate-entry.test.tsx
 *
 * Why this component exists at all.
 *
 * The farm-location wizard step requires GPS coordinates before an applicant
 * can continue, and until now the only two ways to supply them were the
 * click-on-a-map modal and the device's own geolocation. Removing the foreign
 * tile source means the map does not render unless an in-country tile server
 * is configured — which would have left an applicant filling the form at a
 * desk with no way to enter a location at all, and therefore no way to finish
 * their application. A privacy fix that quietly blocks certification is not a
 * fix.
 *
 * So the fail-closed map state ships with a way in: type the numbers. This
 * mirrors the Flutter picker (map_picker_screen.dart), which offers the same
 * fields under the same condition — the two platforms must not disagree about
 * how an applicant records a farm location.
 *
 * Validation is deliberately about *Thailand*, not about latitude/longitude in
 * general: a transposed pair (100.5, 13.7) is a syntactically valid coordinate
 * off the coast of Somalia, and silently accepting it would attach a wrong
 * location to a real certification — and to the audit that follows it. Bounds
 * catch that class of typo at the point of entry.
 *
 * Pattern: pure-function assertions for the logic + `renderToStaticMarkup`
 * for the markup contract, matching this repo's component-test idiom (no
 * @testing-library/react in the toolchain — see
 * `decision-buttons-mobile.test.tsx`).
 */

import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ManualCoordinateEntry, checkThaiCoordinates } from '../manual-coordinate-entry';

describe('checkThaiCoordinates', () => {
    it('accepts a coordinate pair inside Thailand', () => {
        expect(checkThaiCoordinates('13.756300', '100.501800')).toEqual({
            status: 'ok',
            lat: '13.756300',
            lng: '100.501800',
        });
    });

    it('accepts the far north and the far south of the country', () => {
        expect(checkThaiCoordinates('20.4', '99.9').status).toBe('ok');   // Chiang Rai
        expect(checkThaiCoordinates('5.7', '100.6').status).toBe('ok');   // Betong, Yala
    });

    it('reports incomplete while only one field has been filled', () => {
        // Nagging mid-typing trains people to ignore the message that matters.
        expect(checkThaiCoordinates('13.7', '')).toEqual({ status: 'incomplete' });
        expect(checkThaiCoordinates('', '100.5')).toEqual({ status: 'incomplete' });
        expect(checkThaiCoordinates('', '')).toEqual({ status: 'incomplete' });
    });

    it('rejects text that is not a number, in Thai', () => {
        const result = checkThaiCoordinates('ก', '100.5');
        expect(result.status).toBe('invalid');
        expect(result.status === 'invalid' && result.message).toMatch('ตัวเลข');
    });

    it('rejects a coordinate outside Thailand, in Thai', () => {
        const result = checkThaiCoordinates('13.7563', '-70.5');
        expect(result.status).toBe('invalid');
        expect(result.status === 'invalid' && result.message).toMatch('นอกขอบเขตประเทศไทย');
    });

    it('catches a transposed pair — the typo that would record the wrong farm', () => {
        // 100.5, 13.75: both are valid numbers, the order is wrong, and the
        // point lands in the Indian Ocean.
        expect(checkThaiCoordinates('100.5018', '13.7563').status).toBe('invalid');
    });

    it('rejects Infinity and other non-finite input', () => {
        expect(checkThaiCoordinates('Infinity', '100.5').status).toBe('invalid');
        expect(checkThaiCoordinates('13.7', 'NaN').status).toBe('invalid');
    });

    it('tolerates surrounding whitespace from a paste', () => {
        expect(checkThaiCoordinates('  13.7563 ', ' 100.5018  ').status).toBe('ok');
    });
});

describe('ManualCoordinateEntry markup', () => {
    const html = renderToStaticMarkup(
        <ManualCoordinateEntry lat="" lng="" onChange={() => undefined} />,
    );

    it('labels both fields in Thai and associates each label with its input', () => {
        expect(html).toContain('ละติจูด');
        expect(html).toContain('ลองจิจูด');
        // Association by id/for — a placeholder alone is not a label.
        expect(html).toMatch(/for="[^"]*lat[^"]*"/);
        expect(html).toMatch(/id="[^"]*lat[^"]*"/);
        expect(html).toMatch(/for="[^"]*lng[^"]*"/);
        expect(html).toMatch(/id="[^"]*lng[^"]*"/);
    });

    it('uses a decimal-friendly numeric keyboard on mobile', () => {
        expect(html).toMatch(/inputmode="decimal"/i);
    });

    it('shows no error before the applicant has typed anything', () => {
        expect(html).not.toContain('role="alert"');
    });

    it('renders no English words — the applicant form is Thai', () => {
        const text = html.replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/[A-Za-z]{4,}/);
    });

    it('surfaces the error with role="alert" once both fields are wrong', () => {
        const withError = renderToStaticMarkup(
            <ManualCoordinateEntry lat="100.5" lng="13.7" onChange={() => undefined} />,
        );
        expect(withError).toContain('role="alert"');
        expect(withError).toContain('นอกขอบเขตประเทศไทย');
    });
});
