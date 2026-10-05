'use client';

import { AppThemeProvider } from '@/components/theme';
import { AuthProvider } from "@/lib/services/auth-provider";
import { ActiveEntityProvider } from "@/lib/services/active-entity-provider";
import { LanguageProvider } from "@/lib/i18n/language-context";
import SystemGuard from "@/components/feature/system-guard";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AppThemeProvider defaultColorScheme="light">
            <AuthProvider>
                {/* Wave C — workspace switcher. Reads localStorage on mount,
                    re-validates against /api/entities/mine, exposes
                    useActiveEntity() to the rest of the app. */}
                <ActiveEntityProvider>
                    <LanguageProvider>
                        <SystemGuard>
                            {children}
                        </SystemGuard>
                    </LanguageProvider>
                </ActiveEntityProvider>
            </AuthProvider>
        </AppThemeProvider>
    );
}
