import { notFound } from 'next/navigation';
import ClientView from './client-view';
import { Metadata } from 'next';
import { isCheckoutUiEnabled } from '@/lib/config/checkout-mode';

// Operator decision 6 (audit UXUI-X01): titled "ชำระเงินออนไลน์" while the page
// cannot take a payment yet (client-view.tsx header comment).
export const metadata: Metadata = {
  title: 'สร้างรายการชำระเงิน | GACP',
  description: 'สร้างรายการชำระเงินสำหรับคำขอ GACP',
};

/**
 * Server Component wrapper — exports route metadata at build-time
 * and renders the Client island below. Same convention as
 * `../page.tsx` (/health/payments).
 *
 * P0-4 — ROUTE-LEVEL FLAG GUARD. The entry link on /health/payments only
 * hides itself behind isCheckoutUiEnabled() (../client-view.tsx:298); it
 * cannot stop a typed URL, a bookmark or the back button. Online payment
 * is not open yet, so the route itself has to be closed too, through the
 * SAME predicate — no second read of NEXT_PUBLIC_CHECKOUT_UI_ENABLED here
 * (Law 3.5/3.6), which also means the fail-closed semantics documented in
 * src/lib/config/checkout-mode.ts (exact string 'true', no trim, no case
 * folding) apply to the route for free.
 *
 * notFound() rather than redirect(): every page-level redirect() in this
 * app means "this route permanently moved" (e.g.
 * ../../applications/new/step/11/page.tsx forwarding to step 10). This
 * route did not move — while the flag is off the checkout surface does
 * not exist, which is what a 404 says. It also keeps the disabled feature
 * from advertising itself. Pinned by
 * __tests__/checkout-page-flag-guard.test.tsx.
 */
export default function Page() {
  if (!isCheckoutUiEnabled()) {
    notFound();
  }

  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
