"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  mergeProgramsPreferringCatalogYear,
  ProgramCombobox,
  programIdentityKey,
  sortDegreePrograms,
  sortMinorPrograms,
} from "@/components/program-combobox";
import {
  findProgramInCatalogYear,
  resolveCatalogYearForStartYear,
  startYearToCatalogYear,
} from "@/lib/degree-planner";
import type { ProgramSummary } from "@/lib/degree-types";
import {
  hasResolvedOnboarding,
  YEAR_OF_STUDY_OPTIONS,
  yearOfStudyToStartYear,
  type YearOfStudy,
} from "@/lib/onboarding";
import type { StudentProfile } from "@/lib/student-courses";

interface SavedPlanSummary {
  program_id: string;
  minor_program_id: string | null;
  hasTerms: boolean;
}

interface OnboardingFlowProps {
  programs: ProgramSummary[];
  availableCatalogYears: string[];
  initialProfile: StudentProfile | null;
  savedPlans?: SavedPlanSummary[];
  nextPath: string;
  currentAcademicStartYear: number;
}

const QUESTION_STEPS = [0, 1, 2] as const;

export function OnboardingFlow({
  programs,
  availableCatalogYears,
  initialProfile,
  savedPlans = [],
  nextPath,
  currentAcademicStartYear,
}: OnboardingFlowProps) {
  const router = useRouter();
  const alreadyResolved = hasResolvedOnboarding(initialProfile);

  const primarySavedPlan = useMemo(
    () => savedPlans.find((p) => p.hasTerms) ?? savedPlans[0] ?? null,
    [savedPlans],
  );
  const savedProgramIds = useMemo(
    () => new Set(savedPlans.map((p) => p.program_id)),
    [savedPlans],
  );

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [yearOfStudy, setYearOfStudy] = useState<YearOfStudy | null>(
    initialProfile?.year_of_study ?? null,
  );
  const [degreeProgramId, setDegreeProgramId] = useState<string | null>(
    initialProfile?.degree_program_id ?? primarySavedPlan?.program_id ?? null,
  );
  const [minorProgramId, setMinorProgramId] = useState<string | null>(() =>
    initialProfile?.has_minor === false
      ? null
      : (initialProfile?.minor_program_id ??
        primarySavedPlan?.minor_program_id ??
        null),
  );

  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasRedirectedRef = useRef(false);

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
    () => (minorProgramId ? (programsById.get(minorProgramId) ?? null) : null),
    [minorProgramId, programsById],
  );

  const degreeOptions = useMemo(() => {
    const merged = mergeProgramsPreferringCatalogYear(
      allDegreePrograms,
      targetCatalogYear,
    );
    if (savedPlans.length > 0) {
      const byIdentity = new Map<string, ProgramSummary>();
      for (const prog of merged) {
        byIdentity.set(programIdentityKey(prog), prog);
      }
      // Preserve the catalog year of any degree the student already has a saved plan for
      // (preferring non-empty / most-recent plans first).
      const orderedSaved = [
        ...savedPlans.filter((p) => p.hasTerms),
        ...savedPlans.filter((p) => !p.hasTerms),
      ];
      const preservedIdentities = new Set<string>();
      for (const saved of orderedSaved) {
        const savedProg = programsById.get(saved.program_id);
        if (!savedProg || savedProg.credential === "Minor") continue;
        const identity = programIdentityKey(savedProg);
        if (preservedIdentities.has(identity)) continue;
        preservedIdentities.add(identity);
        byIdentity.set(identity, savedProg);
      }
      return sortDegreePrograms([...byIdentity.values()], "");
    }
    return sortDegreePrograms(merged, "");
  }, [allDegreePrograms, targetCatalogYear, savedPlans, programsById]);

  const minorOptions = useMemo(() => {
    const merged = mergeProgramsPreferringCatalogYear(
      allMinorPrograms,
      targetCatalogYear,
    );
    return sortMinorPrograms(merged, "");
  }, [allMinorPrograms, targetCatalogYear]);

  useEffect(() => {
    if (!completed) return;
    const timer = window.setTimeout(() => {
      hasRedirectedRef.current = true;
      router.replace(nextPath);
      router.refresh();
    }, 1450);

    return () => {
      window.clearTimeout(timer);
      if (hasRedirectedRef.current) {
        hasRedirectedRef.current = false;
        queueMicrotask(() => setCompleted(false));
      }
    };
  }, [completed, nextPath, router]);

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

    if (
      selectedDegree &&
      selectedDegree.catalog_year !== nextCatalogYear &&
      !savedProgramIds.has(selectedDegree.program_id)
    ) {
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

  async function handleCancel() {
    if (submitting || completed) return;
    if (alreadyResolved) {
      router.replace(nextPath);
      return;
    }

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
        throw new Error(data.error || "Could not cancel onboarding.");
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not cancel onboarding.",
      );
      setSubmitting(false);
    }
  }

  async function handleSave() {
    if (submitting || completed) return;
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
          hasMinor: Boolean(minorProgramId),
          minorProgramId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not save your responses.");
      }
      setSubmitting(false);
      setCompleted(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not save your responses.",
      );
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (submitting || completed) return;
    setErrorMessage(null);
    if (step < 2) {
      setStep((step + 1) as 0 | 1 | 2);
      return;
    }
    void handleSave();
  }

  function handleBack() {
    if (submitting || completed || step === 0) return;
    setErrorMessage(null);
    setStep((step - 1) as 0 | 1 | 2);
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:px-6">
      <section className="overflow-visible rounded-2xl border border-[#BFD7F2]/80 bg-white px-6 py-6 shadow-[0_12px_36px_-18px_rgba(0,60,113,0.16)] sm:px-8 sm:py-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/45">
        {completed ? (
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-[260px] flex-col items-center justify-center py-6 text-center"
          >
            <div className="wallet-badge relative flex h-[88px] w-[88px] items-center justify-center">
              <span
                aria-hidden="true"
                className="wallet-ring pointer-events-none absolute inset-1 rounded-full border-2 border-[#0071E3]/45 dark:border-sky-400/45"
              />
              <svg
                className="h-[88px] w-[88px] text-[#0071E3] dark:text-sky-400"
                viewBox="0 0 88 88"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="44"
                  cy="44"
                  r="36"
                  className="fill-[#0071E3]/8 dark:fill-sky-400/12"
                />
                <circle
                  cx="44"
                  cy="44"
                  r="36"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  transform="rotate(-90 44 44)"
                  className="wallet-circle"
                />
                <path
                  d="M29 45.5 L39.5 55.5 L59 34"
                  stroke="currentColor"
                  strokeWidth="3.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="wallet-check"
                />
              </svg>
            </div>
            <p className="wallet-label mt-5 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Completed
            </p>
          </div>
        ) : (
          <>
            {/* Top Bar: Cancel / Save on left, step dots on right */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={submitting}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={submitting}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#003C71] transition-colors hover:bg-[#EBF3FC] focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-950/60"
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>

              <div
                className="flex items-center gap-1.5"
                role="tablist"
                aria-label="Survey progress"
              >
                {QUESTION_STEPS.map((idx) => {
                  const isActive = step === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-label={`Question ${idx + 1} of 3`}
                      onClick={() => {
                        setErrorMessage(null);
                        setStep(idx);
                      }}
                      className={`h-1.5 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                        isActive
                          ? "w-5 bg-[#003C71] dark:bg-sky-400"
                          : "w-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Question Body */}
            <div className="mt-7">
              {errorMessage && (
                <div
                  role="alert"
                  className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
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

              {step === 0 && (
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                    What year are you in?
                  </h1>

                  <div
                    role="radiogroup"
                    aria-label="Year of study"
                    className="mt-6 space-y-2.5"
                  >
                    {YEAR_OF_STUDY_OPTIONS.map((option) => {
                      const selected = yearOfStudy === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => handleSelectYear(option.value)}
                          className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
                            selected
                              ? "border-[#003C71] bg-[#EBF3FC]/90 text-[#003C71] dark:border-sky-400 dark:bg-sky-950/50 dark:text-sky-200"
                              : "border-slate-200 bg-white text-slate-700 hover:border-[#9AC0EB] hover:bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:bg-slate-800/70"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                              selected
                                ? "border-[#003C71] bg-[#003C71] dark:border-sky-400 dark:bg-sky-400"
                                : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                            }`}
                          >
                            {selected && (
                              <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-950" />
                            )}
                          </span>
                          <span>{option.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                    What degree are you taking?
                  </h1>

                  <div className="mt-6">
                    <ProgramCombobox
                      options={degreeOptions}
                      value={degreeProgramId}
                      selectedProgram={selectedDegree}
                      onChange={setDegreeProgramId}
                      placeholder="Select or type your degree..."
                      ariaLabel="Degree program"
                      emptyMessage="No matching degrees found."
                      showCredential
                      preferredCatalogYear={targetCatalogYear}
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                    What minor are you taking?
                  </h1>

                  <div className="mt-6">
                    <ProgramCombobox
                      options={minorOptions}
                      value={minorProgramId}
                      selectedProgram={selectedMinor}
                      onChange={setMinorProgramId}
                      placeholder="Optional — select or type a minor..."
                      ariaLabel="Minor program"
                      emptyMessage="No matching minors found."
                      showCredential={false}
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Arrow Navigation */}
            <div className="mt-8 flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                disabled={step === 0 || submitting}
                aria-label="Previous question"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              </button>

              <button
                type="button"
                onClick={handleNext}
                disabled={submitting}
                aria-label={step < 2 ? "Next question" : "Complete survey"}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#003C71] text-white shadow-xs transition-colors hover:bg-[#002D56] focus-visible:ring-2 focus-visible:ring-[#003C71]/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
              >
                {submitting ? (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="opacity-25"
                    />
                    <path
                      d="M21 12a9 9 0 0 0-9-9"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
