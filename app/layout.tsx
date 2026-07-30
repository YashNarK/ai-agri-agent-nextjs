import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { AuthMenu } from "@/components/auth-menu";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { settings } from "@/lib/config/settings";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: settings.APP_NAME,
    template: `%s — ${settings.APP_NAME}`,
  },
  description:
    "Price prediction, semantic search and an AI agent over agricultural commodity data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required by next-themes: it stamps the
    // theme class onto <html> before React hydrates, so server and client
    // markup differ on this element by design.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/*
            Suspense so resolving the session — which may read the
            database in the jwt callback — does not hold back the first
            streamed chunk of every page, as the auth guide warns.
          */}
          <SiteNav
            authMenu={
              <Suspense fallback={null}>
                <AuthMenu />
              </Suspense>
            }
          />
          <main className="flex-1">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
