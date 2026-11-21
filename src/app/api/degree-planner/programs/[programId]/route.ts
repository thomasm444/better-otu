import { NextResponse } from "next/server";

import { getProgramDetail } from "@/lib/degree-queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ programId: string }> },
) {
  const { programId } = await context.params;
  if (!programId || programId.length > 64) {
    return NextResponse.json({ error: "Invalid programId" }, { status: 400 });
  }

  const program = await getProgramDetail(programId);
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }

  return NextResponse.json(program, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
