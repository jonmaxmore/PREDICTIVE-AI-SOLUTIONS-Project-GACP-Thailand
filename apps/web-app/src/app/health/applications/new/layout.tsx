import type { ReactNode } from 'react';

import ApplicationFlowLayout from './_steps/layout';

interface NewApplicationLayoutProps {
  children: ReactNode;
}

export default function NewApplicationLayout({ children }: NewApplicationLayoutProps) {
  return <ApplicationFlowLayout>{children}</ApplicationFlowLayout>;
}
