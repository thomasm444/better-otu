"use client";

import React, { useMemo, useState } from "react";

import {
  allocateBuckets,
  assignBreadthBuckets,
  type BucketAllocation,
  collectWarnings,
  courseOf,
  creditsOf,
  earnedCodes,
  evaluateDegreeRules,
  evaluatePlanRequirements,
  expandWithEquivalents,
  findEquivalentInSet,
  isOffered,
  matchesBucket,
  MAX_SLOTS_PER_TERM,
  offeredIn,
  placedTermIndex,
  seasonsOf,
  termCalendarYear,
} from "@/lib/degree-planner";
import type {
  CatalogCourse,
  CustomCourse,
  DegreeProgramDetail,
  ElectiveBucket,
  OfferingContext,
  OfferingEntry,
  PlannerTerm,
  ProgramSummary,
  RequirementModel,
  UnscheduledItem,
} from "@/lib/degree-types";

type RequirementsSidebarProps = {
  program: DegreeProgramDetail;
  model: RequirementModel;
  terms: PlannerTerm[];
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, OfferingEntry>;
  offeringContext: OfferingContext;
  startYear: number;
  customs: Map<string, CustomCourse>;
  unscheduled: UnscheduledItem[];
  planMismatches?: Map<string, string>;
  equivMap?: Map<string, Set<string>>;
  onPickBucket: (bucketKey: string) => void;
  onOpenTransferPicker: () => void;
  onRemoveTransfer: (code: string) => void;
  activeTab: "major" | "minor";
  onTabChange: (tab: "major" | "minor") => void;
  minorProgram: DegreeProgramDetail | null;
  minorModel: RequirementModel | null;
  minorOptions: ProgramSummary[];
  loadingMinor?: boolean;
  onSelectMinor: (summary: ProgramSummary) => void;
  onRemoveMinor: () => void;
  onPickMinorBucket: (bucketKey: string) => void;
  onPlaceCourseInTerm: (termIndex: number, code: string) => void;
  onOpenMinorSearch: (initialQuery?: string) => void;
};

function parseSectionNotes(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      // Fall through to plain text
    }
  }
  return [trimmed];
}

export function RequirementsSidebar({
  program,
  model,
  terms,
  catalogMap,
  offeringsMap,
  offeringContext,
  startYear,
  customs,
  unscheduled,
  planMismatches,
  equivMap,
  onPickBucket,
  onOpenTransferPicker,
  onRemoveTransfer,
  activeTab,
  onTabChange,
  minorProgram,
  minorModel,
  minorOptions,
  loadingMinor = false,
  onSelectMinor,
  onRemoveMinor,
  onPickMinorBucket,
  onPlaceCourseInTerm,
  onOpenMinorSearch,
}: RequirementsSidebarProps) {
  const [minorQuery, setMinorQuery] = useState("");
  const [changingMinor, setChangingMinor] = useState(false);
  const [pendingAddKey, setPendingAddKey] = useState<string | null>(null);
  const [selectedTermIndex, setSelectedTermIndex] = useState<number>(0);
  const [breadthOverrides, setBreadthOverrides] = useState<
    Record<string, string>
  >({});
  const [draggingBreadthCode, setDraggingBreadthCode] = useState<string | null>(
    null,
  );
  const [dragOverBucketKey, setDragOverBucketKey] = useState<string | null>(
    null,
  );
  const [expandedChoiceGroups, setExpandedChoiceGroups] = useState<
    Record<string, boolean>
  >({});

  const updateBreadthOverride = (code: string, bucketKey: string) => {
    setBreadthOverrides((prev) => ({ ...prev, [code]: bucketKey }));
  };

  const toggleChoiceGroupExpanded = (groupKey: string) => {
    setExpandedChoiceGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const openInlineTermChooser = (rowKey: string, code: string) => {
    if (pendingAddKey === rowKey) {
      setPendingAddKey(null);
      return;
    }
    const course = courseOf(code, catalogMap, customs);
    const targetYear = course?.level
      ? Math.max(1, Math.min(4, Math.floor(course.level / 1000)))
      : 1;

    // Pick a sensible default term: non-full, offered, near the course's level
    let bestIndex = -1;
    let bestScore = -1;
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      const usedCount = t.slots.filter(Boolean).length;
      if (usedCount >= MAX_SLOTS_PER_TERM) continue;
      const calYear = termCalendarYear(startYear, t.year, t.season);
      const runs = offeredIn(code, t.season, offeringsMap, customs, {
        calendarYear: calYear,
        context: offeringContext,
      });
      const hasEmpty = t.slots.includes(null);
      const levelMatch = t.year >= targetYear ? 2 : 0;
      const score = (runs ? 4 : 0) + (hasEmpty ? 2 : 0) + levelMatch;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    setSelectedTermIndex(bestIndex >= 0 ? bestIndex : 0);
    setPendingAddKey(rowKey);
  };

  const renderInlineTermChooser = (
    rowKey: string,
    code: string,
    accent: "major" | "minor" = "minor",
  ) => {
    if (pendingAddKey !== rowKey) return null;
    const course = courseOf(code, catalogMap, customs);
    const targetTerm = terms[selectedTermIndex];
    const targetFull =
      !targetTerm ||
      targetTerm.slots.filter(Boolean).length >= MAX_SLOTS_PER_TERM;
    const offeredSeasons = seasonsOf(code, offeringsMap, customs, {
      academicBaseYear: targetTerm
        ? startYear + (targetTerm.year - 1)
        : startYear,
      context: offeringContext,
    });
    const isMajor = accent === "major";

    return (
      <div
        className={`mt-1.5 rounded-xl border p-2.5 ${
          isMajor
            ? "border-sky-200/90 bg-sky-50/75 shadow-[0_1px_4px_rgba(14,165,233,0.06)] dark:border-sky-800/70 dark:bg-sky-950/35"
            : "border-violet-200/90 bg-violet-50/75 shadow-[0_1px_4px_rgba(124,58,237,0.06)] dark:border-violet-800/70 dark:bg-violet-950/35"
        }`}
      >
        <div className="text-[11px] font-medium text-slate-800 dark:text-slate-200">
          Add{" "}
          <span
            className={`font-mono font-semibold ${
              isMajor
                ? "text-sky-700 dark:text-sky-300"
                : "text-violet-700 dark:text-violet-300"
            }`}
          >
            {code}
          </span>
          {course?.title ? ` — ${course.title}` : ""}
        </div>
        <div className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
          {creditsOf(code, catalogMap, customs)} cr
          {offeredSeasons.length > 0
            ? ` · Usually offered: ${offeredSeasons.join(", ")}`
            : ""}
        </div>

        {terms.length === 0 ? (
          <div className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            Add a year to your degree plan first.
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="text-[10.5px] font-medium text-slate-600 dark:text-slate-300">
              Choose year &amp; term:
              <select
                value={selectedTermIndex}
                onChange={(e) => setSelectedTermIndex(Number(e.target.value))}
                className={`mt-1 w-full rounded-lg border bg-white px-2 py-1 text-xs font-medium text-slate-900 focus:ring-2 focus:outline-none dark:bg-slate-900 dark:text-slate-100 ${
                  isMajor
                    ? "border-sky-200/90 focus:border-sky-400 focus:ring-sky-400/20 dark:border-sky-800/80"
                    : "border-violet-200/90 focus:border-violet-400 focus:ring-violet-400/20 dark:border-violet-800/80"
                }`}
              >
                {terms.map((t, idx) => {
                  const usedCount = t.slots.filter(Boolean).length;
                  const isFull = usedCount >= MAX_SLOTS_PER_TERM;
                  const calYear = termCalendarYear(startYear, t.year, t.season);
                  const runs = offeredIn(code, t.season, offeringsMap, customs, {
                    calendarYear: calYear,
                    context: offeringContext,
                  });
                  return (
                    <option key={`${t.year}-${t.season}-${idx}`} value={idx} disabled={isFull}>
                      Year {t.year} · {t.season} {calYear} ({usedCount}/
                      {MAX_SLOTS_PER_TERM}
                      {isFull ? " full" : ""}
                      {runs ? " · offered" : ""})
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setPendingAddKey(null)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={targetFull}
                onClick={() => {
                  onPlaceCourseInTerm(selectedTermIndex, code);
                  setPendingAddKey(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isMajor
                    ? "bg-sky-600 hover:bg-sky-700"
                    : "bg-violet-600 hover:bg-violet-700"
                }`}
              >
                Add to plan
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCourseOptionRow = ({
    rowKey,
    code,
    placedSet,
    accent,
    compact = false,
  }: {
    rowKey: string;
    code: string;
    placedSet: Set<string>;
    accent: "major" | "minor";
    compact?: boolean;
  }) => {
    const matchedCode = findEquivalentInSet(code, placedSet, equivMap);
    const picked = Boolean(matchedCode);
    const atIdx = matchedCode ? placedTermIndex(terms, matchedCode) : -1;
    const placedTerm = atIdx >= 0 ? terms[atIdx] : null;
    const course = courseOf(code, catalogMap, customs);
    const isAdding = pendingAddKey === rowKey;
    const isMajor = accent === "major";

    return (
      <li
        key={rowKey}
        className={compact ? "py-0.5 text-[11px]" : "py-0.5 text-[12px]"}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`w-3 shrink-0 text-center text-[10.5px] ${
              picked
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-300 dark:text-slate-600"
            }`}
          >
            {picked ? "✓" : "○"}
          </span>
          <span
            className={`shrink-0 font-mono font-medium ${
              compact ? "text-[10.5px]" : "text-[11px]"
            } ${
              isMajor
                ? "text-sky-700 dark:text-sky-300"
                : "text-violet-700 dark:text-violet-300"
            }`}
          >
            {code}
          </span>
          <span
            className={`min-w-0 flex-1 truncate ${
              compact ? "text-[11px]" : "text-[11.5px]"
            } ${
              picked
                ? "text-slate-400 dark:text-slate-500"
                : "text-slate-700 dark:text-slate-300"
            }`}
            title={
              course?.title
                ? matchedCode && matchedCode !== code
                  ? `${code} — ${course.title} (satisfied by ${matchedCode})`
                  : `${code} — ${course.title}`
                : code
            }
          >
            {course?.title ?? "Course title unavailable"}
          </span>
          {picked && placedTerm ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Y{placedTerm.year} {placedTerm.season}
            </span>
          ) : picked ? (
            <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              Transfer
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openInlineTermChooser(rowKey, code)}
              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                isAdding
                  ? isMajor
                    ? "border-sky-500 bg-sky-600 text-white"
                    : "border-violet-500 bg-violet-600 text-white"
                  : isMajor
                    ? "border-slate-200 bg-white text-slate-600 hover:border-sky-400 hover:bg-sky-50/70 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-500"
                    : "border-slate-200 bg-white text-slate-700 hover:border-violet-400 hover:bg-violet-50/70 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-500"
              }`}
            >
              {isAdding ? "Close" : "+ Add"}
            </button>
          )}
        </div>
        {!picked && renderInlineTermChooser(rowKey, code, accent)}
      </li>
    );
  };

  const placed = useMemo(() => earnedCodes(terms, customs), [terms, customs]);
  const doneRequired = model.required.filter((r) =>
    Boolean(findEquivalentInSet(r.code, placed, equivMap)),
  );

  const { freeCodes, chooseHits } = useMemo(
    () =>
      evaluatePlanRequirements(placed, model, catalogMap, customs, equivMap),
    [placed, model, catalogMap, customs, equivMap],
  );

  const breadthAssignment = useMemo(
    () =>
      assignBreadthBuckets(
        freeCodes,
        model.breadth,
        catalogMap,
        customs,
        breadthOverrides,
      ),
    [freeCodes, model.breadth, catalogMap, customs, breadthOverrides],
  );

  const degreeRules = useMemo(
    () => evaluateDegreeRules(program, placed, catalogMap, customs),
    [program, placed, catalogMap, customs],
  );

  const majorElectiveAllocations = useMemo(
    () => allocateBuckets(model.buckets, freeCodes, catalogMap, customs),
    [model.buckets, freeCodes, catalogMap, customs],
  );

  const minorCourseSet = useMemo(() => {
    if (!minorModel) return new Set<string>();
    const raw = new Set<string>(minorModel.required.map((r) => r.code));
    for (const g of minorModel.chooseGroups) {
      for (const c of g.options) raw.add(c);
    }
    return expandWithEquivalents(raw, equivMap);
  }, [minorModel, equivMap]);

  const minorStats = useMemo(() => {
    if (!minorProgram || !minorModel) return null;

    const doneReq = minorModel.required.filter((r) =>
      Boolean(findEquivalentInSet(r.code, placed, equivMap)),
    );
    const { freeCodes: minorFree, chooseHits: minorChooseHits } =
      evaluatePlanRequirements(
        placed,
        minorModel,
        catalogMap,
        customs,
        equivMap,
      );
    const minorFixed = new Set(minorModel.required.map((r) => r.code));
    for (const g of minorModel.chooseGroups) {
      for (const code of g.options) minorFixed.add(code);
    }
    const minorBucketAllocations = allocateBuckets(
      minorModel.buckets,
      minorFree,
      catalogMap,
      customs,
    );

    let completedSteps = doneReq.length;
    let totalSteps = minorModel.required.length;
    let placedCredits = doneReq.reduce(
      (sum, r) => sum + creditsOf(r.code, catalogMap, customs),
      0,
    );

    for (const g of minorModel.chooseGroups) {
      const taken = Math.min(minorChooseHits.get(g.id) ?? 0, g.required);
      completedSteps += taken;
      totalSteps += g.required;
      const hits = g.options.filter((c) =>
        Boolean(findEquivalentInSet(c, placed, equivMap)),
      );
      for (const c of hits.slice(0, taken)) {
        placedCredits += creditsOf(c, catalogMap, customs);
      }
      if (taken > hits.length && g.elective) {
        placedCredits += (taken - hits.length) * (g.elective.credits || 3);
      }
    }

    for (const b of minorModel.buckets) {
      const bCredits = minorBucketAllocations.get(b.key)?.credits ?? 0;
      placedCredits += Math.min(bCredits, b.credits);
    }

    const subjectCounts = new Map<string, number>();
    for (const code of minorFixed) {
      const subj = code.split(/\s+/)[0];
      if (subj) subjectCounts.set(subj, (subjectCounts.get(subj) ?? 0) + 1);
    }
    const primarySubject =
      [...subjectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    const notes = minorProgram.sections
      .filter((s) => s.role === "info")
      .map((s) => ({
        id: s.section_id,
        title: s.title_clean || s.title || "",
        lines: parseSectionNotes(s.description),
      }))
      .filter(
        (entry) =>
          entry.lines.length > 0 &&
          !/admission|academic requirements to major\/minor/i.test(entry.title),
      );

    return {
      doneReq,
      minorFree,
      minorBucketAllocations,
      completedSteps,
      totalSteps,
      placedCredits,
      primarySubject,
      notes,
    };
  }, [minorProgram, minorModel, placed, equivMap, catalogMap, customs]);

  const filteredMinors = useMemo(() => {
    const q = minorQuery.trim().toLowerCase();
    return minorOptions.filter(
      (m) =>
        !q ||
        `${m.name} ${m.degree ?? ""} ${m.faculty ?? ""}`
          .toLowerCase()
          .includes(q),
    );
  }, [minorOptions, minorQuery]);

  const transfers = [...customs.values()].filter((c) => c.transfer);
  const warnings = collectWarnings(
    terms,
    model,
    unscheduled,
    catalogMap,
    offeringsMap,
    customs,
    { startYear, context: offeringContext, planMismatches, equivMap },
  );

  const subheader = [program.name, program.credential, program.degree_abbrev]
    .filter(Boolean)
    .join(" · ");

  const renderBucket = (
    bucket: ElectiveBucket,
    allocation: BucketAllocation | undefined,
    poolFreeCodes: string[],
    onFindCourse: (bucketKey: string) => void,
    accent: "major" | "minor" = "major",
    labelOverride?: string,
  ) => {
    const rawCredits = allocation?.credits ?? 0;
    const assignedCodes = allocation?.assignedCodes ?? [];
    const shownCredits = Math.min(rawCredits, bucket.credits);
    const extraCredits = Math.max(0, rawCredits - bucket.credits);
    const pct = Math.min(
      100,
      Math.round((shownCredits / Math.max(1, bucket.credits)) * 100),
    );
    const done = rawCredits >= bucket.credits;
    const displayLabel = labelOverride ?? bucket.label;

    return (
      <div
        key={bucket.key}
        className="rounded-xl px-2 py-2 pl-5 transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-800/50"
      >
        <div className="flex items-baseline gap-2 text-[12.5px]">
          <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-200">
            {displayLabel}
          </span>
          <span
            className={`shrink-0 tabular-nums text-[11.5px] ${
              done
                ? "font-semibold text-emerald-700 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {shownCredits}/{bucket.credits} cr{done ? " ✓" : ""}
            {extraCredits > 0 && (
              <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">
                (+{extraCredits} extra)
              </span>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              done
                ? "bg-gradient-to-r from-emerald-400 to-teal-400"
                : accent === "minor"
                  ? "bg-gradient-to-r from-violet-400 to-purple-400"
                  : "bg-gradient-to-r from-sky-400 to-teal-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {assignedCodes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {assignedCodes.slice(0, 4).map((code) => {
              const c = courseOf(code, catalogMap, customs);
              const fromMinor = minorCourseSet.has(code);
              return (
                <span
                  key={code}
                  title={`${code}${c?.title ? ` — ${c.title}` : ""}${fromMinor ? " (also in Minor)" : ""}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${
                    fromMinor
                      ? "border-violet-200/80 bg-violet-50/75 text-violet-700 dark:border-violet-800/70 dark:bg-violet-950/40 dark:text-violet-300"
                      : "border-slate-200/85 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  <span>{code}</span>
                  {fromMinor && (
                    <span className="font-sans text-[9px] font-semibold opacity-80">
                      · Minor
                    </span>
                  )}
                </span>
              );
            })}
            {assignedCodes.length > 4 && (
              <span
                title={assignedCodes.slice(4).join(", ")}
                className="text-[10px] font-medium text-slate-400 dark:text-slate-500"
              >
                +{assignedCodes.length - 4} more
              </span>
            )}
          </div>
        )}
        {bucket.subs.map((sub) => {
          const rawSubCredits = poolFreeCodes.reduce((sum, code) => {
            const c = courseOf(code, catalogMap, customs);
            return (
              sum +
              (matchesBucket(c, bucket.match) && matchesBucket(c, sub.match)
                ? creditsOf(code, catalogMap, customs)
                : 0)
            );
          }, 0);
          const shownSub = Math.min(rawSubCredits, sub.credits);
          const subDone = rawSubCredits >= sub.credits;
          return (
            <div
              key={sub.key}
              className={`mt-1 ml-2 text-[11px] ${
                subDone
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              ↳ {sub.label}: {shownSub}/{sub.credits} cr{subDone ? " ✓" : ""}
            </div>
          );
        })}
        <div className="mt-1">
          <button
            type="button"
            onClick={() => onFindCourse(bucket.key)}
            className={`text-[11.5px] font-medium hover:underline ${
              accent === "minor"
                ? "text-violet-600 dark:text-violet-400"
                : "text-sky-600 dark:text-sky-400"
            }`}
          >
            {done ? "Browse more courses" : "Find a course"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/92 shadow-[0_2px_12px_rgba(15,23,42,0.04)] backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/88 lg:max-h-[calc(100vh-170px)] lg:overflow-auto">
      <div className="sticky top-0 z-10 border-b border-slate-200/75 bg-gradient-to-r from-sky-50/85 via-white/95 to-violet-50/85 px-4 pt-3 pb-2.5 backdrop-blur-md dark:border-slate-800 dark:from-sky-950/35 dark:via-slate-900/95 dark:to-violet-950/35">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-300">
            What you need
          </h2>
          <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">
            {activeTab === "major"
              ? subheader || "—"
              : minorProgram?.name || "No minor selected"}
          </span>
        </div>

        {/* Major | Minor Switcher Tabs */}
        <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1 dark:bg-slate-800/80">
          <button
            type="button"
            onClick={() => onTabChange("major")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "major"
                ? "bg-white text-sky-900 shadow-xs ring-1 ring-sky-200/75 dark:bg-slate-900 dark:text-sky-200 dark:ring-sky-800/60"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>Major</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                activeTab === "major"
                  ? "bg-sky-100/85 text-sky-700 dark:bg-sky-950/75 dark:text-sky-300"
                  : "bg-slate-200/75 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              }`}
            >
              {doneRequired.length}/{model.required.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("minor")}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "minor"
                ? "bg-white text-violet-900 shadow-xs ring-1 ring-violet-200/75 dark:bg-slate-900 dark:text-violet-200 dark:ring-violet-800/60"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>Minor</span>
            {minorProgram && minorStats ? (
              <span className="rounded-full bg-violet-100/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-700 dark:bg-violet-950/75 dark:text-violet-300">
                {minorStats.completedSteps}/{minorStats.totalSteps}
              </span>
            ) : (
              <span className="rounded-full bg-violet-100/70 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                + Add
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === "major" ? (
      <div className="space-y-1 p-2.5 pb-4">
        {/* Required courses */}
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
            <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>Required courses</span>
            <span
              className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                doneRequired.length === model.required.length
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
              }`}
            >
              {doneRequired.length}/{model.required.length}
            </span>
          </summary>
          <ul className="mb-1.5 space-y-0.5 pl-5 pr-1.5">
            {model.required.map((r) => {
              const matchedCode = findEquivalentInSet(r.code, placed, equivMap);
              const done = Boolean(matchedCode);
              const viaEquiv =
                matchedCode && matchedCode !== r.code ? matchedCode : null;
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
                        : "text-slate-300 dark:text-slate-600"
                    }`}
                  >
                    {done ? "✓" : "○"}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] font-medium text-sky-700 dark:text-sky-300">
                    {r.code}
                  </span>
                  <span
                    className={`truncate ${
                      done
                        ? "text-slate-400 dark:text-slate-500"
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                    title={
                      viaEquiv
                        ? `${course?.title ?? ""} (satisfied by equivalent ${viaEquiv})`
                        : (course?.title ?? "")
                    }
                  >
                    {course?.title ?? ""}
                  </span>
                  {viaEquiv && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      via {viaEquiv}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>

        {/* Choice groups */}
        {model.chooseGroups.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Choice groups</span>
              {(() => {
                const doneGroups = model.chooseGroups.filter(
                  (g) => (chooseHits.get(g.id) ?? 0) >= g.required,
                ).length;
                return (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                      doneGroups === model.chooseGroups.length
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    }`}
                  >
                    {doneGroups}/{model.chooseGroups.length}
                  </span>
                );
              })()}
            </summary>
            <div className="space-y-2 pl-3 pr-1 pb-1">
              {model.chooseGroups.map((group) => {
                const hitCount = chooseHits.get(group.id) ?? 0;
                const ok = hitCount >= group.required;
                const available = group.options.filter((c) =>
                  isOffered(c, offeringsMap, customs),
                );
                const hidden = group.options.length - available.length;
                const listCodes =
                  available.length > 0 ? available : group.options;
                const groupKey = `major-choose:${group.id}`;
                const expanded = Boolean(expandedChoiceGroups[groupKey]);
                const visibleCodes =
                  expanded || listCodes.length <= 6
                    ? listCodes
                    : listCodes.slice(0, 6);
                return (
                  <div
                    key={group.id}
                    className="rounded-xl border border-slate-200/75 bg-slate-50/65 p-2.5 dark:border-slate-800 dark:bg-slate-950/45"
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 font-medium text-slate-800 dark:text-slate-200">
                        {group.label || "Choose"}
                      </span>
                      <span
                        className={`shrink-0 tabular-nums text-[11px] ${
                          ok
                            ? "font-semibold text-emerald-700 dark:text-emerald-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {Math.min(hitCount, group.required)}/{group.required}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {visibleCodes.map((code) =>
                        renderCourseOptionRow({
                          rowKey: `major-choose:${group.id}:${code}`,
                          code,
                          placedSet: placed,
                          accent: "major",
                          compact: true,
                        }),
                      )}
                    </ul>
                    {group.elective && (
                      <div className="mt-1 pl-4 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                        Or: {group.elective.label}
                      </div>
                    )}
                    {(listCodes.length > 6 || hidden > 0) && (
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                        {listCodes.length > 6 ? (
                          <button
                            type="button"
                            onClick={() => toggleChoiceGroupExpanded(groupKey)}
                            className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {expanded
                              ? "Show fewer ▴"
                              : `Show all ${listCodes.length} options ▾`}
                          </button>
                        ) : (
                          <span />
                        )}
                        {hidden > 0 && (
                          <span
                            title="Not offered in recent Fall / Winter terms"
                            className="text-amber-700 dark:text-amber-400"
                          >
                            {hidden} not offered
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Electives */}
        {model.buckets.length > 0 && (
          <details className="group" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Electives</span>
              {(() => {
                const doneBuckets = model.buckets.filter(
                  (b) =>
                    (majorElectiveAllocations.get(b.key)?.credits ?? 0) >=
                    b.credits,
                ).length;
                return (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                      doneBuckets === model.buckets.length
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    }`}
                  >
                    {doneBuckets}/{model.buckets.length}
                  </span>
                );
              })()}
            </summary>
            <div className="space-y-1">
              {model.buckets.map((b) =>
                renderBucket(
                  b,
                  majorElectiveAllocations.get(b.key),
                  freeCodes,
                  onPickBucket,
                  "major",
                ),
              )}
            </div>
          </details>
        )}

        {/* Elective mix (Breadth) */}
        {model.breadth.length > 0 && (
          <details className="group" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Elective mix (Breadth)</span>
              {(() => {
                const done = model.breadth.filter((b) => {
                  const assigned =
                    breadthAssignment.assignedByBucket.get(b.key) ?? [];
                  const credits = assigned.reduce(
                    (sum, code) => sum + creditsOf(code, catalogMap, customs),
                    0,
                  );
                  return credits >= b.credits;
                }).length;
                return (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                      done === model.breadth.length
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    }`}
                  >
                    {done}/{model.breadth.length}
                  </span>
                );
              })()}
            </summary>
            <p className="px-2 pb-1 pl-5 text-[11.5px] text-slate-500 dark:text-slate-400">
              Mutually exclusive — drag courses between eligible buckets to
              rearrange.
            </p>
            <div className="space-y-1.5">
              {model.breadth.map((b) => {
                const assigned =
                  breadthAssignment.assignedByBucket.get(b.key) ?? [];
                const credits = assigned.reduce(
                  (sum, code) => sum + creditsOf(code, catalogMap, customs),
                  0,
                );
                const pct = Math.min(
                  100,
                  Math.round((credits / Math.max(1, b.credits)) * 100),
                );
                const done = credits >= b.credits;
                const isNonCsciScience =
                  Boolean(b.match.faculties?.includes("Faculty of Science")) &&
                  Boolean(b.match.exclude_subjects?.includes("CSCI"));
                const canDropHere = Boolean(
                  draggingBreadthCode &&
                    matchesBucket(
                      courseOf(draggingBreadthCode, catalogMap, customs),
                      b.match,
                    ),
                );
                const isDropTarget = dragOverBucketKey === b.key && canDropHere;

                return (
                  <details
                    key={b.key}
                    open
                    onDragOver={(e) => {
                      if (!canDropHere) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverBucketKey !== b.key) {
                        setDragOverBucketKey(b.key);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverBucketKey === b.key) {
                        setDragOverBucketKey(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const code =
                        e.dataTransfer.getData("text/breadth-code") ||
                        draggingBreadthCode;
                      setDragOverBucketKey(null);
                      setDraggingBreadthCode(null);
                      if (!code) return;
                      if (
                        matchesBucket(
                          courseOf(code, catalogMap, customs),
                          b.match,
                        )
                      ) {
                        updateBreadthOverride(code, b.key);
                      }
                    }}
                    className={`group/bucket rounded-xl border px-2 py-2 pl-3 transition-all ${
                      isDropTarget
                        ? "border-sky-400 bg-sky-50/70 ring-2 ring-sky-400/35 dark:border-sky-600 dark:bg-sky-950/40"
                        : canDropHere
                          ? "border-dashed border-sky-300/80 bg-sky-50/25 dark:border-sky-800/70 dark:bg-sky-950/15"
                          : "border-transparent hover:bg-slate-50/90 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-baseline gap-2 text-[12.5px]">
                        <span className="text-[10px] text-slate-400 transition-transform group-open/bucket:rotate-90">
                          ▸
                        </span>
                        <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-200">
                          {b.label}
                        </span>
                        <span
                          className={`tabular-nums text-[11.5px] ${
                            done
                              ? "font-semibold text-emerald-700 dark:text-emerald-400"
                              : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {credits}/{b.credits}
                        </span>
                      </div>
                      <div className="mt-1.5 ml-4 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            done
                              ? "bg-gradient-to-r from-emerald-400 to-teal-400"
                              : "bg-gradient-to-r from-sky-400 to-teal-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </summary>

                    <div className="mt-1.5 space-y-1.5 pl-4">
                      {b.subs.map((sub) => {
                        const subCredits = assigned.reduce(
                          (sum, code) =>
                            sum +
                            (matchesBucket(
                              courseOf(code, catalogMap, customs),
                              sub.match,
                            )
                              ? creditsOf(code, catalogMap, customs)
                              : 0),
                          0,
                        );
                        const subDone = subCredits >= sub.credits;
                        return (
                          <div
                            key={sub.key}
                            className={`text-[11.5px] ${
                              subDone
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            ↳ {sub.label}: {subCredits}/{sub.credits} cr
                          </div>
                        );
                      })}

                      {isNonCsciScience && (
                        <div className="text-[10.5px] text-slate-400 dark:text-slate-500">
                          Eligible: MATH, PHY, BIOL, CHEM, ENVS, FSCI, STAT,
                          SUST 1001U (not CSCI)
                        </div>
                      )}

                      {assigned.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {assigned.map((code) => {
                            const course = courseOf(code, catalogMap, customs);
                            const eligibleCount = model.breadth.filter((bk) =>
                              matchesBucket(course, bk.match),
                            ).length;
                            const fromMinor = minorCourseSet.has(code);
                            const displayLabel =
                              course &&
                              "transfer" in course &&
                              course.transfer &&
                              course.transfer_kind === "general"
                                ? `General (${course.credit_hours} cr)`
                                : code;
                            return (
                              <span
                                key={code}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    "text/breadth-code",
                                    code,
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                  setDraggingBreadthCode(code);
                                }}
                                onDragEnd={() => {
                                  setDraggingBreadthCode(null);
                                  setDragOverBucketKey(null);
                                }}
                                title={`${
                                  eligibleCount > 1
                                    ? "Drag to another eligible bucket"
                                    : "Only eligible for this bucket"
                                }${fromMinor ? " (also in Minor)" : ""}`}
                                className={`inline-flex cursor-grab items-center gap-1 rounded-lg border px-1.5 py-0.5 font-mono text-[10.5px] font-medium shadow-2xs transition-colors active:cursor-grabbing ${
                                  fromMinor
                                    ? "border-violet-200/80 bg-violet-50/75 text-violet-700 hover:border-violet-300 dark:border-violet-800/70 dark:bg-violet-950/40 dark:text-violet-300"
                                    : "border-slate-200/85 bg-white text-slate-700 hover:border-sky-300 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300"
                                }`}
                              >
                                <span className="text-[9px] text-slate-400">
                                  ⋮⋮
                                </span>
                                <span>{displayLabel}</span>
                                {fromMinor && (
                                  <span className="font-sans text-[9px] font-semibold opacity-80">
                                    · Minor
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div>
                        <button
                          type="button"
                          onClick={() => onPickBucket(b.key)}
                          className="text-[11.5px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                        >
                          Find a course
                        </button>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        )}

        {/* Level & credit rules (from Note:) */}
        {(degreeRules.rules.maxFirstYearCredits !== null ||
          degreeRules.rules.min4000CsciCredits !== null) && (
          <details className="group" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
              <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              <span>Level &amp; credit rules</span>
            </summary>
            <div className="space-y-1.5 px-2 pb-2 pl-5">
              {degreeRules.rules.maxFirstYearCredits !== null && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-700 dark:text-slate-300">
                    First-year (1000-level) limit
                  </span>
                  <span
                    className={`tabular-nums font-semibold ${
                      degreeRules.firstYearCredits <=
                      degreeRules.rules.maxFirstYearCredits
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {degreeRules.firstYearCredits}/
                    {degreeRules.rules.maxFirstYearCredits} max cr
                  </span>
                </div>
              )}
              {degreeRules.rules.min4000CsciCredits !== null && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-700 dark:text-slate-300">
                    4000-level CSCI minimum
                  </span>
                  <span
                    className={`tabular-nums font-semibold ${
                      degreeRules.csci4000Credits >=
                      degreeRules.rules.min4000CsciCredits
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {degreeRules.csci4000Credits}/
                    {degreeRules.rules.min4000CsciCredits} min cr
                  </span>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Transfer credits */}
        <details className="group" open={transfers.length > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
            <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>Transfer credits</span>
            <span
              className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                transfers.length > 0
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {transfers.length}
            </span>
          </summary>
          <div className="px-2 pb-2 pt-1">
            {transfers.length === 0 ? (
              <p className="px-1 py-1.5 text-xs text-slate-500 dark:text-slate-400">
                Credit earned at another institution? Add it here — it counts
                toward your degree without taking a term slot.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {transfers.map((course) => {
                  const isEquivalent =
                    course.transfer_kind === "equivalent" ||
                    Boolean(course.equivalent_code) ||
                    Boolean(course.subject);
                  const displayCode = isEquivalent
                    ? course.equivalent_code || course.code
                    : "General";
                  return (
                    <div
                      key={course.code}
                      className="flex items-center gap-2 py-1.5"
                    >
                      <span
                        className={`w-24 shrink-0 font-mono text-[11.5px] font-medium ${
                          isEquivalent
                            ? "text-indigo-700 dark:text-indigo-300"
                            : "text-teal-700 dark:text-teal-300"
                        }`}
                      >
                        {displayCode}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-slate-800 dark:text-slate-200">
                          {course.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {course.credit_hours} cr · {course.level} level ·{" "}
                          {isEquivalent
                            ? "equivalent class"
                            : "outside FSci / general"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveTransfer(course.code)}
                        title="Remove"
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] text-slate-500 transition-colors hover:border-rose-400 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
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
              className="mt-2 w-full rounded-xl border border-dashed border-indigo-200/90 bg-indigo-50/40 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50/80 dark:border-indigo-800/70 dark:bg-indigo-950/25 dark:text-indigo-300 dark:hover:bg-indigo-950/45"
            >
              ＋ Add a transfer credit
            </button>
          </div>
        </details>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="mx-1 mt-2 rounded-2xl border border-amber-200/90 bg-amber-50/80 px-3.5 py-2.5 text-[12.5px] dark:border-amber-900/60 dark:bg-amber-950/30">
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-amber-800 uppercase dark:text-amber-400">
              {warnings.length} thing{warnings.length > 1 ? "s" : ""} to check
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-slate-700 dark:text-slate-300">
              {warnings.slice(0, 8).map((w) => (
                <li key={w.id}>{w.text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      ) : (
      <div className="space-y-3 p-3 pb-4">
        {loadingMinor ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading minor requirements…
          </div>
        ) : !minorProgram || !minorModel || !minorStats || changingMinor ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {minorProgram ? "Switch minor" : "Add a minor to your degree"}
                </div>
                <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                  Minor courses share the same term grid and count automatically.
                </p>
              </div>
              {minorProgram && (
                <button
                  type="button"
                  onClick={() => setChangingMinor(false)}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
              )}
            </div>

            <input
              type="text"
              value={minorQuery}
              onChange={(e) => setMinorQuery(e.target.value)}
              placeholder={`Search ${minorOptions.length} minors (${program.catalog_year})…`}
              className="w-full rounded-xl border border-slate-200/90 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-400/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />

            <div className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200/80 bg-slate-50/40 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/40">
              {filteredMinors.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No minors match for {program.catalog_year}.
                </div>
              ) : (
                filteredMinors.map((m) => {
                  const isSelected = minorProgram?.program_id === m.program_id;
                  return (
                    <button
                      key={m.program_id}
                      type="button"
                      onClick={() => {
                        setChangingMinor(false);
                        setMinorQuery("");
                        onSelectMinor(m);
                      }}
                      className={`block w-full px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-violet-50/90 dark:bg-violet-950/45"
                          : "hover:bg-white dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                          {m.name}
                        </span>
                        {m.total_credit_hours && (
                          <span className="shrink-0 text-[10.5px] text-slate-500 tabular-nums dark:text-slate-400">
                            {m.total_credit_hours} cr
                          </span>
                        )}
                      </div>
                      {m.degree && (
                        <span className="block text-[10.5px] text-slate-500 dark:text-slate-400">
                          {m.degree}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Active Minor Banner */}
            <div className="rounded-xl border border-violet-200/85 bg-gradient-to-r from-violet-50/90 via-purple-50/65 to-fuchsia-50/45 px-3 py-2.5 dark:border-violet-800/60 dark:from-violet-950/45 dark:via-purple-950/30 dark:to-slate-900/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {minorProgram.name}
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-violet-700 tabular-nums dark:text-violet-300">
                    {minorStats.placedCredits}
                    {minorProgram.total_credit_hours
                      ? ` / ${minorProgram.total_credit_hours} cr`
                      : " cr"}{" "}
                    · {minorStats.completedSteps}/{minorStats.totalSteps} core
                    checked
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setChangingMinor(true)}
                    className="rounded-lg border border-violet-200/90 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-300 dark:hover:bg-violet-950/60"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={onRemoveMinor}
                    title="Remove minor"
                    aria-label="Remove minor"
                    className="rounded-lg border border-slate-200/90 bg-white/90 px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            {/* Minor Required Courses */}
            {minorModel.required.length > 0 && (
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  <span>Required minor courses</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                      minorStats.doneReq.length === minorModel.required.length
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    }`}
                  >
                    {minorStats.doneReq.length}/{minorModel.required.length}
                  </span>
                </summary>
                <ul className="mb-1.5 space-y-1 pl-4 pr-1">
                  {minorModel.required.map((r) =>
                    renderCourseOptionRow({
                      rowKey: `req:${r.code}`,
                      code: r.code,
                      placedSet: placed,
                      accent: "minor",
                    }),
                  )}
                </ul>
              </details>
            )}

            {/* Minor Electives (Choose From) */}
            {minorModel.chooseGroups.length > 0 && (
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  <span>Minor electives (choose from)</span>
                  {(() => {
                    const doneGroups = minorModel.chooseGroups.filter(
                      (g) =>
                        g.options.filter((c) =>
                          Boolean(findEquivalentInSet(c, placed, equivMap)),
                        ).length >= g.required,
                    ).length;
                    return (
                      <span
                        className={`ml-auto rounded-full px-2 py-0.5 tabular-nums text-[11px] font-semibold ${
                          doneGroups === minorModel.chooseGroups.length
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                        }`}
                      >
                        {doneGroups}/{minorModel.chooseGroups.length}
                      </span>
                    );
                  })()}
                </summary>
                <div className="space-y-2.5 pl-3 pr-1 pb-1">
                  {minorModel.chooseGroups.map((group) => {
                    const hits = group.options.filter((c) =>
                      Boolean(findEquivalentInSet(c, placed, equivMap)),
                    );
                    const ok = hits.length >= group.required;
                    const available = group.options.filter((c) =>
                      isOffered(c, offeringsMap, customs),
                    );
                    const listCodes =
                      available.length > 0 ? available : group.options;
                    return (
                      <div
                        key={group.id}
                        className="rounded-xl border border-slate-200/75 bg-slate-50/65 p-2.5 dark:border-slate-800 dark:bg-slate-950/45"
                      >
                        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {group.label || `Choose ${group.required}`}
                          </span>
                          <span
                            className={`tabular-nums text-[11px] ${
                              ok
                                ? "font-semibold text-emerald-700 dark:text-emerald-400"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {Math.min(hits.length, group.required)}/{group.required}
                          </span>
                        </div>
                        <ul className="space-y-1">
                          {listCodes.map((code) =>
                            renderCourseOptionRow({
                              rowKey: `choose:${group.id}:${code}`,
                              code,
                              placedSet: placed,
                              accent: "minor",
                            }),
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Minor Elective Buckets */}
            {minorModel.buckets.length > 0 && (
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  <span>Minor electives</span>
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 tabular-nums text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {minorModel.buckets.length}
                  </span>
                </summary>
                <div className="space-y-1">
                  {minorModel.buckets.map((b) =>
                    renderBucket(
                      b,
                      minorStats.minorBucketAllocations.get(b.key),
                      minorStats.minorFree,
                      onPickMinorBucket,
                      "minor",
                    ),
                  )}
                </div>
              </details>
            )}

            {/* Minor Elective Rules & Additional Course Notes (for calendar text minors) */}
            {minorStats.notes.length > 0 && (
              <details
                className="group"
                open={minorModel.buckets.length === 0}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-50/90 dark:text-slate-100 dark:hover:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  <span>Additional minor courses &amp; notes</span>
                </summary>
                <div className="space-y-2 px-3 pb-2 text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {minorStats.notes.map((n) => (
                    <div key={n.id}>
                      {n.title && (
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {n.title}
                        </div>
                      )}
                      {n.lines.map((line, i) => (
                        <p key={i} className="mt-0.5">
                          {line}
                        </p>
                      ))}
                    </div>
                  ))}
                  {minorModel.buckets.length === 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenMinorSearch(minorStats.primarySubject)
                      }
                      className="mt-1 inline-flex items-center gap-1 rounded-xl border border-violet-200/90 bg-violet-50 px-2.5 py-1 text-[11.5px] font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                    >
                      + Browse{" "}
                      {minorStats.primarySubject
                        ? `${minorStats.primarySubject} courses`
                        : "minor electives"}
                    </button>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
      )}
    </aside>
  );
}
