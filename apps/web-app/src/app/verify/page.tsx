import type { Metadata } from 'next';
import TrustVerifierPortal from '@/components/feature/trust-verifier-portal';

export const metadata: Metadata = {
  title: 'Verifier Portal | GACP Thailand',
  description: 'Public trust verification portal for GACP certificates, revocation transparency, and signed document verification.',
};

export default function VerifyPortalPage() {
  return <TrustVerifierPortal />;
}
