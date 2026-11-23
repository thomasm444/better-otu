import { NextResponse, connection } from "next/server";
import { clampWeekStart } from "@/lib/campus-map-dates";
import {
  getCampusLiveFreeRoomCount,
  getCampusMapWeekSchedule,
} from "@/lib/queries";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get("weekStart");
    const weekStart = clampWeekStart(weekStartParam);

    if (searchParams.get("summary") === "freeCount") {
      const dayRaw = searchParams.get("day");
      const slotRaw = searchParams.get("slot");
      const dayIndex = dayRaw !== null ? Number(dayRaw) : Number.NaN;
      const slotStart = slotRaw !== null ? Number(slotRaw) : Number.NaN;

      if (
        dayRaw === null ||
        dayRaw.trim() === "" ||
        !Number.isInteger(dayIndex) ||
        dayIndex < 0 ||
        dayIndex > 6 ||
        slotRaw === null ||
        slotRaw.trim() === "" ||
        !Number.isFinite(slotStart) ||
        !Number.isInteger(slotStart)
      ) {
        return NextResponse.json(
          { error: "Invalid day or slot parameter" },
          { status: 400 },
        );
      }

      const freeRoomsTotal = await getCampusLiveFreeRoomCount(
        weekStart,
        dayIndex,
        slotStart,
      );

      return NextResponse.json(
        { freeRoomsTotal },
        {
          headers: {
            "Cache-Control":
              "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
          },
        },
      );
    }

    const data = await getCampusMapWeekSchedule(weekStart);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (err: unknown) {
    console.error("Failed to fetch campus map week schedule:", err);
    return NextResponse.json(
      { error: "Failed to load campus map schedule" },
      { status: 500 },
    );
  }
}
