"use client";

import { logger } from '@/lib/logger';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { getPublicSystemConfig, invalidatePublicSystemConfig } from '@/lib/system-config-cache';
import { invalidateFeatureFlags } from '@/hooks/use-feature-flag';

interface SystemConfig {
    [key: string]: unknown;
}

interface ConfigContextType {
    configs: SystemConfig;
    isLoading: boolean;
    refreshConfigs: () => Promise<void>;
    getFeatureFlag: (key: string, defaultValue?: boolean) => boolean;
    getConfig: (key: string, defaultValue?: unknown) => unknown;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
    const [configs, setConfigs] = useState<SystemConfig>({});
    const [isLoading, setIsLoading] = useState(true);

    const fetchConfigs = async () => {
        try {
            // W3-C: shared session cache — the same request the
            // use-feature-flag hook consumes, so a page load fires at most
            // one GET /api/system-config/public (StrictMode double-mount
            // included). Unavailable resolves null: keep prior configs
            // rather than clobbering them with an empty object.
            const data = await getPublicSystemConfig();
            if (data) {
                setConfigs(data);
            }
        } catch (error: unknown) {
            logger.warn('Failed to load system configs (using defaults):', error);
        } finally {
            setIsLoading(false);
        }
    };

    const refreshConfigs = async () => {
        // Admin just mutated config — drop both caches so this provider AND
        // the feature-flag hook refetch fresh values.
        invalidatePublicSystemConfig();
        invalidateFeatureFlags();
        await fetchConfigs();
    };

    useEffect(() => {
        fetchConfigs();
    }, []);

    const getFeatureFlag = (key: string, defaultValue = false): boolean => {
        if (configs[key] === undefined) return defaultValue;
        // Handle string "true"/"false" from JSON if needed, though Accessor should handle it
        return configs[key] === true || configs[key] === 'true';
    };

    const getConfig = (key: string, defaultValue: unknown = null) => {
        return configs[key] !== undefined ? configs[key] : defaultValue;
    };

    return (
        <ConfigContext.Provider value={{ configs, isLoading, refreshConfigs, getFeatureFlag, getConfig }}>
            {children}
        </ConfigContext.Provider>
    );
}

export function useConfig() {
    const context = useContext(ConfigContext);
    if (context === undefined) {
        throw new Error('useConfig must be used within a ConfigProvider');
    }
    return context;
}
