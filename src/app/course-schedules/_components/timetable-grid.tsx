"use client";

import React, { useState } from "react";
import {
  DAYS_OF_WEEK,
  THEME_STYLES,
  formatHourLabel,
  formatTimeDisplay,
  parseTimeToMinutes,
  type DayOfWeek,
  type ScheduleBlock,
  type WeekScheduleProps,
} from "../types";

export function WeekScheduleGrid({
  weekNumber,
  title,
  subtitle,
  courses,
  startHour = 8,
  endHour = 21, // 8:00 AM to 9:00 PM (13 hourly intervals)
  onRemoveCourse,
  onAddCourse,
  accentColor = weekNumber === 1 ? "blue" : "purple",
  fitToHeight = true,
}: WeekScheduleProps) {
  const [selectedCourse, setSelectedCourse] = useState<ScheduleBlock | null>(null);

  const totalHours = endHour - startHour;
  const startMinutes = startHour * 60;
  const totalMinutes = totalHours * 60;

  // Array of hours for the left column: 8, 9, 10, ... 20
  const hours = Array.from({ length: totalHours }, (_, i) => startHour + i);

  // Group course blocks by day of week
  const coursesByDay: Record<DayOfWeek, ScheduleBlock[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
  };

  courses.forEach((c) => {
    if (coursesByDay[c.day]) {
      coursesByDay[c.day].push(c);
    }
  });

  const accentBadge =
    accentColor === "blue"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800"
      : accentColor === "purple"
      ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-200 dark:border-purple-800"
      : accentColor === "emerald"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800";

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-300/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Element Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${accentBadge}`}
          >
            Week {weekNumber}
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 tabular-nums">
            {courses.length} {courses.length === 1 ? "block" : "blocks"}
          </span>
          {onAddCourse && (
            <button
              onClick={onAddCourse}
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="Add course to this week"
            >
              <span className="text-sm font-bold leading-none">+</span>
              <span>Add</span>
            </button>
          )}
        </div>
      </div>

      {/* Spreadsheet Container */}
      <div
        className={`relative flex flex-1 flex-col overflow-hidden text-xs ${
          fitToHeight ? "min-h-[520px] max-h-[640px]" : "h-auto"
        }`}
      >
        {/* Main Schedule Grid Body: Times Column + 5 Day Columns */}
        <div className="relative flex flex-1">
          {/* Times Column on the Left (Excel row headers style) */}
          <div className="flex w-16 flex-shrink-0 flex-col border-r border-zinc-300 bg-zinc-50/80 font-mono text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            {hours.map((hour) => (
              <div
                key={hour}
                className="relative flex flex-1 items-start justify-end border-b border-zinc-200/90 pr-2 pt-0.5 select-none dark:border-zinc-800/80"
              >
                <span>{formatHourLabel(hour)}</span>
              </div>
            ))}
          </div>

          {/* 5 Day Columns with spreadsheet grid cells */}
          <div className="grid flex-1 grid-cols-5 divide-x divide-zinc-200 dark:divide-zinc-800">
            {DAYS_OF_WEEK.map((day) => {
              const dayCourses = coursesByDay[day.key];

              return (
                <div key={day.key} className="relative flex flex-1 flex-col">
                  {/* Background horizontal hour gridlines (Excel cell rows) */}
                  <div className="absolute inset-0 flex flex-col pointer-events-none">
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="flex-1 border-b border-zinc-100 dark:border-zinc-900/70"
                      />
                    ))}
                  </div>

                  {/* Absolute Canvas for Positioned Course Blocks */}
                  <div className="relative z-10 h-full w-full">
                    {dayCourses.map((course) => {
                      const cStart = parseTimeToMinutes(course.startTime);
                      const cEnd = parseTimeToMinutes(course.endTime);

                      // Bound times within startHour and endHour
                      const clampedStart = Math.max(cStart, startMinutes);
                      const clampedEnd = Math.min(cEnd, startMinutes + totalMinutes);

                      if (clampedEnd <= clampedStart) return null;

                      const topPercent =
                        ((clampedStart - startMinutes) / totalMinutes) * 100;
                      const heightPercent =
                        ((clampedEnd - clampedStart) / totalMinutes) * 100;

                      const style = THEME_STYLES[course.color || "blue"];

                      return (
                        <div
                          key={course.id}
                          onClick={() => setSelectedCourse(course)}
                          style={{
                            top: `${topPercent}%`,
                            height: `${heightPercent}%`,
                          }}
                          className={`group absolute left-0.5 right-0.5 cursor-pointer overflow-hidden rounded-md border p-1 text-[11px] transition-all hover:z-30 hover:shadow-md ${style.bg} ${style.border} ${style.text} ${style.hoverBg}`}
                          title={`${course.courseCode} - ${course.title} (${formatTimeDisplay(
                            course.startTime,
                          )} - ${formatTimeDisplay(course.endTime)})`}
                        >
                          <div className="flex h-full flex-col justify-between leading-tight">
                            <div>
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-clash font-semibold tracking-tight truncate">
                                  {course.courseCode}
                                </span>
                                {course.type && (
                                  <span className="shrink-0 rounded bg-black/10 px-1 py-0.2 text-[9px] font-medium dark:bg-white/10">
                                    {course.type}
                                  </span>
                                )}
                              </div>
                              <p className="line-clamp-1 text-[10px] opacity-80">
                                {course.title}
                              </p>
                            </div>

                            <div className="flex items-center justify-between text-[9px] opacity-75">
                              <span className="truncate">{course.room || "TBA"}</span>
                              <span className="tabular-nums shrink-0">
                                {formatTimeDisplay(course.startTime)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Days of the Week on the Bottom (as explicitly requested) */}
        <div className="flex border-t-2 border-zinc-300 bg-zinc-100 text-zinc-700 select-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {/* Bottom-left corner cell aligning with Times Column */}
          <div className="flex w-16 shrink-0 items-center justify-center border-r border-zinc-300 py-2 font-mono text-[10px] font-semibold text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            DAY &darr;
          </div>

          {/* Day Headers across the bottom */}
          <div className="grid flex-1 grid-cols-5 divide-x divide-zinc-300 dark:divide-zinc-800">
            {DAYS_OF_WEEK.map((day) => (
              <div
                key={day.key}
                className="flex flex-col items-center justify-center py-2 text-center"
              >
                <span className="text-xs font-semibold tracking-wide uppercase sm:hidden">
                  {day.shortLabel}
                </span>
                <span className="hidden text-xs font-semibold tracking-wide uppercase sm:inline">
                  {day.fullLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected Course Quick Modal / Inspector */}
      {selectedCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between">
              <div>
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                    THEME_STYLES[selectedCourse.color || "blue"].bg
                  } ${THEME_STYLES[selectedCourse.color || "blue"].text}`}
                >
                  {selectedCourse.type || "Class"} &bull; Week {weekNumber}
                </span>
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

            <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
              <div className="flex justify-between">
                <span className="text-zinc-500">Day &amp; Time</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200 capitalize">
                  {selectedCourse.day} &bull; {formatTimeDisplay(selectedCourse.startTime)} &ndash;{" "}
                  {formatTimeDisplay(selectedCourse.endTime)}
                </span>
              </div>
              {selectedCourse.room && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Room</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedCourse.room}
                  </span>
                </div>
              )}
              {selectedCourse.instructor && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Instructor</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedCourse.instructor}
                  </span>
                </div>
              )}
              {selectedCourse.crn && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">CRN</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">
                    {selectedCourse.crn}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between pt-2">
              {onRemoveCourse && (
                <button
                  type="button"
                  onClick={() => {
                    onRemoveCourse(selectedCourse.id);
                    setSelectedCourse(null);
                  }}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                >
                  Remove Course
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="ml-auto rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
