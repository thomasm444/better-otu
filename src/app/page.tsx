import Link from "next/link";
import { Suspense } from "react";

import { getCatalogCourses } from "@/lib/degree-queries";
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
    <>
      <span>
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
      </span>
      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
        &bull;
      </span>
    </>
  );
}

function HomeFooter() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-6 text-center sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400/90 dark:text-slate-500">
        <Suspense fallback={null}>
          <LastUpdatedNotice />
        </Suspense>
        <Link
          href="/privacy-policy"
          className="underline decoration-slate-300/70 underline-offset-2 transition-colors hover:text-slate-600 dark:decoration-slate-700 dark:hover:text-slate-300"
        >
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}

async function PortalDashboardWithCredits({
  footer,
}: {
  footer: React.ReactNode;
}) {
  const catalogCourses = await getCatalogCourses();
  const nonStandardCredits: Record<string, number> = {};
  for (const course of catalogCourses) {
    const credits = Number(course.credit_hours);
    if (Number.isFinite(credits) && credits !== 3 && course.code) {
      nonStandardCredits[course.code.trim().toUpperCase()] = credits;
    }
  }
  return (
    <PortalDashboard
      termLabel={TERM_LABEL}
      nonStandardCredits={nonStandardCredits}
      footer={footer}
    />
  );
}

export default function Home() {
  const footer = <HomeFooter />;

  return (
    <Suspense fallback={<PortalDashboard termLabel={TERM_LABEL} footer={footer} />}>
      <PortalDashboardWithCredits footer={footer} />
    </Suspense>
  );
}
