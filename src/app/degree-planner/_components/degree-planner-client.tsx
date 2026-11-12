"use client";

import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildDefaultPlan,
  buildModel,
  buildOfferingsMap,
  courseOf,
  creditsOf,
  CREDIT_CAP,
  firstFreeSlot,
  placedCodes,
  placedTermIndex,
  prereqFlag,
  SLOTS_PER_TERM,
  STORE_PREFIX,
  termCredits,
} from "@/lib/degree-planner";
import type {
  CatalogCourse,
  CustomCourse,
  DegreeBootstrapData,
  DegreeProgramDetail,
  PickerState,
  PlannerTerm,
  ProgramSummary,
  UnscheduledItem,
} from "@/lib/degree-types";

import { CoursePickerModal } from "./course-picker-modal";
import { RequirementsSidebar } from "./requirements-sidebar";

type DegreePlannerClientProps = {
  bootstrap: DegreeBootstrapData;
  initialProgram: DegreeProgramDetail | null;
};

type SavedPlan = {
  terms?: PlannerTerm[];
  customs?: CustomCourse[];
};

function loadSavedPlan(programId: string): SavedPlan {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORE_PREFIX + programId);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SavedPlan | PlannerTerm[];
    return Array.isArray(parsed) ? { terms: parsed } : parsed;
  } catch {
    return {};
  }
}

function persistPlan(
  programId: string,
  terms: PlannerTerm[],
  customs: Map<string, CustomCourse>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORE_PREFIX + programId,
    JSON.stringify({
      terms,
      customs: [...customs.values()],
    }),
  );
}

export function DegreePlannerClient({
  bootstrap,
  initialProgram,
}: DegreePlannerClientProps) {
  const catalogMap = useMemo(() => {
    const map = new Map<string, CatalogCourse>();
    for (const c of bootstrap.courses) map.set(c.code, c);
    return map;
  }, [bootstrap.courses]);

  const offeringsMap = useMemo(
    () => buildOfferingsMap(bootstrap.offerings, bootstrap.courses),
    [bootstrap.offerings, bootstrap.courses],
  );

  const { subjects, subjectFaculty } = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const s of bootstrap.subjects) {
      seen.set(s.code, s.faculty ?? null);
    }
    for (const c of bootstrap.courses) {
      if (!c.subject) continue;
      if (!seen.has(c.subject) || (!seen.get(c.subject) && c.faculty)) {
        seen.set(c.subject, c.faculty ?? null);
      }
    }
    return {
      subjects: [...seen.keys()].sort(),
      subjectFaculty: seen,
    };
  }, [bootstrap.subjects, bootstrap.courses]);

  const programCacheRef = useRef<Map<string, DegreeProgramDetail>>(new Map());

  const initialDefaultPlan = useMemo(() => {
    if (!initialProgram) return { terms: [], unscheduled: [] as UnscheduledItem[] };
    return buildDefaultPlan(initialProgram, catalogMap, offeringsMap, new Map());
  }, [initialProgram, catalogMap, offeringsMap]);

  const [program, setProgram] = useState<DegreeProgramDetail | null>(
    initialProgram,
  );
  const [loadingProgram, setLoadingProgram] = useState(false);
  const [programQuery, setProgramQuery] = useState(
    initialProgram?.name ?? "",
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const [customs, setCustoms] = useState<Map<string, CustomCourse>>(
    () => new Map(),
  );
  const [terms, setTerms] = useState<PlannerTerm[]>(
    () => initialDefaultPlan.terms,
  );
  const [unscheduled, setUnscheduled] = useState<UnscheduledItem[]>(
    () => initialDefaultPlan.unscheduled,
  );

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerTransferMode, setPickerTransferMode] = useState(false);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const menuContainerRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1800);
  }, []);

  const activateProgram = useCallback(
    (prog: DegreeProgramDetail) => {
      const saved = loadSavedPlan(prog.program_id);
      const nextCustoms = new Map(
        (saved.customs ?? []).map((c) => [c.code, c]),
      );
      if (saved.terms && saved.terms.length > 0) {
        setTerms(saved.terms);
        setUnscheduled([]);
      } else {
        const built = buildDefaultPlan(
          prog,
          catalogMap,
          offeringsMap,
          nextCustoms,
        );
        setTerms(built.terms);
        setUnscheduled(built.unscheduled);
      }
      setCustoms(nextCustoms);
      setProgram(prog);
      setProgramQuery(prog.name);
    },
    [catalogMap, offeringsMap],
  );

  // Hydrate saved localStorage plan for SSR-preloaded program after mount
  useEffect(() => {
    if (!initialProgram) return;
    programCacheRef.current.set(initialProgram.program_id, initialProgram);
    const saved = loadSavedPlan(initialProgram.program_id);
    if (!saved.terms?.length && !saved.customs?.length) return;
    const timer = setTimeout(() => {
      activateProgram(initialProgram);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialProgram, activateProgram]);

  // Close program dropdown on outside click
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const filteredPrograms = useMemo(() => {
    const q = programQuery.trim().toLowerCase();
    return bootstrap.programs
      .filter(
        (p) =>
          !q ||
          `${p.name} ${p.credential ?? ""} ${p.degree_abbrev ?? ""} ${p.faculty ?? ""}`
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 60);
  }, [bootstrap.programs, programQuery]);

  const selectProgram = useCallback(
    async (summary: ProgramSummary) => {
      setMenuOpen(false);
      setProgramQuery(summary.name);

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("program", summary.program_id);
        window.history.replaceState(null, "", url.toString());
      }

      const cached = programCacheRef.current.get(summary.program_id);
      if (cached) {
        activateProgram(cached);
        return;
      }

      setLoadingProgram(true);
      try {
        const res = await fetch(
          `/api/degree-planner/programs/${encodeURIComponent(summary.program_id)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const detail = (await res.json()) as DegreeProgramDetail;
        programCacheRef.current.set(detail.program_id, detail);
        activateProgram(detail);
      } catch {
        showToast("Could not load program requirements");
      } finally {
        setLoadingProgram(false);
      }
    },
    [activateProgram, showToast],
  );

  const model = useMemo(
    () => (program ? buildModel(program) : null),
    [program],
  );

  const totalTarget = useMemo(() => {
    if (!program || !model) return 0;
    return (
      program.total_credit_hours ||
      model.required.reduce(
        (sum, r) => sum + creditsOf(r.code, catalogMap, customs),
        0,
      ) + model.buckets.reduce((sum, b) => sum + b.credits, 0)
    );
  }, [program, model, catalogMap, customs]);

  const totalPlacedCredits = useMemo(() => {
    let total = 0;
    for (const code of placedCodes(terms)) {
      total += creditsOf(code, catalogMap, customs);
    }
    return total;
  }, [terms, catalogMap, customs]);

  const commitPlan = useCallback(
    (nextTerms: PlannerTerm[], nextCustoms: Map<string, CustomCourse>) => {
      setTerms(nextTerms);
      setCustoms(nextCustoms);
      if (program) persistPlan(program.program_id, nextTerms, nextCustoms);
    },
    [program],
  );

  const placeCourse = useCallback(
    (
      termIndex: number,
      slotIndex: number,
      code: string,
      customMapOverride?: Map<string, CustomCourse>,
    ) => {
      const nextCustoms = customMapOverride ?? customs;
      const nextTerms = terms.map((t) => ({ ...t, slots: t.slots.slice() }));
      const targetTerm = nextTerms[termIndex];
      if (!targetTerm) return;

      while (targetTerm.slots.length <= slotIndex) {
        targetTerm.slots.push(null);
      }

      const existingTermIdx = placedTermIndex(nextTerms, code);
      if (existingTermIdx >= 0) {
        const oldTerm = nextTerms[existingTermIdx];
        const oldSlotIdx = oldTerm.slots.indexOf(code);
        if (existingTermIdx === termIndex && oldSlotIdx === slotIndex) {
          setPicker(null);
          return;
        }
        const displaced = targetTerm.slots[slotIndex] ?? null;
        oldTerm.slots[oldSlotIdx] = displaced;
      }

      targetTerm.slots[slotIndex] = code;
      commitPlan(nextTerms, nextCustoms);
      setPicker(null);
    },
    [terms, customs, commitPlan],
  );

  const clearSlot = useCallback(
    (termIndex: number, slotIndex: number) => {
      const nextTerms = terms.map((t, i) =>
        i === termIndex
          ? {
              ...t,
              slots: t.slots.map((c, j) => (j === slotIndex ? null : c)),
            }
          : t,
      );
      commitPlan(nextTerms, customs);
    },
    [terms, customs, commitPlan],
  );

  const addSummer = useCallback(
    (year: number) => {
      const nextTerms = terms.slice();
      let lastIdx = -1;
      nextTerms.forEach((t, i) => {
        if (t.year === year) lastIdx = i;
      });
      const slots: (string | null)[] = Array.from(
        { length: SLOTS_PER_TERM },
        () => null,
      );
      const summer: PlannerTerm = {
        label: "Summer",
        season: "Summer",
        year,
        summer: true,
        slots,
      };
      nextTerms.splice(lastIdx + 1, 0, summer);
      commitPlan(nextTerms, customs);
      showToast(`Added a summer term to Year ${year}`);
    },
    [terms, customs, commitPlan, showToast],
  );

  const removeTerm = useCallback(
    (termIndex: number) => {
      const nextTerms = terms.filter((_, i) => i !== termIndex);
      commitPlan(nextTerms, customs);
    },
    [terms, customs, commitPlan],
  );

  const handleReset = useCallback(() => {
    if (!program) return;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORE_PREFIX + program.program_id);
    }
    const emptyCustoms = new Map<string, CustomCourse>();
    const built = buildDefaultPlan(
      program,
      catalogMap,
      offeringsMap,
      emptyCustoms,
    );
    setCustoms(emptyCustoms);
    setTerms(built.terms);
    setUnscheduled(built.unscheduled);
    showToast("Plan reset to the published year map");
  }, [program, catalogMap, offeringsMap, showToast]);

  const handleSaveCustom = useCallback(
    (
      draft: CustomCourse,
      target: { termIndex: number; slotIndex: number } | null,
    ) => {
      const nextCustoms = new Map(customs);
      nextCustoms.set(draft.code, draft);
      if (target) {
        placeCourse(target.termIndex, target.slotIndex, draft.code, nextCustoms);
      } else {
        commitPlan(terms, nextCustoms);
      }
      setPickerTransferMode(false);
      showToast(
        draft.transfer
          ? `${draft.code} added as a transfer credit`
          : `${draft.code} added as a custom course`,
      );
    },
    [customs, placeCourse, commitPlan, terms, showToast],
  );

  const handlePlaceTransfer = useCallback(
    (code: string) => {
      const slot = firstFreeSlot(terms);
      placeCourse(slot.termIndex, slot.slotIndex, code);
      const targetTerm = terms[slot.termIndex];
      if (targetTerm) {
        showToast(
          `${code} placed in Year ${targetTerm.year} ${targetTerm.season}`,
        );
      }
    },
    [terms, placeCourse, showToast],
  );

  const handleRemoveTransfer = useCallback(
    (code: string) => {
      const nextCustoms = new Map(customs);
      nextCustoms.delete(code);
      const nextTerms = terms.map((t) => ({
        ...t,
        slots: t.slots.map((c) => (c === code ? null : c)),
      }));
      commitPlan(nextTerms, nextCustoms);
      showToast(`${code} removed`);
    },
    [customs, terms, commitPlan, showToast],
  );

  const handleDropSlot = useCallback(
    (fromTerm: number, fromSlot: number, toTerm: number, toSlot: number) => {
      if (fromTerm === toTerm && fromSlot === toSlot) return;
      const nextTerms = terms.map((t) => ({ ...t, slots: t.slots.slice() }));
      const moving = nextTerms[fromTerm]?.slots[fromSlot] ?? null;
      const target = nextTerms[toTerm]?.slots[toSlot] ?? null;
      while (nextTerms[toTerm].slots.length <= toSlot) {
        nextTerms[toTerm].slots.push(null);
      }
      nextTerms[toTerm].slots[toSlot] = moving;
      nextTerms[fromTerm].slots[fromSlot] = target;
      commitPlan(nextTerms, customs);
    },
    [terms, customs, commitPlan],
  );

  const termsByYear = useMemo(() => {
    const grouped = new Map<number, { term: PlannerTerm; index: number }[]>();
    terms.forEach((term, index) => {
      const list = grouped.get(term.year) ?? [];
      list.push({ term, index });
      grouped.set(term.year, list);
    });
    return [...grouped.entries()];
  }, [terms]);

  const heroPct = totalTarget
    ? Math.min(100, (totalPlacedCredits / totalTarget) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Home
          </Link>

          <div className="font-semibold tracking-tight">
            Degree Planner{" "}
            <small className="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
              Ontario Tech · 2026-27
            </small>
          </div>

          {/* Searchable Program Dropdown */}
          <div ref={menuContainerRef} className="relative">
            <input
              type="text"
              value={programQuery}
              onFocus={() => setMenuOpen(true)}
              onChange={(e) => {
                setProgramQuery(e.target.value);
                setMenuOpen(true);
              }}
              placeholder="Search programs…"
              autoComplete="off"
              className="w-72 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none sm:w-80 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            {menuOpen && (
              <div className="absolute top-10 left-0 z-50 max-h-[60vh] w-[min(430px,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                {filteredPrograms.length === 0 ? (
                  <div className="p-6 text-center text-sm text-zinc-500">
                    No programs match.
                  </div>
                ) : (
                  filteredPrograms.map((p) => (
                    <button
                      key={p.program_id}
                      type="button"
                      onClick={() => selectProgram(p)}
                      className="block w-full border-b border-zinc-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                    >
                      <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {p.name}
                      </span>
                      <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                        {[
                          p.credential,
                          p.degree_abbrev,
                          p.total_credit_hours
                            ? `${p.total_credit_hours} cr`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Credit Progress Hero */}
          <div className="flex items-center gap-2.5">
            <strong className="text-xl font-semibold tracking-tight tabular-nums">
              {totalPlacedCredits}
            </strong>
            <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
              / {totalTarget} cr
            </span>
            <div className="h-2 w-36 overflow-hidden rounded-full bg-zinc-200 sm:w-44 dark:bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-700 transition-all duration-300"
                style={{ width: `${heroPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!program}
            onClick={handleReset}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Reset to defaults
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* Planner Grid */}
        <section>
          {loadingProgram ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              Loading program requirements…
            </div>
          ) : !program ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              Pick a program above to start building a term-by-term plan.
            </div>
          ) : termsByYear.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              No terms.
            </div>
          ) : (
            <div className="space-y-5">
              {termsByYear.map(([year, yearTerms]) => {
                const yearCreds = yearTerms.reduce(
                  (sum, { term }) => sum + termCredits(term, catalogMap, customs),
                  0,
                );
                return (
                  <div key={year}>
                    <div className="mb-2 flex items-baseline gap-2.5 px-0.5">
                      <h3 className="text-[15px] font-semibold tracking-tight">
                        Year {year}
                      </h3>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {yearCreds} credits
                      </span>
                      <button
                        type="button"
                        onClick={() => addSummer(year)}
                        className="ml-auto rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                      >
                        + Summer term
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {yearTerms.map(({ term, index: termIndex }) => {
                        const creds = termCredits(term, catalogMap, customs);
                        const over = creds > CREDIT_CAP;
                        return (
                          <div
                            key={`${year}-${term.season}-${termIndex}`}
                            className="min-w-[235px] flex-1 basis-[235px] rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <span className="text-[13px] font-semibold">
                                {term.season}
                              </span>
                              {term.summer && (
                                <span className="text-[10.5px] font-medium tracking-wider text-purple-700 uppercase dark:text-purple-400">
                                  summer
                                </span>
                              )}
                              <span
                                className={`ml-auto text-[11.5px] tabular-nums ${
                                  over
                                    ? "font-semibold text-amber-700 dark:text-amber-400"
                                    : "text-zinc-500 dark:text-zinc-400"
                                }`}
                              >
                                {creds} cr{over ? " ⚠" : ""}
                              </span>
                              {term.summer && (
                                <button
                                  type="button"
                                  onClick={() => removeTerm(termIndex)}
                                  title="Remove term"
                                  className="text-sm leading-none text-zinc-400 hover:text-red-600"
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            <div className="space-y-1">
                              {term.slots.map((code, slotIndex) => {
                                const slotKey = `${termIndex}:${slotIndex}`;
                                const isDragOver = dragTargetKey === slotKey;

                                if (!code) {
                                  return (
                                    <button
                                      key={slotKey}
                                      type="button"
                                      onClick={() => {
                                        setPickerTransferMode(false);
                                        setPicker({
                                          termIndex,
                                          slotIndex,
                                          bucketKey: null,
                                        });
                                      }}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragTargetKey(slotKey);
                                      }}
                                      onDragLeave={() => setDragTargetKey(null)}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        setDragTargetKey(null);
                                        const raw =
                                          e.dataTransfer.getData("text/plain");
                                        if (!raw) return;
                                        const [ft, fs] = raw
                                          .split(":")
                                          .map(Number);
                                        handleDropSlot(
                                          ft,
                                          fs,
                                          termIndex,
                                          slotIndex,
                                        );
                                      }}
                                      className={`flex min-h-[38px] w-full items-center justify-center rounded-lg border border-dashed text-[12.5px] transition-colors ${
                                        isDragOver
                                          ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/40"
                                          : "border-zinc-200 text-zinc-400 hover:border-blue-500 hover:bg-blue-50/40 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-blue-500 dark:hover:bg-blue-950/20"
                                      }`}
                                    >
                                      ＋
                                    </button>
                                  );
                                }

                                const course = courseOf(
                                  code,
                                  catalogMap,
                                  customs,
                                );
                                const title = course
                                  ? course.title
                                  : "Unknown course";
                                const isCustom = customs.has(code);
                                const isTransfer = Boolean(
                                  isCustom && customs.get(code)?.transfer,
                                );
                                const flag = prereqFlag(
                                  code,
                                  termIndex,
                                  terms,
                                  catalogMap,
                                  offeringsMap,
                                  customs,
                                );

                                return (
                                  <div
                                    key={slotKey}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData(
                                        "text/plain",
                                        slotKey,
                                      );
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      setDragTargetKey(slotKey);
                                    }}
                                    onDragLeave={() => setDragTargetKey(null)}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDragTargetKey(null);
                                      const raw =
                                        e.dataTransfer.getData("text/plain");
                                      if (!raw) return;
                                      const [ft, fs] = raw
                                        .split(":")
                                        .map(Number);
                                      handleDropSlot(
                                        ft,
                                        fs,
                                        termIndex,
                                        slotIndex,
                                      );
                                    }}
                                    title={`${code} — ${title}${
                                      isTransfer
                                        ? " (transfer credit)"
                                        : isCustom
                                          ? " (custom course)"
                                          : ""
                                    }`}
                                    className={`flex min-h-[38px] cursor-grab items-center gap-2 rounded-lg border px-2 py-1 text-[12.5px] transition-colors active:cursor-grabbing ${
                                      isDragOver
                                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950/40"
                                        : isCustom
                                          ? "border-dashed border-blue-300 bg-blue-50/40 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/20"
                                          : "border-zinc-200 bg-zinc-50/60 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:border-zinc-700"
                                    }`}
                                  >
                                    <span className="shrink-0 font-mono text-[11.5px] text-blue-800 dark:text-blue-300">
                                      {code}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                                      {title}
                                    </span>
                                    {isTransfer ? (
                                      <span
                                        className="text-[11px] text-blue-600 dark:text-blue-400"
                                        title="Transfer credit"
                                      >
                                        ⤳
                                      </span>
                                    ) : isCustom ? (
                                      <span
                                        className="text-[11px] text-blue-600 dark:text-blue-400"
                                        title="Custom course — not taken from the 2026-27 timetable"
                                      >
                                        ✎
                                      </span>
                                    ) : null}
                                    {flag && (
                                      <span
                                        className={`text-[11px] ${
                                          flag.cls === "bad"
                                            ? "text-amber-600 dark:text-amber-400"
                                            : "text-zinc-400"
                                        }`}
                                        title={flag.title}
                                      >
                                        {flag.icon}
                                      </span>
                                    )}
                                    <span className="text-[11px] text-zinc-400 tabular-nums">
                                      {creditsOf(code, catalogMap, customs)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        clearSlot(termIndex, slotIndex)
                                      }
                                      title="Remove"
                                      className="px-0.5 text-sm leading-none text-zinc-400 hover:text-red-600"
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}

                              {/* Extra slot button */}
                              {(() => {
                                const appendKey = `${termIndex}:${term.slots.length}`;
                                const isDragOver = dragTargetKey === appendKey;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPickerTransferMode(false);
                                      setPicker({
                                        termIndex,
                                        slotIndex: term.slots.length,
                                        bucketKey: null,
                                      });
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      setDragTargetKey(appendKey);
                                    }}
                                    onDragLeave={() => setDragTargetKey(null)}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDragTargetKey(null);
                                      const raw =
                                        e.dataTransfer.getData("text/plain");
                                      if (!raw) return;
                                      const [ft, fs] = raw
                                        .split(":")
                                        .map(Number);
                                      handleDropSlot(
                                        ft,
                                        fs,
                                        termIndex,
                                        term.slots.length,
                                      );
                                    }}
                                    className={`flex min-h-[38px] w-full items-center justify-center rounded-lg border border-dashed text-[12.5px] transition-colors ${
                                      isDragOver
                                        ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/40"
                                        : "border-zinc-200 text-zinc-400 hover:border-blue-500 hover:bg-blue-50/40 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-blue-500 dark:hover:bg-blue-950/20"
                                    }`}
                                  >
                                    ＋ add course
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Sidebar */}
        {program && model ? (
          <RequirementsSidebar
            program={program}
            model={model}
            terms={terms}
            catalogMap={catalogMap}
            offeringsMap={offeringsMap}
            customs={customs}
            unscheduled={unscheduled}
            onPickBucket={(bucketKey) => {
              const emptyTerm = terms.findIndex((t) => t.slots.includes(null));
              const termIndex = emptyTerm >= 0 ? emptyTerm : 0;
              const slotIndex =
                emptyTerm >= 0
                  ? terms[termIndex].slots.indexOf(null)
                  : (terms[0]?.slots.length ?? 0);
              setPickerTransferMode(false);
              setPicker({ termIndex, slotIndex, bucketKey });
            }}
            onOpenTransferPicker={() => {
              const free = firstFreeSlot(terms);
              setPickerTransferMode(true);
              setPicker({
                termIndex: free.termIndex,
                slotIndex: free.slotIndex,
                bucketKey: null,
              });
            }}
            onPlaceTransfer={handlePlaceTransfer}
            onRemoveTransfer={handleRemoveTransfer}
          />
        ) : (
          <aside className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                What you need
              </h2>
              <div className="mt-0.5 text-xs text-zinc-500">—</div>
            </div>
          </aside>
        )}
      </main>

      {/* Course Picker Modal */}
      {picker && (
        <CoursePickerModal
          key={`${picker.termIndex}:${picker.slotIndex}:${picker.bucketKey ?? ""}:${pickerTransferMode}`}
          picker={picker}
          initialTransferMode={pickerTransferMode}
          terms={terms}
          model={model}
          catalogCourses={bootstrap.courses}
          catalogMap={catalogMap}
          offeringsMap={offeringsMap}
          customs={customs}
          subjects={subjects}
          subjectFaculty={subjectFaculty}
          onClose={() => {
            setPicker(null);
            setPickerTransferMode(false);
          }}
          onPlaceCourse={(ti, si, code) => placeCourse(ti, si, code)}
          onSaveCustom={handleSaveCustom}
          onToast={showToast}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
