import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { SiteHeader } from '../components/SiteHeader';

export const metadata: Metadata = {
  title: 'Astro Channel Management Portal',
  description: 'Browse Astro channels, see what\'s on now and next, and manage favourites.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
