"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type * as LeafletType from "leaflet";
import { AuthButton } from "@/components/auth-button";
import {
  addDaysIso,
  buildWeekDays,
  CAMPUS_MAP_MAX_WEEK_START,
  CAMPUS_MAP_MIN_DATE,
  CAMPUS_MAP_MIN_WEEK_START,
  CAMPUS_MAP_MAX_DATE,
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
import { RoomDetailsDrawer } from "./_components/room-details-drawer";
import { TimeScrubber } from "./_components/time-scrubber";
import {
  assignOverlapLanes,
  escapeHtml,
  FLOOR_COLORS,
  FLOOR_LABELS,
  formatFloor,
  formatFloorLong,
  formatMinutesToTime,
  getContainerColor,
  getRoomDisplayCode,
  VENUES,
  VERTICAL_FLOOR_KEYS,
  type PositionedEvent,
  type RoomStatus,
  type SubRoomStatus,
  type VenueKey,
} from "./utils";

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

const SELECTED_POLYGON_STYLE: LeafletType.PathOptions = {
  weight: 4,
  color: "#0369a1",
  opacity: 1,
  fillOpacity: 0.85,
};

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
  const [activeVenue, setActiveVenue] = useState<VenueKey>("north");
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [currentSlotStart, setCurrentSlotStart] = useState<number>(720); // 12:00 PM
  const [currentDuration, setCurrentDuration] = useState<number>(30); // 30m

  // Interactive Legend Status Filters (Available + In Use on by default; Unscheduled hidden by default)
  const [showAvailable, setShowAvailable] = useState<boolean>(true);
  const [showInUse, setShowInUse] = useState<boolean>(true);
  const [showUnscheduled, setShowUnscheduled] = useState<boolean>(false);

  // Search & Autocomplete State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Timeline Controls
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isTimeCardCollapsed, setIsTimeCardCollapsed] = useState<boolean>(false);

  // Stats
  const [stats, setStats] = useState({
    totalVisible: 0,
    availCount: 0,
    busyCount: 0,
    grayCount: 0,
  });

  // Slide-out Room Details Drawer & Modals
  const [selectedFeature, setSelectedFeature] = useState<CampusMapFeature | null>(null);
  const [activeModalFeature, setActiveModalFeature] = useState<CampusMapFeature | null>(null);
  const [activeModalSubRoom, setActiveModalSubRoom] = useState<string | null>(null);
  const [isUnmappedOpen, setIsUnmappedOpen] = useState<boolean>(false);

  // Leaflet Floating Floor Control Portal Container
  const [floorControlEl, setFloorControlEl] = useState<HTMLDivElement | null>(null);

  // Map & Cache references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletType.Map | null>(null);
  const geojsonLayerRef = useRef<LeafletType.GeoJSON | null>(null);
  const leafletRef = useRef<typeof LeafletType | null>(null);
  const featureLayerMapRef = useRef<Map<string, LeafletType.Path>>(new Map());
  const selectedFeatureIdRef = useRef<string | null>(null);
  const prevSelectedIdRef = useRef<string | null>(null);
  const weekCacheRef = useRef<Map<string, { data: CampusMapWeekData; fetchedAt: number }>>(
    new Map(),
  );

  // Close search dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Close Room Details Drawer on Escape (only when no modal is open)
  useEffect(() => {
    if (!selectedFeature || activeModalFeature || isUnmappedOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedFeature(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFeature, activeModalFeature, isUnmappedOpen]);

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
        const url = `/api/campus-map/week?weekStart=${encodeURIComponent(weekStart)}`;
        let res = await fetch(url, { signal: controller.signal });
        if (res.status >= 500 && !controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (controller.signal.aborted) return;
          res = await fetch(url, { signal: controller.signal });
        }
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
        if (candidateIso < CAMPUS_MAP_MIN_DATE) return 2; // Tue Sep 1, 2026
        return 5; // Fri Apr 30, 2027
      });
    },
    [],
  );

  // Initialize Leaflet Map with OpenStreetMap & Esri base layers + custom floating Floor Control
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
        },
      );

      const esriStreets = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri",
        },
      );

      const map = L.map(mapContainerRef.current, {
        center: [VENUES.north.lat, VENUES.north.lng],
        zoom: VENUES.north.zoom,
        layers: [osm],
        preferCanvas: true,
        zoomControl: false,
      });

      const baseMaps = {
        OpenStreetMap: osm,
        "Satellite (Esri)": esriSatellite,
        "Streets (Esri)": esriStreets,
      };

      L.control.layers(baseMaps, undefined, { position: "topright" }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);

      // Mount vertical floating Floor Selector directly beneath the +/- zoom controls
      class FloorSelectorControl extends L.Control {
        onAdd() {
          const div = L.DomUtil.create("div", "leaflet-control");
          L.DomEvent.disableClickPropagation(div);
          L.DomEvent.disableScrollPropagation(div);
          return div;
        }
      }
      const floorControl = new FloorSelectorControl({ position: "topright" });
      floorControl.addTo(map);
      const container = floorControl.getContainer();
      if (container instanceof HTMLDivElement) {
        setFloorControlEl(container);
      }

      mapInstanceRef.current = map;
    });

    return () => {
      isMounted = false;
      setFloorControlEl(null);
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
        const subStatuses: SubRoomStatus[] = [];

        for (const rid of roomsList) {
          const rData = roomsData[rid] || {
            roomId: rid,
            capacity: null,
            capacitySource: null,
            type: "Classroom",
          };
          const dayIntervals: ScheduleInterval[] =
            weekData?.subRoomSchedules?.[rid]?.[dayKey] || [];

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
            type: rData.type,
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
      const dayIntervals: ScheduleInterval[] =
        (eid && weekData?.schedules?.[eid]?.[dayKey]) || [];
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
    [currentDuration, weekData],
  );

  // Jump to campus
  const jumpToVenue = useCallback((venueKey: VenueKey) => {
    setActiveVenue(venueKey);
    const v = VENUES[venueKey];
    if (mapInstanceRef.current && v) {
      mapInstanceRef.current.flyTo([v.lat, v.lng], v.zoom, { duration: 1.0 });
    }
  }, []);

  // Fly map to a specific room feature
  const focusRoomOnMap = useCallback((feature: CampusMapFeature) => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !feature.geometry) return;
    try {
      const tempLayer = L.geoJSON(feature as unknown as GeoJSON.GeoJsonObject);
      const bounds = tempLayer.getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, {
          paddingTopLeft: [380, 70],
          paddingBottomRight: [90, 140],
          maxZoom: 19,
          duration: 0.75,
        });
      }
    } catch {
      // Fallback: ignore invalid bounds
    }
  }, []);

  // Open Weekly Schedule modal
  const openWeeklySchedule = useCallback((feat: CampusMapFeature, subRoom?: string) => {
    setActiveModalFeature(feat);
    setActiveModalSubRoom(
      subRoom || (feat.properties.rooms ? feat.properties.rooms[0] : null),
    );
  }, []);

  // Live search dropdown results
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !data?.features) return [];

    const matches: Array<{ feature: CampusMapFeature; score: number }> = [];
    for (const feature of data.features) {
      if (!feature.geometry || (feature.geometry.type as string) === "Point") continue;
      const p = feature.properties || {};
      const name = (p.name || "").toLowerCase();
      const eid = (p.externalId || "").toLowerCase();
      const bldg = (p.building || "").toLowerCase();
      const type = (p.type || "").toLowerCase();
      const weekCourses: string[] = (p.externalId && weekData?.courses?.[p.externalId]) || [];
      const subRooms: string[] = p.rooms || [];

      const exactCode = eid === q || name === q;
      const prefixCode = eid.startsWith(q) || name.startsWith(q);
      const containsCode = eid.includes(q) || name.includes(q);
      const subRoomMatch = subRooms.some((sr) => sr.toLowerCase().includes(q));
      const courseMatch = weekCourses.some((c) => c.toLowerCase().includes(q));
      const metaMatch = bldg.includes(q) || type.includes(q);

      if (!containsCode && !subRoomMatch && !courseMatch && !metaMatch) continue;

      let score = 0;
      if (exactCode) score += 100;
      else if (prefixCode) score += 60;
      else if (containsCode) score += 35;
      if (subRoomMatch) score += 30;
      if (courseMatch) score += 25;
      if (metaMatch) score += 10;
      if (p.hasSchedule || p.isBuildingContainer) score += 20;

      matches.push({ feature, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 8).map((m) => m.feature);
  }, [searchQuery, data, weekData]);

  // Selecting a room from the search bar opens the drawer, ensures visibility, and flies to it
  const handleSelectSearchFeature = useCallback(
    (feature: CampusMapFeature) => {
      const fl = String(feature.properties.floor || "");
      if (currentFloor !== "ALL" && fl && fl !== currentFloor) {
        setCurrentFloor(fl);
      }

      if (currentMode === "availability") {
        const status = getRoomStatus(feature, currentDay, currentSlotStart);
        if (!status.isScheduled && !showUnscheduled) {
          setShowUnscheduled(true);
        } else if (status.isScheduled && status.isAvailable && !showAvailable) {
          setShowAvailable(true);
        } else if (status.isScheduled && !status.isAvailable && !showInUse) {
          setShowInUse(true);
        }
      }

      setSelectedFeature(feature);
      setIsSearchOpen(false);
      focusRoomOnMap(feature);
    },
    [
      currentFloor,
      currentMode,
      currentDay,
      currentSlotStart,
      getRoomStatus,
      showUnscheduled,
      showAvailable,
      showInUse,
      focusRoomOnMap,
    ],
  );

  // Highlight selected polygon smoothly without rebuilding the entire GeoJSON layer
  useEffect(() => {
    selectedFeatureIdRef.current = selectedFeature?.id ?? null;

    const prevId = prevSelectedIdRef.current;
    if (prevId && prevId !== selectedFeature?.id) {
      const prevLayer = featureLayerMapRef.current.get(prevId);
      if (prevLayer && geojsonLayerRef.current) {
        geojsonLayerRef.current.resetStyle(prevLayer);
      }
    }

    if (selectedFeature?.id) {
      const nextLayer = featureLayerMapRef.current.get(selectedFeature.id);
      if (nextLayer) {
        nextLayer.setStyle(SELECTED_POLYGON_STYLE);
        nextLayer.bringToFront();
      }
    }

    prevSelectedIdRef.current = selectedFeature?.id ?? null;
  }, [selectedFeature]);

  // Re-render GeoJSON layers on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !data || !L) return;

    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
    }

    const layerMap = new Map<string, LeafletType.Path>();

    let totalVisible = 0;
    let avail = 0;
    let busy = 0;
    let gray = 0;

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
            if (!showUnscheduled) return false;
          } else if (status.isAvailable) {
            avail++;
            if (!showAvailable) return false;
          } else {
            busy++;
            if (!showInUse) return false;
          }
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const name = (props.name || "").toLowerCase();
          const eid = (props.externalId || "").toLowerCase();
          const bldg = (props.building || "").toLowerCase();
          const type = (props.type || "").toLowerCase();
          const weekCourses: string[] =
            (props.externalId && weekData?.courses?.[props.externalId]) || [];
          const subRooms: string[] = props.rooms || [];
          const coursesMatch =
            weekCourses.some((c) => c.toLowerCase().includes(q)) ||
            subRooms.some((sr) => sr.toLowerCase().includes(q));

          if (
            !name.includes(q) &&
            !eid.includes(q) &&
            !bldg.includes(q) &&
            !type.includes(q) &&
            !coursesMatch
          ) {
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
              fillOpacity: 0.68,
            };
          } else {
            return {
              fillColor: "#f43f5e",
              color: "#be123c",
              weight: 2,
              opacity: 0.95,
              fillOpacity: 0.68,
            };
          }
        }
      },
      onEachFeature: (geoFeature, featureLayer) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        const pathLayer = featureLayer as LeafletType.Path;
        layerMap.set(feature.id, pathLayer);

        const roomLabel = getRoomDisplayCode(feature);
        const status = getRoomStatus(feature, currentDay, currentSlotStart);

        const tooltipStatus = !status.isScheduled
          ? "Unscheduled"
          : status.isBuildingContainer
            ? `${status.availableCount}/${status.totalRooms} free`
            : status.isAvailable
              ? "Available"
              : "In Use";

        const tooltipDot = !status.isScheduled
          ? "#94a3b8"
          : status.isBuildingContainer
            ? status.color
            : status.isAvailable
              ? "#10b981"
              : "#f43f5e";

        featureLayer.bindTooltip(
          `<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;">
            <span style="width:8px;height:8px;border-radius:9999px;background:${tooltipDot};display:inline-block;"></span>
            <span>${escapeHtml(roomLabel)}</span>
            <span style="font-weight:500;color:#475569;">&bull; ${escapeHtml(tooltipStatus)}</span>
          </div>`,
          { direction: "top", sticky: true, opacity: 0.96 },
        );

        featureLayer.on({
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedFeature(feature);
          },
          mouseover: (e) => {
            const l = e.target as LeafletType.Path;
            if (l.setStyle) {
              l.setStyle({ weight: 3.5, fillOpacity: 0.84 });
            }
          },
          mouseout: (e) => {
            const l = e.target as LeafletType.Path;
            if (selectedFeatureIdRef.current === feature.id) {
              l.setStyle(SELECTED_POLYGON_STYLE);
            } else {
              geojsonLayerRef.current?.resetStyle(l);
            }
          },
        });
      },
    }).addTo(map);

    geojsonLayerRef.current = layer;
    featureLayerMapRef.current = layerMap;

    // Re-apply selection highlight if selected room is in the rendered layer
    if (selectedFeatureIdRef.current) {
      const activeLayer = layerMap.get(selectedFeatureIdRef.current);
      if (activeLayer) {
        activeLayer.setStyle(SELECTED_POLYGON_STYLE);
        activeLayer.bringToFront();
      }
    }

    setStats({ totalVisible, availCount: avail, busyCount: busy, grayCount: gray });
  }, [
    data,
    weekData,
    currentFloor,
    currentMode,
    currentDay,
    currentSlotStart,
    showAvailable,
    showInUse,
    showUnscheduled,
    searchQuery,
    getRoomStatus,
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

  // Compute live status for currently selected drawer room
  const selectedFeatureStatus = useMemo(() => {
    if (!selectedFeature) return null;
    return getRoomStatus(selectedFeature, currentDay, currentSlotStart);
  }, [selectedFeature, currentDay, currentSlotStart, getRoomStatus]);

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

  const showInitialOverlay =
    loading || (currentWeekStart !== null && !weekData && !error && !weekError);
  const weekRangeText = formatWeekRangeLabel(effectiveWeekStart);
  const weekContextLabel = getWeekContextLabel(effectiveWeekStart);
  const selectedIsoDate =
    selectedDayInfo?.date ?? addDaysIso(effectiveWeekStart, currentDay - 1);
  const canGoPrevWeek = effectiveWeekStart > CAMPUS_MAP_MIN_WEEK_START;
  const canGoNextWeek = effectiveWeekStart < CAMPUS_MAP_MAX_WEEK_START;

  const isModalLibraryOutsideWindow = Boolean(
    activeModalFeature?.properties.isLibraryRoom &&
      weekData?.libraryWindowStart &&
      weekData?.libraryWindowEnd &&
      (weekData.weekEnd < weekData.libraryWindowStart ||
        weekData.weekStart > weekData.libraryWindowEnd),
  );

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-100 font-sans text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Consolidated Single Top Navigation Bar */}
      <header className="relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Left: Home + Title */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            &larr; Home
          </Link>
          <h1 className="whitespace-nowrap text-sm font-bold tracking-tight text-sky-700 sm:text-base dark:text-sky-400">
            Campus Rooms &amp; Availability
          </h1>
        </div>

        {/* Center Controls: Search, View Mode, Campus Switcher, Unmapped Spaces */}
        <div className="flex flex-1 flex-wrap items-center gap-2 text-xs">
          {/* Search Input with Live Dropdown */}
          <div ref={searchBoxRef} className="relative">
            <input
              type="text"
              placeholder="Search room, building, course..."
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchSuggestions.length > 0) {
                  e.preventDefault();
                  handleSelectSearchFeature(searchSuggestions[0]);
                } else if (e.key === "Escape") {
                  setIsSearchOpen(false);
                }
              }}
              className="w-44 rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-2.5 pr-7 text-xs text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-sky-500 focus:bg-white sm:w-52 xl:w-56 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-400"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchQuery("");
                  setIsSearchOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                &times;
              </button>
            )}

            {/* Autocomplete Dropdown */}
            {isSearchOpen && searchQuery.trim().length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                {searchSuggestions.length === 0 ? (
                  <div className="px-3 py-2.5 text-xs text-slate-600 dark:text-zinc-400">
                    No matching rooms on the map.
                  </div>
                ) : (
                  <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-zinc-800">
                    {searchSuggestions.map((feat) => {
                      const st = getRoomStatus(feat, currentDay, currentSlotStart);
                      const code = getRoomDisplayCode(feat);
                      const dotClass = !st.isScheduled
                        ? "bg-slate-400"
                        : st.isAvailable
                          ? "bg-emerald-500"
                          : "bg-rose-500";
                      const statusLabel = !st.isScheduled
                        ? "Unscheduled"
                        : st.isBuildingContainer
                          ? `${st.availableCount}/${st.totalRooms} Free`
                          : st.isAvailable
                            ? "Available"
                            : "In Use";

                      return (
                        <li key={feat.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectSearchFeature(feat)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-sky-50/70 dark:hover:bg-zinc-800"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                                <span className="truncate font-semibold text-slate-900 dark:text-zinc-100">
                                  {code}
                                </span>
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
                                  Fl {formatFloor(feat.properties.floor)}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-zinc-400">
                                {feat.properties.building || "Campus"}
                                {feat.properties.type ? ` • ${feat.properties.type}` : ""}
                              </p>
                            </div>
                            <span className="shrink-0 text-[10px] font-bold text-slate-700 dark:text-zinc-300">
                              {statusLabel}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Mode Switcher: Live Availability / Floor Colors */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setCurrentMode("availability")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                currentMode === "availability"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-700 hover:text-slate-950 dark:text-zinc-200 dark:hover:text-white"
              }`}
            >
              Live Availability
            </button>
            <button
              type="button"
              onClick={() => setCurrentMode("floors")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                currentMode === "floors"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-700 hover:text-slate-950 dark:text-zinc-200 dark:hover:text-white"
              }`}
            >
              Floor Colors
            </button>
          </div>

          {/* Campus Switcher */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            {(Object.keys(VENUES) as VenueKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => jumpToVenue(key)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  activeVenue === key
                    ? "bg-white text-sky-700 shadow-xs dark:bg-zinc-700 dark:text-sky-300"
                    : "text-slate-700 hover:text-sky-700 dark:text-zinc-200 dark:hover:text-sky-300"
                }`}
              >
                {VENUES[key].label}
              </button>
            ))}
          </div>

          {/* Unmapped Spaces Button */}
          <button
            type="button"
            onClick={() => setIsUnmappedOpen(true)}
            className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {mergedUnmappedSpaces.length} Unmapped Spaces
          </button>
        </div>

        {/* Far Top-Right: User Profile / Auth */}
        <div className="ml-auto shrink-0">
          <AuthButton />
        </div>
      </header>

      {/* Main Map Canvas Area */}
      <div className="relative z-0 h-full w-full flex-1 overflow-hidden">
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
          <div className="absolute left-1/2 top-4 z-[1060] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-red-200 bg-red-50/95 px-4 py-2 text-xs font-semibold text-red-700 shadow-lg backdrop-blur dark:border-red-900 dark:bg-red-950/95 dark:text-red-200">
            <span>
              Could not load schedule for {formatWeekRangeLabel(effectiveWeekStart)}:{" "}
              {weekError}
            </span>
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
        <div
          ref={mapContainerRef}
          className="relative z-0 isolate h-full w-full"
          id="map-container"
        />

        {/* Floating Vertical Floor Selector Portal (directly beneath Leaflet +/- zoom controls) */}
        {floorControlEl &&
          createPortal(
            <div
              role="group"
              aria-label="Floor selector"
              className="mt-1 flex flex-col items-center gap-0.5 rounded-xl border border-slate-200/95 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            >
              <span className="px-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                Floor
              </span>
              {VERTICAL_FLOOR_KEYS.map((fl) => {
                const isSelected = currentFloor === fl;
                const floorColor = FLOOR_COLORS[fl];
                return (
                  <button
                    key={fl}
                    type="button"
                    onClick={() => setCurrentFloor(fl)}
                    aria-pressed={isSelected}
                    title={formatFloorLong(fl)}
                    className={`relative flex h-7 w-8 items-center justify-center rounded-lg text-xs font-bold transition ${
                      isSelected
                        ? "bg-sky-600 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {currentMode === "floors" && floorColor && (
                      <span
                        className="absolute left-1 h-1.5 w-1.5 rounded-full"
                        style={{
                          backgroundColor: isSelected ? "#ffffff" : floorColor,
                        }}
                      />
                    )}
                    <span>{FLOOR_LABELS[fl]}</span>
                  </button>
                );
              })}
            </div>,
            floorControlEl,
          )}

        {/* Slide-Out Room Details Drawer */}
        <RoomDetailsDrawer
          feature={selectedFeature}
          status={selectedFeatureStatus}
          weekData={weekData}
          currentDay={currentDay}
          selectedIsoDate={selectedIsoDate}
          selectedDayInfo={selectedDayInfo}
          currentSlotStart={currentSlotStart}
          currentDuration={currentDuration}
          onClose={() => setSelectedFeature(null)}
          onOpenWeeklySchedule={openWeeklySchedule}
          onFocusRoom={focusRoomOnMap}
        />

        {/* Interactive Bottom-Left Status Legend & Filter */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="absolute left-3 top-3 z-[1000] flex w-[214px] flex-col gap-1 rounded-xl border border-slate-200/95 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur-md lg:bottom-4 lg:left-4 lg:top-auto dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
        >
          <div className="flex items-center justify-between px-1 pb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
              {currentMode === "availability" ? "Status Legend" : "Floor Legend"}
            </span>
            {currentMode === "availability" && (
              <span className="text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                Click to filter
              </span>
            )}
          </div>

          {currentMode === "availability" ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                aria-pressed={showAvailable}
                onClick={() => setShowAvailable((prev) => !prev)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-left transition ${
                  showAvailable
                    ? "border-emerald-200/90 bg-emerald-50/70 text-slate-900 hover:bg-emerald-100/70 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-zinc-100"
                    : "border-transparent bg-slate-100/70 text-slate-500 line-through opacity-75 hover:bg-slate-200/70 dark:bg-zinc-800/60 dark:text-zinc-400"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      showAvailable ? "bg-emerald-500 shadow-xs" : "bg-slate-400"
                    }`}
                  />
                  <span className="font-semibold">Available</span>
                </span>
                <span className="tabular-nums text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                  {stats.availCount}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={showInUse}
                onClick={() => setShowInUse((prev) => !prev)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-left transition ${
                  showInUse
                    ? "border-rose-200/90 bg-rose-50/70 text-slate-900 hover:bg-rose-100/70 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-zinc-100"
                    : "border-transparent bg-slate-100/70 text-slate-500 line-through opacity-75 hover:bg-slate-200/70 dark:bg-zinc-800/60 dark:text-zinc-400"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      showInUse ? "bg-rose-500 shadow-xs" : "bg-slate-400"
                    }`}
                  />
                  <span className="font-semibold">In Use</span>
                </span>
                <span className="tabular-nums text-[11px] font-bold text-rose-800 dark:text-rose-300">
                  {stats.busyCount}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={showUnscheduled}
                onClick={() => setShowUnscheduled((prev) => !prev)}
                title={
                  showUnscheduled
                    ? "Hide unscheduled & utility spaces"
                    : `Show ${stats.grayCount.toLocaleString()} unscheduled & utility spaces`
                }
                className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-left transition ${
                  showUnscheduled
                    ? "border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200/80 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    : "border-transparent bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-zinc-800/40 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      showUnscheduled
                        ? "bg-slate-500"
                        : "border border-slate-400 bg-transparent"
                    }`}
                  />
                  <span className="truncate text-[11px] font-semibold">
                    Unscheduled / Non-Bookable
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-[10px] font-semibold text-slate-600 dark:text-zinc-400">
                  {showUnscheduled ? stats.grayCount.toLocaleString() : "Hidden"}
                </span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 pt-0.5">
              {Object.entries(FLOOR_COLORS).map(([fl, col]) => {
                const isSelected = currentFloor === fl;
                return (
                  <button
                    key={fl}
                    type="button"
                    onClick={() =>
                      setCurrentFloor((prev) => (prev === fl ? "ALL" : fl))
                    }
                    className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-semibold transition ${
                      isSelected
                        ? "bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200"
                        : "text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: col }}
                    />
                    <span className="text-[11px]">Floor {FLOOR_LABELS[fl]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Compact & Collapsible Bottom Time-Scrubber Widget */}
        {currentMode === "availability" && (
          <TimeScrubber
            effectiveWeekStart={effectiveWeekStart}
            weekRangeText={weekRangeText}
            weekContextLabel={weekContextLabel}
            weekDays={weekDays}
            selectedDayInfo={selectedDayInfo}
            selectedIsoDate={selectedIsoDate}
            currentDay={currentDay}
            currentSlotStart={currentSlotStart}
            currentDuration={currentDuration}
            isPlaying={isPlaying}
            weekLoading={weekLoading}
            canGoPrevWeek={canGoPrevWeek}
            canGoNextWeek={canGoNextWeek}
            isCollapsed={isTimeCardCollapsed}
            onToggleCollapse={() => setIsTimeCardCollapsed((prev) => !prev)}
            onSelectWeek={selectWeek}
            onSelectDay={setCurrentDay}
            onChangeSlotStart={setCurrentSlotStart}
            onChangeDuration={setCurrentDuration}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSetNow={setTimeToNow}
          />
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
                  <span className="ml-2 text-xs font-semibold text-sky-700 dark:text-sky-400">
                    ({weekRangeText})
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">
                  Building: <strong>{activeModalFeature.properties.building || "—"}</strong>{" "}
                  &bull; Floor:{" "}
                  <strong>{formatFloor(activeModalFeature.properties.floor)}</strong> &bull;
                  Capacity:{" "}
                  <strong>
                    {activeModalFeature.properties.isLibraryRoom &&
                    activeModalFeature.properties.minCapacity
                      ? `${activeModalFeature.properties.minCapacity}–${activeModalFeature.properties.capacity}`
                      : activeModalFeature.properties.capacity || "—"}
                  </strong>{" "}
                  &bull;{" "}
                  <span className="font-semibold text-slate-800 dark:text-zinc-200">
                    {weekContextLabel}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Multi-Room Switcher for UP / U5 */}
                {activeModalFeature.properties.isBuildingContainer &&
                  activeModalFeature.properties.rooms && (
                    <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                      {activeModalFeature.properties.rooms.map((rm) => (
                        <button
                          key={rm}
                          type="button"
                          onClick={() => setActiveModalSubRoom(rm)}
                          className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                            activeModalSubRoom === rm
                              ? "bg-sky-600 text-white shadow"
                              : "text-slate-700 hover:text-slate-950 dark:text-zinc-300"
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
                  <span className="px-2 text-xs font-bold text-slate-800 dark:text-zinc-100">
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
                  className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Library rolling-window notice */}
            {isModalLibraryOutsideWindow &&
              weekData?.libraryWindowStart &&
              weekData?.libraryWindowEnd && (
                <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Library study room bookings are updated daily for the upcoming ~1-week
                  window (
                  <strong>
                    {formatShortIsoDate(weekData.libraryWindowStart)} –{" "}
                    {formatShortIsoDate(weekData.libraryWindowEnd)}
                  </strong>
                  ). Historical and far-future weeks do not retain past library bookings.
                </div>
              )}

            {/* Color Key */}
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50/80 px-6 py-1.5 text-[11px] font-medium text-slate-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Course / Lab /
                Tutorial
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
              <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200">
                <div className="border-r border-slate-200 p-2 text-center text-slate-600 dark:border-zinc-700 dark:text-zinc-400">
                  Time
                </div>
                {weekDays.map((dayInfo) => (
                  <div
                    key={dayInfo.date}
                    title={dayInfo.note || dayInfo.date}
                    className={`p-2 text-center ${
                      !dayInfo.inBounds
                        ? "opacity-40"
                        : dayInfo.dayIndex === currentDay
                          ? "bg-sky-100/70 font-extrabold text-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
                          : ""
                    }`}
                  >
                    <div>
                      {DAY_SHORT[dayInfo.dayIndex]} {formatShortIsoDate(dayInfo.date)}
                    </div>
                    {dayInfo.note && (
                      <div className="truncate text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {dayInfo.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Scrollable Calendar Body */}
              <div className="relative flex-1 overflow-y-auto">
                <div className="relative grid h-[728px] grid-cols-8">
                  {/* Time Labels Column */}
                  <div className="border-r border-slate-200 dark:border-zinc-800">
                    {Array.from({ length: 14 }).map((_, i) => {
                      const hourMin = 480 + i * 60;
                      return (
                        <div
                          key={i}
                          className="h-[52px] border-b border-slate-100 pr-2 text-right text-[11px] font-medium text-slate-600 dark:border-zinc-800/80 dark:text-zinc-400"
                        >
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
                              ? "bg-sky-50/25 dark:bg-sky-950/10"
                              : ""
                        }`}
                      >
                        {/* Hour background guide lines */}
                        {Array.from({ length: 14 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-[52px] border-b border-slate-100 dark:border-zinc-800/60"
                          />
                        ))}

                        {/* Event blocks */}
                        {dayEvents.map((ev, idx) => {
                          const visibleStart = Math.max(480, ev.start);
                          const visibleEnd = Math.min(1320, ev.end);
                          const topPx = ((visibleStart - 480) / 840) * 728;
                          const heightPx = Math.max(
                            24,
                            ((visibleEnd - visibleStart) / 840) * 728,
                          );
                          const isActiveNow =
                            isToday &&
                            currentSlotStart < ev.end &&
                            currentSlotStart + currentDuration > ev.start;
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
                                    ? "border border-amber-300 bg-amber-100 text-amber-950 dark:bg-amber-950/70 dark:text-amber-200"
                                    : ev.type === "reservation"
                                      ? "border border-purple-300 bg-purple-100 text-purple-900 dark:bg-purple-950/70 dark:text-purple-200"
                                      : ev.type === "library_booking"
                                        ? "border border-emerald-300 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200"
                                        : "border border-sky-300 bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200"
                              }`}
                            >
                              <div className="font-bold opacity-85">
                                {formatMinutesToTime(ev.start)} –{" "}
                                {formatMinutesToTime(ev.end)}
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
                <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-400">
                  Open table spaces and off-plan rooms for {DAY_NAMES[currentDay]},{" "}
                  {formatShortIsoDate(selectedIsoDate)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUnmappedOpen(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
                  const activeSlot = slots.find(
                    (s) => s.start < slotEnd && s.end > currentSlotStart,
                  );

                  return (
                    <div
                      key={u.roomId}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sky-700 dark:text-sky-400">
                            {u.roomId}
                          </span>
                          {slots.length > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                activeSlot
                                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200"
                                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200"
                              }`}
                            >
                              {activeSlot
                                ? `In Use (${activeSlot.title})`
                                : `${slots.length} booked today`}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-600 dark:text-zinc-300">
                          {u.building ? `Building: ${u.building}` : "Campus Space"} &bull;{" "}
                          {u.roomType || "Lounge Space"}
                        </div>
                        {u.description && (
                          <div className="mt-1 text-[11px] text-slate-600 dark:text-zinc-400">
                            {u.description}
                          </div>
                        )}
                        {slots.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {slots.map((s, i) => (
                              <span
                                key={i}
                                className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 shadow-xs dark:bg-zinc-800 dark:text-zinc-200"
                              >
                                {formatMinutesToTime(s.start)}–
                                {formatMinutesToTime(s.end)}: {s.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {u.capacity && (
                        <span className="shrink-0 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800 dark:bg-zinc-700 dark:text-zinc-100">
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
