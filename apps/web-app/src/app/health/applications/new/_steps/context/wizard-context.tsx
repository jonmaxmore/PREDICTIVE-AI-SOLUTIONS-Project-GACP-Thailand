"use client";

import { createContext, useContext, ReactNode } from 'react';
import { useWizardState, WizardContext } from '../hooks/use-wizard-state';

const WizardCtx = createContext<WizardContext | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
    const wizard = useWizardState();
    return <WizardCtx.Provider value={wizard}>{children}</WizardCtx.Provider>;
}

export function useWizard() {
    const ctx = useContext(WizardCtx);
    if (!ctx) throw new Error('useWizard must be inside WizardProvider');
    return ctx;
}

