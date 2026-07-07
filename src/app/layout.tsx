import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { SessionProvider } from 'next-auth/react';
import { AppShell } from '@/components/app-shell';
import { cn } from '@/lib/utils';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'CSquared • Change Management',
  description: 'ISO 27001 Internal CMS',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('csq-theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
        {/* Feedbucket — in-app feedback widget for internal colleagues */}
        {/* <script
          dangerouslySetInnerHTML={{
            __html: `(function(k){let s=document.createElement('script');s.defer=true;s.src="https://cdn.feedbucket.app/assets/feedbucket.js";s.dataset.feedbucket=k;document.head.appendChild(s);})('a81mhdiblDzizKH1geLp')`,
          }}
        /> */}
      </head>
      <body
        className={cn(
          spaceGrotesk.variable,
          'min-h-dvh bg-background font-sans antialiased',
        )}
      >
        <SessionProvider>
          <div className="flex min-h-dvh flex-col">
            <AppShell>
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-5 md:px-6 lg:px-8">
                {children}
              </div>
            </AppShell>
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
