import type { Metadata } from 'next';
import './globals.css';
import { BuildWatcher } from '@/components/BuildWatcher';

export const metadata: Metadata = {
  title: 'J.A.R.V.I.S.',
  description: 'Just A Rather Very Intelligent System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
        <BuildWatcher />
      </body>
    </html>
  );
}
