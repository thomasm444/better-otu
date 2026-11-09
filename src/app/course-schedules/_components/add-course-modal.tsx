"use client";

import React, { useState } from "react";
import {
  DAYS_OF_WEEK,
  THEME_STYLES,
  type ColorTheme,
  type DayOfWeek,
  type ScheduleBlock,
} from "../types";

const PRESET_COURSES = [
  {
    courseCode: "CSCI 1030U",
    title: "Intro to Computer Science",
    type: "LEC",
    room: "SCI 1350",
    instructor: "Banga, Janette",
    startTime: "09:40",
    endTime: "11:00",
    color: "blue" as ColorTheme,
  },
  {
    courseCode: "CSCI 1030U",
    title: "Computer Science Lab",
    type: "LAB",
    room: "UA 2120",
    instructor: "TA Staff",
    startTime: "14:10",
    endTime: "15:30",
    color: "cyan" as ColorTheme,
  },
  {
    courseCode: "MATH 1010U",
    title: "Calculus I",
    type: "LEC",
    room: "UA 1140",
    instructor: "Marchese, Paula",
    startTime: "11:10",
    endTime: "12:30",
    color: "emerald" as ColorTheme,
  },
  {
    courseCode: "MATH 1010U",
    title: "Calculus Tutorial",
    type: "TUT",
    room: "UA 2240",
    instructor: "TA Staff",
    startTime: "15:40",
    endTime: "17:00",
    color: "teal" as ColorTheme,
  },
  {
    courseCode: "PHY 1010U",
    title: "Physics I",
    type: "LEC",
    room: "SCI 1230",
    instructor: "Hagag, Hany",
    startTime: "08:10",
    endTime: "09:30",
    color: "purple" as ColorTheme,
  },
  {
    courseCode: "CHEM 1010U",
    title: "Chemistry I Lab (Bi-weekly)",
    type: "LAB",
    room: "UA 3130",
    instructor: "Easton, Bradley",
    startTime: "12:40",
    endTime: "15:30",
    color: "amber" as ColorTheme,
  },
];

interface AddCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultWeek?: 1 | 2;
  onAddCourse: (block: ScheduleBlock, targetWeek: "week1" | "week2" | "both") => void;
}

export function AddCourseModal({
  isOpen,
  onClose,
  defaultWeek = 1,
  onAddCourse,
}: AddCourseModalProps) {
  const [targetWeek, setTargetWeek] = useState<"week1" | "week2" | "both">(
    defaultWeek === 1 ? "week1" : "week2",
  );
  const [courseCode, setCourseCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("LEC");
  const [day, setDay] = useState<DayOfWeek>("monday");
  const [startTime, setStartTime] = useState("09:40");
  const [endTime, setEndTime] = useState("11:00");
  const [room, setRoom] = useState("");
  const [instructor, setInstructor] = useState("");
  const [crn, setCrn] = useState("");
  const [color, setColor] = useState<ColorTheme>("blue");

  if (!isOpen) return null;

  const handleApplyPreset = (preset: (typeof PRESET_COURSES)[0]) => {
    setCourseCode(preset.courseCode);
    setTitle(preset.title);
    setType(preset.type);
    setRoom(preset.room);
    setInstructor(preset.instructor);
    setStartTime(preset.startTime);
    setEndTime(preset.endTime);
    setColor(preset.color);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseCode.trim()) return;

    const newBlock: ScheduleBlock = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      courseCode: courseCode.trim().toUpperCase(),
      title: title.trim() || courseCode.trim().toUpperCase(),
      type: type || "LEC",
      day,
      startTime,
      endTime,
      room: room.trim() || undefined,
      instructor: instructor.trim() || undefined,
      crn: crn.trim() || undefined,
      color,
    };

    onAddCourse(newBlock, targetWeek);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Add Course to Schedule
            </h3>
            <p className="text-xs text-zinc-500">
              Easily place a class onto Week 1, Week 2, or both spreadsheets.
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

        {/* Quick Presets */}
        <div className="mt-4">
          <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Quick Ontario Tech Presets:
          </label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {PRESET_COURSES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {preset.courseCode} ({preset.type})
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
          {/* Target Week */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Apply to:
            </label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetWeek("week1")}
                className={`rounded-lg border px-3 py-2 font-medium transition ${
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
                className={`rounded-lg border px-3 py-2 font-medium transition ${
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
                className={`rounded-lg border px-3 py-2 font-medium transition ${
                  targetWeek === "both"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                Both Weeks
              </button>
            </div>
          </div>

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
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400">
                Course Title
              </label>
              <input
                type="text"
                placeholder="e.g. Intro to Computer Science"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
              />
            </div>
          </div>

          {/* Day & Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400">Day</label>
              <select
                value={day}
                onChange={(e) => setDay(e.target.value as DayOfWeek)}
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
                value={type}
                onChange={(e) => setType(e.target.value)}
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
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
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
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>

          {/* Room, CRN & Color */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400">
                Room / Location
              </label>
              <input
                type="text"
                placeholder="e.g. SCI 1350"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
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
                value={crn}
                onChange={(e) => setCrn(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400">
                Color Tag
              </label>
              <div className="mt-1.5 flex gap-1.5">
                {(Object.keys(THEME_STYLES) as ColorTheme[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full border transition ${
                      THEME_STYLES[c].accent
                    } ${
                      color === c
                        ? "ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-100"
                        : "opacity-80 hover:opacity-100"
                    }`}
                    title={c}
                  />
                ))}
              </div>
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
      </div>
    </div>
  );
}
