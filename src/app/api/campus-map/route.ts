import { NextResponse, connection } from "next/server";
import { getCampusMapData } from "@/lib/queries";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const floor = searchParams.get("floor") || undefined;
    const building = searchParams.get("building") || undefined;

    const data = await getCampusMapData(floor, building);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Failed to load campus map data:", error);
    return NextResponse.json(
      { error: "Failed to load campus map data" },
      { status: 500 }
    );
  }
}
