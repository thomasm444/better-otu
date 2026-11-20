import { Suspense } from "react";

import { TERM_LABEL, getLastUpdatedInfo } from "@/lib/queries";

import { PortalDashboard } from "./_components/portal-dashboard";

export const metadata = {
  title: "Better OTU | Ontario Tech University Student Portal",
  description:
    "Interactive campus room availability, course timetables, and degree planning built for Ontario Tech University students.",
};

function formatLastUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

async function LastUpdatedNotice() {
  const info = await getLastUpdatedInfo();
  if (!info) return null;

  return (
    <footer className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-6 text-center sm:px-6 lg:px-8">
      <p className="text-[11px] text-slate-400/90 dark:text-slate-500">
        Last updated at{" "}
        <a
          href={info.actionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-slate-300/70 underline-offset-2 transition-colors hover:text-slate-600 dark:decoration-slate-700 dark:hover:text-slate-300"
        >
          <time dateTime={info.timestamp}>
            {formatLastUpdated(info.timestamp)}
          </time>
        </a>
      </p>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#F8FAFC] font-sans text-slate-900 dark:bg-[#070B14] dark:text-slate-100">
      {/* Subtle Light Dot-Grid Texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(0,60,113,0.1)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_85%_75%_at_50%_15%,#000_60%,transparent_100%)] dark:bg-[radial-gradient(rgba(148,163,184,0.14)_1px,transparent_1px)]"
      />

      {/* Soft Radial Top Gradient Glow — Ontario Tech Future Blue (#003C71) & Tech Tangerine (#E75D2A) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.15),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.13),transparent_68%)] dark:bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.45),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.22),transparent_68%)]"
      />

      {/* Dashboard Content */}
      <div className="relative z-10 flex flex-1 flex-col">
        <PortalDashboard termLabel={TERM_LABEL} />
      </div>

      {/* Discreet Last Updated Footer */}
      <Suspense fallback={null}>
        <LastUpdatedNotice />
      </Suspense>
    </main>
  );
}
