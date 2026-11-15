"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type * as LeafletType from "leaflet";
import { AuthButton } from "@/components/auth-button";
import {
  addDaysIso,
  buildWeekDays,
  CAMPUS_MAP_MAX_DATE,
  CAMPUS_MAP_MAX_WEEK_START,
  CAMPUS_MAP_MIN_DATE,
  CAMPUS_MAP_MIN_WEEK_START,
  clampWeekStart,
  DAY_NAMES,
  DAY_SHORT,
  formatShortIsoDate,
  formatWeekRangeLabel,
  getDefaultCampusMapState,
  getWeekContextLabel,
} from "@/lib/campus-map-dates";
import type {
  CampusMapData,
  CampusMapFeature,
  CampusMapWeekData,
  ScheduleInterval,
} from "@/lib/queries";

type PositionedEvent = ScheduleInterval & {
  day: number;
  lane: number;
  totalLanes: number;
};

type RoomStatus =
  | {
      isScheduled: false;
      isAvailable: null;
      currentBooking: null;
      isBuildingContainer?: false;
    }
  | {
      isScheduled: true;
      isBuildingContainer: true;
      totalRooms: number;
      availableCount: number;
      busyCount: number;
      ratio: number;
      isAvailable: boolean;
      color: string;
      subStatuses: Array<{
        roomId: string;
        capacity: number | null;
        capacitySource: string | null;
        isAvailable: boolean;
        currentBooking: string | null;
        bookingStart: number | null;
        bookingEnd: number | null;
        bookingType: string | null;
        schedule: ScheduleInterval[];
      }>;
    }
  | {
      isScheduled: true;
      isBuildingContainer?: false;
      isAvailable: boolean;
      currentBooking?: string;
      bookingStart?: number;
      bookingEnd?: number;
      bookingType?: string;
      nextBooking?: ScheduleInterval | null;
    };

const FLOOR_COLORS: Record<string, string> = {
  "-10": "#9333ea", // purple
  "0": "#0284c7",   // blue
  "20": "#0d9488",  // teal
  "30": "#eab308",  // amber
  "40": "#f43f5e",  // rose
};

const FLOOR_LABELS: Record<string, string> = {
  ALL: "All",
  "-10": "B",
  "0": "1",
  "20": "2",
  "30": "3",
  "40": "4",
};

function formatFloor(fl: string | null | undefined): string {
  const key = String(fl ?? "");
  return FLOOR_LABELS[key] || key || "—";
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assignOverlapLanes(day: number, events: ScheduleInterval[]): PositionedEvent[] {
  const filtered = events
    .filter((ev) => Number.isFinite(ev.start) && Number.isFinite(ev.end) && ev.end > 480 && ev.start < 1320)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters: Array<Array<ScheduleInterval & { lane: number }>> = [];
  let currentCluster: Array<ScheduleInterval & { lane: number }> = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  for (const ev of filtered) {
    if (currentCluster.length > 0 && ev.start >= clusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      laneEnds = [];
      clusterEnd = -1;
    }

    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= ev.start) {
        placed = i;
        laneEnds[i] = ev.end;
        break;
      }
    }
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(ev.end);
    }
    currentCluster.push({ ...ev, lane: placed });
    if (ev.end > clusterEnd) clusterEnd = ev.end;
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const result: PositionedEvent[] = [];
  for (const cluster of clusters) {
    const totalLanes = Math.max(...cluster.map((e) => e.lane)) + 1;
    for (const ev of cluster) {
      result.push({ ...ev, day, lane: ev.lane, totalLanes });
    }
  }
  return result;
}

const VENUES = {
  north: { lat: 43.9454, lng: -78.8968, zoom: 17 },
  downtown: { lat: 43.8978, lng: -78.8608, zoom: 18 },
  whitby: { lat: 43.8723, lng: -78.9016, zoom: 18 },
};

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDurationLong(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${m}m`;
}

function formatMinutesToTime(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${m === 0 ? "00" : m < 10 ? "0" + m : m} ${ampm}`;
}

function getContainerColor(ratio: number): string {
  let r: number, g: number, b: number;
  if (ratio <= 0.5) {
    const t = ratio / 0.5;
    r = Math.round(244 + (234 - 244) * t);
    g = Math.round(63 + (179 - 63) * t);
    b = Math.round(94 + (8 - 94) * t);
  } else {
    const t = (ratio - 0.5) / 0.5;
    r = Math.round(234 + (16 - 234) * t);
    g = Math.round(179 + (185 - 179) * t);
    b = Math.round(8 + (129 - 8) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/** Fullscreen modal backdrop with high z-index above Leaflet panes and Escape/backdrop dismiss. */
function ModalBackdrop({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const backdropMouseDownRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      {children}
    </div>
  );
}

const WEEK_CACHE_TTL_MS = 90_000;

export function CampusMapView() {
  const [data, setData] = useState<CampusMapData | null>(null);
  const [weekData, setWeekData] = useState<CampusMapWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekReloadNonce, setWeekReloadNonce] = useState(0);

  // Filters & State (week initialized client-side in useEffect to avoid Next 16 prerender Date error)
  const [currentMode, setCurrentMode] = useState<"availability" | "floors">("availability");
  const [currentWeekStart, setCurrentWeekStart] = useState<string | null>(null);
  const [currentFloor, setCurrentFloor] = useState<string>("ALL");
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [currentSlotStart, setCurrentSlotStart] = useState<number>(720); // 12:00 PM
  const [currentDuration, setCurrentDuration] = useState<number>(30); // 30m
  const [availFilter, setAvailFilter] = useState<"ALL" | "SCHEDULED" | "AVAILABLE">("SCHEDULED");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Stats
  const [stats, setStats] = useState({ totalVisible: 0, availCount: 0, busyCount: 0, grayCount: 0 });

  // Modal State
  const [activeModalFeature, setActiveModalFeature] = useState<CampusMapFeature | null>(null);
  const [activeModalSubRoom, setActiveModalSubRoom] = useState<string | null>(null);
  const [isUnmappedOpen, setIsUnmappedOpen] = useState<boolean>(false);

  // Map & Cache references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletType.Map | null>(null);
  const geojsonLayerRef = useRef<LeafletType.GeoJSON | null>(null);
  const leafletRef = useRef<typeof LeafletType | null>(null);
  const weekCacheRef = useRef<Map<string, { data: CampusMapWeekData; fetchedAt: number }>>(new Map());

  // Initialize current Toronto week/day/time on mount and load static campus geometries
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      const initial = getDefaultCampusMapState();
      setCurrentWeekStart(initial.weekStart);
      setCurrentDay(initial.dayIndex);
      setCurrentSlotStart(initial.slotStart);
    });

    const controller = new AbortController();
    async function loadBaseMap() {
      try {
        const res = await fetch("/api/campus-map", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CampusMapData = await res.json();
        if (!controller.signal.aborted) {
          setData(json);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error("Failed to load map data:", err);
        const msg = err instanceof Error ? err.message : "Failed to load campus map data";
        setError(msg);
        setLoading(false);
      }
    }
    loadBaseMap();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  // Load week-by-week real schedule whenever currentWeekStart changes
  useEffect(() => {
    if (!currentWeekStart) return;
    const weekStart = currentWeekStart;

    const cached = weekCacheRef.current.get(weekStart);
    if (cached && Date.now() - cached.fetchedAt < WEEK_CACHE_TTL_MS) {
      setWeekError(null);
      setWeekData(cached.data);
      setWeekLoading(false);
      return;
    }

    const controller = new AbortController();
    async function loadWeek() {
      try {
        setWeekError(null);
        setWeekLoading(true);
        const res = await fetch(`/api/campus-map/week?weekStart=${encodeURIComponent(weekStart)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CampusMapWeekData = await res.json();
        if (!controller.signal.aborted) {
          weekCacheRef.current.set(weekStart, { data: json, fetchedAt: Date.now() });
          setWeekData(json);
          setWeekLoading(false);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error("Failed to load weekly schedule:", err);
        const msg = err instanceof Error ? err.message : "Failed to load weekly schedule";
        setWeekError(msg);
        setWeekData((prev) => (prev?.weekStart === weekStart ? prev : null));
        setWeekLoading(false);
      }
    }
    loadWeek();
    return () => controller.abort();
  }, [currentWeekStart, weekReloadNonce]);

  // Switch week and keep selected day within 2026-09-01 .. 2027-04-30
  const selectWeek = useCallback(
    (targetWeekInput: string, preferredDayIndex?: number) => {
      const clampedWeek = clampWeekStart(targetWeekInput);
      setCurrentWeekStart(clampedWeek);
      setCurrentDay((prevDay) => {
        const candidate = preferredDayIndex ?? prevDay;
        const candidateIso = addDaysIso(clampedWeek, candidate - 1);
        if (candidateIso >= CAMPUS_MAP_MIN_DATE && candidateIso <= CAMPUS_MAP_MAX_DATE) {
          return candidate;
        }
        // Clamp onto nearest valid day within [Sep 1, Apr 30]
        if (candidateIso < CAMPUS_MAP_MIN_DATE) return 2; // Tue Sep 1, 2026
        return 5; // Fri Apr 30, 2027
      });
    },
    [],
  );

  // Ensure Leaflet loads cleanly once container mounts

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let isMounted = true;
    import("leaflet").then((leafletModule) => {
      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;
      const L = (leafletModule.default || leafletModule) as typeof LeafletType;
      leafletRef.current = L;

      const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      });

      const esriSatellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri",
        }
      );

      const esriStreets = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri",
        }
      );

      const map = L.map(mapContainerRef.current, {
        center: [VENUES.north.lat, VENUES.north.lng],
        zoom: VENUES.north.zoom,
        layers: [osm],
        preferCanvas: true,
        zoomControl: false,
      });

      const baseMaps = {
        "OpenStreetMap": osm,
        "Satellite (Esri)": esriSatellite,
        "Streets (Esri)": esriStreets,
      };

      L.control.layers(baseMaps, undefined, { position: "topright" }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);

      mapInstanceRef.current = map;
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Active week day metadata (always aligned to 2026-09-01 .. 2027-04-30)
  const effectiveWeekStart = currentWeekStart ?? CAMPUS_MAP_MIN_WEEK_START;
  const weekDays = useMemo(() => {
    if (weekData && weekData.weekStart === effectiveWeekStart) {
      return weekData.days;
    }
    return buildWeekDays(effectiveWeekStart);
  }, [weekData, effectiveWeekStart]);

  const selectedDayInfo = useMemo(() => {
    return weekDays.find((d) => d.dayIndex === currentDay) ?? null;
  }, [weekDays, currentDay]);

  // Sync "Now" button to live Toronto date/week (clamped to 2026-09-01 .. 2027-04-30)
  const setTimeToNow = useCallback(() => {
    const nowState = getDefaultCampusMapState();
    setCurrentWeekStart(nowState.weekStart);
    setCurrentDay(nowState.dayIndex);
    setCurrentSlotStart(nowState.slotStart);
  }, []);

  // Status check helper powered by live per-week schedules
  const getRoomStatus = useCallback(
    (feature: CampusMapFeature, day: number, slotStart: number): RoomStatus => {
      const p = feature.properties;
      if (!p) {
        return { isScheduled: false, isAvailable: null, currentBooking: null };
      }

      const dayKey = String(day);
      const slotEnd = slotStart + currentDuration;

      // Special handling for Building Containers (UP Building and U5 Building)
      if (p.isBuildingContainer) {
        const roomsData = p.roomsData || {};
        const roomsList = p.rooms || Object.keys(roomsData);
        let availCount = 0;
        let busyCount = 0;
        const subStatuses: Array<{
          roomId: string;
          capacity: number | null;
          capacitySource: string | null;
          isAvailable: boolean;
          currentBooking: string | null;
          bookingStart: number | null;
          bookingEnd: number | null;
          bookingType: string | null;
          schedule: ScheduleInterval[];
        }> = [];

        for (const rid of roomsList) {
          const rData = roomsData[rid] || {
            roomId: rid,
            capacity: null,
            capacitySource: null,
            type: "Classroom",
          };
          const dayIntervals: ScheduleInterval[] = weekData?.subRoomSchedules?.[rid]?.[dayKey] || [];

          let isRoomAvail = true;
          let currentBooking: string | null = null;
          let bookingStart: number | null = null;
          let bookingEnd: number | null = null;
          let bookingType: string | null = null;

          for (const item of dayIntervals) {
            if (item.start < slotEnd && item.end > slotStart) {
              isRoomAvail = false;
              currentBooking = item.title;
              bookingStart = item.start;
              bookingEnd = item.end;
              bookingType = item.type;
              break;
            }
          }

          if (isRoomAvail) availCount++;
          else busyCount++;

          subStatuses.push({
            roomId: rid,
            capacity: rData.capacity,
            capacitySource: rData.capacitySource,
            isAvailable: isRoomAvail,
            currentBooking,
            bookingStart,
            bookingEnd,
            bookingType,
            schedule: dayIntervals,
          });
        }

        const ratio = roomsList.length > 0 ? availCount / roomsList.length : 1;
        return {
          isScheduled: true,
          isBuildingContainer: true,
          totalRooms: roomsList.length,
          availableCount: availCount,
          busyCount,
          ratio,
          isAvailable: availCount > 0,
          color: getContainerColor(ratio),
          subStatuses,
        };
      }

      const eid = p.externalId;
      const dayIntervals: ScheduleInterval[] = (eid && weekData?.schedules?.[eid]?.[dayKey]) || [];
      const isRoomScheduled = Boolean(p.hasSchedule || (eid && weekData?.schedules?.[eid]));

      if (!isRoomScheduled) {
        return { isScheduled: false, isAvailable: null, currentBooking: null };
      }

      for (const item of dayIntervals) {
        if (item.start < slotEnd && item.end > slotStart) {
          return {
            isScheduled: true,
            isAvailable: false,
            currentBooking: item.title,
            bookingStart: item.start,
            bookingEnd: item.end,
            bookingType: item.type,
          };
        }
      }

      let nextBooking: ScheduleInterval | null = null;
      for (const item of dayIntervals) {
        if (item.start >= slotEnd) {
          if (!nextBooking || item.start < nextBooking.start) {
            nextBooking = item;
          }
        }
      }

      return {
        isScheduled: true,
        isAvailable: true,
        nextBooking,
      };
    },
    [currentDuration, weekData]
  );

  // Jump to campus
  const jumpToVenue = useCallback((venueKey: keyof typeof VENUES) => {
    const v = VENUES[venueKey];
    if (mapInstanceRef.current && v) {
      mapInstanceRef.current.flyTo([v.lat, v.lng], v.zoom, { duration: 1.2 });
    }
  }, []);

  // Open Weekly Schedule modal
  const openWeeklySchedule = useCallback((feat: CampusMapFeature, subRoom?: string) => {
    setActiveModalFeature(feat);
    setActiveModalSubRoom(subRoom || (feat.properties.rooms ? feat.properties.rooms[0] : null));
  }, []);

  // Re-render GeoJSON layers on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !data || !L) return;

    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
    }

    let totalVisible = 0;
    let avail = 0;
    let busy = 0;
    let gray = 0;

    const selectedDate = selectedDayInfo?.date ?? addDaysIso(effectiveWeekStart, currentDay - 1);
    const selectedDateDisplay = `${DAY_NAMES[currentDay]}, ${formatShortIsoDate(selectedDate)}`;
    const dayNote = selectedDayInfo?.note;

    const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      filter: (geoFeature) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        if (!feature.geometry || (feature.geometry.type as string) === "Point") return false;

        const props = feature.properties || {};
        const fl = String(props.floor || "");

        if (currentFloor !== "ALL" && fl !== currentFloor) return false;

        if (currentMode === "availability") {
          const status = getRoomStatus(feature, currentDay, currentSlotStart);
          if (!status.isScheduled) {
            gray++;
            if (availFilter === "SCHEDULED" || availFilter === "AVAILABLE") return false;
          } else if (status.isAvailable) {
            avail++;
          } else {
            busy++;
            if (availFilter === "AVAILABLE") return false;
          }
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const name = (props.name || "").toLowerCase();
          const eid = (props.externalId || "").toLowerCase();
          const bldg = (props.building || "").toLowerCase();
          const type = (props.type || "").toLowerCase();
          const weekCourses: string[] = (props.externalId && weekData?.courses?.[props.externalId]) || [];
          const subRooms: string[] = props.rooms || [];
          const coursesMatch =
            weekCourses.some((c) => c.toLowerCase().includes(q)) ||
            subRooms.some((sr) => sr.toLowerCase().includes(q));

          if (!name.includes(q) && !eid.includes(q) && !bldg.includes(q) && !type.includes(q) && !coursesMatch) {
            return false;
          }
        }

        totalVisible++;
        return true;
      },
      style: (geoFeature) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        const fl = feature.properties?.floor || "";

        if (currentMode === "floors") {
          const col = FLOOR_COLORS[fl] || "#64748b";
          return {
            fillColor: col,
            color: col,
            weight: 1.5,
            opacity: 0.95,
            fillOpacity: 0.45,
          };
        } else {
          const status = getRoomStatus(feature, currentDay, currentSlotStart);
          if (!status.isScheduled) {
            return {
              fillColor: "#94a3b8",
              color: "#64748b",
              weight: 1,
              opacity: 0.7,
              fillOpacity: 0.22,
            };
          } else if (status.isBuildingContainer) {
            const dynCol = status.color;
            return {
              fillColor: dynCol,
              color: dynCol,
              weight: 2.5,
              opacity: 1,
              fillOpacity: 0.68,
            };
          } else if (status.isAvailable) {
            return {
              fillColor: "#10b981",
              color: "#059669",
              weight: 2,
              opacity: 0.95,
              fillOpacity: 0.65,
            };
          } else {
            return {
              fillColor: "#f43f5e",
              color: "#be123c",
              weight: 2,
              opacity: 0.95,
              fillOpacity: 0.65,
            };
          }
        }
      },
      onEachFeature: (geoFeature, featureLayer) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        const p = feature.properties || {};
        const roomLabel = p.externalId || p.name || "Room";
        const titleText = p.name
          ? `${p.name}${p.externalId && p.externalId !== p.name ? ` (${p.externalId})` : ""}`
          : p.externalId || "Room";
        const title = escapeHtml(titleText);

        let capHtml = "";
        if (p.isLibraryRoom && p.minCapacity && p.capacity) {
          capHtml = `Capacity: <strong>${p.minCapacity} – ${p.capacity} people</strong> &bull; `;
        } else if (p.capacity) {
          const capSrc = p.capacitySource
            ? ` <span style="font-size:0.7rem; color:#94a3b8;">(${escapeHtml(p.capacitySource)})</span>`
            : "";
          capHtml = `Capacity: <strong>${p.capacity}</strong>${capSrc} &bull; `;
        }

        const bldg = p.building ? `Bldg: <strong>${escapeHtml(p.building)}</strong> &bull; ` : "";
        const fl = `Floor: <strong>${escapeHtml(formatFloor(p.floor))}</strong>`;
        const type = p.type ? `<div style="margin-top:2px; font-weight:600; color:#0284c7;">${escapeHtml(p.type)}</div>` : "";
        const dayNoteHtml = dayNote
          ? `<div style="margin-top:4px; font-size:0.7rem; color:#b45309; background:#fef3c7; border:1px solid #fcd34d; border-radius:4px; padding:2px 6px;">${escapeHtml(dayNote)}</div>`
          : "";

        const status = getRoomStatus(feature, currentDay, currentSlotStart);

        const popupDiv = document.createElement("div");
        popupDiv.className = "p-1 text-xs text-slate-800";

        if (status.isBuildingContainer) {
          const availTxt = `${status.availableCount} of ${status.totalRooms} Rooms Free`;
          popupDiv.innerHTML = `
            <div style="font-weight:700; font-size:0.95rem; margin-bottom:2px;">${escapeHtml(p.name || roomLabel)}</div>
            <div style="display:inline-block; font-size:0.72rem; font-weight:700; border-radius:9999px; padding:2px 8px; margin-bottom:6px; background:${status.color}22; color:${status.color}; border:1px solid ${status.color};">${availTxt}</div>
            <div style="font-size:0.75rem; color:#64748b; margin-bottom:6px;">
              ${escapeHtml(selectedDateDisplay)} (${formatMinutesToTime(currentSlotStart)} – ${formatMinutesToTime(currentSlotStart + currentDuration)}) &bull; <strong>${formatDurationLong(currentDuration)}</strong>
            </div>
            ${dayNoteHtml}
            <div style="margin-top:4px; margin-bottom:6px;">${capHtml}${bldg}${fl}${type}</div>
          `;

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mt-2 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-sky-700";
          btn.textContent = "View Weekly Schedule";
          btn.onclick = () => openWeeklySchedule(feature);
          popupDiv.appendChild(btn);
        } else {
          const badgeColor = status.isScheduled
            ? status.isAvailable
              ? "background:#ecfdf5; color:#059669; border:1px solid #10b981;"
              : "background:#fff1f2; color:#be123c; border:1px solid #f43f5e;"
            : "background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;";
          const badgeText = status.isScheduled ? (status.isAvailable ? "AVAILABLE" : "IN USE") : "NO SCHEDULE";

          const nextText =
            status.isScheduled && status.isAvailable && status.nextBooking
              ? `<br/><span style="color:#64748b;">Next: ${escapeHtml(status.nextBooking.title)} (${formatMinutesToTime(status.nextBooking.start)})</span>`
              : "";

          const statusDetail = status.isScheduled
            ? status.isAvailable
              ? `Free for <strong>${formatDurationLong(currentDuration)}</strong>!${nextText}`
              : `Booked: <strong>${escapeHtml(status.currentBooking || "Scheduled")}</strong><br/>Time: ${formatMinutesToTime(status.bookingStart ?? 0)} – ${formatMinutesToTime(status.bookingEnd ?? 0)}`
            : "No scheduled classes or reservations for this space.";

          const isOutsideLibWindow =
            Boolean(p.isLibraryRoom) &&
            weekData?.libraryWindowStart &&
            weekData?.libraryWindowEnd &&
            (selectedDate < weekData.libraryWindowStart || selectedDate > weekData.libraryWindowEnd);

          const libWindowHtml = isOutsideLibWindow && weekData?.libraryWindowStart && weekData?.libraryWindowEnd
            ? `<div style="margin-top:4px; font-size:0.7rem; color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; padding:2px 6px;">Library bookings live only for ${escapeHtml(formatShortIsoDate(weekData.libraryWindowStart))} – ${escapeHtml(formatShortIsoDate(weekData.libraryWindowEnd))}.</div>`
            : "";

          popupDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:6px;">
              <span style="font-weight:700; font-size:0.95rem;">${title}</span>
              <span style="font-size:0.7rem; font-weight:700; border-radius:9999px; padding:2px 6px; white-space:nowrap; ${badgeColor}">${badgeText}</span>
            </div>
            <div style="font-size:0.72rem; color:#64748b; margin-bottom:4px;">
              ${escapeHtml(selectedDateDisplay)} (${formatMinutesToTime(currentSlotStart)} – ${formatMinutesToTime(currentSlotStart + currentDuration)}) &bull; <strong>${formatDurationLong(currentDuration)}</strong>
            </div>
            ${dayNoteHtml}
            ${libWindowHtml}
            <div style="font-size:0.75rem; margin-top:4px; margin-bottom:6px;">${statusDetail}</div>
            <div style="margin-bottom:6px;">${capHtml}${bldg}${fl}${type}</div>
          `;

          if (status.isScheduled) {
            const btnRow = document.createElement("div");
            btnRow.className = "flex gap-2 mt-2";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "flex-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-sky-700";
            btn.textContent = "View Schedule";
            btn.onclick = () => openWeeklySchedule(feature);
            btnRow.appendChild(btn);

            if (p.isLibraryRoom) {
              const bookTime = formatMinutesToTime(currentSlotStart);
              const bookUrl = `https://apps.library.dc-ot.ca/OTrooms/temp.aspx?starttime=${encodeURIComponent(bookTime)}&room=${encodeURIComponent(p.externalId || roomLabel)}&next=book.aspx`;
              const bookLink = document.createElement("a");
              bookLink.href = bookUrl;
              bookLink.target = "_blank";
              bookLink.rel = "noopener noreferrer";
              bookLink.className = "rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-emerald-700 text-center";
              bookLink.textContent = "Book Room";
              btnRow.appendChild(bookLink);
            }
            popupDiv.appendChild(btnRow);
          }
        }

        featureLayer.bindPopup(popupDiv, { maxWidth: 320 });

        featureLayer.on({
          mouseover: (e) => {
            const l = e.target as LeafletType.Path;
            if (l.setStyle) l.setStyle({ weight: 3.5, fillOpacity: 0.8 });
          },
          mouseout: (e) => {
            geojsonLayerRef.current?.resetStyle(e.target as LeafletType.Path);
          },
        });
      },
    }).addTo(map);

    geojsonLayerRef.current = layer;
    setStats({ totalVisible, availCount: avail, busyCount: busy, grayCount: gray });
  }, [
    data,
    weekData,
    effectiveWeekStart,
    selectedDayInfo,
    currentFloor,
    currentMode,
    currentDay,
    currentSlotStart,
    currentDuration,
    availFilter,
    searchQuery,
    getRoomStatus,
    openWeeklySchedule,
  ]);

  // Auto-play timeline animation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentSlotStart((prev) => {
          let next = prev + 30;
          if (next > 1290) next = 480;
          return next;
        });
      }, 1400);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  // Compute timetable events with overlap lanes for Weekly Schedule Modal
  const modalCalendarEvents = useMemo(() => {
    if (!activeModalFeature || !weekData) return [];
    const p = activeModalFeature.properties;

    const events: PositionedEvent[] = [];
    for (let day = 1; day <= 7; day++) {
      const dayKey = String(day);
      let dayList: ScheduleInterval[] = [];
      if (p.isBuildingContainer && activeModalSubRoom) {
        dayList = weekData.subRoomSchedules?.[activeModalSubRoom]?.[dayKey] || [];
      } else if (p.externalId) {
        dayList = weekData.schedules?.[p.externalId]?.[dayKey] || [];
      }
      events.push(...assignOverlapLanes(day, dayList));
    }
    return events;
  }, [activeModalFeature, activeModalSubRoom, weekData]);

  // Merge fixed unmapped atrium/table spaces with any unmapped classrooms scheduled this week
  const mergedUnmappedSpaces = useMemo(() => {
    const known = data?.unmappedDetailedRes ?? [];
    const knownMap = new Map(known.map((u) => [u.roomId, u]));
    const rows = [...known];
    if (weekData?.unmappedSchedules) {
      for (const roomId of Object.keys(weekData.unmappedSchedules).sort()) {
        if (!knownMap.has(roomId)) {
          rows.push({
            roomId,
            building: roomId.replace(/[^A-Za-z].*$/, "") || "Campus",
            roomType: "Unmapped Scheduled Room",
            capacity: "",
            description: "Active schedule in database; polygon not on floor plan.",
          });
        }
      }
    }
    return rows;
  }, [data, weekData]);

  const showInitialOverlay = loading || (currentWeekStart !== null && !weekData && !error && !weekError);
  const weekRangeText = formatWeekRangeLabel(effectiveWeekStart);
  const weekContextLabel = getWeekContextLabel(effectiveWeekStart);
  const selectedIsoDate = selectedDayInfo?.date ?? addDaysIso(effectiveWeekStart, currentDay - 1);
  const canGoPrevWeek = effectiveWeekStart > CAMPUS_MAP_MIN_WEEK_START;
  const canGoNextWeek = effectiveWeekStart < CAMPUS_MAP_MAX_WEEK_START;

  const isModalLibraryOutsideWindow = Boolean(
    activeModalFeature?.properties.isLibraryRoom &&
      weekData?.libraryWindowStart &&
      weekData?.libraryWindowEnd &&
      (weekData.weekEnd < weekData.libraryWindowStart || weekData.weekStart > weekData.libraryWindowEnd),
  );

  return (
    <div className="relative flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-slate-100 font-sans text-slate-900">
      {/* Top Header */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            &larr; Home
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-sky-600 dark:text-sky-400">
              Campus Rooms &amp; Availability
            </h1>
            <span className="hidden rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 sm:inline-block dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {stats.availCount} Free &bull; {stats.busyCount} In Use &bull; {stats.grayCount} Other
            </span>
          </div>
        </div>

        {/* Header Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search room, building, course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 sm:w-60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1 text-xs text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            )}
          </div>

          {/* Mode Switcher */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <button
              onClick={() => setCurrentMode("availability")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                currentMode === "availability" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
              }`}
            >
              Live Availability
            </button>
            <button
              onClick={() => setCurrentMode("floors")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                currentMode === "floors" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
              }`}
            >
              Floor Colors
            </button>
          </div>

          {/* Active Date & Week Quick Badge */}
          <div className="hidden items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300 xl:flex">
            <span>{weekRangeText}</span>
            <span className="text-sky-400 dark:text-sky-600">&bull;</span>
            <span>{weekContextLabel}</span>
          </div>

          {/* Filter: Scheduled / Available / All */}
          {currentMode === "availability" && (
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
              {(["SCHEDULED", "AVAILABLE", "ALL"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setAvailFilter(filter)}
                  className={`rounded px-2.5 py-1 font-semibold transition ${
                    availFilter === filter ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                  }`}
                >
                  {filter === "SCHEDULED" ? "Scheduled" : filter === "AVAILABLE" ? "Available" : "All"}
                </button>
              ))}
            </div>
          )}

          {/* Floor Selector */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <span className="px-1 text-[10px] font-bold uppercase text-slate-400">Floor</span>
            {["ALL", "-10", "0", "20", "30", "40"].map((fl) => (
              <button
                key={fl}
                onClick={() => setCurrentFloor(fl)}
                className={`rounded px-2 py-0.5 font-semibold transition ${
                  currentFloor === fl ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                }`}
              >
                {FLOOR_LABELS[fl]}
              </button>
            ))}
          </div>

          {/* Campus Jumps */}
          <div className="hidden rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800 md:flex">
            <button onClick={() => jumpToVenue("north")} className="rounded px-2 py-0.5 font-semibold hover:text-sky-600">
              North
            </button>
            <button onClick={() => jumpToVenue("downtown")} className="rounded px-2 py-0.5 font-semibold hover:text-sky-600">
              Downtown
            </button>
            <button onClick={() => jumpToVenue("whitby")} className="rounded px-2 py-0.5 font-semibold hover:text-sky-600">
              Whitby
            </button>
          </div>

          {/* Unmapped Rooms Button */}
          <button
            onClick={() => setIsUnmappedOpen(true)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {mergedUnmappedSpaces.length} Unmapped Spaces
          </button>

          <AuthButton />
        </div>
      </header>

      {/* Main Map Canvas Area */}
      <div className="relative z-0 flex-1 w-full h-full overflow-hidden">
        {/* Loading Overlay */}
        {showInitialOverlay && (
          <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-zinc-950/80">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-zinc-300">
              Loading campus rooms &amp; live weekly schedules from Supabase...
            </p>
          </div>
        )}

        {/* Error Overlay */}
        {(error || (!weekData && weekError)) && (
          <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-white p-6 dark:bg-zinc-900">
            <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              <h2 className="text-lg font-bold">Failed to load map data</h2>
              <p className="mt-1 text-xs">{error ?? weekError}</p>
              <button
                type="button"
                onClick={() => {
                  if (error) {
                    window.location.reload();
                  } else {
                    weekCacheRef.current.delete(effectiveWeekStart);
                    setWeekReloadNonce((n) => n + 1);
                  }
                }}
                className="mt-4 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Transient Week Load Banner (if base map is ready) */}
        {!error && weekData && weekError && (
          <div className="absolute top-4 left-1/2 z-[1050] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-red-200 bg-red-50/95 px-4 py-2 text-xs font-semibold text-red-700 shadow-lg backdrop-blur dark:border-red-900 dark:bg-red-950/95 dark:text-red-200">
            <span>Could not load schedule for {formatWeekRangeLabel(effectiveWeekStart)}: {weekError}</span>
            <button
              type="button"
              onClick={() => {
                weekCacheRef.current.delete(effectiveWeekStart);
                setWeekReloadNonce((n) => n + 1);
              }}
              className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Leaflet Map Div */}
        <div ref={mapContainerRef} className="relative z-0 isolate h-full w-full" id="map-container" />

        {/* Legend Overlay */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute bottom-6 left-4 z-[1000] hidden flex-col gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md lg:flex dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Status Legend</div>
          {currentMode === "availability" ? (
            <>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-sm" />
                <span>Available ({stats.availCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-500 shadow-sm" />
                <span>In Use ({stats.busyCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-slate-400 shadow-sm" />
                <span>No Schedule / Other ({stats.grayCount})</span>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {Object.entries(FLOOR_COLORS).map(([fl, col]) => (
                <div key={fl} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: col }} />
                  <span>Floor {FLOOR_LABELS[fl]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Floating Timeline Control Bar */}
        {currentMode === "availability" && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="absolute bottom-6 left-1/2 z-[1000] w-[95%] max-w-2xl -translate-x-1/2 rounded-2xl border border-slate-200/95 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
          >
            {/* Row 1: Week Navigation & Academic Context */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-zinc-800">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canGoPrevWeek}
                  onClick={() => selectWeek(addDaysIso(effectiveWeekStart, -7))}
                  aria-label="Previous week"
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  &larr; Prev Wk
                </button>
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-xs font-extrabold tracking-tight text-slate-900 sm:text-sm dark:text-zinc-100">
                    {weekRangeText}
                  </span>
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
                    {weekContextLabel}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!canGoNextWeek}
                  onClick={() => selectWeek(addDaysIso(effectiveWeekStart, 7))}
                  aria-label="Next week"
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Next Wk &rarr;
                </button>
              </div>

              <div className="flex items-center gap-2">
                {weekLoading && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
                    Syncing…
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
                    selectWeek(clamped, dayIdx);
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
              </div>
            </div>

            {/* Academic Note Banner for Selected Day (if holiday, reading week, exam period, makeup Friday) */}
            {selectedDayInfo?.note && (
              <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                {formatShortIsoDate(selectedDayInfo.date)}: {selectedDayInfo.note}
              </div>
            )}

            {/* Row 2: Day Pills with Dates, Selected Time, Step Controls */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-zinc-800">
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
                      title={dayInfo.note ? `${dayInfo.date} — ${dayInfo.note}` : dayInfo.date}
                      onClick={() => setCurrentDay(dayInfo.dayIndex)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                        isActive
                          ? "bg-sky-600 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {DAY_SHORT[dayInfo.dayIndex]}{" "}
                      <span className={isActive ? "text-sky-100" : "text-slate-400 dark:text-zinc-500"}>
                        {dayNum}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Time Display */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-sky-600 sm:text-sm dark:text-sky-400">
                  {formatMinutesToTime(currentSlotStart)} – {formatMinutesToTime(currentSlotStart + currentDuration)}
                </span>
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                  {DAY_SHORT[currentDay]}, {formatShortIsoDate(selectedIsoDate)}
                </span>
              </div>

              {/* Step & Play Controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentSlotStart((p) => Math.max(480, p - 30))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  -30m
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className={`rounded px-2.5 py-0.5 text-xs font-bold text-white transition ${
                    isPlaying ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"
                  }`}
                >
                  {isPlaying ? "⏸ Pause" : "▶ Play"}
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentSlotStart((p) => Math.min(1290, p + 30))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  +30m
                </button>
                <button
                  type="button"
                  onClick={setTimeToNow}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  Now
                </button>
              </div>
            </div>

            {/* Duration Selector & Time Slider */}
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] font-semibold text-slate-500">Slot Duration:</span>
                  {[10, 30, 60, 120, 180, 300].map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setCurrentDuration(dur)}
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                        currentDuration === dur
                          ? "bg-sky-600 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {formatDuration(dur)}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] font-semibold text-slate-500">
                  Seeking <strong className="text-sky-600 dark:text-sky-400">{formatDurationLong(currentDuration)}</strong> free block
                </span>
              </div>

              {/* Slider */}
              <div className="relative pt-1">
                <input
                  type="range"
                  min="480"
                  max="1290"
                  step="30"
                  value={currentSlotStart}
                  onChange={(e) => setCurrentSlotStart(Number(e.target.value))}
                  className="w-full accent-sky-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>8:00 AM</span>
                  <span>10:00 AM</span>
                  <span>12:00 PM</span>
                  <span>2:00 PM</span>
                  <span>4:00 PM</span>
                  <span>6:00 PM</span>
                  <span>8:00 PM</span>
                  <span>10:00 PM</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Google Calendar-Style Weekly Schedule Modal */}
      {activeModalFeature && (
        <ModalBackdrop onClose={() => setActiveModalFeature(null)}>
          <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">
                  {activeModalSubRoom ? `${activeModalSubRoom} • ` : ""}
                  {activeModalFeature.properties.name}
                  <span className="ml-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
                    ({weekRangeText})
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Building: <strong>{activeModalFeature.properties.building || "—"}</strong> &bull; Floor:{" "}
                  <strong>{formatFloor(activeModalFeature.properties.floor)}</strong> &bull; Capacity:{" "}
                  <strong>
                    {activeModalFeature.properties.isLibraryRoom && activeModalFeature.properties.minCapacity
                      ? `${activeModalFeature.properties.minCapacity}–${activeModalFeature.properties.capacity}`
                      : activeModalFeature.properties.capacity || "—"}
                  </strong>
                  {" "}&bull;{" "}
                  <span className="font-semibold text-slate-600 dark:text-zinc-300">{weekContextLabel}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Multi-Room Switcher for UP / U5 */}
                {activeModalFeature.properties.isBuildingContainer && activeModalFeature.properties.rooms && (
                  <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                    {activeModalFeature.properties.rooms.map((rm) => (
                      <button
                        key={rm}
                        type="button"
                        onClick={() => setActiveModalSubRoom(rm)}
                        className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                          activeModalSubRoom === rm ? "bg-sky-600 text-white shadow" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                        }`}
                      >
                        {rm}
                      </button>
                    ))}
                  </div>
                )}

                {/* Week Switcher inside modal */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    type="button"
                    disabled={!canGoPrevWeek}
                    onClick={() => selectWeek(addDaysIso(effectiveWeekStart, -7))}
                    className="rounded px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    &larr; Prev Week
                  </button>
                  <span className="px-2 text-xs font-bold text-slate-700 dark:text-zinc-200">
                    {weekLoading ? "Loading…" : weekRangeText}
                  </span>
                  <button
                    type="button"
                    disabled={!canGoNextWeek}
                    onClick={() => selectWeek(addDaysIso(effectiveWeekStart, 7))}
                    className="rounded px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    Next Week &rarr;
                  </button>
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setActiveModalFeature(null)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Library rolling-window notice */}
            {isModalLibraryOutsideWindow && weekData?.libraryWindowStart && weekData?.libraryWindowEnd && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                Library study room bookings are updated daily for the upcoming ~1-week window (
                <strong>
                  {formatShortIsoDate(weekData.libraryWindowStart)} – {formatShortIsoDate(weekData.libraryWindowEnd)}
                </strong>
                ). Historical and far-future weeks do not retain past library bookings.
              </div>
            )}

            {/* Color Key */}
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-1.5 text-[11px] text-slate-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Course / Lab / Tutorial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Final Exam
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Library Booking
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-purple-500" /> Room Reservation
              </span>
            </div>

            {/* Modal Body: Timetable Grid */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Day Column Headers */}
              <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
                <div className="border-r border-slate-200 p-2 text-center text-slate-400 dark:border-zinc-700">Time</div>
                {weekDays.map((dayInfo) => (
                  <div
                    key={dayInfo.date}
                    title={dayInfo.note || dayInfo.date}
                    className={`p-2 text-center ${
                      !dayInfo.inBounds
                        ? "opacity-40"
                        : dayInfo.dayIndex === currentDay
                        ? "bg-sky-100/60 font-extrabold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                        : ""
                    }`}
                  >
                    <div>
                      {DAY_SHORT[dayInfo.dayIndex]} {formatShortIsoDate(dayInfo.date)}
                    </div>
                    {dayInfo.note && (
                      <div className="truncate text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {dayInfo.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Scrollable Calendar Body */}
              <div className="relative flex-1 overflow-y-auto">
                <div className="relative grid grid-cols-8 h-[728px]">
                  {/* Time Labels Column */}
                  <div className="border-r border-slate-200 dark:border-zinc-800">
                    {Array.from({ length: 14 }).map((_, i) => {
                      const hourMin = 480 + i * 60;
                      return (
                        <div key={i} className="h-[52px] border-b border-slate-100 pr-2 text-right text-[11px] text-slate-400 dark:border-zinc-800/80">
                          {formatMinutesToTime(hourMin)}
                        </div>
                      );
                    })}
                  </div>

                  {/* 7 Day Columns with Events */}
                  {weekDays.map((dayInfo) => {
                    const day = dayInfo.dayIndex;
                    const dayEvents = modalCalendarEvents.filter((ev) => ev.day === day);
                    const isToday = day === currentDay;

                    return (
                      <div
                        key={day}
                        className={`relative border-r border-slate-200 dark:border-zinc-800 ${
                          !dayInfo.inBounds
                            ? "bg-slate-100/60 dark:bg-zinc-950/40"
                            : isToday
                            ? "bg-sky-50/20 dark:bg-sky-950/10"
                            : ""
                        }`}
                      >
                        {/* Hour background guide lines */}
                        {Array.from({ length: 14 }).map((_, i) => (
                          <div key={i} className="h-[52px] border-b border-slate-100 dark:border-zinc-800/60" />
                        ))}

                        {/* Event blocks */}
                        {dayEvents.map((ev, idx) => {
                          const visibleStart = Math.max(480, ev.start);
                          const visibleEnd = Math.min(1320, ev.end);
                          const topPx = ((visibleStart - 480) / 840) * 728;
                          const heightPx = Math.max(24, ((visibleEnd - visibleStart) / 840) * 728);
                          const isActiveNow = isToday && currentSlotStart < ev.end && currentSlotStart + currentDuration > ev.start;
                          const leftPct = (ev.lane / ev.totalLanes) * 100;
                          const widthPct = (1 / ev.totalLanes) * 100;

                          return (
                            <div
                              key={idx}
                              style={{
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                left: `calc(${leftPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                              }}
                              title={`${formatMinutesToTime(ev.start)} – ${formatMinutesToTime(ev.end)}\n${ev.title}${ev.meta ? `\n${ev.meta}` : ""}`}
                              className={`absolute overflow-hidden rounded-md p-1 text-[11px] leading-tight shadow-sm transition hover:z-20 hover:shadow-md ${
                                isActiveNow
                                  ? "bg-rose-600 text-white ring-2 ring-rose-400"
                                  : ev.type === "exam"
                                  ? "bg-amber-100 text-amber-950 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-200"
                                  : ev.type === "reservation"
                                  ? "bg-purple-100 text-purple-900 border border-purple-300 dark:bg-purple-950/70 dark:text-purple-200"
                                  : ev.type === "library_booking"
                                  ? "bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200"
                                  : "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-950/70 dark:text-sky-200"
                              }`}
                            >
                              <div className="font-bold opacity-80">
                                {formatMinutesToTime(ev.start)} – {formatMinutesToTime(ev.end)}
                              </div>
                              <div className="line-clamp-2 font-semibold">{ev.title}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Unmapped Rooms Modal */}
      {isUnmappedOpen && (
        <ModalBackdrop onClose={() => setIsUnmappedOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                  Unmapped Spaces &amp; Atria ({weekRangeText})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Open table spaces and off-plan rooms for {DAY_NAMES[currentDay]}, {formatShortIsoDate(selectedIsoDate)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUnmappedOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {mergedUnmappedSpaces.map((u) => {
                  const dayKey = String(currentDay);
                  const slots = weekData?.unmappedSchedules?.[u.roomId]?.[dayKey] ?? [];
                  const slotEnd = currentSlotStart + currentDuration;
                  const activeSlot = slots.find((s) => s.start < slotEnd && s.end > currentSlotStart);

                  return (
                    <div
                      key={u.roomId}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sky-600 dark:text-sky-400">{u.roomId}</span>
                          {slots.length > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                activeSlot
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
                              }`}
                            >
                              {activeSlot ? `In Use (${activeSlot.title})` : `${slots.length} booked today`}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500">
                          {u.building ? `Building: ${u.building}` : "Campus Space"} &bull; {u.roomType || "Lounge Space"}
                        </div>
                        {u.description && <div className="mt-1 text-[11px] text-slate-400">{u.description}</div>}
                        {slots.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {slots.map((s, i) => (
                              <span
                                key={i}
                                className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-xs dark:bg-zinc-800 dark:text-zinc-300"
                              >
                                {formatMinutesToTime(s.start)}–{formatMinutesToTime(s.end)}: {s.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {u.capacity && (
                        <span className="shrink-0 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-zinc-700 dark:text-zinc-200">
                          Cap: {u.capacity}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
