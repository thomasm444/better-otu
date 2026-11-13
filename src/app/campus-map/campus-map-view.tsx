"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type * as LeafletType from "leaflet";
import { AuthButton } from "@/components/auth-button";
import type { CampusMapData, CampusMapFeature } from "@/lib/queries";

type ScheduleInterval = {
  start: number;
  end: number;
  title: string;
  type: string;
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
      nextBooking?: ScheduleInterval | null;
    };

const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const DAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
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

export function CampusMapView() {
  const [data, setData] = useState<CampusMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [currentMode, setCurrentMode] = useState<"availability" | "floors">("availability");
  const [currentTerm, setCurrentTerm] = useState<"202609" | "202701">("202609");
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
  const [modalTerm, setModalTerm] = useState<"202609" | "202701">("202609");
  const [isUnmappedOpen, setIsUnmappedOpen] = useState<boolean>(false);

  // Map references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletType.Map | null>(null);
  const geojsonLayerRef = useRef<LeafletType.GeoJSON | null>(null);
  const leafletRef = useRef<typeof LeafletType | null>(null);

  // Fetch campus map data from API
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch("/api/campus-map");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CampusMapData = await res.json();
        if (isMounted) {
          setData(json);
          setLoading(false);
        }
      } catch (err: unknown) {
        console.error("Failed to load map data:", err);
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Failed to load campus map data";
          setError(msg);
          setLoading(false);
        }
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

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

  // Sync "Now" button
  const setTimeToNow = useCallback(() => {
    const now = new Date();
    let day = now.getDay(); // 0 is Sun, 1 is Mon
    day = day === 0 ? 7 : day;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const rounded = Math.floor(minutes / 30) * 30;
    const clamped = Math.max(480, Math.min(rounded, 1290));
    setCurrentDay(day);
    setCurrentSlotStart(clamped);
  }, []);

  // Status check helper
  const getRoomStatus = useCallback(
    (feature: CampusMapFeature, day: number, slotStart: number): RoomStatus => {
      const p = feature.properties;
      if (!p || !p.hasSchedule) {
        return { isScheduled: false, isAvailable: null, currentBooking: null };
      }

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
          schedule: ScheduleInterval[];
        }> = [];

        for (const rid of roomsList) {
          const rData = roomsData[rid] || { roomId: rid, capacity: null, capacitySource: null, type: "Classroom" };
          const schedules = rData.schedules || {};
          const termSched = schedules[currentTerm] || {};
          const dayIntervals: ScheduleInterval[] = termSched[day] || termSched[String(day)] || [];

          let isRoomAvail = true;
          let currentBooking: string | null = null;
          let bookingStart: number | null = null;
          let bookingEnd: number | null = null;

          for (const item of dayIntervals) {
            if (item.start < slotEnd && item.end > slotStart) {
              isRoomAvail = false;
              currentBooking = item.title;
              bookingStart = item.start;
              bookingEnd = item.end;
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

      // Individual rooms
      const schedules = p.schedules || {};
      const termSched = schedules[currentTerm] || {};
      const dayIntervals: ScheduleInterval[] = termSched[day] || termSched[String(day)] || [];

      for (const item of dayIntervals) {
        if (item.start < slotEnd && item.end > slotStart) {
          return {
            isScheduled: true,
            isAvailable: false,
            currentBooking: item.title,
            bookingStart: item.start,
            bookingEnd: item.end,
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
    [currentDuration, currentTerm]
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
    setModalTerm(currentTerm);
  }, [currentTerm]);

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
          const allCourses: string[] = props.allCourses || [];
          const coursesMatch = allCourses.some((c) => c.toLowerCase().includes(q));

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
        const title = p.name ? `${p.name}${p.externalId && p.externalId !== p.name ? ` (${p.externalId})` : ""}` : (p.externalId || "Room");

        let capHtml = "";
        if (p.isLibraryRoom && p.minCapacity && p.capacity) {
          capHtml = `Capacity: <strong>${p.minCapacity} – ${p.capacity} people</strong> &bull; `;
        } else if (p.capacity) {
          const capSrc = p.capacitySource ? ` <span style="font-size:0.7rem; color:#94a3b8;">(${p.capacitySource})</span>` : "";
          capHtml = `Capacity: <strong>${p.capacity}</strong>${capSrc} &bull; `;
        }

        const bldg = p.building ? `Bldg: <strong>${p.building}</strong> &bull; ` : "";
        const fl = `Floor: <strong>${formatFloor(p.floor)}</strong>`;
        const type = p.type ? `<div style="margin-top:2px; font-weight:600; color:#0284c7;">${p.type}</div>` : "";

        // Status
        const status = getRoomStatus(feature, currentDay, currentSlotStart);
        const termLabel = currentTerm === "202609" ? "Fall 2026" : "Winter 2027";

        const popupDiv = document.createElement("div");
        popupDiv.className = "p-1 text-xs text-slate-800";

        if (status.isBuildingContainer) {
          const availTxt = `${status.availableCount} of ${status.totalRooms} Rooms Free`;
          popupDiv.innerHTML = `
            <div style="font-weight:700; font-size:0.95rem; margin-bottom:2px;">${p.name}</div>
            <div style="display:inline-block; font-size:0.72rem; font-weight:700; border-radius:9999px; padding:2px 8px; margin-bottom:6px; background:${status.color}22; color:${status.color}; border:1px solid ${status.color};">${availTxt}</div>
            <div style="font-size:0.75rem; color:#64748b; margin-bottom:6px;">
              ${termLabel} &bull; ${DAY_NAMES[currentDay]} (${formatMinutesToTime(currentSlotStart)} – ${formatMinutesToTime(currentSlotStart + currentDuration)}) &bull; <strong>${formatDurationLong(currentDuration)}</strong>
            </div>
            <div style="margin-bottom:6px;">${capHtml}${bldg}${fl}${type}</div>
          `;

          const btn = document.createElement("button");
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
          const statusDetail = status.isScheduled
            ? status.isAvailable
              ? `Free for <strong>${formatDurationLong(currentDuration)}</strong>!`
              : `Booked: <strong>${status.currentBooking || "Class"}</strong><br/>Time: ${formatMinutesToTime(status.bookingStart ?? 0)} – ${formatMinutesToTime(status.bookingEnd ?? 0)}`
            : "No scheduled classes or reservations for this space.";

          popupDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="font-weight:700; font-size:0.95rem;">${title}</span>
              <span style="font-size:0.7rem; font-weight:700; border-radius:9999px; padding:2px 6px; ${badgeColor}">${badgeText}</span>
            </div>
            <div style="font-size:0.72rem; color:#64748b; margin-bottom:4px;">
              ${termLabel} &bull; ${DAY_NAMES[currentDay]} (${formatMinutesToTime(currentSlotStart)} – ${formatMinutesToTime(currentSlotStart + currentDuration)}) &bull; <strong>${formatDurationLong(currentDuration)}</strong>
            </div>
            <div style="font-size:0.75rem; margin-bottom:6px;">${statusDetail}</div>
            <div style="margin-bottom:6px;">${capHtml}${bldg}${fl}${type}</div>
          `;

          if (p.hasSchedule) {
            const btnRow = document.createElement("div");
            btnRow.className = "flex gap-2 mt-2";

            const btn = document.createElement("button");
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
    currentFloor,
    currentMode,
    currentDay,
    currentSlotStart,
    currentDuration,
    availFilter,
    searchQuery,
    currentTerm,
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

  // Compute timetable events for Weekly Schedule Modal
  const modalCalendarEvents = useMemo(() => {
    if (!activeModalFeature) return [];
    const p = activeModalFeature.properties;
    let scheduleSource = p.schedules || {};

    if (p.isBuildingContainer && activeModalSubRoom && p.roomsData && p.roomsData[activeModalSubRoom]) {
      scheduleSource = p.roomsData[activeModalSubRoom].schedules || {};
    }

    const termSched = scheduleSource[modalTerm] || {};
    const events: Array<{ day: number; start: number; end: number; title: string; type: string }> = [];

    for (let day = 1; day <= 7; day++) {
      const dayList = termSched[day] || termSched[String(day)] || [];
      for (const ev of dayList) {
        if (ev.start !== undefined && ev.end !== undefined && ev.end > 480 && ev.start < 1320) {
          events.push({ ...ev, day });
        }
      }
    }
    return events;
  }, [activeModalFeature, activeModalSubRoom, modalTerm]);

  return (
    <div className="relative flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-slate-100 font-sans text-slate-900">
      {/* Top Header */}
      <header className="z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
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

          {/* Term Selector */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
            <button
              onClick={() => setCurrentTerm("202609")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                currentTerm === "202609" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
              }`}
            >
              Fall 2026
            </button>
            <button
              onClick={() => setCurrentTerm("202701")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                currentTerm === "202701" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
              }`}
            >
              Winter 2027
            </button>
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
            25 Unmapped Spaces
          </button>

          <AuthButton />
        </div>
      </header>

      {/* Main Map Canvas Area */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-zinc-950/80">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-zinc-300">
              Loading 7,500+ campus rooms &amp; schedules from Supabase...
            </p>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white p-6 dark:bg-zinc-900">
            <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              <h2 className="text-lg font-bold">Failed to load map data</h2>
              <p className="mt-1 text-xs">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Leaflet Map Div */}
        <div ref={mapContainerRef} className="h-full w-full" id="map-container" />

        {/* Legend Overlay */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute bottom-6 left-4 z-[1000] flex flex-col gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
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
            className="absolute bottom-6 left-1/2 z-[1000] w-[94%] max-w-2xl -translate-x-1/2 rounded-2xl border border-slate-200/95 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-zinc-800">
              {/* Day Pills */}
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    onClick={() => setCurrentDay(d)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      currentDay === d
                        ? "bg-sky-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {DAY_SHORT[d]}
                  </button>
                ))}
              </div>

              {/* Time Display */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-sky-600 dark:text-sky-400">
                  {formatMinutesToTime(currentSlotStart)} – {formatMinutesToTime(currentSlotStart + currentDuration)}
                </span>
                <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                  {DAY_NAMES[currentDay]}
                </span>
              </div>

              {/* Step & Play Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentSlotStart((p) => Math.max(480, p - 30))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  -30m
                </button>
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className={`rounded px-2.5 py-0.5 text-xs font-bold text-white transition ${
                    isPlaying ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"
                  }`}
                >
                  {isPlaying ? "⏸ Pause" : "▶ Play"}
                </button>
                <button
                  onClick={() => setCurrentSlotStart((p) => Math.min(1290, p + 30))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  +30m
                </button>
                <button
                  onClick={setTimeToNow}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  Now
                </button>
              </div>
            </div>

            {/* Duration Selector & Time Slider */}
            <div className="mt-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-500">Slot Duration:</span>
                  {[10, 30, 60, 120, 180, 300].map((dur) => (
                    <button
                      key={dur}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">
                  {activeModalSubRoom ? `${activeModalSubRoom} • ` : ""}
                  {activeModalFeature.properties.name}
                  <span className="ml-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
                    ({modalTerm === "202609" ? "Fall 2026" : "Winter 2027"})
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Building: <strong>{activeModalFeature.properties.building || "—"}</strong> &bull; Floor:{" "}
                  <strong>{formatFloor(activeModalFeature.properties.floor)}</strong> &bull; Capacity:{" "}
                  <strong>{activeModalFeature.properties.capacity || "—"}</strong>
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Multi-Room Switcher for UP / U5 */}
                {activeModalFeature.properties.isBuildingContainer && activeModalFeature.properties.rooms && (
                  <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                    {activeModalFeature.properties.rooms.map((rm) => (
                      <button
                        key={rm}
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

                {/* Term switcher inside modal */}
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    onClick={() => setModalTerm("202609")}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                      modalTerm === "202609" ? "bg-sky-600 text-white shadow" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                    }`}
                  >
                    Fall 2026
                  </button>
                  <button
                    onClick={() => setModalTerm("202701")}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                      modalTerm === "202701" ? "bg-sky-600 text-white shadow" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400"
                    }`}
                  >
                    Winter 2027
                  </button>
                </div>

                {/* Close Button */}
                <button
                  onClick={() => setActiveModalFeature(null)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body: Timetable Grid */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Day Column Headers */}
              <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
                <div className="border-r border-slate-200 p-2 text-center text-slate-400 dark:border-zinc-700">Time</div>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <div
                    key={d}
                    className={`p-2 text-center ${d === currentDay ? "bg-sky-100/60 font-extrabold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" : ""}`}
                  >
                    {DAY_NAMES[d]}
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
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                    const dayEvents = modalCalendarEvents.filter((ev) => ev.day === day);
                    const isToday = day === currentDay;

                    return (
                      <div
                        key={day}
                        className={`relative border-r border-slate-200 dark:border-zinc-800 ${
                          isToday ? "bg-sky-50/20 dark:bg-sky-950/10" : ""
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

                          return (
                            <div
                              key={idx}
                              style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                              title={`${formatMinutesToTime(ev.start)} – ${formatMinutesToTime(ev.end)}\n${ev.title}`}
                              className={`absolute inset-x-1 overflow-hidden rounded-md p-1.5 text-[11px] leading-tight shadow-sm transition hover:z-10 hover:shadow-md ${
                                isActiveNow
                                  ? "bg-rose-600 text-white ring-2 ring-rose-400"
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
        </div>
      )}

      {/* Unmapped Rooms Modal */}
      {isUnmappedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                  Detailed Reservations (Table &amp; Atrium Spaces)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  These locations represent open table spaces in atria and lounges without dedicated room polygon dividers.
                </p>
              </div>
              <button
                onClick={() => setIsUnmappedOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {data?.unmappedDetailedRes.map((u) => (
                  <div
                    key={u.roomId}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40"
                  >
                    <div>
                      <div className="font-bold text-sky-600 dark:text-sky-400">{u.roomId}</div>
                      <div className="text-slate-500">
                        {u.building ? `Building: ${u.building}` : "Campus Space"} &bull; {u.roomType || "Lounge Space"}
                      </div>
                      {u.description && <div className="mt-1 text-[11px] text-slate-400">{u.description}</div>}
                    </div>
                    {u.capacity && (
                      <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-zinc-700 dark:text-zinc-200">
                        Cap: {u.capacity}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
