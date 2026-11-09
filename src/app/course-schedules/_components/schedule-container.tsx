"use client";

import React, { useState } from "react";
import { WeekScheduleGrid } from "./timetable-grid";
import { AddCourseModal } from "./add-course-modal";
import type { ScheduleBlock } from "../types";

/**
 * Sample Ontario Tech schedule demonstration:
 * Demonstrates shared weekly lectures, plus bi-weekly alternating labs/tutorials.
 */
const INITIAL_SHARED_LECTURES: ScheduleBlock[] = [
  {
    id: "csci1030-lec-mon",
    courseCode: "CSCI 1030U",
    title: "Intro to Computer Science",
    type: "LEC",
    crn: "44778",
    room: "SCI 1350",
    instructor: "Banga, Janette",
    day: "monday",
    startTime: "09:40",
    endTime: "11:00",
    color: "blue",
  },
  {
    id: "csci1030-lec-wed",
    courseCode: "CSCI 1030U",
    title: "Intro to Computer Science",
    type: "LEC",
    crn: "44778",
    room: "SCI 1350",
    instructor: "Banga, Janette",
    day: "wednesday",
    startTime: "09:40",
    endTime: "11:00",
    color: "blue",
  },
  {
    id: "math1010-lec-tue",
    courseCode: "MATH 1010U",
    title: "Calculus I",
    type: "LEC",
    crn: "42109",
    room: "UA 1140",
    instructor: "Marchese, Paula",
    day: "tuesday",
    startTime: "11:10",
    endTime: "12:30",
    color: "emerald",
  },
  {
    id: "math1010-lec-thu",
    courseCode: "MATH 1010U",
    title: "Calculus I",
    type: "LEC",
    crn: "42109",
    room: "UA 1140",
    instructor: "Marchese, Paula",
    day: "thursday",
    startTime: "11:10",
    endTime: "12:30",
    color: "emerald",
  },
  {
    id: "phy1010-lec-mon",
    courseCode: "PHY 1010U",
    title: "Physics I",
    type: "LEC",
    crn: "41982",
    room: "SCI 1230",
    instructor: "Hagag, Hany",
    day: "monday",
    startTime: "08:10",
    endTime: "09:30",
    color: "purple",
  },
  {
    id: "phy1010-lec-wed",
    courseCode: "PHY 1010U",
    title: "Physics I",
    type: "LEC",
    crn: "41982",
    room: "SCI 1230",
    instructor: "Hagag, Hany",
    day: "wednesday",
    startTime: "08:10",
    endTime: "09:30",
    color: "purple",
  },
  {
    id: "infr1010-lec-fri",
    courseCode: "INFR 1010U",
    title: "Discrete Mathematics",
    type: "LEC",
    crn: "45123",
    room: "UA 1350",
    instructor: "Bradbury, Jeremy",
    day: "friday",
    startTime: "10:10",
    endTime: "13:00",
    color: "indigo",
  },
];

// Week 1 specific courses (e.g. Chem Lab + CS Lab A)
const INITIAL_WEEK1_ONLY: ScheduleBlock[] = [
  {
    id: "chem1010-lab-w1",
    courseCode: "CHEM 1010U",
    title: "Chemistry I Lab (Bi-weekly Week 1)",
    type: "LAB",
    crn: "43301",
    room: "UA 3130",
    instructor: "Easton, Bradley",
    day: "tuesday",
    startTime: "13:10",
    endTime: "16:00",
    color: "amber",
  },
  {
    id: "csci1030-lab-w1",
    courseCode: "CSCI 1030U",
    title: "Computer Science Lab",
    type: "LAB",
    crn: "44780",
    room: "UA 2120",
    instructor: "Teaching Assistant",
    day: "thursday",
    startTime: "14:10",
    endTime: "15:30",
    color: "cyan",
  },
];

// Week 2 specific courses (e.g. Physics Lab + Math Tut B)
const INITIAL_WEEK2_ONLY: ScheduleBlock[] = [
  {
    id: "phy1010-lab-w2",
    courseCode: "PHY 1010U",
    title: "Physics I Lab (Bi-weekly Week 2)",
    type: "LAB",
    crn: "41985",
    room: "SCI 2140",
    instructor: "Teaching Assistant",
    day: "tuesday",
    startTime: "13:10",
    endTime: "16:00",
    color: "rose",
  },
  {
    id: "math1010-tut-w2",
    courseCode: "MATH 1010U",
    title: "Calculus Problem Session",
    type: "TUT",
    crn: "42115",
    room: "UA 2240",
    instructor: "Teaching Assistant",
    day: "thursday",
    startTime: "15:40",
    endTime: "17:00",
    color: "teal",
  },
];

interface ScheduleContainerProps {
  initialWeek1Courses?: ScheduleBlock[];
  initialWeek2Courses?: ScheduleBlock[];
}

export function ScheduleContainer({
  initialWeek1Courses,
  initialWeek2Courses,
}: ScheduleContainerProps) {
  const [week1Courses, setWeek1Courses] = useState<ScheduleBlock[]>(() => [
    ...(initialWeek1Courses ?? [...INITIAL_SHARED_LECTURES, ...INITIAL_WEEK1_ONLY]),
  ]);

  const [week2Courses, setWeek2Courses] = useState<ScheduleBlock[]>(() => [
    ...(initialWeek2Courses ?? [...INITIAL_SHARED_LECTURES, ...INITIAL_WEEK2_ONLY]),
  ]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalDefaultWeek, setModalDefaultWeek] = useState<1 | 2>(1);
  const [activeView, setActiveView] = useState<"both" | "week1" | "week2">("both");
  const [fitToHeight, setFitToHeight] = useState(true);

  const handleAddCourse = (
    newBlock: ScheduleBlock,
    target: "week1" | "week2" | "both",
  ) => {
    if (target === "week1" || target === "both") {
      setWeek1Courses((prev) => [...prev, { ...newBlock, id: `${newBlock.id}-w1` }]);
    }
    if (target === "week2" || target === "both") {
      setWeek2Courses((prev) => [...prev, { ...newBlock, id: `${newBlock.id}-w2` }]);
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

  const handleResetDemo = () => {
    setWeek1Courses([...INITIAL_SHARED_LECTURES, ...INITIAL_WEEK1_ONLY]);
    setWeek2Courses([...INITIAL_SHARED_LECTURES, ...INITIAL_WEEK2_ONLY]);
  };

  const handleClearAll = () => {
    setWeek1Courses([]);
    setWeek2Courses([]);
  };

  return (
    <div className="space-y-4">
      {/* Control Bar: View Toggle, Fit Mode, Add Course & Presets */}
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
            onClick={handleResetDemo}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Restore sample Ontario Tech courses"
          >
            Reset Demo
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
      <AddCourseModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        defaultWeek={modalDefaultWeek}
        onAddCourse={handleAddCourse}
      />
    </div>
  );
}
