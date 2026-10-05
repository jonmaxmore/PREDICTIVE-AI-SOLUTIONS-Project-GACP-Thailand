'use client';

// File: src/hooks/use-auth-health.ts
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/api-client';

interface AuthHealthStatus {
  success: boolean;
  frontend: string;
  backend: unknown;
  error?: string | undefined;
  timestamp: string;
}

interface BackendHealthStatus {
  status?: string;
  [key: string]: unknown;
}

function isBackendHealthStatus(value: unknown): value is BackendHealthStatus {
  return typeof value === 'object' && value !== null;
}

export function useAuthHealth() {
  const [health, setHealth] = useState<AuthHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<AuthHealthStatus>('/api/auth/health');
      // The health endpoint returns the full status directly; map it to expected shape
      if (response.success && response.data) {
        setHealth(response.data);
      } else {
        // Fallback: construct a minimal health status from the response
        setHealth({
          success: response.success,
          frontend: 'OK',
          backend: null,
          error: response.error,
          timestamp: new Date().toISOString(),
        });
      }
      setError(null);
    } catch (err: unknown) {
      setError('Failed to check auth health');
      console.error('Auth health check error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();

    // Check every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    health,
    loading,
    error,
    checkHealth,
    isHealthy: Boolean(
      health?.success
      && isBackendHealthStatus(health.backend)
      && health.backend.status === 'OK',
    ),
  };
}
