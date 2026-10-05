/**
 * W3-A — Textarea primitive label-association regression tests.
 *
 * Before W3-A `Textarea` was a thin wrapper around `<textarea>` with
 * NO label/error/description contract. W3-A extends it to mirror the
 * `Input` primitive surface so the same WCAG 1.3.1 + 3.3.2 guarantees
 * apply: when a caller supplies `label`, the rendered `<label>` has
 * `htmlFor` matching the textarea `id`, and `error` paragraphs are
 * wired via `aria-describedby`.
 *
 * Uses `createRoot` + `act` to match the rest of the web-app suite
 * (no @testing-library/react in devDeps).
 */

import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Textarea } from '../textarea';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('[W3-A] Textarea primitive — label/textarea association', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    function mount(node: React.ReactElement) {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(node);
        });
    }

    it('renders label with htmlFor matching the generated textarea id (WCAG 1.3.1 + 3.3.2)', () => {
        mount(<Textarea label="Notes" />);

        const label = container!.querySelector('label');
        const textarea = container!.querySelector('textarea');
        expect(label).not.toBeNull();
        expect(textarea).not.toBeNull();

        const htmlFor = label!.getAttribute('for');
        const id = textarea!.getAttribute('id');
        expect(htmlFor).toBeTruthy();
        expect(id).toBeTruthy();
        expect(htmlFor).toBe(id);
    });

    it('respects caller-provided id (existing test selectors keep working)', () => {
        mount(<Textarea id="erasure-reason" label="Reason" />);

        const label = container!.querySelector('label');
        const textarea = container!.querySelector('textarea');
        expect(label!.getAttribute('for')).toBe('erasure-reason');
        expect(textarea!.getAttribute('id')).toBe('erasure-reason');
    });

    it('wires aria-describedby to the error paragraph id when error is present', () => {
        mount(<Textarea label="Notes" error="Notes too short" />);

        const textarea = container!.querySelector('textarea');
        const describedBy = textarea!.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();

        const alert = container!.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        const errId = alert!.getAttribute('id');
        expect(errId).toBeTruthy();
        expect(describedBy!.split(' ')).toContain(errId);

        expect(textarea!.getAttribute('aria-invalid')).toBe('true');
    });

    it('renders bare textarea (no wrapper, no label) when neither label/error/description is provided — preserves existing call sites', () => {
        mount(<Textarea placeholder="Free text" />);

        // No label or wrapper div — the consumer keeps full layout control.
        expect(container!.querySelector('label')).toBeNull();
        const textarea = container!.querySelector('textarea');
        expect(textarea).not.toBeNull();
        // The textarea still has an id (useId) so any future label/aria call
        // can reference it, but no label wiring is rendered.
        expect(textarea!.getAttribute('id')).toBeTruthy();
        // aria-describedby is undefined (no error / description to point at).
        expect(textarea!.getAttribute('aria-describedby')).toBeNull();
    });
});
