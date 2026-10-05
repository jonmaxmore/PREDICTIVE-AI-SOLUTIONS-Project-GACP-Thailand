"use client";

import { ReactNode } from "react";

interface SystemGuardProps {
    children: ReactNode;
}

/**
 * SystemGuard Component
 *
 * Historically wrapped the app with a backend health check that could show a
 * "server down" screen. That blocking screen was permanently disabled
 * (`if (false && ...)`), so the component always rendered children, and the
 * 30-second background `/health` poll feeding it was discarded work. The dead
 * branch + poll + their state were removed (audit dead-code §3). SystemGuard is
 * now a transparent pass-through, kept as the wrapper seam in case a future
 * connectivity gate is reintroduced.
 */
export default function SystemGuard({ children }: SystemGuardProps) {
    return <>{children}</>;
}
