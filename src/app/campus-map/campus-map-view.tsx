"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  DAY_SHORT,
  formatShortIsoDate,
  formatWeekRangeLabel,
  getDayOfWeekMon1,
  getDefaultCampusMapState,
  getWeekContextLabel,
} from "@/lib/campus-map-dates";
import type {
  CampusMapData,
  CampusMapFeature,
  CampusMapWeekData,
  ScheduleInterval,
} from "@/lib/queries";
import { BookableRoomsPanel } from "./_components/bookable-rooms-panel";
import { RoomDetailsDrawer } from "./_components/room-details-drawer";
import { TimeScrubber } from "./_components/time-scrubber";
import {
  assignOverlapLanes,
  escapeHtml,
  FLOOR_LABELS,
  formatFloor,
  formatMinutesToTime,
  getContainerColor,
  getRoomDisplayCode,
  MAIN_BUILDING_SET,
  MAIN_DOWNTOWN_BUILDINGS,
  MAIN_NORTH_BUILDINGS,
  normalizeSearchCode,
  VENUES,
  VERTICAL_FLOOR_KEYS,
  type PositionedEvent,
  type RoomStatus,
  type SubRoomStatus,
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
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4"
    >
      {children}
    </div>
  );
}

type BaseLayerKey = "osm" | "satellite" | "streets";

const BASE_LAYER_OPTIONS: Array<{ key: BaseLayerKey; label: string }> = [
  { key: "osm", label: "OpenStreetMap" },
  { key: "satellite", label: "Satellite (Esri)" },
  { key: "streets", label: "Streets (Esri)" },
];

const WEEK_CACHE_TTL_MS = 90_000;

const SELECTED_POLYGON_STYLE: LeafletType.PathOptions = {
  weight: 4,
  color: "#0369a1",
  opacity: 1,
  fillOpacity: 0.85,
};

function matchesNormalizedSearch(
  feature: CampusMapFeature,
  normQ: string,
  weekData: CampusMapWeekData | null,
): boolean {
  if (!normQ) return true;
  const p = feature.properties || {};
  const eid = normalizeSearchCode(p.externalId);
  const name = normalizeSearchCode(p.name);
  const bldg = normalizeSearchCode(p.building);
  const type = normalizeSearchCode(p.type);
  const bldgName = bldg && name ? `${bldg}${name}` : "";
  const weekCourses: string[] = (p.externalId && weekData?.courses?.[p.externalId]) || [];
  const subRooms: string[] = p.rooms || [];

  return (
    eid.includes(normQ) ||
    name.includes(normQ) ||
    bldgName.includes(normQ) ||
    bldg.includes(normQ) ||
    type.includes(normQ) ||
    subRooms.some((sr) => normalizeSearchCode(sr).includes(normQ)) ||
    weekCourses.some((c) => normalizeSearchCode(c).includes(normQ))
  );
}

export function CampusMapView() {
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const [data, setData] = useState<CampusMapData | null>(null);
  const [weekData, setWeekData] = useState<CampusMapWeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekReloadNonce, setWeekReloadNonce] = useState(0);

  // Main map filters & time state
  const [currentWeekStart, setCurrentWeekStart] = useState<string | null>(null);
  const [currentFloor, setCurrentFloor] = useState<string>("ALL");
  const [focusedBuilding, setFocusedBuilding] = useState<string>("ALL");
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [currentSlotStart, setCurrentSlotStart] = useState<number>(720);
  const [currentDuration, setCurrentDuration] = useState<number>(30);

  // Interactive legend status filters (unscheduled stays off unless explicitly requested via ?filter=all)
  const [showAvailable, setShowAvailable] = useState<boolean>(true);
  const [showInUse, setShowInUse] = useState<boolean>(true);
  const [showUnscheduled, setShowUnscheduled] = useState<boolean>(false);

  // Search & Bookable Rooms & Menu state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const [isBookableOpen, setIsBookableOpen] = useState<boolean>(false);
  const [isTimePopoverOpen, setIsTimePopoverOpen] = useState<boolean>(false);

  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isMoreBuildingsOpen, setIsMoreBuildingsOpen] = useState<boolean>(false);
  const [buildingSearchQuery, setBuildingSearchQuery] = useState<string>("");
  const [activeBaseLayer, setActiveBaseLayer] = useState<BaseLayerKey>("osm");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Stats
  const [stats, setStats] = useState({
    availCount: 0,
    busyCount: 0,
  });

  // Slide-out Room Details Drawer & Independent Weekly Schedule Modal
  const [selectedFeature, setSelectedFeature] = useState<CampusMapFeature | null>(null);
  const [selectedDrawerSubRoom, setSelectedDrawerSubRoom] = useState<string | null>(null);
  const [activeModalFeature, setActiveModalFeature] = useState<CampusMapFeature | null>(null);
  const [activeModalSubRoom, setActiveModalSubRoom] = useState<string | null>(null);
  const [modalWeekStart, setModalWeekStart] = useState<string | null>(null);
  const [modalWeekData, setModalWeekData] = useState<CampusMapWeekData | null>(null);
  const [modalWeekLoading, setModalWeekLoading] = useState<boolean>(false);
  const [modalWeekError, setModalWeekError] = useState<string | null>(null);
  const [modalWeekReloadNonce, setModalWeekReloadNonce] = useState<number>(0);

  // Leaflet Floating Floor Control Portal Container
  const [floorControlEl, setFloorControlEl] = useState<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [pendingBuildingZoom, setPendingBuildingZoom] = useState<string | null>(null);

  // Map & Cache references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletType.Map | null>(null);
  const baseLayersRef = useRef<Record<BaseLayerKey, LeafletType.TileLayer> | null>(null);
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

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  // Close Room Details Drawer on Escape (only when modal, bookable list, and menu are closed)
  useEffect(() => {
    if (!selectedFeature || activeModalFeature || isBookableOpen || isMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedFeature(null);
        setSelectedDrawerSubRoom(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFeature, activeModalFeature, isBookableOpen, isMenuOpen]);

  // Reset transient map state on load / URL param change / bfcache restore
  const syncFromUrl = useCallback((params: URLSearchParams) => {
    const initial = getDefaultCampusMapState();
    setCurrentWeekStart(initial.weekStart);
    setCurrentDay(initial.dayIndex);
    setCurrentSlotStart(initial.slotStart);
    setCurrentDuration(30);

    const qParam = params.get("q")?.trim() ?? "";
    setSearchQuery(qParam);
    setIsSearchOpen(Boolean(qParam));

    const filterParam = params.get("filter")?.toLowerCase();
    if (filterParam === "available") {
      setShowAvailable(true);
      setShowInUse(false);
      setShowUnscheduled(false);
    } else if (filterParam === "all") {
      setShowAvailable(true);
      setShowInUse(true);
      setShowUnscheduled(true);
    } else {
      setShowAvailable(true);
      setShowInUse(true);
      setShowUnscheduled(false);
    }

    const buildingParam = params.get("building")?.trim().toUpperCase() || "";
    setFocusedBuilding(buildingParam || "ALL");
    setPendingBuildingZoom(buildingParam || null);

    setCurrentFloor("ALL");
    setIsMenuOpen(false);
    setIsMoreBuildingsOpen(false);
    setBuildingSearchQuery("");
    setIsBookableOpen(false);
    setIsTimePopoverOpen(false);
    setSelectedFeature(null);
    setSelectedDrawerSubRoom(null);
    setActiveModalFeature(null);
    setActiveModalSubRoom(null);

    const venueParam = params.get("venue")?.toLowerCase();
    const targetVenue =
      venueParam === "downtown" || venueParam === "whitby"
        ? VENUES[venueParam]
        : VENUES.north;
    if (!buildingParam && mapInstanceRef.current) {
      mapInstanceRef.current.setView([targetVenue.lat, targetVenue.lng], targetVenue.zoom, {
        animate: false,
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) syncFromUrl(new URLSearchParams(searchParamsKey));
    });
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        syncFromUrl(new URLSearchParams(window.location.search));
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [searchParamsKey, syncFromUrl]);

  // Load static campus GeoJSON geometries once
  useEffect(() => {
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
    return () => controller.abort();
  }, []);

  // Load week-by-week real schedule for main map whenever currentWeekStart changes
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

  // Initialize Leaflet Map with OpenStreetMap & Esri base layers + compact Floor Control
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

      const initialVenueParam = new URLSearchParams(window.location.search)
        .get("venue")
        ?.toLowerCase();
      const initialVenue =
        initialVenueParam === "downtown" || initialVenueParam === "whitby"
          ? VENUES[initialVenueParam]
          : VENUES.north;

      const map = L.map(mapContainerRef.current, {
        center: [initialVenue.lat, initialVenue.lng],
        zoom: initialVenue.zoom,
        layers: [osm],
        preferCanvas: true,
        zoomControl: false,
      });

      baseLayersRef.current = {
        osm,
        satellite: esriSatellite,
        streets: esriStreets,
      };

      L.control.zoom({ position: "topright" }).addTo(map);

      // Mount compact Floor Selector dropdown directly beneath +/- zoom controls
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
      setMapReady(true);
    });

    return () => {
      isMounted = false;
      setMapReady(false);
      setFloorControlEl(null);
      baseLayersRef.current = null;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const switchBaseLayer = useCallback((nextLayer: BaseLayerKey) => {
    const map = mapInstanceRef.current;
    const layers = baseLayersRef.current;
    if (map && layers) {
      for (const [key, layer] of Object.entries(layers) as Array<
        [BaseLayerKey, LeafletType.TileLayer]
      >) {
        if (key !== nextLayer && map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      }
      if (!map.hasLayer(layers[nextLayer])) {
        layers[nextLayer].addTo(map);
      }
    }
    setActiveBaseLayer(nextLayer);
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

  const selectedIsoDate =
    selectedDayInfo?.date ?? addDaysIso(effectiveWeekStart, currentDay - 1);

  // Sync "Now" to live Toronto date/week (clamped to 2026-09-01 .. 2027-04-30)
  const setTimeToNow = useCallback(() => {
    const nowState = getDefaultCampusMapState();
    setCurrentWeekStart(nowState.weekStart);
    setCurrentDay(nowState.dayIndex);
    setCurrentSlotStart(nowState.slotStart);
  }, []);

  const handleSelectDate = useCallback(
    (rawDate: string) => {
      const clamped =
        rawDate < CAMPUS_MAP_MIN_DATE
          ? CAMPUS_MAP_MIN_DATE
          : rawDate > CAMPUS_MAP_MAX_DATE
            ? CAMPUS_MAP_MAX_DATE
            : rawDate;
      selectWeek(clamped, getDayOfWeekMon1(clamped));
    },
    [selectWeek],
  );

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
            isBookable: rData.isBookable,
            bookingUuid: rData.bookingUuid ?? null,
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

  // Fly map to a specific room feature
  const focusRoomOnMap = useCallback((feature: CampusMapFeature) => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !feature.geometry) return;
    try {
      const tempLayer = L.geoJSON(feature as unknown as GeoJSON.GeoJsonObject);
      const bounds = tempLayer.getBounds();
      if (bounds.isValid()) {
        const isMobile = window.innerWidth < 1024;
        map.flyToBounds(bounds, {
          paddingTopLeft: isMobile ? [24, 48] : [380, 70],
          paddingBottomRight: isMobile ? [24, 240] : [90, 140],
          maxZoom: 19,
          duration: 0.75,
        });
      }
    } catch {
      // Fallback: ignore invalid bounds
    }
  }, []);

  // Zoom map to all polygon features in a building code
  const zoomToBuilding = useCallback(
    (buildingCode: string) => {
      const map = mapInstanceRef.current;
      const L = leafletRef.current;
      if (!map || !L || !data || buildingCode === "ALL") return;

      const target = buildingCode.toUpperCase();
      const matching = data.features.filter(
        (f) =>
          f.geometry &&
          (f.geometry.type as string) !== "Point" &&
          f.properties?.building?.toUpperCase() === target,
      );
      if (matching.length === 0) return;

      try {
        const tempLayer = L.geoJSON(matching as unknown as GeoJSON.GeoJsonObject);
        const bounds = tempLayer.getBounds();
        if (bounds.isValid()) {
          const isMobile = window.innerWidth < 1024;
          map.flyToBounds(bounds, {
            paddingTopLeft: isMobile ? [24, 48] : [380, 70],
            paddingBottomRight: isMobile ? [24, 240] : [90, 140],
            maxZoom: 19,
            duration: 0.75,
          });
        }
      } catch {
        // Ignore invalid bounds
      }
    },
    [data],
  );

  // All distinct building codes for Menu ("More buildings...")
  const allBuildings = useMemo(() => {
    const found = new Set<string>(MAIN_BUILDING_SET);
    if (data?.features) {
      for (const f of data.features) {
        const b = f.properties?.building?.trim().toUpperCase();
        if (b) found.add(b);
      }
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b, "en"));
  }, [data]);

  const otherBuildings = useMemo(() => {
    return allBuildings.filter((b) => !MAIN_BUILDING_SET.has(b));
  }, [allBuildings]);

  const filteredMoreBuildings = useMemo(() => {
    const norm = normalizeSearchCode(buildingSearchQuery);
    if (!norm) return otherBuildings;
    return allBuildings.filter((b) => normalizeSearchCode(b).includes(norm));
  }, [allBuildings, otherBuildings, buildingSearchQuery]);

  // Zoom to ?building=CODE once map and features are ready
  useEffect(() => {
    if (!mapReady || !data || !pendingBuildingZoom) return;
    zoomToBuilding(pendingBuildingZoom);
    queueMicrotask(() => setPendingBuildingZoom(null));
  }, [mapReady, data, pendingBuildingZoom, zoomToBuilding]);

  // Open Weekly Schedule Modal using its own independent week state
  const openWeeklySchedule = useCallback(
    (feat: CampusMapFeature, subRoom?: string) => {
      setActiveModalFeature(feat);
      setActiveModalSubRoom(
        subRoom || (feat.properties.rooms ? feat.properties.rooms[0] : null),
      );
      setModalWeekError(null);
      setModalWeekStart(effectiveWeekStart);
    },
    [effectiveWeekStart],
  );

  // Fetch independent weekly schedule for modalWeekStart (without touching main map date/time)
  useEffect(() => {
    if (!activeModalFeature || !modalWeekStart) return;
    const targetWeek = modalWeekStart;

    if (targetWeek === effectiveWeekStart && weekData?.weekStart === targetWeek) {
      queueMicrotask(() => {
        setModalWeekError(null);
        setModalWeekData(weekData);
        setModalWeekLoading(false);
      });
      return;
    }

    const cached = weekCacheRef.current.get(targetWeek);
    if (cached && Date.now() - cached.fetchedAt < WEEK_CACHE_TTL_MS) {
      queueMicrotask(() => {
        setModalWeekError(null);
        setModalWeekData(cached.data);
        setModalWeekLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    async function loadModalWeek() {
      try {
        setModalWeekError(null);
        setModalWeekLoading(true);
        const url = `/api/campus-map/week?weekStart=${encodeURIComponent(targetWeek)}`;
        let res = await fetch(url, { signal: controller.signal });
        if (res.status >= 500 && !controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (controller.signal.aborted) return;
          res = await fetch(url, { signal: controller.signal });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CampusMapWeekData = await res.json();
        if (!controller.signal.aborted) {
          weekCacheRef.current.set(targetWeek, { data: json, fetchedAt: Date.now() });
          setModalWeekData(json);
          setModalWeekLoading(false);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error("Failed to load modal weekly schedule:", err);
        const msg = err instanceof Error ? err.message : "Failed to load weekly schedule";
        setModalWeekError(msg);
        setModalWeekLoading(false);
      }
    }
    loadModalWeek();
    return () => controller.abort();
  }, [activeModalFeature, modalWeekStart, modalWeekReloadNonce, effectiveWeekStart, weekData]);

  // Normalized live search dropdown results ("SCI 1350", "SCI1350", "sci 1350", "1350" -> SCI1350)
  const normSearchQuery = useMemo(() => normalizeSearchCode(searchQuery), [searchQuery]);

  const searchSuggestions = useMemo(() => {
    if (!normSearchQuery || !data?.features) return [];

    const matches: Array<{
      feature: CampusMapFeature;
      subRoomId?: string;
      score: number;
    }> = [];

    for (const feature of data.features) {
      if (!feature.geometry || (feature.geometry.type as string) === "Point") continue;
      if (!matchesNormalizedSearch(feature, normSearchQuery, weekData)) continue;

      const p = feature.properties || {};
      const eid = normalizeSearchCode(p.externalId);
      const name = normalizeSearchCode(p.name);
      const bldg = normalizeSearchCode(p.building);
      const type = normalizeSearchCode(p.type);
      const weekCourses: string[] = (p.externalId && weekData?.courses?.[p.externalId]) || [];
      const subRooms: string[] = p.rooms || [];

      const exactCode = eid === normSearchQuery || name === normSearchQuery;
      const prefixCode = eid.startsWith(normSearchQuery) || name.startsWith(normSearchQuery);
      const suffixCode = eid.endsWith(normSearchQuery) || name.endsWith(normSearchQuery);
      const containsCode = eid.includes(normSearchQuery) || name.includes(normSearchQuery);
      const matchedSubRoom = subRooms.find((sr) =>
        normalizeSearchCode(sr).includes(normSearchQuery),
      );
      const courseMatch = weekCourses.some((c) =>
        normalizeSearchCode(c).includes(normSearchQuery),
      );
      const metaMatch = bldg.includes(normSearchQuery) || type.includes(normSearchQuery);

      let score = 0;
      if (exactCode) score += 100;
      else if (prefixCode) score += 60;
      else if (suffixCode) score += 45;
      else if (containsCode) score += 35;
      if (matchedSubRoom) score += 30;
      if (courseMatch) score += 25;
      if (metaMatch) score += 10;
      if (p.hasSchedule || p.isBuildingContainer) score += 20;

      matches.push({ feature, subRoomId: matchedSubRoom, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 10);
  }, [normSearchQuery, data, weekData]);

  // Shared select/focus handler used by search suggestions & Bookable Rooms panel
  const handleSelectRoom = useCallback(
    (feature: CampusMapFeature, subRoomId?: string) => {
      const fl = String(feature.properties.floor || "");
      if (currentFloor !== "ALL" && fl && fl !== currentFloor) {
        setCurrentFloor(fl);
      }

      const bldg = feature.properties.building?.trim().toUpperCase() || "";
      if (focusedBuilding !== "ALL" && bldg !== focusedBuilding) {
        setFocusedBuilding("ALL");
      }

      const status = getRoomStatus(feature, currentDay, currentSlotStart);
      if (!status.isScheduled && !showUnscheduled) {
        setShowUnscheduled(true);
      } else if (status.isScheduled && status.isAvailable && !showAvailable) {
        setShowAvailable(true);
      } else if (status.isScheduled && !status.isAvailable && !showInUse) {
        setShowInUse(true);
      }

      setSelectedDrawerSubRoom(subRoomId ?? null);
      setSelectedFeature(feature);
      setIsSearchOpen(false);
      setIsBookableOpen(false);
      focusRoomOnMap(feature);
    },
    [
      currentFloor,
      focusedBuilding,
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
    let avail = 0;
    let busy = 0;

    // Only narrow polygons by search when at least one visible polygon actually matches;
    // when a search has no results, keep all building polygons rendered on the map.
    let applySearchFilter = false;
    if (normSearchQuery) {
      applySearchFilter = data.features.some((feature) => {
        if (!feature.geometry || (feature.geometry.type as string) === "Point") return false;
        const fl = String(feature.properties?.floor || "");
        if (currentFloor !== "ALL" && fl !== currentFloor) return false;
        const status = getRoomStatus(feature, currentDay, currentSlotStart);
        if (!status.isScheduled && !showUnscheduled) return false;
        if (status.isScheduled && status.isAvailable && !showAvailable) return false;
        if (status.isScheduled && !status.isAvailable && !showInUse) return false;
        return matchesNormalizedSearch(feature, normSearchQuery, weekData);
      });
    }

    const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      filter: (geoFeature) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        if (!feature.geometry || (feature.geometry.type as string) === "Point") return false;

        const props = feature.properties || {};
        const fl = String(props.floor || "");

        if (currentFloor !== "ALL" && fl !== currentFloor) return false;

        const status = getRoomStatus(feature, currentDay, currentSlotStart);
        if (!status.isScheduled) {
          if (!showUnscheduled) return false;
        } else if (status.isAvailable) {
          avail++;
          if (!showAvailable) return false;
        } else {
          busy++;
          if (!showInUse) return false;
        }

        if (applySearchFilter && !matchesNormalizedSearch(feature, normSearchQuery, weekData)) {
          return false;
        }

        return true;
      },
      style: (geoFeature) => {
        const feature = geoFeature as unknown as CampusMapFeature;
        const featureBuilding = feature.properties?.building?.trim().toUpperCase() || "";

        if (focusedBuilding !== "ALL" && featureBuilding !== focusedBuilding) {
          return {
            fillColor: "#334155",
            color: "#1e293b",
            weight: 1,
            opacity: 0.75,
            fillOpacity: 0.55,
          };
        }

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

        if (window.matchMedia("(hover: hover)").matches) {
          featureLayer.bindTooltip(
            `<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;">
              <span style="width:8px;height:8px;border-radius:9999px;background:${tooltipDot};display:inline-block;"></span>
              <span>${escapeHtml(roomLabel)}</span>
              <span style="font-weight:500;color:#475569;">&bull; ${escapeHtml(tooltipStatus)}</span>
            </div>`,
            { direction: "top", sticky: true, opacity: 0.96 },
          );
        }

        featureLayer.on({
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedDrawerSubRoom(null);
            setSelectedFeature(feature);
            focusRoomOnMap(feature);
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

    if (selectedFeatureIdRef.current) {
      const activeLayer = layerMap.get(selectedFeatureIdRef.current);
      if (activeLayer) {
        activeLayer.setStyle(SELECTED_POLYGON_STYLE);
        activeLayer.bringToFront();
      }
    }

    setStats({ availCount: avail, busyCount: busy });
  }, [
    data,
    weekData,
    currentFloor,
    focusedBuilding,
    currentDay,
    currentSlotStart,
    showAvailable,
    showInUse,
    showUnscheduled,
    normSearchQuery,
    getRoomStatus,
    focusRoomOnMap,
  ]);

  // Compute live status for currently selected drawer room
  const selectedFeatureStatus = useMemo(() => {
    if (!selectedFeature) return null;
    return getRoomStatus(selectedFeature, currentDay, currentSlotStart);
  }, [selectedFeature, currentDay, currentSlotStart, getRoomStatus]);

  // Weekly Schedule Modal derived data (strictly bound to modalWeekStart & modalWeekData)
  const modalEffectiveWeekStart = modalWeekStart ?? effectiveWeekStart;
  const modalWeekRangeText = formatWeekRangeLabel(modalEffectiveWeekStart);
  const modalWeekContextLabel = getWeekContextLabel(modalEffectiveWeekStart);
  const modalCanGoPrevWeek = modalEffectiveWeekStart > CAMPUS_MAP_MIN_WEEK_START;
  const modalCanGoNextWeek = modalEffectiveWeekStart < CAMPUS_MAP_MAX_WEEK_START;

  const modalActiveWeekData = useMemo(() => {
    if (modalWeekData && modalWeekData.weekStart === modalEffectiveWeekStart) {
      return modalWeekData;
    }
    if (weekData && weekData.weekStart === modalEffectiveWeekStart) {
      return weekData;
    }
    return null;
  }, [modalWeekData, weekData, modalEffectiveWeekStart]);

  const modalWeekDays = useMemo(() => {
    if (modalActiveWeekData) return modalActiveWeekData.days;
    return buildWeekDays(modalEffectiveWeekStart);
  }, [modalActiveWeekData, modalEffectiveWeekStart]);

  const modalCalendarEvents = useMemo(() => {
    if (!activeModalFeature || !modalActiveWeekData) return [];
    const p = activeModalFeature.properties;

    const events: PositionedEvent[] = [];
    for (let day = 1; day <= 7; day++) {
      const dayKey = String(day);
      let dayList: ScheduleInterval[] = [];
      if (p.isBuildingContainer && activeModalSubRoom) {
        dayList = modalActiveWeekData.subRoomSchedules?.[activeModalSubRoom]?.[dayKey] || [];
      } else if (p.externalId) {
        dayList = modalActiveWeekData.schedules?.[p.externalId]?.[dayKey] || [];
      }
      events.push(...assignOverlapLanes(day, dayList));
    }
    return events;
  }, [activeModalFeature, activeModalSubRoom, modalActiveWeekData]);

  const isModalLibraryOutsideWindow = Boolean(
    activeModalFeature?.properties.isLibraryRoom &&
      modalActiveWeekData?.libraryWindowStart &&
      modalActiveWeekData?.libraryWindowEnd &&
      (modalActiveWeekData.weekEnd < modalActiveWeekData.libraryWindowStart ||
        modalActiveWeekData.weekStart > modalActiveWeekData.libraryWindowEnd),
  );

  const showInitialOverlay =
    loading || (currentWeekStart !== null && !weekData && !error && !weekError);
  const isFreeOnlyFilter = showAvailable && !showInUse;

  const selectBuildingFromMenu = (bldg: string) => {
    setFocusedBuilding(bldg);
    if (bldg !== "ALL") {
      zoomToBuilding(bldg);
    }
    setIsMenuOpen(false);
  };

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-slate-100 font-sans text-slate-900 lg:h-screen dark:bg-zinc-950 dark:text-zinc-100">
      {/* Compact Top Navigation Bar */}
      <header className="relative z-30 flex w-full flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-200 bg-white px-2.5 py-2 shadow-sm sm:px-3 md:flex-nowrap dark:border-zinc-800 dark:bg-zinc-900">
        {/* Left: Home + Title */}
        <div className="order-1 flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            &larr; Home
          </Link>
          <h1 className="truncate whitespace-nowrap text-sm font-bold tracking-tight text-sky-700 sm:text-base dark:text-sky-400">
            Campus Map
          </h1>
        </div>

        {/* Center (Row 2 on mobile, inline on md+): Search Input + Book a Room Button */}
        <div className="order-3 flex w-full min-w-0 items-center gap-2 text-xs md:order-2 md:w-auto md:flex-1">
          <div ref={searchBoxRef} className="relative min-w-0 flex-1 md:max-w-64">
            <input
              type="text"
              name="campus-room-search"
              autoComplete="off"
              placeholder="Search room, building, course..."
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (searchSuggestions.length > 0) {
                    handleSelectRoom(
                      searchSuggestions[0].feature,
                      searchSuggestions[0].subRoomId,
                    );
                  } else {
                    setIsSearchOpen(true);
                  }
                } else if (e.key === "Escape") {
                  setIsSearchOpen(false);
                }
              }}
              className="min-w-0 w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-2.5 pr-7 text-base text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-sky-500 focus:bg-white md:text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-400"
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
            {isSearchOpen && normSearchQuery.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-full max-w-[calc(100vw-1.25rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl md:w-72 dark:border-zinc-700 dark:bg-zinc-900">
                {searchSuggestions.length === 0 ? (
                  <div className="px-3 py-2.5 text-xs font-medium text-slate-600 dark:text-zinc-400">
                    No matching rooms
                  </div>
                ) : (
                  <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-zinc-800">
                    {searchSuggestions.map(({ feature: feat, subRoomId }) => {
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
                            onClick={() => handleSelectRoom(feat, subRoomId)}
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
                                {feat.properties.type ? ` \u2022 ${feat.properties.type}` : ""}
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

            {/* Small persistent message when search has no results and dropdown closed */}
            {!isSearchOpen && normSearchQuery.length > 0 && searchSuggestions.length === 0 && (
              <div className="absolute left-0 top-full z-40 mt-1 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300">
                No matching rooms
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsBookableOpen((prev) => !prev);
              setIsMenuOpen(false);
              setIsTimePopoverOpen(false);
            }}
            aria-expanded={isBookableOpen}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
              isBookableOpen
                ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
            }`}
          >
            Book a room
          </button>
        </div>

        {/* Right (Row 1 right on mobile, far right on md+): Menu + Auth */}
        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 md:order-3">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen((prev) => !prev);
                setIsBookableOpen(false);
                setIsTimePopoverOpen(false);
              }}
              aria-expanded={isMenuOpen}
              aria-label="Open map menu"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                isMenuOpen
                  ? "border-sky-600 bg-sky-600 text-white shadow-xs"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
              <span>Menu</span>
            </button>

            {isMenuOpen && (
              <div
                role="dialog"
                aria-label="Campus map menu"
                className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-5.5rem)] w-72 max-w-[calc(100vw-1.25rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {/* Buildings */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Buildings
                    </span>
                    {focusedBuilding !== "ALL" && (
                      <button
                        type="button"
                        onClick={() => selectBuildingFromMenu("ALL")}
                        className="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-400"
                      >
                        All Buildings
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                        North
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {MAIN_NORTH_BUILDINGS.map((bldg) => (
                          <button
                            key={bldg}
                            type="button"
                            onClick={() => selectBuildingFromMenu(bldg)}
                            className={`rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition ${
                              focusedBuilding === bldg
                                ? "border-sky-600 bg-sky-600 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {bldg}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                        Downtown
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {MAIN_DOWNTOWN_BUILDINGS.map((bldg) => (
                          <button
                            key={bldg}
                            type="button"
                            onClick={() => selectBuildingFromMenu(bldg)}
                            className={`rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition ${
                              focusedBuilding === bldg
                                ? "border-sky-600 bg-sky-600 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {bldg}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => setIsMoreBuildingsOpen((prev) => !prev)}
                        aria-expanded={isMoreBuildingsOpen}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      >
                        <span>More buildings&hellip;</span>
                        <span>{isMoreBuildingsOpen ? "\u25B4" : "\u25BE"}</span>
                      </button>

                      {isMoreBuildingsOpen && (
                        <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
                          <input
                            type="text"
                            placeholder="Search buildings..."
                            value={buildingSearchQuery}
                            onChange={(e) => setBuildingSearchQuery(e.target.value)}
                            className="mb-1.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-base text-slate-900 placeholder:text-slate-500 outline-none focus:border-sky-500 md:text-[11px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400"
                          />
                          <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                            {filteredMoreBuildings.length === 0 ? (
                              <span className="px-1 py-1 text-[11px] text-slate-500 dark:text-zinc-400">
                                No matching buildings
                              </span>
                            ) : (
                              filteredMoreBuildings.map((bldg) => (
                                <button
                                  key={bldg}
                                  type="button"
                                  onClick={() => selectBuildingFromMenu(bldg)}
                                  className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold transition ${
                                    focusedBuilding === bldg
                                      ? "border-sky-600 bg-sky-600 text-white"
                                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
                                  }`}
                                >
                                  {bldg}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Map Layers */}
                <div className="mt-3 border-t border-slate-200 pt-2.5 dark:border-zinc-800">
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    Layers
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {BASE_LAYER_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => switchBaseLayer(opt.key)}
                        className={`rounded-lg border px-1.5 py-1 text-center text-[11px] font-semibold transition ${
                          activeBaseLayer === opt.key
                            ? "border-sky-600 bg-sky-600 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {opt.label.replace(" (Esri)", "")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="hidden md:block">
            <AuthButton />
          </div>
        </div>
      </header>

      {/* Main Map Canvas Area */}
      <div className="relative z-0 h-full w-full flex-1 overflow-hidden">
        {/* Loading Overlay */}
        {showInitialOverlay && (
          <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center bg-white/80 px-6 text-center backdrop-blur-sm dark:bg-zinc-950/80">
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
          <div className="absolute left-1/2 top-4 z-[1060] flex w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/95 px-4 py-2 text-xs font-semibold text-red-700 shadow-lg backdrop-blur sm:w-auto dark:border-red-900 dark:bg-red-950/95 dark:text-red-200">
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

        {/* Collapsed Floor Selector Dropdown (directly beneath Leaflet +/- zoom controls) */}
        {floorControlEl &&
          createPortal(
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="mt-1 rounded-xl border border-slate-200/95 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            >
              <select
                aria-label="Filter by floor"
                value={currentFloor}
                onChange={(e) => setCurrentFloor(e.target.value)}
                className="cursor-pointer rounded-lg bg-transparent px-1.5 py-1 text-xs font-bold text-slate-800 outline-none dark:text-zinc-100"
              >
                {VERTICAL_FLOOR_KEYS.map((fl) => (
                  <option key={fl} value={fl} className="dark:bg-zinc-900">
                    {fl === "ALL"
                      ? "All Floors"
                      : fl === "-10"
                        ? "Floor B"
                        : `Floor ${FLOOR_LABELS[fl]}`}
                  </option>
                ))}
              </select>
            </div>,
            floorControlEl,
          )}

        {/* Closable Bookable Rooms Panel */}
        <BookableRoomsPanel
          isOpen={isBookableOpen}
          data={data}
          currentDay={currentDay}
          currentSlotStart={currentSlotStart}
          currentDuration={currentDuration}
          getRoomStatus={getRoomStatus}
          onSelectRoom={handleSelectRoom}
          onClose={() => setIsBookableOpen(false)}
        />

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
          selectedSubRoom={selectedDrawerSubRoom}
          onSelectSubRoom={setSelectedDrawerSubRoom}
          onClose={() => {
            setSelectedFeature(null);
            setSelectedDrawerSubRoom(null);
          }}
          onOpenWeeklySchedule={openWeeklySchedule}
          onFocusRoom={focusRoomOnMap}
        />

        {/* Legend Pill with Labels ("● N free · ● M in use") */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className={`absolute left-2.5 top-2.5 z-[1000] flex items-center gap-1.5 rounded-full border border-slate-200/95 bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur-md lg:bottom-4 lg:top-auto dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100 ${
            selectedFeature ? "lg:left-[376px]" : "lg:left-4"
          }`}
        >
          <button
            type="button"
            aria-pressed={isFreeOnlyFilter}
            title={isFreeOnlyFilter ? "Show all scheduled rooms" : "Filter to available rooms only"}
            onClick={() => {
              if (showAvailable && !showInUse) {
                setShowAvailable(true);
                setShowInUse(true);
              } else {
                setShowAvailable(true);
                setShowInUse(false);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 tabular-nums transition ${
              isFreeOnlyFilter
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-200"
                : showAvailable
                  ? "text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  : "text-slate-400 line-through hover:bg-slate-100 dark:text-zinc-500"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                showAvailable ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
            <span>{stats.availCount} free</span>
          </button>

          <span className="text-slate-400 dark:text-zinc-500">&middot;</span>

          <button
            type="button"
            aria-pressed={!showAvailable && showInUse}
            title={!showAvailable && showInUse ? "Show all scheduled rooms" : "Filter to in-use rooms only"}
            onClick={() => {
              if (!showInUse || !showAvailable) {
                setShowAvailable(true);
                setShowInUse(true);
              } else {
                setShowAvailable(false);
                setShowInUse(true);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 tabular-nums transition ${
              !showAvailable && showInUse
                ? "bg-rose-100 text-rose-900 dark:bg-rose-950/80 dark:text-rose-200"
                : showInUse
                  ? "text-rose-800 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  : "text-slate-400 line-through hover:bg-slate-100 dark:text-zinc-500"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                showInUse ? "bg-rose-500" : "bg-slate-400"
              }`}
            />
            <span>{stats.busyCount} in use</span>
          </button>

          {focusedBuilding !== "ALL" && (
            <>
              <span className="text-slate-400 dark:text-zinc-500">&middot;</span>
              <button
                type="button"
                onClick={() => setFocusedBuilding("ALL")}
                title={`Clear ${focusedBuilding} filter`}
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {focusedBuilding} &times;
              </button>
            </>
          )}
        </div>

        {/* Bottom Time Pill + Popover */}
        <TimeScrubber
          selectedIsoDate={selectedIsoDate}
          selectedDayInfo={selectedDayInfo}
          currentDay={currentDay}
          currentSlotStart={currentSlotStart}
          currentDuration={currentDuration}
          weekLoading={weekLoading}
          isOpen={isTimePopoverOpen}
          isDrawerOpen={Boolean(selectedFeature)}
          onToggleOpen={() => {
            setIsTimePopoverOpen((prev) => !prev);
            setIsMenuOpen(false);
            setIsBookableOpen(false);
          }}
          onClose={() => setIsTimePopoverOpen(false)}
          onSelectDate={handleSelectDate}
          onChangeSlotStart={setCurrentSlotStart}
          onChangeDuration={setCurrentDuration}
          onSetNow={setTimeToNow}
        />
      </div>

      {/* Google Calendar-Style Weekly Schedule Modal (independent local week state) */}
      {activeModalFeature && (
        <ModalBackdrop onClose={() => setActiveModalFeature(null)}>
          <div className="flex h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl lg:h-[90vh] dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-3 lg:px-6 lg:py-4 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-2 lg:block lg:min-w-0 lg:flex-1">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-bold text-slate-900 lg:text-lg dark:text-zinc-100">
                    {activeModalSubRoom ? `${activeModalSubRoom} \u2022 ` : ""}
                    {activeModalFeature.properties.name}
                    <span className="ml-2 hidden text-xs font-semibold text-sky-700 lg:inline dark:text-sky-400">
                      ({modalWeekRangeText})
                    </span>
                  </h2>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600 lg:text-xs dark:text-zinc-300">
                    <span className="hidden lg:inline">Building: </span>
                    <strong>{activeModalFeature.properties.building || "—"}</strong>{" "}
                    &bull; Fl{" "}
                    <strong>{formatFloor(activeModalFeature.properties.floor)}</strong> &bull;
                    Cap{" "}
                    <strong>
                      {activeModalFeature.properties.isLibraryRoom &&
                      activeModalFeature.properties.minCapacity
                        ? `${activeModalFeature.properties.minCapacity}–${activeModalFeature.properties.capacity}`
                        : activeModalFeature.properties.capacity || "—"}
                    </strong>{" "}
                    &bull;{" "}
                    <span className="font-semibold text-slate-800 dark:text-zinc-200">
                      {modalWeekContextLabel}
                    </span>
                  </p>
                </div>

                {/* Mobile Close Button */}
                <button
                  type="button"
                  onClick={() => setActiveModalFeature(null)}
                  aria-label="Close weekly schedule"
                  className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 lg:gap-3">
                {/* Multi-Room Switcher for UP / U5 */}
                {activeModalFeature.properties.isBuildingContainer &&
                  activeModalFeature.properties.rooms && (
                    <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                      {activeModalFeature.properties.rooms.map((rm) => (
                        <button
                          key={rm}
                          type="button"
                          onClick={() => setActiveModalSubRoom(rm)}
                          className={`rounded px-2 py-0.5 text-[11px] font-bold transition lg:px-2.5 lg:py-1 lg:text-xs ${
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

                {/* Independent Modal Week Switcher */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    type="button"
                    disabled={!modalCanGoPrevWeek}
                    onClick={() =>
                      setModalWeekStart(clampWeekStart(addDaysIso(modalEffectiveWeekStart, -7)))
                    }
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 lg:py-1 lg:text-xs dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    &larr; <span className="hidden lg:inline">Prev Week</span>
                    <span className="lg:hidden">Prev</span>
                  </button>
                  <span className="px-1 text-[11px] font-bold text-slate-800 lg:px-2 lg:text-xs dark:text-zinc-100">
                    {modalWeekLoading ? "Loading…" : modalWeekRangeText}
                  </span>
                  <button
                    type="button"
                    disabled={!modalCanGoNextWeek}
                    onClick={() =>
                      setModalWeekStart(clampWeekStart(addDaysIso(modalEffectiveWeekStart, 7)))
                    }
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 lg:py-1 lg:text-xs dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <span className="hidden lg:inline">Next Week</span>
                    <span className="lg:hidden">Next</span> &rarr;
                  </button>
                </div>

                {/* Reset modal week only (without altering main map date/time) */}
                <button
                  type="button"
                  onClick={() => setModalWeekStart(getDefaultCampusMapState().weekStart)}
                  title="Jump modal back to current week"
                  className="rounded-lg border border-emerald-400 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 lg:px-2.5 lg:text-xs dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200 dark:hover:bg-emerald-900/70"
                >
                  This Week
                </button>

                {/* Desktop Close Button */}
                <button
                  type="button"
                  onClick={() => setActiveModalFeature(null)}
                  aria-label="Close weekly schedule"
                  className="hidden rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Week Error Banner */}
            {modalWeekError && (
              <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 lg:px-6 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                <span>Could not load {modalWeekRangeText}: {modalWeekError}</span>
                <button
                  type="button"
                  onClick={() => {
                    weekCacheRef.current.delete(modalEffectiveWeekStart);
                    setModalWeekReloadNonce((n) => n + 1);
                  }}
                  className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Library rolling-window notice */}
            {isModalLibraryOutsideWindow &&
              modalActiveWeekData?.libraryWindowStart &&
              modalActiveWeekData?.libraryWindowEnd && (
                <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900 lg:px-6 lg:py-2 lg:text-xs dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Library study room bookings are updated daily for the upcoming ~1-week
                  window (
                  <strong>
                    {formatShortIsoDate(modalActiveWeekData.libraryWindowStart)} –{" "}
                    {formatShortIsoDate(modalActiveWeekData.libraryWindowEnd)}
                  </strong>
                  ). Historical and far-future weeks do not retain past library bookings.
                </div>
              )}

            {/* Color Key (includes every colour that can render in the grid) */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-slate-100 bg-slate-50/80 px-3 py-1 text-[10px] font-medium text-slate-700 lg:gap-4 lg:px-6 lg:py-1.5 lg:text-[11px] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-sky-500 lg:h-2.5 lg:w-2.5" /> Course / Lab
                <span className="hidden lg:inline"> / Tutorial</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-amber-500 lg:h-2.5 lg:w-2.5" /> Final Exam
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500 lg:h-2.5 lg:w-2.5" /> Library
                <span className="hidden lg:inline"> Booking</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-purple-500 lg:h-2.5 lg:w-2.5" /> Reservation
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-rose-600 lg:h-2.5 lg:w-2.5" /> Selected Time
              </span>
            </div>

            {/* Modal Body: Timetable Grid */}
            <div className="flex flex-1 flex-col overflow-x-auto overflow-y-hidden lg:overflow-x-hidden lg:overflow-y-auto">
              <div className="flex h-full min-w-[430px] flex-col lg:block lg:h-auto lg:min-w-0">
                {/* Day Column Headers */}
                <div className="grid shrink-0 grid-cols-[38px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 lg:sticky lg:top-0 lg:z-20 lg:grid-cols-8 lg:text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  <div className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-1 py-1.5 text-center text-slate-600 lg:static lg:p-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                    Time
                  </div>
                  {modalWeekDays.map((dayInfo) => {
                    const dayNum = Number(dayInfo.date.slice(8, 10));
                    const isSelectedDayInThisWeek =
                      modalEffectiveWeekStart === effectiveWeekStart &&
                      dayInfo.dayIndex === currentDay;
                    return (
                      <div
                        key={dayInfo.date}
                        title={dayInfo.note || dayInfo.date}
                        className={`px-0.5 py-1 text-center lg:p-2 ${
                          !dayInfo.inBounds
                            ? "opacity-40"
                            : isSelectedDayInThisWeek
                              ? "bg-sky-100/70 font-extrabold text-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
                              : ""
                        }`}
                      >
                        <div className="lg:hidden">
                          <div>{DAY_SHORT[dayInfo.dayIndex]}</div>
                          <div className="text-[9px] font-semibold opacity-80">{dayNum}</div>
                        </div>
                        <div className="hidden lg:block">
                          {DAY_SHORT[dayInfo.dayIndex]} {formatShortIsoDate(dayInfo.date)}
                        </div>
                        {dayInfo.note && (
                          <div className="truncate text-[9px] font-semibold text-amber-700 lg:text-[10px] dark:text-amber-300">
                            {dayInfo.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Calendar Body */}
                <div className="relative grid min-h-0 flex-1 grid-cols-[38px_repeat(7,minmax(0,1fr))] lg:h-[728px] lg:flex-none lg:grid-cols-8">
                  {/* Time Labels Column */}
                  <div className="sticky left-0 z-10 flex h-full flex-col border-r border-slate-200 bg-white lg:static lg:block dark:border-zinc-800 dark:bg-zinc-900">
                    {Array.from({ length: 14 }).map((_, i) => {
                      const hourMin = 480 + i * 60;
                      const h24 = 8 + i;
                      const compactHour = `${h24 % 12 || 12}${h24 >= 12 ? "p" : "a"}`;
                      return (
                        <div
                          key={i}
                          className="flex-1 border-b border-slate-100 pr-1 pt-0.5 text-right text-[9px] font-medium leading-none text-slate-600 lg:h-[52px] lg:flex-none lg:pr-2 lg:pt-0 lg:text-[11px] lg:leading-normal dark:border-zinc-800/80 dark:text-zinc-400"
                        >
                          <span className="lg:hidden">{compactHour}</span>
                          <span className="hidden lg:inline">
                            {formatMinutesToTime(hourMin)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 7 Day Columns with Events */}
                  {modalWeekDays.map((dayInfo) => {
                    const day = dayInfo.dayIndex;
                    const dayEvents = modalCalendarEvents.filter((ev) => ev.day === day);
                    const isToday =
                      modalEffectiveWeekStart === effectiveWeekStart && day === currentDay;

                    return (
                      <div
                        key={day}
                        className={`relative flex h-full flex-col border-r border-slate-200 lg:block dark:border-zinc-800 ${
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
                            className="flex-1 border-b border-slate-100 lg:h-[52px] lg:flex-none dark:border-zinc-800/60"
                          />
                        ))}

                        {/* Event blocks */}
                        {dayEvents.map((ev, idx) => {
                          const visibleStart = Math.max(480, ev.start);
                          const visibleEnd = Math.min(1320, ev.end);
                          const topPct = ((visibleStart - 480) / 840) * 100;
                          const heightPct = Math.max(
                            3.3,
                            ((visibleEnd - visibleStart) / 840) * 100,
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
                                top: `${topPct}%`,
                                height: `${heightPct}%`,
                                left: `calc(${leftPct}% + 1px)`,
                                width: `calc(${widthPct}% - 2px)`,
                              }}
                              title={`${formatMinutesToTime(ev.start)} – ${formatMinutesToTime(ev.end)}\n${ev.title}${ev.meta ? `\n${ev.meta}` : ""}`}
                              className={`absolute overflow-hidden rounded p-0.5 text-[9px] leading-tight shadow-sm transition hover:z-20 hover:shadow-md lg:rounded-md lg:p-1 lg:text-[11px] ${
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
                              <div className="truncate font-bold opacity-85 lg:whitespace-normal">
                                <span className="lg:hidden">
                                  {formatMinutesToTime(ev.start)
                                    .replace(" AM", "a")
                                    .replace(" PM", "p")}
                                </span>
                                <span className="hidden lg:inline">
                                  {formatMinutesToTime(ev.start)} –{" "}
                                  {formatMinutesToTime(ev.end)}
                                </span>
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
    </div>
  );
}
