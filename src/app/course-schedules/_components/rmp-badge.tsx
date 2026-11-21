"use client";

import React from "react";

import type { SectionRmpInfo } from "../types";

interface RmpStarBadgeProps {
  rmp: SectionRmpInfo | null | undefined;
  /** Render as a clickable link to RateMyProfessors (set false when nested inside a <button>) */
  interactive?: boolean;
  /** Compact variant for timetable grid blocks */
  compact?: boolean;
  className?: string;
}

export function RmpStarBadge({
  rmp,
  interactive = true,
  compact = false,
  className = "",
}: RmpStarBadgeProps) {
  if (!rmp || rmp.avgRating == null || !Number.isFinite(rmp.avgRating)) {
    return null;
  }

  const ratingStr = rmp.avgRating.toFixed(1);
  const details: string[] = [
    `${rmp.fullName} — ${ratingStr}/5 on RateMyProfessors`,
  ];
  if (rmp.numRatings > 0) {
    details.push(
      `${rmp.numRatings} ${rmp.numRatings === 1 ? "rating" : "ratings"}`,
    );
  }
  if (rmp.avgDifficulty != null) {
    details.push(`Difficulty ${rmp.avgDifficulty.toFixed(1)}/5`);
  }
  if (rmp.wouldTakeAgainPercent != null) {
    details.push(`${Math.round(rmp.wouldTakeAgainPercent)}% would take again`);
  }
  const tooltip = details.join(" · ");

  const tone =
    rmp.avgRating >= 4
      ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/70 dark:text-emerald-200"
      : rmp.avgRating >= 3
        ? "border-amber-200/80 bg-amber-50/90 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/70 dark:text-amber-200"
        : "border-rose-200/80 bg-rose-50/90 text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/70 dark:text-rose-200";

  const baseClass = compact
    ? `inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0 text-[8.5px] font-semibold leading-tight tabular-nums ${tone} ${className}`
    : `inline-flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${tone} ${className}`;

  const content = (
    <>
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className={
          compact
            ? "h-2.5 w-2.5 shrink-0 text-amber-500 dark:text-amber-400"
            : "h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400"
        }
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      <span>{ratingStr}</span>
    </>
  );

  if (interactive && rmp.legacyId) {
    return (
      <a
        href={`https://www.ratemyprofessors.com/professor/${rmp.legacyId}`}
        target="_blank"
        rel="noopener noreferrer"
        data-no-drag="true"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={tooltip}
        aria-label={tooltip}
        className={`${baseClass} transition hover:brightness-95 dark:hover:brightness-110`}
      >
        {content}
      </a>
    );
  }

  return (
    <span title={tooltip} aria-label={tooltip} className={baseClass}>
      {content}
    </span>
  );
}
