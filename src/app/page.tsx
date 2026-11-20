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
    <footer className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-6 text-center sm:px-6 lg:px-8">
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
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#F8FAFD] font-sans text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(191,219,254,0.45),transparent_72%)] dark:bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(0,60,113,0.35),transparent_72%)]"
      />

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
