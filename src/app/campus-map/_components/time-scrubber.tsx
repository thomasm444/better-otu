"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDaysIso,
  CAMPUS_MAP_MAX_DATE,
  CAMPUS_MAP_MIN_DATE,
  DAY_SHORT,
  formatShortIsoDate,
  getAcademicDayStatus,
  getDayOfWeekMon1,
  isDateInMapBounds,
  type WeekDayInfo,
} from "@/lib/campus-map-dates";
import {
  formatDuration,
  formatMinutesToTime,
  getLiveTorontoMapState,
  minutesToTimeInputValue,
  parseTimeInputToMinutes,
} from "../utils";

const DURATION_OPTIONS = [30, 60, 120, 180] as const;
const WEEKDAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MIN_YM = 2026 * 12 + 9; // September 2026
const MAX_YM = 2027 * 12 + 4; // April 2027

type YearMonth = { year: number; month: number };

function parseYearMonth(iso: string): YearMonth {
  const parts = iso.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return { year, month };
  }
  return { year: 2026, month: 9 };
}

export function buildCalendarCells(
  year: number,
  month: number,
): Array<{
  day: number;
  iso: string;
  inBounds: boolean;
  note?: string;
} | null> {
  const mm = String(month).padStart(2, "0");
  const firstIso = `${year}-${mm}-01`;
  const leadingBlanks = getDayOfWeekMon1(firstIso) - 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: Array<{
    day: number;
    iso: string;
    inBounds: boolean;
    note?: string;
  } | null> = Array.from({ length: leadingBlanks }, () => null);

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${mm}-${String(day).padStart(2, "0")}`;
    const inBounds = isDateInMapBounds(iso);
    const status = inBounds ? getAcademicDayStatus(iso) : null;
    cells.push({
      day,
      iso,
      inBounds,
      note: status?.note,
    });
  }
  return cells;
}

interface TimeScrubberProps {
  selectedIsoDate: string;
  selectedDayInfo: WeekDayInfo | null;
  currentDay: number;
  currentSlotStart: number;
  currentDuration: number;
  weekLoading: boolean;
  isOpen: boolean;
  isDrawerOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onSelectDate: (isoDate: string) => void;
  onChangeSlotStart: (nextMinutes: number) => void;
  onChangeDuration: (dur: number) => void;
  onSetNow: () => void;
}

export function TimeScrubber({
  selectedIsoDate,
  selectedDayInfo,
  currentDay,
  currentSlotStart,
  currentDuration,
  weekLoading,
  isOpen,
  isDrawerOpen,
  onToggleOpen,
  onClose,
  onSelectDate,
  onChangeSlotStart,
  onChangeDuration,
  onSetNow,
}: TimeScrubberProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [viewYearMonth, setViewYearMonth] = useState<YearMonth>(() =>
    parseYearMonth(selectedIsoDate),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsCalendarOpen(false);
        onCloseRef.current();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsCalendarOpen(false);
        onCloseRef.current();
      }
    };
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const calendarCells = useMemo(
    () => buildCalendarCells(viewYearMonth.year, viewYearMonth.month),
    [viewYearMonth.year, viewYearMonth.month],
  );

  const ymValue = viewYearMonth.year * 12 + viewYearMonth.month;
  const canGoPrevMonth = ymValue > MIN_YM;
  const canGoNextMonth = ymValue < MAX_YM;

  const prevDayIso = addDaysIso(selectedIsoDate, -1);
  const nextDayIso = addDaysIso(selectedIsoDate, 1);
  const canGoPrevDay = prevDayIso >= CAMPUS_MAP_MIN_DATE;
  const canGoNextDay = nextDayIso <= CAMPUS_MAP_MAX_DATE;

  const stepMonth = (delta: -1 | 1) => {
    setViewYearMonth((prev) => {
      const nextM = prev.month + delta;
      if (nextM < 1) return { year: prev.year - 1, month: 12 };
      if (nextM > 12) return { year: prev.year + 1, month: 1 };
      return { year: prev.year, month: nextM };
    });
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className={`absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[1060] -translate-x-1/2 lg:bottom-4 ${
        isDrawerOpen ? "lg:left-[calc(50%+180px)]" : ""
      }`}
    >
      {isOpen && (
        <div
          role="dialog"
          aria-label="Select date, time, and duration"
          className={`absolute left-1/2 w-[320px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-slate-200/95 bg-white/98 p-3 text-xs shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/98 dark:text-zinc-100 ${
            isDrawerOpen
              ? "bottom-[calc(100%+5.75rem)] max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-14.5rem)] lg:bottom-full lg:mb-2 lg:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-7.5rem)]"
              : "bottom-full mb-2 max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-9.5rem)] lg:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-7.5rem)]"
          }`}
        >
          {/* Upward-expanding custom calendar (sits at top of bottom-anchored popover) */}
          {isCalendarOpen && (
            <div className="mb-2.5 rounded-xl border border-slate-200 bg-slate-50/90 p-2 dark:border-zinc-700 dark:bg-zinc-800/70">
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <button
                  type="button"
                  disabled={!canGoPrevMonth}
                  onClick={() => stepMonth(-1)}
                  aria-label="Previous month"
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  &larr;
                </button>
                <span className="text-xs font-bold text-slate-900 dark:text-zinc-100">
                  {MONTH_NAMES[viewYearMonth.month - 1]} {viewYearMonth.year}
                </span>
                <button
                  type="button"
                  disabled={!canGoNextMonth}
                  onClick={() => stepMonth(1)}
                  aria-label="Next month"
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  &rarr;
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-bold text-slate-500 dark:text-zinc-400">
                {WEEKDAY_HEADERS.map((wd) => (
                  <div key={wd} className="py-0.5">
                    {wd}
                  </div>
                ))}
              </div>

              <div className="mt-0.5 grid grid-cols-7 gap-0.5 text-center">
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`blank-${idx}`} className="h-7" />;
                  }
                  const isSelected = cell.iso === selectedIsoDate;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={!cell.inBounds}
                      title={cell.note ? `${cell.iso} — ${cell.note}` : cell.iso}
                      onClick={() => {
                        onSelectDate(cell.iso);
                        setIsCalendarOpen(false);
                      }}
                      className={`relative flex h-7 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums transition disabled:cursor-not-allowed disabled:opacity-30 ${
                        isSelected
                          ? "bg-sky-600 font-bold text-white shadow-2xs"
                          : "text-slate-800 hover:bg-white dark:text-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      <span>{cell.day}</span>
                      {cell.note && (
                        <span
                          aria-hidden="true"
                          className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                            isSelected ? "bg-amber-200" : "bg-amber-500"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Window Summary + Now */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2 dark:border-zinc-800">
            <span className="font-bold tabular-nums text-sky-700 dark:text-sky-300">
              {formatMinutesToTime(currentSlotStart)} &ndash;{" "}
              {formatMinutesToTime(currentSlotStart + currentDuration)}
            </span>
            <button
              type="button"
              onClick={() => {
                const nowDate = getLiveTorontoMapState().date;
                setViewYearMonth(parseYearMonth(nowDate));
                onSetNow();
              }}
              className="rounded-full border border-emerald-400 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200 dark:hover:bg-emerald-900/70"
            >
              Now
            </button>
          </div>

          {selectedDayInfo?.note && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-200">
              {formatShortIsoDate(selectedDayInfo.date)}: {selectedDayInfo.note}
            </div>
          )}

          <div className="mt-2.5 space-y-2.5">
            {/* Date Row (opens calendar upward) */}
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Date
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canGoPrevDay}
                  onClick={() => {
                    onSelectDate(prevDayIso);
                    setViewYearMonth(parseYearMonth(prevDayIso));
                  }}
                  aria-label="Previous day"
                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  &lsaquo;
                </button>
                <button
                  type="button"
                  aria-expanded={isCalendarOpen}
                  aria-label="Open calendar"
                  onClick={() => {
                    if (!isCalendarOpen) {
                      setViewYearMonth(parseYearMonth(selectedIsoDate));
                    }
                    setIsCalendarOpen((prev) => !prev);
                  }}
                  className="flex flex-1 items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 transition hover:border-sky-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-sky-600"
                >
                  <span>
                    {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)},{" "}
                    {selectedIsoDate.slice(0, 4)}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                    {isCalendarOpen ? "\u25BE" : "\u25B4"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!canGoNextDay}
                  onClick={() => {
                    onSelectDate(nextDayIso);
                    setViewYearMonth(parseYearMonth(nextDayIso));
                  }}
                  aria-label="Next day"
                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  &rsaquo;
                </button>
              </div>
            </div>

            {/* Time Section: Exact input + smooth slider */}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  Time
                </span>
                <input
                  type="time"
                  aria-label="Select exact time"
                  min="08:00"
                  max="21:30"
                  step={60}
                  value={minutesToTimeInputValue(currentSlotStart)}
                  onChange={(e) => {
                    const mins = parseTimeInputToMinutes(e.target.value);
                    if (mins !== null) onChangeSlotStart(mins);
                  }}
                  className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <input
                type="range"
                aria-label="Time of day slider"
                min={480}
                max={1290}
                step={15}
                value={currentSlotStart}
                onChange={(e) => onChangeSlotStart(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-sky-600"
              />
              <div className="mt-0.5 flex items-center justify-between text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                <span>8 AM</span>
                <span>12 PM</span>
                <span>4 PM</span>
                <span>8 PM</span>
                <span>9:30 PM</span>
              </div>
            </div>

            {/* Duration Choices */}
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Duration
              </div>
              <div className="grid grid-cols-4 gap-1">
                {DURATION_OPTIONS.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => onChangeDuration(dur)}
                    className={`rounded-lg py-1 text-xs font-semibold transition ${
                      currentDuration === dur
                        ? "bg-sky-600 text-white shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {formatDuration(dur)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (isOpen) {
            setIsCalendarOpen(false);
          }
          onToggleOpen();
        }}
        aria-expanded={isOpen}
        aria-label="Change date, time, and duration"
        className="flex max-w-[calc(100vw-1.5rem)] items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200/95 bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-slate-800 shadow-xl backdrop-blur-md transition hover:border-sky-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:border-sky-600"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        <span>
          {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)}
        </span>
        <span className="text-slate-400 dark:text-zinc-500">&middot;</span>
        <span className="font-bold tabular-nums text-sky-700 dark:text-sky-300">
          {formatMinutesToTime(currentSlotStart)}
        </span>
        <span className="text-slate-400 dark:text-zinc-500">&middot;</span>
        <span>{formatDuration(currentDuration)}</span>
        <span className="text-[10px] text-slate-500 dark:text-zinc-400">
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
        {weekLoading && (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
        )}
      </button>
    </div>
  );
}
