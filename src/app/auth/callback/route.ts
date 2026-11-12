import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

function getSafeNextPath(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/";
  }
  return rawNext;
}

function buildRedirectUrl(request: Request, origin: string, path: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (process.env.NODE_ENV !== "development" && forwardedHost) {
    return `https://${forwardedHost}${path}`;
  }
  return `${origin}${path}`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  const nextPath = getSafeNextPath(searchParams.get("next"));

  if (oauthError) {
    const errorUrl = new URL(buildRedirectUrl(request, origin, nextPath));
    errorUrl.searchParams.set("auth_error", oauthError);
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    const errorUrl = new URL(buildRedirectUrl(request, origin, nextPath));
    errorUrl.searchParams.set("auth_error", "Missing OAuth authorization code.");
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorUrl = new URL(buildRedirectUrl(request, origin, nextPath));
    errorUrl.searchParams.set("auth_error", error.message);
    return NextResponse.redirect(errorUrl);
  }

  // Defense-in-depth check in case the Postgres Auth Hook has not been enabled yet.
  const email = data.user?.email?.toLowerCase().trim() ?? "";
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    const errorUrl = new URL(buildRedirectUrl(request, origin, nextPath));
    errorUrl.searchParams.set(
      "auth_error",
      "Only @ontariotechu.net Google accounts are permitted.",
    );
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(buildRedirectUrl(request, origin, nextPath));
}
