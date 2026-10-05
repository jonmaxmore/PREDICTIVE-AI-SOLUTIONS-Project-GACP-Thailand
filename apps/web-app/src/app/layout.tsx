import type { Metadata } from 'next';
import './globals.css';

// Phase A5 §4.6 — self-host every Google Font via @fontsource so the page
// never makes runtime requests to fonts.googleapis.com / fonts.gstatic.com.
// Each weight imports @font-face declarations served from the same origin.
// Browsers only download the woff2 files whose unicode-range matches glyphs
// actually rendered on the page (Thai vs Latin etc).
//
// v3.5.1 (2026-04-28): dropped the runtime <link href="..."> to
// fonts.googleapis.com that previously leaked referer + IP to Google on
// every page view. Google Sans was never imported by any component (only
// referenced as a fallback string) so it's dropped from the document head
// without a self-hosted replacement.
//
// Font-loading hygiene (2026-07-23): Sukhumvit Set (public/fonts TTFs,
// declared in globals.css) is the brand face; Sarabun is the @fontsource
// fallback. `font-prompt` has zero usages across src/**/*.tsx, so the five
// Prompt weight imports are removed — Prompt survives only as a system-font
// name late in the fallback stacks. A fallback face only needs regular +
// bold, so Sarabun 300/500/600 are dropped too.
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/700.css';

import { Providers } from './providers';
import { ThemeScript } from '@/components/theme';
import { ConfigProvider } from '@/contexts/config-context';
import { Toaster } from '@/components/ui/primitives/toaster';
import { PwaServiceWorkerGuard } from '@/components/runtime/pwa-service-worker-guard';
import { RootLangUpdater } from '@/components/RootLangUpdater';
import { SkipToContent } from '@/components/layout/SkipToContent';
import { OfflineIndicator } from '@/components/feature/OfflineIndicator';

export const metadata: Metadata = {
  metadataBase: new URL('https://gacpth.com'),
  title: 'GACP - ระบบรับรองมาตรฐานสมุนไพรไทย',
  description: 'ระบบรับรองมาตรฐาน GACP (Good Agricultural and Collection Practices) สำหรับสมุนไพรไทย ภายใต้กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
  keywords: 'GACP, สมุนไพร, มาตรฐาน, รับรอง, GAP, Thailand herbs, certification, traceability',
  // OG/Twitter images + apple icon are NOT listed here on purpose: the App
  // Router file conventions `src/app/opengraph-image.png` (1200x630, also
  // reused for twitter:image) and `src/app/apple-icon.png` (180x180) generate
  // the correct <meta>/<link> tags automatically at build time. The previous
  // hand-written entries pointed at files that did not exist
  // (/images/og-image.png, /apple-touch-icon.png).
  icons: {
    icon: '/favicon.ico',
    // Served by the app/apple-icon.png file convention (the file exists —
    // unlike the old /apple-touch-icon.png reference, which never did).
    apple: '/apple-icon.png',
  },
  authors: [{ name: 'GACP Platform Team' }],
  creator: 'GACP Platform Engineering',
  publisher: 'กระทรวงสาธารณสุข ประเทศไทย',
  openGraph: {
    title: 'GACP Thailand ระบบรับรองมาตรฐานสมุนไพร',
    description: 'แพลตฟอร์มรับรองมาตรฐาน GACP สมุนไพรไทย สู่สากล',
    url: 'https://gacpth.com',
    siteName: 'GACP Thailand',
    locale: 'th_TH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GACP Thailand ระบบรับรองมาตรฐานสมุนไพร',
    description: 'แพลตฟอร์มรับรองมาตรฐาน GACP สมุนไพรไทย',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pwaEnabled = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true';

  return (
    // suppressHydrationWarning: ThemeScript mutates class + data-color-scheme
    // on <html> before hydration, so the client snapshot never matches the
    // SSR markup on this one element (same contract as next-themes).
    <html lang="th" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {/*
          v3.5.1 (2026-04-28): Removed runtime <link href="https://fonts.googleapis.com/...">
          and the two <link rel="preconnect"> tags that pointed at Google Fonts.
          Sarabun is served from the same origin via the @fontsource imports
          above. Google Sans is dropped (it was only referenced as a
          fallback string in design-tokens, never actually imported).
        */}
        {/*
          Preload the two primary Sukhumvit Set brand weights (declared via
          @font-face in globals.css) so the first paint doesn't flash the
          Sarabun fallback. `crossOrigin` is required for font preloads even
          same-origin, otherwise the browser double-fetches the file.
        */}
        <link
          rel="preload"
          href="/fonts/SukhumvitSet-Text.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/SukhumvitSet-Bold.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />

        {pwaEnabled ? (
          <>
            <link rel="manifest" href="/manifest.json" />
            <meta name="theme-color" content="#1B5E20" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-status-bar-style" content="default" />
            <meta name="apple-mobile-web-app-title" content="GACP" />
          </>
        ) : null}
      </head>
      {/*
        X1-FIX-B (H-6): switched the body font from `font-prompt` to
        `font-sans`. `font-sans` now resolves to the Sarabun-first stack
        defined in tailwind.config.cjs `theme.extend.fontFamily.sans`,
        which is the Thai government open-source standard mandated by
        the brand spec (`docs/design/gacp-brand-identity-2026-05-16.md`
        §4). Sarabun is already loaded same-origin via @fontsource above,
        so this change does not trigger any new network request.
      */}
      <body className="font-sans">
        {/*
          v3.5.1 (2026-04-28): Skip-link unification per Phase A5 a11y audit.
          Now follows the selected language (see SkipToContent), targets the canonical
          #main-content id used by GovLayout and pages that render their
          own <main>. WCAG 2.4.1 + 2.4.6 — pages that don't yet wrap with
          GovLayout should add `id="main-content"` to their <main> element.
        */}
        <PwaServiceWorkerGuard />
        <Providers>
          {/*
            First focusable element on the page, and it must stay that way.
            It moved inside <Providers> when it became bilingual: the text
            comes from useLanguage(), which only resolves in here. Nothing
            rendered above it is focusable, so tab order is unchanged.
          */}
          <SkipToContent />
          {/*
            W3-D — reactive `<html lang>` updater. SSR keeps `lang="th"`
            for hydration parity; this client-only effect mirrors the
            current language picker into `document.documentElement.lang`
            so screen readers announce the right language on TH↔EN flip.
            Must live inside <Providers> so useLanguage() resolves.
          */}
          <RootLangUpdater />
          <ConfigProvider>
            {children}
            <Toaster position="top-right" />
            {/*
              X3-FIX-B M-5: site-wide offline indicator. Renders nothing
              when navigator.onLine is true; shows a fixed-position pill
              with role="status" + aria-live="polite" when offline.
              Mounted here so it covers HEALTH + PROVIDER + ADMIN.
            */}
            <OfflineIndicator />
          </ConfigProvider>
        </Providers>
      </body>
    </html>
  );
}
