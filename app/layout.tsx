import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Suspense } from "react";

import { AdminNavLink } from "@/components/admin-nav-link";
import { AuthMenu } from "@/components/auth-menu";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { settings } from "@/lib/config/settings";

import "./globals.css";

// ============================================================
// Type system
//
// Three faces, each doing one job:
//
//   Space Grotesk  — headings. Geometric with cut terminals; it reads
//                    as engineered rather than editorial, which is the
//                    character this app wants.
//   IBM Plex Sans  — body and UI. Chosen over a neo-grotesk because the
//                    dashboard is full of tabular figures, and Plex has
//                    genuinely distinct numerals that stay legible in a
//                    dense table.
//   JetBrains Mono — code, ids and anything monospaced.
//
// The variable names are generic (--font-body, not --font-plex) so
// swapping a face is a change in this file alone; globals.css maps them
// onto Tailwind's font-sans / font-heading / font-mono.
// ============================================================

const fontBody = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const fontDisplay = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono-code",
  subsets: ["latin"],
  display: "swap",
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
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable} h-full antialiased`}
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
            menuExtra={
              <Suspense fallback={null}>
                <AdminNavLink />
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
