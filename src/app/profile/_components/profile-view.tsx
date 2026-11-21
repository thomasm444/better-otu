"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import {
  ProgramCombobox,
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
  YEAR_OF_STUDY_OPTIONS,
  yearOfStudyToStartYear,
  type YearOfStudy,
} from "@/lib/onboarding";
import type { StudentProfile } from "@/lib/student-courses";

interface ProfileViewProps {
  programs: ProgramSummary[];
  availableCatalogYears: string[];
  initialProfile: StudentProfile | null;
  displayName: string;
  email: string;
  currentAcademicStartYear: number;
}

type EditableField = "year" | "degree" | "minor";

export function ProfileView({
  programs,
  availableCatalogYears,
  initialProfile,
  displayName,
  email,
  currentAcademicStartYear,
}: ProfileViewProps) {
  const router = useRouter();

  const [profileOverride, setProfileOverride] = useState<{
    forProfile: StudentProfile | null;
    year: YearOfStudy | null;
    degreeId: string | null;
    minorId: string | null;
  } | null>(null);

  const activeOverride =
    profileOverride && profileOverride.forProfile === initialProfile
      ? profileOverride
      : null;

  const yearOfStudy = activeOverride
    ? activeOverride.year
    : (initialProfile?.year_of_study ?? null);
  const degreeProgramId = activeOverride
    ? activeOverride.degreeId
    : (initialProfile?.degree_program_id ?? null);
  const minorProgramId = activeOverride
    ? activeOverride.minorId
    : initialProfile?.has_minor === false
      ? null
      : (initialProfile?.minor_program_id ?? null);

  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [draftYear, setDraftYear] = useState<YearOfStudy | null>(yearOfStudy);
  const [draftDegreeId, setDraftDegreeId] = useState<string | null>(
    degreeProgramId,
  );
  const [draftMinorId, setDraftMinorId] = useState<string | null>(
    minorProgramId,
  );

  const [saving, setSaving] = useState(false);
  const [savedField, setSavedField] = useState<EditableField | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!savedField) return;
    const timer = window.setTimeout(() => setSavedField(null), 2000);
    return () => window.clearTimeout(timer);
  }, [savedField]);

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

  const draftSelectedDegree = useMemo(
    () => (draftDegreeId ? (programsById.get(draftDegreeId) ?? null) : null),
    [draftDegreeId, programsById],
  );

  const draftSelectedMinor = useMemo(
    () => (draftMinorId ? (programsById.get(draftMinorId) ?? null) : null),
    [draftMinorId, programsById],
  );

  const degreeOptions = useMemo(() => {
    const inCatalog = allDegreePrograms.filter(
      (p) => p.catalog_year === targetCatalogYear,
    );
    const pool = inCatalog.length > 0 ? inCatalog : allDegreePrograms;
    return sortDegreePrograms(pool, "");
  }, [allDegreePrograms, targetCatalogYear]);

  const minorOptions = useMemo(() => {
    const inCatalog = allMinorPrograms.filter(
      (p) => p.catalog_year === targetCatalogYear,
    );
    const pool = inCatalog.length > 0 ? inCatalog : allMinorPrograms;
    return sortMinorPrograms(pool, "");
  }, [allMinorPrograms, targetCatalogYear]);

  function startEdit(field: EditableField) {
    if (saving) return;
    setErrorMessage(null);
    setSavedField(null);
    setDraftYear(yearOfStudy);
    setDraftDegreeId(degreeProgramId);
    setDraftMinorId(minorProgramId);
    setEditingField(field);
  }

  function cancelEdit() {
    if (saving) return;
    setErrorMessage(null);
    setEditingField(null);
  }

  async function persistProfile(
    field: EditableField,
    nextValues: {
      year: YearOfStudy | null;
      degreeId: string | null;
      minorId: string | null;
    },
  ) {
    if (saving) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          yearOfStudy: nextValues.year,
          degreeProgramId: nextValues.degreeId,
          hasMinor: Boolean(nextValues.minorId),
          minorProgramId: nextValues.minorId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not update your profile.");
      }

      setProfileOverride({
        forProfile: initialProfile,
        year: nextValues.year,
        degreeId: nextValues.degreeId,
        minorId: nextValues.minorId,
      });
      setEditingField(null);
      setSavedField(field);
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not update your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleSaveYear() {
    const nextStartYear = yearOfStudyToStartYear(
      draftYear,
      currentAcademicStartYear,
    );
    const nextCatalogYear =
      availableCatalogYears.length > 0
        ? resolveCatalogYearForStartYear(nextStartYear, availableCatalogYears)
        : startYearToCatalogYear(nextStartYear);

    let remappedDegreeId = degreeProgramId;
    if (selectedDegree && selectedDegree.catalog_year !== nextCatalogYear) {
      const match = findProgramInCatalogYear(
        allDegreePrograms,
        selectedDegree,
        nextCatalogYear,
      );
      if (match) remappedDegreeId = match.program_id;
    }

    let remappedMinorId = minorProgramId;
    if (selectedMinor && selectedMinor.catalog_year !== nextCatalogYear) {
      const match = findProgramInCatalogYear(
        allMinorPrograms,
        selectedMinor,
        nextCatalogYear,
      );
      if (match) remappedMinorId = match.program_id;
    }

    void persistProfile("year", {
      year: draftYear,
      degreeId: remappedDegreeId,
      minorId: remappedMinorId,
    });
  }

  function handleSaveDegree() {
    void persistProfile("degree", {
      year: yearOfStudy,
      degreeId: draftDegreeId,
      minorId: minorProgramId,
    });
  }

  function handleSaveMinor() {
    void persistProfile("minor", {
      year: yearOfStudy,
      degreeId: degreeProgramId,
      minorId: draftMinorId,
    });
  }

  const yearLabel =
    YEAR_OF_STUDY_OPTIONS.find((opt) => opt.value === yearOfStudy)?.title ??
    null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <svg
          className="h-3.5 w-3.5"
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
        <span>Back to Home</span>
      </Link>

      <header className="mt-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {displayName}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {email}
        </p>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
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

      <section className="mt-6 divide-y divide-slate-100 overflow-visible rounded-2xl border border-[#BFD7F2]/80 bg-white shadow-[0_10px_30px_-18px_rgba(0,60,113,0.16)] dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/45">
        {/* Row 1: Year */}
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Year
              </p>
              {editingField !== "year" && (
                <p
                  className={`mt-1 text-sm font-semibold ${
                    yearLabel
                      ? "text-slate-900 dark:text-white"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {yearLabel ?? "Not set"}
                </p>
              )}
            </div>

            {editingField !== "year" && (
              <div className="flex shrink-0 items-center gap-2.5">
                {savedField === "year" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startEdit("year")}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {editingField === "year" && (
            <div className="mt-3.5">
              <div
                role="radiogroup"
                aria-label="Year of study"
                className="space-y-2"
              >
                {YEAR_OF_STUDY_OPTIONS.map((option) => {
                  const selected = draftYear === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() =>
                        setDraftYear(selected ? null : option.value)
                      }
                      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none ${
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

              <div className="mt-3.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveYear}
                  disabled={saving}
                  className="rounded-lg bg-[#003C71] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#002D56] disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Row 2: Degree */}
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Degree
              </p>
              {editingField !== "degree" && (
                <p
                  className={`mt-1 text-sm font-semibold ${
                    selectedDegree
                      ? "text-slate-900 dark:text-white"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {selectedDegree?.name ?? "Not set"}
                </p>
              )}
            </div>

            {editingField !== "degree" && (
              <div className="flex shrink-0 items-center gap-2.5">
                {savedField === "degree" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startEdit("degree")}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {editingField === "degree" && (
            <div className="mt-3.5">
              <ProgramCombobox
                options={degreeOptions}
                value={draftDegreeId}
                selectedProgram={draftSelectedDegree}
                onChange={setDraftDegreeId}
                placeholder="Select or type your degree..."
                ariaLabel="Degree program"
                emptyMessage="No matching degrees found."
                showCredential
                disabled={saving}
              />

              <div className="mt-3.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDegree}
                  disabled={saving}
                  className="rounded-lg bg-[#003C71] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#002D56] disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Row 3: Minor */}
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Minor
              </p>
              {editingField !== "minor" && (
                <p
                  className={`mt-1 text-sm font-semibold ${
                    selectedMinor
                      ? "text-slate-900 dark:text-white"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {selectedMinor?.name ?? "None"}
                </p>
              )}
            </div>

            {editingField !== "minor" && (
              <div className="flex shrink-0 items-center gap-2.5">
                {savedField === "minor" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startEdit("minor")}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {editingField === "minor" && (
            <div className="mt-3.5">
              <ProgramCombobox
                options={minorOptions}
                value={draftMinorId}
                selectedProgram={draftSelectedMinor}
                onChange={setDraftMinorId}
                placeholder="None (optional)"
                ariaLabel="Minor program"
                emptyMessage="No matching minors found."
                showCredential={false}
                disabled={saving}
              />

              <div className="mt-3.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveMinor}
                  disabled={saving}
                  className="rounded-lg bg-[#003C71] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#002D56] disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
