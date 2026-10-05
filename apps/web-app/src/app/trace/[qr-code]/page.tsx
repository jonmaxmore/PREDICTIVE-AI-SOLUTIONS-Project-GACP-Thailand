export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { Metadata } from 'next';
import ClientView from './client-view';
import { classifyTraceResponse } from '../trace-fetch';
import type { TraceData } from './trace-page-types';

export const metadata: Metadata = {
  title: 'ตรวจสอบ QR | GACP Platform',
  description: 'ตรวจสอบที่มาผลิตภัณฑ์ผ่าน QR Code',
};

interface TraceApiResponse extends TraceData {
  success?: boolean;
  message?: string;
}

/**
 * Fetch the trace envelope on the SERVER so the answer is in the first HTML.
 *
 * Measured before this, on a throttled 4G phone profile: DOM ready at 841ms but
 * the sentence that says the product is certified not visible until 8284ms,
 * because the page was a client island that fetched on mount — the citizen waited
 * for the JS bundle, hydration, AND a 2.7s API round trip before the page said
 * anything (evidence/apple-qa-audit-2026-09-07). This is the ONLY page a member of
 * the public ever sees.
 *
 * The URL is built from the INCOMING REQUEST HOST for the same reason the
 * certificate-verify page does it (see its fetchCertificate docstring): NEXT_PUBLIC_*
 * is inlined at build time, INTERNAL_API_URL/BACKEND_URL are unset here, and a fixed
 * http://backend:8000 cross-wires staging to the production backend on the shared
 * droplet. The public host the citizen actually hit is the only runtime,
 * per-environment-correct source.
 *
 * Every failure path stays with the client: this returns `null` and ClientView runs
 * exactly the fetch it always ran. A slow or unreachable backend therefore degrades
 * to the previous behaviour rather than to a broken page.
 */
async function fetchTraceOnServer(qrCode: string): Promise<TraceData | null> {
  if (!qrCode) return null;
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') || 'https';
    const response = await fetch(`${proto}://${host}/api/trace/${encodeURIComponent(qrCode)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    // classifyTraceResponse takes (status, payload) — the SAME classifier the client
    // uses, so the server cannot reach a different verdict than the browser would.
    const payload = await response.json().catch(() => null) as TraceApiResponse | null;
    const outcome = classifyTraceResponse<TraceApiResponse>(response.status, payload);
    return outcome.kind === 'ok' ? outcome.payload : null;
  } catch {
    // Never let a server-side failure break the page: the client retries.
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ 'qr-code': string }> }) {
  const { 'qr-code': qrCode } = await params;
  const initialData = await fetchTraceOnServer(qrCode);

  return (
    <main className="h-full min-h-screen w-full">
      <ClientView initialData={initialData} />
    </main>
  );
}
