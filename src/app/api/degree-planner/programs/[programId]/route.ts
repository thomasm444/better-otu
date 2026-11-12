import { NextResponse } from "next/server";

import { getProgramDetail } from "@/lib/degree-queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ programId: string }> },
) {
  const { programId } = await context.params;
  if (!programId) {
    return NextResponse.json({ error: "Missing programId" }, { status: 400 });
  }

  const program = await getProgramDetail(programId);
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }

  return NextResponse.json(program);
}
