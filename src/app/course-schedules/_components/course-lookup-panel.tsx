"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { evalPrereq, matchesBucket } from "@/lib/degree-planner";
import type { ElectiveMatch } from "@/lib/degree-types";
import {
  DAYS_OF_WEEK,
  ELECTIVE_PRESETS,
  THEME_STYLES,
  checkSectionFit,
  findValidSectionComboForCourse,
  formatTimeDisplay,
  type BlockedTimeSlot,
  type ColorTheme,
  type CourseComponentType,
  type DayOfWeek,
  type PlannedCourseEntry,
  type ScheduleBlock,
  type ScheduleCourseGroup,
  type ScheduleSection,
  type SectionGridPickerComponent,
  type SectionGridPickerTarget,
  type SectionRmpInfo,
  type TermScheduleCatalog,
} from "../types";
import { RmpStarBadge } from "./rmp-badge";

interface CourseLookupPanelProps {
  catalog: TermScheduleCatalog;
  courseMap: Map<string, ScheduleCourseGroup>;
  plannedCourses: PlannedCourseEntry[];
  activeBlocks: ScheduleBlock[];
  customBlocks: ScheduleBlock[];
  blockedSlots: BlockedTimeSlot[];
  completedCourses: string[];
  expandedCompletedSet: Set<string>;
  programElectives?: Array<{ id: string; label: string; match: ElectiveMatch }>;
  focusedCourseCode: string | null;
  hydratedKey?: string | null;
  gridSectionPicker?: SectionGridPickerTarget | null;
  onChangeGridSectionPicker?: (target: SectionGridPickerTarget | null) => void;
  isEditMode: boolean;
  onEnableEditMode: () => void;
  onClearPlanner: () => void;
  onClearFocus: () => void;
  onAddCourse: (
    courseCode: string,
    mode: "planned" | "exploring",
    preferredCrns?: Record<string, string>,
  ) => void;
  onSelectSection: (
    courseCode: string,
    component: CourseComponentType,
    crn: string,
  ) => void;
  onRemoveCourse: (courseCode: string) => void;
  onSetCourseMode: (courseCode: string, mode: "planned" | "exploring") => void;
  onToggleCourseVisibility: (courseCode: string) => void;
  onChangeCourseColor: (courseCode: string, color: ColorTheme) => void;
  onAutoFitAll: () => void;
  onAddCustomBlock: (block: ScheduleBlock) => void;
  onRemoveCustomBlock: (id: string) => void;
  onAddCompletedCourse: (code: string) => void;
  onRemoveCompletedCourse: (code: string) => void;
  onHoverSection: (section: ScheduleSection | null) => void;
}

const COMPONENT_LABELS: Record<CourseComponentType, string> = {
  LEC: "Lecture",
  LAB: "Lab",
  TUT: "Tutorial",
  SEM: "Seminar",
  OTHER: "Other",
};

function describeSectionSlots(sec: ScheduleSection): string {
  if (sec.isAsync || sec.meetings.length === 0) {
    return sec.isOnline ? "Asynchronous Online (No fixed time)" : "TBA / Unscheduled";
  }
  const dayShort: Record<DayOfWeek, string> = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  };

  // Group identical time + room across multiple days
  const grouped = new Map<string, string[]>();
  for (const m of sec.meetings) {
    const key = `${m.startTime}|${m.endTime}|${m.location}`;
    const list = grouped.get(key) ?? [];
    list.push(dayShort[m.day]);
    grouped.set(key, list);
  }

  return [...grouped.entries()]
    .map(([key, days]) => {
      const [s, e, loc] = key.split("|");
      const timeRange = `${formatTimeDisplay(s)}–${formatTimeDisplay(e)}`;
      return [days.join("/"), timeRange, loc].filter(Boolean).join(" · ");
    })
    .join(" • ");
}

function getCourseCardRmp(
  course: ScheduleCourseGroup | undefined,
  entry?: PlannedCourseEntry,
  fallbackToCatalog = false,
): SectionRmpInfo | null {
  if (!course) return null;

  if (entry) {
    for (const comp of course.requiredComponents) {
      const crn = entry.selectedCrns[comp];
      if (!crn) continue;
      const sec = course.sections.find((s) => s.crn === crn);
      if (sec?.rmp?.avgRating != null) return sec.rmp;
    }
    for (const crn of Object.values(entry.selectedCrns)) {
      if (!crn) continue;
      const sec = course.sections.find((s) => s.crn === crn);
      if (sec?.rmp?.avgRating != null) return sec.rmp;
    }
  }

  if (!fallbackToCatalog) return null;

  const ratedLec = course.sections.find(
    (s) => s.component === "LEC" && s.rmp?.avgRating != null,
  );
  if (ratedLec?.rmp) return ratedLec.rmp;

  const anyRated = course.sections.find((s) => s.rmp?.avgRating != null);
  return anyRated?.rmp ?? null;
}

export function CourseLookupPanel({
  catalog,
  courseMap,
  plannedCourses,
  activeBlocks,
  customBlocks,
  blockedSlots,
  completedCourses,
  expandedCompletedSet,
  programElectives = [],
  focusedCourseCode,
  hydratedKey = null,
  gridSectionPicker = null,
  onChangeGridSectionPicker,
  isEditMode,
  onClearPlanner,
  onClearFocus,
  onAddCourse,
  onSelectSection,
  onRemoveCourse,
  onSetCourseMode,
  onToggleCourseVisibility,
  onChangeCourseColor,
  onAutoFitAll,
  onAddCustomBlock,
  onRemoveCustomBlock,
  onAddCompletedCourse,
  onRemoveCompletedCourse,
  onHoverSection,
}: CourseLookupPanelProps) {
  const [panelTab, setPanelTab] = useState<"search" | "planned">("planned");
  const lastAutoTabKeyRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [electiveId, setElectiveId] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  // Smart filters
  const [filterFits, setFilterFits] = useState(false);
  const [filterPrereq, setFilterPrereq] = useState(false);
  const [filterOnline, setFilterOnline] = useState(false);
  const [filterAsync, setFilterAsync] = useState(false);
  const [filterLectureOnly, setFilterLectureOnly] = useState(false);
  const [filterOpenSeats, setFilterOpenSeats] = useState(false);
  const [filterBiweekly, setFilterBiweekly] = useState(false);

  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeCompTab, setActiveCompTab] = useState<
    Record<string, CourseComponentType>
  >({});
  const [visibleLimit, setVisibleLimit] = useState(30);

  // Completed courses editor popover
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completedInput, setCompletedInput] = useState("");

  // Custom block form
  const [customOpen, setCustomOpen] = useState(false);
  const [cxCode, setCxCode] = useState("");
  const [cxTitle, setCxTitle] = useState("");
  const [cxDay, setCxDay] = useState<DayOfWeek>("monday");
  const [cxStart, setCxStart] = useState("12:00");
  const [cxEnd, setCxEnd] = useState("13:00");
  const [cxRoom, setCxRoom] = useState("");
  const [cxWeek, setCxWeek] = useState<"both" | "week1" | "week2">("both");
  const [cxColor, setCxColor] = useState<ColorTheme>("teal");

  // Auto-select Course Lookup when hydrated with no courses; otherwise keep My Courses first
  useEffect(() => {
    if (!hydratedKey || lastAutoTabKeyRef.current === hydratedKey) return;
    lastAutoTabKeyRef.current = hydratedKey;
    if (plannedCourses.length === 0 && customBlocks.length === 0) {
      setPanelTab("search");
    } else {
      setPanelTab("planned");
    }
  }, [hydratedKey, plannedCourses.length, customBlocks.length]);

  // React to "Switch Section" click from the timetable grid
  useEffect(() => {
    if (!focusedCourseCode) return;
    const timer = setTimeout(() => {
      setPanelTab("planned");
      setExpandedCourses((prev) => new Set(prev).add(focusedCourseCode));
      onClearFocus();
    }, 0);
    return () => clearTimeout(timer);
  }, [focusedCourseCode, onClearFocus]);

  const plannedByCode = useMemo(
    () => new Map(plannedCourses.map((p) => [p.courseCode, p])),
    [plannedCourses],
  );

  const allElectiveOptions = useMemo(() => {
    const seenIds = new Set<string>();
    const combined: Array<{ id: string; label: string; match: ElectiveMatch }> = [];
    for (const pe of programElectives) {
      const id = `prog:${pe.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      combined.push({
        id,
        label: `Program: ${pe.label}`,
        match: pe.match,
      });
    }
    for (const p of ELECTIVE_PRESETS) {
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      combined.push({
        id: p.id,
        label: p.label,
        match: p.match,
      });
    }
    return combined;
  }, [programElectives]);

  const activeElectiveMatch = useMemo(() => {
    if (electiveId === "all") return null;
    return allElectiveOptions.find((o) => o.id === electiveId)?.match ?? null;
  }, [electiveId, allElectiveOptions]);

  // Evaluate schedule fit & prereq status lazily for matching courses
  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    const compactQ = q.replace(/\s+/g, "");

    const matched: Array<{
      course: ScheduleCourseGroup;
      prereqStatus: boolean | null;
      missingPrereqs: string[];
      fitCombo: Record<string, string> | null;
    }> = [];

    for (const course of catalog.courses) {
      if (subjectFilter !== "all" && course.subject !== subjectFilter) {
        continue;
      }

      if (levelFilter !== "all") {
        if (levelFilter === "3000+") {
          if (course.level < 3000) continue;
        } else if (levelFilter === "5000+") {
          if (course.level < 5000) continue;
        } else if (course.level !== Number(levelFilter)) {
          continue;
        }
      }

      if (activeElectiveMatch) {
        const asCatalogLike = {
          code: course.courseCode,
          subject: course.subject,
          number: course.courseNumber,
          subject_course: `${course.subject}${course.courseNumber}`,
          level: course.level,
          faculty: course.faculty,
          subject_name: course.subjectName,
          title: course.title,
          short_title: null,
          credit_hours: course.creditHours,
          terms_offered: [],
          sections_in_offerings: course.sections.length,
          prerequisite_codes: course.prerequisiteCodes,
          prerequisite_text: course.prerequisiteText,
          prerequisite_ast: course.prerequisiteAst,
          calendar_url: null,
        };
        if (!matchesBucket(asCatalogLike, activeElectiveMatch)) {
          continue;
        }
      }

      if (filterOnline && !course.isFullyOnlineCapable) continue;
      if (filterAsync && !course.isFullyAsyncCapable) continue;
      if (filterLectureOnly && !course.isLectureOnly) continue;
      if (filterOpenSeats && !course.hasOpenSeats) continue;
      if (filterBiweekly && !course.hasBiweeklyComponent) continue;

      if (q) {
        const codeMatch =
          course.courseCode.toLowerCase().includes(q) ||
          `${course.subject}${course.courseNumber}`
            .toLowerCase()
            .includes(compactQ);
        const titleMatch = course.title.toLowerCase().includes(q);
        const descMatch = (course.description ?? "").toLowerCase().includes(q);
        const secMatch = course.sections.some(
          (s) =>
            s.crn.includes(q) ||
            (s.instructor ?? "").toLowerCase().includes(q),
        );
        if (!codeMatch && !titleMatch && !descMatch && !secMatch) continue;
      }

      const prereqStatus = evalPrereq(
        course.prerequisiteAst,
        expandedCompletedSet,
      );
      if (filterPrereq && prereqStatus === false) continue;

      const missingPrereqs =
        prereqStatus === false
          ? course.prerequisiteCodes.filter(
              (dep) => !expandedCompletedSet.has(dep),
            )
          : [];

      const fitCombo = findValidSectionComboForCourse(
        course,
        activeBlocks,
        blockedSlots,
        {
          requireOnline: filterOnline,
          requireAsync: filterAsync,
          requireOpenSeats: filterOpenSeats,
          ignoreCourseCode: course.courseCode,
        },
      );

      if (filterFits && !fitCombo) continue;

      matched.push({
        course,
        prereqStatus,
        missingPrereqs,
        fitCombo,
      });
    }

    return matched;
  }, [
    catalog.courses,
    query,
    activeElectiveMatch,
    subjectFilter,
    levelFilter,
    filterFits,
    filterPrereq,
    filterOnline,
    filterAsync,
    filterLectureOnly,
    filterOpenSeats,
    filterBiweekly,
    expandedCompletedSet,
    activeBlocks,
    blockedSlots,
  ]);

  const toggleExpandCourse = (code: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleExpandDescription = (code: string) => {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleAddAndPromptSections = (
    course: ScheduleCourseGroup,
    mode: "planned" | "exploring",
  ) => {
    onAddCourse(course.courseCode, mode);
    const firstMultiComp = course.requiredComponents.find(
      (comp) => course.sections.filter((s) => s.component === comp).length > 1,
    );
    if (firstMultiComp) {
      setActiveCompTab((prev) => ({
        ...prev,
        [course.courseCode]: firstMultiComp,
      }));
      setExpandedCourses((prev) => new Set(prev).add(course.courseCode));
    }
  };

  const handleAddCompletedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = completedInput.trim().toUpperCase();
    if (!raw) return;
    const normalized = raw.replace(/\s+/g, " ");
    onAddCompletedCourse(normalized);
    setCompletedInput("");
  };

  const handleCreateCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cxCode.trim()) return;
    onAddCustomBlock({
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      courseCode: cxCode.trim().toUpperCase(),
      title: cxTitle.trim() || cxCode.trim().toUpperCase(),
      type: "CUSTOM",
      day: cxDay,
      startTime: cxStart,
      endTime: cxEnd,
      room: cxRoom.trim() || undefined,
      weekPattern: cxWeek,
      mode: "planned",
      color: cxColor,
      isCustom: true,
    });
    setCxCode("");
    setCxTitle("");
    setCxRoom("");
    setCustomOpen(false);
  };

  const toggleGridPickerForCourse = (
    course: ScheduleCourseGroup,
    explicitComp?: SectionGridPickerComponent,
  ) => {
    if (!onChangeGridSectionPicker) return;
    if (!explicitComp) {
      if (gridSectionPicker?.courseCode === course.courseCode) {
        onChangeGridSectionPicker(null);
        return;
      }
      const targetComp: SectionGridPickerComponent | undefined =
        course.requiredComponents.length > 1
          ? "ALL"
          : course.requiredComponents[0];
      if (!targetComp) return;
      onChangeGridSectionPicker({
        courseCode: course.courseCode,
        component: targetComp,
      });
      return;
    }

    const isAlreadyActive =
      gridSectionPicker?.courseCode === course.courseCode &&
      gridSectionPicker?.component === explicitComp;
    onChangeGridSectionPicker(
      isAlreadyActive
        ? null
        : { courseCode: course.courseCode, component: explicitComp },
    );
  };

  const renderSectionPicker = (
    course: ScheduleCourseGroup,
    entry?: PlannedCourseEntry,
  ) => {
    const components = course.requiredComponents;
    if (components.length === 0) {
      return (
        <p className="py-2 text-[11px] text-zinc-500">
          No sections available in {catalog.termLabel}.
        </p>
      );
    }

    const activeComp =
      activeCompTab[course.courseCode] &&
      components.includes(activeCompTab[course.courseCode])
        ? activeCompTab[course.courseCode]
        : components[0];

    const sections = course.sections.filter((s) => s.component === activeComp);
    const isGridActiveForComp =
      gridSectionPicker?.courseCode === course.courseCode &&
      gridSectionPicker?.component === activeComp;

    return (
      <div className="mt-2.5 rounded-lg border border-zinc-200 bg-zinc-50/80 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
        {/* Component Tabs & See All on Grid */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
          <div className="flex flex-wrap items-center gap-1">
            {components.map((comp) => {
              const count = course.sections.filter(
                (s) => s.component === comp,
              ).length;
              const selectedCrn = entry?.selectedCrns[comp];
              return (
                <button
                  key={comp}
                  type="button"
                  onClick={() => {
                    setActiveCompTab((prev) => ({
                      ...prev,
                      [course.courseCode]: comp,
                    }));
                    if (gridSectionPicker?.courseCode === course.courseCode) {
                      onChangeGridSectionPicker?.({
                        courseCode: course.courseCode,
                        component: comp,
                      });
                    }
                  }}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    activeComp === comp
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  <span>{COMPONENT_LABELS[comp]}</span>
                  <span className="opacity-70">({count})</span>
                  {selectedCrn && (
                    <span className="ml-0.5 rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-300">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {onChangeGridSectionPicker && (
            <div className="flex items-center gap-1">
              {components.length > 1 && (
                <button
                  type="button"
                  onClick={() => toggleGridPickerForCourse(course, "ALL")}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                    gridSectionPicker?.courseCode === course.courseCode &&
                    gridSectionPicker?.component === "ALL"
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                  title="Show all Lectures, Labs, and Tutorials for this course on the timetable at once"
                >
                  {gridSectionPicker?.courseCode === course.courseCode &&
                  gridSectionPicker?.component === "ALL"
                    ? "Hide All"
                    : "All on Grid"}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleGridPickerForCourse(course, activeComp)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  isGridActiveForComp
                    ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                }`}
                title="Highlight all sections of this component on the timetable"
              >
                {isGridActiveForComp ? "Hide Grid" : `See ${activeComp} on Grid`}
              </button>
            </div>
          )}
        </div>

        {/* Section Options */}
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
          {sections.map((sec) => {
            const isSelected = entry?.selectedCrns[activeComp] === sec.crn;
            const fit = checkSectionFit(
              sec,
              activeBlocks,
              blockedSlots,
              course.courseCode,
              sec.component,
            );

            return (
              <button
                key={sec.crn}
                type="button"
                onMouseEnter={() => onHoverSection(sec)}
                onMouseLeave={() => onHoverSection(null)}
                onClick={() => {
                  if (!isEditMode) return;
                  onHoverSection(null);
                  if (entry) {
                    onSelectSection(course.courseCode, sec.component, sec.crn);
                  } else {
                    onAddCourse(course.courseCode, "planned", {
                      [sec.component]: sec.crn,
                    });
                  }
                }}
                className={`flex w-full flex-col gap-1 rounded-lg border p-2 text-left text-[11px] transition ${
                  !isEditMode ? "cursor-default" : "cursor-pointer"
                } ${
                  isSelected
                    ? "border-blue-500 bg-blue-50/90 ring-1 ring-blue-500/30 dark:border-blue-600 dark:bg-blue-950/60"
                    : fit.fits
                      ? "border-zinc-200 bg-white hover:border-blue-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-700"
                      : "border-rose-200/80 bg-rose-50/40 hover:border-rose-400 dark:border-rose-900/50 dark:bg-rose-950/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      CRN {sec.crn}
                    </span>
                    {sec.sequenceNumber && (
                      <span className="rounded bg-zinc-100 px-1 py-0.2 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        Sec {sec.sequenceNumber}
                      </span>
                    )}
                    {sec.linkIdentifier && (
                      <span className="rounded bg-zinc-100 px-1 py-0.2 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Link {sec.linkIdentifier}
                      </span>
                    )}
                    {sec.weekPattern !== "both" && (
                      <span
                        className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                          sec.weekPattern === "week1"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                            : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200"
                        }`}
                      >
                        {sec.weekPattern === "week1" ? "Week 1" : "Week 2"}
                      </span>
                    )}
                    {sec.isAsync ? (
                      <span className="rounded bg-teal-100 px-1.5 py-0.2 text-[9px] font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200">
                        Async
                      </span>
                    ) : sec.isOnline ? (
                      <span className="rounded bg-cyan-100 px-1.5 py-0.2 text-[9px] font-medium text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
                        Online
                      </span>
                    ) : null}
                  </div>

                  <span
                    className={`shrink-0 text-[10px] font-medium ${
                      isSelected
                        ? "text-blue-700 dark:text-blue-300"
                        : fit.fits
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {isSelected
                      ? "Selected"
                      : fit.fits
                        ? fit.pairedBiweeklyWith.length > 0
                          ? "Side-by-side W1/W2"
                          : "✓ Fits"
                        : `⚠ Conflicts`}
                  </span>
                </div>

                <div className="text-[11px] text-zinc-700 dark:text-zinc-300">
                  {describeSectionSlots(sec)}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>{sec.instructor || "Instructor TBA"}</span>
                  <div className="flex items-center gap-1.5">
                    <span>
                      Seats:{" "}
                      <strong
                        className={
                          (sec.seatsAvailable ?? 0) > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }
                      >
                        {sec.seatsAvailable ?? "—"}
                      </strong>
                      /{sec.maximumEnrollment ?? "—"}
                    </span>
                    <RmpStarBadge rmp={sec.rmp} interactive={false} />
                  </div>
                </div>

                {!fit.fits && fit.conflictsWith.length > 0 && (
                  <div className="text-[10px] text-rose-600 dark:text-rose-400">
                    Overlaps: {fit.conflictsWith.join(", ")}
                  </div>
                )}
                {fit.fits && fit.pairedBiweeklyWith.length > 0 && (
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400">
                    Alternates opposite week with:{" "}
                    {fit.pairedBiweeklyWith.join(", ")}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const plannedOfficial = plannedCourses.filter((c) => c.mode === "planned");
  const exploringOnly = plannedCourses.filter((c) => c.mode === "exploring");

  const activeFilterCount = [
    electiveId !== "all",
    subjectFilter !== "all",
    levelFilter !== "all",
    filterFits,
    filterPrereq,
    filterOnline,
    filterAsync,
    filterLectureOnly,
    filterOpenSeats,
    filterBiweekly,
  ].filter(Boolean).length;

  const effectiveTab = panelTab;

  return (
    <aside className="flex h-full flex-col rounded-xl border border-zinc-300/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Top Panel Header / Tabs */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="grid w-full grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setPanelTab("planned")}
            className={`rounded-md px-2.5 py-1.5 transition ${
              effectiveTab === "planned"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
            }`}
          >
            My Courses ({plannedCourses.length})
          </button>
          <button
            type="button"
            onClick={() => setPanelTab("search")}
            className={`rounded-md px-2.5 py-1.5 transition ${
              effectiveTab === "search"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
            }`}
          >
            Course Lookup &amp; Explore
          </button>
        </div>
      </div>

      {effectiveTab === "search" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Search & Filters */}
          <div className="space-y-2.5 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisibleLimit(30);
              }}
              placeholder="Search code, title, description, prof, or CRN..."
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />

            {/* Elective Category Dropdown */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <select
                value={electiveId}
                onChange={(e) => {
                  setElectiveId(e.target.value);
                  setVisibleLimit(30);
                }}
                aria-label="Filter by elective category"
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <option value="all">All Electives / Categories</option>
                {allElectiveOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={subjectFilter}
                  onChange={(e) => {
                    setSubjectFilter(e.target.value);
                    setVisibleLimit(30);
                  }}
                  aria-label="Filter by subject"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <option value="all">All Subjects</option>
                  {catalog.subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={levelFilter}
                  onChange={(e) => {
                    setLevelFilter(e.target.value);
                    setVisibleLimit(30);
                  }}
                  aria-label="Filter by course level"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <option value="all">All Levels</option>
                  <option value="1000">1000-level</option>
                  <option value="2000">2000-level</option>
                  <option value="3000">3000-level</option>
                  <option value="4000">4000-level</option>
                  <option value="3000+">3000+ Upper</option>
                  <option value="5000+">5000+ Grad</option>
                </select>
              </div>
            </div>

            {/* Smart Toggle Chips */}
            <div className="flex flex-wrap gap-1.5">
              {[
                {
                  label: "Fits Schedule",
                  active: filterFits,
                  onClick: () => setFilterFits((v) => !v),
                  tone: "emerald",
                },
                {
                  label: "Prereqs Met",
                  active: filterPrereq,
                  onClick: () => setFilterPrereq((v) => !v),
                  tone: "blue",
                },
                {
                  label: "Fully Online",
                  active: filterOnline,
                  onClick: () => setFilterOnline((v) => !v),
                  tone: "cyan",
                },
                {
                  label: "Fully Async",
                  active: filterAsync,
                  onClick: () => setFilterAsync((v) => !v),
                  tone: "teal",
                },
                {
                  label: "Lecture Only",
                  active: filterLectureOnly,
                  onClick: () => setFilterLectureOnly((v) => !v),
                  tone: "indigo",
                },
                {
                  label: "Open Seats",
                  active: filterOpenSeats,
                  onClick: () => setFilterOpenSeats((v) => !v),
                  tone: "amber",
                },
                {
                  label: "Biweekly",
                  active: filterBiweekly,
                  onClick: () => setFilterBiweekly((v) => !v),
                  tone: "purple",
                },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={chip.active}
                  onClick={() => {
                    chip.onClick();
                    setVisibleLimit(30);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    chip.active
                      ? "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-600 dark:bg-blue-950/70 dark:text-blue-200"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  {chip.active ? "✓ " : ""}
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Status & Completed Courses Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
              <span>
                <strong className="text-zinc-800 dark:text-zinc-200">
                  {filteredCourses.length}
                </strong>{" "}
                course{filteredCourses.length === 1 ? "" : "s"} in{" "}
                {catalog.termLabel}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCompletedOpen((v) => !v)}
                  className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  Completed ({completedCourses.length})
                </button>
                {(activeFilterCount > 0 || query.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setElectiveId("all");
                      setSubjectFilter("all");
                      setLevelFilter("all");
                      setFilterFits(false);
                      setFilterPrereq(false);
                      setFilterOnline(false);
                      setFilterAsync(false);
                      setFilterLectureOnly(false);
                      setFilterOpenSeats(false);
                      setFilterBiweekly(false);
                    }}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Completed Courses Editor */}
            {completedOpen && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    Completed / Prior Courses (for Prereq Checks)
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompletedOpen(false)}
                    className="text-zinc-400 hover:text-zinc-600"
                  >
                    &times;
                  </button>
                </div>
                <form
                  onSubmit={handleAddCompletedSubmit}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={completedInput}
                    onChange={(e) => setCompletedInput(e.target.value)}
                    placeholder="e.g. CSCI 1030U"
                    className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  <button
                    type="submit"
                    className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Add
                  </button>
                </form>
                <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {completedCourses.length === 0 ? (
                    <span className="text-[11px] text-zinc-500">
                      No prior courses recorded yet. Sign in with a Degree Plan
                      or add courses above.
                    </span>
                  ) : (
                    completedCourses.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700 border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={() => onRemoveCompletedCourse(code)}
                          className="text-zinc-400 hover:text-rose-500"
                          title={`Remove ${code}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Course Cards List */}
          <div className="max-h-[680px] flex-1 space-y-2.5 overflow-y-auto p-3">
            {filteredCourses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
                No courses in {catalog.termLabel} match these filters.
              </div>
            ) : (
              <>
                {filteredCourses
                  .slice(0, visibleLimit)
                  .map(({ course, prereqStatus, missingPrereqs, fitCombo }) => {
                    const entry = plannedByCode.get(course.courseCode);
                    const isExpanded = expandedCourses.has(course.courseCode);
                    const isDescExpanded = expandedDescriptions.has(
                      course.courseCode,
                    );

                    return (
                      <div
                        key={course.courseCode}
                        className={`rounded-xl border p-3 transition ${
                          entry?.mode === "planned"
                            ? "border-blue-300 bg-blue-50/30 dark:border-blue-800/80 dark:bg-blue-950/20"
                            : entry?.mode === "exploring"
                              ? "border-dashed border-amber-300 bg-amber-50/30 dark:border-amber-700/80 dark:bg-amber-950/20"
                              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        {/* Top Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-clash text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {course.courseCode}
                              </span>
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                {course.creditHours} cr
                              </span>
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                {course.requiredComponents.join(" + ")}
                              </span>
                              {course.isFullyAsyncCapable && (
                                <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                                  Async
                                </span>
                              )}
                              {!course.isFullyAsyncCapable &&
                                course.isFullyOnlineCapable && (
                                  <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
                                    Online
                                  </span>
                                )}
                              {course.hasBiweeklyComponent && (
                                <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                                  Biweekly
                                </span>
                              )}
                            </div>
                            <h4 className="mt-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                              {course.title}
                            </h4>
                          </div>

                          {/* Fit Badge */}
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              fitCombo
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                            }`}
                          >
                            {fitCombo ? "✓ Fits" : "⚠ Conflict"}
                          </span>
                        </div>

                        {/* Course Description */}
                        {course.description && (
                          <div className="mt-1.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                            <p className={isDescExpanded ? "" : "line-clamp-2"}>
                              {course.description}
                            </p>
                            {course.description.length > 120 && (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleExpandDescription(course.courseCode)
                                }
                                className="mt-0.5 text-[10px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                {isDescExpanded ? "Show less" : "Read more"}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Prerequisites */}
                        {(course.prerequisiteText ||
                          course.prerequisiteCodes.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px]">
                            <span className="font-medium text-zinc-500">
                              Prereqs:
                            </span>
                            {prereqStatus === true && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                ✓ Met
                              </span>
                            )}
                            {prereqStatus === false && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                Missing:{" "}
                                {missingPrereqs.join(" / ") || "Prerequisite"}
                              </span>
                            )}
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {course.prerequisiteText}
                            </span>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isEditMode ? (
                              !entry ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddAndPromptSections(
                                        course,
                                        "planned",
                                      )
                                    }
                                    className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-700"
                                  >
                                    + Plan
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAddAndPromptSections(
                                        course,
                                        "exploring",
                                      )
                                    }
                                    className="rounded-md border border-dashed border-amber-400 bg-amber-50/70 px-2.5 py-1 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                                    title="Try on timetable without officially adding to your saved schedule"
                                  >
                                    Explore
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onSetCourseMode(
                                        course.courseCode,
                                        entry.mode === "planned"
                                          ? "exploring"
                                          : "planned",
                                      )
                                    }
                                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                                      entry.mode === "planned"
                                        ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                                        : "border border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                    }`}
                                  >
                                    {entry.mode === "planned"
                                      ? "✓ Planned"
                                      : "Exploring (Promote)"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onRemoveCourse(course.courseCode)
                                    }
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                                  >
                                    Remove
                                  </button>
                                </>
                              )
                            ) : entry ? (
                              <span
                                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                                  entry.mode === "planned"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                                    : "border border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                }`}
                              >
                                {entry.mode === "planned"
                                  ? "In Schedule"
                                  : "Exploring"}
                              </span>
                            ) : null}
                          </div>

                          <div className="ml-auto flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                toggleExpandCourse(course.courseCode)
                              }
                              className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              {isExpanded
                                ? "Hide Sections ▲"
                                : `Sections (${course.sections.length}) ▾`}
                            </button>
                            <RmpStarBadge
                              rmp={getCourseCardRmp(course, entry, true)}
                            />
                          </div>
                        </div>

                        {isExpanded && renderSectionPicker(course, entry)}
                      </div>
                    );
                  })}

                {filteredCourses.length > visibleLimit && (
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((v) => v + 30)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    Show more ({filteredCourses.length - visibleLimit} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* My Courses Tab (Necessary Planned + Exploring + Custom Blocks) */
        <div className="flex min-h-0 flex-1 flex-col">
          {isEditMode && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={onAutoFitAll}
                  disabled={plannedCourses.length === 0}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-40"
                  title="Automatically pick conflict-free Lecture, Lab, and Tutorial times across all active courses"
                >
                  Auto-Fit Sections
                </button>
                <button
                  type="button"
                  onClick={() => setCustomOpen((v) => !v)}
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  + Custom Block
                </button>
              </div>
              <button
                type="button"
                onClick={onClearPlanner}
                disabled={
                  plannedCourses.length === 0 && customBlocks.length === 0
                }
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-40 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                title="Clear all planned and exploring courses from the planner"
              >
                Clear Planner
              </button>
            </div>
          )}

          {isEditMode && customOpen && (
            <form
              onSubmit={handleCreateCustomSubmit}
              className="space-y-2 border-b border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Code (e.g. WORK)"
                  value={cxCode}
                  onChange={(e) => setCxCode(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <input
                  type="text"
                  placeholder="Title (e.g. Study Group)"
                  value={cxTitle}
                  onChange={(e) => setCxTitle(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={cxDay}
                  onChange={(e) => setCxDay(e.target.value as DayOfWeek)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.shortLabel}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  required
                  value={cxStart}
                  onChange={(e) => setCxStart(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <input
                  type="time"
                  required
                  value={cxEnd}
                  onChange={(e) => setCxEnd(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Room (optional)"
                  value={cxRoom}
                  onChange={(e) => setCxRoom(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <select
                  value={cxWeek}
                  onChange={(e) =>
                    setCxWeek(e.target.value as "both" | "week1" | "week2")
                  }
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="both">Both Weeks</option>
                  <option value="week1">Week 1 Only</option>
                  <option value="week2">Week 2 Only</option>
                </select>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1">
                  {(["blue", "emerald", "purple", "amber", "teal"] as ColorTheme[]).map(
                    (c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCxColor(c)}
                        className={`h-4 w-4 rounded-full ${THEME_STYLES[c].accent} ${
                          cxColor === c ? "ring-2 ring-zinc-900 dark:ring-white" : ""
                        }`}
                      />
                    ),
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCustomOpen(false)}
                    className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="max-h-[680px] flex-1 space-y-4 overflow-y-auto p-3">
            {plannedCourses.length === 0 && customBlocks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
                <p className="font-medium text-zinc-700 dark:text-zinc-300">
                  Nothing here yet
                </p>
                <p className="mt-1">
                  You don&apos;t have any courses planned for{" "}
                  {catalog.termLabel}. Browse courses in the{" "}
                  <strong>Course Lookup &amp; Explore</strong> tab
                  {isEditMode
                    ? " to add them to your schedule."
                    : ", or enable Edit Schedule to start building your timetable."}
                </p>
              </div>
            ) : (
              <>
                {plannedOfficial.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Necessary / Planned Courses ({plannedOfficial.length})
                    </h3>
                    {plannedOfficial.map((entry) => {
                      const course = courseMap.get(entry.courseCode);
                      const isExpanded = expandedCourses.has(entry.courseCode);
                      const style = THEME_STYLES[entry.color];
                      const selectedRmp = getCourseCardRmp(
                        course,
                        entry,
                        false,
                      );
                      return (
                        <div
                          key={entry.courseCode}
                          className={`rounded-xl border p-3 ${
                            entry.hidden
                              ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${style.accent}`}
                                />
                                <span className="font-clash text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                  {entry.courseCode}
                                </span>
                                {course && (
                                  <span className="text-[10px] text-zinc-500">
                                    {course.creditHours} cr
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                                {course?.title ?? "Course not offered this term"}
                              </p>
                            </div>
                            {isEditMode && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    onToggleCourseVisibility(entry.courseCode)
                                  }
                                  className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  title={
                                    entry.hidden
                                      ? "Show on grid"
                                      : "Hide from grid"
                                  }
                                >
                                  {entry.hidden ? "Show" : "Hide"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onRemoveCourse(entry.courseCode)
                                  }
                                  className="rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                >
                                  &times;
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Component summary pills */}
                          {course && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {course.requiredComponents.map((comp) => {
                                const crn = entry.selectedCrns[comp];
                                const sec = crn
                                  ? course.sections.find((s) => s.crn === crn)
                                  : undefined;
                                return (
                                  <button
                                    key={comp}
                                    type="button"
                                    onClick={() => {
                                      setActiveCompTab((p) => ({
                                        ...p,
                                        [entry.courseCode]: comp,
                                      }));
                                      setExpandedCourses((p) =>
                                        new Set(p).add(entry.courseCode),
                                      );
                                    }}
                                    className={`rounded border px-2 py-0.5 text-[10.5px] font-medium ${
                                      sec
                                        ? "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                        : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                    }`}
                                  >
                                    {comp}:{" "}
                                    {sec
                                      ? sec.isAsync
                                        ? `CRN ${sec.crn} (Async)`
                                        : `CRN ${sec.crn}${sec.weekPattern !== "both" ? ` ${sec.weekPattern === "week1" ? "W1" : "W2"}` : ""}`
                                      : isEditMode
                                        ? "Pick section"
                                        : "Unselected"}
                                  </button>
                                );
                              })}

                              <div className="ml-auto flex items-center gap-2">
                                {onChangeGridSectionPicker &&
                                  course.requiredComponents.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleGridPickerForCourse(course)
                                      }
                                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition ${
                                        gridSectionPicker?.courseCode ===
                                        entry.courseCode
                                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                          : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                                      }`}
                                    >
                                      {gridSectionPicker?.courseCode ===
                                      entry.courseCode
                                        ? "Showing on Grid"
                                        : "See on Grid"}
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleExpandCourse(entry.courseCode)
                                  }
                                  className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {isExpanded
                                    ? "Done"
                                    : isEditMode
                                      ? "Choose Times"
                                      : "Sections"}
                                </button>
                                <RmpStarBadge rmp={selectedRmp} />
                              </div>
                            </div>
                          )}

                          {isEditMode && isExpanded && (
                            <div className="mt-2 flex items-center gap-1">
                              <span className="text-[10px] text-zinc-500">
                                Color:
                              </span>
                              {(Object.keys(THEME_STYLES) as ColorTheme[]).map(
                                (c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() =>
                                      onChangeCourseColor(entry.courseCode, c)
                                    }
                                    className={`h-3.5 w-3.5 rounded-full ${THEME_STYLES[c].accent} ${
                                      entry.color === c
                                        ? "ring-2 ring-zinc-900 dark:ring-white"
                                        : "opacity-70"
                                    }`}
                                  />
                                ),
                              )}
                            </div>
                          )}

                          {course &&
                            isExpanded &&
                            renderSectionPicker(course, entry)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {exploringOnly.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Exploring Courses — Not Officially Added (
                      {exploringOnly.length})
                    </h3>
                    {exploringOnly.map((entry) => {
                      const course = courseMap.get(entry.courseCode);
                      const isExpanded = expandedCourses.has(entry.courseCode);
                      const selectedRmp = getCourseCardRmp(
                        course,
                        entry,
                        false,
                      );
                      return (
                        <div
                          key={entry.courseCode}
                          className="rounded-xl border border-dashed border-amber-300 bg-amber-50/30 p-3 dark:border-amber-800/80 dark:bg-amber-950/20"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-clash text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {entry.courseCode}
                              </span>
                              <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                                {course?.title ?? entry.courseCode}
                              </p>
                            </div>
                            {isEditMode && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSetCourseMode(entry.courseCode, "planned")
                                  }
                                  className="rounded bg-blue-600 px-2 py-0.5 text-[10.5px] font-medium text-white hover:bg-blue-700"
                                >
                                  Add Officially
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onRemoveCourse(entry.courseCode)
                                  }
                                  className="rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-400"
                                >
                                  &times;
                                </button>
                              </div>
                            )}
                          </div>

                          {course && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {course.requiredComponents.map((comp) => {
                                const crn = entry.selectedCrns[comp];
                                const sec = crn
                                  ? course.sections.find((s) => s.crn === crn)
                                  : undefined;
                                return (
                                  <button
                                    key={comp}
                                    type="button"
                                    onClick={() => {
                                      setActiveCompTab((p) => ({
                                        ...p,
                                        [entry.courseCode]: comp,
                                      }));
                                      setExpandedCourses((p) =>
                                        new Set(p).add(entry.courseCode),
                                      );
                                    }}
                                    className={`rounded border px-2 py-0.5 text-[10.5px] font-medium ${
                                      sec
                                        ? "border-amber-200 bg-white text-zinc-700 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-300"
                                        : "border-amber-400 bg-amber-100/70 text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200"
                                    }`}
                                  >
                                    {comp}:{" "}
                                    {sec
                                      ? sec.isAsync
                                        ? `CRN ${sec.crn} (Async)`
                                        : `CRN ${sec.crn}${sec.weekPattern !== "both" ? ` ${sec.weekPattern === "week1" ? "W1" : "W2"}` : ""}`
                                      : isEditMode
                                        ? "Pick section"
                                        : "Unselected"}
                                  </button>
                                );
                              })}
                              <div className="ml-auto flex items-center gap-2">
                                {onChangeGridSectionPicker &&
                                  course.requiredComponents.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleGridPickerForCourse(course)
                                      }
                                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition ${
                                        gridSectionPicker?.courseCode ===
                                        entry.courseCode
                                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                          : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                                      }`}
                                    >
                                      {gridSectionPicker?.courseCode ===
                                      entry.courseCode
                                        ? "Showing on Grid"
                                        : "See on Grid"}
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleExpandCourse(entry.courseCode)
                                  }
                                  className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {isExpanded
                                    ? "Done"
                                    : isEditMode
                                      ? "Choose Times"
                                      : "Sections"}
                                </button>
                                <RmpStarBadge rmp={selectedRmp} />
                              </div>
                            </div>
                          )}

                          {course &&
                            isExpanded &&
                            renderSectionPicker(course, entry)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {customBlocks.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Custom Blocks ({customBlocks.length})
                    </h3>
                    {customBlocks.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div>
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {b.courseCode}
                          </span>{" "}
                          <span className="text-zinc-500">
                            ({b.day.slice(0, 3)} {formatTimeDisplay(b.startTime)}
                            –{formatTimeDisplay(b.endTime)})
                          </span>
                        </div>
                        {isEditMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveCustomBlock(b.id)}
                            className="text-rose-600 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
