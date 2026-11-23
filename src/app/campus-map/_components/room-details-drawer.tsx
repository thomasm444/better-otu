"use client";

import React, { useMemo, useState } from "react";
import {
  DAY_NAMES,
  formatShortIsoDate,
  type WeekDayInfo,
} from "@/lib/campus-map-dates";
import type {
  CampusMapFeature,
  CampusMapWeekData,
  ScheduleInterval,
} from "@/lib/queries";
import {
  formatDurationLong,
  formatFloor,
  formatMinutesToTime,
  getEventTypeLabel,
  getInfosilemBookingUrl,
  getLibraryBookingUrl,
  type RoomStatus,
} from "../utils";

interface RoomDetailsDrawerProps {
  feature: CampusMapFeature | null;
  status: RoomStatus | null;
  weekData: CampusMapWeekData | null;
  currentDay: number;
  selectedIsoDate: string;
  selectedDayInfo: WeekDayInfo | null;
  currentSlotStart: number;
  currentDuration: number;
  selectedSubRoom?: string | null;
  onSelectSubRoom?: (subRoom: string) => void;
  onClose: () => void;
  onOpenWeeklySchedule: (feature: CampusMapFeature, subRoom?: string) => void;
  onFocusRoom: (feature: CampusMapFeature) => void;
}

const DAY_START_MIN = 480; // 8:00 AM
const DAY_END_MIN = 1320; // 10:00 PM
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN;

function getEventBadgeStyles(type: ScheduleInterval["type"]): {
  bar: string;
  pill: string;
  card: string;
} {
  if (type === "exam") {
    return {
      bar: "bg-amber-500",
      pill: "bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200",
      card: "border-l-amber-500",
    };
  }
  if (type === "library_booking") {
    return {
      bar: "bg-emerald-500",
      pill: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-200",
      card: "border-l-emerald-500",
    };
  }
  if (type === "reservation") {
    return {
      bar: "bg-purple-500",
      pill: "bg-purple-100 text-purple-900 dark:bg-purple-950/80 dark:text-purple-200",
      card: "border-l-purple-500",
    };
  }
  return {
    bar: "bg-sky-500",
    pill: "bg-sky-100 text-sky-900 dark:bg-sky-950/80 dark:text-sky-200",
    card: "border-l-sky-500",
  };
}

export function RoomDetailsDrawer({
  feature,
  status,
  weekData,
  currentDay,
  selectedIsoDate,
  selectedDayInfo,
  currentSlotStart,
  currentDuration,
  selectedSubRoom,
  onSelectSubRoom,
  onClose,
  onOpenWeeklySchedule,
  onFocusRoom,
}: RoomDetailsDrawerProps) {
  const [selectedSubRoomByFeature, setSelectedSubRoomByFeature] = useState<
    Record<string, string>
  >({});

  const activeSubRoom = useMemo(() => {
    if (!feature?.properties.isBuildingContainer) return null;
    const rooms = feature.properties.rooms ?? [];
    if (rooms.length === 0) return null;
    if (selectedSubRoom && rooms.includes(selectedSubRoom)) return selectedSubRoom;
    const saved = selectedSubRoomByFeature[feature.id];
    return saved && rooms.includes(saved) ? saved : rooms[0];
  }, [feature, selectedSubRoom, selectedSubRoomByFeature]);

  const todayIntervals = useMemo<ScheduleInterval[]>(() => {
    if (!feature || !weekData) return [];
    const dayKey = String(currentDay);
    const p = feature.properties;

    let raw: ScheduleInterval[] = [];
    if (p.isBuildingContainer && activeSubRoom) {
      raw = weekData.subRoomSchedules?.[activeSubRoom]?.[dayKey] ?? [];
    } else if (p.externalId) {
      raw = weekData.schedules?.[p.externalId]?.[dayKey] ?? [];
    }
    return [...raw].sort((a, b) => a.start - b.start || a.end - b.end);
  }, [feature, weekData, currentDay, activeSubRoom]);

  if (!feature || !status) return null;

  const p = feature.properties;
  const roomCode = p.externalId || p.name || "Room";
  const showSubtitleName = Boolean(p.name && p.externalId && p.name !== p.externalId);
  const slotEnd = currentSlotStart + currentDuration;
  const selectedDateDisplay = `${DAY_NAMES[currentDay]}, ${formatShortIsoDate(selectedIsoDate)}`;

  const activeSubStatus =
    status.isBuildingContainer && activeSubRoom
      ? status.subStatuses.find((s) => s.roomId === activeSubRoom) ?? null
      : null;

  const displayCapacity = (() => {
    if (activeSubStatus?.capacity) {
      return `${activeSubStatus.capacity} seats`;
    }
    if (p.isLibraryRoom && p.minCapacity && p.capacity) {
      return `${p.minCapacity}–${p.capacity} people`;
    }
    if (p.capacity) {
      return `${p.capacity} seats`;
    }
    return "—";
  })();

  const capacitySource = activeSubStatus?.capacitySource ?? p.capacitySource;

  const isOutsideLibWindow = Boolean(
    p.isLibraryRoom &&
      weekData?.libraryWindowStart &&
      weekData?.libraryWindowEnd &&
      (selectedIsoDate < weekData.libraryWindowStart ||
        selectedIsoDate > weekData.libraryWindowEnd),
  );

  // Selected window marker percentages on the 8 AM - 10 PM bar
  const windowLeftPct = Math.max(
    0,
    Math.min(100, ((currentSlotStart - DAY_START_MIN) / DAY_SPAN_MIN) * 100),
  );
  const windowWidthPct = Math.max(
    1.5,
    Math.min(100 - windowLeftPct, (currentDuration / DAY_SPAN_MIN) * 100),
  );

  const activeBookingUuid = p.isBuildingContainer
    ? activeSubStatus?.bookingUuid ?? null
    : p.bookingUuid ?? null;

  return (
    <aside
      aria-label="Room details"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute inset-x-2 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.5rem)] top-auto z-[1050] flex max-h-[60dvh] flex-col rounded-2xl border border-slate-200 bg-white/98 shadow-2xl backdrop-blur-md transition-transform duration-200 lg:inset-x-auto lg:bottom-0 lg:left-0 lg:top-0 lg:max-h-none lg:w-full lg:max-w-[360px] lg:rounded-none lg:border-r lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-900/98 dark:text-zinc-100"
    >
      {/* Mobile Bottom Sheet Handle */}
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300 lg:hidden dark:bg-zinc-700" />

      {/* Drawer Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 lg:py-3.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50">
              {roomCode}
            </h2>
            {p.isLibraryRoom && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                Library Study
              </span>
            )}
          </div>
          {showSubtitleName && (
            <p className="truncate text-xs font-medium text-slate-700 dark:text-zinc-300">
              {p.name}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-zinc-400">
            {p.building ? `${p.building}` : "Campus Space"}
            {p.venue ? ` • ${p.venue}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onFocusRoom(feature)}
            title="Zoom to room on map"
            aria-label="Zoom to room on map"
            className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close room details"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
        {/* Current Availability Card */}
        <div
          className={`rounded-xl border p-3 ${
            !status.isScheduled
              ? "border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800/60"
              : status.isBuildingContainer
                ? "border-slate-200 bg-slate-50/90 dark:border-zinc-700 dark:bg-zinc-800/60"
                : status.isAvailable
                  ? "border-emerald-200 bg-emerald-50/75 dark:border-emerald-900/70 dark:bg-emerald-950/35"
                  : "border-rose-200 bg-rose-50/75 dark:border-rose-900/70 dark:bg-rose-950/35"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            {status.isBuildingContainer ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold"
                style={{
                  backgroundColor: `${status.color}18`,
                  color: status.color,
                  borderColor: status.color,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.availableCount} of {status.totalRooms} Rooms Free
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  !status.isScheduled
                    ? "bg-slate-200 text-slate-700 dark:bg-zinc-700 dark:text-zinc-200"
                    : status.isAvailable
                      ? "bg-emerald-600 text-white"
                      : "bg-rose-600 text-white"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    !status.isScheduled ? "bg-slate-500" : "bg-white"
                  }`}
                />
                {!status.isScheduled
                  ? "Unscheduled / Non-Bookable"
                  : status.isAvailable
                    ? "Available"
                    : "In Use"}
              </span>
            )}
            <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
              {formatDurationLong(currentDuration)}
            </span>
          </div>

          <p className="mt-2 text-xs font-medium text-slate-700 dark:text-zinc-300">
            {selectedDateDisplay} &bull; {formatMinutesToTime(currentSlotStart)} –{" "}
            {formatMinutesToTime(slotEnd)}
          </p>

          {!status.isScheduled ? (
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
              No scheduled classes or reservations are tracked for this space.
            </p>
          ) : status.isBuildingContainer ? (
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
              Select a room below to inspect its schedule for today.
            </p>
          ) : status.isAvailable ? (
            <div className="mt-1.5 text-xs text-emerald-900 dark:text-emerald-200">
              <p className="font-semibold">
                Free for your {formatDurationLong(currentDuration)} window.
              </p>
              {status.nextBooking && (
                <p className="mt-0.5 text-[11px] text-slate-700 dark:text-zinc-300">
                  Next booking: <strong>{status.nextBooking.title}</strong> at{" "}
                  {formatMinutesToTime(status.nextBooking.start)}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-rose-950 dark:text-rose-200">
              <p className="font-semibold">{status.currentBooking || "Booked"}</p>
              <p className="mt-0.5 text-[11px] text-rose-800 dark:text-rose-300">
                {formatMinutesToTime(status.bookingStart ?? 0)} –{" "}
                {formatMinutesToTime(status.bookingEnd ?? 0)}
                {status.bookingType ? ` • ${getEventTypeLabel(status.bookingType)}` : ""}
              </p>
            </div>
          )}

          {selectedDayInfo?.note && (
            <div className="mt-2 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-200">
              {selectedDayInfo.note}
            </div>
          )}

          {isOutsideLibWindow &&
            weekData?.libraryWindowStart &&
            weekData?.libraryWindowEnd && (
              <div className="mt-2 rounded-md border border-slate-300 bg-white/80 px-2 py-1 text-[11px] text-slate-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                Live library bookings cover{" "}
                <strong>
                  {formatShortIsoDate(weekData.libraryWindowStart)} –{" "}
                  {formatShortIsoDate(weekData.libraryWindowEnd)}
                </strong>
                .
              </div>
            )}
        </div>

        {/* Room Metadata Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              Floor
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-zinc-100">
              {formatFloor(p.floor)}
              {p.floorName && p.floorName !== formatFloor(p.floor)
                ? ` (${p.floorName})`
                : ""}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              Capacity
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-zinc-100">
              {displayCapacity}
            </div>
            {capacitySource && (
              <div className="truncate text-[10px] text-slate-500 dark:text-zinc-400">
                Source: {capacitySource}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              Room Type
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-zinc-100">
              {p.type || (p.isLibraryRoom ? "Library Study Room" : "General Space")}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              {p.configType ? "Configuration" : "Building"}
            </div>
            <div className="mt-0.5 truncate font-semibold text-slate-900 dark:text-zinc-100">
              {p.configType || p.building || "—"}
            </div>
          </div>
        </div>

        {/* Building Container Sub-Rooms Selector */}
        {status.isBuildingContainer && status.subStatuses.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Rooms in {p.building || roomCode}
              </h3>
              <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {status.subStatuses.length} rooms
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {status.subStatuses.map((sub) => {
                const isSelected = activeSubRoom === sub.roomId;
                return (
                  <button
                    key={sub.roomId}
                    type="button"
                    onClick={() => {
                      if (onSelectSubRoom) {
                        onSelectSubRoom(sub.roomId);
                      } else {
                        setSelectedSubRoomByFeature((prev) => ({
                          ...prev,
                          [feature.id]: sub.roomId,
                        }));
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      isSelected
                        ? "border-sky-600 bg-sky-600 text-white shadow-xs"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        sub.isAvailable ? "bg-emerald-400" : "bg-rose-400"
                      }`}
                    />
                    <span>{sub.roomId}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Today's Full Schedule Timeline */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
              {activeSubRoom ? `${activeSubRoom} — ` : ""}Today&apos;s Schedule
            </h3>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-400">
              {todayIntervals.length}{" "}
              {todayIntervals.length === 1 ? "booking" : "bookings"}
            </span>
          </div>

          {/* Compact 8 AM - 10 PM Day Bar */}
          {status.isScheduled && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="relative h-5 w-full overflow-hidden rounded bg-emerald-100/80 dark:bg-emerald-950/40">
                {todayIntervals.map((ev, idx) => {
                  const clampedStart = Math.max(DAY_START_MIN, ev.start);
                  const clampedEnd = Math.min(DAY_END_MIN, ev.end);
                  if (clampedEnd <= clampedStart) return null;
                  const left = ((clampedStart - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
                  const width = ((clampedEnd - clampedStart) / DAY_SPAN_MIN) * 100;
                  const evStyles = getEventBadgeStyles(ev.type);
                  return (
                    <div
                      key={idx}
                      style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                      title={`${formatMinutesToTime(ev.start)} – ${formatMinutesToTime(ev.end)}: ${ev.title}`}
                      className={`absolute bottom-0 top-0 ${evStyles.bar} opacity-90`}
                    />
                  );
                })}
                {/* Current Selected Time Window Indicator */}
                <div
                  style={{
                    left: `${windowLeftPct}%`,
                    width: `${windowWidthPct}%`,
                  }}
                  title={`Selected window: ${formatMinutesToTime(currentSlotStart)} – ${formatMinutesToTime(slotEnd)}`}
                  className="pointer-events-none absolute bottom-0 top-0 border-x-2 border-slate-900 bg-slate-900/15 dark:border-white dark:bg-white/20"
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-600 dark:text-zinc-400">
                <span>8 AM</span>
                <span>12 PM</span>
                <span>4 PM</span>
                <span>8 PM</span>
                <span>10 PM</span>
              </div>
            </div>
          )}

          {/* Chronological Booking List */}
          {!status.isScheduled ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600 dark:border-zinc-700 dark:text-zinc-400">
              This space is not on the academic or room booking schedule.
            </div>
          ) : todayIntervals.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 text-center text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              No bookings scheduled for {DAY_NAMES[currentDay]} — open all day.
            </div>
          ) : (
            <div className="space-y-2">
              {todayIntervals.map((ev, idx) => {
                const isOverlappingSlot =
                  ev.start < slotEnd && ev.end > currentSlotStart;
                const evStyles = getEventBadgeStyles(ev.type);
                return (
                  <div
                    key={`${ev.start}-${ev.end}-${idx}`}
                    className={`rounded-lg border border-l-4 p-2.5 text-xs transition ${
                      isOverlappingSlot
                        ? "border-rose-300 border-l-rose-600 bg-rose-50/75 dark:border-rose-800 dark:border-l-rose-500 dark:bg-rose-950/40"
                        : `border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/70 ${evStyles.card}`
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                        {formatMinutesToTime(ev.start)} – {formatMinutesToTime(ev.end)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isOverlappingSlot
                            ? "bg-rose-600 text-white"
                            : evStyles.pill
                        }`}
                      >
                        {isOverlappingSlot
                          ? "Selected Slot"
                          : getEventTypeLabel(ev.type)}
                      </span>
                    </div>
                    <p className="mt-1 font-semibold text-slate-800 dark:text-zinc-200">
                      {ev.title}
                    </p>
                    {ev.meta && (
                      <p className="mt-0.5 text-[11px] text-slate-600 dark:text-zinc-400">
                        {ev.meta}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Primary Action Footer */}
      <div className="border-t border-slate-200 bg-slate-50/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:py-3 dark:border-zinc-800 dark:bg-zinc-900/90">
        {activeBookingUuid ? (
          <div className="flex gap-2">
            <a
              href={getInfosilemBookingUrl(activeBookingUuid)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <span>Book this room &rarr;</span>
            </a>
            {status.isScheduled && (
              <button
                type="button"
                onClick={() => onOpenWeeklySchedule(feature, activeSubRoom ?? undefined)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                View Schedule
              </button>
            )}
          </div>
        ) : p.isLibraryRoom ? (
          <div className="flex gap-2">
            <a
              href={getLibraryBookingUrl(p.externalId || roomCode, currentSlotStart)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <span>Book Room</span>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
            <button
              type="button"
              onClick={() => onOpenWeeklySchedule(feature)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              View Schedule
            </button>
          </div>
        ) : status.isScheduled ? (
          <button
            type="button"
            onClick={() => onOpenWeeklySchedule(feature, activeSubRoom ?? undefined)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-sky-700"
          >
            <span>View Full Weekly Schedule</span>
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-zinc-400">
            <span>Non-bookable / utility space</span>
            <button
              type="button"
              onClick={() => onFocusRoom(feature)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              Center on Map
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
