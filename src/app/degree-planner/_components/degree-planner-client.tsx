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
import { createClient } from "@/lib/supabase/client";

import {
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
  findEquivalentInSet,
  findProgramInCatalogYear,
  firstFreeSlot,
  matchingBuckets,
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
  planName?: string;
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
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [startYear, setStartYear] = useState<number>(initialStartYear);
  const [catalogYear, setCatalogYear] = useState<string>(() =>
    initialProgram
      ? initialProgram.catalog_year
      : resolveCatalogYearForStartYear(initialStartYear, availableCatalogYears),
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
    (prog: DegreeProgramDetail, saved: SavedPlan, startYearOverride?: number) => {
      const nextCustoms = new Map(
        (saved.customs ?? []).map((c) => [c.code, c]),
      );
      const nextStartYear = startYearOverride ?? saved.startYear ?? startYear;
      const nextGapYears = saved.gapYears ?? [];
      setStartYear(nextStartYear);
      setCatalogYear(prog.catalog_year);
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
      setPlanMismatches(new Map());
      setProgram(prog);
      setProgramQuery("");
      setPlanName(saved.planName?.trim() || prog.name);
      setEditingPlanName(false);
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
    async (
      prog: DegreeProgramDetail,
      activeUser?: User | null,
      startYearOverride?: number,
    ) => {
      const localSaved = loadSavedPlan(prog.program_id);
      applyProgramWithSaved(prog, localSaved, startYearOverride);

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
          const nextStartYear =
            startYearOverride ?? remote.start_year ?? undefined;
          const nextPlanName = remote.degree_name?.trim() || prog.name;
          applyProgramWithSaved(prog, {
            terms: remote.terms,
            customs: remote.customs,
            startYear: nextStartYear,
            planName: nextPlanName,
          });
          persistPlan(
            prog.program_id,
            remote.terms,
            nextCustoms,
            nextStartYear,
            [],
            nextPlanName,
          );
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
            const nextPlanName = remote.degree_name?.trim() || currentProg.name;
            applyProgramWithSaved(currentProg, {
              terms: remote.terms,
              customs: remote.customs,
              startYear: nextStartYear,
              planName: nextPlanName,
            });
            persistPlan(
              currentProg.program_id,
              remote.terms,
              nextCustoms,
              nextStartYear,
              [],
              nextPlanName,
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
        const nextPlanName = latest.degree_name?.trim() || detail.name;
        applyProgramWithSaved(detail, {
          terms: latest.terms,
          customs: latest.customs,
          startYear: nextStartYear,
          planName: nextPlanName,
        });
        persistPlan(
          detail.program_id,
          latest.terms,
          nextCustoms,
          nextStartYear,
          [],
          nextPlanName,
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
          p.catalog_year === catalogYear &&
          (!q ||
            `${p.name} ${p.credential ?? ""} ${p.degree_abbrev ?? ""} ${p.faculty ?? ""}`
              .toLowerCase()
              .includes(q)),
      )
      .slice(0, 60);
  }, [bootstrap.programs, catalogYear, programQuery]);

  const selectProgram = useCallback(
    async (summary: ProgramSummary) => {
      setMenuOpen(false);
      setProgramQuery("");

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
        const nextPlanName = plan.degree_name?.trim() || detail.name;
        applyProgramWithSaved(detail, {
          terms: plan.terms,
          customs: plan.customs,
          startYear: nextStartYear,
          planName: nextPlanName,
        });
        persistPlan(
          detail.program_id,
          plan.terms,
          nextCustoms,
          nextStartYear,
          [],
          nextPlanName,
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
      nextPlanName = planName,
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

      const effectiveName = nextPlanName.trim() || program.name;
      persistPlan(
        program.program_id,
        normalizedTerms,
        nextCustoms,
        nextStartYear,
        nextGapYears,
        effectiveName,
      );

      if (user?.email) {
        void upsertDegreePlan(supabase, {
          userId: user.id,
          userEmail: user.email,
          degreeName: effectiveName,
          startYear: nextStartYear,
          catalogYear: program.catalog_year,
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
    [program, showToast, supabase, user, startYear, gapYears, planName],
  );

  const handleRenamePlan = useCallback(
    (rawName: string) => {
      if (!program) {
        setEditingPlanName(false);
        return;
      }
      const nextName = rawName.trim() || program.name;
      setPlanName(nextName);
      setEditingPlanName(false);
      commitPlan(terms, customs, startYear, gapYears, nextName);
      showToast(`Renamed plan to "${nextName}"`);
    },
    [program, commitPlan, terms, customs, startYear, gapYears, showToast],
  );

  const openAddPlanModal = useCallback(() => {
    setPlansMenuOpen(false);
    setMenuOpen(false);
    setNewPlanQuery("");
    setNewPlanProgram(null);
    setNewPlanName("");
    setNewPlanStartYear(startYear);
    setAddPlanModalOpen(true);
  }, [startYear]);

  const filteredNewPlanPrograms = useMemo(() => {
    const q = newPlanQuery.trim().toLowerCase();
    const targetCatalogYear = resolveCatalogYearForStartYear(
      newPlanStartYear,
      availableCatalogYears,
    );
    return bootstrap.programs
      .filter(
        (p) =>
          p.catalog_year === targetCatalogYear &&
          (!q ||
            `${p.name} ${p.credential ?? ""} ${p.degree_abbrev ?? ""} ${p.faculty ?? ""}`
              .toLowerCase()
              .includes(q)),
      )
      .slice(0, 60);
  }, [
    bootstrap.programs,
    newPlanQuery,
    newPlanStartYear,
    availableCatalogYears,
  ]);

  const handleCreateNewPlan = useCallback(async () => {
    if (!newPlanProgram || creatingPlan) return;
    setCreatingPlan(true);
    try {
      const targetCatalogYear = resolveCatalogYearForStartYear(
        newPlanStartYear,
        availableCatalogYears,
      );
      const resolvedProgram =
        findProgramInCatalogYear(
          bootstrap.programs,
          newPlanProgram,
          targetCatalogYear,
        ) ?? newPlanProgram;
      const detail = await loadProgramDetail(resolvedProgram.program_id);
      const effectiveName = newPlanName.trim() || detail.name;
      const existingSaved = savedPlans.find(
        (p) => p.program_id === detail.program_id,
      );
      const nextCustoms = existingSaved
        ? new Map(existingSaved.customs.map((c) => [c.code, c]))
        : new Map<string, CustomCourse>();

      let nextTerms: PlannerTerm[];
      if (existingSaved && existingSaved.terms.length > 0) {
        nextTerms = existingSaved.terms.map((t) => ({
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
      setGapYears([]);
      setCustoms(nextCustoms);
      setTerms(nextTerms);

      persistPlan(
        detail.program_id,
        nextTerms,
        nextCustoms,
        newPlanStartYear,
        [],
        effectiveName,
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
            terms: nextTerms,
            customs: [...nextCustoms.values()],
          });
          setSavedPlans((prev) => [
            savedRecord,
            ...prev.filter((p) => p.program_id !== savedRecord.program_id),
          ]);
        } catch {
          showToast("Could not save plan to your account");
        }
      }

      setAddPlanModalOpen(false);
      showToast(`Opened plan "${effectiveName}"`);
    } catch {
      showToast("Could not create plan");
    } finally {
      setCreatingPlan(false);
    }
  }, [
    availableCatalogYears,
    bootstrap.programs,
    newPlanProgram,
    creatingPlan,
    loadProgramDetail,
    newPlanName,
    savedPlans,
    catalogMap,
    offeringsMap,
    newPlanStartYear,
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
            `Degree start year set to ${options.startYearOverride} (${nextCatalogYear} plan)`,
          );
        } else {
          showToast(`Plan year set to ${nextCatalogYear}`);
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
            `Start year set to ${options.startYearOverride} (${currentProg.name} not in ${nextCatalogYear} catalog)`,
          );
        } else {
          setCatalogYear(nextCatalogYear);
          showToast(
            `${currentProg.name} is not in the ${nextCatalogYear} catalog — pick a program`,
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
        const carriedTerms = terms.map((t) => ({
          ...t,
          slots: normalizeTermSlots(t.slots),
        }));
        const carriedCustoms = new Map(customs);
        const carriedGapYears = [...gapYears];

        if (carriedTerms.length === 0) {
          await activateProgram(detail, undefined, effectiveStartYear);
          showToast(`Switched to ${nextCatalogYear} ${detail.name} plan`);
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

        persistPlan(
          detail.program_id,
          carriedTerms,
          carriedCustoms,
          effectiveStartYear,
          carriedGapYears,
          nextPlanName,
        );

        const activeUser = userRef.current;
        if (activeUser?.email) {
          void upsertDegreePlan(supabase, {
            userId: activeUser.id,
            userEmail: activeUser.email,
            degreeName: nextPlanName,
            startYear: effectiveStartYear,
            catalogYear: detail.catalog_year,
            programId: detail.program_id,
            terms: carriedTerms,
            customs: [...carriedCustoms.values()],
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

        const mismatchCount = nextMismatches.size;
        showToast(
          mismatchCount > 0
            ? `Switched to ${nextCatalogYear} ${detail.name} plan (${mismatchCount} ${mismatchCount === 1 ? "course" : "courses"} flagged)`
            : `Switched to ${nextCatalogYear} ${detail.name} plan`,
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
      gapYears,
      loadProgramDetail,
      planMismatches,
      planName,
      showToast,
      startYear,
      supabase,
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
      const wasFollowingStartYear = catalogYear === prevDefaultCatalog;

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
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* Left Side: Home on top; Plans + (+) below; Plan name; Start year */}
          <div className="flex flex-col items-start gap-1.5">
            <Link
              href="/"
              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <span>Plans</span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {savedPlans.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={openAddPlanModal}
                  title="Add another degree plan"
                  aria-label="Add another degree plan"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-500 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
                >
                  +
                </button>

                {plansMenuOpen && (
                  <div className="absolute top-9 left-0 z-50 max-h-[60vh] w-[min(360px,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                        Saved Plans ({savedPlans.length})
                      </span>
                      <button
                        type="button"
                        onClick={openAddPlanModal}
                        className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:hover:bg-blue-900/60"
                      >
                        + New Plan
                      </button>
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

            {/* Active Plan Name (visible + editable) */}
            {program && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
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
                      className="w-56 rounded-lg border border-blue-500 bg-white px-2.5 py-1 text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-blue-500/20 focus:outline-none sm:w-72 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPlanName(false)}
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                      className="group inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {planName || program.name}
                      </span>
                      <span className="text-xs text-zinc-400 transition-colors group-hover:text-blue-600 dark:text-zinc-500 dark:group-hover:text-blue-400">
                        ✎
                      </span>
                    </button>
                    {planName && planName !== program.name && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        ({program.name})
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Start Year & Catalog Year directly below Plan name */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <span>Start:</span>
                <select
                  value={startYear}
                  onChange={(e) =>
                    void handleChangeStartYear(Number(e.target.value))
                  }
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

              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <span>Catalog:</span>
                <select
                  value={catalogYear}
                  onChange={(e) =>
                    void handleChangeCatalogYear(e.target.value)
                  }
                  aria-label="Program map catalog year"
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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

          {/* Middle: Degree Planner Title above Search */}
          <div className="flex w-full flex-col items-start gap-1.5 lg:flex-1 lg:items-center lg:px-4">
            <div className="font-semibold tracking-tight whitespace-nowrap">
              Degree Planner{" "}
              <small className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                Ontario Tech · {planStartCalYear}–{planEndCalYear}
              </small>
            </div>

            <div ref={menuContainerRef} className="relative w-full max-w-[280px]">
              <input
                type="text"
                value={programQuery}
                onFocus={() => setMenuOpen(true)}
                onChange={(e) => {
                  setProgramQuery(e.target.value);
                  setMenuOpen(true);
                }}
                placeholder="Search"
                aria-label="Search programs"
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              {menuOpen && (
                <div className="absolute top-10 left-0 z-50 max-h-[60vh] w-[min(430px,calc(100vw-2rem))] overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl lg:left-1/2 lg:-translate-x-1/2 dark:border-zinc-700 dark:bg-zinc-900">
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

          {/* Right Side: Credits on top; Reset controls directly below */}
          <div className="flex flex-col items-start gap-2 lg:items-end">
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

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {previousPlan && (
                <button
                  type="button"
                  onClick={handleRestorePrevious}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                >
                  Undo reset
                </button>
              )}

              <button
                type="button"
                disabled={!program}
                onClick={() => setResetConfirmOpen(true)}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Reset to defaults
              </button>
            </div>
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

      {/* Add New Plan Modal */}
      {addPlanModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => !creatingPlan && setAddPlanModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Add degree plan
              </h2>
              <button
                type="button"
                disabled={creatingPlan}
                onClick={() => setAddPlanModalOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
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
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <div className="mt-1.5 max-h-44 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/50">
                  {filteredNewPlanPrograms.length === 0 ? (
                    <div className="p-4 text-center text-xs text-zinc-500">
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
                          className={`flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-xs transition-colors last:border-b-0 dark:border-zinc-800 ${
                            isSelected
                              ? "bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100"
                              : "hover:bg-white dark:hover:bg-zinc-800/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block truncate font-medium">
                              {p.name}
                            </span>
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {[p.credential, p.degree_abbrev]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                          {alreadySaved && (
                            <span className="shrink-0 rounded bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
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
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  2. Plan name
                </label>
                <input
                  type="text"
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  placeholder={
                    newPlanProgram?.name || "e.g. My Computer Science Plan"
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  3. Start year
                </label>
                <select
                  value={newPlanStartYear}
                  onChange={(e) => setNewPlanStartYear(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {startYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} ({y}–{String(y + 1).slice(-2)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={creatingPlan}
                onClick={() => setAddPlanModalOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newPlanProgram || creatingPlan}
                onClick={() => void handleCreateNewPlan()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingPlan ? "Creating…" : "Create plan"}
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
                                        : mismatchReason
                                          ? "border-red-300 bg-red-50/60 hover:border-red-400 dark:border-red-800/80 dark:bg-red-950/25 dark:hover:border-red-700"
                                          : isCustom
                                            ? "border-dashed border-blue-300 bg-blue-50/40 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/20"
                                            : "border-zinc-200 bg-zinc-50/60 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:border-zinc-700"
                                    }`}
                                  >
                                    {flag && (
                                      <div
                                        role="tooltip"
                                        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium shadow-lg group-hover:block ${
                                          mismatchReason
                                            ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700/80 dark:bg-zinc-900 dark:text-red-300"
                                            : flag.cls === "bad"
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
                                          mismatchReason
                                            ? "text-red-600 dark:text-red-400"
                                            : flag.cls === "bad"
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
                planMismatches={planMismatches}
                equivMap={equivMap}
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
          equivMap={equivMap}
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
          equivMap={equivMap}
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
  equivMap,
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
  equivMap: Map<string, Set<string>>;
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
            {equivalentCodes.length > 0 && (
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Equivalent / Formerly:{" "}
                <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                  {equivalentCodes.join(", ")}
                </span>
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
