"use client";

import type { User } from "@supabase/supabase-js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { fetchAllDegreePlans } from "@/lib/degree-plan-storage";
import { buildModel } from "@/lib/degree-planner";
import type { DegreeProgramDetail, ElectiveMatch } from "@/lib/degree-types";
import {
  extractAllDegreePlansForTerm,
  loadLocalTermSchedule,
  loadUserScheduleHydrationFromDb,
  saveLocalTermSchedule,
  syncUserTermScheduleToDb,
  type DegreePlanImportOption,
} from "@/lib/schedule-storage";
import { fetchStudentProfileWithPrograms } from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/client";

import {
  COURSE_COLOR_PALETTE,
  DAYS_OF_WEEK,
  annotateScheduleConflicts,
  autoFitPlannedCourses,
  convertScheduleSectionToBlocks,
  formatTimeDisplay,
  getSingleSectionCrnsForCourse,
  mergeBlockedSlots,
  type BlockedTimeSlot,
  type ColorTheme,
  type CourseComponentType,
  type DayOfWeek,
  type PlannedCourseEntry,
  type ScheduleBlock,
  type ScheduleCourseGroup,
  type ScheduleSection,
  type ScheduleTermInfo,
  type ScheduleViewMode,
  type SectionGridPickerTarget,
  type TermScheduleCatalog,
} from "../types";
import { CalendarExportModal } from "./calendar-export-modal";
import { CourseLookupPanel } from "./course-lookup-panel";
import { WeekScheduleGrid } from "./timetable-grid";

interface ScheduleContainerProps {
  initialCatalog: TermScheduleCatalog;
  terms: ScheduleTermInfo[];
}

const WEEKDAY_KEYS = DAYS_OF_WEEK.slice(0, 5);
const ACTIVE_DEGREE_PLAN_STORAGE_KEY = "otu-schedule-active-plan-id";

const TIME_BLOCK_PRESETS: Array<{
  id: string;
  label: string;
  slots: Array<{
    day: DayOfWeek;
    startTime: string;
    endTime: string;
    label: string;
  }>;
}> = [
  {
    id: "no-early-mornings",
    label: "No 8:00–9:30 AM classes",
    slots: WEEKDAY_KEYS.map((d) => ({
      day: d.key,
      startTime: "08:00",
      endTime: "09:30",
      label: "No early morning",
    })),
  },
  {
    id: "no-evenings",
    label: "No Evenings (5:00–10:00 PM)",
    slots: WEEKDAY_KEYS.map((d) => ({
      day: d.key,
      startTime: "17:00",
      endTime: "22:00",
      label: "Evening blocked",
    })),
  },
  {
    id: "lunch-break",
    label: "Lunch Break (12:00–1:00 PM)",
    slots: WEEKDAY_KEYS.map((d) => ({
      day: d.key,
      startTime: "12:00",
      endTime: "13:00",
      label: "Lunch",
    })),
  },
  {
    id: "free-fridays",
    label: "Free Fridays (All Day)",
    slots: [
      {
        day: "friday",
        startTime: "08:00",
        endTime: "22:00",
        label: "Free Friday",
      },
    ],
  },
];

export function ScheduleContainer({
  initialCatalog,
  terms,
}: ScheduleContainerProps) {
  const supabase = useMemo(() => createClient(), []);
  const catalogCacheRef = useRef<Map<string, TermScheduleCatalog>>(
    new Map([[initialCatalog.term, initialCatalog]]),
  );

  const [activeTerm, setActiveTerm] = useState<string>(initialCatalog.term);
  const [catalog, setCatalog] = useState<TermScheduleCatalog>(initialCatalog);
  const [loadingTerm, setLoadingTerm] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [viewMode, setViewMode] = useState<ScheduleViewMode>("combined");
  const [showRmp, setShowRmp] = useState(false);
  const [mobileTab, setMobileTab] = useState<"schedule" | "lookup">("schedule");
  const [lookupTabTrigger, setLookupTabTrigger] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);

  const [plannedCourses, setPlannedCourses] = useState<PlannedCourseEntry[]>(
    [],
  );
  const [blockedSlots, setBlockedSlots] = useState<BlockedTimeSlot[]>([]);
  const [customBlocks, setCustomBlocks] = useState<ScheduleBlock[]>([]);
  const [completedCourses, setCompletedCourses] = useState<string[]>([]);
  const [programElectives, setProgramElectives] = useState<
    Array<{ id: string; label: string; match: ElectiveMatch }>
  >([]);

  const [degreePlanOptions, setDegreePlanOptions] = useState<
    DegreePlanImportOption[]
  >([]);
  const [importMenuOpen, setImportMenuOpen] = useState(false);

  const [hoverPreviewSection, setHoverPreviewSection] =
    useState<ScheduleSection | null>(null);
  const [gridSectionPickers, setGridSectionPickers] = useState<
    SectionGridPickerTarget[]
  >([]);

  type HistorySnapshot = {
    plannedCourses: PlannedCourseEntry[];
    gridSectionPickers: SectionGridPickerTarget[];
    customBlocks: ScheduleBlock[];
    blockedSlots: BlockedTimeSlot[];
  };
  const plannedCoursesRef = useRef<PlannedCourseEntry[]>(plannedCourses);
  const gridSectionPickersRef = useRef<SectionGridPickerTarget[]>(gridSectionPickers);
  const customBlocksRef = useRef<ScheduleBlock[]>(customBlocks);
  const blockedSlotsRef = useRef<BlockedTimeSlot[]>(blockedSlots);
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);

  useEffect(() => {
    plannedCoursesRef.current = plannedCourses;
  }, [plannedCourses]);

  useEffect(() => {
    gridSectionPickersRef.current = gridSectionPickers;
  }, [gridSectionPickers]);

  useEffect(() => {
    customBlocksRef.current = customBlocks;
  }, [customBlocks]);

  useEffect(() => {
    blockedSlotsRef.current = blockedSlots;
  }, [blockedSlots]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [activeTerm]);
  const [hiddenUnplannedCodes, setHiddenUnplannedCodes] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedCourseCode, setFocusedCourseCode] = useState<string | null>(
    null,
  );
  const [termPlannedCodesMap, setTermPlannedCodesMap] = useState<
    Record<string, string[]>
  >({});
  const [dismissedTempCompleted, setDismissedTempCompleted] = useState<
    Set<string>
  >(() => new Set());

  const [isBlockingMode, setIsBlockingMode] = useState(false);
  const [isCustomBlockDragMode, setIsCustomBlockDragMode] = useState(false);
  const [customBlockDraft, setCustomBlockDraft] = useState<{
    courseCode: string;
    title: string;
    room?: string;
    weekPattern: "both" | "week1" | "week2";
    color: ColorTheme;
  }>({
    courseCode: "CUSTOM",
    title: "Custom Block",
    room: undefined,
    weekPattern: "both",
    color: "teal",
  });
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [blkDay, setBlkDay] = useState<DayOfWeek>("monday");
  const [blkStart, setBlkStart] = useState("12:00");
  const [blkEnd, setBlkEnd] = useState("13:30");
  const [blkLabel, setBlkLabel] = useState("Blocked");

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "saving" | "saved" | "local" | "error"
  >("idle");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  const hydratedKeyRef = useRef<string | null>(null);
  const userDirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockMenuRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // Close block-time popover on outside click
  useEffect(() => {
    if (!blockMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        blockMenuRef.current &&
        !blockMenuRef.current.contains(e.target as Node)
      ) {
        setBlockMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
  return () => document.removeEventListener("mousedown", onDown);
  }, [blockMenuOpen]);

  // Close degree-plan import popover on outside click
  useEffect(() => {
    if (!importMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(e.target as Node)
      ) {
        setImportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
  return () => document.removeEventListener("mousedown", onDown);
  }, [importMenuOpen]);

  const [userYearOfStudy, setUserYearOfStudy] = useState<number | null>(null);

  // Auth listener
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

  return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Load user's year_of_study from student profile for default course level
  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setUserYearOfStudy(null);
      return;
    }
    fetchStudentProfileWithPrograms(supabase, user.id)
      .then((profile) => {
        if (!active) return;
        setUserYearOfStudy(profile?.year_of_study ?? null);
      })
      .catch(() => {
        if (!active) return;
        setUserYearOfStudy(null);
      });
    return () => {
      active = false;
    };
  }, [supabase, user?.id]);

  const courseMap = useMemo(() => {
    const map = new Map<string, ScheduleCourseGroup>();
    for (const c of catalog.courses) {
      map.set(c.courseCode, c);
    }
    return map;
  }, [catalog.courses]);

  const buildEntriesFromCourseCodes = useCallback(
    (codes: string[], existingColorStart = 0): PlannedCourseEntry[] => {
      const seen = new Set<string>();
      const entries: PlannedCourseEntry[] = [];
      let colorIdx = existingColorStart;

      for (const raw of codes) {
        const code = raw.trim().toUpperCase();
        const course = courseMap.get(code);
        if (!code || seen.has(code) || !course) continue;
        seen.add(code);
        entries.push({
          courseCode: code,
          mode: "planned",
          selectedCrns: getSingleSectionCrnsForCourse(course),
          color: COURSE_COLOR_PALETTE[colorIdx % COURSE_COLOR_PALETTE.length],
        });
        colorIdx++;
      }

      return entries;
    },
    [courseMap],
  );

  // Hydrate schedule from Supabase + localStorage + Degree Plan when term/user/catalog are ready
  useEffect(() => {
    if (!authReady) return;
    const hydrationKey = `${activeTerm}:${user?.id ?? "guest"}`;
    if (hydratedKeyRef.current === hydrationKey) return;

    let cancelled = false;
    const termInfo = terms.find((t) => t.code === activeTerm) ?? terms[0];

    async function hydrate() {
      userDirtyRef.current = false;
      const local = loadLocalTermSchedule(activeTerm);
      const fallLocal = loadLocalTermSchedule("202609");
      const winterLocal = loadLocalTermSchedule("202701");
      const summerLocal = loadLocalTermSchedule("202605");

      let remotePlans: Awaited<ReturnType<typeof fetchAllDegreePlans>> = [];
      let dbState: Awaited<
        ReturnType<typeof loadUserScheduleHydrationFromDb>
      > | null = null;
      let dbCompleted: string[] = [];
      let dbFallCodes: string[] = [];
      let dbWinterCodes: string[] = [];

      if (user?.email) {
        try {
          const [plansRes, hydrationRes] = await Promise.all([
            fetchAllDegreePlans(supabase, user.email),
            loadUserScheduleHydrationFromDb(
              supabase,
              user.id,
              activeTerm,
              courseMap,
            ),
          ]);
          remotePlans = plansRes;
          dbState = hydrationRes;
          dbCompleted = hydrationRes.completedCourses;
          dbFallCodes = hydrationRes.fallCodes;
          dbWinterCodes = hydrationRes.winterCodes;
        } catch (err) {
          console.error("Failed to hydrate remote student schedule:", err);
        }
      }

      if (cancelled) return;

      const planOptions = extractAllDegreePlansForTerm(remotePlans, termInfo);
      setDegreePlanOptions(planOptions);
      const savedPlanId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_DEGREE_PLAN_STORAGE_KEY)
          : null;
      const primaryPlanForPrereqs =
        (savedPlanId
          ? planOptions.find(
              (p) => p.id === savedPlanId || p.programId === savedPlanId,
            )
          : undefined) ??
        planOptions.find((p) => p.termCourseCodes.length > 0) ??
        planOptions.find(
          (p) =>
            p.fallTermCourseCodes.length > 0 ||
            p.winterTermCourseCodes.length > 0,
        ) ??
        planOptions.find((p) => p.completedPriorCourseCodes.length > 0);

      // Optionally load program elective buckets from the active Degree Plan
      const latestProgId = remotePlans[0]?.program_id;
      if (latestProgId) {
        fetch(`/api/degree-planner/programs/${encodeURIComponent(latestProgId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((detail: DegreeProgramDetail | null) => {
            if (cancelled || !detail) return;
            const model = buildModel(detail);
            const seenKeys = new Set<string>();
            const buckets: Array<{
              id: string;
              label: string;
              match: ElectiveMatch;
            }> = [];
            for (const b of [...model.buckets, ...model.breadth]) {
              if (!b.label || b.label === "Elective") continue;
              const m = b.match;
              const hasConstraint =
                Boolean(m.subjects?.length) ||
                Boolean(m.exclude_subjects?.length) ||
                Boolean(m.faculties?.length) ||
                Boolean(m.exclude_faculties?.length) ||
                m.min_level != null ||
                m.max_level != null;
              if (!hasConstraint || seenKeys.has(b.key)) continue;
              seenKeys.add(b.key);
              buckets.push({ id: b.key, label: b.label, match: m });
            }
            setProgramElectives(buckets);
          })
          .catch(() => {});
      }

      const fallLocalCodes = (fallLocal?.plannedCourses ?? [])
        .map((c) => c.courseCode.trim().toUpperCase())
        .filter(Boolean);
      const winterLocalCodes = (winterLocal?.plannedCourses ?? [])
        .map((c) => c.courseCode.trim().toUpperCase())
        .filter(Boolean);

      const fallCodes = [
        ...new Set([
          ...dbFallCodes,
          ...fallLocalCodes,
          ...(primaryPlanForPrereqs?.fallTermCourseCodes ?? []),
        ]),
      ];
      const winterCodes = [
        ...new Set([
          ...dbWinterCodes,
          ...winterLocalCodes,
          ...(primaryPlanForPrereqs?.winterTermCourseCodes ?? []),
        ]),
      ];

      setTermPlannedCodesMap((prev) => ({
        ...prev,
        "202609": [...new Set([...(prev["202609"] ?? []), ...fallCodes])],
        "202701": [...new Set([...(prev["202701"] ?? []), ...winterCodes])],
      }));

      const fallWinterSet = new Set([...fallCodes, ...winterCodes]);
      const mergedCompleted = [
        ...new Set([
          ...[
            ...(local?.completedCourses ?? []),
            ...(fallLocal?.completedCourses ?? []),
            ...(winterLocal?.completedCourses ?? []),
            ...(summerLocal?.completedCourses ?? []),
          ]
            .map((c) => c.trim().toUpperCase())
            .filter((c) => c && !fallWinterSet.has(c)),
          ...(primaryPlanForPrereqs?.completedPriorCourseCodes ?? []),
          ...dbCompleted,
        ]),
      ].sort();
      setCompletedCourses(mergedCompleted);

      const localExploring = (local?.plannedCourses ?? []).filter(
        (c) => c.mode === "exploring",
      );

      let nextPlanned: PlannedCourseEntry[] = [];
      let nextBlocked: BlockedTimeSlot[] = [];
      let nextCustom: ScheduleBlock[] = [];

      if (dbState?.hasAnyRows) {
        const hydratedDbCourses = dbState.plannedCourses.map((entry) => {
          const course = courseMap.get(entry.courseCode);
          if (!course) return entry;
          return {
            ...entry,
            selectedCrns: {
              ...getSingleSectionCrnsForCourse(course),
              ...entry.selectedCrns,
            },
          };
        });

        // Keep local exploring courses alongside DB planned courses
        const officialCodes = new Set(
          hydratedDbCourses.map((c) => c.courseCode),
        );
        nextPlanned = [
          ...hydratedDbCourses,
          ...localExploring.filter((e) => !officialCodes.has(e.courseCode)),
        ];
        nextBlocked = dbState.blockedSlots;
        nextCustom = dbState.customBlocks;
        setSyncStatus("saved");
      } else if (
        local &&
        (local.plannedCourses.length > 0 ||
          local.blockedSlots.length > 0 ||
          local.customBlocks.length > 0)
      ) {
        nextPlanned = local.plannedCourses;
        nextBlocked = local.blockedSlots;
        nextCustom = local.customBlocks;
        setSyncStatus("local");
        if (user) {
          // Promote guest local schedule up to DB on sign-in
          userDirtyRef.current = true;
        }
      }

      setPlannedCourses(nextPlanned);
      setBlockedSlots(mergeBlockedSlots(nextBlocked));
      setCustomBlocks(nextCustom);
      hydratedKeyRef.current = hydrationKey;
      setHydratedKey(hydrationKey);
    }

    void hydrate();

  return () => {
      cancelled = true;
    };
  }, [activeTerm, authReady, user, terms, supabase, courseMap]);

  // Persist changes to localStorage + Supabase (debounced)
  useEffect(() => {
    const hydrationKey = `${activeTerm}:${user?.id ?? "guest"}`;
    if (hydratedKeyRef.current !== hydrationKey) return;
    if (!userDirtyRef.current) return;

    saveLocalTermSchedule(activeTerm, {
      plannedCourses,
      blockedSlots,
      customBlocks,
      completedCourses,
    });

    if (!user) {
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const currentUserId = user.id;
    const termToSave = activeTerm;

    saveTimerRef.current = setTimeout(() => {
      setSyncStatus("saving");
      syncUserTermScheduleToDb(
        supabase,
        currentUserId,
        termToSave,
        plannedCourses,
        blockedSlots,
        customBlocks,
      )
        .then(() => {
          setSyncStatus("saved");
        })
        .catch((err) => {
          console.error("Failed to sync schedule to Supabase:", err);
          setSyncStatus("error");
        });
    }, 600);

  return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    activeTerm,
    user,
    supabase,
    plannedCourses,
    blockedSlots,
    customBlocks,
    completedCourses,
  ]);

  const handleTermChange = async (nextTerm: string) => {
    if (nextTerm === activeTerm) return;
    setHoverPreviewSection(null);
    setGridSectionPickers([]);
    setHiddenUnplannedCodes(new Set());
    setDismissedTempCompleted(new Set());
    setImportMenuOpen(false);

    const activePlannedCodes = plannedCourses
      .map((c) => c.courseCode.trim().toUpperCase())
      .filter(Boolean);
    setTermPlannedCodesMap((prev) => ({
      ...prev,
      [activeTerm]: [
        ...new Set([...(prev[activeTerm] ?? []), ...activePlannedCodes]),
      ],
    }));

    if (userDirtyRef.current) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveLocalTermSchedule(activeTerm, {
        plannedCourses,
        blockedSlots,
        customBlocks,
        completedCourses,
      });
      if (user) {
        try {
          await syncUserTermScheduleToDb(
            supabase,
            user.id,
            activeTerm,
            plannedCourses,
            blockedSlots,
            customBlocks,
          );
        } catch (err) {
          console.error("Failed to flush schedule before term change:", err);
        }
      }
    }

    const cached = catalogCacheRef.current.get(nextTerm);
    if (cached) {
      setCatalog(cached);
      setActiveTerm(nextTerm);
      return;
    }

    setLoadingTerm(true);
    try {
      const res = await fetch(
        `/api/course-schedules/catalog?term=${encodeURIComponent(nextTerm)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextCatalog = (await res.json()) as TermScheduleCatalog;
      catalogCacheRef.current.set(nextTerm, nextCatalog);
      setCatalog(nextCatalog);
      setActiveTerm(nextTerm);
    } catch {
      showToast("Failed to load semester courses.");
    } finally {
      setLoadingTerm(false);
    }
  };

  const temporaryPriorCourseCodes = useMemo(() => {
    const activePlannedCodes = plannedCourses
      .map((c) => c.courseCode.trim().toUpperCase())
      .filter(Boolean);
    const fallCodes =
      activeTerm === "202609"
        ? [
            ...new Set([
              ...(termPlannedCodesMap["202609"] ?? []),
              ...activePlannedCodes,
            ]),
          ]
        : (termPlannedCodesMap["202609"] ?? []);
    const winterCodes =
      activeTerm === "202701"
        ? [
            ...new Set([
              ...(termPlannedCodesMap["202701"] ?? []),
              ...activePlannedCodes,
            ]),
          ]
        : (termPlannedCodesMap["202701"] ?? []);

    let raw: string[] = [];
    if (activeTerm === "202701") {
      raw = fallCodes;
    } else if (activeTerm === "202605") {
      raw = [...new Set([...fallCodes, ...winterCodes])];
    }
    return raw.filter((c) => !dismissedTempCompleted.has(c));
  }, [activeTerm, plannedCourses, termPlannedCodesMap, dismissedTempCompleted]);

  const effectiveCompletedCourses = useMemo(
    () =>
      [
        ...new Set([...completedCourses, ...temporaryPriorCourseCodes]),
      ].sort(),
    [completedCourses, temporaryPriorCourseCodes],
  );

  // Expanded completed courses set (including formerly_codes equivalence)
  const expandedCompletedSet = useMemo(() => {
    const base = new Set(
      effectiveCompletedCourses.map((c) => c.trim().toUpperCase()),
    );
    const equivAdj = new Map<string, Set<string>>();
    for (const c of catalog.courses) {
      for (const f of c.formerlyCodes) {
        const former = f.trim().toUpperCase();
        if (!former || former === c.courseCode) continue;
        if (!equivAdj.has(c.courseCode)) equivAdj.set(c.courseCode, new Set());
        if (!equivAdj.has(former)) equivAdj.set(former, new Set());
        equivAdj.get(c.courseCode)!.add(former);
        equivAdj.get(former)!.add(c.courseCode);
      }
    }
    const expanded = new Set(base);
    for (const code of base) {
      for (const peer of equivAdj.get(code) ?? []) {
        expanded.add(peer);
      }
    }
    return expanded;
  }, [effectiveCompletedCourses, catalog.courses]);

  // Build active schedule blocks + async sections summary
  const {
    rawScheduleBlocks,
    annotatedBlocks,
    asyncCoursesSummary,
    activeCrns,
    totalPlannedCredits,
    conflictCount,
  } = useMemo(() => {
    const blocks: ScheduleBlock[] = [...customBlocks];
    const asyncList: Array<{
      courseCode: string;
      component: string;
      crn: string;
      mode: "planned" | "exploring";
    }> = [];
    const crns: string[] = [];
    let plannedCredits = 0;

    for (const entry of plannedCourses) {
      if (entry.hidden) continue;
      const course = courseMap.get(entry.courseCode);
      if (entry.mode === "planned") {
        plannedCredits += course?.creditHours ?? 3;
      }
      if (!course) continue;

      for (const crn of Object.values(entry.selectedCrns)) {
        if (!crn) continue;
        crns.push(crn);
        const sec = course.sections.find((s) => s.crn === crn);
        if (!sec) continue;
        if (sec.meetings.length === 0) {
          asyncList.push({
            courseCode: entry.courseCode,
            component: sec.component,
            crn: sec.crn,
            mode: entry.mode,
          });
          continue;
        }
        blocks.push(
          ...convertScheduleSectionToBlocks(sec, entry.color, entry.mode),
        );
      }
    }

    const baseAnnotated = annotateScheduleConflicts(blocks, blockedSlots);
    const conflicts = baseAnnotated.filter((b) => b.isConflict).length;

    let gridAnnotated = baseAnnotated;
    if (hoverPreviewSection) {
      const gridBlocks = blocks.filter(
        (b) =>
          !(
            b.courseCode === hoverPreviewSection.courseCode &&
            b.component === hoverPreviewSection.component
          ),
      );
      const previewColor =
        plannedCourses.find(
          (p) => p.courseCode === hoverPreviewSection.courseCode,
        )?.color ?? "blue";
      gridAnnotated = [
        ...annotateScheduleConflicts(gridBlocks, blockedSlots),
        ...convertScheduleSectionToBlocks(
          hoverPreviewSection,
          previewColor,
          "preview",
        ),
      ];
    }

    return {
      rawScheduleBlocks: blocks,
      annotatedBlocks: gridAnnotated,
      asyncCoursesSummary: asyncList,
      activeCrns: [...new Set(crns)].sort(),
      totalPlannedCredits: plannedCredits,
      conflictCount: conflicts,
    };
  }, [
    plannedCourses,
    customBlocks,
    blockedSlots,
    courseMap,
    hoverPreviewSection,
  ]);

  const hiddenCourseCodes = useMemo(() => {
    const set = new Set<string>(hiddenUnplannedCodes);
    for (const entry of plannedCourses) {
      if (entry.hidden) set.add(entry.courseCode);
    }
    return set;
  }, [plannedCourses, hiddenUnplannedCodes]);

  const handleChangeGridSectionPickers = useCallback(
    (
      updater:
        | SectionGridPickerTarget[]
        | ((prev: SectionGridPickerTarget[]) => SectionGridPickerTarget[]),
      switchMobileOnAdd = false,
    ) => {
      setHoverPreviewSection(null);
      const next =
        typeof updater === "function" ? updater(gridSectionPickers) : updater;
      const nextCodes = new Set(next.map((t) => t.courseCode));
      setHiddenUnplannedCodes((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const filtered = new Set<string>();
        for (const code of prev) {
          if (nextCodes.has(code)) filtered.add(code);
          else changed = true;
        }
        return changed ? filtered : prev;
      });
      if (switchMobileOnAdd && next.length > gridSectionPickers.length) {
        setMobileTab("schedule");
      }
      setGridSectionPickers(next);
    },
    [gridSectionPickers],
  );

  const clearUnplannedHidden = useCallback((courseCode: string) => {
    setHiddenUnplannedCodes((prev) => {
      if (!prev.has(courseCode)) return prev;
      const next = new Set(prev);
      next.delete(courseCode);
      return next;
    });
  }, []);

  const markDirty = useCallback(() => {
    userDirtyRef.current = true;
    setSyncStatus(user ? "saving" : "local");
  }, [user]);

  const pushUndoSnapshot = useCallback(() => {
    undoStackRef.current.push({
      plannedCourses: plannedCoursesRef.current,
      gridSectionPickers: gridSectionPickersRef.current,
      customBlocks: customBlocksRef.current,
      blockedSlots: blockedSlotsRef.current,
    });
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, []);

  const handleAddCourse = useCallback(
    (
      courseCode: string,
      mode: "planned" | "exploring",
      preferredCrns?: Record<string, string>,
    ) => {
      const course = courseMap.get(courseCode);
      if (!course) return;

      const pickedCombo = {
        ...getSingleSectionCrnsForCourse(course),
        ...(preferredCrns ?? {}),
      };

      pushUndoSnapshot();
      markDirty();
      clearUnplannedHidden(courseCode);
      setPlannedCourses((prev) => {
        const existingIdx = prev.findIndex((p) => p.courseCode === courseCode);
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = {
            ...next[existingIdx],
            mode,
            hidden: false,
            selectedCrns: {
              ...next[existingIdx].selectedCrns,
              ...pickedCombo,
            },
          };
          return next;
        }
        const nextColor =
          COURSE_COLOR_PALETTE[prev.length % COURSE_COLOR_PALETTE.length];
        return [
          ...prev,
          {
            courseCode,
            mode,
            selectedCrns: pickedCombo,
            color: nextColor,
          },
        ];
      });

      showToast(
        mode === "exploring"
          ? `Exploring ${courseCode} (not officially added)`
          : `Added ${courseCode} to your schedule`,
      );
    },
    [courseMap, markDirty, pushUndoSnapshot, clearUnplannedHidden, showToast],
  );

  const applySectionSelection = useCallback(
    (
      courseCode: string,
      component: CourseComponentType,
      crn: string,
      forceSelect = false,
    ) => {
      pushUndoSnapshot();
      markDirty();
      clearUnplannedHidden(courseCode);
      setHoverPreviewSection(null);
      setPlannedCourses((prev) => {
        const existing = prev.find((entry) => entry.courseCode === courseCode);
        if (existing) {
          const isAlreadySelected = existing.selectedCrns[component] === crn;
          const nextCrns = { ...existing.selectedCrns };
          if (isAlreadySelected && !forceSelect) {
            delete nextCrns[component];
          } else {
            nextCrns[component] = crn;
          }
          return prev.map((entry) =>
            entry.courseCode === courseCode
              ? {
                  ...entry,
                  hidden: false,
                  selectedCrns: nextCrns,
                }
              : entry,
          );
        }
        const course = courseMap.get(courseCode);
        const baseCrns = course ? getSingleSectionCrnsForCourse(course) : {};
        const nextColor =
          COURSE_COLOR_PALETTE[prev.length % COURSE_COLOR_PALETTE.length];
        return [
          ...prev,
          {
            courseCode,
            mode: "planned",
            selectedCrns: { ...baseCrns, [component]: crn },
            color: nextColor,
          },
        ];
      });
    },
    [courseMap, markDirty, pushUndoSnapshot, clearUnplannedHidden],
  );

  const handleSelectSection = useCallback(
    (courseCode: string, component: CourseComponentType, crn: string) => {
      if (!isEditMode) return;
      applySectionSelection(courseCode, component, crn, false);
    },
    [isEditMode, applySectionSelection],
  );

  const handleEnableEditModeAndSelectSection = useCallback(
    (courseCode: string, component: CourseComponentType, crn: string) => {
      setIsEditMode(true);
      applySectionSelection(courseCode, component, crn, true);
      showToast(`Switched to Edit Mode and added ${courseCode} (${crn})`);
    },
    [applySectionSelection, showToast],
  );

  const handleRemoveCourse = useCallback(
    (courseCode: string) => {
      pushUndoSnapshot();
      markDirty();
      setGridSectionPickers((prev) =>
        prev.filter((t) => t.courseCode !== courseCode),
      );
      clearUnplannedHidden(courseCode);
      setPlannedCourses((prev) =>
        prev.filter((entry) => entry.courseCode !== courseCode),
      );
    },
    [markDirty, pushUndoSnapshot, clearUnplannedHidden],
  );

  useEffect(() => {
    if (!isEditMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.key.toLowerCase() !== "z") return;

      if (e.shiftKey) {
        const next = redoStackRef.current.pop();
        if (!next) return;
        e.preventDefault();
        undoStackRef.current.push({
          plannedCourses: plannedCoursesRef.current,
          gridSectionPickers: gridSectionPickersRef.current,
          customBlocks: customBlocksRef.current,
          blockedSlots: blockedSlotsRef.current,
        });
        markDirty();
        setPlannedCourses(next.plannedCourses);
        setGridSectionPickers(next.gridSectionPickers);
        setCustomBlocks(next.customBlocks);
        setBlockedSlots(next.blockedSlots);
        showToast("Redid schedule change");
      } else {
        const prev = undoStackRef.current.pop();
        if (!prev) return;
        e.preventDefault();
        redoStackRef.current.push({
          plannedCourses: plannedCoursesRef.current,
          gridSectionPickers: gridSectionPickersRef.current,
          customBlocks: customBlocksRef.current,
          blockedSlots: blockedSlotsRef.current,
        });
        markDirty();
        setPlannedCourses(prev.plannedCourses);
        setGridSectionPickers(prev.gridSectionPickers);
        setCustomBlocks(prev.customBlocks);
        setBlockedSlots(prev.blockedSlots);
        showToast("Undid last change");
      }
    };
    window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditMode, markDirty, showToast]);

  const handleSetCourseMode = useCallback(
    (courseCode: string, mode: "planned" | "exploring") => {
      markDirty();
      setPlannedCourses((prev) =>
        prev.map((entry) =>
          entry.courseCode === courseCode ? { ...entry, mode } : entry,
        ),
      );
      showToast(
        mode === "planned"
          ? `${courseCode} moved to official Planned schedule`
          : `${courseCode} moved to Exploring (removed from DB save)`,
      );
    },
    [markDirty, showToast],
  );

  const handleToggleCourseVisibility = useCallback(
    (courseCode: string) => {
      setHoverPreviewSection(null);
      const isPlanned = plannedCourses.some(
        (entry) => entry.courseCode === courseCode,
      );
      if (isPlanned) {
        if (isEditMode) markDirty();
        setPlannedCourses((prev) =>
          prev.map((entry) =>
            entry.courseCode === courseCode
              ? { ...entry, hidden: !entry.hidden }
              : entry,
          ),
        );
        return;
      }
      setHiddenUnplannedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(courseCode)) next.delete(courseCode);
        else next.add(courseCode);
        return next;
      });
    },
    [plannedCourses, isEditMode, markDirty],
  );

  const handleToggleAllCoursesVisibility = useCallback(() => {
    if (plannedCourses.length === 0) return;
    setHoverPreviewSection(null);
    if (isEditMode) markDirty();
    const allHidden = plannedCourses.every((c) => c.hidden);
    setPlannedCourses((prev) =>
      prev.map((entry) => ({ ...entry, hidden: !allHidden })),
    );
  }, [plannedCourses, isEditMode, markDirty]);

  const handleChangeCourseColor = useCallback(
    (courseCode: string, color: ColorTheme) => {
      markDirty();
      setPlannedCourses((prev) =>
        prev.map((entry) =>
          entry.courseCode === courseCode ? { ...entry, color } : entry,
        ),
      );
    },
    [markDirty],
  );

  const handleAutoFitAll = useCallback(() => {
    const fitted = autoFitPlannedCourses(
      plannedCourses,
      courseMap,
      blockedSlots,
      customBlocks,
    );
    if (!fitted) {
      showToast(
        "No conflict-free combination exists across all courses with current blocked times.",
      );
      return;
    }
    pushUndoSnapshot();
    markDirty();
    setPlannedCourses((prev) =>
      prev.map((entry) =>
        fitted[entry.courseCode]
          ? { ...entry, selectedCrns: fitted[entry.courseCode] }
          : entry,
      ),
    );
    showToast("Updated Lecture/Lab/Tutorial sections with zero conflicts.");
  }, [
    plannedCourses,
    courseMap,
    blockedSlots,
    customBlocks,
    pushUndoSnapshot,
    markDirty,
    showToast,
  ]);

  const handleRemoveBlockFromGrid = useCallback(
    (block: ScheduleBlock) => {
      markDirty();
      if (block.isCustom) {
        setCustomBlocks((prev) => prev.filter((b) => b.id !== block.id));
        return;
      }
      const comp =
        block.component ?? (block.type as CourseComponentType | undefined);
      setPlannedCourses((prev) =>
        prev.flatMap((entry) => {
          if (entry.courseCode !== block.courseCode) return [entry];
          if (!comp) return [];
          const nextCrns = { ...entry.selectedCrns };
          delete nextCrns[comp];
          if (Object.keys(nextCrns).length === 0) return [];
          return [{ ...entry, selectedCrns: nextCrns }];
        }),
      );
      showToast(
        `Removed ${block.courseCode}${comp ? ` (${comp})` : ""} from schedule`,
      );
    },
    [markDirty, showToast],
  );

  const handleAddCustomBlock = useCallback(
    (block: ScheduleBlock) => {
      markDirty();
      setCustomBlocks((prev) => [...prev, block]);
    },
    [markDirty],
  );

  const handleRemoveCustomBlock = useCallback(
    (id: string) => {
      markDirty();
      setCustomBlocks((prev) => prev.filter((b) => b.id !== id));
    },
    [markDirty],
  );

  const handleClearCustomBlocks = useCallback(() => {
    markDirty();
    setCustomBlocks([]);
  }, [markDirty]);

  const handleUpdateCustomBlocks = useCallback(
    (updater: (prev: ScheduleBlock[]) => ScheduleBlock[]) => {
      markDirty();
      setCustomBlocks((prev) => updater(prev));
    },
    [markDirty],
  );

  const handleCreateCustomBlocksFromDrag = useCallback(
    (days: DayOfWeek[], startTime: string, endTime: string) => {
      markDirty();
      const code = customBlockDraft.courseCode.trim().toUpperCase() || "CUSTOM";
      const title = customBlockDraft.title.trim() || code;
      const room = customBlockDraft.room?.trim() || undefined;
      const now = Date.now();
      const created: ScheduleBlock[] = days.map((day, idx) => ({
        id: `custom-${day}-${startTime}-${now}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        courseCode: code,
        title,
        type: "CUSTOM",
        day,
        startTime,
        endTime,
        room,
        weekPattern: customBlockDraft.weekPattern,
        mode: "planned",
        color: customBlockDraft.color,
        isCustom: true,
      }));
      setCustomBlocks((prev) => [...prev, ...created]);
    },
    [customBlockDraft, markDirty],
  );

  const handleUpdateBlockedSlots = useCallback(
    (updater: (prev: BlockedTimeSlot[]) => BlockedTimeSlot[]) => {
      markDirty();
      setBlockedSlots((prev) => mergeBlockedSlots(updater(prev)));
    },
    [markDirty],
  );

  const handleCreateBlockedSlot = useCallback(
    (day: DayOfWeek, startTime: string, endTime: string, label = "Blocked") => {
      markDirty();
      setBlockedSlots((prev) =>
        mergeBlockedSlots([
          ...prev,
          {
            id: `blk-${day}-${startTime}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            day,
            startTime,
            endTime,
            label,
          },
        ]),
      );
    },
    [markDirty],
  );

  const handleApplyBlockPreset = (
    preset: (typeof TIME_BLOCK_PRESETS)[number],
  ) => {
    markDirty();
    setBlockedSlots((prev) =>
      mergeBlockedSlots([
        ...prev,
        ...preset.slots.map((s, idx) => ({
          id: `blk-${preset.id}-${s.day}-${Date.now()}-${idx}`,
          ...s,
        })),
      ]),
    );
    setBlockMenuOpen(false);
    showToast(`Added "${preset.label}" time block`);
  };

  const handleRemoveBlockedSlot = useCallback(
    (id: string) => {
      markDirty();
      setBlockedSlots((prev) => prev.filter((s) => s.id !== id));
    },
    [markDirty],
  );

  const handleClearSchedule = useCallback(() => {
    pushUndoSnapshot();
    markDirty();
    setPlannedCourses([]);
    setCustomBlocks([]);
    setBlockedSlots([]);
    setHoverPreviewSection(null);
    setGridSectionPickers([]);
    setHiddenUnplannedCodes(new Set());
    setDismissedTempCompleted(new Set());
    setTermPlannedCodesMap((prev) => ({ ...prev, [activeTerm]: [] }));
    showToast("Cleared schedule and blocked times.");
  }, [activeTerm, pushUndoSnapshot, markDirty, showToast]);

  const handleClearPlanner = useCallback(() => {
    pushUndoSnapshot();
    markDirty();
    setPlannedCourses([]);
    setCustomBlocks([]);
    setHoverPreviewSection(null);
    setGridSectionPickers([]);
    setHiddenUnplannedCodes(new Set());
    setDismissedTempCompleted(new Set());
    setTermPlannedCodesMap((prev) => ({ ...prev, [activeTerm]: [] }));
    showToast("Cleared all courses from planner.");
  }, [activeTerm, pushUndoSnapshot, markDirty, showToast]);

  const handleImportFromDegreePlan = (plan: DegreePlanImportOption) => {
    setImportMenuOpen(false);
    markDirty();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ACTIVE_DEGREE_PLAN_STORAGE_KEY, plan.id);
      } catch {
        // Ignore storage quota errors
      }
    }

    if (plan.completedPriorCourseCodes.length > 0) {
      setCompletedCourses((prev) =>
        [...new Set([...prev, ...plan.completedPriorCourseCodes])].sort(),
      );
    }
    setTermPlannedCodesMap((prev) => ({
      ...prev,
      "202609": [
        ...new Set([...(prev["202609"] ?? []), ...plan.fallTermCourseCodes]),
      ],
      "202701": [
        ...new Set([...(prev["202701"] ?? []), ...plan.winterTermCourseCodes]),
      ],
    }));

    if (plan.termCourseCodes.length === 0) {
      showToast(
        `Imported completed prerequisite courses from ${plan.label} (no courses scheduled for ${catalog.termLabel}).`,
      );
      return;
    }

    const existingSet = new Set(plannedCourses.map((c) => c.courseCode));
    const newCodes = plan.termCourseCodes.filter(
      (c) => !existingSet.has(c.trim().toUpperCase()),
    );
    const imported = buildEntriesFromCourseCodes(
      newCodes,
      plannedCourses.length,
    );

    if (imported.length === 0) {
      showToast(
        newCodes.length === 0
          ? `Synced prerequisite courses from "${plan.label}" (all ${catalog.termLabel} courses already added).`
          : `Synced prerequisite courses from "${plan.label}" (no matching offerings in ${catalog.termLabel}).`,
      );
      return;
    }

    setPlannedCourses((prev) => [...prev, ...imported]);

    showToast(
      `Imported ${imported.length} course${imported.length === 1 ? "" : "s"} and prerequisites from ${plan.label}`,
    );
  };

  const handleAddCompletedCourse = useCallback(
    (code: string) => {
      markDirty();
      setDismissedTempCompleted((prev) => {
        if (!prev.has(code)) return prev;
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
      setCompletedCourses((prev) =>
        prev.includes(code) ? prev : [...prev, code].sort(),
      );
    },
    [markDirty],
  );

  const handleRemoveCompletedCourse = useCallback(
    (code: string) => {
      markDirty();
      if (temporaryPriorCourseCodes.includes(code)) {
        setDismissedTempCompleted((prev) => new Set(prev).add(code));
      }
      setCompletedCourses((prev) => prev.filter((c) => c !== code));
    },
    [markDirty, temporaryPriorCourseCodes],
  );

  const hasBiweeklyClass = useMemo(() => {
    if (annotatedBlocks.some((b) => b.weekPattern !== "both")) return true;
    for (const target of gridSectionPickers) {
      const course = courseMap.get(target.courseCode);
      if (!course) continue;
      if (
        course.sections.some((sec) =>
          sec.meetings.some((m) => m.weekPattern !== "both"),
        )
      ) {
        return true;
      }
    }
    return false;
  }, [annotatedBlocks, gridSectionPickers, courseMap]);

  const effectiveViewMode: ScheduleViewMode = hasBiweeklyClass
    ? viewMode
    : "combined";

  return (
    <div className="space-y-4">
      {/* Mobile 2-Tab Bar (< lg) */}
      <div className="grid grid-cols-2 rounded-2xl border border-slate-200/80 bg-white/85 p-1 text-xs font-semibold shadow-[0_1px_4px_rgba(15,23,42,0.03)] backdrop-blur-sm lg:hidden dark:border-slate-800/80 dark:bg-slate-900/85">
        <button
          type="button"
          onClick={() => setMobileTab("schedule")}
          className={`rounded-xl py-2 transition ${
            mobileTab === "schedule"
              ? "bg-sky-600 text-white shadow-xs dark:bg-sky-500"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          Schedule ({plannedCourses.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileTab("lookup");
            setLookupTabTrigger((n) => n + 1);
          }}
          className={`rounded-xl py-2 transition ${
            mobileTab === "lookup"
              ? "bg-sky-600 text-white shadow-xs dark:bg-sky-500"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          Course Lookup &amp; Explore
        </button>
      </div>

      {/* Main 2/3 Left Schedule + 1/3 Right Course Lookup Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Left 2/3: Schedule & Controls */}
        <section
          className={`space-y-3.5 lg:col-span-8 ${
            mobileTab === "schedule" ? "block" : "hidden lg:block"
          }`}
        >
          {/* Control Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/80 bg-white/88 p-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)] backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/85">
            <div className="flex flex-wrap items-center gap-2">
              {/* Semester Selector */}
              <select
                value={activeTerm}
                disabled={loadingTerm}
                onChange={(e) => void handleTermChange(e.target.value)}
                aria-label="Select semester"
                className="rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 focus:outline-none disabled:opacity-60 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-100"
              >
                {terms.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>

              {/* View Mode Switcher (Combined, Week 1, Week 2 only when biweekly classes exist) */}
              {hasBiweeklyClass && (
                <div className="inline-flex rounded-xl border border-slate-200/90 bg-slate-100/75 p-0.5 text-xs font-medium dark:border-slate-700/80 dark:bg-slate-800/80">
                  {(
                    [
                      { id: "combined", label: "Combined" },
                      { id: "week1", label: "Week 1" },
                      { id: "week2", label: "Week 2" },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setViewMode(mode.id)}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        viewMode === mode.id
                          ? "bg-sky-600 text-white shadow-xs dark:bg-sky-500 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              )}

              {/* RateMyProfessors Star Toggle (off by default) */}
              <button
                type="button"
                onClick={() => setShowRmp((v) => !v)}
                aria-pressed={showRmp}
                title={
                  showRmp
                    ? "Hide RateMyProfessors ratings"
                    : "Show RateMyProfessors ratings"
                }
                aria-label="Toggle RateMyProfessors ratings"
                className={`inline-flex cursor-pointer items-center justify-center rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition ${
                  showRmp
                    ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/70 dark:text-amber-200"
                    : "border-slate-200/90 bg-white text-slate-500 hover:border-sky-300 hover:bg-sky-50/60 hover:text-sky-900 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-400 dark:hover:border-sky-700 dark:hover:text-slate-200"
                }`}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 shrink-0 transition-colors ${
                    showRmp
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Edit Schedule Toggle */}
              <button
                type="button"
                aria-pressed={isEditMode}
                aria-label={isEditMode ? "Done editing" : "Edit schedule"}
                title={
                  isEditMode
                    ? "Done editing schedule"
                    : "Edit schedule"
                }
                onClick={() => {
                  setIsEditMode((prev) => {
                    const next = !prev;
                    if (!next) {
                      setIsBlockingMode(false);
                      setIsCustomBlockDragMode(false);
                      setBlockMenuOpen(false);
                      setImportMenuOpen(false);
                    }
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-xs transition ${
                  isEditMode
                    ? "border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600 dark:border-orange-500 dark:bg-orange-500 dark:hover:bg-orange-600"
                    : "border-slate-200/90 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-900 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-100 dark:hover:border-sky-700 dark:hover:bg-slate-800"
                }`}
              >
                <span>{isEditMode ? "Done editing" : "Edit schedule"}</span>
              </button>

              {/* Calendar Export */}
              <button
                type="button"
                onClick={() => setIsCalendarModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600"
              >
                <span>Export / Sync Calendar</span>
              </button>
            </div>
          </div>

          {isEditMode && (
            <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* Block Times Menu */}
                  <div className="relative" ref={blockMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setImportMenuOpen(false);
                        setBlockMenuOpen((v) => !v);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition ${
                        isBlockingMode || blockedSlots.length > 0
                          ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                          : "border-slate-200/90 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span>Block Times</span>
                      {blockedSlots.length > 0 && (
                        <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                          {blockedSlots.length}
                        </span>
                      )}
                    </button>

                    {blockMenuOpen && (
                      <div className="absolute left-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200/90 bg-white/98 p-3 text-xs shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Block Off Unavailable Times
                          </span>
                          {blockedSlots.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                markDirty();
                                setBlockedSlots([]);
                              }}
                              className="text-[11px] text-rose-600 hover:underline"
                            >
                              Clear all
                            </button>
                          )}
                        </div>

                        {/* Grid drag-to-block toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            setIsBlockingMode((v) => {
                              const next = !v;
                              if (next) setIsCustomBlockDragMode(false);
                              return next;
                            });
                            setBlockMenuOpen(false);
                          }}
                          className={`mt-2 w-full rounded-xl border px-2.5 py-1.5 text-left font-medium transition ${
                            isBlockingMode
                              ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          }`}
                        >
                          {isBlockingMode
                            ? "✓ Drag-to-Block Grid Mode Active"
                            : "🖱 Drag on Grid to Block Times"}
                        </button>

                        {/* Quick Presets */}
                        <div className="mt-2.5 space-y-1">
                          <p className="text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                            Quick Presets
                          </p>
                          {TIME_BLOCK_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handleApplyBlockPreset(preset)}
                              className="block w-full rounded-lg px-2 py-1 text-left text-slate-700 transition-colors hover:bg-sky-50/70 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              + {preset.label}
                            </button>
                          ))}
                        </div>

                        {/* Custom Time Block Form */}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleCreateBlockedSlot(
                              blkDay,
                              blkStart,
                              blkEnd,
                              blkLabel.trim() || "Blocked",
                            );
                            setBlockMenuOpen(false);
                          }}
                          className="mt-3 space-y-2 border-t border-slate-100 pt-2.5 dark:border-slate-800"
                        >
                          <p className="text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                            Custom Block
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              value={blkDay}
                              onChange={(e) =>
                                setBlkDay(e.target.value as DayOfWeek)
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            >
                              {DAYS_OF_WEEK.map((d) => (
                                <option key={d.key} value={d.key}>
                                  {d.fullLabel}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={blkLabel}
                              onChange={(e) => setBlkLabel(e.target.value)}
                              placeholder="Reason (e.g. Work)"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="time"
                              value={blkStart}
                              onChange={(e) => setBlkStart(e.target.value)}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                            <input
                              type="time"
                              value={blkEnd}
                              onChange={(e) => setBlkEnd(e.target.value)}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <button
                            type="submit"
                            className="w-full rounded-xl bg-rose-600 py-1.5 font-medium text-white transition-colors hover:bg-rose-700"
                          >
                            Add Time Block
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {isBlockingMode && (
                    <button
                      type="button"
                      onClick={() => setIsBlockingMode(false)}
                      className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
                    >
                      Done Blocking
                    </button>
                  )}

                  {isCustomBlockDragMode && (
                    <button
                      type="button"
                      onClick={() => setIsCustomBlockDragMode(false)}
                      className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
                    >
                      Done Custom Block
                    </button>
                  )}

                  {/* Import from Degree Plan Picker */}
                  {degreePlanOptions.length > 0 && (
                    <div className="relative" ref={importMenuRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setBlockMenuOpen(false);
                          setImportMenuOpen((v) => !v);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800"
                        title={`Choose a saved Degree Plan to import courses for ${catalog.termLabel}`}
                      >
                        <span>Import Degree Plan</span>
                        <span className="rounded-full bg-sky-100/85 px-1.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
                          {degreePlanOptions.length}
                        </span>
                      </button>

                      {importMenuOpen && (
                        <div className="absolute right-0 z-40 mt-2 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-2xl border border-slate-200/90 bg-white/98 shadow-xl shadow-slate-900/10 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900">
                          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Import Degree Plan ({degreePlanOptions.length})
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Pick a plan to import {catalog.termLabel} courses
                            </p>
                          </div>

                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {degreePlanOptions.map((plan) => (
                              <button
                                key={plan.id}
                                type="button"
                                onClick={() => handleImportFromDegreePlan(plan)}
                                className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-sky-50/60 dark:hover:bg-slate-800/70"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                    {plan.label}
                                  </span>
                                  <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                      plan.termCourseCodes.length > 0
                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                    }`}
                                  >
                                    {plan.termCourseCodes.length} in{" "}
                                    {catalog.termLabel}
                                  </span>
                                </div>

                                <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  {plan.catalogYear
                                    ? `${plan.catalogYear} plan · `
                                    : ""}
                                  Start {plan.startYear} · {plan.totalCourseCount}{" "}
                                  total{" "}
                                  {plan.totalCourseCount === 1
                                    ? "course"
                                    : "courses"}
                                </span>

                                <span className="line-clamp-2 text-[10.5px] text-slate-600 dark:text-slate-300">
                                  {plan.termCourseCodes.length > 0
                                    ? plan.termCourseCodes.join(", ")
                                    : `No courses scheduled for ${catalog.termLabel}`}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clear Schedule */}
                  <button
                    type="button"
                    onClick={handleClearSchedule}
                    disabled={
                      plannedCourses.length === 0 &&
                      customBlocks.length === 0 &&
                      blockedSlots.length === 0
                    }
                    className="rounded-xl border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900/60 dark:bg-slate-800/90 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    title="Clear all courses, custom blocks, and blocked times from this semester schedule"
                  >
                    Clear Schedule
                  </button>
            </div>
          )}

          {/* Status & Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3.5 py-2 text-xs shadow-[0_1px_4px_rgba(15,23,42,0.03)] backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/85">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {plannedCourses.filter((c) => c.mode === "planned").length}{" "}
                planned ({totalPlannedCredits} cr)
              </span>
              {plannedCourses.some((c) => c.mode === "exploring") && (
                <span className="rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  {plannedCourses.filter((c) => c.mode === "exploring").length}{" "}
                  exploring (tentative)
                </span>
              )}
              {conflictCount > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                  ⚠ {conflictCount} conflicting{" "}
                  {conflictCount === 1 ? "block" : "blocks"}
                </span>
              )}
              {(() => {
                const fullCourses = [
                  ...new Set(
                    annotatedBlocks
                      .filter((b) => b.isFull)
                      .map((b) => `${b.courseCode}${b.type ? ` (${b.type})` : ""}`),
                  ),
                ];
                if (fullCourses.length === 0) return null;
  return (
                  <span
                    title={`0 seats available: ${fullCourses.join(", ")}`}
                    className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  >
                    ⚠ {fullCourses.length}{" "}
                    {fullCourses.length === 1 ? "class" : "classes"} may be full
                  </span>
                );
              })()}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              {loadingTerm && <span>Loading {activeTerm}...</span>}
              {syncStatus === "saving" && <span>Saving to account...</span>}
              {syncStatus === "saved" && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ Saved to DB
                </span>
              )}
              {syncStatus === "local" && (
                <span>Saved locally (sign in for DB &amp; live sync)</span>
              )}
              {syncStatus === "error" && (
                <span className="text-rose-600">Sync error (saved locally)</span>
              )}
            </div>
          </div>

          {/* Async / Unscheduled Sections Bar */}
          {asyncCoursesSummary.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200/80 bg-teal-50/50 px-3.5 py-2 text-xs dark:border-teal-900/50 dark:bg-teal-950/20">
              <span className="font-semibold text-teal-800 dark:text-teal-300">
                Async / No Fixed Time:
              </span>
              {asyncCoursesSummary.map((item) => (
                <span
                  key={`${item.courseCode}-${item.crn}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                    item.mode === "exploring"
                      ? "border-dashed border-amber-400 bg-white text-amber-800 dark:bg-zinc-900 dark:text-amber-300"
                      : "border-teal-300 bg-white text-teal-900 dark:border-teal-800 dark:bg-zinc-900 dark:text-teal-200"
                  }`}
                >
                  <span>
                    {item.courseCode} ({item.component} · CRN {item.crn})
                  </span>
                  {isEditMode && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCourse(item.courseCode)}
                      className="text-zinc-400 hover:text-rose-600"
                      title={`Remove ${item.courseCode}`}
                    >
                      &times;
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Timetable Grid */}
          <WeekScheduleGrid
            viewMode={effectiveViewMode}
            title={
              effectiveViewMode === "combined"
                ? `${catalog.termLabel} Schedule`
                : effectiveViewMode === "week1"
                  ? `${catalog.termLabel} — Week 1`
                  : `${catalog.termLabel} — Week 2`
            }
            subtitle={
              effectiveViewMode === "combined"
                ? isEditMode
                  ? "Biweekly W1 (left) & W2 (right) side-by-side · Drag blocks to snap to other sections"
                  : "Biweekly W1 (left) and W2 (right) classes sit side-by-side"
                : effectiveViewMode === "week1"
                  ? "Odd Teaching Weeks"
                  : "Even Teaching Weeks"
            }
            accentColor={effectiveViewMode === "combined" ? "purple": effectiveViewMode === "week2" ? "red" : "blue"
            }
            courses={annotatedBlocks}
            blockedSlots={blockedSlots}
            courseMap={courseMap}
            gridSectionPickers={gridSectionPickers}
            onChangeGridSectionPickers={(updater) =>
              handleChangeGridSectionPickers(updater, false)
            }
            hiddenCourseCodes={hiddenCourseCodes}
            onToggleCourseVisibility={handleToggleCourseVisibility}
            isEditMode={isEditMode}
            showRmp={showRmp}
            fitToHeight={true}
            isBlockingMode={isBlockingMode}
            onCreateBlockedSlot={(d, s, e, l) =>
              handleCreateBlockedSlot(d, s, e, l)
            }
            onUpdateBlockedSlots={handleUpdateBlockedSlots}
            onRemoveBlockedSlot={handleRemoveBlockedSlot}
            onUpdateCustomBlocks={handleUpdateCustomBlocks}
            isCustomBlockDragMode={isCustomBlockDragMode}
            customBlockDraft={customBlockDraft}
            onCreateCustomBlocksFromDrag={handleCreateCustomBlocksFromDrag}
            onRemoveBlock={handleRemoveBlockFromGrid}
            onSelectSection={handleSelectSection}
            onEnableEditModeAndSelectSection={handleEnableEditModeAndSelectSection}
            onPromoteCourse={(code) => handleSetCourseMode(code, "planned")}
            onInspectCourse={(code) => {
              setFocusedCourseCode(code);
              setMobileTab("lookup");
            }}
          />

          {/* Active Blocked Times Pills */}
          {blockedSlots.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-[11px] shadow-[0_1px_4px_rgba(15,23,42,0.03)] dark:border-slate-800/80 dark:bg-slate-900/80">
              <span className="font-medium text-slate-500 dark:text-slate-400">
                Blocked Times:
              </span>
              {blockedSlots.map((slot) => (
                <span
                  key={slot.id}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                >
                  {slot.day.slice(0, 3).toUpperCase()}{" "}
                  {formatTimeDisplay(slot.startTime)}–
                  {formatTimeDisplay(slot.endTime)}
                  {slot.label && slot.label !== "Blocked"
                    ? ` (${slot.label})`
                    : ""}
                  {isEditMode && (
                    <button
                      type="button"
                      onClick={() => handleRemoveBlockedSlot(slot.id)}
                      className="ml-0.5 font-bold hover:text-rose-600"
                    >
                      &times;
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Right 1/3: Combined Course Lookup, Exploration & Section Planner */}
        <div
          className={`lg:col-span-4 lg:sticky lg:top-[calc(var(--site-nav-height,2.75rem)+5.25rem)] ${
            mobileTab === "lookup" ? "block" : "hidden lg:block"
          }`}
        >
          <CourseLookupPanel
            catalog={catalog}
            courseMap={courseMap}
            plannedCourses={plannedCourses}
            activeBlocks={rawScheduleBlocks}
            customBlocks={customBlocks}
            blockedSlots={blockedSlots}
            completedCourses={effectiveCompletedCourses}
            expandedCompletedSet={expandedCompletedSet}
            programElectives={programElectives}
            focusedCourseCode={focusedCourseCode}
            hydratedKey={hydratedKey}
            gridSectionPickers={gridSectionPickers}
            onChangeGridSectionPickers={(updater) =>
              handleChangeGridSectionPickers(updater, true)
            }
            isEditMode={isEditMode}
            onEnableEditMode={() => setIsEditMode(true)}
            onClearPlanner={handleClearPlanner}
            onClearFocus={() => setFocusedCourseCode(null)}
            onAddCourse={handleAddCourse}
            onSelectSection={handleSelectSection}
            onRemoveCourse={handleRemoveCourse}
            onSetCourseMode={handleSetCourseMode}
            onToggleCourseVisibility={handleToggleCourseVisibility}
            onToggleAllCoursesVisibility={handleToggleAllCoursesVisibility}
            onChangeCourseColor={handleChangeCourseColor}
            onAutoFitAll={handleAutoFitAll}
            onAddCustomBlock={handleAddCustomBlock}
            onRemoveCustomBlock={handleRemoveCustomBlock}
            onClearCustomBlocks={handleClearCustomBlocks}
            isCustomBlockDragMode={isCustomBlockDragMode}
            onToggleCustomBlockDragMode={() => {
              setIsCustomBlockDragMode((v) => {
                const next = !v;
                if (next) setIsBlockingMode(false);
                return next;
              });
            }}
            onCustomBlockDraftChange={setCustomBlockDraft}
            onAddCompletedCourse={handleAddCompletedCourse}
            onRemoveCompletedCourse={handleRemoveCompletedCourse}
            onHoverSection={setHoverPreviewSection}
            showRmp={showRmp}
            defaultYearOfStudy={userYearOfStudy}
            searchTabTrigger={lookupTabTrigger}
          />
        </div>
      </div>

      {/* Calendar Export Modal */}
      <CalendarExportModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        term={activeTerm}
        termLabel={catalog.termLabel}
        userId={user?.id ?? null}
        activeCrns={activeCrns}
      />

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl border border-sky-700/80 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-xl ring-1 ring-sky-400/20 dark:border-sky-800 dark:bg-slate-800">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
