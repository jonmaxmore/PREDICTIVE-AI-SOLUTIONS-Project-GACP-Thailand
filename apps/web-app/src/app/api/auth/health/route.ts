// File: src/app/api/auth/health/route.ts
import { NextResponse } from 'next/server';
import { INTERNAL_BACKEND_URL } from '@/config/server.config';

interface BackendHealthPayload {
  status?: string;
  [key: string]: unknown;
}

export async function GET() {
  try {
    const response = await fetch(`${INTERNAL_BACKEND_URL}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json().catch(() => ({} as BackendHealthPayload));

    return NextResponse.json({
      success: true,
      frontend: 'healthy',
      backend: data,
      timestamp: new Date().toISOString(),
    });

  } catch (error: unknown) {
    console.error('Health check error:', error);
    return NextResponse.json({
      success: false,
      frontend: 'healthy',
      backend: 'unreachable',
      error: error instanceof Error ? error.message : 'Unable to check backend health',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
