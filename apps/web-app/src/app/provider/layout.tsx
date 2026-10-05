'use client';

import { useEffect } from 'react';

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-role', 'provider');
    return () => {
      document.documentElement.removeAttribute('data-role');
    };
  }, []);

  return <>{children}</>;
}
