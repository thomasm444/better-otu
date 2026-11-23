import type { Metadata } from "next";
import { Suspense, type CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import localFont from "next/font/local";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const clashRegular = localFont({
  src: "./fonts/clash-regular.woff",
  variable: "--font-clash-regular",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Better OTU",
  description:
    "Browse Ontario Tech course sections, instructors and meeting times.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      style={{ "--site-nav-height": "2.75rem" } as CSSProperties}
      className={`${geistSans.variable} ${geistMono.variable} ${clashRegular.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<SiteNavFallback />}>
          <SiteNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
