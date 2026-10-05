export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { Metadata } from 'next';
import ClientView, { type LotTraceData } from './client-view';
import { classifyTraceResponse } from '../../trace-fetch';

export const metadata: Metadata = {
  title: 'ตรวจสอบล็อต | GACP Platform',
  description: 'ตรวจสอบที่มาผลิตภัณฑ์ระดับล็อต',
};

interface LotTraceApiResponse {
  success?: boolean;
  message?: string;
  data?: LotTraceData;
}

/**
 * Fetch the lot envelope on the SERVER so the answer is in the first HTML.
 *
 * The public scan has TWO doors: a scanned lot QR lands here, on
 * /api/trace/lot/<id>, not on the generic resolver. Moving only the generic one
 * to the server would have left the buyer's actual door on the slow path — this
 * is the same file:line shape as src/app/trace/[qr-code]/page.tsx, deliberately.
 *
 * URL from the INCOMING REQUEST HOST for the reason the certificate-verify page
 * documents: NEXT_PUBLIC_* is inlined at build time, INTERNAL_API_URL/BACKEND_URL
 * are unset in this container, and a fixed http://backend:8000 cross-wires staging
 * to the production backend on the shared droplet.
 *
 * Every failure path stays with the client: this returns null and ClientView runs
 * exactly the fetch it always ran.
 */
async function fetchLotOnServer(lotId: string): Promise<LotTraceData | null> {
  if (!lotId) return null;
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') || 'https';
    const response = await fetch(`${proto}://${host}/api/trace/lot/${encodeURIComponent(lotId)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null) as LotTraceApiResponse | null;
    const outcome = classifyTraceResponse<LotTraceApiResponse>(response.status, payload);
    return outcome.kind === 'ok' ? (outcome.payload.data ?? null) : null;
  } catch {
    return null;
  }
}

export default async function Page({ params }: { params: Promise<{ 'lot-id': string }> }) {
  const { 'lot-id': lotId } = await params;
  const initialData = await fetchLotOnServer(lotId);

  return (
    <main className="h-full min-h-screen w-full">
      <ClientView initialData={initialData} />
    </main>
  );
}
