'use client';

/**
 * Deciding how many top-nav items fit, and collecting the rest.
 *
 * The nav used to be a plain `overflow-x-auto` row with a hidden scrollbar.
 * That guarantees every item is *technically* on the page and gives the user
 * no way to know it. Measured as an ADMIN, nine of fifteen destinations sat
 * past the edge at 1280px and three still did at 1920px, including ตั้งค่า and
 * ผู้ดูแลระบบ. A destination an officer cannot find is a destination they do
 * not have.
 *
 * So the row measures itself and hands whatever does not fit to an explicit
 * "เพิ่มเติม" menu. That keeps every destination reachable at any viewport and
 * any item count, and it stays correct if the navigation is later regrouped or
 * trimmed — this decides layout, not information architecture.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How many leading items fit in `available` px.
 *
 * When they all fit, the overflow button is not rendered and its width is not
 * reserved — otherwise a nav that fits exactly would still hide its last item
 * to make room for a button with nothing in it.
 *
 * An `available` of 0 means "not laid out yet"; everything is reported as
 * fitting so the first paint shows the full nav rather than flashing empty.
 */
export function fitCount(itemWidths: number[], available: number, overflowWidth: number): number {
    if (itemWidths.length === 0) {
        return 0;
    }
    if (available <= 0) {
        return itemWidths.length;
    }

    const total = itemWidths.reduce((sum, w) => sum + w, 0);
    if (total <= available) {
        return itemWidths.length;
    }

    const budget = available - overflowWidth;
    let used = 0;
    let count = 0;
    for (const width of itemWidths) {
        if (used + width > budget) {
            break;
        }
        used += width;
        count += 1;
    }
    return count;
}

interface OverflowState {
    /**
     * Attach to the element that bounds the nav row.
     *
     * Typed as a callback ref rather than a RefObject: React's `ref` prop wants
     * `RefObject<T>` (non-nullable current), while `useRef<T | null>` produces
     * `RefObject<T | null>`, and the two do not unify. A callback ref sidesteps
     * the mismatch without an `as` cast.
     */
    containerRef: (node: HTMLElement | null) => void;
    /** Attach to each rendered item, in order, so widths can be measured. */
    registerItem: (index: number) => (node: HTMLElement | null) => void;
    /** Attach to the overflow trigger so its width is measured too. */
    overflowRef: (node: HTMLElement | null) => void;
    /** How many leading items to render inline. */
    visibleCount: number;
}

/**
 * Measure the row and recompute on resize.
 *
 * Items are rendered first and measured after — their widths depend on the
 * Thai label, the icon and the font, none of which can be known ahead of time.
 * The measured widths are cached in a ref so a resize does not need a second
 * render pass to re-measure what has not changed.
 */
export function useNavOverflow(itemCount: number): OverflowState {
    const containerEl = useRef<HTMLElement | null>(null);
    const overflowEl = useRef<HTMLElement | null>(null);
    const itemWidths = useRef<number[]>([]);
    const [visibleCount, setVisibleCount] = useState(itemCount);
    const [containerVersion, setContainerVersion] = useState(0);

    const registerItem = useCallback(
        (index: number) => (node: HTMLElement | null) => {
            if (node) {
                // Round up: a sub-pixel underestimate compounds across items
                // and would let one more through than actually fits.
                itemWidths.current[index] = Math.ceil(node.getBoundingClientRect().width);
            }
        },
        [],
    );

    const containerRef = useCallback((node: HTMLElement | null) => {
        containerEl.current = node;
        // Bump a counter so the measuring effect re-runs once the node exists.
        setContainerVersion((v) => v + 1);
    }, []);

    const overflowRef = useCallback((node: HTMLElement | null) => {
        overflowEl.current = node;
    }, []);

    const measure = useCallback(() => {
        const container = containerEl.current;
        if (!container) return;
        const widths = itemWidths.current.slice(0, itemCount).filter((w) => typeof w === 'number');
        // Not every item has reported yet — leave the nav whole until they have.
        if (widths.length < itemCount) return;
        const overflowWidth = overflowEl.current
            ? Math.ceil(overflowEl.current.getBoundingClientRect().width)
            : 0;
        setVisibleCount(fitCount(widths, container.clientWidth, overflowWidth));
    }, [itemCount]);

    useEffect(() => {
        measure();
        const container = containerEl.current;
        if (!container || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => measure());
        observer.observe(container);
        return () => observer.disconnect();
    }, [measure, containerVersion]);

    return { containerRef, registerItem, overflowRef, visibleCount };
}
