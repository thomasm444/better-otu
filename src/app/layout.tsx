import type { Metadata } from "next";
import { Suspense, type CSSProperties } from "react";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-course-code",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Better OTU",
  description:
    "Browse Ontario Tech course sections, instructors and meeting times.",
  icons: {
    icon: [
      {
        url: "/images/better-otu-logo-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/images/better-otu-logo-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/images/better-otu-logo-light.svg",
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var k="better-otu:theme:v1";var v=localStorage.getItem(k);var d=v==="dark"||(v!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={
        {
          "--site-nav-height": "2.75rem",
          "--site-footer-height": "2rem",
        } as CSSProperties
      }
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans">
        <Suspense fallback={<SiteNavFallback />}>
          <SiteNav />
        </Suspense>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <footer className="sticky bottom-0 z-30 flex min-h-[var(--site-footer-height,2rem)] shrink-0 items-center justify-center border-t border-line-subtle bg-surface/95 px-4 py-1 text-center text-[11px] leading-tight text-ink-muted backdrop-blur-sm">
          Unofficial student project &mdash; not affiliated with or endorsed by
          Ontario Tech University
        </footer>
      </body>
    </html>
  );
  // go
}
