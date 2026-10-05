/**
 * W3-A — Input primitive label-association regression tests.
 *
 * Before W3-A the Input primitive rendered a bare `<label>` (no
 * `htmlFor`) and a bare `<input>` (no `id`). That breaks WCAG 1.3.1
 * (Info and Relationships) and 3.3.2 (Labels or Instructions): screen
 * readers cannot announce which label belongs to which input; clicking
 * the label does not focus the input. The fix wires `useId()` so the
 * label/input pair always carries a matching `htmlFor` ↔ `id`. A
 * caller-supplied `id` wins so existing test selectors keep working.
 *
 * Tests use `createRoot` + `act` (no @testing-library/react in this
 * workspace per package.json devDeps) and assert directly on the DOM
 * tree. This mirrors the V1-C certificates pattern.
 */

import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Input } from '../input';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('[W3-A] Input primitive — label/input association', () => {
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

    it('renders label with htmlFor matching the generated input id (WCAG 1.3.1 + 3.3.2)', () => {
        mount(<Input label="Email" />);

        const label = container!.querySelector('label');
        const input = container!.querySelector('input');
        expect(label).not.toBeNull();
        expect(input).not.toBeNull();

        // Both must exist AND match — the core regression: pre-W3-A `htmlFor`
        // was undefined and `id` was undefined, so the pair was unassociated.
        const htmlFor = label!.getAttribute('for');
        const id = input!.getAttribute('id');
        expect(htmlFor).toBeTruthy();
        expect(id).toBeTruthy();
        expect(htmlFor).toBe(id);
    });

    it('uses the caller-provided id when supplied (respects existing test selectors)', () => {
        mount(<Input id="custom-email" label="Email" />);

        const label = container!.querySelector('label');
        const input = container!.querySelector('input');
        expect(label!.getAttribute('for')).toBe('custom-email');
        expect(input!.getAttribute('id')).toBe('custom-email');
    });

    it('wires aria-describedby to the error message id when error is present', () => {
        mount(<Input label="Email" error="Email is required" />);

        const input = container!.querySelector('input');
        expect(input).not.toBeNull();
        const describedBy = input!.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();

        // The role=alert paragraph holds the error text and its id MUST be
        // referenced by aria-describedby.
        const alert = container!.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        const errId = alert!.getAttribute('id');
        expect(errId).toBeTruthy();
        expect(describedBy!.split(' ')).toContain(errId);

        // aria-invalid MUST flip to true on error per WCAG 3.3.1.
        expect(input!.getAttribute('aria-invalid')).toBe('true');
    });

    it('passes the same id through to the inner input when leftSection/rightSection wrap it', () => {
        mount(
            <Input
                label="Search"
                leftSection={<span>L</span>}
                rightSection={<span>R</span>}
            />,
        );

        const label = container!.querySelector('label');
        const input = container!.querySelector('input');
        expect(label).not.toBeNull();
        expect(input).not.toBeNull();
        expect(label!.getAttribute('for')).toBe(input!.getAttribute('id'));
    });

    it('also links aria-describedby to the description id when description is present', () => {
        mount(<Input label="Email" description="We never share your email" />);

        const input = container!.querySelector('input');
        const describedBy = input!.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();

        // The description <p> has id={inputId}-desc and must be referenced.
        const id = input!.getAttribute('id');
        expect(describedBy).toBe(`${id}-desc`);
    });
});
