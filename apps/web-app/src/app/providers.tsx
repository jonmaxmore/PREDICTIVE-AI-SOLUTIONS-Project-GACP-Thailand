'use client';

import { AppThemeProvider } from '@/components/theme';
import { AuthProvider } from "@/lib/services/auth-provider";
import { MyEntitiesProvider } from "@/lib/services/my-entities-provider";
import { LanguageProvider } from "@/lib/i18n/language-context";
import SystemGuard from "@/components/feature/system-guard";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AppThemeProvider defaultColorScheme="light">
            <AuthProvider>
                {/* The user's entities (/api/entities/mine) via useMyEntities().
                    No active entity, no switching. */}
                <MyEntitiesProvider>
                    <LanguageProvider>
                        <SystemGuard>
                            {children}
                        </SystemGuard>
                    </LanguageProvider>
                </MyEntitiesProvider>
            </AuthProvider>
        </AppThemeProvider>
    );
}
