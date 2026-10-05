'use client';

import { useState, useCallback } from 'react';

type DisclosureHandlers = {
    open: () => void;
    close: () => void;
    toggle: () => void;
};

export function useDisclosure(initialState = false): [boolean, DisclosureHandlers] {
    const [opened, setOpened] = useState(initialState);
    const open = useCallback(() => setOpened(true), []);
    const close = useCallback(() => setOpened(false), []);
    const toggle = useCallback(() => setOpened(v => !v), []);
    return [opened, { open, close, toggle }];
}
