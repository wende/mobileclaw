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
    icon: 'https://litter.catbox.moe/hb9935ge5k57plpl.png',
    apple: 'https://litter.catbox.moe/hb9935ge5k57plpl.png',
  },
}

// Script to apply theme before React hydrates (prevents flash)
// Also registers the service worker for PWA support
const headScript = `
(function() {
  var params = new URLSearchParams(location.search);
  var detached = params.has('detached');
  var detachedMode = detached ? params.get('mode') : null;
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
  if ('serviceWorker' in navigator && location.hostname !== 'localhost' && !window.__nativeMode) {
    window.addEventListener('load', function() {
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
    <html lang="en" suppressHydrationWarning>
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
