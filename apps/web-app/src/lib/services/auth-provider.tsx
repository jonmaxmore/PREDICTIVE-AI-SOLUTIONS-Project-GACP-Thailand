'use client';

/**
 * AuthProvider - React component to initialize AuthService
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';

import { AuthService, AuthUser, AuthEventType } from './auth-service';
import { HEALTH_LOGIN_ROUTE } from '@/lib/constants/auth-routes';

// Define Context Type
interface AuthContextValue {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (token: string, user: AuthUser) => void;
    logout: () => Promise<void>;
    updateUser: (user: AuthUser) => void;
}

// Create Context
const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
    children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const pathname = usePathname();

    // W1-HYDRATION: the first CLIENT render must match the SSR snapshot
    // (user=null, isLoading=true) — the server cannot read localStorage,
    // so reading AuthService.getUser() in a lazy useState initializer
    // made hydration render different DOM than the server sent ("Hydration
    // failed because the server rendered HTML didn't match the client",
    // proven on /health/account/erasure + /provider/accounting/reports).
    // The stored session is loaded post-mount in the effect below; the
    // contract is pinned by __tests__/auth-provider-first-render.test.tsx.
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Verification Check Logic - Move before usage
    const checkVerification = useCallback((u: AuthUser | null) => {
        if (!u) return;

        // Skip for provider
        const role = u.role?.toUpperCase();
        if (role && ['system_admin_dtam', 'PROVIDER', 'dispatcher', 'field_inspector', 'Reviewer', 'JURISTIC_OFFICER'].some(r => role.includes(r))) {
            return;
        }

        // Verification status is available but not used for now
        // Users can access dashboard with warning banner
        const _vStatus = u.verificationStatus || 'NEW';
    }, []);

    // Initialize auth service and sync state
    useEffect(() => {
        // Initialize service (sets up cross-tab sync, timers, etc.)
        AuthService.initialize();

        // Load the stored session AFTER mount (post-hydration) so the
        // initial render stays identical to the server-rendered HTML.
        setUser(AuthService.getUser());
        setIsLoading(false);

        // Auth Event Listener
        const unsubscribe = AuthService.onAuthChange((event: AuthEventType) => {
            switch (event) {
                case 'login':
                    const u = AuthService.getUser();
                    setUser(u);
                    // Check verification on login
                    checkVerification(u);
                    break;
                case 'logout':
                case 'session_expired':
                    setUser(null);
                    break;
                case 'tab_sync':
                    if (AuthService.isAuthenticated()) {
                        setUser(AuthService.getUser());
                    } else {
                        setUser(null);
                    }
                    break;
            }
        });

        return () => {
            unsubscribe();
        };
    }, [checkVerification]);

    // Check on path change or user update
    useEffect(() => {
        if (!isLoading && user) {
            checkVerification(user);
        }
    }, [isLoading, user, pathname, checkVerification]);


    const login = useCallback((token: string, user: AuthUser) => {
        AuthService.saveSession({ token, user });
        setUser(user);
        checkVerification(user);
    }, [checkVerification]);

    const logout = useCallback(async () => {
        await AuthService.logout();
        setUser(null);
    }, []);

    const updateUser = useCallback((updatedUser: AuthUser) => {
        AuthService.updateUser(updatedUser);
        setUser(updatedUser);
    }, []);

    const value: AuthContextValue = {
        user,
        isAuthenticated: !!user && AuthService.isAuthenticated(),
        isLoading,
        login,
        logout,
        updateUser,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

/**
 * Hook to require authentication
 * Redirects to login if not authenticated
 */
export function useRequireAuth(redirectTo = HEALTH_LOGIN_ROUTE): AuthContextValue {
    const auth = useAuth();

    useEffect(() => {
        if (!auth.isLoading && !auth.isAuthenticated) {
            window.location.href = redirectTo;
        }
    }, [auth.isLoading, auth.isAuthenticated, redirectTo]);

    return auth;
}
