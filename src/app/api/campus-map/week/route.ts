import { NextResponse, connection } from "next/server";
import { clampWeekStart } from "@/lib/campus-map-dates";
import { getCampusMapWeekSchedule } from "@/lib/queries";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get("weekStart");
    const weekStart = clampWeekStart(weekStartParam);

    const data = await getCampusMapWeekSchedule(weekStart);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (err: unknown) {
    console.error("Failed to fetch campus map week schedule:", err);
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
