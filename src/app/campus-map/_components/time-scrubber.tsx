"use client";

import React from "react";
import {
  addDaysIso,
  CAMPUS_MAP_MAX_DATE,
  CAMPUS_MAP_MIN_DATE,
  DAY_SHORT,
  formatShortIsoDate,
  type WeekDayInfo,
} from "@/lib/campus-map-dates";
import {
  formatDuration,
  formatDurationLong,
  formatMinutesToTime,
} from "../utils";

interface TimeScrubberProps {
  effectiveWeekStart: string;
  weekRangeText: string;
  weekContextLabel: string;
  weekDays: WeekDayInfo[];
  selectedDayInfo: WeekDayInfo | null;
  selectedIsoDate: string;
  currentDay: number;
  currentSlotStart: number;
  currentDuration: number;
  isPlaying: boolean;
  weekLoading: boolean;
  canGoPrevWeek: boolean;
  canGoNextWeek: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectWeek: (targetWeekInput: string, preferredDayIndex?: number) => void;
  onSelectDay: (dayIndex: number) => void;
  onChangeSlotStart: (next: number | ((prev: number) => number)) => void;
  onChangeDuration: (dur: number) => void;
  onTogglePlay: () => void;
  onSetNow: () => void;
}

export function TimeScrubber({
  effectiveWeekStart,
  weekRangeText,
  weekContextLabel,
  weekDays,
  selectedDayInfo,
  selectedIsoDate,
  currentDay,
  currentSlotStart,
  currentDuration,
  isPlaying,
  weekLoading,
  canGoPrevWeek,
  canGoNextWeek,
  isCollapsed,
  onToggleCollapse,
  onSelectWeek,
  onSelectDay,
  onChangeSlotStart,
  onChangeDuration,
  onTogglePlay,
  onSetNow,
}: TimeScrubberProps) {
  if (isCollapsed) {
    return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 z-[1000] flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200/95 bg-white/95 py-1.5 pl-3.5 pr-1.5 shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-1.5 truncate text-xs font-semibold text-slate-800 transition hover:text-sky-700 dark:text-zinc-100 dark:hover:text-sky-300"
          title="Expand time controls"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
          <span className="shrink-0">
            {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)}
          </span>
          <span className="text-slate-400 dark:text-zinc-500">&bull;</span>
          <span className="shrink-0 font-bold tabular-nums text-sky-700 dark:text-sky-300">
            {formatMinutesToTime(currentSlotStart)} –{" "}
            {formatMinutesToTime(currentSlotStart + currentDuration)}
          </span>
          <span className="hidden rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 sm:inline-block dark:bg-zinc-800 dark:text-zinc-200">
            {formatDuration(currentDuration)}
          </span>
          {weekLoading && (
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand time controls"
          title="Expand time controls"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute bottom-4 left-1/2 z-[1000] w-[92%] max-w-[540px] -translate-x-1/2 rounded-2xl border border-slate-200/95 bg-white/95 px-3 py-2.5 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
    >
      {/* Row 1: Week Navigation, Academic Context, Date Picker & Collapse Button */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200/80 pb-1.5 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canGoPrevWeek}
            onClick={() => onSelectWeek(addDaysIso(effectiveWeekStart, -7))}
            aria-label="Previous week"
            title="Previous week"
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            &larr; Prev
          </button>
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-xs font-extrabold tracking-tight text-slate-900 dark:text-zinc-50">
              {weekRangeText}
            </span>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-950/90 dark:text-sky-200">
              {weekContextLabel}
            </span>
          </div>
          <button
            type="button"
            disabled={!canGoNextWeek}
            onClick={() => onSelectWeek(addDaysIso(effectiveWeekStart, 7))}
            aria-label="Next week"
            title="Next week"
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Next &rarr;
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {weekLoading && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
              <span className="hidden sm:inline">Syncing…</span>
            </span>
          )}
          <input
            type="date"
            aria-label="Jump to date (Sep 1, 2026 to Apr 30, 2027)"
            min={CAMPUS_MAP_MIN_DATE}
            max={CAMPUS_MAP_MAX_DATE}
            value={selectedIsoDate}
            onChange={(e) => {
              const picked = e.target.value;
              if (!picked) return;
              const clamped =
                picked < CAMPUS_MAP_MIN_DATE
                  ? CAMPUS_MAP_MIN_DATE
                  : picked > CAMPUS_MAP_MAX_DATE
                    ? CAMPUS_MAP_MAX_DATE
                    : picked;
              const dt = new Date(`${clamped}T00:00:00Z`);
              const jsDay = dt.getUTCDay();
              const dayIdx = jsDay === 0 ? 7 : jsDay;
              onSelectWeek(clamped, dayIdx);
            }}
            className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Minimize time controls"
            title="Minimize time controls"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Academic Note Banner for Selected Day */}
      {selectedDayInfo?.note && (
        <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-200">
          {formatShortIsoDate(selectedDayInfo.date)}: {selectedDayInfo.note}
        </div>
      )}

      {/* Row 2: Day Pills & Step / Play Controls */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200/80 pb-1.5 dark:border-zinc-800">
        {/* Day Pills */}
        <div className="flex flex-wrap gap-1">
          {weekDays.map((dayInfo) => {
            const dayNum = Number(dayInfo.date.slice(8, 10));
            const isActive = currentDay === dayInfo.dayIndex;
            return (
              <button
                key={dayInfo.date}
                type="button"
                disabled={!dayInfo.inBounds}
                title={
                  dayInfo.note
                    ? `${dayInfo.date} — ${dayInfo.note}`
                    : dayInfo.date
                }
                onClick={() => onSelectDay(dayInfo.dayIndex)}
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                  isActive
                    ? "bg-sky-600 text-white shadow-xs"
                    : "bg-slate-100/70 text-slate-700 hover:bg-slate-200/80 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {DAY_SHORT[dayInfo.dayIndex]}{" "}
                <span
                  className={
                    isActive
                      ? "text-sky-100"
                      : "text-slate-600 dark:text-zinc-300"
                  }
                >
                  {dayNum}
                </span>
              </button>
            );
          })}
        </div>

        {/* Step & Play Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeSlotStart((p) => Math.max(480, p - 30))}
            className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            -30m
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className={`rounded px-2 py-0.5 text-[11px] font-bold text-white transition ${
              isPlaying
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-sky-600 hover:bg-sky-700"
            }`}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={() => onChangeSlotStart((p) => Math.min(1290, p + 30))}
            className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            +30m
          </button>
          <button
            type="button"
            onClick={onSetNow}
            className="rounded border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200"
          >
            Now
          </button>
        </div>
      </div>

      {/* Row 3: Active Window + Duration Selector + Time Slider */}
      <div className="mt-1.5 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-semibold text-slate-700 dark:text-zinc-200">
              Duration:
            </span>
            {[10, 30, 60, 120, 180, 300].map((dur) => (
              <button
                key={dur}
                type="button"
                onClick={() => onChangeDuration(dur)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${
                  currentDuration === dur
                    ? "bg-sky-600 text-white shadow-xs"
                    : "bg-slate-100/80 text-slate-700 hover:bg-slate-200/80 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {formatDuration(dur)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold tabular-nums text-sky-700 dark:text-sky-300">
              {formatMinutesToTime(currentSlotStart)} –{" "}
              {formatMinutesToTime(currentSlotStart + currentDuration)}
            </span>
          </div>
        </div>

        {/* Slider */}
        <div className="relative pt-0.5">
          <input
            type="range"
            min="480"
            max="1290"
            step="30"
            value={currentSlotStart}
            onChange={(e) => onChangeSlotStart(Number(e.target.value))}
            aria-label="Time of day"
            className="w-full cursor-pointer accent-sky-600"
          />
          <div className="flex items-center justify-between text-[10px] font-medium text-slate-600 dark:text-zinc-300">
            <span>8 AM</span>
            <span>10 AM</span>
            <span>12 PM</span>
            <span>2 PM</span>
            <span>4 PM</span>
            <span>6 PM</span>
            <span>8 PM</span>
            <span>10 PM</span>
          </div>
          <div className="mt-0.5 text-center text-[11px] font-medium text-slate-700 dark:text-zinc-200">
            Seeking{" "}
            <strong className="font-bold text-sky-700 dark:text-sky-300">
              {formatDurationLong(currentDuration)}
            </strong>{" "}
            free block on {DAY_SHORT[currentDay]},{" "}
            {formatShortIsoDate(selectedIsoDate)}
          </div>
        </div>
      </div>
    </div>
  );
}
