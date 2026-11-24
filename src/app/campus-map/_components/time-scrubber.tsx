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
          className={`absolute left-1/2 w-[320px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-line bg-surface/98 p-3 text-xs shadow-[var(--shadow-lg)] backdrop-blur-md ${
            isDrawerOpen
              ? "bottom-[calc(100%+5.75rem)] max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2rem)-14.5rem)] lg:bottom-full lg:mb-2 lg:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2rem)-7.5rem)]"
              : "bottom-full mb-2 max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2rem)-9.5rem)] lg:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2rem)-7.5rem)]"
          }`}
        >
          {/* Upward-expanding custom calendar (sits at top of bottom-anchored popover) */}
          {isCalendarOpen && (
            <div className="mb-2.5 rounded-xl border border-line-subtle bg-surface-subtle p-2">
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <button
                  type="button"
                  disabled={!canGoPrevMonth}
                  onClick={() => stepMonth(-1)}
                  aria-label="Previous month"
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  &larr;
                </button>
                <span className="text-xs font-semibold text-ink">
                  {MONTH_NAMES[viewYearMonth.month - 1]} {viewYearMonth.year}
                </span>
                <button
                  type="button"
                  disabled={!canGoNextMonth}
                  onClick={() => stepMonth(1)}
                  aria-label="Next month"
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  &rarr;
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-ink-muted">
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
                      className={`relative flex h-7 items-center justify-center rounded-md text-[11px] font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                        isSelected
                          ? "bg-brand font-semibold text-brand-fg"
                          : "text-ink hover:bg-surface"
                      }`}
                    >
                      <span>{cell.day}</span>
                      {cell.note && (
                        <span
                          aria-hidden="true"
                          className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                            isSelected ? "bg-accent" : "bg-warning"
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
          <div className="flex items-center justify-between gap-2 border-b border-line-subtle pb-2">
            <span className="font-mono font-medium tabular-nums text-accent-ink">
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
              className="rounded-md border border-positive-line bg-positive-soft px-2.5 py-0.5 text-[11px] font-medium text-positive transition-opacity hover:opacity-90"
            >
              Now
            </button>
          </div>

          {selectedDayInfo?.note && (
            <div className="mt-2 rounded-lg border border-warning-line bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning">
              {formatShortIsoDate(selectedDayInfo.date)}: {selectedDayInfo.note}
            </div>
          )}

          <div className="mt-2.5 space-y-2.5">
            {/* Date Row (opens calendar upward) */}
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-muted">
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
                  className="rounded-lg border border-line bg-surface-subtle px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="flex flex-1 items-center justify-between rounded-lg border border-line bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface"
                >
                  <span>
                    {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)},{" "}
                    {selectedIsoDate.slice(0, 4)}
                  </span>
                  <span className="text-[10px] text-ink-muted">
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
                  className="rounded-lg border border-line bg-surface-subtle px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  &rsaquo;
                </button>
              </div>
            </div>

            {/* Time Section: Exact input + smooth slider */}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-ink-muted">
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
                  className="rounded-md border border-line bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-ink outline-none focus:border-accent"
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
                className="h-2 w-full cursor-pointer accent-accent"
              />
              <div className="mt-0.5 flex items-center justify-between text-[10px] font-medium text-ink-muted">
                <span>8 AM</span>
                <span>12 PM</span>
                <span>4 PM</span>
                <span>8 PM</span>
                <span>9:30 PM</span>
              </div>
            </div>

            {/* Duration Choices */}
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-muted">
                Duration
              </div>
              <div className="grid grid-cols-4 gap-1">
                {DURATION_OPTIONS.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => onChangeDuration(dur)}
                    className={`rounded-lg py-1 text-xs font-medium transition-colors ${
                      currentDuration === dur
                        ? "bg-brand text-brand-fg"
                        : "bg-surface-subtle text-ink-secondary hover:bg-surface-hover hover:text-ink"
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
        className="flex max-w-[calc(100vw-1.5rem)] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface/95 px-3.5 py-1.5 text-xs font-medium text-ink shadow-[var(--shadow-md)] backdrop-blur-md transition-colors hover:border-line-strong hover:bg-surface"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span>
          {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)}
        </span>
        <span className="text-ink-muted">&middot;</span>
        <span className="font-mono font-medium tabular-nums text-accent-ink">
          {formatMinutesToTime(currentSlotStart)}
        </span>
        <span className="text-ink-muted">&middot;</span>
        <span>{formatDuration(currentDuration)}</span>
        <span className="text-[10px] text-ink-muted">
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
        {weekLoading && (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}
      </button>
    </div>
  );
}
