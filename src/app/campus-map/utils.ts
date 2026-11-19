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

export const FLOOR_COLORS: Record<string, string> = {
  "-10": "#9333ea", // purple
  "0": "#0284c7", // blue
  "20": "#0d9488", // teal
  "30": "#eab308", // amber
  "40": "#f43f5e", // rose
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

export const VENUES = {
  north: { lat: 43.9454, lng: -78.8968, zoom: 17, label: "North" },
  downtown: { lat: 43.8978, lng: -78.8608, zoom: 18, label: "Downtown" },
  whitby: { lat: 43.8723, lng: -78.9016, zoom: 18, label: "Whitby" },
} as const;

export type VenueKey = keyof typeof VENUES;

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
