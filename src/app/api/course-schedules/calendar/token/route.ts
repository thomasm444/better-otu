import crypto from "node:crypto";
import { NextResponse, connection } from "next/server";

import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

function signCalendarUser(userId: string): string {
  const secret =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "better-otu-cal";
  return crypto
    .createHmac("sha256", secret)
    .update(userId)
    .digest("hex")
    .slice(0, 32);
}

export async function GET() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase().trim() ?? "";
  if (error || !user || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const token = signCalendarUser(user.id);
  return NextResponse.json(
    { token },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
