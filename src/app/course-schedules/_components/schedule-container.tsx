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
  extractTermFromDegreePlans,
  loadLocalTermSchedule,
  loadUserTermScheduleFromDb,
  saveLocalTermSchedule,
  syncUserTermScheduleToDb,
} from "@/lib/schedule-storage";
import { createClient } from "@/lib/supabase/client";

import {
  COURSE_COLOR_PALETTE,
  DAYS_OF_WEEK,
  annotateScheduleConflicts,
  autoFitPlannedCourses,
  convertScheduleSectionToBlocks,
  findValidSectionComboForCourse,
  formatTimeDisplay,
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
  const [mobileTab, setMobileTab] = useState<"schedule" | "lookup">("schedule");
  const [fitToHeight, setFitToHeight] = useState(true);
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

  const [degreePlanImportInfo, setDegreePlanImportInfo] = useState<{
    sourceLabel: string | null;
    termCourseCodes: string[];
    priorCompleted: string[];
  }>({ sourceLabel: null, termCourseCodes: [], priorCompleted: [] });

  const [hoverPreviewSection, setHoverPreviewSection] =
    useState<ScheduleSection | null>(null);
  const [focusedCourseCode, setFocusedCourseCode] = useState<string | null>(
    null,
  );

  const [isBlockingMode, setIsBlockingMode] = useState(false);
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

  const hydratedKeyRef = useRef<string | null>(null);
  const userDirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockMenuRef = useRef<HTMLDivElement>(null);

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

  const courseMap = useMemo(() => {
    const map = new Map<string, ScheduleCourseGroup>();
    for (const c of catalog.courses) {
      map.set(c.courseCode, c);
    }
    return map;
  }, [catalog.courses]);

  const buildEntriesFromCourseCodes = useCallback(
    (
      codes: string[],
      currentBlocked: BlockedTimeSlot[],
      existingColorStart = 0,
    ): PlannedCourseEntry[] => {
      const seen = new Set<string>();
      const entries: PlannedCourseEntry[] = [];
      let colorIdx = existingColorStart;

      for (const raw of codes) {
        const code = raw.trim().toUpperCase();
        if (!code || seen.has(code) || !courseMap.has(code)) continue;
        seen.add(code);
        entries.push({
          courseCode: code,
          mode: "planned",
          selectedCrns: {},
          color: COURSE_COLOR_PALETTE[colorIdx % COURSE_COLOR_PALETTE.length],
        });
        colorIdx++;
      }

      if (entries.length === 0) return [];

      const fitted = autoFitPlannedCourses(entries, courseMap, currentBlocked);
      if (fitted) {
        return entries.map((e) => ({
          ...e,
          selectedCrns: fitted[e.courseCode] ?? {},
        }));
      }

      // Greedy per-course assignment if no global conflict-free combo exists
      let runningBlocks: ScheduleBlock[] = [];
      return entries.map((entry) => {
        const course = courseMap.get(entry.courseCode);
        if (!course) return entry;
        const combo =
          findValidSectionComboForCourse(course, runningBlocks, currentBlocked, {
            allowConflictingFallback: true,
          }) ?? {};
        for (const crn of Object.values(combo)) {
          const sec = course.sections.find((s) => s.crn === crn);
          if (sec) {
            runningBlocks = runningBlocks.concat(
              convertScheduleSectionToBlocks(sec, entry.color, "planned"),
            );
          }
        }
        return { ...entry, selectedCrns: combo };
      });
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

      let remotePlans: Awaited<ReturnType<typeof fetchAllDegreePlans>> = [];
      let dbState: Awaited<
        ReturnType<typeof loadUserTermScheduleFromDb>
      > | null = null;
      let dbCompleted: string[] = [];

      if (user?.email) {
        try {
          const [plansRes, schedRes, completedRes] = await Promise.all([
            fetchAllDegreePlans(supabase, user.email),
            loadUserTermScheduleFromDb(supabase, user.id, activeTerm, courseMap),
            supabase
              .from("student_courses")
              .select("course_code")
              .eq("user_id", user.id)
              .eq("status", "completed"),
          ]);
          remotePlans = plansRes;
          dbState = schedRes;
          dbCompleted = (completedRes.data ?? [])
            .map((r: { course_code: string }) =>
              r.course_code.trim().toUpperCase(),
            )
            .filter((c: string) => c && !c.startsWith("__"));
        } catch (err) {
          console.error("Failed to hydrate remote student schedule:", err);
        }
      }

      if (cancelled) return;

      const degInfo = extractTermFromDegreePlans(remotePlans, termInfo);
      setDegreePlanImportInfo({
        sourceLabel: degInfo.sourceLabel,
        termCourseCodes: degInfo.termCourseCodes,
        priorCompleted: degInfo.completedPriorCourseCodes,
      });

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

      const mergedCompleted = [
        ...new Set([
          ...(local?.completedCourses ?? []),
          ...degInfo.completedPriorCourseCodes,
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
        // Fill any missing CRNs on DB rows (e.g., rows imported from Degree Plan without CRNs)
        let runningBlocks: ScheduleBlock[] = [];
        const hydratedDbCourses = dbState.plannedCourses.map((entry) => {
          const course = courseMap.get(entry.courseCode);
          if (!course) return entry;
          const hasAllSelected =
            Object.keys(entry.selectedCrns).length > 0 ||
            course.requiredComponents.length === 0;
          const selectedCrns = hasAllSelected
            ? entry.selectedCrns
            : (findValidSectionComboForCourse(
                course,
                runningBlocks,
                dbState!.blockedSlots,
                { allowConflictingFallback: true },
              ) ?? {});

          for (const crn of Object.values(selectedCrns)) {
            const sec = course.sections.find((s) => s.crn === crn);
            if (sec) {
              runningBlocks = runningBlocks.concat(
                convertScheduleSectionToBlocks(sec, entry.color, "planned"),
              );
            }
          }
          return { ...entry, selectedCrns };
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
        setSyncStatus(user ? "local" : "local");
        if (user) {
          // Promote guest local schedule up to DB on sign-in
          userDirtyRef.current = true;
        }
      } else if (degInfo.termCourseCodes.length > 0) {
        nextPlanned = buildEntriesFromCourseCodes(degInfo.termCourseCodes, []);
        if (nextPlanned.length > 0) {
          showToast(
            `Loaded ${nextPlanned.length} courses for ${termInfo.label} from your Degree Plan`,
          );
          if (user) {
            userDirtyRef.current = true;
          }
        }
      }

      setPlannedCourses(nextPlanned);
      setBlockedSlots(mergeBlockedSlots(nextBlocked));
      setCustomBlocks(nextCustom);
      hydratedKeyRef.current = hydrationKey;
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [
    activeTerm,
    authReady,
    user,
    terms,
    supabase,
    courseMap,
    buildEntriesFromCourseCodes,
    showToast,
  ]);

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

  // Expanded completed courses set (including formerly_codes equivalence)
  const expandedCompletedSet = useMemo(() => {
    const base = new Set(completedCourses.map((c) => c.trim().toUpperCase()));
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
  }, [completedCourses, catalog.courses]);

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

    const annotated = annotateScheduleConflicts(blocks, blockedSlots);
    const conflicts = annotated.filter((b) => b.isConflict).length;

    if (hoverPreviewSection) {
      blocks.push(
        ...convertScheduleSectionToBlocks(
          hoverPreviewSection,
          "blue",
          "preview",
        ),
      );
      annotated.push(
        ...convertScheduleSectionToBlocks(
          hoverPreviewSection,
          "blue",
          "preview",
        ),
      );
    }

    return {
      rawScheduleBlocks: blocks,
      annotatedBlocks: annotated,
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

  const markDirty = useCallback(() => {
    userDirtyRef.current = true;
    setSyncStatus(user ? "saving" : "local");
  }, [user]);

  const handleAddCourse = useCallback(
    (
      courseCode: string,
      mode: "planned" | "exploring",
      preferredCrns?: Record<string, string>,
      deliveryPrefs?: {
        requireOnline?: boolean;
        requireAsync?: boolean;
        requireOpenSeats?: boolean;
      },
    ) => {
      const course = courseMap.get(courseCode);
      if (!course) return;

      const pickedCombo =
        findValidSectionComboForCourse(
          course,
          rawScheduleBlocks,
          blockedSlots,
          {
            currentSelections: preferredCrns,
            requireOnline: deliveryPrefs?.requireOnline,
            requireAsync: deliveryPrefs?.requireAsync,
            requireOpenSeats: deliveryPrefs?.requireOpenSeats,
            ignoreCourseCode: courseCode,
            allowConflictingFallback: true,
          },
        ) ??
        preferredCrns ??
        {};

      markDirty();
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
    [courseMap, rawScheduleBlocks, blockedSlots, markDirty, showToast],
  );

  const handleSelectSection = useCallback(
    (courseCode: string, component: CourseComponentType, crn: string) => {
      markDirty();
      setPlannedCourses((prev) =>
        prev.map((entry) =>
          entry.courseCode === courseCode
            ? {
                ...entry,
                hidden: false,
                selectedCrns: { ...entry.selectedCrns, [component]: crn },
              }
            : entry,
        ),
      );
    },
    [markDirty],
  );

  const handleRemoveCourse = useCallback(
    (courseCode: string) => {
      markDirty();
      setPlannedCourses((prev) =>
        prev.filter((entry) => entry.courseCode !== courseCode),
      );
    },
    [markDirty],
  );

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
      markDirty();
      setPlannedCourses((prev) =>
        prev.map((entry) =>
          entry.courseCode === courseCode
            ? { ...entry, hidden: !entry.hidden }
            : entry,
        ),
      );
    },
    [markDirty],
  );

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
    markDirty();
    setPlannedCourses((prev) =>
      prev.map((entry) =>
        fitted[entry.courseCode]
          ? { ...entry, selectedCrns: fitted[entry.courseCode] }
          : entry,
      ),
    );
    showToast("Updated Lecture/Lab/Tutorial sections with zero conflicts.");
  }, [plannedCourses, courseMap, blockedSlots, customBlocks, markDirty, showToast]);

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
    markDirty();
    setPlannedCourses([]);
    setCustomBlocks([]);
    setBlockedSlots([]);
    setHoverPreviewSection(null);
    showToast("Cleared schedule and blocked times.");
  }, [markDirty, showToast]);

  const handleClearPlanner = useCallback(() => {
    markDirty();
    setPlannedCourses([]);
    setCustomBlocks([]);
    setHoverPreviewSection(null);
    showToast("Cleared all courses from planner.");
  }, [markDirty, showToast]);

  const handleImportFromDegreePlan = () => {
    if (degreePlanImportInfo.termCourseCodes.length === 0) return;
    markDirty();
    const existingSet = new Set(plannedCourses.map((c) => c.courseCode));
    const newCodes = degreePlanImportInfo.termCourseCodes.filter(
      (c) => !existingSet.has(c.trim().toUpperCase()),
    );
    const imported = buildEntriesFromCourseCodes(
      newCodes,
      blockedSlots,
      plannedCourses.length,
    );
    if (imported.length === 0) {
      showToast("All courses from this term's Degree Plan are already added.");
      return;
    }
    const merged = [...plannedCourses, ...imported];
    const refitted = autoFitPlannedCourses(
      merged,
      courseMap,
      blockedSlots,
      customBlocks,
    );
    setPlannedCourses(
      refitted
        ? merged.map((e) =>
            refitted[e.courseCode]
              ? { ...e, selectedCrns: refitted[e.courseCode] }
              : e,
          )
        : merged,
    );
    showToast(
      `Imported ${imported.length} course${imported.length === 1 ? "" : "s"} from ${degreePlanImportInfo.sourceLabel ?? "Degree Plan"}`,
    );
  };

  const handleAddCompletedCourse = useCallback(
    (code: string) => {
      markDirty();
      setCompletedCourses((prev) =>
        prev.includes(code) ? prev : [...prev, code].sort(),
      );
    },
    [markDirty],
  );

  const handleRemoveCompletedCourse = useCallback(
    (code: string) => {
      markDirty();
      setCompletedCourses((prev) => prev.filter((c) => c !== code));
    },
    [markDirty],
  );

  return (
    <div className="space-y-4">
      {/* Mobile 2-Tab Bar (< lg) */}
      <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-100 p-1 text-xs font-semibold lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setMobileTab("schedule")}
          className={`rounded-lg py-2 transition ${
            mobileTab === "schedule"
              ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          Schedule ({plannedCourses.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("lookup")}
          className={`rounded-lg py-2 transition ${
            mobileTab === "lookup"
              ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 dark:text-zinc-400"
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
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex flex-wrap items-center gap-2">
              {/* Semester Selector */}
              <select
                value={activeTerm}
                disabled={loadingTerm}
                onChange={(e) => void handleTermChange(e.target.value)}
                aria-label="Select semester"
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-900 shadow-xs focus:border-blue-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {terms.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>

              {/* View Mode Switcher (Combined, Week 1, Week 2 only) */}
              <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-800">
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
                    className={`rounded-md px-2.5 py-1 transition ${
                      viewMode === mode.id
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Fit vs Expand Toggle */}
              <button
                type="button"
                onClick={() => setFitToHeight((v) => !v)}
                className="hidden items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 xl:inline-flex dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {fitToHeight ? "Fit View" : "Expanded"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Edit Schedule Toggle */}
              <button
                type="button"
                onClick={() => {
                  setIsEditMode((prev) => {
                    const next = !prev;
                    if (!next) {
                      setIsBlockingMode(false);
                      setBlockMenuOpen(false);
                    }
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition ${
                  isEditMode
                    ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                <span>{isEditMode ? "✓ Done Editing" : "Edit Schedule"}</span>
              </button>

              {isEditMode && (
                <>
                  {/* Block Times Menu */}
                  <div className="relative" ref={blockMenuRef}>
                    <button
                      type="button"
                      onClick={() => setBlockMenuOpen((v) => !v)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        isBlockingMode || blockedSlots.length > 0
                          ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
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
                      <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
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
                            setIsBlockingMode((v) => !v);
                            setBlockMenuOpen(false);
                          }}
                          className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-left font-medium transition ${
                            isBlockingMode
                              ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                              : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                          }`}
                        >
                          {isBlockingMode
                            ? "✓ Drag-to-Block Grid Mode Active"
                            : "🖱 Drag on Grid to Block Times"}
                        </button>

                        {/* Quick Presets */}
                        <div className="mt-2.5 space-y-1">
                          <p className="text-[10.5px] font-medium uppercase tracking-wider text-zinc-400">
                            Quick Presets
                          </p>
                          {TIME_BLOCK_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handleApplyBlockPreset(preset)}
                              className="block w-full rounded-md px-2 py-1 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                          className="mt-3 space-y-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800"
                        >
                          <p className="text-[10.5px] font-medium uppercase tracking-wider text-zinc-400">
                            Custom Block
                          </p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              value={blkDay}
                              onChange={(e) =>
                                setBlkDay(e.target.value as DayOfWeek)
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              type="time"
                              value={blkStart}
                              onChange={(e) => setBlkStart(e.target.value)}
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                            <input
                              type="time"
                              value={blkEnd}
                              onChange={(e) => setBlkEnd(e.target.value)}
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                          </div>
                          <button
                            type="submit"
                            className="w-full rounded-lg bg-rose-600 py-1.5 font-medium text-white hover:bg-rose-700"
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

                  {/* Import from Degree Plan */}
                  {degreePlanImportInfo.termCourseCodes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleImportFromDegreePlan}
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      title={`Import ${catalog.termLabel} courses from your saved Degree Plan`}
                    >
                      Import Degree Plan
                    </button>
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
                    className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900/60 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    title="Clear all courses, custom blocks, and blocked times from this semester schedule"
                  >
                    Clear Schedule
                  </button>
                </>
              )}

              {/* Calendar Export */}
              <button
                type="button"
                onClick={() => setIsCalendarModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700"
              >
                <span>Export / Sync Calendar</span>
              </button>
            </div>
          </div>

          {/* Status & Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
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
            </div>

            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
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
            viewMode={viewMode}
            title={
              viewMode === "combined"
                ? `${catalog.termLabel} Schedule`
                : viewMode === "week1"
                  ? `${catalog.termLabel} — Week 1`
                  : `${catalog.termLabel} — Week 2`
            }
            subtitle={
              viewMode === "combined"
                ? isEditMode
                  ? "Biweekly W1 (left) & W2 (right) side-by-side · Drag blocks to snap to other sections"
                  : "Biweekly W1 (left) and W2 (right) classes sit side-by-side"
                : viewMode === "week1"
                  ? "Odd Teaching Weeks"
                  : "Even Teaching Weeks"
            }
            accentColor={viewMode === "week2" ? "purple" : "blue"}
            courses={annotatedBlocks}
            blockedSlots={blockedSlots}
            courseMap={courseMap}
            isEditMode={isEditMode}
            fitToHeight={fitToHeight}
            isBlockingMode={isBlockingMode}
            onCreateBlockedSlot={(d, s, e, l) =>
              handleCreateBlockedSlot(d, s, e, l)
            }
            onUpdateBlockedSlots={handleUpdateBlockedSlots}
            onRemoveBlockedSlot={handleRemoveBlockedSlot}
            onRemoveBlock={handleRemoveBlockFromGrid}
            onSelectSection={handleSelectSection}
            onPromoteCourse={(code) => handleSetCourseMode(code, "planned")}
            onInspectCourse={(code) => {
              setFocusedCourseCode(code);
              setMobileTab("lookup");
            }}
          />

          {/* Active Blocked Times Pills */}
          {blockedSlots.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="font-medium text-zinc-500">Blocked Times:</span>
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
          className={`lg:col-span-4 lg:sticky lg:top-4 ${
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
            completedCourses={completedCourses}
            expandedCompletedSet={expandedCompletedSet}
            programElectives={programElectives}
            focusedCourseCode={focusedCourseCode}
            isEditMode={isEditMode}
            onEnableEditMode={() => setIsEditMode(true)}
            onClearPlanner={handleClearPlanner}
            onClearFocus={() => setFocusedCourseCode(null)}
            onAddCourse={handleAddCourse}
            onSelectSection={handleSelectSection}
            onRemoveCourse={handleRemoveCourse}
            onSetCourseMode={handleSetCourseMode}
            onToggleCourseVisibility={handleToggleCourseVisibility}
            onChangeCourseColor={handleChangeCourseColor}
            onAutoFitAll={handleAutoFitAll}
            onAddCustomBlock={handleAddCustomBlock}
            onRemoveCustomBlock={handleRemoveCustomBlock}
            onAddCompletedCourse={handleAddCompletedCourse}
            onRemoveCompletedCourse={handleRemoveCompletedCourse}
            onHoverSection={setHoverPreviewSection}
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
        <div className="fixed bottom-5 right-5 z-50 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
