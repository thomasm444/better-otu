"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CampusMapData, CampusMapFeature } from "@/lib/queries";
import {
  formatMinutesShort,
  getRoomDisplayCode,
  type RoomStatus,
} from "../utils";

interface BookableRoomEntry {
  key: string;
  feature: CampusMapFeature;
  subRoomId?: string;
  roomCode: string;
  building: string;
  capacityLabel: string | null;
  isAvailable: boolean;
  statusLabel: string;
}

interface BookableRoomsPanelProps {
  isOpen: boolean;
  data: CampusMapData | null;
  currentDay: number;
  currentSlotStart: number;
  currentDuration: number;
  getRoomStatus: (
    feature: CampusMapFeature,
    day: number,
    slotStart: number,
  ) => RoomStatus;
  onSelectRoom: (feature: CampusMapFeature, subRoomId?: string) => void;
  onClose: () => void;
}

function formatCapacity(minCapacity: number | null | undefined, capacity: number | null | undefined): string | null {
  if (minCapacity && capacity && minCapacity !== capacity) {
    return `${minCapacity}\u2013${capacity} seats`;
  }
  if (capacity && capacity > 0) {
    return `${capacity} ${capacity === 1 ? "seat" : "seats"}`;
  }
  return null;
}

export function BookableRoomsPanel({
  isOpen,
  data,
  currentDay,
  currentSlotStart,
  currentDuration,
  getRoomStatus,
  onSelectRoom,
  onClose,
}: BookableRoomsPanelProps) {
  const [onlyFree, setOnlyFree] = useState(true);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const entries = useMemo(() => {
    if (!isOpen || !data?.features) return [];

    const slotEnd = currentSlotStart + currentDuration;
    const seenKeys = new Set<string>();
    const list: BookableRoomEntry[] = [];

    for (const feature of data.features) {
      if (!feature.geometry || (feature.geometry.type as string) === "Point") {
        continue;
      }
      const p = feature.properties;
      const building = (p.building || "").trim().toUpperCase();
      const status = getRoomStatus(feature, currentDay, currentSlotStart);

      if (p.isBuildingContainer && status.isBuildingContainer) {
        for (const sub of status.subStatuses) {
          if (!sub.isBookable) continue;
          const dedupKey = `sub:${sub.roomId}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);

          let statusLabel = "In use";
          if (sub.isAvailable) {
            let nextStart: number | null = null;
            for (const ev of sub.schedule) {
              if (ev.start >= slotEnd && (nextStart === null || ev.start < nextStart)) {
                nextStart = ev.start;
              }
            }
            statusLabel =
              nextStart !== null
                ? `Free until ${formatMinutesShort(nextStart)}`
                : "Free all day";
          } else if (sub.bookingEnd !== null) {
            statusLabel = `In use until ${formatMinutesShort(sub.bookingEnd)}`;
          }

          list.push({
            key: dedupKey,
            feature,
            subRoomId: sub.roomId,
            roomCode: sub.roomId,
            building,
            capacityLabel: formatCapacity(null, sub.capacity),
            isAvailable: sub.isAvailable,
            statusLabel,
          });
        }
        continue;
      }

      if (!p.isBookable) continue;
      const roomCode = getRoomDisplayCode(feature);
      const dedupKey = `${building}:${roomCode}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const isAvailable = status.isScheduled ? Boolean(status.isAvailable) : true;
      let statusLabel = "Free all day";
      if (status.isScheduled && !status.isBuildingContainer) {
        if (status.isAvailable) {
          statusLabel = status.nextBooking
            ? `Free until ${formatMinutesShort(status.nextBooking.start)}`
            : "Free all day";
        } else {
          statusLabel =
            status.bookingEnd !== undefined
              ? `In use until ${formatMinutesShort(status.bookingEnd)}`
              : "In use";
        }
      }

      list.push({
        key: dedupKey,
        feature,
        roomCode,
        building,
        capacityLabel: formatCapacity(p.minCapacity, p.capacity),
        isAvailable,
        statusLabel,
      });
    }

    list.sort(
      (a, b) =>
        a.building.localeCompare(b.building, "en") ||
        a.roomCode.localeCompare(b.roomCode, "en", { numeric: true }),
    );
    return list;
  }, [isOpen, data, currentDay, currentSlotStart, currentDuration, getRoomStatus]);

  const totalCount = entries.length;
  const freeCount = useMemo(
    () => entries.reduce((acc, item) => acc + (item.isAvailable ? 1 : 0), 0),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    return onlyFree ? entries.filter((item) => item.isAvailable) : entries;
  }, [entries, onlyFree]);

  if (!isOpen) return null;

  return (
    <section
      aria-label="Bookable rooms"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute left-2.5 right-2.5 top-2.5 z-[1040] flex max-h-[min(68dvh,calc(100%-4.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface/98 shadow-[var(--shadow-lg)] backdrop-blur-md sm:left-4 sm:right-auto sm:top-4 sm:w-[360px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-ink">
            Bookable Rooms
          </h2>
          <p className="text-[11px] font-medium tabular-nums text-ink-muted">
            {freeCount} free now &middot; {totalCount} total
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex rounded-lg border border-line bg-surface-subtle p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setOnlyFree(true)}
              className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                onlyFree
                  ? "bg-emerald-600 text-white"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              Free now
            </button>
            <button
              type="button"
              onClick={() => setOnlyFree(false)}
              className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                !onlyFree
                  ? "bg-brand text-brand-fg"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              All
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close bookable rooms"
            className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-ink-muted">
            No free bookable rooms for this time window.
          </div>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {filteredEntries.map((item) => {
              const parts = [
                item.roomCode,
                item.capacityLabel,
                item.statusLabel,
              ].filter(Boolean);

              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onSelectRoom(item.feature, item.subRoomId)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-surface-subtle"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        item.isAvailable ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink-secondary">
                      <span className="font-semibold text-ink">
                        {parts[0]}
                      </span>
                      {parts.slice(1).map((part, idx) => (
                        <span key={idx} className="text-ink-muted">
                          {" \u00B7 "}
                          {part}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
