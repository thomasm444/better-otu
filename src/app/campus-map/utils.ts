import {
  CAMPUS_MAP_MAX_DATE,
  CAMPUS_MAP_MIN_DATE,
  clampWeekStart,
  getDayOfWeekMon1,
  getTorontoNowParts,
} from "@/lib/campus-map-dates";
import type { CampusMapFeature, ScheduleInterval } from "@/lib/queries";

export type PositionedEvent = ScheduleInterval & {
  day: number;
  lane: number;
  totalLanes: number;
};

export type SubRoomStatus = {
  roomId: string;
  capacity: number | null;
  capacitySource: string | null;
  type?: string;
  isBookable?: boolean;
  bookingUuid?: string | null;
  isAvailable: boolean;
  currentBooking: string | null;
  bookingStart: number | null;
  bookingEnd: number | null;
  bookingType: string | null;
  schedule: ScheduleInterval[];
};

export type RoomStatus =
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
      subStatuses: SubRoomStatus[];
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

export const FLOOR_LABELS: Record<string, string> = {
  ALL: "All",
  "-10": "B",
  "0": "1",
  "20": "2",
  "30": "3",
  "40": "4",
};

/** Ordered top-to-bottom like an indoor map / elevator floor picker, with All at top. */
export const VERTICAL_FLOOR_KEYS = ["ALL", "40", "30", "20", "0", "-10"] as const;

export const MAP_MIN_ZOOM = 15;
export const MAP_MAX_ZOOM = 22;

export const VENUES = {
  north: { lat: 43.9456, lng: -78.8968, zoom: 16.5, label: "North" },
  downtown: { lat: 43.8978, lng: -78.8608, zoom: 16.5, label: "Downtown" },
} as const;

export type VenueKey = "north" | "downtown" | "whitby";

export type CampusSwitchKey = keyof typeof VENUES;

export const CAMPUS_SWITCH_OPTIONS: ReadonlyArray<{
  key: CampusSwitchKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "north", label: "North Campus", shortLabel: "North" },
  { key: "downtown", label: "Downtown Campus", shortLabel: "Downtown" },
];

export const CAMPUS_FALLBACK_BOUNDS: Record<
  CampusSwitchKey,
  [[number, number], [number, number]]
> = {
  north: [
    [43.9424, -78.9018],
    [43.9494, -78.8934],
  ],
  downtown: [
    [43.8954, -78.8644],
    [43.9004, -78.8574],
  ],
};

export const MAIN_NORTH_BUILDINGS = ["SCI", "ENG", "SIR", "SHA", "ERC", "BIT", "LIB"] as const;
export const MAIN_DOWNTOWN_BUILDINGS = ["REG", "CHA"] as const;
const MAIN_NORTH_BUILDING_SET = new Set<string>(MAIN_NORTH_BUILDINGS);
const MAIN_DOWNTOWN_BUILDING_SET = new Set<string>(MAIN_DOWNTOWN_BUILDINGS);
export const MAIN_BUILDING_SET = new Set<string>([
  ...MAIN_NORTH_BUILDINGS,
  ...MAIN_DOWNTOWN_BUILDINGS,
]);

function extractFirstLngLat(coords: unknown): [number, number] | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return [coords[0], coords[1]];
  }
  for (const item of coords) {
    const found = extractFirstLngLat(item);
    if (found) return found;
  }
  return null;
}

/**
 * Classifies a campus map feature into its campus ("north", "downtown", or "whitby")
 * using venue metadata, known building codes, and geographic coordinate bounds.
 */
export function getFeatureCampus(feature: CampusMapFeature): VenueKey {
  const venueRaw = feature.properties?.venue?.trim().toUpperCase() ?? "";
  if (venueRaw.includes("DOWNTOWN")) return "downtown";
  if (venueRaw.includes("WHITBY")) return "whitby";

  const bldg = feature.properties?.building?.trim().toUpperCase() ?? "";
  if (MAIN_DOWNTOWN_BUILDING_SET.has(bldg)) return "downtown";
  if (MAIN_NORTH_BUILDING_SET.has(bldg)) return "north";

  const geom = feature.geometry as { coordinates?: unknown } | null | undefined;
  const lngLat = geom ? extractFirstLngLat(geom.coordinates) : null;
  if (lngLat) {
    const [lng, lat] = lngLat;
    if (lat >= 43.92) return "north";
    if (lat >= 43.885 && lng > -78.885) return "downtown";
    if (lat < 43.885) return "whitby";
  }

  return "north";
}

function extendBoundsFromCoords(
  coords: unknown,
  acc: { minLat: number; minLng: number; maxLat: number; maxLng: number },
) {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lng, lat] = coords as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (lat < acc.minLat) acc.minLat = lat;
      if (lat > acc.maxLat) acc.maxLat = lat;
      if (lng < acc.minLng) acc.minLng = lng;
      if (lng > acc.maxLng) acc.maxLng = lng;
    }
    return;
  }
  for (const item of coords) {
    extendBoundsFromCoords(item, acc);
  }
}

/**
 * Computes tight geographic bounds covering all scheduled/bookable buildings on a campus
 * (falling back to all non-point features on that campus, then static campus bounds).
 */
export function computeCampusGeoBounds(
  features: CampusMapFeature[],
  campus: CampusSwitchKey,
): [[number, number], [number, number]] {
  const campusPolygons = features.filter(
    (f) =>
      f.geometry &&
      (f.geometry.type as string) !== "Point" &&
      getFeatureCampus(f) === campus,
  );
  const scheduled = campusPolygons.filter(
    (f) => f.properties?.hasSchedule || f.properties?.isBuildingContainer,
  );
  const targetFeatures = scheduled.length > 0 ? scheduled : campusPolygons;

  const acc = {
    minLat: Infinity,
    minLng: Infinity,
    maxLat: -Infinity,
    maxLng: -Infinity,
  };

  for (const f of targetFeatures) {
    const geom = f.geometry as { coordinates?: unknown } | null | undefined;
    if (geom?.coordinates) {
      extendBoundsFromCoords(geom.coordinates, acc);
    }
  }

  if (
    !Number.isFinite(acc.minLat) ||
    !Number.isFinite(acc.maxLat) ||
    !Number.isFinite(acc.minLng) ||
    !Number.isFinite(acc.maxLng)
  ) {
    return CAMPUS_FALLBACK_BOUNDS[campus];
  }

  return [
    [acc.minLat, acc.minLng],
    [acc.maxLat, acc.maxLng],
  ];
}

/** Verified non-DB building names already established in app copy (e.g. "Find a Library Room"). */
export const VERIFIED_APP_BUILDING_NAMES: Record<string, string> = {
  LIB: "Library",
};

const VENUE_LABELS: Record<string, string> = {
  OSHAWA_CAMPUS: "Oshawa Campus",
  WHITBY_CAMPUS: "Whitby Campus",
  DOWNTOWN_OSHAWA: "Downtown Oshawa",
  "North Location": "North Campus",
};

/** Formats raw campus_spaces venue strings into readable labels, dropping unknown underscore codes. */
export function formatVenueLabel(venue: string | null | undefined): string | null {
  const trimmed = venue?.trim();
  if (!trimmed) return null;
  if (VENUE_LABELS[trimmed]) return VENUE_LABELS[trimmed];
  const upper = trimmed.toUpperCase();
  if (VENUE_LABELS[upper]) return VENUE_LABELS[upper];
  if (trimmed.includes("_")) return null;
  return trimmed;
}

/**
 * Returns live Toronto weekStart, dayIndex, date, and exact minute slotStart
 * clamped to the academic map range and time scrubber bounds.
 */
export function getLiveTorontoMapState(now: Date = new Date()): {
  weekStart: string;
  dayIndex: number;
  date: string;
  slotStart: number;
} {
  const { date: torontoDate, minutes } = getTorontoNowParts(now);
  let date = torontoDate;
  if (date < CAMPUS_MAP_MIN_DATE) date = CAMPUS_MAP_MIN_DATE;
  if (date > CAMPUS_MAP_MAX_DATE) date = CAMPUS_MAP_MAX_DATE;

  const weekStart = clampWeekStart(date);
  const dayIndex = getDayOfWeekMon1(date);
  const slotStart = Math.max(480, Math.min(minutes, 1290));
  return { weekStart, dayIndex, date, slotStart };
}

/** Strips all whitespace and uppercases text for room/building search comparison. */
export function normalizeSearchCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

export function formatFloor(fl: string | null | undefined): string {
  const key = String(fl ?? "");
  return FLOOR_LABELS[key] || key || "—";
}

export function formatFloorLong(fl: string | null | undefined): string {
  const key = String(fl ?? "");
  if (key === "ALL") return "All Floors";
  if (key === "-10") return "Basement (B)";
  const label = FLOOR_LABELS[key];
  return label ? `Floor ${label}` : key || "—";
}

export function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function assignOverlapLanes(
  day: number,
  events: ScheduleInterval[],
): PositionedEvent[] {
  const filtered = events
    .filter(
      (ev) =>
        Number.isFinite(ev.start) &&
        Number.isFinite(ev.end) &&
        ev.end > 480 &&
        ev.start < 1320,
    )
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

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurationLong(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${m}m`;
}

export function formatMinutesToTime(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${m === 0 ? "00" : m < 10 ? "0" + m : m} ${ampm}`;
}

export function formatMinutesShort(min: number): string {
  return formatMinutesToTime(min).replace(":00 ", " ");
}

export function minutesToTimeInputValue(min: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(min)));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function parseTimeInputToMinutes(val: string): number | null {
  const match = val.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return Math.max(480, Math.min(1290, h * 60 + m));
}

export function getContainerColor(ratio: number): string {
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

export function getEventTypeLabel(type: string | null | undefined): string {
  if (type === "exam") return "Final Exam";
  if (type === "library_booking") return "Library Booking";
  if (type === "reservation") return "Reservation";
  return "Course / Lab";
}

export function getRoomDisplayCode(feature: CampusMapFeature): string {
  return feature.properties.externalId || feature.properties.name || "Room";
}

export function getLibraryBookingUrl(
  roomId: string,
  slotStartMinutes: number,
): string {
  const bookTime = formatMinutesToTime(slotStartMinutes);
  return `https://apps.library.dc-ot.ca/OTrooms/temp.aspx?starttime=${encodeURIComponent(bookTime)}&room=${encodeURIComponent(roomId)}&next=book.aspx`;
}

export function getInfosilemBookingUrl(roomUuid: string): string {
  return `https://campusportal.ca.infosilem.com/ontariotech/p/CreateBooking/i/00000000-0000-0000-0000-000000000000/d/-1/t/-1/r/${encodeURIComponent(roomUuid)}/d/0`;
}
