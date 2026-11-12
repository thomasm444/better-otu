"use client";

import React from "react";

import {
  collectWarnings,
  courseOf,
  creditsOf,
  isOffered,
  matchesBucket,
  placedCodes,
  placedTermIndex,
} from "@/lib/degree-planner";
import type {
  CatalogCourse,
  CustomCourse,
  DegreeProgramDetail,
  ElectiveBucket,
  OfferingEntry,
  PlannerTerm,
  RequirementModel,
  UnscheduledItem,
} from "@/lib/degree-types";

type RequirementsSidebarProps = {
  program: DegreeProgramDetail;
  model: RequirementModel;
  terms: PlannerTerm[];
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, OfferingEntry>;
  customs: Map<string, CustomCourse>;
  unscheduled: UnscheduledItem[];
  onPickBucket: (bucketKey: string) => void;
  onOpenTransferPicker: () => void;
  onPlaceTransfer: (code: string) => void;
  onRemoveTransfer: (code: string) => void;
};

export function RequirementsSidebar({
  program,
  model,
  terms,
  catalogMap,
  offeringsMap,
  customs,
  unscheduled,
  onPickBucket,
  onOpenTransferPicker,
  onPlaceTransfer,
  onRemoveTransfer,
}: RequirementsSidebarProps) {
  const placed = placedCodes(terms);
  const doneRequired = model.required.filter((r) => placed.has(r.code));

  const fixed = new Set(model.required.map((r) => r.code));
  for (const group of model.chooseGroups) {
    for (const code of group.options) fixed.add(code);
  }
  const freeCodes = [...placed].filter((code) => !fixed.has(code));

  const transfers = [...customs.values()].filter((c) => c.transfer);
  const warnings = collectWarnings(
    terms,
    model,
    unscheduled,
    catalogMap,
    offeringsMap,
    customs,
  );

  const subheader = [program.name, program.credential, program.degree_abbrev]
    .filter(Boolean)
    .join(" · ");

  const renderBucket = (bucket: ElectiveBucket) => {
    const credits = freeCodes.reduce(
      (sum, code) =>
        sum +
        (matchesBucket(courseOf(code, catalogMap, customs), bucket.match)
          ? creditsOf(code, catalogMap, customs)
          : 0),
      0,
    );
    const pct = Math.min(
      100,
      Math.round((credits / Math.max(1, bucket.credits)) * 100),
    );
    const done = credits >= bucket.credits;

    return (
      <div
        key={bucket.key}
        className="rounded-lg px-2 py-2 pl-5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <div className="flex items-baseline gap-2 text-[12.5px]">
          <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200">
            {bucket.label}
          </span>
          <span
            className={`tabular-nums text-[11.5px] ${
              done
                ? "font-semibold text-emerald-700 dark:text-emerald-400"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {credits}/{bucket.credits}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full transition-all ${
              done ? "bg-emerald-600" : "bg-blue-600"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {bucket.subs.map((sub) => {
          const subCredits = freeCodes.reduce(
            (sum, code) =>
              sum +
              (matchesBucket(courseOf(code, catalogMap, customs), sub.match)
                ? creditsOf(code, catalogMap, customs)
                : 0),
            0,
          );
          const subDone = subCredits >= sub.credits;
          return (
            <div
              key={sub.key}
              className={`mt-1 ml-3 text-[11.5px] ${
                subDone
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              ↳ {sub.label}: {subCredits}/{sub.credits} cr
            </div>
          );
        })}
        <div className="mt-1">
          <button
            type="button"
            onClick={() => onPickBucket(bucket.key)}
            className="text-[11.5px] font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Find a course
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
          What you need
        </h2>
        <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {subheader || "—"}
        </div>
      </div>

      <div className="space-y-1 p-2 pb-4">
        {/* Required courses */}
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
            <span className="text-[10px] text-zinc-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>Required courses</span>
            <span
              className={`ml-auto tabular-nums text-[11.5px] ${
                doneRequired.length === model.required.length
                  ? "font-semibold text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {doneRequired.length}/{model.required.length}
            </span>
          </summary>
          <ul className="mb-1.5 space-y-0.5 pl-5 pr-1.5">
            {model.required.map((r) => {
              const done = placed.has(r.code);
              const course = courseOf(r.code, catalogMap, customs);
              return (
                <li
                  key={r.code}
                  className="flex items-baseline gap-2 py-0.5 text-[12.5px]"
                >
                  <span
                    className={`w-3.5 shrink-0 text-center text-[11px] ${
                      done
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-zinc-300 dark:text-zinc-600"
                    }`}
                  >
                    {done ? "✓" : "○"}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-blue-800 dark:text-blue-300">
                    {r.code}
                  </span>
                  <span
                    className={`truncate ${
                      done
                        ? "text-zinc-400 dark:text-zinc-500"
                        : "text-zinc-600 dark:text-zinc-300"
                    }`}
                    title={course?.title ?? ""}
                  >
                    {course?.title ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>

        {/* Choice groups */}
        {model.chooseGroups.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
              <span className="text-[10px] text-zinc-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Choice groups</span>
              {(() => {
                const doneGroups = model.chooseGroups.filter(
                  (g) =>
                    g.options.filter((c) => placed.has(c)).length >= g.required,
                ).length;
                return (
                  <span
                    className={`ml-auto tabular-nums text-[11.5px] ${
                      doneGroups === model.chooseGroups.length
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {doneGroups}/{model.chooseGroups.length}
                  </span>
                );
              })()}
            </summary>
            <div className="space-y-1">
              {model.chooseGroups.map((group) => {
                const hits = group.options.filter((c) => placed.has(c));
                const ok = hits.length >= group.required;
                const available = group.options.filter((c) =>
                  isOffered(c, offeringsMap, customs),
                );
                const hidden = group.options.length - available.length;
                return (
                  <div
                    key={group.id}
                    className="rounded-lg px-2 py-1.5 pl-5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-200">
                        {group.label || "Choose"}
                      </span>
                      <span
                        className={`tabular-nums text-[11.5px] ${
                          ok
                            ? "font-semibold text-emerald-700 dark:text-emerald-400"
                            : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {Math.min(hits.length, group.required)}/{group.required}
                      </span>
                    </div>
                    <div className="mt-0.5 ml-3 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                      {available.slice(0, 6).join(" · ")}
                      {available.length > 6 ? " …" : ""}
                      {hidden > 0 && (
                        <span
                          title="Not offered in Fall 2026 / Winter 2027"
                          className="text-amber-700 dark:text-amber-400"
                        >
                          {" "}
                          · {hidden} not offered
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Electives */}
        {model.buckets.length > 0 && (
          <details className="group" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
              <span className="text-[10px] text-zinc-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Electives</span>
              <span className="ml-auto tabular-nums text-[11.5px] text-zinc-500 dark:text-zinc-400">
                {model.buckets.length}
              </span>
            </summary>
            <div className="space-y-1">{model.buckets.map(renderBucket)}</div>
          </details>
        )}

        {/* Breadth requirements */}
        {model.breadth.length > 0 && (
          <details className="group" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
              <span className="text-[10px] text-zinc-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Breadth requirements</span>
              {(() => {
                const done = model.breadth.filter((b) => {
                  const credits = freeCodes.reduce(
                    (sum, code) =>
                      sum +
                      (matchesBucket(
                        courseOf(code, catalogMap, customs),
                        b.match,
                      )
                        ? creditsOf(code, catalogMap, customs)
                        : 0),
                    0,
                  );
                  return credits >= b.credits;
                }).length;
                return (
                  <span
                    className={`ml-auto tabular-nums text-[11.5px] ${
                      done === model.breadth.length
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {done}/{model.breadth.length}
                  </span>
                );
              })()}
            </summary>
            <p className="px-2 pb-1 pl-5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              These overlap with the electives above — one course can satisfy
              several.
            </p>
            <div className="space-y-1">{model.breadth.map(renderBucket)}</div>
          </details>
        )}

        {/* Transfer credits */}
        <details className="group" open={transfers.length > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60">
            <span className="text-[10px] text-zinc-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>Transfer credits</span>
            <span
              className={`ml-auto tabular-nums text-[11.5px] ${
                transfers.length > 0
                  ? "font-semibold text-emerald-700 dark:text-emerald-400"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {transfers.length}
            </span>
          </summary>
          <div className="px-2 pb-2 pt-1">
            {transfers.length === 0 ? (
              <p className="px-1 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Credit earned at another institution? Add it here and it counts
                toward your electives.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {transfers.map((course) => {
                  const at = placedTermIndex(terms, course.code);
                  const where =
                    at >= 0
                      ? `Year ${terms[at].year} ${terms[at].season}`
                      : "not in the plan yet";
                  return (
                    <div
                      key={course.code}
                      className="flex items-center gap-2 py-1.5"
                    >
                      <span className="w-24 shrink-0 font-mono text-[11.5px] text-blue-800 dark:text-blue-300">
                        {course.code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-zinc-800 dark:text-zinc-200">
                          {course.title}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {course.credit_hours} cr · {course.subject}{" "}
                          {course.level} · {where}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={at >= 0}
                        onClick={() => onPlaceTransfer(course.code)}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11.5px] text-zinc-600 hover:border-blue-500 hover:text-blue-600 disabled:cursor-default disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        {at >= 0 ? "in plan" : "place"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveTransfer(course.code)}
                        title="Remove"
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11.5px] text-zinc-500 hover:border-red-500 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={onOpenTransferPicker}
              className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:border-blue-500 hover:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              ＋ Add a transfer credit
            </button>
          </div>
        </details>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="mx-1 mt-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[12.5px] dark:border-amber-900/60 dark:bg-amber-950/30">
            <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-wider text-amber-800 uppercase dark:text-amber-400">
              {warnings.length} thing{warnings.length > 1 ? "s" : ""} to check
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-zinc-700 dark:text-zinc-300">
              {warnings.slice(0, 8).map((w) => (
                <li key={w.id}>{w.text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
