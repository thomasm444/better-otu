import { NextResponse, connection } from "next/server";

import {
  SCHEDULE_TERMS,
  getDefaultScheduleTerm,
  getTermScheduleCatalog,
} from "@/lib/schedule-queries";

const VALID_TERMS = new Set(SCHEDULE_TERMS.map((t) => t.code));

export async function GET(request: Request) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const requestedTerm = searchParams.get("term")?.trim();
    const previewTerm = searchParams.get("previewTerm")?.trim() || undefined;
    const term =
      requestedTerm && VALID_TERMS.has(requestedTerm)
        ? requestedTerm
        : getDefaultScheduleTerm();

    const catalog = await getTermScheduleCatalog(term, previewTerm);
    return NextResponse.json(catalog, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Failed to fetch term schedule catalog:", error);
    return NextResponse.json(
      { error: "Failed to load term schedule catalog" },
      { status: 500 },
    );
  }
}
