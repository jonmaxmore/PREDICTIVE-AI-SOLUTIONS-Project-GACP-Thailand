import { redirect } from 'next/navigation';

// Step 11 ("ใบแจ้งหนี้") was merged into Step 10 (payment) in v3.2.0.
// The 5-agent UX audit flagged the quote/invoice split as creating
// redundant "where am I" interstitials with no new user decision. The
// merged payment step at /step/10 now shows both the quotation preview
// (full fees) and the Phase 1 invoice on one screen.
//
// PAYMENT_STEPS skips this numeric slot for the same reason FLOW_STEPS
// skips slot 3 (the prior purpose → plant_selection merge). This static
// segment takes precedence over [id]/page.tsx and forwards stale
// bookmarks to /step/10 without rendering wizard chrome — eliminating
// the redirect flash users used to see on the prior step 3 forward.
export default function Step11Redirect() {
  redirect('/health/applications/new/step/10');
}
