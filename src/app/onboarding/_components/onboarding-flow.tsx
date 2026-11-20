"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useRef, useState } from "react";

import {
  findProgramInCatalogYear,
  resolveCatalogYearForStartYear,
  startYearToCatalogYear,
} from "@/lib/degree-planner";
import type { ProgramSummary } from "@/lib/degree-types";
import {
  formatYearOfStudy,
  YEAR_OF_STUDY_OPTIONS,
  yearOfStudyToStartYear,
  type YearOfStudy,
} from "@/lib/onboarding";
import type { StudentProfile } from "@/lib/student-courses";

interface OnboardingFlowProps {
  programs: ProgramSummary[];
  availableCatalogYears: string[];
  initialProfile: StudentProfile | null;
  firstName: string | null;
  nextPath: string;
  currentAcademicStartYear: number;
}

const STEP_LABELS = ["Year", "Degree", "Minor"] as const;

const CREDENTIAL_ORDER: Record<string, number> = {
  Major: 0,
  Specialization: 1,
  "Double Major": 2,
  Diploma: 3,
  "Advanced Entry": 4,
  "Co-operative Education": 5,
};

function matchesProgramSearch(program: ProgramSummary, rawQuery: string): boolean {
  const tokens = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    program.name,
    program.credential,
    program.degree,
    program.degree_abbrev,
    program.faculty,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function OnboardingFlow({
  programs,
  availableCatalogYears,
  initialProfile,
  firstName,
  nextPath,
  currentAcademicStartYear,
}: OnboardingFlowProps) {
  const router = useRouter();
  const isEditing = Boolean(initialProfile?.onboarding_completed_at);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [yearOfStudy, setYearOfStudy] = useState<YearOfStudy | null>(
    initialProfile?.year_of_study ?? null,
  );
  const [degreeProgramId, setDegreeProgramId] = useState<string | null>(
    initialProfile?.degree_program_id ?? null,
  );
  const [hasMinor, setHasMinor] = useState<boolean | null>(() => {
    if (typeof initialProfile?.has_minor === "boolean") {
      return initialProfile.has_minor;
    }
    return initialProfile?.minor_program_id ? true : null;
  });
  const [minorProgramId, setMinorProgramId] = useState<string | null>(
    initialProfile?.minor_program_id ?? null,
  );

  const [degreeQuery, setDegreeQuery] = useState("");
  const [minorQuery, setMinorQuery] = useState("");
  const [highlightedDegreeIdx, setHighlightedDegreeIdx] = useState(-1);
  const [highlightedMinorIdx, setHighlightedMinorIdx] = useState(-1);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const degreeSearchRef = useRef<HTMLInputElement>(null);
  const minorSearchRef = useRef<HTMLInputElement>(null);

  const programsById = useMemo(() => {
    const map = new Map<string, ProgramSummary>();
    for (const p of programs) {
      map.set(p.program_id, p);
    }
    return map;
  }, [programs]);

  const allDegreePrograms = useMemo(
    () => programs.filter((p) => p.credential !== "Minor"),
    [programs],
  );

  const allMinorPrograms = useMemo(
    () => programs.filter((p) => p.credential === "Minor"),
    [programs],
  );

  const derivedStartYear = useMemo(
    () => yearOfStudyToStartYear(yearOfStudy, currentAcademicStartYear),
    [yearOfStudy, currentAcademicStartYear],
  );

  const targetCatalogYear = useMemo(() => {
    if (availableCatalogYears.length > 0) {
      return resolveCatalogYearForStartYear(
        derivedStartYear,
        availableCatalogYears,
      );
    }
    return startYearToCatalogYear(derivedStartYear);
  }, [derivedStartYear, availableCatalogYears]);

  const selectedDegree = useMemo(
    () => (degreeProgramId ? (programsById.get(degreeProgramId) ?? null) : null),
    [degreeProgramId, programsById],
  );

  const selectedMinor = useMemo(
    () =>
      hasMinor === true && minorProgramId
        ? (programsById.get(minorProgramId) ?? null)
        : null,
    [hasMinor, minorProgramId, programsById],
  );

  const degreeOptions = useMemo(() => {
    const q = degreeQuery.trim().toLowerCase();
    const inCatalog = allDegreePrograms.filter(
      (p) => p.catalog_year === targetCatalogYear,
    );
    const pool = inCatalog.length > 0 ? inCatalog : allDegreePrograms;

    return pool
      .filter((p) => matchesProgramSearch(p, degreeQuery))
      .sort((a, b) => {
        if (q) {
          const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
        }
        const rankA = CREDENTIAL_ORDER[a.credential ?? ""] ?? 99;
        const rankB = CREDENTIAL_ORDER[b.credential ?? ""] ?? 99;
        if (rankA !== rankB) return rankA - rankB;
        return a.name.localeCompare(b.name);
      });
  }, [allDegreePrograms, targetCatalogYear, degreeQuery]);

  const minorOptions = useMemo(() => {
    const q = minorQuery.trim().toLowerCase();
    const inCatalog = allMinorPrograms.filter(
      (p) => p.catalog_year === targetCatalogYear,
    );
    const pool = inCatalog.length > 0 ? inCatalog : allMinorPrograms;

    return pool
      .filter((p) => matchesProgramSearch(p, minorQuery))
      .sort((a, b) => {
        if (q) {
          const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
        }
        return a.name.localeCompare(b.name);
      });
  }, [allMinorPrograms, targetCatalogYear, minorQuery]);

  function handleSelectYear(nextYear: YearOfStudy) {
    const toggledYear = yearOfStudy === nextYear ? null : nextYear;
    setYearOfStudy(toggledYear);

    const nextStartYear = yearOfStudyToStartYear(
      toggledYear,
      currentAcademicStartYear,
    );
    const nextCatalogYear =
      availableCatalogYears.length > 0
        ? resolveCatalogYearForStartYear(nextStartYear, availableCatalogYears)
        : startYearToCatalogYear(nextStartYear);

    if (selectedDegree && selectedDegree.catalog_year !== nextCatalogYear) {
      const remappedDegree = findProgramInCatalogYear(
        allDegreePrograms,
        selectedDegree,
        nextCatalogYear,
      );
      if (remappedDegree) {
        setDegreeProgramId(remappedDegree.program_id);
      }
    }

    if (selectedMinor && selectedMinor.catalog_year !== nextCatalogYear) {
      const remappedMinor = findProgramInCatalogYear(
        allMinorPrograms,
        selectedMinor,
        nextCatalogYear,
      );
      if (remappedMinor) {
        setMinorProgramId(remappedMinor.program_id);
      }
    }
  }

  function handleSelectHasMinor(choice: boolean) {
    if (hasMinor === choice) {
      setHasMinor(null);
      setMinorProgramId(null);
      setMinorQuery("");
      setHighlightedMinorIdx(-1);
      return;
    }

    setHasMinor(choice);
    if (!choice) {
      setMinorProgramId(null);
      setMinorQuery("");
      setHighlightedMinorIdx(-1);
    } else {
      window.setTimeout(() => minorSearchRef.current?.focus(), 40);
    }
  }

  function goToStep(targetStep: 0 | 1 | 2) {
    setStep(targetStep);
    setErrorMessage(null);
    if (targetStep === 1) {
      window.setTimeout(() => degreeSearchRef.current?.focus(), 40);
    } else if (targetStep === 2 && hasMinor === true) {
      window.setTimeout(() => minorSearchRef.current?.focus(), 40);
    }
  }

  async function handleSkipAll() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not skip onboarding.");
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not skip onboarding.",
      );
      setSubmitting(false);
    }
  }

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          yearOfStudy,
          degreeProgramId,
          hasMinor,
          minorProgramId: hasMinor === true ? minorProgramId : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not save your profile.");
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not save your profile.",
      );
      setSubmitting(false);
    }
  }

  function handleDegreeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (degreeOptions.length === 0) return;
      setHighlightedDegreeIdx((prev) =>
        prev + 1 < degreeOptions.length ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (degreeOptions.length === 0) return;
      setHighlightedDegreeIdx((prev) =>
        prev - 1 >= 0 ? prev - 1 : degreeOptions.length - 1,
      );
    } else if (
      e.key === "Enter" &&
      highlightedDegreeIdx >= 0 &&
      degreeOptions[highlightedDegreeIdx]
    ) {
      e.preventDefault();
      setDegreeProgramId(degreeOptions[highlightedDegreeIdx].program_id);
    } else if (e.key === "Escape" && degreeQuery) {
      e.preventDefault();
      setDegreeQuery("");
      setHighlightedDegreeIdx(-1);
    }
  }

  function handleMinorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (minorOptions.length === 0) return;
      setHighlightedMinorIdx((prev) =>
        prev + 1 < minorOptions.length ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (minorOptions.length === 0) return;
      setHighlightedMinorIdx((prev) =>
        prev - 1 >= 0 ? prev - 1 : minorOptions.length - 1,
      );
    } else if (
      e.key === "Enter" &&
      highlightedMinorIdx >= 0 &&
      minorOptions[highlightedMinorIdx]
    ) {
      e.preventDefault();
      setMinorProgramId(minorOptions[highlightedMinorIdx].program_id);
    } else if (e.key === "Escape" && minorQuery) {
      e.preventDefault();
      setMinorQuery("");
      setHighlightedMinorIdx(-1);
    }
  }

  const stepCompleted = [
    yearOfStudy !== null,
    degreeProgramId !== null,
    hasMinor !== null,
  ] as const;

  const yearSummary = formatYearOfStudy(yearOfStudy);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
      <section className="overflow-hidden rounded-2xl border border-[#BFD7F2] bg-white shadow-[0_12px_36px_-16px_rgba(0,60,113,0.22)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/50">
        {/* Top Bar: Brand, Clickable Step Rail, Skip / Back */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-[#F4F8FD]/80 px-5 py-4 sm:px-7 dark:border-slate-800 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#003C71] text-xs font-bold tracking-tight text-white">
              OTU
            </span>
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              Better OTU
            </span>
          </div>

          <nav
            aria-label="Onboarding steps"
            className="order-3 flex w-full items-center justify-center gap-1.5 sm:order-2 sm:w-auto"
          >
            {STEP_LABELS.map((label, idx) => {
              const stepIdx = idx as 0 | 1 | 2;
              const isActive = step === stepIdx;
              const isDone = stepCompleted[stepIdx];
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => goToStep(stepIdx)}
                  aria-current={isActive ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                    isActive
                      ? "bg-[#003C71] text-white dark:bg-sky-500 dark:text-slate-950"
                      : isDone
                        ? "border border-[#BFD7F2] bg-white text-[#003C71] hover:bg-[#EBF3FC] dark:border-sky-800/70 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800"
                        : "text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {isDone && !isActive && (
                    <CheckIcon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="order-2 sm:order-3">
            {isEditing ? (
              <Link
                href={nextPath}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                Cancel
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void handleSkipAll()}
                disabled={submitting}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-white hover:text-[#003C71] focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>

        {/* Main Step Body */}
        <div className="px-5 py-7 sm:px-7 sm:py-8">
          {errorMessage && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="shrink-0 font-semibold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* STEP 0: Year of Study */}
          {step === 0 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px] dark:text-white">
                What year are you in?
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {!isEditing && firstName
                  ? `Welcome to Better OTU, ${firstName}. `
                  : ""}
                Picking your year sets your Degree Planner start year and
                academic calendar automatically. Everything here is optional.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {YEAR_OF_STUDY_OPTIONS.map((option) => {
                  const selected = yearOfStudy === option.value;
                  const optionStartYear = yearOfStudyToStartYear(
                    option.value,
                    currentAcademicStartYear,
                  );
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelectYear(option.value)}
                      aria-pressed={selected}
                      className={`group relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                        selected
                          ? "border-[#003C71] bg-[#EBF3FC] ring-1 ring-[#003C71] dark:border-sky-400 dark:bg-sky-950/50 dark:ring-sky-400"
                          : "border-slate-200 bg-white hover:border-[#9AC0EB] hover:bg-[#F7FAFE] dark:border-slate-700/80 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-slate-800/80"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span
                          className={`text-2xl font-bold tracking-tight tabular-nums ${
                            selected
                              ? "text-[#003C71] dark:text-sky-300"
                              : "text-slate-900 dark:text-white"
                          }`}
                        >
                          {option.label}
                        </span>
                        {selected && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#003C71] text-white dark:bg-sky-400 dark:text-slate-950">
                            <CheckIcon className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <span
                        className={`mt-2 text-xs font-semibold ${
                          selected
                            ? "text-[#003C71] dark:text-sky-200"
                            : "text-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {option.title}
                      </span>
                      <span
                        className={`mt-0.5 text-[11px] tabular-nums ${
                          selected
                            ? "text-[#003C71]/80 dark:text-sky-300/85"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        Start {optionStartYear}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
                <span>
                  {yearOfStudy
                    ? `${yearSummary} defaults your Degree Planner to ${derivedStartYear} (${targetCatalogYear} calendar).`
                    : `Default start year is ${currentAcademicStartYear} (${resolveCatalogYearForStartYear(currentAcademicStartYear, availableCatalogYears)} calendar).`}
                </span>
                {yearOfStudy !== null && (
                  <button
                    type="button"
                    onClick={() => setYearOfStudy(null)}
                    className="ml-3 shrink-0 font-semibold text-[#003C71] hover:underline dark:text-sky-300"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 1: Degree Selection */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px] dark:text-white">
                What degree are you taking?
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Showing Ontario Tech programs for the{" "}
                <span className="font-semibold text-slate-800 tabular-nums dark:text-slate-100">
                  {targetCatalogYear}
                </span>{" "}
                catalog. We&apos;ll prefill this in your Degree Planner.
              </p>

              {selectedDegree && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#BFD7F2] bg-[#EBF3FC]/90 px-3.5 py-2.5 dark:border-sky-800/80 dark:bg-sky-950/40">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#003C71] dark:text-sky-200">
                      {selectedDegree.name}
                    </div>
                    <div className="text-[11px] text-[#003C71]/80 dark:text-sky-300/80">
                      {[
                        selectedDegree.credential,
                        selectedDegree.degree_abbrev,
                        selectedDegree.catalog_year,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDegreeProgramId(null)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#003C71] transition-colors hover:bg-white/80 dark:text-sky-300 dark:hover:bg-slate-900/60"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div className="relative mt-4">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={degreeSearchRef}
                  type="text"
                  value={degreeQuery}
                  onChange={(e) => {
                    setDegreeQuery(e.target.value);
                    setHighlightedDegreeIdx(0);
                  }}
                  onKeyDown={handleDegreeKeyDown}
                  placeholder="Search by major, degree, or faculty..."
                  aria-label="Search degree programs"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-16 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#003C71] focus:ring-2 focus:ring-[#003C71]/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
                />
                {degreeQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setDegreeQuery("");
                      setHighlightedDegreeIdx(-1);
                      degreeSearchRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div
                role="listbox"
                aria-label="Degree programs"
                className="mt-2.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/50"
              >
                {degreeOptions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    <p>No degree programs match &ldquo;{degreeQuery}&rdquo;.</p>
                    {degreeQuery && (
                      <button
                        type="button"
                        onClick={() => setDegreeQuery("")}
                        className="mt-2 text-xs font-semibold text-[#003C71] hover:underline dark:text-sky-300"
                      >
                        Reset search
                      </button>
                    )}
                  </div>
                ) : (
                  degreeOptions.map((prog, index) => {
                    const isSelected = prog.program_id === degreeProgramId;
                    const isHighlighted = index === highlightedDegreeIdx;
                    return (
                      <button
                        key={prog.program_id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() =>
                          setDegreeProgramId(
                            isSelected ? null : prog.program_id,
                          )
                        }
                        className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-none dark:border-slate-800/80 ${
                          isSelected
                            ? "bg-[#EBF3FC] text-[#003C71] dark:bg-sky-950/50 dark:text-sky-100"
                            : isHighlighted
                              ? "bg-slate-100/90 dark:bg-slate-800/80"
                              : "hover:bg-white dark:hover:bg-slate-900"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {prog.name}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {[
                              prog.degree ?? prog.degree_abbrev,
                              prog.faculty,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Ontario Tech University"}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {prog.credential && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                                isSelected
                                  ? "bg-white/90 text-[#003C71] dark:bg-sky-900/60 dark:text-sky-200"
                                  : "bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              }`}
                            >
                              {prog.credential}
                            </span>
                          )}
                          {isSelected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#003C71] text-white dark:bg-sky-400 dark:text-slate-950">
                              <CheckIcon className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Minor Choice & Conditional Minor Selector */}
          {step === 2 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[26px] dark:text-white">
                Are you taking a minor?
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                If you are, choose your minor to track its course requirements
                alongside your main degree.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleSelectHasMinor(false)}
                  aria-pressed={hasMinor === false}
                  className={`flex items-center justify-between rounded-2xl border p-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                    hasMinor === false
                      ? "border-[#003C71] bg-[#EBF3FC] ring-1 ring-[#003C71] dark:border-sky-400 dark:bg-sky-950/50 dark:ring-sky-400"
                      : "border-slate-200 bg-white hover:border-[#9AC0EB] hover:bg-[#F7FAFE] dark:border-slate-700/80 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-slate-800/80"
                  }`}
                >
                  <div>
                    <div
                      className={`text-base font-bold ${
                        hasMinor === false
                          ? "text-[#003C71] dark:text-sky-200"
                          : "text-slate-900 dark:text-white"
                      }`}
                    >
                      No
                    </div>
                    <div
                      className={`mt-0.5 text-xs ${
                        hasMinor === false
                          ? "text-[#003C71]/80 dark:text-sky-300/85"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      Just my main degree for now
                    </div>
                  </div>
                  {hasMinor === false && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003C71] text-white dark:bg-sky-400 dark:text-slate-950">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectHasMinor(true)}
                  aria-pressed={hasMinor === true}
                  className={`flex items-center justify-between rounded-2xl border p-4 text-left transition-all focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                    hasMinor === true
                      ? "border-[#003C71] bg-[#EBF3FC] ring-1 ring-[#003C71] dark:border-sky-400 dark:bg-sky-950/50 dark:ring-sky-400"
                      : "border-slate-200 bg-white hover:border-[#9AC0EB] hover:bg-[#F7FAFE] dark:border-slate-700/80 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-slate-800/80"
                  }`}
                >
                  <div>
                    <div
                      className={`text-base font-bold ${
                        hasMinor === true
                          ? "text-[#003C71] dark:text-sky-200"
                          : "text-slate-900 dark:text-white"
                      }`}
                    >
                      Yes
                    </div>
                    <div
                      className={`mt-0.5 text-xs ${
                        hasMinor === true
                          ? "text-[#003C71]/80 dark:text-sky-300/85"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      Select a minor for my degree plan
                    </div>
                  </div>
                  {hasMinor === true && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003C71] text-white dark:bg-sky-400 dark:text-slate-950">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                  )}
                </button>
              </div>

              {hasMinor === true && (
                <div className="mt-5">
                  {selectedMinor && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#BFD7F2] bg-[#EBF3FC]/90 px-3.5 py-2.5 dark:border-sky-800/80 dark:bg-sky-950/40">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#003C71] dark:text-sky-200">
                          {selectedMinor.name}
                        </div>
                        <div className="text-[11px] text-[#003C71]/80 dark:text-sky-300/80">
                          {[
                            selectedMinor.faculty,
                            selectedMinor.total_credit_hours
                              ? `${selectedMinor.total_credit_hours} cr`
                              : null,
                            selectedMinor.catalog_year,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMinorProgramId(null)}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#003C71] transition-colors hover:bg-white/80 dark:text-sky-300 dark:hover:bg-slate-900/60"
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={minorSearchRef}
                      type="text"
                      value={minorQuery}
                      onChange={(e) => {
                        setMinorQuery(e.target.value);
                        setHighlightedMinorIdx(0);
                      }}
                      onKeyDown={handleMinorKeyDown}
                      placeholder={`Search ${targetCatalogYear} minors...`}
                      aria-label="Search minor programs"
                      autoComplete="off"
                      className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-16 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#003C71] focus:ring-2 focus:ring-[#003C71]/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
                    />
                    {minorQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setMinorQuery("");
                          setHighlightedMinorIdx(-1);
                          minorSearchRef.current?.focus();
                        }}
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div
                    role="listbox"
                    aria-label="Minor programs"
                    className="mt-2.5 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/50"
                  >
                    {minorOptions.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                        <p>No minors match &ldquo;{minorQuery}&rdquo;.</p>
                        {minorQuery && (
                          <button
                            type="button"
                            onClick={() => setMinorQuery("")}
                            className="mt-2 text-xs font-semibold text-[#003C71] hover:underline dark:text-sky-300"
                          >
                            Reset search
                          </button>
                        )}
                      </div>
                    ) : (
                      minorOptions.map((minor, index) => {
                        const isSelected = minor.program_id === minorProgramId;
                        const isHighlighted = index === highlightedMinorIdx;
                        return (
                          <button
                            key={minor.program_id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() =>
                              setMinorProgramId(
                                isSelected ? null : minor.program_id,
                              )
                            }
                            className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-none dark:border-slate-800/80 ${
                              isSelected
                                ? "bg-[#EBF3FC] text-[#003C71] dark:bg-sky-950/50 dark:text-sky-100"
                                : isHighlighted
                                  ? "bg-slate-100/90 dark:bg-slate-800/80"
                                  : "hover:bg-white dark:hover:bg-slate-900"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {minor.name}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {[
                                  minor.faculty,
                                  minor.total_credit_hours
                                    ? `${minor.total_credit_hours} cr`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Ontario Tech University"}
                              </div>
                            </div>

                            {isSelected && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003C71] text-white dark:bg-sky-400 dark:text-slate-950">
                                <CheckIcon className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Summary & Action Footer */}
        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-3.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            {yearSummary || selectedDegree || hasMinor !== null ? (
              <>
                {yearSummary && (
                  <span className="rounded-full border border-[#BFD7F2] bg-white px-2.5 py-0.5 font-medium text-[#003C71] tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
                    {yearSummary} &middot; Start {derivedStartYear}
                  </span>
                )}
                {selectedDegree && (
                  <span className="max-w-full truncate rounded-full border border-[#BFD7F2] bg-white px-2.5 py-0.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    {selectedDegree.name}
                  </span>
                )}
                {hasMinor === true && selectedMinor && (
                  <span className="max-w-full truncate rounded-full border border-[#BFD7F2] bg-white px-2.5 py-0.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    Minor: {selectedMinor.name}
                  </span>
                )}
                {hasMinor === false && (
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    No minor
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                All questions are optional — choose only what you want saved.
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => goToStep((step - 1) as 0 | 1 | 2)}
                  disabled={submitting}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Back
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {isEditing && step < 2 && (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={submitting}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              )}

              {step < 2 ? (
                <>
                  {!stepCompleted[step] && (
                    <button
                      type="button"
                      onClick={() => goToStep((step + 1) as 0 | 1 | 2)}
                      className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    >
                      Skip step
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => goToStep((step + 1) as 0 | 1 | 2)}
                    className="rounded-xl bg-[#003C71] px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[#002D56] focus-visible:ring-2 focus-visible:ring-[#003C71]/50 focus-visible:outline-none dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={submitting}
                  className="rounded-xl bg-[#003C71] px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[#002D56] focus-visible:ring-2 focus-visible:ring-[#003C71]/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                >
                  {submitting
                    ? "Saving..."
                    : isEditing
                      ? "Save changes"
                      : "Finish setup"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
