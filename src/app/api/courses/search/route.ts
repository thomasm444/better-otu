import { NextResponse, connection } from "next/server";
import { parseFilters, parsePage, searchSections } from "@/lib/queries";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const rawParams: Record<string, string> = {};
    for (const key of ["subject", "courseCode", "classType", "instructor", "crn", "page"]) {
      const value = searchParams.get(key);
      if (value) rawParams[key] = value;
    }

    const filters = parseFilters(rawParams);
    const page = parsePage(rawParams);
    const results = await searchSections(filters, page);

    return NextResponse.json(results, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Failed to search courses:", error);
    return NextResponse.json(
      { error: "Failed to search courses" },
      { status: 500 },
    );
  }
}
