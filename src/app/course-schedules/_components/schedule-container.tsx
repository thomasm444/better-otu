"use client";

import React, { useState } from "react";
import type { Vocab } from "@/lib/queries";
import { WeekScheduleGrid } from "./timetable-grid";
import { AddCourseModal } from "./add-course-modal";
import type { ScheduleBlock } from "../types";

interface ScheduleContainerProps {
  initialWeek1Courses: ScheduleBlock[];
  initialWeek2Courses: ScheduleBlock[];
  vocab: Vocab;
  termLabel: string;
}

export function ScheduleContainer({
  initialWeek1Courses,
  initialWeek2Courses,
  vocab,
  termLabel,
}: ScheduleContainerProps) {
  const [week1Courses, setWeek1Courses] = useState<ScheduleBlock[]>(() => [
    ...initialWeek1Courses,
  ]);

  const [week2Courses, setWeek2Courses] = useState<ScheduleBlock[]>(() => [
    ...initialWeek2Courses,
  ]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalDefaultWeek, setModalDefaultWeek] = useState<1 | 2>(1);
  const [activeView, setActiveView] = useState<"both" | "week1" | "week2">("both");
  const [fitToHeight, setFitToHeight] = useState(true);

  const handleAddCourse = (
    blocks: ScheduleBlock | ScheduleBlock[],
    target: "week1" | "week2" | "both",
  ) => {
    const list = Array.isArray(blocks) ? blocks : [blocks];
    if (list.length === 0) return;

    if (target === "week1" || target === "both") {
      setWeek1Courses((prev) => [
        ...prev,
        ...list.map((b) => ({ ...b, id: `${b.id}-w1-${Date.now()}` })),
      ]);
    }
    if (target === "week2" || target === "both") {
      setWeek2Courses((prev) => [
        ...prev,
        ...list.map((b) => ({ ...b, id: `${b.id}-w2-${Date.now()}` })),
      ]);
    }
  };

  const handleRemoveWeek1Course = (id: string) => {
    setWeek1Courses((prev) => prev.filter((c) => c.id !== id));
  };

  const handleRemoveWeek2Course = (id: string) => {
    setWeek2Courses((prev) => prev.filter((c) => c.id !== id));
  };

  const openAddModalForWeek = (week: 1 | 2) => {
    setModalDefaultWeek(week);
    setIsAddModalOpen(true);
  };

  const handleResetSample = () => {
    setWeek1Courses([...initialWeek1Courses]);
    setWeek2Courses([...initialWeek2Courses]);
  };

  const handleClearAll = () => {
    setWeek1Courses([]);
    setWeek2Courses([]);
  };

  return (
    <div className="space-y-4">
      {/* Control Bar: View Toggle, Fit Mode, Add Course & Reset */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center gap-2">
          {/* View Mode Selector */}
          <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setActiveView("both")}
              className={`rounded-md px-3 py-1.5 transition ${
                activeView === "both"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Side-by-Side (Both)
            </button>
            <button
              type="button"
              onClick={() => setActiveView("week1")}
              className={`rounded-md px-3 py-1.5 transition ${
                activeView === "week1"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Week 1 Only
            </button>
            <button
              type="button"
              onClick={() => setActiveView("week2")}
              className={`rounded-md px-3 py-1.5 transition ${
                activeView === "week2"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Week 2 Only
            </button>
          </div>

          {/* Fit vs Scroll Toggle */}
          <button
            type="button"
            onClick={() => setFitToHeight(!fitToHeight)}
            className="hidden items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 sm:inline-flex dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Toggle between fitting in window or expanding"
          >
            <span className="text-zinc-400">📏</span>
            <span>{fitToHeight ? "Fit View (No Scroll)" : "Expanded View"}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetSample}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title={`Restore sample ${termLabel} courses from database`}
          >
            Reset Sample
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => openAddModalForWeek(1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            <span>+</span>
            <span>Add Course</span>
          </button>
        </div>
      </div>

      {/* Main Schedule Display:
          Side-by-side: Week 1 on the left, Week 2 on the right
      */}
      <div
        className={`grid gap-5 ${
          activeView === "both"
            ? "grid-cols-1 xl:grid-cols-2"
            : "grid-cols-1"
        }`}
      >
        {/* Left Element: Week 1 Courses */}
        {(activeView === "both" || activeView === "week1") && (
          <div className="flex flex-col">
            <WeekScheduleGrid
              weekNumber={1}
              title="Week 1 Schedule"
              subtitle="Odd Weeks &bull; Times on left &bull; Days on bottom"
              courses={week1Courses}
              accentColor="blue"
              fitToHeight={fitToHeight}
              onRemoveCourse={handleRemoveWeek1Course}
              onAddCourse={() => openAddModalForWeek(1)}
            />
          </div>
        )}

        {/* Right Element: Week 2 Courses */}
        {(activeView === "both" || activeView === "week2") && (
          <div className="flex flex-col">
            <WeekScheduleGrid
              weekNumber={2}
              title="Week 2 Schedule"
              subtitle="Even Weeks &bull; Times on left &bull; Days on bottom"
              courses={week2Courses}
              accentColor="purple"
              fitToHeight={fitToHeight}
              onRemoveCourse={handleRemoveWeek2Course}
              onAddCourse={() => openAddModalForWeek(2)}
            />
          </div>
        )}
      </div>

      {/* Add Course Modal */}
      {isAddModalOpen && (
        <AddCourseModal
          key={modalDefaultWeek}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          defaultWeek={modalDefaultWeek}
          vocab={vocab}
          termLabel={termLabel}
          onAddCourse={handleAddCourse}
        />
      )}
    </div>
  );
}
