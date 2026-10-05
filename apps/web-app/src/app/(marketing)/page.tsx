import { redirect } from 'next/navigation';

/**
 * The root IS the login chooser now — operator decision 2026-08-14: ThaID and
 * MorPromt are the ministry-mandated entry paths, so the first thing anyone
 * sees is the door that carries them. The marketing pages remain reachable at
 * their own URLs (/about, /pricing, ...); the 470-line landing this file used to hold was deleted by this change — it survives only in git history (`git show 'main~1:apps/web-app/src/app/(marketing)/page.tsx'` at the E1 merge), and whether any of it returns at another route is a SWEEP-ticket decision.
 */
export default function RootRedirect() {
  redirect('/auth');
}
