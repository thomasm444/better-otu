"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  deleteDegreePlan,
  fetchAllDegreePlans,
  fetchDegreePlanByProgram,
  upsertDegreePlan,
  type DegreePlanRecord,
} from "@/lib/degree-plan-storage";
import { yearOfStudyToStartYear } from "@/lib/onboarding";
import {
  fetchStudentProfile,
} from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/client";

import {
  allocateBuckets,
  assignBreadthBuckets,
  buildDefaultPlan,
  buildEquivalenceMap,
  buildModel,
  buildOfferingContext,
  buildOfferingsMap,
  catalogYearToStartYear,
  courseOf,
  creditsOf,
  CREDIT_CAP,
  DEFAULT_START_YEAR,
  earnedCodes,
  evaluatePlanRequirements,
  expandWithEquivalents,
  findEquivalentInSet,
  findProgramInCatalogYear,
  firstFreeSlot,
  matchesBucket,
  MAX_SLOTS_PER_TERM,
  MAX_START_YEAR,
  MIN_PLAN_CATALOG_YEAR,
  MIN_START_YEAR,
  normalizeTermSlots,
  placedCodes,
  placedTermIndex,
  prereqFlag,
  resolveCatalogYearForStartYear,
  seasonsOf,
  SLOTS_PER_TERM,
  startYearToCatalogYear,
  STORE_PREFIX,
  termCalendarYear,
  termCredits,
  transferCodes,
} from "@/lib/degree-planner";
import type {
  CatalogCourse,
  CustomCourse,
  DegreeBootstrapData,
  DegreeProgramDetail,
  ElectiveBucket,
  ElectiveMatch,
  OfferingContext,
  OfferingEntry,
  PickerState,
  PlannerTerm,
  ProgramSummary,
  RequirementModel,
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
  startYear?: number;
  gapYears?: number[];
  planName?: string;
  minorProgramId?: string | null;
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
  startYear: number = DEFAULT_START_YEAR,
  gapYears: number[] = [],
  planName?: string,
  minorProgramId?: string | null,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORE_PREFIX + programId,
    JSON.stringify({
      terms,
      customs: [...customs.values()],
      startYear,
      gapYears,
      ...(planName ? { planName } : {}),
      ...(minorProgramId ? { minorProgramId } : {}),
    }),
  );
}

/** Reconstruct gap years from skipped academic-year numbers when loading remote plans. */
function inferGapYearsFromTerms(terms: PlannerTerm[]): number[] {
  if (terms.length === 0) return [];
  const presentYears = new Set(terms.map((t) => t.year));
  const maxYear = Math.max(0, ...presentYears);
  const gaps: number[] = [];
  for (let y = 1; y < maxYear; y++) {
    if (!presentYears.has(y)) gaps.push(y);
  }
  return gaps;
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

  const equivMap = useMemo(
    () => buildEquivalenceMap(bootstrap.courses),
    [bootstrap.courses],
  );

  const offeringsMap = useMemo(
    () => buildOfferingsMap(bootstrap.offerings, bootstrap.courses),
    [bootstrap.offerings, bootstrap.courses],
  );

  const offeringContext = useMemo(
    () => buildOfferingContext(bootstrap.offerings, bootstrap.courses),
    [bootstrap.offerings, bootstrap.courses],
  );

  const startYearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = MAX_START_YEAR; y >= MIN_START_YEAR; y--) {
      years.push(y);
    }
    return years;
  }, []);

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

  const availableCatalogYears = useMemo(() => {
    const source =
      bootstrap.catalogYears && bootstrap.catalogYears.length > 0
        ? bootstrap.catalogYears
        : [
            ...new Set(
              bootstrap.programs.map((p) => p.catalog_year).filter(Boolean),
            ),
          ].sort((a, b) => b.localeCompare(a));
    const filtered = source.filter((cy) => cy >= MIN_PLAN_CATALOG_YEAR);
    if (filtered.length > 0) return filtered;
    return source.length > 0
      ? source
      : [startYearToCatalogYear(DEFAULT_START_YEAR)];
  }, [bootstrap.catalogYears, bootstrap.programs]);

  const initialStartYear = useMemo(
    () =>
      initialProgram
        ? (catalogYearToStartYear(initialProgram.catalog_year) ??
          DEFAULT_START_YEAR)
        : DEFAULT_START_YEAR,
    [initialProgram],
  );

  const initialDefaultPlan = useMemo(() => {
    if (!initialProgram) return { terms: [], unscheduled: [] as UnscheduledItem[] };
    return buildDefaultPlan(initialProgram, catalogMap, offeringsMap, new Map(), {
      startYear: initialStartYear,
      context: offeringContext,
    });
  }, [initialProgram, catalogMap, offeringsMap, initialStartYear, offeringContext]);

  const [program, setProgram] = useState<DegreeProgramDetail | null>(
    initialProgram,
  );
  const [loadingProgram, setLoadingProgram] = useState(false);
  const [programQuery, setProgramQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [planName, setPlanName] = useState(initialProgram?.name ?? "");
  const [editingPlanName, setEditingPlanName] = useState(false);
  const [planNameDraft, setPlanNameDraft] = useState("");
  const [addPlanModalOpen, setAddPlanModalOpen] = useState(false);
  const [newPlanQuery, setNewPlanQuery] = useState("");
  const [newPlanProgram, setNewPlanProgram] = useState<ProgramSummary | null>(
    null,
  );
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanStartYear, setNewPlanStartYear] = useState<number>(
    DEFAULT_START_YEAR,
  );
  const [newPlanCatalogYear, setNewPlanCatalogYear] = useState<string>(() =>
    resolveCatalogYearForStartYear(DEFAULT_START_YEAR, availableCatalogYears),
  );
  const [newPlanCatalogManuallySet, setNewPlanCatalogManuallySet] =
    useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [startYear, setStartYear] = useState<number>(initialStartYear);
  const [catalogYear, setCatalogYear] = useState<string>(() =>
    initialProgram
      ? initialProgram.catalog_year
      : resolveCatalogYearForStartYear(initialStartYear, availableCatalogYears),
  );
  const [catalogManuallySet, setCatalogManuallySet] = useState(() =>
    Boolean(
      initialProgram &&
        initialProgram.catalog_year !==
          resolveCatalogYearForStartYear(initialStartYear, availableCatalogYears),
    ),
  );
  const [gapYears, setGapYears] = useState<number[]>([]);

  const [customs, setCustoms] = useState<Map<string, CustomCourse>>(
    () => new Map(),
  );
  const [terms, setTerms] = useState<PlannerTerm[]>(
    () => initialDefaultPlan.terms,
  );
  const [unscheduled, setUnscheduled] = useState<UnscheduledItem[]>(
    () => initialDefaultPlan.unscheduled,
  );
  const [planMismatches, setPlanMismatches] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [previousPlan, setPreviousPlan] = useState<{
    programId: string;
    terms: PlannerTerm[];
    customs: CustomCourse[];
  } | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [gapYearToInsert, setGapYearToInsert] = useState<{
    academicYear: number;
    calStart: number;
    calEnd: number;
  } | null>(null);
  const [pendingRemoveCourse, setPendingRemoveCourse] = useState<{
    termIndex: number;
    slotIndex: number;
    code: string;
    requiredFor: string[];
    closeDetailsModal?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!pendingRemoveCourse) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingRemoveCourse(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingRemoveCourse]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"major" | "minor">("major");
  const [minorProgram, setMinorProgram] =
    useState<DegreeProgramDetail | null>(null);
  const [loadingMinor, setLoadingMinor] = useState(false);

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerTransferMode, setPickerTransferMode] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<{
    code: string;
    termIndex: number;
    slotIndex: number;
  } | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [overloadTooltip, setOverloadTooltip] = useState<{
    termIndex: number;
    creds: number;
    top: number;
    right: number;
  } | null>(null);

  const openOverloadTooltip = (
    el: HTMLElement,
    termIndex: number,
    creds: number,
  ) => {
    const r = el.getBoundingClientRect();
    setOverloadTooltip({
      termIndex,
      creds,
      top: r.bottom + 6,
      right: Math.max(12, window.innerWidth - r.right),
    });
  };

  const closeOverloadTooltip = (termIndex: number) => {
    setOverloadTooltip((cur) => (cur?.termIndex === termIndex ? null : cur));
  };
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profileDefaultStartYear, setProfileDefaultStartYear] =
    useState<number>(DEFAULT_START_YEAR);
  const [savedPlans, setSavedPlans] = useState<DegreePlanRecord[]>([]);
  const [plansMenuOpen, setPlansMenuOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<DegreePlanRecord | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [carryPreviewOnAdd, setCarryPreviewOnAdd] = useState(false);

  const userRef = useRef<User | null>(null);
  const programRef = useRef<DegreeProgramDetail | null>(initialProgram);
  const minorRef = useRef<DegreeProgramDetail | null>(null);
  const savedPlansRef = useRef<DegreePlanRecord[]>([]);

  const menuContainerRef = useRef<HTMLDivElement>(null);
  const plansMenuContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(152);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      if (next > 0) setHeaderHeight(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Parameters<typeof upsertDegreePlan>[1] | null>(
    null,
  );

  useEffect(() => {
    programRef.current = program;
  }, [program]);

  useEffect(() => {
    minorRef.current = minorProgram;
  }, [minorProgram]);

  useEffect(() => {
    savedPlansRef.current = savedPlans;
  }, [savedPlans]);

  const isCurrentProgramSaved = useMemo(
    () =>
      Boolean(
        program && savedPlans.some((p) => p.program_id === program.program_id),
      ),
    [program, savedPlans],
  );

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1800);
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const payload = pendingSaveRef.current;
    if (!payload) return;
    pendingSaveRef.current = null;
    try {
      const savedRecord = await upsertDegreePlan(supabase, payload);
      setSavedPlans((prev) => {
        const next = [
          savedRecord,
          ...prev.filter((p) => p.program_id !== savedRecord.program_id),
        ];
        savedPlansRef.current = next;
        return next;
      });
    } catch {
      showToast("Could not save plan to your account");
    }
  }, [supabase, showToast]);

  useEffect(() => {
    const handleFlush = () => {
      void flushPendingSave();
    };
    window.addEventListener("pagehide", handleFlush);
    window.addEventListener("beforeunload", handleFlush);
    return () => {
      window.removeEventListener("pagehide", handleFlush);
      window.removeEventListener("beforeunload", handleFlush);
      void flushPendingSave();
    };
  }, [flushPendingSave]);

  const applyProgramWithSaved = useCallback(
    (prog: DegreeProgramDetail, saved: SavedPlan, startYearOverride?: number) => {
      const nextCustoms = new Map(
        (saved.customs ?? []).map((c) => [c.code, c]),
      );
      const nextStartYear = startYearOverride ?? saved.startYear ?? startYear;
      const nextGapYears =
        saved.gapYears ?? inferGapYearsFromTerms(saved.terms ?? []);
      setStartYear(nextStartYear);
      setCatalogYear(prog.catalog_year);
      setCatalogManuallySet(
        prog.catalog_year !==
          resolveCatalogYearForStartYear(nextStartYear, availableCatalogYears),
      );
      setGapYears(nextGapYears);
      setGapYearToInsert(null);

      if (saved.terms && saved.terms.length > 0) {
        setTerms(
          saved.terms.map((t) => ({
            ...t,
            slots: normalizeTermSlots(t.slots),
          })),
        );
        setUnscheduled([]);
      } else {
        const built = buildDefaultPlan(
          prog,
          catalogMap,
          offeringsMap,
          nextCustoms,
          { startYear: nextStartYear, gapYears: nextGapYears, context: offeringContext },
        );
        setTerms(built.terms);
        setUnscheduled(built.unscheduled);
      }
      setCustoms(nextCustoms);
      setPlanMismatches(new Map());
      setProgram(prog);
      setProgramQuery("");
      setPlanName(saved.planName?.trim() || prog.name);
      setEditingPlanName(false);
    },
    [catalogMap, offeringsMap, offeringContext, startYear, availableCatalogYears],
  );

  const loadProgramDetail = useCallback(async (programId: string) => {
    const cached = programCacheRef.current.get(programId);
    if (cached) return cached;

    const res = await fetch(
      `/api/degree-planner/programs/${encodeURIComponent(programId)}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as DegreeProgramDetail;
    programCacheRef.current.set(detail.program_id, detail);
    return detail;
  }, []);

  const loadMinorDetail = useCallback(
    async (minorId: string | null | undefined) => {
      if (!minorId) {
        setMinorProgram(null);
        return;
      }
      setLoadingMinor(true);
      try {
        const detail = await loadProgramDetail(minorId);
        setMinorProgram(detail);
      } catch {
        setMinorProgram(null);
      } finally {
        setLoadingMinor(false);
      }
    },
    [loadProgramDetail],
  );

  const activateProgram = useCallback(
    async (
      prog: DegreeProgramDetail,
      activeUser?: User | null,
      startYearOverride?: number,
    ) => {
      const knownSaved = savedPlansRef.current.some(
        (p) => p.program_id === prog.program_id,
      );
      const localSaved = knownSaved ? loadSavedPlan(prog.program_id) : {};
      applyProgramWithSaved(prog, localSaved, startYearOverride);
      if (knownSaved && localSaved.minorProgramId) {
        void loadMinorDetail(localSaved.minorProgramId);
      } else {
        setMinorProgram(null);
        setSidebarTab("major");
      }

      const resolvedUser = activeUser !== undefined ? activeUser : userRef.current;
      if (!resolvedUser?.email) return;

      try {
        const remote = await fetchDegreePlanByProgram(
          supabase,
          resolvedUser.email,
          prog.program_id,
        );
        if (
          remote &&
          (remote.terms.length > 0 ||
            remote.customs.length > 0 ||
            remote.start_year != null ||
            remote.minor_program_id != null)
        ) {
          const nextCustoms = new Map(
            remote.customs.map((c) => [c.code, c]),
          );
          const nextStartYear =
            startYearOverride ?? remote.start_year ?? undefined;
          const nextPlanName = remote.degree_name?.trim() || prog.name;
          const inferredGapYears = inferGapYearsFromTerms(remote.terms);
          applyProgramWithSaved(prog, {
            terms: remote.terms,
            customs: remote.customs,
            startYear: nextStartYear,
            gapYears: inferredGapYears,
            planName: nextPlanName,
            minorProgramId: remote.minor_program_id,
          });
          persistPlan(
            prog.program_id,
            remote.terms,
            nextCustoms,
            nextStartYear,
            inferredGapYears,
            nextPlanName,
            remote.minor_program_id,
          );
          void loadMinorDetail(remote.minor_program_id);
        } else if (knownSaved) {
          // Ensure preview stays clean if remote record was removed elsewhere.
          applyProgramWithSaved(prog, {}, startYearOverride);
          setMinorProgram(null);
        }
      } catch {
        // Keep local state if remote fetch fails.
      }
    },
    [applyProgramWithSaved, loadMinorDetail, supabase],
  );

  // Cache SSR-preloaded program on mount (saved state is hydrated from Supabase below)
  useEffect(() => {
    if (!initialProgram) return;
    programCacheRef.current.set(initialProgram.program_id, initialProgram);
  }, [initialProgram]);

  // Sync auth state and load the student's saved Supabase plan on mount / sign-in
  useEffect(() => {
    let active = true;

    async function hydrateForUser(nextUser: User | null) {
      userRef.current = nextUser;
      setUser(nextUser);
      if (!nextUser?.email) {
        setProfileDefaultStartYear(DEFAULT_START_YEAR);
        savedPlansRef.current = [];
        setSavedPlans([]);
        return;
      }

      const currentProg = programRef.current;
      try {
        const [allPlans, profile] = await Promise.all([
          fetchAllDegreePlans(supabase, nextUser.email),
          fetchStudentProfile(supabase, nextUser.id).catch(() => null),
        ]);
        if (!active) return;
        savedPlansRef.current = allPlans;
        setSavedPlans(allPlans);

        const derivedStartYear = profile?.year_of_study
          ? yearOfStudyToStartYear(profile.year_of_study)
          : DEFAULT_START_YEAR;
        setProfileDefaultStartYear(derivedStartYear);

        if (currentProg) {
          const remote = allPlans.find(
            (p) => p.program_id === currentProg.program_id,
          );
          if (
            remote &&
            (remote.terms.length > 0 ||
              remote.customs.length > 0 ||
              remote.start_year != null ||
              remote.minor_program_id != null)
          ) {
            const nextCustoms = new Map(
              remote.customs.map((c) => [c.code, c]),
            );
            const effectiveStartYear = remote.start_year ?? derivedStartYear;
            const nextPlanName = remote.degree_name?.trim() || currentProg.name;

            if (remote.terms.length === 0) {
              const built = buildDefaultPlan(
                currentProg,
                catalogMap,
                offeringsMap,
                nextCustoms,
                {
                  startYear: effectiveStartYear,
                  gapYears: [],
                  context: offeringContext,
                },
              );
              applyProgramWithSaved(currentProg, {
                terms: built.terms,
                customs: remote.customs,
                startYear: effectiveStartYear,
                gapYears: [],
                planName: nextPlanName,
                minorProgramId: remote.minor_program_id,
              });
              setUnscheduled(built.unscheduled);
              persistPlan(
                currentProg.program_id,
                built.terms,
                nextCustoms,
                effectiveStartYear,
                [],
                nextPlanName,
                remote.minor_program_id,
              );
              void loadMinorDetail(remote.minor_program_id);
              void upsertDegreePlan(supabase, {
                userId: nextUser.id,
                userEmail: nextUser.email,
                degreeName: nextPlanName,
                startYear: effectiveStartYear,
                catalogYear: currentProg.catalog_year,
                programId: currentProg.program_id,
                minorProgramId: remote.minor_program_id,
                terms: built.terms,
                customs: remote.customs,
              })
                .then((savedRecord) => {
                  if (!active) return;
                  setSavedPlans((prev) => {
                    const next = [
                      savedRecord,
                      ...prev.filter(
                        (p) => p.program_id !== savedRecord.program_id,
                      ),
                    ];
                    savedPlansRef.current = next;
                    return next;
                  });
                })
                .catch(() => {
                  // Ignore background hydration sync failure
                });
            } else {
              const inferredGapYears = inferGapYearsFromTerms(remote.terms);
              applyProgramWithSaved(currentProg, {
                terms: remote.terms,
                customs: remote.customs,
                startYear: effectiveStartYear,
                gapYears: inferredGapYears,
                planName: nextPlanName,
                minorProgramId: remote.minor_program_id,
              });
              persistPlan(
                currentProg.program_id,
                remote.terms,
                nextCustoms,
                effectiveStartYear,
                inferredGapYears,
                nextPlanName,
                remote.minor_program_id,
              );
              void loadMinorDetail(remote.minor_program_id);
            }
          }
          return;
        }

        const profilePlan = profile?.degree_program_id
          ? allPlans.find((p) => p.program_id === profile.degree_program_id)
          : undefined;
        const latest = profilePlan ?? allPlans[0];
        if (!latest) {
          setStartYear(derivedStartYear);
          setCatalogYear(
            resolveCatalogYearForStartYear(
              derivedStartYear,
              availableCatalogYears,
            ),
          );

          if (!profile?.degree_program_id) return;

          setLoadingProgram(true);
          const detail = await loadProgramDetail(profile.degree_program_id);
          if (!active) return;

          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("program", detail.program_id);
            window.history.replaceState(null, "", url.toString());
          }

          const emptyCustoms = new Map<string, CustomCourse>();
          const built = buildDefaultPlan(
            detail,
            catalogMap,
            offeringsMap,
            emptyCustoms,
            {
              startYear: derivedStartYear,
              gapYears: [],
              context: offeringContext,
            },
          );
          const minorId =
            profile.has_minor !== false
              ? (profile.minor_program_id ?? null)
              : null;

          applyProgramWithSaved(detail, {
            terms: built.terms,
            customs: [],
            startYear: derivedStartYear,
            gapYears: [],
            planName: detail.name,
            minorProgramId: minorId,
          });
          setUnscheduled(built.unscheduled);
          persistPlan(
            detail.program_id,
            built.terms,
            emptyCustoms,
            derivedStartYear,
            [],
            detail.name,
            minorId,
          );
          void loadMinorDetail(minorId);

          try {
            const savedRecord = await upsertDegreePlan(supabase, {
              userId: nextUser.id,
              userEmail: nextUser.email,
              degreeName: detail.name,
              startYear: derivedStartYear,
              catalogYear: detail.catalog_year,
              programId: detail.program_id,
              minorProgramId: minorId,
              terms: built.terms,
              customs: [],
            });
            if (active) {
              savedPlansRef.current = [savedRecord];
              setSavedPlans([savedRecord]);
            }
          } catch {
            // Keep generated plan in view even if initial save fails
          }
          return;
        }

        setLoadingProgram(true);
        const detail = await loadProgramDetail(latest.program_id);
        if (!active) return;

        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("program", detail.program_id);
          window.history.replaceState(null, "", url.toString());
        }

        const nextCustoms = new Map(latest.customs.map((c) => [c.code, c]));
        const effectiveStartYear = latest.start_year ?? derivedStartYear;
        const nextPlanName = latest.degree_name?.trim() || detail.name;

        if (latest.terms.length === 0) {
          const built = buildDefaultPlan(
            detail,
            catalogMap,
            offeringsMap,
            nextCustoms,
            {
              startYear: effectiveStartYear,
              gapYears: [],
              context: offeringContext,
            },
          );
          applyProgramWithSaved(detail, {
            terms: built.terms,
            customs: latest.customs,
            startYear: effectiveStartYear,
            gapYears: [],
            planName: nextPlanName,
            minorProgramId: latest.minor_program_id,
          });
          setUnscheduled(built.unscheduled);
          persistPlan(
            detail.program_id,
            built.terms,
            nextCustoms,
            effectiveStartYear,
            [],
            nextPlanName,
            latest.minor_program_id,
          );
          void loadMinorDetail(latest.minor_program_id);
          void upsertDegreePlan(supabase, {
            userId: nextUser.id,
            userEmail: nextUser.email,
            degreeName: nextPlanName,
            startYear: effectiveStartYear,
            catalogYear: detail.catalog_year,
            programId: detail.program_id,
            minorProgramId: latest.minor_program_id,
            terms: built.terms,
            customs: latest.customs,
          })
            .then((savedRecord) => {
              if (!active) return;
              setSavedPlans((prev) => {
                const next = [
                  savedRecord,
                  ...prev.filter(
                    (p) => p.program_id !== savedRecord.program_id,
                  ),
                ];
                savedPlansRef.current = next;
                return next;
              });
            })
            .catch(() => {
              // Ignore background hydration sync failure
            });
        } else {
          const latestGapYears = inferGapYearsFromTerms(latest.terms);
          applyProgramWithSaved(detail, {
            terms: latest.terms,
            customs: latest.customs,
            startYear: effectiveStartYear,
            gapYears: latestGapYears,
            planName: nextPlanName,
            minorProgramId: latest.minor_program_id,
          });
          persistPlan(
            detail.program_id,
            latest.terms,
            nextCustoms,
            effectiveStartYear,
            latestGapYears,
            nextPlanName,
            latest.minor_program_id,
          );
          void loadMinorDetail(latest.minor_program_id);
        }
      } catch {
        if (active) showToast("Could not load saved degree plan");
      } finally {
        if (active) setLoadingProgram(false);
      }
    }

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      void hydrateForUser(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      void hydrateForUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [
    applyProgramWithSaved,
    availableCatalogYears,
    catalogMap,
    loadMinorDetail,
    loadProgramDetail,
    offeringContext,
    offeringsMap,
    showToast,
    supabase,
  ]);

  // Close program and plans dropdowns on outside click
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
      if (
        plansMenuContainerRef.current &&
        !plansMenuContainerRef.current.contains(target)
      ) {
        setPlansMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // 5-second safety countdown for deleting a saved plan
  useEffect(() => {
    if (!planToDelete || deleteCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setDeleteCountdown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [planToDelete, deleteCountdown]);

  const filteredPrograms = useMemo(() => {
    const q = programQuery.trim().toLowerCase();
    return bootstrap.programs
      .filter(
        (p) =>
          p.catalog_year === catalogYear &&
          p.credential !== "Minor" &&
          (!q ||
            `${p.name} ${p.credential ?? ""} ${p.degree_abbrev ?? ""} ${p.faculty ?? ""}`
              .toLowerCase()
              .includes(q)),
      )
      .slice(0, 60);
  }, [bootstrap.programs, catalogYear, programQuery]);

  const minorOptions = useMemo(() => {
    const activeCatYear = program?.catalog_year ?? catalogYear;
    return bootstrap.programs
      .filter(
        (p) => p.catalog_year === activeCatYear && p.credential === "Minor",
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bootstrap.programs, program, catalogYear]);

  const selectProgram = useCallback(
    async (summary: ProgramSummary) => {
      setMenuOpen(false);
      setProgramQuery("");
      await flushPendingSave();

      if (summary.program_id !== programRef.current?.program_id) {
        setPreviousPlan(null);
        setResetConfirmOpen(false);
      }

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
    [activateProgram, flushPendingSave, showToast],
  );

  const selectSavedPlan = useCallback(
    async (plan: DegreePlanRecord) => {
      setPlansMenuOpen(false);
      setMenuOpen(false);
      await flushPendingSave();

      if (plan.program_id !== programRef.current?.program_id) {
        setPreviousPlan(null);
        setResetConfirmOpen(false);
      }

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("program", plan.program_id);
        window.history.replaceState(null, "", url.toString());
      }

      setLoadingProgram(true);
      try {
        const detail = await loadProgramDetail(plan.program_id);
        const nextCustoms = new Map(plan.customs.map((c) => [c.code, c]));
        const nextStartYear = plan.start_year ?? undefined;
        const nextPlanName = plan.degree_name?.trim() || detail.name;
        const inferredGapYears = inferGapYearsFromTerms(plan.terms);
        applyProgramWithSaved(detail, {
          terms: plan.terms,
          customs: plan.customs,
          startYear: nextStartYear,
          gapYears: inferredGapYears,
          planName: nextPlanName,
          minorProgramId: plan.minor_program_id,
        });
        persistPlan(
          detail.program_id,
          plan.terms,
          nextCustoms,
          nextStartYear,
          inferredGapYears,
          nextPlanName,
          plan.minor_program_id,
        );
        void loadMinorDetail(plan.minor_program_id);
      } catch {
        showToast("Could not load saved plan");
      } finally {
        setLoadingProgram(false);
      }
    },
    [
      applyProgramWithSaved,
      flushPendingSave,
      loadMinorDetail,
      loadProgramDetail,
      showToast,
    ],
  );

  const handleConfirmDeletePlan = useCallback(async () => {
    if (!planToDelete || !user?.email || deleteCountdown > 0 || deletingPlan) {
      return;
    }

    setDeletingPlan(true);
    try {
      if (pendingSaveRef.current?.programId === planToDelete.program_id) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingSaveRef.current = null;
      } else {
        await flushPendingSave();
      }
      await deleteDegreePlan(supabase, user.email, planToDelete.program_id);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORE_PREFIX + planToDelete.program_id);
      }

      setSavedPlans((prev) => {
        const next = prev.filter(
          (p) => p.program_id !== planToDelete.program_id,
        );
        savedPlansRef.current = next;
        return next;
      });

      if (previousPlan?.programId === planToDelete.program_id) {
        setPreviousPlan(null);
      }

      if (programRef.current?.program_id === planToDelete.program_id) {
        setProgram(null);
        setMinorProgram(null);
        setSidebarTab("major");
        setProgramQuery("");
        setTerms([]);
        setCustoms(new Map());
        setUnscheduled([]);
        setResetConfirmOpen(false);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("program");
          window.history.replaceState(null, "", url.toString());
        }
      }

      showToast(
        `Deleted plan: ${planToDelete.degree_name || planToDelete.program_id}`,
      );
      setPlanToDelete(null);
      setDeleteCountdown(0);
    } catch {
      showToast("Could not delete saved plan");
    } finally {
      setDeletingPlan(false);
    }
  }, [
    planToDelete,
    user,
    deleteCountdown,
    deletingPlan,
    flushPendingSave,
    supabase,
    previousPlan,
    showToast,
  ]);

  const model = useMemo(
    () => (program ? buildModel(program) : null),
    [program],
  );

  const minorModel = useMemo(
    () => (minorProgram ? buildModel(minorProgram) : null),
    [minorProgram],
  );

  const majorFixedSet = useMemo(() => {
    if (!model) return new Set<string>();
    const raw = new Set<string>(model.required.map((r) => r.code));
    for (const g of model.chooseGroups) {
      for (const c of g.options) raw.add(c);
    }
    return expandWithEquivalents(raw, equivMap);
  }, [model, equivMap]);

  const minorCourseSet = useMemo(() => {
    if (!minorModel) return new Set<string>();
    const raw = new Set<string>(minorModel.required.map((r) => r.code));
    for (const g of minorModel.chooseGroups) {
      for (const c of g.options) raw.add(c);
    }
    return expandWithEquivalents(raw, equivMap);
  }, [minorModel, equivMap]);

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

  const creditBreakdown = useMemo(() => {
    const earned = earnedCodes(terms, customs);
    const transferSet = transferCodes(customs);
    let planned = 0;
    let transfer = 0;
    for (const code of earned) {
      const cr = creditsOf(code, catalogMap, customs);
      if (transferSet.has(code)) transfer += cr;
      else planned += cr;
    }
    return {
      planned,
      transfer,
      total: planned + transfer,
    };
  }, [terms, catalogMap, customs]);

  const totalPlacedCredits = creditBreakdown.total;

  const commitPlan = useCallback(
    (
      nextTerms: PlannerTerm[],
      nextCustoms: Map<string, CustomCourse>,
      nextStartYear = startYear,
      nextGapYears = gapYears,
      nextPlanName = planName,
      nextMinorProgramId: string | null | undefined = minorRef.current
        ?.program_id ?? null,
    ) => {
      const normalizedTerms = nextTerms.map((t) => ({
        ...t,
        slots: normalizeTermSlots(t.slots),
      }));
      setTerms(normalizedTerms);
      setCustoms(nextCustoms);
      setStartYear(nextStartYear);
      setGapYears(nextGapYears);
      if (!program) return;

      // Only persist changes for programs explicitly added as a saved plan via +
      const isSaved = savedPlansRef.current.some(
        (p) => p.program_id === program.program_id,
      );
      if (!isSaved) return;

      const effectiveName = nextPlanName.trim() || program.name;
      persistPlan(
        program.program_id,
        normalizedTerms,
        nextCustoms,
        nextStartYear,
        nextGapYears,
        effectiveName,
        nextMinorProgramId,
      );

      if (user?.email) {
        pendingSaveRef.current = {
          userId: user.id,
          userEmail: user.email,
          degreeName: effectiveName,
          startYear: nextStartYear,
          catalogYear: program.catalog_year,
          programId: program.program_id,
          minorProgramId: nextMinorProgramId,
          terms: normalizedTerms,
          customs: [...nextCustoms.values()],
        };
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = setTimeout(() => {
          void flushPendingSave();
        }, 800);
      }
    },
    [program, flushPendingSave, user, startYear, gapYears, planName],
  );

  const handleSelectMinor = useCallback(
    async (summary: ProgramSummary) => {
      setLoadingMinor(true);
      try {
        const detail = await loadProgramDetail(summary.program_id);
        minorRef.current = detail;
        setMinorProgram(detail);
        setSidebarTab("minor");
        commitPlan(terms, customs, startYear, gapYears, planName, detail.program_id);
        showToast(`Attached minor: ${detail.name}`);
      } catch {
        showToast("Could not load minor requirements");
      } finally {
        setLoadingMinor(false);
      }
    },
    [
      loadProgramDetail,
      commitPlan,
      terms,
      customs,
      startYear,
      gapYears,
      planName,
      showToast,
    ],
  );

  const handleRemoveMinor = useCallback(() => {
    minorRef.current = null;
    setMinorProgram(null);
    commitPlan(terms, customs, startYear, gapYears, planName, null);
    showToast("Removed minor from plan");
  }, [commitPlan, terms, customs, startYear, gapYears, planName, showToast]);

  const handleRenamePlan = useCallback(
    (rawName: string) => {
      if (!program || !isCurrentProgramSaved) {
        setEditingPlanName(false);
        return;
      }
      const nextName = rawName.trim() || program.name;
      setPlanName(nextName);
      setEditingPlanName(false);
      commitPlan(terms, customs, startYear, gapYears, nextName);
      showToast(`Renamed plan to "${nextName}"`);
    },
    [
      program,
      isCurrentProgramSaved,
      commitPlan,
      terms,
      customs,
      startYear,
      gapYears,
      showToast,
    ],
  );

  const openAddPlanModal = useCallback(() => {
    setPlansMenuOpen(false);
    setMenuOpen(false);
    setCarryPreviewOnAdd(false);
    const defaultStart = program ? startYear : profileDefaultStartYear;
    const defaultCatalog = resolveCatalogYearForStartYear(
      defaultStart,
      availableCatalogYears,
    );
    setNewPlanQuery("");
    setNewPlanProgram(null);
    setNewPlanName("");
    setNewPlanStartYear(defaultStart);
    setNewPlanCatalogYear(defaultCatalog);
    setNewPlanCatalogManuallySet(false);
    setAddPlanModalOpen(true);
  }, [program, startYear, profileDefaultStartYear, availableCatalogYears]);

  const openSavePreviewAsPlanModal = useCallback(() => {
    if (!program) return;
    setPlansMenuOpen(false);
    setMenuOpen(false);
    setCarryPreviewOnAdd(true);
    const matchingSummary =
      bootstrap.programs.find((p) => p.program_id === program.program_id) ?? {
        program_id: program.program_id,
        catalog_year: program.catalog_year,
        name: program.name,
        credential: program.credential,
        degree: program.degree,
        degree_abbrev: program.degree_abbrev,
        faculty: program.faculty,
        total_credit_hours: program.total_credit_hours,
        honours: program.honours,
      };
    const nextCatalog = program.catalog_year || catalogYear;
    const matchedDefault = resolveCatalogYearForStartYear(
      startYear,
      availableCatalogYears,
    );
    setNewPlanQuery(program.name);
    setNewPlanProgram(matchingSummary);
    setNewPlanName(program.name);
    setNewPlanStartYear(startYear);
    setNewPlanCatalogYear(nextCatalog);
    setNewPlanCatalogManuallySet(nextCatalog !== matchedDefault);
    setAddPlanModalOpen(true);
  }, [program, bootstrap.programs, startYear, catalogYear, availableCatalogYears]);

  const filteredNewPlanPrograms = useMemo(() => {
    const q = newPlanQuery.trim().toLowerCase();
    const targetCatalogYear = newPlanCatalogYear;
    return bootstrap.programs
      .filter(
        (p) =>
          p.catalog_year === targetCatalogYear &&
          p.credential !== "Minor" &&
          (!q ||
            `${p.name} ${p.credential ?? ""} ${p.degree_abbrev ?? ""} ${p.faculty ?? ""}`
              .toLowerCase()
              .includes(q)),
      )
      .slice(0, 60);
  }, [bootstrap.programs, newPlanQuery, newPlanCatalogYear]);

  const handleCreateNewPlan = useCallback(async () => {
    if (!newPlanProgram || creatingPlan) return;
    setCreatingPlan(true);
    try {
      const targetCatalogYear = newPlanCatalogYear;
      const keepExactPreviewCatalog =
        carryPreviewOnAdd &&
        programRef.current?.program_id === newPlanProgram.program_id &&
        newPlanCatalogYear === catalogYear;
      const resolvedProgram = keepExactPreviewCatalog
        ? newPlanProgram
        : (findProgramInCatalogYear(
            bootstrap.programs,
            newPlanProgram,
            targetCatalogYear,
          ) ?? newPlanProgram);
      const detail = await loadProgramDetail(resolvedProgram.program_id);
      const effectiveName = newPlanName.trim() || detail.name;
      const existingSaved = savedPlans.find(
        (p) => p.program_id === detail.program_id,
      );
      const shouldUsePreview =
        carryPreviewOnAdd &&
        !existingSaved &&
        programRef.current?.program_id === detail.program_id &&
        terms.length > 0;
      const nextCustoms = existingSaved
        ? new Map(existingSaved.customs.map((c) => [c.code, c]))
        : shouldUsePreview
          ? new Map(customs)
          : new Map<string, CustomCourse>();
      const nextGapYears = shouldUsePreview ? [...gapYears] : [];
      const nextMinorId = existingSaved
        ? existingSaved.minor_program_id
        : shouldUsePreview
          ? (minorRef.current?.program_id ?? null)
          : null;

      let nextTerms: PlannerTerm[];
      if (existingSaved && existingSaved.terms.length > 0) {
        nextTerms = existingSaved.terms.map((t) => ({
          ...t,
          slots: normalizeTermSlots(t.slots),
        }));
      } else if (shouldUsePreview) {
        nextTerms = terms.map((t) => ({
          ...t,
          slots: normalizeTermSlots(t.slots),
        }));
      } else {
        const built = buildDefaultPlan(
          detail,
          catalogMap,
          offeringsMap,
          nextCustoms,
          { startYear: newPlanStartYear, gapYears: [], context: offeringContext },
        );
        nextTerms = built.terms;
        setUnscheduled(built.unscheduled);
      }

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("program", detail.program_id);
        window.history.replaceState(null, "", url.toString());
      }

      setPreviousPlan(null);
      setResetConfirmOpen(false);
      setPlanMismatches(new Map());
      setProgram(detail);
      setProgramQuery("");
      setPlanName(effectiveName);
      setEditingPlanName(false);
      setStartYear(newPlanStartYear);
      setCatalogYear(detail.catalog_year);
      setCatalogManuallySet(newPlanCatalogManuallySet);
      setGapYears(nextGapYears);
      setCustoms(nextCustoms);
      setTerms(nextTerms);
      setCarryPreviewOnAdd(false);
      if (!shouldUsePreview) {
        void loadMinorDetail(nextMinorId);
        if (!nextMinorId) setSidebarTab("major");
      }

      persistPlan(
        detail.program_id,
        nextTerms,
        nextCustoms,
        newPlanStartYear,
        nextGapYears,
        effectiveName,
        nextMinorId,
      );

      if (user?.email) {
        try {
          const savedRecord = await upsertDegreePlan(supabase, {
            userId: user.id,
            userEmail: user.email,
            degreeName: effectiveName,
            startYear: newPlanStartYear,
            catalogYear: detail.catalog_year,
            programId: detail.program_id,
            minorProgramId: nextMinorId,
            terms: nextTerms,
            customs: [...nextCustoms.values()],
          });
          setSavedPlans((prev) => {
            const next = [
              savedRecord,
              ...prev.filter((p) => p.program_id !== savedRecord.program_id),
            ];
            savedPlansRef.current = next;
            return next;
          });
        } catch {
          showToast("Could not save plan to your account");
        }
      }

      setAddPlanModalOpen(false);
      showToast(`Saved plan "${effectiveName}"`);
    } catch {
      showToast("Could not create plan");
    } finally {
      setCreatingPlan(false);
    }
  }, [
    bootstrap.programs,
    newPlanProgram,
    creatingPlan,
    loadProgramDetail,
    loadMinorDetail,
    newPlanName,
    savedPlans,
    carryPreviewOnAdd,
    terms,
    customs,
    gapYears,
    catalogMap,
    offeringsMap,
    newPlanStartYear,
    newPlanCatalogYear,
    newPlanCatalogManuallySet,
    catalogYear,
    offeringContext,
    user,
    supabase,
    showToast,
  ]);

  const placeCourse = useCallback(
    (
      termIndex: number,
      slotIndex: number,
      code: string,
      customMapOverride?: Map<string, CustomCourse>,
      options?: { keepOpen?: boolean },
    ) => {
      const nextCustoms = customMapOverride ?? customs;
      const nextTerms = terms.map((t) => ({ ...t, slots: t.slots.slice() }));
      const targetTerm = nextTerms[termIndex];
      if (!targetTerm) return;

      if (slotIndex >= MAX_SLOTS_PER_TERM) {
        showToast(`Maximum of ${MAX_SLOTS_PER_TERM} courses per term`);
        if (!options?.keepOpen) setPicker(null);
        return;
      }

      while (targetTerm.slots.length <= slotIndex) {
        targetTerm.slots.push(null);
      }

      const existingTermIdx = placedTermIndex(nextTerms, code);
      if (existingTermIdx >= 0) {
        const oldTerm = nextTerms[existingTermIdx];
        const oldSlotIdx = oldTerm.slots.indexOf(code);
        if (existingTermIdx === termIndex && oldSlotIdx === slotIndex) {
          if (!options?.keepOpen) setPicker(null);
          return;
        }
        const displaced = targetTerm.slots[slotIndex] ?? null;
        oldTerm.slots[oldSlotIdx] = displaced;
      }

      targetTerm.slots[slotIndex] = code;
      commitPlan(nextTerms, nextCustoms);
      if (!options?.keepOpen) setPicker(null);
    },
    [terms, customs, commitPlan, showToast],
  );

  const clearSlot = useCallback(
    (termIndex: number, slotIndex: number) => {
      const removedCode = terms[termIndex]?.slots[slotIndex] ?? null;
      const nextTerms = terms.map((t, i) =>
        i === termIndex
          ? {
              ...t,
              slots: t.slots.map((c, j) => (j === slotIndex ? null : c)),
            }
          : t,
      );
      if (removedCode) {
        setPlanMismatches((prev) => {
          if (!prev.has(removedCode)) return prev;
          const next = new Map(prev);
          next.delete(removedCode);
          return next;
        });
      }
      commitPlan(nextTerms, customs);
    },
    [terms, customs, commitPlan],
  );

  const requestClearSlot = useCallback(
    (
      termIndex: number,
      slotIndex: number,
      options?: { closeDetailsModal?: boolean },
    ) => {
      const code = terms[termIndex]?.slots[slotIndex] ?? null;
      if (!code) return;

      const beforeSet = earnedCodes(terms, customs);
      const afterSet = new Set<string>(transferCodes(customs));
      terms.forEach((t, i) => {
        t.slots.forEach((c, j) => {
          if (c && !(i === termIndex && j === slotIndex)) {
            afterSet.add(c);
          }
        });
      });

      const requiredFor: string[] = [];
      if (
        model?.required.some(
          (r) =>
            Boolean(findEquivalentInSet(r.code, beforeSet, equivMap)) &&
            !findEquivalentInSet(r.code, afterSet, equivMap),
        )
      ) {
        requiredFor.push(
          program?.name ? `${program.name} (major)` : "your major",
        );
      }
      if (
        minorModel?.required.some(
          (r) =>
            Boolean(findEquivalentInSet(r.code, beforeSet, equivMap)) &&
            !findEquivalentInSet(r.code, afterSet, equivMap),
        )
      ) {
        requiredFor.push(
          minorProgram?.name ? `${minorProgram.name} (minor)` : "your minor",
        );
      }

      if (requiredFor.length > 0) {
        setPendingRemoveCourse({
          termIndex,
          slotIndex,
          code,
          requiredFor,
          closeDetailsModal: options?.closeDetailsModal,
        });
        return;
      }

      clearSlot(termIndex, slotIndex);
      if (options?.closeDetailsModal) setSelectedCourse(null);
    },
    [
      terms,
      customs,
      model,
      minorModel,
      program,
      minorProgram,
      equivMap,
      clearSlot,
    ],
  );

  const handleConfirmRemoveCourse = useCallback(() => {
    if (!pendingRemoveCourse) return;
    if (
      terms[pendingRemoveCourse.termIndex]?.slots[
        pendingRemoveCourse.slotIndex
      ] === pendingRemoveCourse.code
    ) {
      clearSlot(
        pendingRemoveCourse.termIndex,
        pendingRemoveCourse.slotIndex,
      );
    }
    if (pendingRemoveCourse.closeDetailsModal) {
      setSelectedCourse(null);
    }
    setPendingRemoveCourse(null);
  }, [pendingRemoveCourse, terms, clearSlot]);

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
    setResetConfirmOpen(false);
    setPreviousPlan({
      programId: program.program_id,
      terms: terms.map((t) => ({ ...t, slots: [...t.slots] })),
      customs: [...customs.values()],
    });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORE_PREFIX + program.program_id);
    }
    const emptyCustoms = new Map<string, CustomCourse>();
    const built = buildDefaultPlan(
      program,
      catalogMap,
      offeringsMap,
      emptyCustoms,
      { startYear, gapYears, context: offeringContext },
    );
    setCustoms(emptyCustoms);
    setTerms(built.terms);
    setUnscheduled(built.unscheduled);
    setPlanMismatches(new Map());
    showToast(`Plan reset for ${startYear}–${startYear + 1}+`);
  }, [
    program,
    terms,
    customs,
    catalogMap,
    offeringsMap,
    startYear,
    gapYears,
    offeringContext,
    showToast,
  ]);

  const switchToCatalogYear = useCallback(
    async (
      nextCatalogYear: string,
      options?: { startYearOverride?: number; reason?: "start" | "manual" },
    ) => {
      const currentProg = programRef.current;
      const effectiveStartYear = options?.startYearOverride ?? startYear;

      if (!currentProg) {
        setCatalogYear(nextCatalogYear);
        if (options?.startYearOverride !== undefined) {
          setStartYear(options.startYearOverride);
          showToast(
            `Degree start year set to ${options.startYearOverride} (${nextCatalogYear} course map)`,
          );
        } else {
          showToast(`Course map set to ${nextCatalogYear}`);
        }
        return;
      }

      if (currentProg.catalog_year === nextCatalogYear) {
        setCatalogYear(nextCatalogYear);
        if (options?.startYearOverride !== undefined) {
          commitPlan(terms, customs, options.startYearOverride, gapYears);
          showToast(`Degree start year set to ${options.startYearOverride}`);
        }
        return;
      }

      const match = findProgramInCatalogYear(
        bootstrap.programs,
        currentProg,
        nextCatalogYear,
      );

      if (!match) {
        if (options?.reason === "start" && options.startYearOverride !== undefined) {
          commitPlan(terms, customs, options.startYearOverride, gapYears);
          showToast(
            `Start year set to ${options.startYearOverride} (${currentProg.name} not in ${nextCatalogYear} course map)`,
          );
        } else {
          setCatalogYear(nextCatalogYear);
          showToast(
            `${currentProg.name} is not in the ${nextCatalogYear} course map — pick a program`,
          );
        }
        return;
      }

      setCatalogYear(nextCatalogYear);
      setPreviousPlan(null);
      setResetConfirmOpen(false);

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("program", match.program_id);
        window.history.replaceState(null, "", url.toString());
      }

      setLoadingProgram(true);
      try {
        const detail = await loadProgramDetail(match.program_id);
        const isTargetAlreadySaved = savedPlansRef.current.some(
          (p) => p.program_id === detail.program_id,
        );
        const carriedTerms = terms.map((t) => ({
          ...t,
          slots: normalizeTermSlots(t.slots),
        }));
        const carriedCustoms = new Map(customs);
        const carriedGapYears = [...gapYears];

        if (carriedTerms.length === 0 || isTargetAlreadySaved) {
          await flushPendingSave();
          await activateProgram(detail, undefined, effectiveStartYear);
          showToast(
            isTargetAlreadySaved
              ? `Opened saved ${nextCatalogYear} ${detail.name} plan`
              : `Previewing ${nextCatalogYear} ${detail.name} — click + Add to Plans to save`,
          );
          return;
        }

        // Flag courses carried over that were required in the previous year's
        // program (or already mismatched) and are not part of the new plan's
        // required/choose courses.
        const prevModel = buildModel(currentProg);
        const nextModel = buildModel(detail);
        const prevFixed = new Set(prevModel.required.map((r) => r.code));
        for (const g of prevModel.chooseGroups) {
          for (const c of g.options) prevFixed.add(c);
        }
        const nextFixed = new Set(nextModel.required.map((r) => r.code));
        for (const g of nextModel.chooseGroups) {
          for (const c of g.options) nextFixed.add(c);
        }

        const nextMismatches = new Map<string, string>();
        for (const code of placedCodes(carriedTerms)) {
          if (carriedCustoms.has(code)) continue;
          if (findEquivalentInSet(code, nextFixed, equivMap)) continue;
          if (prevFixed.has(code) || planMismatches.has(code)) {
            nextMismatches.set(
              code,
              `Not required in ${detail.catalog_year} plan (from ${currentProg.catalog_year})`,
            );
          }
        }

        const nextPlanName =
          planName && planName !== currentProg.name ? planName : detail.name;

        const currentMinor = minorRef.current;
        if (currentMinor) {
          const matchedMinor = findProgramInCatalogYear(
            bootstrap.programs,
            currentMinor,
            detail.catalog_year,
          );
          if (matchedMinor) {
            void loadMinorDetail(matchedMinor.program_id);
          } else {
            minorRef.current = null;
            setMinorProgram(null);
          }
        }

        setStartYear(effectiveStartYear);
        setCatalogYear(detail.catalog_year);
        setGapYears(carriedGapYears);
        setTerms(carriedTerms);
        setCustoms(carriedCustoms);
        setUnscheduled([]);
        setPlanMismatches(nextMismatches);
        setProgram(detail);
        setProgramQuery("");
        setPlanName(nextPlanName);
        setEditingPlanName(false);

        // Never auto-create a new saved plan when switching catalog year;
        // the user stays in Preview mode until they explicitly click + Add to Plans.
        const mismatchCount = nextMismatches.size;
        showToast(
          mismatchCount > 0
            ? `Previewing ${nextCatalogYear} ${detail.name} (${mismatchCount} ${mismatchCount === 1 ? "course" : "courses"} flagged) — click + Add to Plans to save`
            : `Previewing ${nextCatalogYear} ${detail.name} — click + Add to Plans to save`,
        );
      } catch {
        showToast("Could not load program requirements for that year");
      } finally {
        setLoadingProgram(false);
      }
    },
    [
      activateProgram,
      bootstrap.programs,
      commitPlan,
      customs,
      equivMap,
      flushPendingSave,
      gapYears,
      loadMinorDetail,
      loadProgramDetail,
      planMismatches,
      planName,
      showToast,
      startYear,
      terms,
    ],
  );

  const handleChangeStartYear = useCallback(
    async (nextYear: number) => {
      const prevDefaultCatalog = resolveCatalogYearForStartYear(
        startYear,
        availableCatalogYears,
      );
      const nextDefaultCatalog = resolveCatalogYearForStartYear(
        nextYear,
        availableCatalogYears,
      );
      const wasFollowingStartYear =
        !catalogManuallySet && catalogYear === prevDefaultCatalog;

      if (wasFollowingStartYear && nextDefaultCatalog !== catalogYear) {
        await switchToCatalogYear(nextDefaultCatalog, {
          startYearOverride: nextYear,
          reason: "start",
        });
        return;
      }

      if (program) {
        commitPlan(terms, customs, nextYear, gapYears);
      } else {
        setStartYear(nextYear);
      }
      showToast(`Degree start year set to ${nextYear}`);
    },
    [
      availableCatalogYears,
      catalogManuallySet,
      catalogYear,
      commitPlan,
      customs,
      gapYears,
      program,
      showToast,
      startYear,
      switchToCatalogYear,
      terms,
    ],
  );

  const handleChangeCatalogYear = useCallback(
    async (nextCatalogYear: string) => {
      if (nextCatalogYear === catalogYear) return;
      setCatalogManuallySet(true);
      await switchToCatalogYear(nextCatalogYear, { reason: "manual" });
    },
    [catalogYear, switchToCatalogYear],
  );

  const handleInsertGapYear = useCallback(
    (academicYear: number) => {
      const nextTerms = terms.map((t) =>
        t.year >= academicYear ? { ...t, year: t.year + 1 } : t,
      );
      const nextGapYears = [
        ...gapYears.map((g) => (g >= academicYear ? g + 1 : g)),
        academicYear,
      ].sort((a, b) => a - b);
      commitPlan(nextTerms, customs, startYear, nextGapYears);
      showToast(
        `Added gap year for ${startYear + academicYear - 1}–${startYear + academicYear}`,
      );
    },
    [terms, gapYears, customs, startYear, commitPlan, showToast],
  );

  const handleRemoveGapYear = useCallback(
    (academicYear: number) => {
      const nextTerms = terms.map((t) =>
        t.year > academicYear ? { ...t, year: t.year - 1 } : t,
      );
      const nextGapYears = gapYears
        .filter((g) => g !== academicYear)
        .map((g) => (g > academicYear ? g - 1 : g));
      commitPlan(nextTerms, customs, startYear, nextGapYears);
      showToast("Removed gap year");
    },
    [terms, gapYears, customs, startYear, commitPlan, showToast],
  );

  const handleAddYear = useCallback(() => {
    const maxY = Math.max(
      0,
      ...terms.map((t) => t.year),
      ...gapYears,
    );
    const nextY = maxY + 1;
    const emptySlots = () => Array.from({ length: SLOTS_PER_TERM }, () => null);
    const nextTerms: PlannerTerm[] = [
      ...terms,
      { label: "Fall", season: "Fall", year: nextY, slots: emptySlots() },
      { label: "Winter", season: "Winter", year: nextY, slots: emptySlots() },
    ];
    commitPlan(nextTerms, customs, startYear, gapYears);
    showToast(`Added ${startYear + nextY - 1}–${startYear + nextY}`);
  }, [terms, gapYears, customs, startYear, commitPlan, showToast]);

  const handleRemoveYear = useCallback(
    (academicYear: number) => {
      const nextTerms = terms
        .filter((t) => t.year !== academicYear)
        .map((t) => (t.year > academicYear ? { ...t, year: t.year - 1 } : t));
      const nextGapYears = gapYears
        .filter((g) => g !== academicYear)
        .map((g) => (g > academicYear ? g - 1 : g));
      commitPlan(nextTerms, customs, startYear, nextGapYears);
      showToast("Removed year");
    },
    [terms, gapYears, customs, startYear, commitPlan, showToast],
  );

  const handleRestorePrevious = useCallback(() => {
    if (!program || !previousPlan || previousPlan.programId !== program.program_id) {
      setPreviousPlan(null);
      return;
    }
    const restoredCustoms = new Map<string, CustomCourse>();
    for (const c of previousPlan.customs) {
      restoredCustoms.set(c.code, c);
    }
    commitPlan(previousPlan.terms, restoredCustoms);
    setPreviousPlan(null);
    showToast("Restored your previous plan");
  }, [program, previousPlan, commitPlan, showToast]);

  const handleSaveCustom = useCallback(
    (
      draft: CustomCourse,
      target: { termIndex: number; slotIndex: number } | null,
    ) => {
      const nextCustoms = new Map(customs);
      nextCustoms.set(draft.code, draft);
      let removedFromMap = false;
      if (target) {
        placeCourse(target.termIndex, target.slotIndex, draft.code, nextCustoms);
      } else {
        let nextTerms = terms;
        if (
          draft.transfer &&
          draft.transfer_kind === "equivalent" &&
          placedTermIndex(terms, draft.code) >= 0
        ) {
          removedFromMap = true;
          nextTerms = terms.map((t) => ({
            ...t,
            slots: t.slots.map((c) => (c === draft.code ? null : c)),
          }));
        }
        commitPlan(nextTerms, nextCustoms);
      }
      setPickerTransferMode(false);
      setPicker(null);
      showToast(
        draft.transfer
          ? removedFromMap
            ? `${draft.code} added as a transfer credit (removed from term map)`
            : draft.transfer_kind === "general"
              ? `General transfer credit (${draft.credit_hours} cr) added`
              : `${draft.code} added as a transfer credit`
          : `${draft.code} added as a custom course`,
      );
    },
    [customs, placeCourse, commitPlan, terms, showToast],
  );

  const handlePlaceCourseInTerm = useCallback(
    (termIndex: number, code: string) => {
      const targetTerm = terms[termIndex];
      if (!targetTerm) return;
      const usedCount = targetTerm.slots.filter(Boolean).length;
      if (usedCount >= MAX_SLOTS_PER_TERM) {
        showToast(
          `Year ${targetTerm.year} ${targetTerm.season} is full (max ${MAX_SLOTS_PER_TERM} courses)`,
        );
        return;
      }
      const emptyIdx = targetTerm.slots.indexOf(null);
      const slotIndex = emptyIdx >= 0 ? emptyIdx : targetTerm.slots.length;
      placeCourse(termIndex, slotIndex, code);
      showToast(
        `Added ${code} to Year ${targetTerm.year} ${targetTerm.season}`,
      );
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
      if (toSlot >= MAX_SLOTS_PER_TERM) {
        showToast(`Maximum of ${MAX_SLOTS_PER_TERM} courses per term`);
        return;
      }
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
    [terms, customs, commitPlan, showToast],
  );

  const academicYears = useMemo(() => {
    const grouped = new Map<number, { term: PlannerTerm; index: number }[]>();
    terms.forEach((term, index) => {
      const list = grouped.get(term.year) ?? [];
      list.push({ term, index });
      grouped.set(term.year, list);
    });
    const maxY = Math.max(
      0,
      ...grouped.keys(),
      ...gapYears,
    );
    const gapSet = new Set(gapYears);
    const rows: {
      academicYear: number;
      studyYear: number;
      isGap: boolean;
      calStart: number;
      calEnd: number;
      yearTerms: { term: PlannerTerm; index: number }[];
    }[] = [];
    let studyCounter = 0;
    for (let y = 1; y <= maxY; y++) {
      const isGap = gapSet.has(y);
      if (!isGap) studyCounter++;
      rows.push({
        academicYear: y,
        studyYear: studyCounter,
        isGap,
        calStart: startYear + (y - 1),
        calEnd: startYear + y,
        yearTerms: grouped.get(y) ?? [],
      });
    }
    return rows;
  }, [terms, gapYears, startYear]);

  const heroPct = totalTarget
    ? Math.min(100, (totalPlacedCredits / totalTarget) * 100)
    : 0;

  return (
    <div
      style={
        { "--planner-header-h": `${headerHeight}px` } as React.CSSProperties
      }
      className="min-h-screen bg-[#F7F8FC] bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(186,230,253,0.40),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(221,214,254,0.32),transparent_60%)] text-slate-800 dark:bg-[#0B0F19] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(56,189,248,0.11),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(167,139,250,0.10),transparent_60%)] dark:text-slate-100"
    >
      {/* Sticky Top Header */}
      <header
        ref={headerRef}
        className="sticky top-[var(--site-nav-height,2.75rem)] z-40 border-b border-slate-200/80 bg-white/82 px-4 py-3 shadow-[0_1px_12px_rgba(15,23,42,0.04)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/82"
      >
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between lg:flex-nowrap">
          {/* Left Side: Home on top; Plans + (+) below; Plan name; Start year */}
          <div className="flex flex-col items-start gap-1.5 md:order-1 md:max-w-[58%] lg:max-w-none">
            <Link
              href="/"
              className="rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-900 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-200"
            >
              &larr; Home
            </Link>

            {/* Saved Plans Dropdown + Add Plan (+) */}
            <div
              ref={plansMenuContainerRef}
              className="relative flex items-center gap-1.5"
            >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPlansMenuOpen((open) => !open);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-900 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:bg-slate-800"
                >
                  <span>Plans</span>
                  <span className="rounded-full bg-sky-100/85 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
                    {savedPlans.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={openAddPlanModal}
                  title="Add another degree plan"
                  aria-label="Add another degree plan"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-sky-200/90 bg-sky-50/85 text-sm font-semibold text-sky-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:border-sky-700 dark:hover:bg-sky-900/60"
                >
                  +
                </button>

                {plansMenuOpen && (
                  <div className="absolute top-9 left-0 z-50 max-h-[60vh] w-[min(360px,calc(100vw-2rem))] overflow-auto rounded-2xl border border-slate-200/90 bg-white/98 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
                      <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                        Saved Plans ({savedPlans.length})
                      </span>
                      <button
                        type="button"
                        onClick={openAddPlanModal}
                        className="rounded-lg bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:bg-sky-900/60"
                      >
                        + New Plan
                      </button>
                    </div>

                    {savedPlans.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-500 dark:text-slate-400">
                        No saved plans yet. Click + to add a degree plan.
                      </div>
                    ) : (
                      savedPlans.map((saved) => {
                        const isActive = saved.program_id === program?.program_id;
                        const courseCount = saved.terms.reduce(
                          (sum, t) => sum + t.slots.filter(Boolean).length,
                          0,
                        );
                        return (
                          <div
                            key={saved.program_id}
                            className={`flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 transition-colors last:border-b-0 dark:border-slate-800 ${
                              isActive
                                ? "bg-sky-50/75 dark:bg-sky-950/35"
                                : "hover:bg-slate-50/90 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void selectSavedPlan(saved)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {saved.degree_name || saved.program_id}
                                </span>
                                {isActive && (
                                  <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
                                    Active
                                  </span>
                                )}
                              </div>
                              <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                                {saved.catalog_year
                                  ? `${saved.catalog_year} plan · `
                                  : ""}
                                {saved.start_year
                                  ? `Start ${saved.start_year}`
                                  : "Default start"}{" "}
                                · {courseCount} {courseCount === 1 ? "course" : "courses"}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlansMenuOpen(false);
                                setPlanToDelete(saved);
                                setDeleteCountdown(2);
                              }}
                              title="Delete saved plan"
                              aria-label={`Delete ${saved.degree_name || saved.program_id}`}
                              className="shrink-0 rounded-lg px-1.5 py-1 text-sm leading-none text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
            </div>

            {/* Active Plan Name (saved) or Preview Label (searched) */}
            {program &&
              (isCurrentProgramSaved ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                    Plan:
                  </span>
                  {editingPlanName ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenamePlan(planNameDraft);
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={planNameDraft}
                        onChange={(e) => setPlanNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditingPlanName(false);
                          }
                        }}
                        placeholder={program.name}
                        className="w-56 rounded-xl border border-sky-400 bg-white px-2.5 py-1 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-sky-400/25 focus:outline-none sm:w-72 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPlanName(false)}
                        className="rounded-xl border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPlanNameDraft(planName || program.name);
                          setEditingPlanName(true);
                        }}
                        title="Click to rename plan"
                        className="group inline-flex items-center gap-1.5 rounded-xl px-2 py-0.5 text-left transition-colors hover:bg-sky-50/80 dark:hover:bg-slate-800"
                      >
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {planName || program.name}
                        </span>
                        <span className="text-xs text-slate-400 transition-colors group-hover:text-sky-600 dark:text-slate-500 dark:group-hover:text-sky-400">
                          ✎
                        </span>
                      </button>
                      {planName && planName !== program.name && (
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          ({program.name})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100/90 px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-amber-800 uppercase dark:bg-amber-950/60 dark:text-amber-300">
                    Preview
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {program.name}
                  </span>
                  <button
                    type="button"
                    onClick={openSavePreviewAsPlanModal}
                    className="rounded-full border border-sky-200/90 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60"
                  >
                    + Add to Plans
                  </button>
                </div>
              ))}

            {/* Start Year & Catalog Year directly below Plan name */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span>Start:</span>
                <select
                  value={startYear}
                  onChange={(e) =>
                    void handleChangeStartYear(Number(e.target.value))
                  }
                  aria-label="Degree start year"
                  className="rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.02)] focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-100"
                >
                  {startYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} ({y}–{String(y + 1).slice(-2)})
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span
                  title="Which year's Ontario Tech course map is used to check your degree requirements."
                  className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2 dark:decoration-slate-600"
                >
                  Course map:
                </span>
                <select
                  value={catalogYear}
                  onChange={(e) =>
                    void handleChangeCatalogYear(e.target.value)
                  }
                  aria-label="University course map year"
                  className="rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.02)] focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-100"
                >
                  {availableCatalogYears.map((cy) => (
                    <option key={cy} value={cy}>
                      {cy}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Middle: Centered Program Search */}
          <div className="flex w-full flex-col items-start md:order-3 lg:order-2 lg:w-auto lg:flex-1 lg:items-center lg:px-4">
            <div ref={menuContainerRef} className="relative w-full max-w-[300px] md:max-w-sm lg:max-w-[300px] lg:-translate-x-8">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              >
                <circle cx="9" cy="9" r="5.75" />
                <path d="M13.5 13.5L17 17" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={programQuery}
                onFocus={() => setMenuOpen(true)}
                onChange={(e) => {
                  setProgramQuery(e.target.value);
                  setMenuOpen(true);
                }}
                placeholder="Search programs…"
                aria-label="Search programs"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200/90 bg-slate-50/75 py-1.5 pr-3 pl-8 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20 focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900"
              />
              {menuOpen && (
                <div className="absolute top-10 left-0 z-50 max-h-[60vh] w-[min(430px,calc(100vw-2rem))] overflow-auto rounded-2xl border border-slate-200/90 bg-white/98 shadow-xl shadow-slate-900/10 backdrop-blur-md lg:left-1/2 lg:-translate-x-1/2 dark:border-slate-700 dark:bg-slate-900">
                  {filteredPrograms.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-500">
                      No programs match.
                    </div>
                  ) : (
                    filteredPrograms.map((p) => (
                      <button
                        key={p.program_id}
                        type="button"
                        onClick={() => selectProgram(p)}
                        className="block w-full border-b border-slate-100 px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-sky-50/60 dark:border-slate-800 dark:hover:bg-slate-800/70"
                      >
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                          {p.name}
                        </span>
                        <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
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
          </div>

          {/* Right Side: Credits on top; Reset controls directly below */}
          <div className="flex flex-col items-start gap-1.5 md:order-2 md:items-end lg:order-3">
            {/* Credit Progress Hero */}
            <div className="flex flex-col items-start gap-1 rounded-2xl border border-slate-200/75 bg-white/85 px-3 py-1.5 shadow-[0_1px_4px_rgba(15,23,42,0.03)] md:items-end dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <strong className="text-lg leading-none font-semibold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
                  {totalPlacedCredits}
                </strong>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  / {totalTarget} cr
                </span>
                <div
                  className="h-2.5 w-28 overflow-hidden rounded-full bg-slate-200/85 ring-1 ring-inset ring-slate-300/40 sm:w-36 dark:bg-slate-900 dark:ring-slate-700/60"
                  title={`${totalPlacedCredits} completed · ${Math.max(0, totalTarget - totalPlacedCredits)} remaining`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-400 transition-all duration-300"
                    style={{ width: `${heroPct}%` }}
                  />
                </div>
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  {Math.round(heroPct)}%
                </span>
              </div>
              {program && (
                <div className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {creditBreakdown.transfer > 0
                    ? `${creditBreakdown.planned} cr planned + ${creditBreakdown.transfer} cr transfer = ${creditBreakdown.total} cr`
                    : `${creditBreakdown.planned} cr planned`}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {previousPlan && (
                <button
                  type="button"
                  onClick={handleRestorePrevious}
                  className="rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  Undo reset
                </button>
              )}

              <button
                type="button"
                disabled={!program}
                onClick={() => setResetConfirmOpen(true)}
                className="rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:text-slate-100"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Reset Confirmation Modal */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl ring-4 ring-rose-100/60 dark:border-rose-900/70 dark:bg-slate-900 dark:ring-rose-950/40">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <span className="text-lg font-bold">!</span>
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Reset plan to defaults?
              </h2>
            </div>

            <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to reset your plan back to the default
              template? (You can still click <strong>Undo reset</strong>{" "}
              afterward if you change your mind.)
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700"
              >
                Yes, reset plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gap Year Confirmation Modal */}
      {gapYearToInsert && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl ring-4 ring-amber-100/60 dark:border-amber-900/70 dark:bg-slate-900 dark:ring-amber-950/40">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                <span className="text-lg font-bold">+</span>
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Insert a gap year?
              </h2>
            </div>

            <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
              This will add a gap year for{" "}
              <strong className="text-slate-900 dark:text-slate-100">
                {gapYearToInsert.calStart}–{gapYearToInsert.calEnd}
              </strong>{" "}
              and shift courses from that year onward forward by 1 year. You can
              reverse it anytime with <strong>Remove gap year</strong>.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setGapYearToInsert(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetYear = gapYearToInsert.academicYear;
                  setGapYearToInsert(null);
                  handleInsertGapYear(targetYear);
                }}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700"
              >
                Insert gap year
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Saved Plan Confirmation Modal (with 5-second safety delay) */}
      {planToDelete && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl ring-4 ring-rose-100/60 dark:border-rose-900/70 dark:bg-slate-900 dark:ring-rose-950/40">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <span className="text-lg font-bold">!</span>
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Delete saved plan?
              </h2>
            </div>

            <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to permanently delete your saved plan for{" "}
              <strong className="text-slate-900 dark:text-slate-100">
                {planToDelete.degree_name || planToDelete.program_id}
              </strong>
              ? This cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={deletingPlan}
                onClick={() => {
                  setPlanToDelete(null);
                  setDeleteCountdown(0);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteCountdown > 0 || deletingPlan}
                onClick={() => void handleConfirmDeletePlan()}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  deleteCountdown > 0
                    ? "cursor-not-allowed border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                }`}
              >
                {deleteCountdown > 0
                  ? `Confirm delete (${deleteCountdown}s)`
                  : deletingPlan
                    ? "Deleting..."
                    : "Yes, delete plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Plan Modal */}
      {addPlanModalOpen && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          onClick={() => !creatingPlan && setAddPlanModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Add degree plan
              </h2>
              <button
                type="button"
                disabled={creatingPlan}
                onClick={() => setAddPlanModalOpen(false)}
                className="rounded-xl px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  1. Choose program
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newPlanQuery}
                  onChange={(e) => {
                    setNewPlanQuery(e.target.value);
                    if (newPlanProgram && e.target.value !== newPlanProgram.name) {
                      setNewPlanProgram(null);
                    }
                  }}
                  placeholder="Search programs (e.g. Computer Science)…"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="mt-1.5 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/50">
                  {filteredNewPlanPrograms.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No programs match.
                    </div>
                  ) : (
                    filteredNewPlanPrograms.map((p) => {
                      const isSelected = newPlanProgram?.program_id === p.program_id;
                      const alreadySaved = savedPlans.some(
                        (s) => s.program_id === p.program_id,
                      );
                      return (
                        <button
                          key={p.program_id}
                          type="button"
                          onClick={() => {
                            setNewPlanProgram(p);
                            setNewPlanQuery(p.name);
                            setNewPlanName((prev) =>
                              !prev.trim() ||
                              (newPlanProgram && prev === newPlanProgram.name)
                                ? p.name
                                : prev,
                            );
                          }}
                          className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs transition-colors last:border-b-0 dark:border-slate-800 ${
                            isSelected
                              ? "bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100"
                              : "hover:bg-white dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block truncate font-medium">
                              {p.name}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {[p.credential, p.degree_abbrev]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                          {alreadySaved && (
                            <span className="shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                              Saved
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  2. Plan name
                </label>
                <input
                  type="text"
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  placeholder={
                    newPlanProgram?.name || "e.g. My Computer Science Plan"
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    3. Start year
                  </label>
                  <select
                    value={newPlanStartYear}
                    onChange={(e) => {
                      const nextStart = Number(e.target.value);
                      setNewPlanStartYear(nextStart);
                      if (!newPlanCatalogManuallySet) {
                        const nextMapYear = resolveCatalogYearForStartYear(
                          nextStart,
                          availableCatalogYears,
                        );
                        setNewPlanCatalogYear(nextMapYear);
                        if (
                          newPlanProgram &&
                          newPlanProgram.catalog_year !== nextMapYear
                        ) {
                          const matched = findProgramInCatalogYear(
                            bootstrap.programs,
                            newPlanProgram,
                            nextMapYear,
                          );
                          if (matched) setNewPlanProgram(matched);
                        }
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {startYearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y} ({y}–{String(y + 1).slice(-2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                    <span>4. Course map year</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        newPlanCatalogManuallySet
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                      }`}
                    >
                      {newPlanCatalogManuallySet ? "Custom" : "Auto"}
                    </span>
                  </label>
                  <select
                    value={newPlanCatalogYear}
                    onChange={(e) => {
                      const nextMapYear = e.target.value;
                      setNewPlanCatalogYear(nextMapYear);
                      setNewPlanCatalogManuallySet(true);
                      if (
                        newPlanProgram &&
                        newPlanProgram.catalog_year !== nextMapYear
                      ) {
                        const matched = findProgramInCatalogYear(
                          bootstrap.programs,
                          newPlanProgram,
                          nextMapYear,
                        );
                        if (matched) setNewPlanProgram(matched);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {availableCatalogYears.map((cy) => (
                      <option key={cy} value={cy}>
                        {cy}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
                <span>
                  {newPlanCatalogManuallySet ? (
                    <>
                      Using the <strong>{newPlanCatalogYear}</strong> Ontario Tech
                      course map. Changing your start year won&apos;t overwrite this
                      choice.
                    </>
                  ) : (
                    "Course map year sets which year's Ontario Tech degree requirements your plan follows (auto-matched to your start year)."
                  )}
                </span>
                {newPlanCatalogManuallySet &&
                  newPlanCatalogYear !==
                    resolveCatalogYearForStartYear(
                      newPlanStartYear,
                      availableCatalogYears,
                    ) && (
                    <button
                      type="button"
                      onClick={() => {
                        const matchedMapYear = resolveCatalogYearForStartYear(
                          newPlanStartYear,
                          availableCatalogYears,
                        );
                        setNewPlanCatalogManuallySet(false);
                        setNewPlanCatalogYear(matchedMapYear);
                        if (
                          newPlanProgram &&
                          newPlanProgram.catalog_year !== matchedMapYear
                        ) {
                          const matched = findProgramInCatalogYear(
                            bootstrap.programs,
                            newPlanProgram,
                            matchedMapYear,
                          );
                          if (matched) setNewPlanProgram(matched);
                        }
                      }}
                      className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      Match start year
                    </button>
                  )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={creatingPlan}
                onClick={() => setAddPlanModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newPlanProgram || creatingPlan}
                onClick={() => void handleCreateNewPlan()}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingPlan ? "Creating…" : "Create plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <main className="mx-auto max-w-[1440px] p-4">
        {program && model && sidebarOpen && (
          <div className="mb-3 grid grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_300px] md:gap-4 lg:grid-cols-[minmax(0,1fr)_350px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_395px]">
            {!loadingProgram && academicYears.length > 0 ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-2xl border border-slate-200/75 bg-white/75 px-3.5 py-2 text-[11.5px] text-slate-500 shadow-[0_1px_6px_rgba(15,23,42,0.03)] backdrop-blur-xs dark:border-slate-800/80 dark:bg-slate-900/55 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-full bg-sky-400" />
                  <span>Major core</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-full bg-emerald-400" />
                  <span>Elective</span>
                </span>
                {minorProgram && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-1 rounded-full bg-violet-400" />
                    <span>Minor</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-full bg-indigo-400" />
                  <span>Custom course</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-full bg-amber-400" />
                  <span>Needs check</span>
                </span>
                <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline dark:text-slate-500">
                  Drag to move · Click any course for details
                </span>
              </div>
            ) : (
              <div className="flex-1" />
            )}

            <div className="flex justify-end">
              <button
                type="button"
                aria-expanded={sidebarOpen}
                aria-label="Hide requirements panel"
                title="Hide requirements panel"
                onClick={() => setSidebarOpen((open) => !open)}
                className="inline-flex min-w-[156px] shrink-0 items-center justify-center rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-colors hover:border-sky-300 hover:bg-sky-50/60 hover:text-sky-800 dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
              >
                Hide requirements ▶
              </button>
            </div>
          </div>
        )}

        <div
          className={
            program && model && sidebarOpen
              ? "grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_300px] md:gap-4 lg:grid-cols-[minmax(0,1fr)_350px] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_395px]"
              : program && model && !sidebarOpen
                ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
                : ""
          }
        >
        {/* Planner Grid */}
        <section className="min-w-0">
          {program && model && !sidebarOpen && !loadingProgram && academicYears.length > 0 && (
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-2xl border border-slate-200/75 bg-white/75 px-3.5 py-2 text-[11.5px] text-slate-500 shadow-[0_1px_6px_rgba(15,23,42,0.03)] backdrop-blur-xs dark:border-slate-800/80 dark:bg-slate-900/55 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-1 rounded-full bg-sky-400" />
                <span>Major core</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-1 rounded-full bg-emerald-400" />
                <span>Elective</span>
              </span>
              {minorProgram && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-full bg-violet-400" />
                  <span>Minor</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-1 rounded-full bg-indigo-400" />
                <span>Custom course</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-1 rounded-full bg-amber-400" />
                <span>Needs check</span>
              </span>
              <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline dark:text-slate-500">
                Drag to move · Click any course for details
              </span>
            </div>
          )}
          {loadingProgram ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-10 text-center text-sm text-slate-500 shadow-xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              Loading program requirements…
            </div>
          ) : !program ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-10 text-center text-sm text-slate-500 shadow-xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              Pick a program above to start building a term-by-term plan.
            </div>
          ) : academicYears.length === 0 ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-10 text-center text-sm text-slate-500 shadow-xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              No terms.
            </div>
          ) : (
            <div className="space-y-5">

              {academicYears.map(
                ({
                  academicYear,
                  studyYear,
                  isGap,
                  calStart,
                  calEnd,
                  yearTerms,
                }) => {
                  if (isGap) {
                    return (
                      <div
                        key={`gap-${academicYear}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-amber-300/90 bg-amber-50/70 px-4 py-3.5 shadow-[0_1px_6px_rgba(245,158,11,0.06)] dark:border-amber-800/70 dark:bg-amber-950/25"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                            Gap Year
                          </span>
                          <span className="text-sm font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                            {calStart}–{calEnd}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            No courses scheduled · subsequent years shifted +1
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveGapYear(academicYear)}
                          className="rounded-xl border border-amber-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
                        >
                          Remove gap year
                        </button>
                      </div>
                    );
                  }

                  const yearCreds = yearTerms.reduce(
                    (sum, { term }) => sum + termCredits(term, catalogMap, customs),
                    0,
                  );
                  const isEmptyYear = yearTerms.every((t) =>
                    t.term.slots.every((s) => !s),
                  );
                  return (
                    <div
                      key={`year-${academicYear}`}
                      className="rounded-2xl border border-slate-200/75 bg-white/65 p-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.03)] backdrop-blur-xs dark:border-slate-800/80 dark:bg-slate-900/45"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2 px-0.5">
                        <h3 className="rounded-full bg-sky-100/85 px-2.5 py-0.5 text-[13px] font-semibold tracking-tight text-sky-900 dark:bg-sky-950/75 dark:text-sky-200">
                          Year {studyYear}
                        </h3>
                        <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">
                          {calStart}–{calEnd}
                        </span>
                        <span className="text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
                          {yearCreds} credits
                        </span>
                        <div className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setGapYearToInsert({
                                academicYear,
                                calStart,
                                calEnd,
                              })
                            }
                            className="rounded-xl border border-amber-200/80 bg-amber-50/55 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-100/70 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/60"
                            title={`Insert a gap year at ${calStart}–${calEnd}`}
                          >
                            + Gap year
                          </button>
                          <button
                            type="button"
                            onClick={() => addSummer(academicYear)}
                            className="rounded-xl border border-violet-200/80 bg-violet-50/55 px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100/70 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/60"
                          >
                            + Summer term
                          </button>
                          {academicYears.length > 1 && isEmptyYear && (
                            <button
                              type="button"
                              onClick={() => handleRemoveYear(academicYear)}
                              className="rounded-xl border border-slate-200 bg-white/90 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900"
                              title="Remove empty year"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        {yearTerms.map(({ term, index: termIndex }) => {
                          const creds = termCredits(term, catalogMap, customs);
                          const over = creds > CREDIT_CAP;
                          const calYear = termCalendarYear(
                            startYear,
                            term.year,
                            term.season,
                          );
                          const canAddCourse = term.slots.length < MAX_SLOTS_PER_TERM;
                          const firstEmpty = term.slots.indexOf(null);
                          const targetSlot =
                            firstEmpty >= 0 ? firstEmpty : term.slots.length;
                          const appendKey = `${termIndex}:${targetSlot}`;
                          const isAppendDragOver = dragTargetKey === appendKey;

                          const isFall = term.season === "Fall";
                          const isSummerTerm =
                            Boolean(term.summer) || term.season === "Summer";
                          const seasonCardClass = isSummerTerm
                            ? "border-violet-200/80 dark:border-violet-900/50"
                            : isFall
                              ? "border-orange-200/75 dark:border-orange-900/45"
                              : "border-sky-200/80 dark:border-sky-900/50";
                          const seasonHeaderClass = isSummerTerm
                            ? "border-b border-violet-100/90 bg-gradient-to-r from-violet-50/95 via-purple-50/75 to-fuchsia-50/50 dark:border-violet-900/40 dark:from-violet-950/50 dark:via-purple-950/30 dark:to-slate-900/40"
                            : isFall
                              ? "border-b border-orange-100/90 bg-gradient-to-r from-orange-50/95 via-amber-50/75 to-rose-50/45 dark:border-orange-900/40 dark:from-orange-950/50 dark:via-amber-950/30 dark:to-slate-900/40"
                              : "border-b border-sky-100/90 bg-gradient-to-r from-sky-50/95 via-blue-50/70 to-indigo-50/45 dark:border-sky-900/40 dark:from-sky-950/50 dark:via-blue-950/30 dark:to-slate-900/40";
                          const seasonDotClass = isSummerTerm
                            ? "bg-violet-400"
                            : isFall
                              ? "bg-orange-400"
                              : "bg-sky-400";
                          const seasonTitleClass = isSummerTerm
                            ? "text-violet-950 dark:text-violet-100"
                            : isFall
                              ? "text-orange-950 dark:text-orange-100"
                              : "text-sky-950 dark:text-sky-100";
                          const seasonCreditClass = over
                            ? "bg-amber-100/90 font-semibold text-amber-800 ring-1 ring-amber-300/80 dark:bg-amber-950/70 dark:text-amber-300 dark:ring-amber-800"
                            : isSummerTerm
                              ? "bg-white/80 text-violet-800/90 ring-1 ring-violet-200/75 dark:bg-slate-900/75 dark:text-violet-300 dark:ring-violet-900/60"
                              : isFall
                                ? "bg-white/80 text-orange-800/90 ring-1 ring-orange-200/75 dark:bg-slate-900/75 dark:text-orange-300 dark:ring-orange-900/60"
                                : "bg-white/80 text-sky-800/90 ring-1 ring-sky-200/75 dark:bg-slate-900/75 dark:text-sky-300 dark:ring-sky-900/60";

                          return (
                            <div
                              key={`${academicYear}-${term.season}-${termIndex}`}
                              className={`min-w-[235px] flex-1 basis-[235px] rounded-2xl border bg-white/95 shadow-[0_1px_6px_rgba(15,23,42,0.04)] dark:bg-slate-900/85 ${seasonCardClass}`}
                            >
                              <div
                                className={`flex items-center gap-2 rounded-t-[15px] px-3 py-2 ${seasonHeaderClass}`}
                              >
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${seasonDotClass}`}
                                />
                                <span
                                  className={`text-[13px] font-semibold tracking-tight ${seasonTitleClass}`}
                                >
                                  {term.season} {calYear}
                                </span>
                                {term.summer && (
                                  <span className="rounded-full bg-violet-100/90 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-violet-700 uppercase dark:bg-violet-950/70 dark:text-violet-300">
                                    summer
                                  </span>
                                )}
                                {over ? (
                                  <button
                                    type="button"
                                    onMouseEnter={(e) =>
                                      openOverloadTooltip(
                                        e.currentTarget,
                                        termIndex,
                                        creds,
                                      )
                                    }
                                    onPointerEnter={(e) =>
                                      openOverloadTooltip(
                                        e.currentTarget,
                                        termIndex,
                                        creds,
                                      )
                                    }
                                    onMouseLeave={() =>
                                      closeOverloadTooltip(termIndex)
                                    }
                                    onFocus={(e) =>
                                      openOverloadTooltip(
                                        e.currentTarget,
                                        termIndex,
                                        creds,
                                      )
                                    }
                                    onBlur={() =>
                                      closeOverloadTooltip(termIndex)
                                    }
                                    onClick={(e) => {
                                      if (
                                        overloadTooltip?.termIndex === termIndex
                                      ) {
                                        closeOverloadTooltip(termIndex);
                                      } else {
                                        openOverloadTooltip(
                                          e.currentTarget,
                                          termIndex,
                                          creds,
                                        );
                                      }
                                    }}
                                    title={`Above standard ${CREDIT_CAP}-credit load (allowed if required by your program or approved for overload).`}
                                    className={`ml-auto cursor-help rounded-full px-2 py-0.5 text-[11px] tabular-nums focus:outline-none ${seasonCreditClass}`}
                                  >
                                    {creds} cr ⚠
                                  </button>
                                ) : (
                                  <span
                                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] tabular-nums ${seasonCreditClass}`}
                                  >
                                    {creds} cr
                                  </span>
                                )}
                                {term.summer && (
                                  <button
                                    type="button"
                                    onClick={() => removeTerm(termIndex)}
                                    title="Remove term"
                                    className="rounded-md px-1 text-sm leading-none text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>

                              <div className="space-y-1.5 p-2.5">
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
                                        className={`flex min-h-[38px] w-full items-center justify-center rounded-xl border border-dashed px-2 text-[12px] font-medium whitespace-nowrap transition-colors ${
                                          isDragOver
                                            ? "border-sky-400 bg-sky-50 text-sky-600 dark:bg-sky-950/40"
                                            : "border-slate-200/90 bg-slate-50/40 text-slate-400 hover:border-sky-400 hover:bg-sky-50/50 hover:text-sky-600 dark:border-slate-700/80 dark:bg-slate-900/40 dark:text-slate-500 dark:hover:border-sky-500 dark:hover:bg-sky-950/25 dark:hover:text-sky-300"
                                        }`}
                                      >
                                        + Add course
                                      </button>
                                    );
                                  }

                                  const course = courseOf(
                                    code,
                                    catalogMap,
                                    customs,
                                  );
                                  const title = displayCourseTitle(course);
                                  const isCustom = customs.has(code);
                                  const isTransfer = Boolean(
                                    isCustom && customs.get(code)?.transfer,
                                  );
                                  const isMinorCourse = minorCourseSet.has(code);
                                  const isMajorCore = majorFixedSet.has(code);
                                  const baseFlag = prereqFlag(
                                    code,
                                    termIndex,
                                    terms,
                                    catalogMap,
                                    offeringsMap,
                                    customs,
                                    { startYear, context: offeringContext, equivMap },
                                  );
                                  const mismatchReason = planMismatches.get(code);
                                  const flag = mismatchReason
                                    ? {
                                        cls: "bad" as const,
                                        icon: "⚠",
                                        title: baseFlag
                                          ? `${mismatchReason} · ${baseFlag.title}`
                                          : mismatchReason,
                                      }
                                    : baseFlag;
                                  const hasBadFlag = Boolean(
                                    !mismatchReason && flag && flag.cls === "bad",
                                  );

                                  const chipClass = isDragOver
                                    ? "border-sky-400 border-l-sky-500 bg-sky-50 ring-2 ring-sky-400/35 dark:bg-sky-950/50"
                                    : mismatchReason
                                      ? "border-rose-200/90 border-l-rose-400 bg-rose-50/75 hover:border-rose-300 dark:border-rose-800/75 dark:border-l-rose-500 dark:bg-rose-950/30"
                                      : hasBadFlag
                                        ? "border-amber-200/90 border-l-amber-400 bg-amber-50/55 hover:border-amber-300 dark:border-amber-800/65 dark:border-l-amber-400 dark:bg-amber-950/25"
                                        : isCustom
                                          ? "border-dashed border-indigo-300/90 border-l-indigo-400 bg-indigo-50/45 hover:border-indigo-400 dark:border-indigo-800/80 dark:border-l-indigo-400 dark:bg-indigo-950/25"
                                          : isMinorCourse
                                            ? "border-violet-200/85 border-l-violet-400 bg-violet-50/45 hover:border-violet-300 hover:bg-violet-50/80 dark:border-violet-900/55 dark:border-l-violet-400 dark:bg-violet-950/20 dark:hover:bg-violet-950/35"
                                            : isMajorCore
                                              ? "border-slate-200/85 border-l-sky-400 bg-white hover:border-sky-300/90 hover:bg-sky-50/30 dark:border-slate-800 dark:border-l-sky-400 dark:bg-slate-900/85 dark:hover:border-sky-700/75"
                                              : "border-emerald-200/75 border-l-emerald-400 bg-emerald-50/35 hover:border-emerald-300 hover:bg-emerald-50/65 dark:border-emerald-900/50 dark:border-l-emerald-400 dark:bg-emerald-950/15 dark:hover:border-emerald-800/80";

                                  const codeTextClass = mismatchReason
                                    ? "text-rose-700 dark:text-rose-300"
                                    : isCustom
                                      ? "text-indigo-700 dark:text-indigo-300"
                                      : isMinorCourse
                                        ? "text-violet-700 dark:text-violet-300"
                                        : isMajorCore
                                          ? "text-sky-800 dark:text-sky-300"
                                          : "text-emerald-800 dark:text-emerald-300";

                                  return (
                                    <div
                                      key={slotKey}
                                      draggable
                                      onClick={() =>
                                        setSelectedCourse({
                                          code,
                                          termIndex,
                                          slotIndex,
                                        })
                                      }
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
                                      }${flag ? ` · ${flag.title}` : ""}`}
                                      className={`group relative flex min-h-[38px] cursor-grab items-center gap-2 rounded-xl border border-l-[3px] px-2.5 py-1.5 text-[12.5px] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all active:cursor-grabbing ${chipClass}`}
                                    >
                                      {flag && (
                                        <div
                                          role="tooltip"
                                          className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-medium shadow-lg group-hover:block ${
                                            mismatchReason
                                              ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700/80 dark:bg-slate-900 dark:text-rose-300"
                                              : flag.cls === "bad"
                                                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/80 dark:bg-slate-900 dark:text-amber-300"
                                                : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-700/80 dark:bg-slate-900 dark:text-sky-300"
                                          }`}
                                        >
                                          {flag.icon === "i"
                                            ? "Notice:"
                                            : flag.icon}{" "}
                                          {flag.title}
                                        </div>
                                      )}
                                      <span
                                        className={`shrink-0 font-mono text-[11.5px] font-semibold ${codeTextClass}`}
                                      >
                                        {code}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                                        {title}
                                      </span>
                                      {isMinorCourse && (
                                        <span
                                          className="shrink-0 rounded-full bg-violet-100/90 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-700 dark:bg-violet-950/70 dark:text-violet-300"
                                          title={`Counts toward ${minorProgram?.name ?? "minor"}`}
                                        >
                                          Minor
                                        </span>
                                      )}
                                      {isTransfer ? (
                                        <span
                                          className="text-[11px] text-indigo-600 dark:text-indigo-400"
                                          title="Transfer credit"
                                        >
                                          ⤳
                                        </span>
                                      ) : isCustom ? (
                                        <span
                                          className="text-[11px] text-indigo-600 dark:text-indigo-400"
                                          title="Custom course — not taken from the course timetable"
                                        >
                                          ✎
                                        </span>
                                      ) : null}
                                      {flag && (
                                        <span
                                          className={`text-[11px] ${
                                            mismatchReason
                                              ? "text-rose-600 dark:text-rose-400"
                                              : flag.cls === "bad"
                                                ? "text-amber-600 dark:text-amber-400"
                                                : "inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-950/90 dark:text-sky-300"
                                          }`}
                                          title={
                                            flag.icon === "i"
                                              ? `Notice: ${flag.title}`
                                              : flag.title
                                          }
                                        >
                                          {flag.icon}
                                        </span>
                                      )}
                                      <span className="text-[11px] text-slate-400 tabular-nums">
                                        {creditsOf(code, catalogMap, customs)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          requestClearSlot(termIndex, slotIndex);
                                        }}
                                        title="Remove"
                                        className="rounded px-0.5 text-sm leading-none text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  );
                                })}

                                {/* Extra slot button (hidden once 8 slots exist; fills empty slots first) */}
                                {canAddCourse && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPickerTransferMode(false);
                                      setPicker({
                                        termIndex,
                                        slotIndex: targetSlot,
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
                                        targetSlot,
                                      );
                                    }}
                                    className={`flex min-h-[36px] w-full items-center justify-center rounded-xl border border-dashed px-2 text-[12px] font-medium whitespace-nowrap transition-colors ${
                                      isAppendDragOver
                                        ? "border-sky-400 bg-sky-50 text-sky-600 dark:bg-sky-950/40"
                                        : "border-slate-200/90 bg-slate-50/40 text-slate-400 hover:border-sky-400 hover:bg-sky-50/50 hover:text-sky-600 dark:border-slate-700/80 dark:bg-slate-900/40 dark:text-slate-500 dark:hover:border-sky-500 dark:hover:bg-sky-950/25 dark:hover:text-sky-300"
                                    }`}
                                  >
                                    + Add course
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                },
              )}

              <button
                type="button"
                onClick={handleAddYear}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300/90 bg-white/70 py-3 text-xs font-semibold text-slate-600 shadow-[0_1px_4px_rgba(15,23,42,0.02)] transition-colors hover:border-sky-400 hover:bg-sky-50/55 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:border-sky-600 dark:hover:bg-sky-950/30 dark:hover:text-sky-300"
              >
                + Add Year ({startYear + academicYears.length}–{startYear + academicYears.length + 1})
              </button>
            </div>
          )}
        </section>

        {/* Right Column ("What you need") — toggled from the button above */}
        {program && model ? (
          sidebarOpen ? (
            <div className="relative md:sticky md:top-[calc(var(--site-nav-height,2.75rem)+var(--planner-header-h,152px)+12px)]">
              <RequirementsSidebar
                program={program}
                model={model}
                terms={terms}
                catalogMap={catalogMap}
                offeringsMap={offeringsMap}
                offeringContext={offeringContext}
                startYear={startYear}
                customs={customs}
                unscheduled={unscheduled}
                planMismatches={planMismatches}
                equivMap={equivMap}
                plannedCredits={creditBreakdown.planned}
                transferCredits={creditBreakdown.transfer}
                totalTargetCredits={totalTarget}
                onPickBucket={(bucketKey) => {
                  const emptyTerm = terms.findIndex((t) =>
                    t.slots.includes(null),
                  );
                  const termIndex = emptyTerm >= 0 ? emptyTerm : 0;
                  const slotIndex =
                    emptyTerm >= 0
                      ? terms[termIndex].slots.indexOf(null)
                      : (terms[0]?.slots.length ?? 0);
                  setPickerTransferMode(false);
                  setPicker({
                    termIndex,
                    slotIndex,
                    bucketKey,
                    modelSource: "major",
                  });
                }}
                onOpenTransferPicker={() => {
                  const free = firstFreeSlot(terms);
                  setPickerTransferMode(true);
                  setPicker({
                    termIndex: free.termIndex,
                    slotIndex: free.slotIndex,
                    bucketKey: null,
                    modelSource: "major",
                  });
                }}
                onRemoveTransfer={handleRemoveTransfer}
                activeTab={sidebarTab}
                onTabChange={setSidebarTab}
                minorProgram={minorProgram}
                minorModel={minorModel}
                minorOptions={minorOptions}
                loadingMinor={loadingMinor}
                onSelectMinor={(summary) => void handleSelectMinor(summary)}
                onRemoveMinor={handleRemoveMinor}
                onPickMinorBucket={(bucketKey) => {
                  const free = firstFreeSlot(terms);
                  setPickerTransferMode(false);
                  setPicker({
                    termIndex: free.termIndex,
                    slotIndex: free.slotIndex,
                    bucketKey,
                    modelSource: "minor",
                  });
                }}
                onPlaceCourseInTerm={handlePlaceCourseInTerm}
                onOpenMinorSearch={(initialQuery) => {
                  const free = firstFreeSlot(terms);
                  setPickerTransferMode(false);
                  setPicker({
                    termIndex: free.termIndex,
                    slotIndex: free.slotIndex,
                    bucketKey: null,
                    modelSource: "minor",
                    initialQuery,
                  });
                }}
              />
            </div>
          ) : (
            <div className="flex justify-end md:sticky md:top-[calc(var(--site-nav-height,2.75rem)+var(--planner-header-h,152px)+12px)]">
              <button
                type="button"
                aria-expanded={false}
                aria-label="Show requirements panel"
                title="Show requirements panel"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex min-h-[156px] shrink-0 items-center justify-center rounded-xl border border-slate-200/90 bg-white/95 px-1.5 py-3 text-xs font-medium text-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-colors [writing-mode:vertical-rl] hover:border-sky-300 hover:bg-sky-50/60 hover:text-sky-800 dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
              >
                ◀ Show requirements
              </button>
            </div>
          )
        ) : (
          <aside className="rounded-2xl border border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/80">
            <div className="border-b border-slate-200/75 px-4 py-3 dark:border-slate-800">
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                What you need
              </h2>
              <div className="mt-0.5 text-xs text-slate-500">—</div>
            </div>
          </aside>
        )}
        </div>
      </main>

      {/* Course Picker Modal */}
      {picker && (
        <CoursePickerModal
          key={`${picker.termIndex}:${picker.slotIndex}:${picker.bucketKey ?? ""}:${picker.modelSource ?? "major"}:${picker.initialQuery ?? ""}:${pickerTransferMode}`}
          picker={picker}
          initialTransferMode={pickerTransferMode}
          program={picker.modelSource === "minor" ? minorProgram : program}
          terms={terms}
          model={picker.modelSource === "minor" ? minorModel : model}
          catalogCourses={bootstrap.courses}
          catalogMap={catalogMap}
          offeringsMap={offeringsMap}
          offeringContext={offeringContext}
          equivMap={equivMap}
          startYear={startYear}
          customs={customs}
          subjects={subjects}
          degreeSubjects={bootstrap.subjects}
          subjectFaculty={subjectFaculty}
          onClose={() => {
            setPicker(null);
            setPickerTransferMode(false);
          }}
          onPlaceCourse={(ti, si, code) =>
            placeCourse(ti, si, code, undefined, { keepOpen: true })
          }
          onClearSlot={(ti, si) => requestClearSlot(ti, si)}
          onSaveCustom={handleSaveCustom}
          onToast={showToast}
        />
      )}

      {/* Course Details Modal */}
      {selectedCourse && (
        <CourseDetailsModal
          selectedCourse={selectedCourse}
          terms={terms}
          startYear={startYear}
          catalogMap={catalogMap}
          offeringsMap={offeringsMap}
          offeringContext={offeringContext}
          equivMap={equivMap}
          customs={customs}
          model={model}
          minorProgram={minorProgram}
          minorModel={minorModel}
          onClose={() => setSelectedCourse(null)}
          onRemove={() => {
            requestClearSlot(
              selectedCourse.termIndex,
              selectedCourse.slotIndex,
              { closeDetailsModal: true },
            );
          }}
        />
      )}

      {/* Required Course Removal Confirmation Modal */}
      {pendingRemoveCourse &&
        (() => {
          const course = courseOf(
            pendingRemoveCourse.code,
            catalogMap,
            customs,
          );
          const term = terms[pendingRemoveCourse.termIndex];
          const termLabel = term
            ? `Year ${term.year} ${term.season} ${termCalendarYear(startYear, term.year, term.season)}`
            : null;
          return (
            <div
              className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
              onClick={() => setPendingRemoveCourse(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl ring-4 ring-rose-100/60 dark:border-rose-900/70 dark:bg-slate-900 dark:ring-rose-950/40"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                    <span className="text-lg font-bold">!</span>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Remove required course?
                  </h2>
                </div>

                <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/75 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {pendingRemoveCourse.code}
                    {course?.title ? ` — ${course.title}` : ""}
                  </div>
                  {termLabel && (
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Currently scheduled in {termLabel}
                    </div>
                  )}
                </div>

                <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
                  <strong>{pendingRemoveCourse.code}</strong> is a required
                  course for{" "}
                  <strong>{pendingRemoveCourse.requiredFor.join(" and ")}</strong>
                  . Are you sure you want to remove it from your plan? You can
                  always add it back later from the{" "}
                  <strong>What you need</strong> sidebar.
                </p>

                <div className="flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPendingRemoveCourse(null)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmRemoveCourse}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700"
                  >
                    Yes, remove course
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Fixed Overload Tooltip (rendered at root so nothing can clip it) */}
      {overloadTooltip && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            top: overloadTooltip.top,
            right: overloadTooltip.right,
            zIndex: 9999,
          }}
          className="pointer-events-none w-64 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[11.5px] leading-snug font-medium text-amber-950 shadow-xl dark:border-amber-700/80 dark:bg-slate-900 dark:text-amber-200"
        >
          ⚠ {overloadTooltip.creds} credits — above standard {CREDIT_CAP}-credit
          load (allowed if required by your program or approved for overload).
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-[1400] -translate-x-1/2 rounded-full border border-slate-700/60 bg-slate-900/95 px-4 py-2 text-xs font-medium text-white shadow-xl backdrop-blur-md dark:border-slate-200/80 dark:bg-white/95 dark:text-slate-900">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function displayCourseTitle(
  course: Pick<CatalogCourse | CustomCourse, "code" | "title"> | null | undefined,
  fallback = "Unknown course",
): string {
  if (!course) return fallback;
  const trimmed = course.title.trim();
  if (!trimmed || trimmed.toLowerCase() === course.code.trim().toLowerCase()) {
    return "Catalog title unavailable (offering only)";
  }
  return trimmed;
}

type CountsTowardTier =
  | "major-core"
  | "minor-core"
  | "major-elective"
  | "breadth"
  | "minor-elective";

type CountsTowardEntry = {
  label: string;
  tier: CountsTowardTier;
  active: boolean;
};

function isGenericAnyMatch(match: ElectiveMatch | null | undefined): boolean {
  if (!match) return true;
  return (
    !(match.subjects?.length) &&
    !(match.exclude_subjects?.length) &&
    !(match.faculties?.length) &&
    !(match.exclude_faculties?.length) &&
    !match.min_level &&
    !match.max_level
  );
}

function computeCountsTowardEntries({
  code,
  course,
  model,
  minorModel,
  minorProgram,
  equivMap,
  terms,
  catalogMap,
  customs,
}: {
  code: string;
  course: CatalogCourse | CustomCourse;
  model: RequirementModel | null;
  minorModel: RequirementModel | null;
  minorProgram: DegreeProgramDetail | null;
  equivMap: Map<string, Set<string>>;
  terms: PlannerTerm[];
  catalogMap: Map<string, CatalogCourse>;
  customs: Map<string, CustomCourse>;
}): CountsTowardEntry[] {
  const entries: CountsTowardEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: CountsTowardEntry) => {
    const key = entry.label.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  const codeWithEquivs = expandWithEquivalents(new Set([code]), equivMap);
  const placed = earnedCodes(terms, customs);

  const majorEval = model
    ? evaluatePlanRequirements(placed, model, catalogMap, customs, equivMap)
    : null;
  const isConsumedByMajorCore = Boolean(
    majorEval && placed.has(code) && !majorEval.freeCodes.includes(code),
  );
  const majorBucketAllocs =
    model && majorEval
      ? allocateBuckets(model.buckets, majorEval.freeCodes, catalogMap, customs)
      : null;
  const breadthAllocs =
    model && majorEval
      ? assignBreadthBuckets(
          majorEval.freeCodes,
          model.breadth,
          catalogMap,
          customs,
        )
      : null;

  const minorEval = minorModel
    ? evaluatePlanRequirements(placed, minorModel, catalogMap, customs, equivMap)
    : null;
  const isConsumedByMinorCore = Boolean(
    minorEval && placed.has(code) && !minorEval.freeCodes.includes(code),
  );
  const minorBucketAllocs =
    minorModel && minorEval
      ? allocateBuckets(
          minorModel.buckets,
          minorEval.freeCodes,
          catalogMap,
          customs,
        )
      : null;

  // 1. Major Required / Core
  const matchedReq = model?.required.find((r) => codeWithEquivs.has(r.code));
  if (matchedReq) {
    push({
      label:
        matchedReq.code === code
          ? "Major required"
          : `Major required (satisfies ${matchedReq.code})`,
      tier: "major-core",
      active: isConsumedByMajorCore,
    });
  }

  // 2. Major Choice Groups (explicit core options)
  for (const group of model?.chooseGroups ?? []) {
    if (!group.options.some((opt) => codeWithEquivs.has(opt))) continue;
    const optionSummary =
      group.options.length <= 3
        ? group.options.join(" / ")
        : `${group.label.replace(/:$/, "").toLowerCase()} ${group.options.length} options`;
    const suffix = group.elective ? ` or ${group.elective.label}` : "";
    push({
      label: `Major choice (${optionSummary}${suffix})`,
      tier: "major-core",
      active: isConsumedByMajorCore && !matchedReq,
    });
  }

  // 3. Minor Required & Choice Groups
  if (minorModel && minorProgram) {
    const matchedMinorReq = minorModel.required.find((r) =>
      codeWithEquivs.has(r.code),
    );
    if (matchedMinorReq) {
      push({
        label:
          matchedMinorReq.code === code
            ? `Minor required (${minorProgram.name})`
            : `Minor required (${minorProgram.name}: satisfies ${matchedMinorReq.code})`,
        tier: "minor-core",
        active: isConsumedByMinorCore,
      });
    }
    for (const group of minorModel.chooseGroups) {
      if (!group.options.some((opt) => codeWithEquivs.has(opt))) continue;
      const optionSummary =
        group.options.length <= 3
          ? group.options.join(" / ")
          : `${group.label.replace(/:$/, "").toLowerCase()} ${group.options.length} options`;
      push({
        label: `Minor choice (${minorProgram.name}: ${optionSummary})`,
        tier: "minor-core",
        active: isConsumedByMinorCore && !matchedMinorReq,
      });
    }
  }

  const collectMatchingBuckets = (
    pool: ElectiveBucket[],
    tier: CountsTowardTier,
    genericOnly: boolean,
    labelPrefix = "",
    isBucketActive?: (bucket: ElectiveBucket) => boolean,
  ) => {
    for (const bucket of pool) {
      const generic = isGenericAnyMatch(bucket.match);
      if (generic !== genericOnly) continue;
      if (matchesBucket(course, bucket.match)) {
        push({
          label: `${labelPrefix}${bucket.label}`,
          tier,
          active: isBucketActive ? isBucketActive(bucket) : false,
        });
      }
      for (const sub of bucket.subs) {
        const subGeneric = isGenericAnyMatch(sub.match);
        if (subGeneric !== genericOnly) continue;
        if (matchesBucket(course, sub.match)) {
          push({
            label: `${labelPrefix}${sub.label}`,
            tier,
            active: isBucketActive ? isBucketActive(bucket) : false,
          });
        }
      }
    }
  };

  // 4. Specific Major Elective Buckets & Choice-Group Elective Fallbacks
  if (model) {
    collectMatchingBuckets(
      model.buckets,
      "major-elective",
      false,
      "",
      (b) => Boolean(majorBucketAllocs?.get(b.key)?.assignedCodes.includes(code)),
    );

    for (const group of model.chooseGroups) {
      if (
        group.elective &&
        !group.options.some((opt) => codeWithEquivs.has(opt)) &&
        matchesBucket(course, group.elective.match)
      ) {
        push({
          label: group.elective.label,
          tier: "major-elective",
          active: isConsumedByMajorCore && !matchedReq,
        });
      }
    }

    // 5. Constrained Breadth Buckets
    collectMatchingBuckets(
      model.breadth,
      "breadth",
      false,
      "",
      (b) => breadthAllocs?.assignedBucketOf.get(code) === b.key,
    );
  }

  // 6. Minor Elective Buckets (constrained)
  if (minorModel) {
    collectMatchingBuckets(
      [...minorModel.buckets, ...minorModel.breadth],
      "minor-elective",
      false,
      "Minor: ",
      (b) => Boolean(minorBucketAllocs?.get(b.key)?.assignedCodes.includes(code)),
    );
  }

  // 7. Generic / Open Electives (e.g. "Any elective") last
  if (model) {
    collectMatchingBuckets(
      model.buckets,
      "breadth",
      true,
      "",
      (b) => Boolean(majorBucketAllocs?.get(b.key)?.assignedCodes.includes(code)),
    );
    collectMatchingBuckets(
      model.breadth,
      "breadth",
      true,
      "",
      (b) => breadthAllocs?.assignedBucketOf.get(code) === b.key,
    );
  }

  return entries;
}

function CourseDetailsModal({
  selectedCourse,
  terms,
  startYear,
  catalogMap,
  offeringsMap,
  offeringContext,
  equivMap,
  customs,
  model,
  minorProgram,
  minorModel,
  onClose,
  onRemove,
}: {
  selectedCourse: { code: string; termIndex: number; slotIndex: number };
  terms: PlannerTerm[];
  startYear: number;
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, OfferingEntry>;
  offeringContext: OfferingContext;
  equivMap: Map<string, Set<string>>;
  customs: Map<string, CustomCourse>;
  model: RequirementModel | null;
  minorProgram: DegreeProgramDetail | null;
  minorModel: RequirementModel | null;
  onClose: () => void;
  onRemove: () => void;
}) {
  const course = courseOf(selectedCourse.code, catalogMap, customs);
  const term = terms[selectedCourse.termIndex];
  const calYear = term
    ? termCalendarYear(startYear, term.year, term.season)
    : startYear;
  const academicBaseYear = term ? startYear + (term.year - 1) : startYear;
  const flag = prereqFlag(
    selectedCourse.code,
    selectedCourse.termIndex,
    terms,
    catalogMap,
    offeringsMap,
    customs,
    { startYear, context: offeringContext, equivMap },
  );
  const equivalentCodes = [...(equivMap.get(selectedCourse.code) ?? [])].sort();
  const isCustom = customs.has(selectedCourse.code);
  const isTransfer = Boolean(
    isCustom && customs.get(selectedCourse.code)?.transfer,
  );
  const yearOfferings = seasonsOf(selectedCourse.code, offeringsMap, customs, {
    academicBaseYear,
    context: offeringContext,
  });
  const countsToward = course
    ? computeCountsTowardEntries({
        code: selectedCourse.code,
        course,
        model,
        minorModel,
        minorProgram,
        equivMap,
        terms,
        catalogMap,
        customs,
      })
    : [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-sky-700 dark:text-sky-400">
                {selectedCourse.code}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {creditsOf(selectedCourse.code, catalogMap, customs)} cr
              </span>
              {term && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                  {term.season} {calYear}
                </span>
              )}
              {isTransfer && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  Transfer credit
                </span>
              )}
              {isCustom && !isTransfer && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Custom course
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {displayCourseTitle(course)}
            </h3>
            {course &&
              !("custom" in course) &&
              (course.subject_name || course.faculty) && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {[course.subject_name, course.faculty]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            {equivalentCodes.length > 0 && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Equivalent / Formerly:{" "}
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                  {equivalentCodes.join(", ")}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1 text-lg leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close course details"
          >
            &times;
          </button>
        </div>

        {flag && (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${
              flag.cls === "bad"
                ? "border-amber-200 bg-amber-50/90 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-sky-200 bg-sky-50/90 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
            }`}
          >
            {flag.icon === "i" ? "Notice:" : flag.icon} {flag.title}
          </div>
        )}

        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-slate-500 dark:text-slate-400">
              Offerings ({academicBaseYear}–{academicBaseYear + 1})
            </span>
            <span className="text-right font-medium text-slate-800 dark:text-slate-200">
              {yearOfferings.length > 0
                ? yearOfferings.join(" · ")
                : `Not offered in ${academicBaseYear}–${academicBaseYear + 1}`}
            </span>
          </div>

          {course && !("custom" in course) && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-500 dark:text-slate-400">
                Prerequisites
              </span>
              <span className="text-right text-slate-700 dark:text-slate-300">
                {course.prerequisite_text ||
                  (course.prerequisite_codes.length > 0
                    ? course.prerequisite_codes.join(", ")
                    : "None")}
              </span>
            </div>
          )}

          {countsToward.length > 0 && (
            <div className="flex items-start justify-between gap-4">
              <span className="shrink-0 pt-0.5 text-slate-500 dark:text-slate-400">
                Counts toward
              </span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {countsToward.map((entry) => {
                  const badgeClass =
                    entry.tier === "major-core"
                      ? "border-sky-200/90 bg-sky-50/90 font-semibold text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-200"
                      : entry.tier === "minor-core"
                        ? "border-violet-200/90 bg-violet-50/90 font-semibold text-violet-800 dark:border-violet-800/80 dark:bg-violet-950/60 dark:text-violet-200"
                        : entry.tier === "major-elective"
                          ? "border-emerald-200/80 bg-emerald-50/75 font-medium text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : entry.tier === "minor-elective"
                            ? "border-violet-200/70 bg-violet-50/50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/35 dark:text-violet-300"
                            : "border-slate-200/90 bg-slate-50/90 text-slate-700 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300";

                  return (
                    <span
                      key={entry.label}
                      title={
                        entry.active
                          ? "Actively satisfies this requirement in your current plan"
                          : "Eligible requirement bucket for this course"
                      }
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${badgeClass}`}
                    >
                      {entry.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div>
            {course && !("custom" in course) && course.calendar_url && (
              <a
                href={course.calendar_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                View in Academic Calendar &rarr;
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRemove}
              className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              Remove from term
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
