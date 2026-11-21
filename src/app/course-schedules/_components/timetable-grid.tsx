"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DAYS_OF_WEEK,
  THEME_STYLES,
  checkSectionFit,
  formatHourLabel,
  formatTimeDisplay,
  intervalsOverlap,
  mergeBlockedSlots,
  minutesToTimeString,
  parseTimeToMinutes,
  type BlockedTimeSlot,
  type CourseComponentType,
  type DayOfWeek,
  type ScheduleBlock,
  type ScheduleCourseGroup,
  type ScheduleSection,
  type WeekPattern,
  type WeekScheduleProps,
} from "../types";
import { RmpStarBadge } from "./rmp-badge";

interface PositionedBlock {
  block: ScheduleBlock;
  leftPercent: number;
  widthPercent: number;
}

interface GhostTargetSlot {
  id: string;
  courseCode: string;
  crn: string;
  component: CourseComponentType;
  section: ScheduleSection;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  weekPattern: WeekPattern;
  room: string;
  fits: boolean;
  conflictsWith: string[];
  isCurrent: boolean;
  multiColorIndex?: number;
  label: string;
  groupedOptions?: GhostTargetSlot[];
}

const MULTI_COURSE_GHOST_PALETTE: Array<{
  dot: string;
  defaultClass: string;
  hoverClass: string;
}> = [
  {
    dot: "bg-emerald-500",
    defaultClass:
      "border-emerald-500 bg-emerald-500/20 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/75 dark:text-emerald-100",
    hoverClass:
      "z-50 border-emerald-600 bg-emerald-500/35 text-emerald-950 ring-2 ring-emerald-500 shadow-md dark:border-emerald-400 dark:bg-emerald-900/80 dark:text-emerald-50",
  },
  {
    dot: "bg-purple-500",
    defaultClass:
      "border-purple-500 bg-purple-500/20 text-purple-950 dark:border-purple-400 dark:bg-purple-950/75 dark:text-purple-100",
    hoverClass:
      "z-50 border-purple-600 bg-purple-500/35 text-purple-950 ring-2 ring-purple-500 shadow-md dark:border-purple-400 dark:bg-purple-900/80 dark:text-purple-50",
  },
  {
    dot: "bg-orange-500",
    defaultClass:
      "border-orange-500 bg-orange-500/20 text-orange-950 dark:border-orange-400 dark:bg-orange-950/75 dark:text-orange-100",
    hoverClass:
      "z-50 border-orange-600 bg-orange-500/35 text-orange-950 ring-2 ring-orange-500 shadow-md dark:border-orange-400 dark:bg-orange-900/80 dark:text-orange-50",
  },
  {
    dot: "bg-cyan-500",
    defaultClass:
      "border-cyan-500 bg-cyan-500/20 text-cyan-950 dark:border-cyan-400 dark:bg-cyan-950/75 dark:text-cyan-100",
    hoverClass:
      "z-50 border-cyan-600 bg-cyan-500/35 text-cyan-950 ring-2 ring-cyan-500 shadow-md dark:border-cyan-400 dark:bg-cyan-900/80 dark:text-cyan-50",
  },
  {
    dot: "bg-amber-500",
    defaultClass:
      "border-amber-500 bg-amber-400/25 text-amber-950 dark:border-amber-400 dark:bg-amber-950/75 dark:text-amber-100",
    hoverClass:
      "z-50 border-amber-600 bg-amber-400/40 text-amber-950 ring-2 ring-amber-500 shadow-md dark:border-amber-400 dark:bg-amber-900/80 dark:text-amber-50",
  },
  {
    dot: "bg-fuchsia-500",
    defaultClass:
      "border-fuchsia-500 bg-fuchsia-500/20 text-fuchsia-950 dark:border-fuchsia-400 dark:bg-fuchsia-950/75 dark:text-fuchsia-100",
    hoverClass:
      "z-50 border-fuchsia-600 bg-fuchsia-500/35 text-fuchsia-950 ring-2 ring-fuchsia-500 shadow-md dark:border-fuchsia-400 dark:bg-fuchsia-900/80 dark:text-fuchsia-50",
  },
  {
    dot: "bg-teal-500",
    defaultClass:
      "border-teal-500 bg-teal-500/20 text-teal-950 dark:border-teal-400 dark:bg-teal-950/75 dark:text-teal-100",
    hoverClass:
      "z-50 border-teal-600 bg-teal-500/35 text-teal-950 ring-2 ring-teal-500 shadow-md dark:border-teal-400 dark:bg-teal-900/80 dark:text-teal-50",
  },
  {
    dot: "bg-indigo-500",
    defaultClass:
      "border-indigo-500 bg-indigo-500/20 text-indigo-950 dark:border-indigo-400 dark:bg-indigo-950/75 dark:text-indigo-100",
    hoverClass:
      "z-50 border-indigo-600 bg-indigo-500/35 text-indigo-950 ring-2 ring-indigo-500 shadow-md dark:border-indigo-400 dark:bg-indigo-900/80 dark:text-indigo-50",
  },
];

function getFittingGhostClasses(
  component: CourseComponentType,
  isHovered: boolean,
  multiColorIndex?: number,
): string {
  if (multiColorIndex !== undefined) {
    const entry =
      MULTI_COURSE_GHOST_PALETTE[
        multiColorIndex % MULTI_COURSE_GHOST_PALETTE.length
      ];
    return isHovered ? entry.hoverClass : entry.defaultClass;
  }
  if (component === "LAB") {
    return isHovered
      ? "z-50 border-orange-600 bg-orange-500/35 text-orange-950 ring-2 ring-orange-500 shadow-md dark:border-orange-400 dark:bg-orange-900/80 dark:text-orange-50"
      : "border-orange-500 bg-orange-500/20 text-orange-950 dark:border-orange-400 dark:bg-orange-950/75 dark:text-orange-100";
  }
  if (component === "TUT") {
    return isHovered
      ? "z-50 border-yellow-600 bg-yellow-400/40 text-yellow-950 ring-2 ring-yellow-500 shadow-md dark:border-yellow-400 dark:bg-yellow-900/80 dark:text-yellow-50"
      : "border-yellow-500 bg-yellow-400/25 text-yellow-950 dark:border-yellow-400 dark:bg-yellow-950/75 dark:text-yellow-100";
  }
  return isHovered
    ? "z-50 border-emerald-600 bg-emerald-500/35 text-emerald-950 ring-2 ring-emerald-500 shadow-md dark:border-emerald-400 dark:bg-emerald-900/80 dark:text-emerald-50"
    : "border-emerald-500 bg-emerald-500/20 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/75 dark:text-emerald-100";
}

interface PositionedGhost {
  ghost: GhostTargetSlot;
  leftPercent: number;
  widthPercent: number;
}

interface CourseDragState {
  sourceBlock: ScheduleBlock;
  component: CourseComponentType;
  ghosts: GhostTargetSlot[];
  hoveredCrn: string | null;
}

interface BiweeklyLayoutItem {
  id: string;
  startTime: string;
  endTime: string;
  weekPattern: WeekPattern;
}

function layoutBiweeklyItems<T extends BiweeklyLayoutItem>(
  items: T[],
  viewMode: "combined" | "week1" | "week2",
  tieBreak?: (a: T, b: T) => number,
): Array<{ item: T; leftPercent: number; widthPercent: number }> {
  const filtered = items.filter((b) => {
    if (viewMode === "combined") return true;
    return b.weekPattern === "both" || b.weekPattern === viewMode;
  });

  if (filtered.length === 0) return [];

  const sorted = filtered.slice().sort((a, b) => {
    const aS = parseTimeToMinutes(a.startTime);
    const bS = parseTimeToMinutes(b.startTime);
    if (aS !== bS) return aS - bS;
    const aE = parseTimeToMinutes(a.endTime);
    const bE = parseTimeToMinutes(b.endTime);
    if (aE !== bE) return bE - aE;
    return tieBreak ? tieBreak(a, b) : 0;
  });

  const clusters: T[][] = [];
  let currentCluster: T[] = [];
  let clusterEnd = -1;

  for (const b of sorted) {
    const s = parseTimeToMinutes(b.startTime);
    const e = parseTimeToMinutes(b.endTime);
    if (currentCluster.length === 0 || s < clusterEnd) {
      currentCluster.push(b);
      if (e > clusterEnd) clusterEnd = e;
    } else {
      clusters.push(currentCluster);
      currentCluster = [b];
      clusterEnd = e;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const positioned: Array<{ item: T; leftPercent: number; widthPercent: number }> =
    [];

  for (const cluster of clusters) {
    if (viewMode !== "combined") {
      const cols: T[][] = [];
      const colOf = new Map<string, number>();

      for (const b of cluster) {
        const s = parseTimeToMinutes(b.startTime);
        const e = parseTimeToMinutes(b.endTime);
        let placed = false;
        for (let c = 0; c < cols.length; c++) {
          const overlaps = cols[c].some((existing) =>
            intervalsOverlap(
              s,
              e,
              parseTimeToMinutes(existing.startTime),
              parseTimeToMinutes(existing.endTime),
            ),
          );
          if (!overlaps) {
            cols[c].push(b);
            colOf.set(b.id, c);
            placed = true;
            break;
          }
        }
        if (!placed) {
          cols.push([b]);
          colOf.set(b.id, cols.length - 1);
        }
      }

      const numCols = Math.max(1, cols.length);
      for (const b of cluster) {
        const col = colOf.get(b.id) ?? 0;
        positioned.push({
          item: b,
          leftPercent: (col / numCols) * 100,
          widthPercent: 100 / numCols,
        });
      }
      continue;
    }

    type ColBucket = {
      both: T[];
      week1: T[];
      week2: T[];
    };
    const cols: ColBucket[] = [];
    const placement = new Map<
      string,
      { col: number; lane: "full" | "left" | "right" }
    >();

    for (const b of cluster) {
      const s = parseTimeToMinutes(b.startTime);
      const e = parseTimeToMinutes(b.endTime);

      const overlapsList = (list: T[]) =>
        list.some((existing) =>
          intervalsOverlap(
            s,
            e,
            parseTimeToMinutes(existing.startTime),
            parseTimeToMinutes(existing.endTime),
          ),
        );

      let placedCol = -1;
      let lane: "full" | "left" | "right" = "full";

      for (let c = 0; c < cols.length; c++) {
        const bucket = cols[c];
        if (b.weekPattern === "both") {
          if (
            !overlapsList(bucket.both) &&
            !overlapsList(bucket.week1) &&
            !overlapsList(bucket.week2)
          ) {
            bucket.both.push(b);
            placedCol = c;
            lane = "full";
            break;
          }
        } else if (b.weekPattern === "week1") {
          if (!overlapsList(bucket.both) && !overlapsList(bucket.week1)) {
            bucket.week1.push(b);
            placedCol = c;
            lane = "left";
            break;
          }
        } else {
          if (!overlapsList(bucket.both) && !overlapsList(bucket.week2)) {
            bucket.week2.push(b);
            placedCol = c;
            lane = "right";
            break;
          }
        }
      }

      if (placedCol === -1) {
        const fresh: ColBucket = { both: [], week1: [], week2: [] };
        if (b.weekPattern === "both") {
          fresh.both.push(b);
          lane = "full";
        } else if (b.weekPattern === "week1") {
          fresh.week1.push(b);
          lane = "left";
        } else {
          fresh.week2.push(b);
          lane = "right";
        }
        cols.push(fresh);
        placedCol = cols.length - 1;
      }

      placement.set(b.id, { col: placedCol, lane });
    }

    const numCols = Math.max(1, cols.length);
    const colWidth = 100 / numCols;

    for (const b of cluster) {
      const pos = placement.get(b.id)!;
      const bucket = cols[pos.col];
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);

      let leftPercent = pos.col * colWidth;
      let widthPercent = colWidth;

      if (pos.lane === "left") {
        const hasPairedRight = bucket.week2.some((other) =>
          intervalsOverlap(
            bStart,
            bEnd,
            parseTimeToMinutes(other.startTime),
            parseTimeToMinutes(other.endTime),
          ),
        );
        if (hasPairedRight) {
          widthPercent = colWidth / 2;
        }
      } else if (pos.lane === "right") {
        const hasPairedLeft = bucket.week1.some((other) =>
          intervalsOverlap(
            bStart,
            bEnd,
            parseTimeToMinutes(other.startTime),
            parseTimeToMinutes(other.endTime),
          ),
        );
        if (hasPairedLeft) {
          leftPercent = pos.col * colWidth + colWidth / 2;
          widthPercent = colWidth / 2;
        }
      }

      positioned.push({
        item: b,
        leftPercent,
        widthPercent,
      });
    }
  }

  return positioned;
}

function layoutDayBlocks(
  dayBlocks: ScheduleBlock[],
  viewMode: "combined" | "week1" | "week2",
): PositionedBlock[] {
  return layoutBiweeklyItems(dayBlocks, viewMode).map(
    ({ item, leftPercent, widthPercent }) => ({
      block: item,
      leftPercent,
      widthPercent,
    }),
  );
}

function layoutDayGhosts(
  dayGhosts: GhostTargetSlot[],
  viewMode: "combined" | "week1" | "week2",
): PositionedGhost[] {
  return layoutBiweeklyItems(dayGhosts, viewMode, (a, b) => {
    const aAvail = a.fits || a.isCurrent ? 0 : 1;
    const bAvail = b.fits || b.isCurrent ? 0 : 1;
    if (aAvail !== bAvail) return aAvail - bAvail;
    return a.crn.localeCompare(b.crn);
  }).map(({ item, leftPercent, widthPercent }) => ({
    ghost: item,
    leftPercent,
    widthPercent,
  }));
}

function buildSectionGhosts(
  course: ScheduleCourseGroup,
  component: CourseComponentType,
  currentCrn: string | undefined,
  activeBlocks: ScheduleBlock[],
  blockedSlots: BlockedTimeSlot[],
  multiColorIndex?: number,
): GhostTargetSlot[] {
  const candidateSections = course.sections.filter(
    (s) => s.component === component && s.meetings.length > 0,
  );
  const ghosts: GhostTargetSlot[] = [];
  for (const sec of candidateSections) {
    const fit = checkSectionFit(
      sec,
      activeBlocks,
      blockedSlots,
      course.courseCode,
      component,
    );
    sec.meetings.forEach((m, mIdx) => {
      ghosts.push({
        id: `ghost-${course.courseCode}-${sec.crn}-${m.day}-${m.startTime}-${mIdx}`,
        courseCode: course.courseCode,
        crn: sec.crn,
        component,
        section: sec,
        day: m.day,
        startTime: m.startTime,
        endTime: m.endTime,
        startMinutes: m.startMinutes,
        endMinutes: m.endMinutes,
        weekPattern: m.weekPattern,
        room: m.location || (sec.isOnline ? "Online" : "TBA"),
        fits: fit.fits,
        conflictsWith: fit.conflictsWith,
        isCurrent: Boolean(currentCrn && sec.crn === currentCrn),
        multiColorIndex,
        label: `${course.courseCode} ${component} CRN ${sec.crn}`,
      });
    });
  }
  return ghosts;
}

function DayHeaderStrip({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={`flex bg-zinc-100 text-zinc-700 select-none dark:bg-zinc-900 dark:text-zinc-300 ${
        position === "top"
          ? "border-b-2 border-zinc-300 dark:border-zinc-700"
          : "border-t-2 border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <div className="flex w-12 shrink-0 items-center justify-center border-r border-zinc-300 py-1.5 font-mono text-[10px] font-semibold text-zinc-400 sm:w-14 dark:border-zinc-800 dark:text-zinc-500">
        {position === "top" ? "TIME" : "DAY"}
      </div>
      <div className="grid flex-1 grid-cols-7 divide-x divide-zinc-300 dark:divide-zinc-800">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day.key}
            className="flex flex-col items-center justify-center py-1.5 text-center"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide md:hidden">
              {day.shortLabel}
            </span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-wide md:inline">
              {day.fullLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeekScheduleGrid({
  viewMode,
  title,
  subtitle,
  courses,
  blockedSlots = [],
  courseMap,
  gridSectionPickers = [],
  onChangeGridSectionPickers,
  hiddenCourseCodes,
  onToggleCourseVisibility,
  isEditMode = false,
  showRmp = false,
  startHour = 8,
  endHour = 22,
  onRemoveBlock,
  onSelectSection,
  onPromoteCourse,
  onInspectCourse,
  onRemoveBlockedSlot,
  onUpdateBlockedSlots,
  isBlockingMode = false,
  onCreateBlockedSlot,
  onUpdateCustomBlocks,
  isCustomBlockDragMode = false,
  customBlockDraft,
  onCreateCustomBlocksFromDrag,
  accentColor = viewMode === "week2" ? "purple" : "blue",
  badgeLabel,
  fitToHeight = true,
}: WeekScheduleProps) {
  const [selectedCourse, setSelectedCourse] = useState<ScheduleBlock | null>(
    null,
  );
  const [dragCourse, setDragCourse] = useState<CourseDragState | null>(null);
  const [hoveredPickerCrn, setHoveredPickerCrn] = useState<string | null>(null);
  const [dragBlockedPreviews, setDragBlockedPreviews] = useState<
    BlockedTimeSlot[]
  >([]);
  const [dragCustomPreviews, setDragCustomPreviews] = useState<ScheduleBlock[]>(
    [],
  );
  const [hiddenBlockedId, setHiddenBlockedId] = useState<string | null>(null);
  const [hiddenCustomId, setHiddenCustomId] = useState<string | null>(null);
  const [slotGroupPicker, setSlotGroupPicker] = useState<{
    options: GhostTargetSlot[];
    anchor: { left: number; top?: number; bottom?: number };
  } | null>(null);

  const gridBodyRef = useRef<HTMLDivElement>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (gridSectionPickers.length === 0 && !selectedCourse) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (slotGroupPicker) {
          setSlotGroupPicker(null);
          return;
        }
        if (selectedCourse) {
          setSelectedCourse(null);
          return;
        }
        setHoveredPickerCrn(null);
        onChangeGridSectionPickers?.([]);
        return;
      }
      if (
        e.key === "Enter" &&
        !selectedCourse &&
        gridSectionPickers.length > 0
      ) {
        const activeTag = document.activeElement?.tagName;
        const isInteractive =
          activeTag === "INPUT" ||
          activeTag === "TEXTAREA" ||
          activeTag === "SELECT" ||
          activeTag === "BUTTON" ||
          document.activeElement?.getAttribute("role") === "button";
        if (!isInteractive) {
          e.preventDefault();
          setHoveredPickerCrn(null);
          onChangeGridSectionPickers?.([]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gridSectionPickers.length, selectedCourse, onChangeGridSectionPickers]);

  const totalHours = endHour - startHour;
  const startMinutes = startHour * 60;
  const endMinutesLimit = endHour * 60;
  const totalMinutes = totalHours * 60;
  const hours = Array.from({ length: totalHours }, (_, i) => startHour + i);

  const getPointerGridCoords = (clientX: number, clientY: number) => {
    const rect = gridBodyRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const relX = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const rawCol = (relX / rect.width) * DAYS_OF_WEEK.length;
    const colIdx = Math.max(
      0,
      Math.min(DAYS_OF_WEEK.length - 1, Math.floor(rawCol)),
    );
    const dayRelXPercent = Math.max(
      0,
      Math.min(100, (rawCol - colIdx) * 100),
    );
    const rawMinutes = startMinutes + (relY / rect.height) * totalMinutes;
    const snapped30 = Math.max(
      startMinutes,
      Math.min(endMinutesLimit, Math.round(rawMinutes / 30) * 30),
    );
    return {
      day: DAYS_OF_WEEK[colIdx].key,
      dayRelXPercent,
      rawMinutes,
      snapped30,
    };
  };

  const visibleCount = useMemo(() => {
    return courses.filter((b) => {
      if (b.mode === "preview") return false;
      if (viewMode === "combined") return true;
      return b.weekPattern === "both" || b.weekPattern === viewMode;
    }).length;
  }, [courses, viewMode]);

  const positionedByDay = useMemo(() => {
    const grouped: Record<DayOfWeek, ScheduleBlock[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };
    for (const c of courses) {
      if (c.isCustom && c.id === hiddenCustomId) continue;
      if (grouped[c.day]) grouped[c.day].push(c);
    }
    for (const preview of dragCustomPreviews) {
      if (grouped[preview.day]) grouped[preview.day].push(preview);
    }
    return {
      monday: layoutDayBlocks(grouped.monday, viewMode),
      tuesday: layoutDayBlocks(grouped.tuesday, viewMode),
      wednesday: layoutDayBlocks(grouped.wednesday, viewMode),
      thursday: layoutDayBlocks(grouped.thursday, viewMode),
      friday: layoutDayBlocks(grouped.friday, viewMode),
      saturday: layoutDayBlocks(grouped.saturday, viewMode),
      sunday: layoutDayBlocks(grouped.sunday, viewMode),
    };
  }, [courses, hiddenCustomId, dragCustomPreviews, viewMode]);

  const blockedByDay = useMemo(() => {
    const grouped: Record<DayOfWeek, BlockedTimeSlot[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };
    for (const slot of blockedSlots) {
      if (slot.id === hiddenBlockedId) continue;
      if (grouped[slot.day]) grouped[slot.day].push(slot);
    }
    for (const preview of dragBlockedPreviews) {
      if (grouped[preview.day]) grouped[preview.day].push(preview);
    }
    return grouped;
  }, [blockedSlots, hiddenBlockedId, dragBlockedPreviews]);

  const isMultiCoursePicker = gridSectionPickers.length >= 2;

  const pickerGhosts = useMemo(() => {
    if (gridSectionPickers.length === 0 || !courseMap) return [];
    const allGhosts: GhostTargetSlot[] = [];

    gridSectionPickers.forEach((target, targetIdx) => {
      if (hiddenCourseCodes?.has(target.courseCode)) return;
      const course = courseMap.get(target.courseCode);
      if (!course) return;
      const targetComponents =
        target.component === "ALL"
          ? course.requiredComponents
          : [target.component];
      const colorIndex = isMultiCoursePicker ? targetIdx : undefined;

      for (const comp of targetComponents) {
        const currentCrn = courses.find(
          (b) =>
            b.mode !== "preview" &&
            !b.isCustom &&
            b.courseCode === target.courseCode &&
            (b.component ?? b.type) === comp,
        )?.crn;
        allGhosts.push(
          ...buildSectionGhosts(
            course,
            comp,
            currentCrn,
            courses,
            blockedSlots,
            colorIndex,
          ),
        );
      }
    });

    // Group multiple sections of the same (courseCode, component) in the exact same timeslot
    const slotGroups = new Map<string, GhostTargetSlot[]>();
    for (const g of allGhosts) {
      const key = `${g.courseCode}:${g.component}:${g.day}:${g.startMinutes}:${g.endMinutes}`;
      const list = slotGroups.get(key) ?? [];
      list.push(g);
      slotGroups.set(key, list);
    }

    const collapsed: GhostTargetSlot[] = [];
    for (const list of slotGroups.values()) {
      if (list.length === 1) {
        collapsed.push(list[0]);
        continue;
      }
      const current = list.find((o) => o.isCurrent);
      const rep = current ?? list.find((o) => o.fits) ?? list[0];
      collapsed.push({
        ...rep,
        fits: current ? current.fits : list.some((o) => o.fits),
        groupedOptions: list,
      });
    }

    return collapsed;
  }, [
    gridSectionPickers,
    hiddenCourseCodes,
    isMultiCoursePicker,
    courseMap,
    courses,
    blockedSlots,
  ]);

  const componentsWithCurrent = useMemo(() => {
    const set = new Set<string>();
    for (const g of pickerGhosts) {
      if (g.isCurrent) set.add(`${g.courseCode}:${g.component}`);
    }
    return set;
  }, [pickerGhosts]);

  const ghostsByDay = useMemo(() => {
    const grouped: Record<DayOfWeek, GhostTargetSlot[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };
    const activeGhosts = dragCourse
      ? dragCourse.ghosts
      : gridSectionPickers.length > 0
        ? pickerGhosts
        : [];
    for (const g of activeGhosts) {
      if (grouped[g.day]) grouped[g.day].push(g);
    }
    return {
      monday: layoutDayGhosts(grouped.monday, viewMode),
      tuesday: layoutDayGhosts(grouped.tuesday, viewMode),
      wednesday: layoutDayGhosts(grouped.wednesday, viewMode),
      thursday: layoutDayGhosts(grouped.thursday, viewMode),
      friday: layoutDayGhosts(grouped.friday, viewMode),
      saturday: layoutDayGhosts(grouped.saturday, viewMode),
      sunday: layoutDayGhosts(grouped.sunday, viewMode),
    };
  }, [dragCourse, gridSectionPickers.length, pickerGhosts, viewMode]);

  const startCoursePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    block: ScheduleBlock,
  ) => {
    if (
      e.button !== 0 ||
      block.mode === "preview" ||
      gridSectionPickers.length > 0
    )
      return;
    if ((e.target as HTMLElement).closest("[data-no-drag='true']")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const comp =
      block.component ?? (block.type as CourseComponentType | undefined);
    const course = courseMap?.get(block.courseCode);
    const canDrag =
      isEditMode &&
      !block.isCustom &&
      Boolean(course) &&
      Boolean(comp) &&
      Boolean(onSelectSection);

    const candidateSections =
      canDrag && course && comp
        ? course.sections.filter(
            (s) => s.component === comp && s.meetings.length > 0,
          )
        : [];

    const ghosts =
      canDrag && course && comp && candidateSections.length >= 1
        ? buildSectionGhosts(course, comp, block.crn, courses, blockedSlots)
        : [];

    const positionedGhostsByDay = new Map<DayOfWeek, PositionedGhost[]>();
    if (ghosts.length > 0) {
      for (const dayMeta of DAYS_OF_WEEK) {
        const dayOnly = ghosts.filter((g) => g.day === dayMeta.key);
        if (dayOnly.length > 0) {
          positionedGhostsByDay.set(
            dayMeta.key,
            layoutDayGhosts(dayOnly, viewMode),
          );
        }
      }
    }

    let isDragging = false;
    let hasShownDragState = false;
    let currentHoveredCrn: string | null = null;

    const findGhostAtPointer = (
      clientX: number,
      clientY: number,
    ): string | null => {
      const coords = getPointerGridCoords(clientX, clientY);
      if (!coords) return null;
      const dayGhosts = positionedGhostsByDay.get(coords.day) ?? [];
      if (dayGhosts.length === 0) return null;

      // Exact vertical interval hit first, disambiguated horizontally for W1/W2 lanes
      const verticalMatches = dayGhosts.filter(
        ({ ghost }) =>
          coords.rawMinutes >= ghost.startMinutes &&
          coords.rawMinutes <= ghost.endMinutes,
      );
      if (verticalMatches.length > 0) {
        const exactHoriz = verticalMatches.find(
          ({ leftPercent, widthPercent }) =>
            coords.dayRelXPercent >= leftPercent &&
            coords.dayRelXPercent <= leftPercent + widthPercent,
        );
        if (exactHoriz) return exactHoriz.ghost.crn;

        let bestMatch = verticalMatches[0];
        let bestHorizDist = Infinity;
        for (const item of verticalMatches) {
          const center = item.leftPercent + item.widthPercent / 2;
          const dist = Math.abs(coords.dayRelXPercent - center);
          if (dist < bestHorizDist) {
            bestHorizDist = dist;
            bestMatch = item;
          }
        }
        return bestMatch.ghost.crn;
      }

      // Otherwise nearest within 25 minutes
      let best: PositionedGhost | null = null;
      let bestScore = Infinity;
      for (const item of dayGhosts) {
        const timeDist = Math.min(
          Math.abs(coords.rawMinutes - item.ghost.startMinutes),
          Math.abs(coords.rawMinutes - item.ghost.endMinutes),
        );
        if (timeDist >= 25) continue;
        const center = item.leftPercent + item.widthPercent / 2;
        const horizDist = Math.abs(coords.dayRelXPercent - center);
        const score = timeDist + horizDist * 0.05;
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      }
      return best ? best.ghost.crn : null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        if (!canDrag || ghosts.length === 0) return;
        isDragging = true;
      }

      const hovered = findGhostAtPointer(ev.clientX, ev.clientY);
      if (!hasShownDragState || hovered !== currentHoveredCrn) {
        hasShownDragState = true;
        currentHoveredCrn = hovered;
        setDragCourse({
          sourceBlock: block,
          component: comp!,
          ghosts,
          hoveredCrn: hovered,
        });
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cleanupDragRef.current = null;
    };

    const onUp = () => {
      cleanup();
      if (!isDragging) {
        setSelectedCourse(block);
        return;
      }
      setDragCourse(null);
      if (
        currentHoveredCrn &&
        currentHoveredCrn !== block.crn &&
        comp &&
        onSelectSection
      ) {
        onSelectSection(block.courseCode, comp, currentHoveredCrn);
      }
    };

    cleanupDragRef.current?.();
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const buildDraftCustomPreviews = (
    days: DayOfWeek[],
    startStr: string,
    endStr: string,
  ): ScheduleBlock[] => {
    const code = customBlockDraft?.courseCode.trim().toUpperCase() || "CUSTOM";
    const title = customBlockDraft?.title.trim() || code;
    const room = customBlockDraft?.room?.trim() || undefined;
    const weekPattern = customBlockDraft?.weekPattern ?? "both";
    const color = customBlockDraft?.color ?? "teal";
    return days.map((day) => ({
      id: `__draft_custom__-${day}`,
      courseCode: code,
      title,
      type: "CUSTOM",
      day,
      startTime: startStr,
      endTime: endStr,
      room,
      weekPattern,
      mode: "planned",
      color,
      isCustom: true,
    }));
  };

  const buildDraftBlockedPreviews = (
    days: DayOfWeek[],
    startStr: string,
    endStr: string,
  ): BlockedTimeSlot[] =>
    days.map((day) => ({
      id: `__draft_block__-${day}`,
      day,
      startTime: startStr,
      endTime: endStr,
      label: "Blocked",
    }));

  const computeMovedOrResizedRange = (
    mode: "move" | "resize-top" | "resize-bottom",
    origDay: DayOfWeek,
    origStart: number,
    origEnd: number,
    offsetMins: number,
    coords: { day: DayOfWeek; rawMinutes: number; snapped30: number },
  ) => {
    const duration = Math.max(30, origEnd - origStart);
    if (mode === "move") {
      const snappedStart =
        Math.round((coords.rawMinutes - offsetMins) / 30) * 30;
      const clampedStart = Math.max(
        startMinutes,
        Math.min(endMinutesLimit - duration, snappedStart),
      );
      return {
        day: coords.day,
        startTime: minutesToTimeString(clampedStart),
        endTime: minutesToTimeString(clampedStart + duration),
      };
    }
    if (mode === "resize-top") {
      const clampedStart = Math.max(
        startMinutes,
        Math.min(origEnd - 30, coords.snapped30),
      );
      return {
        day: origDay,
        startTime: minutesToTimeString(clampedStart),
        endTime: minutesToTimeString(origEnd),
      };
    }
    const clampedEnd = Math.max(
      origStart + 30,
      Math.min(endMinutesLimit, coords.snapped30),
    );
    return {
      day: origDay,
      startTime: minutesToTimeString(origStart),
      endTime: minutesToTimeString(clampedEnd),
    };
  };

  const startCreateBlockedDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const creatingCustom = isCustomBlockDragMode && !isBlockingMode;
    if (
      !isEditMode ||
      (!isBlockingMode && !isCustomBlockDragMode) ||
      gridSectionPickers.length > 0 ||
      e.button !== 0
    )
      return;
    if (
      (e.target as HTMLElement).closest(
        "[data-blocked-slot='true'], [data-custom-block='true']",
      )
    )
      return;

    const initial = getPointerGridCoords(e.clientX, e.clientY);
    if (!initial) return;
    const anchorColIdx = DAYS_OF_WEEK.findIndex((d) => d.key === initial.day);
    const anchorStart = Math.max(
      startMinutes,
      Math.min(endMinutesLimit - 30, Math.floor(initial.rawMinutes / 30) * 30),
    );

    let selectedDays: DayOfWeek[] = [initial.day];
    let latestStart = anchorStart;
    let latestEnd = Math.min(endMinutesLimit, anchorStart + 60);

    const updatePreviews = (days: DayOfWeek[], sMin: number, eMin: number) => {
      const startStr = minutesToTimeString(sMin);
      const endStr = minutesToTimeString(eMin);
      if (creatingCustom) {
        setDragCustomPreviews(buildDraftCustomPreviews(days, startStr, endStr));
      } else {
        setDragBlockedPreviews(
          buildDraftBlockedPreviews(days, startStr, endStr),
        );
      }
    };

    updatePreviews(selectedDays, latestStart, latestEnd);

    const onMove = (ev: PointerEvent) => {
      const coords = getPointerGridCoords(ev.clientX, ev.clientY);
      if (!coords) return;
      const curColIdx = DAYS_OF_WEEK.findIndex((d) => d.key === coords.day);
      const minCol = Math.min(anchorColIdx, curColIdx);
      const maxCol = Math.max(anchorColIdx, curColIdx);
      selectedDays = DAYS_OF_WEEK.slice(minCol, maxCol + 1).map((d) => d.key);

      const curSlot = Math.max(
        startMinutes,
        Math.min(endMinutesLimit - 30, Math.floor(coords.rawMinutes / 30) * 30),
      );
      latestStart = Math.min(anchorStart, curSlot);
      latestEnd = Math.min(
        endMinutesLimit,
        Math.max(anchorStart, curSlot) + 30,
      );
      updatePreviews(selectedDays, latestStart, latestEnd);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cleanupDragRef.current = null;
    };

    const onUp = () => {
      cleanup();
      setDragBlockedPreviews([]);
      setDragCustomPreviews([]);
      const startStr = minutesToTimeString(latestStart);
      const endStr = minutesToTimeString(latestEnd);
      if (creatingCustom) {
        onCreateCustomBlocksFromDrag?.(selectedDays, startStr, endStr);
        return;
      }
      if (onUpdateBlockedSlots) {
        const now = Date.now();
        onUpdateBlockedSlots((prev) =>
          mergeBlockedSlots([
            ...prev,
            ...selectedDays.map((day, idx) => ({
              id: `blk-${day}-${startStr}-${now}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
              day,
              startTime: startStr,
              endTime: endStr,
              label: "Blocked",
            })),
          ]),
        );
      } else {
        for (const day of selectedDays) {
          onCreateBlockedSlot?.(day, startStr, endStr, "Blocked");
        }
      }
    };

    cleanupDragRef.current?.();
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const startBlockedSlotDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    slot: BlockedTimeSlot,
    mode: "move" | "resize-top" | "resize-bottom",
  ) => {
    if (
      !isEditMode ||
      gridSectionPickers.length > 0 ||
      e.button !== 0 ||
      slot.id.startsWith("__draft_block__")
    )
      return;
    if ((e.target as HTMLElement).closest("[data-no-drag='true']")) return;
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialCoords = getPointerGridCoords(e.clientX, e.clientY);
    const origStart = parseTimeToMinutes(slot.startTime);
    const origEnd = parseTimeToMinutes(slot.endTime);
    const duration = Math.max(30, origEnd - origStart);
    const offsetMins = initialCoords
      ? Math.max(0, Math.min(duration, initialCoords.rawMinutes - origStart))
      : 0;

    let isDragging = false;
    let nextSlot: BlockedTimeSlot = { ...slot };

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        isDragging = true;
        setHiddenBlockedId(slot.id);
      }

      const coords = getPointerGridCoords(ev.clientX, ev.clientY);
      if (!coords) return;

      const updated = computeMovedOrResizedRange(
        mode,
        slot.day,
        origStart,
        origEnd,
        offsetMins,
        coords,
      );
      nextSlot = { ...slot, ...updated };
      setDragBlockedPreviews([nextSlot]);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cleanupDragRef.current = null;
    };

    const onUp = () => {
      cleanup();
      setHiddenBlockedId(null);
      setDragBlockedPreviews([]);
      if (!isDragging) return;
      onUpdateBlockedSlots?.((prev) =>
        mergeBlockedSlots(
          prev.map((s) => (s.id === slot.id ? nextSlot : s)),
        ),
      );
    };

    cleanupDragRef.current?.();
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const startCustomBlockDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    block: ScheduleBlock,
    mode: "move" | "resize-top" | "resize-bottom",
  ) => {
    if (
      !isEditMode ||
      !block.isCustom ||
      gridSectionPickers.length > 0 ||
      e.button !== 0 ||
      block.id.startsWith("__draft_custom__")
    )
      return;
    if ((e.target as HTMLElement).closest("[data-no-drag='true']")) return;
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialCoords = getPointerGridCoords(e.clientX, e.clientY);
    const origStart = parseTimeToMinutes(block.startTime);
    const origEnd = parseTimeToMinutes(block.endTime);
    const duration = Math.max(30, origEnd - origStart);
    const offsetMins = initialCoords
      ? Math.max(0, Math.min(duration, initialCoords.rawMinutes - origStart))
      : 0;

    let isDragging = false;
    let nextBlock: ScheduleBlock = { ...block };

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        isDragging = true;
        setHiddenCustomId(block.id);
      }

      const coords = getPointerGridCoords(ev.clientX, ev.clientY);
      if (!coords) return;

      const updated = computeMovedOrResizedRange(
        mode,
        block.day,
        origStart,
        origEnd,
        offsetMins,
        coords,
      );
      nextBlock = { ...block, ...updated };
      setDragCustomPreviews([{ ...nextBlock, id: `__draft_custom__-${block.id}` }]);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cleanupDragRef.current = null;
    };

    const onUp = () => {
      cleanup();
      setHiddenCustomId(null);
      setDragCustomPreviews([]);
      if (!isDragging) {
        if (mode === "move") {
          setSelectedCourse(block);
        }
        return;
      }
      onUpdateCustomBlocks?.((prev) =>
        prev.map((b) => (b.id === block.id ? nextBlock : b)),
      );
    };

    cleanupDragRef.current?.();
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const accentBadge =
    accentColor === "blue"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800"
      : accentColor === "purple"
        ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-200 dark:border-purple-800"
        : accentColor === "emerald"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
          : accentColor === "red"
            ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800"
            : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800"

  const resolvedBadge =
    badgeLabel ??
    (viewMode === "combined"
      ? "Combined (W1 | W2)"
      : viewMode === "week1"
        ? "Week 1"
        : "Week 2");

  const hasGridPickers = gridSectionPickers.length > 0;
  const isPickerOverlay = hasGridPickers && !dragCourse;
  const canPickOnGrid = isPickerOverlay && isEditMode;
  const isDraggingAny = Boolean(dragCourse) || hasGridPickers;
  const hasActiveGhosts = dragCourse
    ? dragCourse.ghosts.length > 0
    : pickerGhosts.length > 0;
  const pickerByCourseCode = useMemo(
    () => new Map(gridSectionPickers.map((t) => [t.courseCode, t])),
    [gridSectionPickers],
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-300/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${accentBadge}`}
          >
            {resolvedBadge}
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {isEditMode && isBlockingMode && (
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
              Drag on grid to block time
            </span>
          )}
          {isEditMode && isCustomBlockDragMode && (
            <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
              Drag on grid to add custom block
            </span>
          )}
          {dragCourse && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
              {dragCourse.ghosts.some((g) => !g.isCurrent)
                ? "Drop onto a highlighted section slot"
                : "Only 1 scheduled section for this component"}
            </span>
          )}
          <span className="tabular-nums">
            {visibleCount} {visibleCount === 1 ? "block" : "blocks"}
          </span>
        </div>
      </div>

      {/* Click-to-Schedule / Compare All Sections Banners (one green row per course) */}
      {hasGridPickers && (
        <div className="divide-y divide-emerald-200/80 border-b border-emerald-200 bg-emerald-50/75 text-xs dark:divide-emerald-900/50 dark:border-emerald-900/60 dark:bg-emerald-950/35">
          {gridSectionPickers.map((target, targetIdx) => {
            const targetCourse = courseMap?.get(target.courseCode) ?? null;
            const isCourseHidden = Boolean(
              hiddenCourseCodes?.has(target.courseCode),
            );
            const coursePalette = isMultiCoursePicker
              ? MULTI_COURSE_GHOST_PALETTE[
                  targetIdx % MULTI_COURSE_GHOST_PALETTE.length
                ]
              : null;
            const targetScheduledCount = isCourseHidden
              ? 0
              : pickerGhosts.filter((g) => g.courseCode === target.courseCode)
                  .length;
            const targetAsyncSections =
              !isCourseHidden && targetCourse
                ? targetCourse.sections.filter(
                    (s) =>
                      (target.component === "ALL" ||
                        s.component === target.component) &&
                      s.meetings.length === 0,
                  )
                : [];

            return (
              <div
                key={target.courseCode}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <div
                  className={`flex flex-wrap items-center gap-2 transition-opacity ${
                    isCourseHidden ? "opacity-75" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-950 dark:text-emerald-100">
                    {coursePalette && (
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${coursePalette.dot}`}
                      />
                    )}
                    <span>
                      {target.courseCode} (
                      {target.component === "ALL"
                        ? "All Sections"
                        : target.component}
                      )
                    </span>
                    {isCourseHidden && (
                      <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-950 dark:bg-amber-900/70 dark:text-amber-100">
                        Hidden
                      </span>
                    )}
                  </span>
                  {targetIdx === 0 && (
                    <span className="text-[11px] text-emerald-800 dark:text-emerald-300">
                      {isCourseHidden
                        ? "Hidden from grid"
                        : targetScheduledCount > 0
                          ? isEditMode
                            ? "Click any highlighted slot to schedule it"
                            : "Viewing sections — click any slot for details"
                          : "No scheduled time slots for this selection"}
                    </span>
                  )}
                  {targetCourse &&
                    targetCourse.requiredComponents.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setHoveredPickerCrn(null);
                            onChangeGridSectionPickers?.((prev) =>
                              prev.map((item) =>
                                item.courseCode === target.courseCode
                                  ? { ...item, component: "ALL" }
                                  : item,
                              ),
                            );
                          }}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                            target.component === "ALL"
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                              : "bg-white/80 text-zinc-800 hover:bg-white dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          }`}
                        >
                          All
                        </button>
                        {targetCourse.requiredComponents.map((comp) => {
                          const dotColor = coursePalette
                            ? coursePalette.dot
                            : comp === "LAB"
                              ? "bg-orange-500"
                              : comp === "TUT"
                                ? "bg-yellow-500"
                                : "bg-emerald-500";
                          return (
                            <button
                              key={comp}
                              type="button"
                              onClick={() => {
                                setHoveredPickerCrn(null);
                                onChangeGridSectionPickers?.((prev) =>
                                  prev.map((item) =>
                                    item.courseCode === target.courseCode
                                      ? { ...item, component: comp }
                                      : item,
                                  ),
                                );
                              }}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                                target.component === comp
                                  ? "bg-emerald-700 text-white dark:bg-emerald-600"
                                  : "bg-white/80 text-emerald-900 hover:bg-white dark:bg-zinc-900 dark:text-emerald-200 dark:hover:bg-zinc-800"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
                              />
                              <span>{comp}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  {targetAsyncSections.map((sec) =>
                    isEditMode ? (
                      <button
                        key={sec.crn}
                        type="button"
                        onClick={() => {
                          onSelectSection?.(
                            target.courseCode,
                            sec.component,
                            sec.crn,
                          );
                        }}
                        className="rounded-md border border-teal-400 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-50 dark:border-teal-700 dark:bg-zinc-900 dark:text-teal-200"
                      >
                        Schedule {sec.component} CRN {sec.crn} (Async)
                      </button>
                    ) : (
                      <span
                        key={sec.crn}
                        className="rounded-md border border-teal-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-teal-900 dark:border-teal-800 dark:bg-zinc-900 dark:text-teal-200"
                      >
                        {sec.component} CRN {sec.crn} (Async)
                      </span>
                    ),
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isMultiCoursePicker && targetIdx === 0 && (
                    <span className="hidden text-[10.5px] text-emerald-700/80 sm:inline dark:text-emerald-300/80">
                      Esc clears all
                    </span>
                  )}
                  {onToggleCourseVisibility && (
                    <button
                      type="button"
                      onClick={() => {
                        setHoveredPickerCrn(null);
                        onToggleCourseVisibility(target.courseCode);
                      }}
                      className={`shrink-0 cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                        isCourseHidden
                          ? "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200 dark:hover:bg-amber-900/70"
                          : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-200 dark:hover:bg-zinc-800"
                      }`}
                      title={
                        isCourseHidden
                          ? `Show ${target.courseCode} on grid`
                          : `Hide ${target.courseCode} from grid`
                      }
                    >
                      {isCourseHidden ? (
                        <span className="inline-grid place-items-center">
                          <span className="col-start-1 row-start-1">Show</span>
                          <span
                            className="invisible col-start-1 row-start-1"
                            aria-hidden="true"
                          >
                            Hide
                          </span>
                        </span>
                      ) : (
                        <span className="inline-grid place-items-center">
                          <span className="col-start-1 row-start-1">Hide</span>
                          <span
                            className="invisible col-start-1 row-start-1"
                            aria-hidden="true"
                          >
                            Show
                          </span>
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setHoveredPickerCrn(null);
                      onChangeGridSectionPickers?.((prev) =>
                        prev.filter(
                          (item) => item.courseCode !== target.courseCode,
                        ),
                      );
                    }}
                    className="shrink-0 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-200 dark:hover:bg-zinc-800"
                    title={`Remove ${target.courseCode} from grid view (press Esc to clear all)`}
                  >
                    {isMultiCoursePicker ? "Cancel" : "Cancel (Esc)"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Spreadsheet Container */}
      <div
        className={`relative flex flex-1 flex-col overflow-hidden text-xs ${
          fitToHeight ? "min-h-[560px] max-h-[700px]" : "min-h-[820px]"
        }`}
      >
        {/* Top Days Header (Mon–Sun) */}
        <DayHeaderStrip position="top" />

        <div className="relative flex flex-1 select-none">
          {/* Times Column on the Left */}
          <div className="flex w-12 flex-shrink-0 flex-col border-r border-zinc-300 bg-zinc-50/80 font-mono text-[10px] text-zinc-500 sm:w-14 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            {hours.map((hour) => (
              <div
                key={hour}
                className="relative flex flex-1 items-start justify-end border-b border-zinc-200/90 pr-1.5 pt-0.5 dark:border-zinc-800/80"
              >
                <span>{formatHourLabel(hour)}</span>
              </div>
            ))}
          </div>

          {/* 7 Day Columns */}
          <div
            ref={gridBodyRef}
            onPointerDown={startCreateBlockedDrag}
            className="grid flex-1 grid-cols-7 divide-x divide-zinc-200 dark:divide-zinc-800"
          >
            {DAYS_OF_WEEK.map((day) => {
              const dayBlocks = positionedByDay[day.key];
              const dayBlocked = blockedByDay[day.key];
              const dayGhosts = ghostsByDay[day.key];

              return (
                <div key={day.key} className="relative flex flex-1 flex-col">
                  {/* Background Hour Cells */}
                  <div className="absolute inset-0 flex flex-col">
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className={`flex-1 border-b border-zinc-100 dark:border-zinc-900/70 ${
                          isEditMode && isBlockingMode
                            ? "cursor-crosshair hover:bg-rose-500/10"
                            : isEditMode && isCustomBlockDragMode
                              ? "cursor-crosshair hover:bg-teal-500/10"
                              : "pointer-events-none"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Blocked Time Overlays (Draggable & Resizable in Edit Mode) */}
                  <div className="pointer-events-none absolute inset-0 z-10">
                    {dayBlocked.map((slot) => {
                      const sMin = parseTimeToMinutes(slot.startTime);
                      const eMin = parseTimeToMinutes(slot.endTime);
                      const clampedStart = Math.max(sMin, startMinutes);
                      const clampedEnd = Math.min(eMin, endMinutesLimit);
                      if (clampedEnd <= clampedStart) return null;

                      const topPercent =
                        ((clampedStart - startMinutes) / totalMinutes) * 100;
                      const heightPercent =
                        ((clampedEnd - clampedStart) / totalMinutes) * 100;
                      const isDraftBlocked = slot.id.startsWith("__draft_block__");

                      return (
                        <div
                          key={slot.id}
                          data-blocked-slot="true"
                          onPointerDown={(ev) =>
                            startBlockedSlotDrag(ev, slot, "move")
                          }
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                            backgroundImage: isDraggingAny
                              ? "repeating-linear-gradient(135deg, rgba(161,161,170,0.08), rgba(161,161,170,0.08) 6px, rgba(161,161,170,0.16) 6px, rgba(161,161,170,0.16) 12px)"
                              : "repeating-linear-gradient(135deg, rgba(244,63,94,0.08), rgba(244,63,94,0.08) 6px, rgba(244,63,94,0.16) 6px, rgba(244,63,94,0.16) 12px)",
                          }}
                          className={`pointer-events-auto group absolute left-0.5 right-0.5 flex flex-col justify-between overflow-hidden rounded border border-dashed px-1 py-0.5 text-[10px] ${
                            isDraggingAny
                              ? "border-zinc-300/80 bg-zinc-200/40 text-zinc-500 opacity-40 grayscale dark:border-zinc-700/70 dark:bg-zinc-800/40 dark:text-zinc-400"
                              : "border-rose-300/90 text-rose-800 dark:border-rose-700/70 dark:text-rose-200"
                          } ${
                            isEditMode ? "cursor-grab active:cursor-grabbing" : ""
                          } ${isDraftBlocked ? "ring-2 ring-rose-500" : ""}`}
                        >
                          {isEditMode && !isDraftBlocked && (
                            <div
                              data-resize-handle="top"
                              onPointerDown={(ev) =>
                                startBlockedSlotDrag(ev, slot, "resize-top")
                              }
                              className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                              title="Drag to adjust start time"
                            />
                          )}

                          <div className="flex items-center justify-between gap-0.5">
                            <span className="truncate font-medium">
                              {slot.label || "Blocked"}
                            </span>
                            {isEditMode &&
                              !isDraftBlocked &&
                              onRemoveBlockedSlot && (
                                <button
                                  type="button"
                                  data-no-drag="true"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveBlockedSlot(slot.id);
                                  }}
                                  className="shrink-0 rounded px-1 text-[11px] font-bold text-rose-600 hover:bg-rose-200/70 dark:text-rose-300 dark:hover:bg-rose-900/60"
                                  title="Remove blocked time"
                                >
                                  &times;
                                </button>
                              )}
                          </div>
                          <span className="truncate text-[9px] opacity-75 tabular-nums">
                            {formatTimeDisplay(slot.startTime)}–
                            {formatTimeDisplay(slot.endTime)}
                          </span>

                          {isEditMode && !isDraftBlocked && (
                            <div
                              data-resize-handle="bottom"
                              onPointerDown={(ev) =>
                                startBlockedSlotDrag(ev, slot, "resize-bottom")
                              }
                              className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                              title="Drag to adjust end time"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Course Blocks */}
                  <div className="pointer-events-none relative z-20 h-full w-full">
                    {dayBlocks.map(({ block, leftPercent, widthPercent }) => {
                      const cStart = parseTimeToMinutes(block.startTime);
                      const cEnd = parseTimeToMinutes(block.endTime);
                      const clampedStart = Math.max(cStart, startMinutes);
                      const clampedEnd = Math.min(cEnd, endMinutesLimit);
                      if (clampedEnd <= clampedStart) return null;

                      const topPercent =
                        ((clampedStart - startMinutes) / totalMinutes) * 100;
                      const heightPercent =
                        ((clampedEnd - clampedStart) / totalMinutes) * 100;

                      const style = THEME_STYLES[block.color || "blue"];
                      const isPreview = block.mode === "preview";
                      const isDraftCustom =
                        block.id.startsWith("__draft_custom__");
                      const isExploring = block.mode === "exploring";
                      const isConflict = Boolean(block.isConflict);
                      const isHalfWidth = widthPercent <= 55;
                      const blockComp =
                        block.component ??
                        (block.type as CourseComponentType | undefined);
                      const matchedOverlayTarget = dragCourse
                        ? dragCourse.sourceBlock.courseCode === block.courseCode
                          ? {
                              courseCode: dragCourse.sourceBlock.courseCode,
                              component: dragCourse.component,
                            }
                          : undefined
                        : pickerByCourseCode.get(block.courseCode);
                      const isCurrentOverlayBlock =
                        isDraggingAny &&
                        hasActiveGhosts &&
                        Boolean(matchedOverlayTarget) &&
                        !block.isCustom &&
                        block.mode !== "preview" &&
                        (matchedOverlayTarget!.component === "ALL" ||
                          blockComp === matchedOverlayTarget!.component);
                      const isCorrelatedComponent =
                        isDraggingAny &&
                        !isMultiCoursePicker &&
                        Boolean(matchedOverlayTarget) &&
                        !block.isCustom &&
                        block.mode !== "preview" &&
                        matchedOverlayTarget!.component !== "ALL" &&
                        blockComp !== matchedOverlayTarget!.component;

                      return (
                        <div
                          key={block.id}
                          data-custom-block={block.isCustom ? "true" : undefined}
                          onPointerDown={(ev) =>
                            block.isCustom && isEditMode
                              ? startCustomBlockDrag(ev, block, "move")
                              : startCoursePointerDown(ev, block)
                          }
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                            left: `calc(${leftPercent}% + 2px)`,
                            width: `calc(${widthPercent}% - 4px)`,
                          }}
                          className={`pointer-events-auto group absolute overflow-hidden rounded-md p-1 text-[10.5px] transition-all ${
                            isDraggingAny
                              ? isCurrentOverlayBlock
                                ? "opacity-0 pointer-events-none"
                                : isCorrelatedComponent
                                  ? "z-30 border-2 border-blue-500 bg-blue-100/95 text-blue-950 shadow-sm dark:border-blue-400 dark:bg-blue-950/90 dark:text-blue-100"
                                  : "border border-zinc-300 bg-zinc-200/70 text-zinc-500 opacity-40 grayscale dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400"
                              : isPreview
                                ? "z-40 animate-pulse border-2 border-dashed border-blue-500 bg-blue-500/20 text-blue-950 shadow-md dark:text-blue-50"
                                : isConflict
                                  ? "z-30 border-2 border-rose-500 bg-rose-50/95 text-rose-950 shadow-sm hover:z-40 dark:bg-rose-950/90 dark:text-rose-100"
                                  : isExploring
                                    ? `border-2 border-dashed ${style.border} ${style.bg} ${style.text} opacity-90 hover:z-30 hover:opacity-100 hover:shadow-md`
                                    : `border ${style.bg} ${style.border} ${style.text} ${style.hoverBg} hover:z-30 hover:shadow-md`
                          } ${isDraftCustom ? "z-40 ring-2 ring-teal-500" : ""} ${
                            isEditMode && !isPreview
                              ? "cursor-grab active:cursor-grabbing"
                              : !isPreview
                                ? "cursor-pointer"
                                : ""
                          }`}
                          title={`${block.courseCode} — ${block.title} (${formatTimeDisplay(
                            block.startTime,
                          )} – ${formatTimeDisplay(block.endTime)})${
                            block.weekPattern !== "both"
                              ? ` [${block.weekPattern === "week1" ? "Week 1" : "Week 2"}]`
                              : ""
                          }${isExploring ? " • Exploring" : ""}${
                            block.isFull ? " • Warning: Class may be full" : ""
                          }${
                            isConflict
                              ? ` • Conflicts with ${block.conflictWith?.join(", ")}`
                              : ""
                          }`}
                        >
                          {isEditMode && block.isCustom && !isDraftCustom && (
                            <div
                              data-resize-handle="top"
                              onPointerDown={(ev) =>
                                startCustomBlockDrag(ev, block, "resize-top")
                              }
                              className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
                              title="Drag to adjust start time"
                            />
                          )}

                          <div className="flex h-full flex-col justify-between leading-tight">
                            <div>
                              <div className="flex items-start justify-between gap-0.5">
                                <span className="font-clash truncate font-semibold tracking-tight">
                                  {block.courseCode}
                                </span>
                                <div className="flex shrink-0 items-center gap-0.5">
                                  {block.weekPattern !== "both" && (
                                    <span
                                      className={`rounded px-1 text-[8px] font-bold uppercase ${
                                        block.weekPattern === "week1"
                                          ? "bg-blue-600/20 text-blue-900 dark:bg-blue-400/25 dark:text-blue-100"
                                          : "bg-purple-600/20 text-purple-900 dark:bg-purple-400/25 dark:text-purple-100"
                                      }`}
                                    >
                                      {block.weekPattern === "week1"
                                        ? "W1"
                                        : "W2"}
                                    </span>
                                  )}
                                  {block.type && !isHalfWidth && (
                                    <span className="rounded bg-black/10 px-1 text-[8.5px] font-medium dark:bg-white/10">
                                      {block.type}
                                    </span>
                                  )}
                                  {isEditMode &&
                                    !isPreview &&
                                    !isDraftCustom &&
                                    onRemoveBlock && (
                                      <button
                                        type="button"
                                        data-no-drag="true"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRemoveBlock(block);
                                        }}
                                        className="rounded px-1 text-[11px] font-bold leading-none text-zinc-600 hover:bg-rose-500 hover:text-white dark:text-zinc-300"
                                        title={`Remove ${block.courseCode} ${block.type ?? ""}`}
                                      >
                                        &times;
                                      </button>
                                    )}
                                </div>
                              </div>
                              <p className="line-clamp-1 text-[9.5px] opacity-80">
                                {isConflict ? (
                                  "⚠ Conflict"
                                ) : block.isFull ? (
                                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                                    ⚠ May be full
                                  </span>
                                ) : isExploring ? (
                                  `Exploring • ${block.type || ""}`
                                ) : (
                                  block.title
                                )}
                              </p>
                            </div>

                            <div className="flex items-center justify-between gap-1 text-[9px]">
                              <span className="truncate opacity-75">
                                {block.room || "TBA"}
                              </span>
                              <div className="flex shrink-0 items-center gap-1">
                                {!isHalfWidth && (!showRmp || !block.rmp) && (
                                  <span className="shrink-0 tabular-nums opacity-75">
                                    {formatTimeDisplay(block.startTime)}
                                  </span>
                                )}
                                {showRmp && (
                                  <RmpStarBadge rmp={block.rmp} compact />
                                )}
                              </div>
                            </div>
                          </div>

                          {isEditMode && block.isCustom && !isDraftCustom && (
                            <div
                              data-resize-handle="bottom"
                              onPointerDown={(ev) =>
                                startCustomBlockDrag(ev, block, "resize-bottom")
                              }
                              className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
                              title="Drag to adjust end time"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Ghost Snap Target Slots during Course Block Drag or Click-to-Schedule */}
                  {(dragCourse || hasGridPickers) && dayGhosts.length > 0 && (
                    <div
                      className={`${
                        isPickerOverlay
                          ? "pointer-events-auto"
                          : "pointer-events-none"
                      } absolute inset-0 z-40`}
                    >
                      {dayGhosts.map(({ ghost: g, leftPercent, widthPercent }, idx) => {
                        const clampedStart = Math.max(
                          g.startMinutes,
                          startMinutes,
                        );
                        const clampedEnd = Math.min(
                          g.endMinutes,
                          endMinutesLimit,
                        );
                        if (clampedEnd <= clampedStart) return null;

                        const topPercent =
                          ((clampedStart - startMinutes) / totalMinutes) * 100;
                        const heightPercent =
                          ((clampedEnd - clampedStart) / totalMinutes) * 100;
                        const isHovered = dragCourse
                          ? dragCourse.hoveredCrn === g.crn
                          : hoveredPickerCrn === g.crn;
                        const showComponentInHeader =
                          isMultiCoursePicker ||
                          pickerByCourseCode.get(g.courseCode)?.component ===
                            "ALL";

                        const handleGhostActivate = (
                          ev?: React.SyntheticEvent<HTMLElement>,
                        ) => {
                          if (!hasGridPickers) return;
                          if (
                            canPickOnGrid &&
                            g.groupedOptions &&
                            g.groupedOptions.length > 1 &&
                            !g.isCurrent
                          ) {
                            const rect =
                              ev?.currentTarget.getBoundingClientRect();
                            const spaceBelow = rect
                              ? window.innerHeight - rect.bottom
                              : 300;
                            const placeBelow =
                              !rect || spaceBelow >= 240 || spaceBelow >= rect.top;
                            const left = rect
                              ? Math.max(
                                  12,
                                  Math.min(rect.left, window.innerWidth - 300),
                                )
                              : 16;
                            setSlotGroupPicker({
                              options: g.groupedOptions,
                              anchor: rect
                                ? placeBelow
                                  ? { left, top: rect.bottom + 6 }
                                  : {
                                      left,
                                      bottom: window.innerHeight - rect.top + 6,
                                    }
                                : { left: 16, top: 80 },
                            });
                            return;
                          }
                          if (canPickOnGrid) {
                            onSelectSection?.(g.courseCode, g.component, g.crn);
                            return;
                          }
                          setSelectedCourse({
                            id: g.id,
                            courseCode: g.section.courseCode,
                            title: g.section.title,
                            type: g.component,
                            component: g.component,
                            crn: g.crn,
                            room: g.room,
                            instructor: g.section.instructor ?? undefined,
                            rmp: g.section.rmp ?? null,
                            day: g.day,
                            startTime: g.startTime,
                            endTime: g.endTime,
                            weekPattern: g.weekPattern,
                            deliveryMode: g.section.deliveryMode,
                            color:
                              g.component === "LAB"
                                ? "orange"
                                : g.component === "TUT"
                                  ? "amber"
                                  : "emerald",
                            isConflict: !g.fits,
                            conflictWith:
                              g.conflictsWith.length > 0
                                ? g.conflictsWith
                                : undefined,
                          });
                        };
                        const compAlreadySelected =
                          isPickerOverlay &&
                          !g.isCurrent &&
                          componentsWithCurrent.has(
                            `${g.courseCode}:${g.component}`,
                          );

                        return (
                          <div
                            key={`${g.id}-${idx}`}
                            data-ghost-crn={g.crn}
                            role={isPickerOverlay ? "button" : undefined}
                            tabIndex={isPickerOverlay ? 0 : undefined}
                            onMouseEnter={
                              isPickerOverlay
                                ? () => setHoveredPickerCrn(g.crn)
                                : undefined
                            }
                            onMouseLeave={
                              isPickerOverlay
                                ? () => setHoveredPickerCrn(null)
                                : undefined
                            }
                            onClick={
                              isPickerOverlay
                                ? (ev) => {
                                    ev.stopPropagation();
                                    handleGhostActivate(ev);
                                  }
                                : undefined
                            }
                            onKeyDown={
                              isPickerOverlay
                                ? (ev) => {
                                    if (ev.key === "Enter" || ev.key === " ") {
                                      ev.preventDefault();
                                      ev.stopPropagation();
                                      handleGhostActivate(ev);
                                    }
                                  }
                                : undefined
                            }
                            style={{
                              top: `${topPercent}%`,
                              height: `${heightPercent}%`,
                              left: `calc(${leftPercent}% + 2px)`,
                              width: `calc(${widthPercent}% - 4px)`,
                            }}
                            title={
                              isPickerOverlay
                                ? canPickOnGrid
                                  ? `Click to schedule ${g.label} (${formatTimeDisplay(g.startTime)}–${formatTimeDisplay(g.endTime)} • ${g.room})`
                                  : `Click to view ${g.label} (${formatTimeDisplay(g.startTime)}–${formatTimeDisplay(g.endTime)} • ${g.room})`
                                : undefined
                            }
                            className={`absolute flex flex-col justify-between overflow-hidden rounded-md border-2 border-dashed p-1 text-[10px] transition ${
                              isPickerOverlay ? "cursor-pointer" : ""
                            } ${
                              g.isCurrent
                                ? `z-40 ${
                                    g.fits
                                      ? getFittingGhostClasses(
                                          g.component,
                                          isHovered,
                                          g.multiColorIndex,
                                        )
                                      : isHovered
                                        ? "z-50 border-rose-600 bg-rose-500/35 text-rose-950 ring-2 ring-rose-500 shadow-md dark:border-rose-400 dark:bg-rose-900/80 dark:text-rose-50"
                                        : "border-rose-500 bg-rose-500/20 text-rose-950 dark:border-rose-400 dark:bg-rose-950/75 dark:text-rose-100"
                                  }`
                                : compAlreadySelected
                                  ? isHovered
                                    ? "z-50 border-slate-500 bg-slate-300/80 text-slate-900 ring-2 ring-slate-400 shadow-md dark:border-slate-400 dark:bg-slate-700/85 dark:text-slate-100"
                                    : "border-slate-400/90 bg-slate-200/75 text-slate-700 opacity-80 dark:border-slate-500/80 dark:bg-slate-800/75 dark:text-slate-300"
                                  : g.fits
                                    ? getFittingGhostClasses(
                                        g.component,
                                        isHovered,
                                        g.multiColorIndex,
                                      )
                                    : isHovered
                                      ? "z-50 border-rose-600 bg-rose-500/35 text-rose-950 ring-2 ring-rose-500 shadow-md dark:border-rose-400 dark:bg-rose-900/80 dark:text-rose-50"
                                      : "border-rose-500 bg-rose-500/20 text-rose-950 dark:border-rose-400 dark:bg-rose-950/75 dark:text-rose-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 font-semibold">
                              <span className="truncate">
                                {g.groupedOptions &&
                                g.groupedOptions.length > 1 &&
                                !g.isCurrent
                                  ? (() => {
                                      const noun =
                                        g.component === "TUT"
                                          ? "Tutorials"
                                          : g.component === "LAB"
                                            ? "Labs"
                                            : g.component === "LEC"
                                              ? "Lectures"
                                              : g.component === "SEM"
                                                ? "Seminars"
                                                : "Sections";
                                      return isMultiCoursePicker
                                        ? `${g.courseCode} · ${g.groupedOptions.length} ${noun}`
                                        : `${g.groupedOptions.length} ${noun}`;
                                    })()
                                  : isMultiCoursePicker
                                    ? `${g.courseCode} ${g.component}`
                                    : showComponentInHeader
                                      ? `${g.component} ${g.crn}`
                                      : `CRN ${g.crn}`}
                              </span>
                              {(!g.groupedOptions ||
                                g.groupedOptions.length === 1 ||
                                g.isCurrent) &&
                                g.weekPattern !== "both" && (
                                  <span className="shrink-0 rounded bg-black/15 px-1 text-[8px] uppercase">
                                    {g.weekPattern === "week1" ? "W1" : "W2"}
                                  </span>
                                )}
                            </div>
                            <span className="truncate text-[9px] opacity-85">
                              {g.isCurrent
                                ? `✓ Current ${g.component}`
                                : g.groupedOptions &&
                                    g.groupedOptions.length > 1
                                  ? `Click to choose (${g.groupedOptions.length})`
                                  : compAlreadySelected
                                    ? `${g.room} • ${g.fits ? "Switch" : "Conflict"}`
                                    : g.fits
                                      ? `${g.room} • Fits`
                                      : `${g.room} • Conflict`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Days Header (Mon–Sun) */}
        <DayHeaderStrip position="bottom" />
      </div>

      {/* Selected Block Inspector Modal */}
      {selectedCourse && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedCourse(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                      THEME_STYLES[selectedCourse.color || "blue"].bg
                    } ${THEME_STYLES[selectedCourse.color || "blue"].text}`}
                  >
                    {selectedCourse.type || "Class"}
                  </span>
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {selectedCourse.weekPattern === "both"
                      ? "Every Week"
                      : selectedCourse.weekPattern === "week1"
                        ? "Week 1 (Odd Weeks)"
                        : "Week 2 (Even Weeks)"}
                  </span>
                  {selectedCourse.mode === "exploring" && (
                    <span className="rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Exploring
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {selectedCourse.courseCode}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selectedCourse.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                &times;
              </button>
            </div>

            {selectedCourse.isConflict && selectedCourse.conflictWith && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                Conflicts with:{" "}
                <span className="font-semibold">
                  {selectedCourse.conflictWith.join(", ")}
                </span>
              </div>
            )}

            <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Day &amp; Time</span>
                <span className="font-medium capitalize text-zinc-800 dark:text-zinc-200">
                  {selectedCourse.day} &bull;{" "}
                  {formatTimeDisplay(selectedCourse.startTime)} &ndash;{" "}
                  {formatTimeDisplay(selectedCourse.endTime)}
                </span>
              </div>
              {selectedCourse.room && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Room</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedCourse.room}
                  </span>
                </div>
              )}
              {selectedCourse.instructor && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-500">Instructor</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {selectedCourse.instructor}
                    </span>
                    {showRmp && <RmpStarBadge rmp={selectedCourse.rmp} />}
                  </div>
                </div>
              )}
              {selectedCourse.crn && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">CRN</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">
                    {selectedCourse.crn}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-2">
              {isEditMode && onRemoveBlock && (
                <button
                  type="button"
                  onClick={() => {
                    onRemoveBlock(selectedCourse);
                    setSelectedCourse(null);
                  }}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                >
                  {selectedCourse.isCustom
                    ? "Remove Block"
                    : `Remove ${selectedCourse.type || "Section"}`}
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {isEditMode &&
                  selectedCourse.mode === "exploring" &&
                  onPromoteCourse && (
                    <button
                      type="button"
                      onClick={() => {
                        onPromoteCourse(selectedCourse.courseCode);
                        setSelectedCourse(null);
                      }}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      Add Officially
                    </button>
                  )}
                {!hasGridPickers &&
                  !selectedCourse.isCustom &&
                  onChangeGridSectionPickers &&
                  courseMap?.has(selectedCourse.courseCode) && (
                    <button
                      type="button"
                      onClick={() => {
                        const comp =
                          selectedCourse.component ??
                          (selectedCourse.type as
                            | CourseComponentType
                            | undefined);
                        if (!comp) return;
                        onChangeGridSectionPickers([
                          {
                            courseCode: selectedCourse.courseCode,
                            component: comp,
                          },
                        ]);
                        setSelectedCourse(null);
                      }}
                      className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                    >
                      See All Sections
                    </button>
                  )}
                {isEditMode && !selectedCourse.isCustom && onInspectCourse && (
                  <button
                    type="button"
                    onClick={() => {
                      onInspectCourse(selectedCourse.courseCode);
                      setSelectedCourse(null);
                    }}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Switch Section
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCourse(null)}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Grouped Timeslot Section Chooser Popover */}
      {slotGroupPicker && (() => {
        const first = slotGroupPicker.options[0];
        const hasDiffWeeks =
          new Set(slotGroupPicker.options.map((o) => o.weekPattern)).size > 1 ||
          slotGroupPicker.options.some((o) => o.weekPattern !== "both");
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setSlotGroupPicker(null)}
            />
            <div
              style={{
                left: slotGroupPicker.anchor.left,
                top: slotGroupPicker.anchor.top,
                bottom: slotGroupPicker.anchor.bottom,
              }}
              className="fixed z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-800">
                <div>
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {first.courseCode} · Choose {first.component}
                  </div>
                  <div className="text-[10.5px] text-zinc-500">
                    {formatTimeDisplay(first.startTime)}–
                    {formatTimeDisplay(first.endTime)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSlotGroupPicker(null)}
                  className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  ×
                </button>
              </div>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                {slotGroupPicker.options.map((opt) => (
                  <button
                    key={opt.crn}
                    type="button"
                    onClick={() => {
                      onSelectSection?.(opt.courseCode, opt.component, opt.crn);
                      setSlotGroupPicker(null);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                      opt.fits
                        ? "border-zinc-200 bg-zinc-50/70 hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:border-emerald-700"
                        : "border-rose-200 bg-rose-50/60 hover:border-rose-400 dark:border-rose-900/60 dark:bg-rose-950/30"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                        <span>CRN {opt.crn}</span>
                        {hasDiffWeeks && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              opt.weekPattern === "week1"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200"
                                : opt.weekPattern === "week2"
                                  ? "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-200"
                                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {opt.weekPattern === "week1"
                              ? "Week 1"
                              : opt.weekPattern === "week2"
                                ? "Week 2"
                                : "Every week"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
                        {opt.room}
                        {opt.section.seatsAvailable !== null
                          ? ` · ${opt.section.seatsAvailable} seats`
                          : ""}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[10.5px] font-semibold ${
                        opt.fits
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {opt.fits ? "Pick" : "Conflict"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
