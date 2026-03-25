import React from "react"
import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { LocatorProvider } from './LocatorProvider'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'MobileClaw',
  description: 'A minimal, animated chat interface with real-time streaming',
  generator: 'v0.app',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MobileClaw',
  },
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
}

// Script to apply theme before React hydrates (prevents flash)
// Also registers the service worker for PWA support
const headScript = `
(function() {
  var isDev = ${JSON.stringify(process.env.NODE_ENV !== 'production')};
  var params = new URLSearchParams(location.search);
  var detached = params.has('detached');
  var detachedMode = detached ? params.get('mode') : null;
  var host = location.hostname;
  var isIpV4 = /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host);
  var isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local');
  var isPrivateLanIp = /^10\\./.test(host) || /^192\\.168\\./.test(host) || /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host);
  var shouldDisableServiceWorker = isDev || isLocalHost || (isIpV4 && isPrivateLanIp);
  try {
    if (detachedMode === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (detachedMode === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      var theme = localStorage.getItem('theme');
      if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    }
  } catch (e) {}
  if (location.search.indexOf('native') !== -1 || window.__nativeMode) {
    document.documentElement.classList.add('native-loading');
  }
  if (detached) {
    document.documentElement.classList.add('detached-loading');
  }
  if ('serviceWorker' in navigator && !window.__nativeMode) {
    window.addEventListener('load', function() {
      if (shouldDisableServiceWorker) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          registrations.forEach(function(registration) { registration.unregister(); });
        });
        if (window.caches && caches.keys) {
          caches.keys().then(function(keys) {
            keys.forEach(function(key) { caches.delete(key); });
          });
        }
        return;
      }
      navigator.serviceWorker.register('/sw.js');
    });
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="bg-background text-foreground">
      <head>
        <script dangerouslySetInnerHTML={{ __html: headScript }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <LocatorProvider>{children}</LocatorProvider>
        <Analytics />
      </body>
    </html>
  )
}
