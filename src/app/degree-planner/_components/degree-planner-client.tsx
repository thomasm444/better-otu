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

import { AuthButton } from "@/components/auth-button";
import {
  deleteDegreePlan,
  fetchAllDegreePlans,
  fetchDegreePlanByProgram,
  upsertDegreePlan,
  type DegreePlanRecord,
} from "@/lib/degree-plan-storage";
import { createClient } from "@/lib/supabase/client";

import {
  buildDefaultPlan,
  buildModel,
  buildOfferingContext,
  buildOfferingsMap,
  courseOf,
  creditsOf,
  CREDIT_CAP,
  DEFAULT_START_YEAR,
  firstFreeSlot,
  matchingBuckets,
  MAX_SLOTS_PER_TERM,
  MAX_START_YEAR,
  MIN_START_YEAR,
  normalizeTermSlots,
  placedCodes,
  placedTermIndex,
  prereqFlag,
  seasonsOf,
  SLOTS_PER_TERM,
  STORE_PREFIX,
  termCalendarYear,
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
  startYear?: number;
  gapYears?: number[];
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
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORE_PREFIX + programId,
    JSON.stringify({
      terms,
      customs: [...customs.values()],
      startYear,
      gapYears,
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

  const [startYear, setStartYear] = useState<number>(DEFAULT_START_YEAR);
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
  const [previousPlan, setPreviousPlan] = useState<{
    programId: string;
    terms: PlannerTerm[];
    customs: CustomCourse[];
  } | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const drawerDragStartXRef = useRef<number | null>(null);

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerTransferMode, setPickerTransferMode] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<{
    code: string;
    termIndex: number;
    slotIndex: number;
  } | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [savedPlans, setSavedPlans] = useState<DegreePlanRecord[]>([]);
  const [plansMenuOpen, setPlansMenuOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<DegreePlanRecord | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const [deletingPlan, setDeletingPlan] = useState(false);

  const userRef = useRef<User | null>(null);
  const programRef = useRef<DegreeProgramDetail | null>(initialProgram);

  const menuContainerRef = useRef<HTMLDivElement>(null);
  const plansMenuContainerRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    programRef.current = program;
  }, [program]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1800);
  }, []);

  const applyProgramWithSaved = useCallback(
    (prog: DegreeProgramDetail, saved: SavedPlan) => {
      const nextCustoms = new Map(
        (saved.customs ?? []).map((c) => [c.code, c]),
      );
      const nextStartYear = saved.startYear ?? startYear;
      const nextGapYears = saved.gapYears ?? [];
      setStartYear(nextStartYear);
      setGapYears(nextGapYears);

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
      setProgram(prog);
      setProgramQuery(prog.name);
    },
    [catalogMap, offeringsMap, offeringContext, startYear],
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

  const activateProgram = useCallback(
    async (prog: DegreeProgramDetail, activeUser?: User | null) => {
      const localSaved = loadSavedPlan(prog.program_id);
      applyProgramWithSaved(prog, localSaved);

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
            remote.start_year != null)
        ) {
          const nextCustoms = new Map(
            remote.customs.map((c) => [c.code, c]),
          );
          const nextStartYear = remote.start_year ?? undefined;
          applyProgramWithSaved(prog, {
            terms: remote.terms,
            customs: remote.customs,
            startYear: nextStartYear,
          });
          persistPlan(prog.program_id, remote.terms, nextCustoms, nextStartYear);
        }
      } catch {
        // Keep local state if remote fetch fails.
      }
    },
    [applyProgramWithSaved, supabase],
  );

  // Hydrate saved localStorage plan for SSR-preloaded program after mount
  useEffect(() => {
    if (!initialProgram) return;
    programCacheRef.current.set(initialProgram.program_id, initialProgram);
    const saved = loadSavedPlan(initialProgram.program_id);
    if (!saved.terms?.length && !saved.customs?.length) return;
    const timer = setTimeout(() => {
      applyProgramWithSaved(initialProgram, saved);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialProgram, applyProgramWithSaved]);

  // Sync auth state and load the student's saved Supabase plan on mount / sign-in
  useEffect(() => {
    let active = true;

    async function hydrateForUser(nextUser: User | null) {
      userRef.current = nextUser;
      setUser(nextUser);
      if (!nextUser?.email) {
        setSavedPlans([]);
        return;
      }

      const currentProg = programRef.current;
      try {
        const allPlans = await fetchAllDegreePlans(supabase, nextUser.email);
        if (!active) return;
        setSavedPlans(allPlans);

        if (currentProg) {
          const remote = allPlans.find(
            (p) => p.program_id === currentProg.program_id,
          );
          if (
            remote &&
            (remote.terms.length > 0 ||
              remote.customs.length > 0 ||
              remote.start_year != null)
          ) {
            const nextCustoms = new Map(
              remote.customs.map((c) => [c.code, c]),
            );
            const nextStartYear = remote.start_year ?? undefined;
            applyProgramWithSaved(currentProg, {
              terms: remote.terms,
              customs: remote.customs,
              startYear: nextStartYear,
            });
            persistPlan(
              currentProg.program_id,
              remote.terms,
              nextCustoms,
              nextStartYear,
            );
          }
          return;
        }

        const latest = allPlans[0];
        if (!latest) return;

        setLoadingProgram(true);
        const detail = await loadProgramDetail(latest.program_id);
        if (!active) return;

        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("program", detail.program_id);
          window.history.replaceState(null, "", url.toString());
        }

        const nextCustoms = new Map(latest.customs.map((c) => [c.code, c]));
        const nextStartYear = latest.start_year ?? undefined;
        applyProgramWithSaved(detail, {
          terms: latest.terms,
          customs: latest.customs,
          startYear: nextStartYear,
        });
        persistPlan(
          detail.program_id,
          latest.terms,
          nextCustoms,
          nextStartYear,
        );
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
  }, [applyProgramWithSaved, loadProgramDetail, showToast, supabase]);

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
    [activateProgram, showToast],
  );

  const selectSavedPlan = useCallback(
    async (plan: DegreePlanRecord) => {
      setPlansMenuOpen(false);
      setMenuOpen(false);

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
        applyProgramWithSaved(detail, {
          terms: plan.terms,
          customs: plan.customs,
          startYear: nextStartYear,
        });
        persistPlan(
          detail.program_id,
          plan.terms,
          nextCustoms,
          nextStartYear,
        );
      } catch {
        showToast("Could not load saved plan");
      } finally {
        setLoadingProgram(false);
      }
    },
    [applyProgramWithSaved, loadProgramDetail, showToast],
  );

  const handleConfirmDeletePlan = useCallback(async () => {
    if (!planToDelete || !user?.email || deleteCountdown > 0 || deletingPlan) {
      return;
    }

    setDeletingPlan(true);
    try {
      await deleteDegreePlan(supabase, user.email, planToDelete.program_id);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORE_PREFIX + planToDelete.program_id);
      }

      setSavedPlans((prev) =>
        prev.filter((p) => p.program_id !== planToDelete.program_id),
      );

      if (previousPlan?.programId === planToDelete.program_id) {
        setPreviousPlan(null);
      }

      if (programRef.current?.program_id === planToDelete.program_id) {
        setProgram(null);
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
    supabase,
    previousPlan,
    showToast,
  ]);

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
    (
      nextTerms: PlannerTerm[],
      nextCustoms: Map<string, CustomCourse>,
      nextStartYear = startYear,
      nextGapYears = gapYears,
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

      persistPlan(
        program.program_id,
        normalizedTerms,
        nextCustoms,
        nextStartYear,
        nextGapYears,
      );

      if (user?.email) {
        void upsertDegreePlan(supabase, {
          userId: user.id,
          userEmail: user.email,
          degreeName: program.name,
          startYear: nextStartYear,
          programId: program.program_id,
          terms: normalizedTerms,
          customs: [...nextCustoms.values()],
        })
          .then((savedRecord) => {
            setSavedPlans((prev) => [
              savedRecord,
              ...prev.filter((p) => p.program_id !== savedRecord.program_id),
            ]);
          })
          .catch(() => {
            showToast("Could not save plan to your account");
          });
      }
    },
    [program, showToast, supabase, user, startYear, gapYears],
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

      if (slotIndex >= MAX_SLOTS_PER_TERM) {
        showToast(`Maximum of ${MAX_SLOTS_PER_TERM} courses per term`);
        setPicker(null);
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
    [terms, customs, commitPlan, showToast],
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

  const handleChangeStartYear = useCallback(
    (nextYear: number) => {
      if (program) {
        commitPlan(terms, customs, nextYear, gapYears);
      } else {
        setStartYear(nextYear);
      }
      showToast(`Degree start year set to ${nextYear}`);
    },
    [program, terms, customs, gapYears, commitPlan, showToast],
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

  const { planStartCalYear, planEndCalYear } = useMemo(() => {
    if (terms.length === 0) {
      return { planStartCalYear: startYear, planEndCalYear: startYear + 1 };
    }
    let minYear = startYear;
    let maxYear = startYear;
    for (const t of terms) {
      const calYear = termCalendarYear(startYear, t.year, t.season);
      if (calYear < minYear) minYear = calYear;
      if (calYear > maxYear) maxYear = calYear;
    }
    return { planStartCalYear: minYear, planEndCalYear: maxYear };
  }, [terms, startYear]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
          {/* Left Side: Home + Degree Planner title + Start–End year + Plans on top; Start + Degree search below */}
          <div className="flex flex-col items-start gap-2">
            <div className="flex w-full flex-wrap items-center gap-2.5">
              <Link
                href="/"
                className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                &larr; Home
              </Link>

              <div className="font-semibold tracking-tight whitespace-nowrap">
                Degree Planner{" "}
                <small className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Ontario Tech · {planStartCalYear}–{planEndCalYear}
                </small>
              </div>

              {/* Saved Plans Dropdown */}
              <div ref={plansMenuContainerRef} className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPlansMenuOpen((open) => !open);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <span>Plans</span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {savedPlans.length}
                  </span>
                </button>

                {plansMenuOpen && (
                  <div className="absolute top-10 right-0 z-50 max-h-[60vh] w-[min(360px,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl sm:left-0 sm:right-auto dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
                      Saved Plans ({savedPlans.length})
                    </div>

                    {savedPlans.length === 0 ? (
                      <div className="p-5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                        No saved plans yet. Pick a program and add courses to save one.
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
                            className={`flex items-center gap-2 border-b border-zinc-100 px-3 py-2 transition-colors last:border-b-0 dark:border-zinc-800 ${
                              isActive
                                ? "bg-blue-50/70 dark:bg-blue-950/30"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void selectSavedPlan(saved)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                  {saved.degree_name || saved.program_id}
                                </span>
                                {isActive && (
                                  <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                                    Active
                                  </span>
                                )}
                              </div>
                              <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
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
                                setDeleteCountdown(5);
                              }}
                              title="Delete saved plan"
                              aria-label={`Delete ${saved.degree_name || saved.program_id}`}
                              className="shrink-0 rounded-md px-1.5 py-1 text-sm leading-none text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
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
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <span>Start:</span>
                <select
                  value={startYear}
                  onChange={(e) => handleChangeStartYear(Number(e.target.value))}
                  aria-label="Degree start year"
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {startYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} ({y}–{String(y + 1).slice(-2)})
                    </option>
                  ))}
                </select>
              </label>

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
                  className="w-56 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none sm:w-72 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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
            </div>
          </div>

          {/* Right Side: Credits + Reset controls on top; Signed-in badge directly below Credits */}
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
              {/* Credit Progress Hero */}
              <div className="flex items-center gap-2">
                <strong className="text-lg leading-none font-semibold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
                  {totalPlacedCredits}
                </strong>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  / {totalTarget} cr
                </span>
                <div
                  className="h-2.5 w-28 overflow-hidden rounded-full bg-red-500/85 sm:w-36 dark:bg-red-500/75"
                  title={`${totalPlacedCredits} completed · ${Math.max(0, totalTarget - totalPlacedCredits)} remaining`}
                >
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${heroPct}%` }}
                  />
                </div>
              </div>

              {previousPlan && (
                <button
                  type="button"
                  onClick={handleRestorePrevious}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  Undo reset
                </button>
              )}

              <button
                type="button"
                disabled={!program}
                onClick={() => setResetConfirmOpen(true)}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Reset to defaults
              </button>
            </div>

            <AuthButton />
          </div>
        </div>
      </header>

      {/* Reset Confirmation Modal */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-500 bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                <span className="text-lg font-bold">!</span>
              </div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Reset plan to defaults?
              </h2>
            </div>

            <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
              Are you sure you want to reset your plan back to the default
              template? (You can still click <strong>Undo reset</strong>{" "}
              afterward if you change your mind.)
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
              >
                Yes, reset plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Saved Plan Confirmation Modal (with 5-second safety delay) */}
      {planToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-500 bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                <span className="text-lg font-bold">!</span>
              </div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Delete saved plan?
              </h2>
            </div>

            <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
              Are you sure you want to permanently delete your saved plan for{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">
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
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteCountdown > 0 || deletingPlan}
                onClick={() => void handleConfirmDeletePlan()}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  deleteCountdown > 0
                    ? "cursor-not-allowed border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
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

      {/* Main Layout */}
      <main
        className={`mx-auto max-w-[1440px] p-4 ${
          program && model
            ? sidebarOpen
              ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_390px]"
              : "pr-12"
            : ""
        }`}
      >
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
          ) : academicYears.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
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
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-800/70 dark:bg-amber-950/25"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                            Gap Year
                          </span>
                          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            {calStart}–{calEnd}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            No courses scheduled · subsequent years shifted +1
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveGapYear(academicYear)}
                          className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
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
                    <div key={`year-${academicYear}`}>
                      <div className="mb-2 flex flex-wrap items-baseline gap-2.5 px-0.5">
                        <h3 className="text-[15px] font-semibold tracking-tight">
                          Year {studyYear}
                        </h3>
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">
                          {calStart}–{calEnd}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {yearCreds} credits
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleInsertGapYear(academicYear)}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-amber-300"
                            title={`Insert a gap year at ${calStart}–${calEnd}`}
                          >
                            + Gap year
                          </button>
                          <button
                            type="button"
                            onClick={() => addSummer(academicYear)}
                            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                          >
                            + Summer term
                          </button>
                          {academicYears.length > 1 && isEmptyYear && (
                            <button
                              type="button"
                              onClick={() => handleRemoveYear(academicYear)}
                              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-400 transition-colors hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-900"
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
                          return (
                            <div
                              key={`${academicYear}-${term.season}-${termIndex}`}
                              className="min-w-[235px] flex-1 basis-[235px] rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
                            >
                              <div className="mb-2 flex items-center gap-2">
                                <span className="text-[13px] font-semibold">
                                  {term.season} {calYear}
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
                                  { startYear, context: offeringContext },
                                );

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
                                    className={`group relative flex min-h-[38px] cursor-grab items-center gap-2 rounded-lg border px-2 py-1 text-[12.5px] transition-colors active:cursor-grabbing ${
                                      isDragOver
                                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950/40"
                                        : isCustom
                                          ? "border-dashed border-blue-300 bg-blue-50/40 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/20"
                                          : "border-zinc-200 bg-zinc-50/60 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:border-zinc-700"
                                    }`}
                                  >
                                    {flag && (
                                      <div
                                        role="tooltip"
                                        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium shadow-lg group-hover:block ${
                                          flag.cls === "bad"
                                            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/80 dark:bg-zinc-900 dark:text-amber-300"
                                            : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                        }`}
                                      >
                                        {flag.icon} {flag.title}
                                      </div>
                                    )}
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
                                        title="Custom course — not taken from the course timetable"
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        clearSlot(termIndex, slotIndex);
                                      }}
                                      title="Remove"
                                      className="px-0.5 text-sm leading-none text-zinc-400 hover:text-red-600"
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
                                  className={`flex min-h-[38px] w-full items-center justify-center rounded-lg border border-dashed text-[12.5px] transition-colors ${
                                    isAppendDragOver
                                      ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/40"
                                      : "border-zinc-200 text-zinc-400 hover:border-blue-500 hover:bg-blue-50/40 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-blue-500 dark:hover:bg-blue-950/20"
                                  }`}
                                >
                                  ＋ add course
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={handleAddYear}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 bg-white/60 py-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:border-blue-600 dark:hover:text-blue-300"
              >
                + Add Year ({startYear + academicYears.length}–{startYear + academicYears.length + 1})
              </button>
            </div>
          )}
        </section>

        {/* Right Column ("What you need") — Side-by-side when open, pull-tab when closed */}
        {program && model ? (
          sidebarOpen ? (
            <div className="relative lg:sticky lg:top-[122px]">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    drawerDragStartXRef.current = e.clientX;
                  }}
                  onPointerUp={(e) => {
                    if (drawerDragStartXRef.current === null) return;
                    const deltaX = e.clientX - drawerDragStartXRef.current;
                    drawerDragStartXRef.current = null;
                    if (deltaX > 25 || Math.abs(deltaX) <= 25) {
                      setSidebarOpen(false);
                    }
                  }}
                  title="Drag right or click to push to the side"
                  className="cursor-grab rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-sm transition-colors select-none hover:border-zinc-300 hover:text-zinc-900 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  Push to side ▶
                </button>
              </div>
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
            </div>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => {
                drawerDragStartXRef.current = e.clientX;
              }}
              onPointerUp={(e) => {
                if (drawerDragStartXRef.current === null) return;
                const deltaX = e.clientX - drawerDragStartXRef.current;
                drawerDragStartXRef.current = null;
                if (deltaX < -25 || Math.abs(deltaX) <= 25) {
                  setSidebarOpen(true);
                }
              }}
              title="Drag left or click to open What you need"
              className="fixed top-[62%] right-0 z-40 flex h-36 w-9 -translate-y-1/2 cursor-grab items-center justify-center rounded-l-xl border border-r-0 border-zinc-300 bg-white/95 text-xs font-semibold tracking-wide text-zinc-700 shadow-lg backdrop-blur select-none active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
            >
              <span className="[writing-mode:vertical-rl] rotate-180">
                ◀ What you need
              </span>
            </button>
          )
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
          offeringContext={offeringContext}
          startYear={startYear}
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

      {/* Course Details Modal */}
      {selectedCourse && (
        <CourseDetailsModal
          selectedCourse={selectedCourse}
          terms={terms}
          startYear={startYear}
          catalogMap={catalogMap}
          offeringsMap={offeringsMap}
          offeringContext={offeringContext}
          customs={customs}
          model={model}
          onClose={() => setSelectedCourse(null)}
          onRemove={() => {
            clearSlot(selectedCourse.termIndex, selectedCourse.slotIndex);
            setSelectedCourse(null);
          }}
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

function CourseDetailsModal({
  selectedCourse,
  terms,
  startYear,
  catalogMap,
  offeringsMap,
  offeringContext,
  customs,
  model,
  onClose,
  onRemove,
}: {
  selectedCourse: { code: string; termIndex: number; slotIndex: number };
  terms: PlannerTerm[];
  startYear: number;
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, import("@/lib/degree-types").OfferingEntry>;
  offeringContext: import("@/lib/degree-types").OfferingContext;
  customs: Map<string, CustomCourse>;
  model: import("@/lib/degree-types").RequirementModel | null;
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
    { startYear, context: offeringContext },
  );
  const isCustom = customs.has(selectedCourse.code);
  const isTransfer = Boolean(
    isCustom && customs.get(selectedCourse.code)?.transfer,
  );
  const yearOfferings = seasonsOf(selectedCourse.code, offeringsMap, customs, {
    academicBaseYear,
    context: offeringContext,
  });
  const buckets = course ? matchingBuckets(course, model) : [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-blue-700 dark:text-blue-400">
                {selectedCourse.code}
              </span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {creditsOf(selectedCourse.code, catalogMap, customs)} cr
              </span>
              {term && (
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  {term.season} {calYear}
                </span>
              )}
              {isTransfer && (
                <span className="rounded bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                  Transfer credit
                </span>
              )}
              {isCustom && !isTransfer && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  Custom course
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {course?.title ?? "Unknown course"}
            </h3>
            {course &&
              !("custom" in course) &&
              (course.subject_name || course.faculty) && (
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {[course.subject_name, course.faculty]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            aria-label="Close course details"
          >
            &times;
          </button>
        </div>

        {flag && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
              flag.cls === "bad"
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
            }`}
          >
            {flag.icon} {flag.title}
          </div>
        )}

        <div className="mt-4 space-y-2.5 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
              Offerings ({academicBaseYear}–{academicBaseYear + 1})
            </span>
            <span className="text-right font-medium text-zinc-800 dark:text-zinc-200">
              {yearOfferings.length > 0
                ? yearOfferings.join(" · ")
                : `Not offered in ${academicBaseYear}–${academicBaseYear + 1}`}
            </span>
          </div>

          {course && !("custom" in course) && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                Prerequisites
              </span>
              <span className="text-right text-zinc-700 dark:text-zinc-300">
                {course.prerequisite_text ||
                  (course.prerequisite_codes.length > 0
                    ? course.prerequisite_codes.join(", ")
                    : "None")}
              </span>
            </div>
          )}

          {buckets.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                Counts toward
              </span>
              <span className="text-right text-zinc-700 dark:text-zinc-300">
                {buckets.join(", ")}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <div>
            {course && !("custom" in course) && course.calendar_url && (
              <a
                href={course.calendar_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                View in Academic Calendar &rarr;
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Remove from term
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
