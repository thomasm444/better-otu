"use client";

import React, { useEffect, useId, useState } from "react";
import type { Meeting, Section, Vocab } from "@/lib/queries";
import {
  DAYS_OF_WEEK,
  THEME_STYLES,
  convertSectionToScheduleBlocks,
  formatTimeDisplay,
  type ColorTheme,
  type DayOfWeek,
  type ScheduleBlock,
} from "../types";

interface AddCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultWeek?: 1 | 2;
  initialSearchQuery?: string;
  vocab: Vocab;
  termLabel: string;
  onAddCourse: (
    blocks: ScheduleBlock | ScheduleBlock[],
    targetWeek: "week1" | "week2" | "both",
  ) => void;
}

const MEETING_DAYS = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
] as const;

function describeMeeting(meeting: Meeting): string {
  const days = MEETING_DAYS.filter(([key]) => meeting[key]).map(
    ([, label]) => label,
  );
  const time =
    meeting.begin_time && meeting.end_time
      ? `${formatTimeDisplay(meeting.begin_time)}–${formatTimeDisplay(meeting.end_time)}`
      : "";
  const building = meeting.building ?? "";
  const room = meeting.room ?? "";
  const location =
    building && room.startsWith(building)
      ? room
      : [building, room].filter(Boolean).join(" ");

  return [days.join("/") || "Async", time, location].filter(Boolean).join(" · ");
}

export function AddCourseModal({
  isOpen,
  onClose,
  defaultWeek = 1,
  initialSearchQuery,
  vocab,
  termLabel,
  onAddCourse,
}: AddCourseModalProps) {
  const trimmedInitial = initialSearchQuery?.trim() ?? "";
  const isSubjectOnly = /^[A-Za-z]{2,5}$/.test(trimmedInitial);
  const isCrnOnly = /^\d{4,6}$/.test(trimmedInitial);

  const listPrefix = useId();
  const [mode, setMode] = useState<"search" | "custom">("search");
  const [targetWeek, setTargetWeek] = useState<"week1" | "week2" | "both">(
    defaultWeek === 1 ? "week1" : "week2",
  );
  const [color, setColor] = useState<ColorTheme>("blue");

  // Database search filters & results
  const [subject, setSubject] = useState(isSubjectOnly ? trimmedInitial.toUpperCase() : "");
  const [courseCode, setCourseCode] = useState(
    trimmedInitial && !isSubjectOnly && !isCrnOnly ? trimmedInitial.toUpperCase() : "",
  );
  const [classType, setClassType] = useState("");
  const [instructor, setInstructor] = useState("");
  const [crnFilter, setCrnFilter] = useState(isCrnOnly ? trimmedInitial : "");
  const [page, setPage] = useState(1);

  const [results, setResults] = useState<Section[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom block form state
  const [customCourseCode, setCustomCourseCode] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customType, setCustomType] = useState("LEC");
  const [customDay, setCustomDay] = useState<DayOfWeek>("monday");
  const [customStartTime, setCustomStartTime] = useState("09:40");
  const [customEndTime, setCustomEndTime] = useState("11:00");
  const [customRoom, setCustomRoom] = useState("");
  const [customCrn, setCustomCrn] = useState("");

  useEffect(() => {
    if (!isOpen || mode !== "search") return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (subject.trim()) params.set("subject", subject.trim().toUpperCase());
        if (courseCode.trim()) params.set("courseCode", courseCode.trim());
        if (classType.trim()) params.set("classType", classType.trim());
        if (instructor.trim()) params.set("instructor", instructor.trim());
        if (crnFilter.trim()) params.set("crn", crnFilter.trim());
        params.set("page", String(page));

        const res = await fetch(`/api/courses/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const data = (await res.json()) as {
          rows: Section[];
          total: number;
          page: number;
          pageCount: number;
        };
        setResults(data.rows ?? []);
        setTotal(data.total ?? 0);
        setPageCount(data.pageCount ?? 1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Could not load courses from the database.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, mode, subject, courseCode, classType, instructor, crnFilter, page]);

  if (!isOpen) return null;

  const handleSelectSection = (section: Section) => {
    const blocks = convertSectionToScheduleBlocks(section, color);
    if (blocks.length === 0) return;
    onAddCourse(blocks, targetWeek);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCourseCode.trim()) return;

    const newBlock: ScheduleBlock = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      courseCode: customCourseCode.trim().toUpperCase(),
      title: customTitle.trim() || customCourseCode.trim().toUpperCase(),
      type: customType || "LEC",
      day: customDay,
      startTime: customStartTime,
      endTime: customEndTime,
      room: customRoom.trim() || undefined,
      crn: customCrn.trim() || undefined,
      color,
    };

    onAddCourse(newBlock, targetWeek);
    onClose();
  };

  const clearSearchFilters = () => {
    setSubject("");
    setCourseCode("");
    setClassType("");
    setInstructor("");
    setCrnFilter("");
    setPage(1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Add Course to Schedule ({termLabel})
            </h3>
            <p className="text-xs text-zinc-500">
              Search real Ontario Tech sections from the database or add a custom block.
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            &times;
          </button>
        </div>

        {/* Mode Switcher + Shared Target Week & Color */}
        <div className="mt-4 space-y-3 border-b border-zinc-200 pb-4 text-xs dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => setMode("search")}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  mode === "search"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                }`}
              >
                Search Database
              </button>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  mode === "custom"
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                }`}
              >
                Custom Block
              </button>
            </div>

            {/* Color Tag */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">Color:</span>
              {(Object.keys(THEME_STYLES) as ColorTheme[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border transition ${
                    THEME_STYLES[c].accent
                  } ${
                    color === c
                      ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Target Week */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTargetWeek("week1")}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                targetWeek === "week1"
                  ? "border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              Week 1 Only
            </button>
            <button
              type="button"
              onClick={() => setTargetWeek("week2")}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                targetWeek === "week2"
                  ? "border-purple-500 bg-purple-50 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              Week 2 Only
            </button>
            <button
              type="button"
              onClick={() => setTargetWeek("both")}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                targetWeek === "both"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              Both Weeks
            </button>
          </div>
        </div>

        {/* Body */}
        {mode === "search" ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 text-xs">
            {/* Search Inputs */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div>
                <label className="block text-[11px] text-zinc-500">Subject</label>
                <input
                  type="text"
                  list={`${listPrefix}-subjects`}
                  placeholder="CSCI"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
                <datalist id={`${listPrefix}-subjects`}>
                  {vocab.subjects.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500">Course</label>
                <input
                  type="text"
                  list={`${listPrefix}-codes`}
                  placeholder="CSCI 1030U"
                  value={courseCode}
                  onChange={(e) => {
                    setCourseCode(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
                <datalist id={`${listPrefix}-codes`}>
                  {vocab.courseCodes.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500">Type</label>
                <input
                  type="text"
                  list={`${listPrefix}-types`}
                  placeholder="Lecture"
                  value={classType}
                  onChange={(e) => {
                    setClassType(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
                <datalist id={`${listPrefix}-types`}>
                  {vocab.classTypes.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500">Instructor</label>
                <input
                  type="text"
                  list={`${listPrefix}-instructors`}
                  placeholder="Surname, First"
                  value={instructor}
                  onChange={(e) => {
                    setInstructor(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
                <datalist id={`${listPrefix}-instructors`}>
                  {vocab.instructors.map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500">CRN</label>
                <input
                  type="text"
                  placeholder="44778"
                  value={crnFilter}
                  onChange={(e) => {
                    setCrnFilter(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>
                {isLoading
                  ? "Searching..."
                  : `${total.toLocaleString()} section${total === 1 ? "" : "s"} found`}
              </span>
              {(subject || courseCode || classType || instructor || crnFilter) && (
                <button
                  type="button"
                  onClick={clearSearchFilters}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Results List */}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200 divide-y divide-zinc-200 dark:border-zinc-800 dark:divide-zinc-800">
              {error ? (
                <div className="p-6 text-center text-rose-600 dark:text-rose-400">
                  {error}
                </div>
              ) : results.length === 0 && !isLoading ? (
                <div className="p-6 text-center text-zinc-500">
                  No sections match those filters.
                </div>
              ) : (
                results.map((section, idx) => {
                  const primary =
                    section.course_faculty?.find((f) => f.primary_indicator) ??
                    section.course_faculty?.[0];
                  const meetings = [
                    ...new Set(
                      (section.course_meetings ?? []).map(describeMeeting),
                    ),
                  ];
                  const hasScheduledBlocks =
                    convertSectionToScheduleBlocks(section, color).length > 0;

                  return (
                    <div
                      key={`${section.crn ?? idx}-${idx}`}
                      className="flex items-center justify-between gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-clash font-semibold text-zinc-900 dark:text-zinc-100">
                            {section.subject} {section.course_number}
                          </span>
                          <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                            {section.course_title}
                          </span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            CRN {section.crn}
                          </span>
                          {section.schedule_type_description && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                              {section.schedule_type_description}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span>{primary?.display_name ?? "Unassigned"}</span>
                          <span>
                            Seats: {section.seats_available ?? "—"}/
                            {section.maximum_enrollment ?? "—"}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          {meetings.length === 0
                            ? "No scheduled meeting times"
                            : meetings.join(" • ")}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!hasScheduledBlocks}
                        onClick={() => handleSelectSection(section)}
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
                        title={
                          hasScheduledBlocks
                            ? "Add section to schedule"
                            : "Async / unscheduled sections cannot be placed on the grid"
                        }
                      >
                        {hasScheduledBlocks ? "Add" : "Async"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-500">
                <span>
                  Page {page} of {pageCount}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || isLoading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= pageCount || isLoading}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    className="rounded border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleCustomSubmit} className="mt-4 space-y-3.5 text-xs">
            {/* Course Code & Title */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  Course Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CSCI 1030U"
                  value={customCourseCode}
                  onChange={(e) => setCustomCourseCode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  Course Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Study Group"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
              </div>
            </div>

            {/* Day & Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">Day</label>
                <select
                  value={customDay}
                  onChange={(e) => setCustomDay(e.target.value as DayOfWeek)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.fullLabel}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  Type
                </label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="LEC">Lecture (LEC)</option>
                  <option value="LAB">Laboratory (LAB)</option>
                  <option value="TUT">Tutorial (TUT)</option>
                  <option value="SEM">Seminar (SEM)</option>
                </select>
              </div>
            </div>

            {/* Start Time & End Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  Start Time (HH:MM)
                </label>
                <input
                  type="time"
                  required
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  End Time (HH:MM)
                </label>
                <input
                  type="time"
                  required
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            {/* Room & CRN */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  Room / Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. SCI 1350"
                  value={customRoom}
                  onChange={(e) => setCustomRoom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400">
                  CRN (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 44778"
                  value={customCrn}
                  onChange={(e) => setCustomCrn(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white transition hover:bg-blue-700"
              >
                Add to Schedule
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
