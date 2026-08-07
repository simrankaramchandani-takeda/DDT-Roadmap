/**
 * Root layout. The shell proper (SiteHeader, PrimaryNav, FilterBar) is WP3; this is
 * the bootstrap it will grow into.
 */

import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'DD&T Roadmap',
  description:
    'Executive decision-support view of Digital Data & Technology initiatives across Takeda global manufacturing sites.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
