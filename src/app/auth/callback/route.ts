import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

function getSafeNextPath(rawNext: string | null): string {
  if (
    !rawNext ||
    !rawNext.startsWith("/") ||
    rawNext.startsWith("//") ||
    rawNext === "/login"
  ) {
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

function buildLoginErrorRedirect(
  request: Request,
  origin: string,
  message: string,
  nextPath: string,
) {
  const errorUrl = new URL(buildRedirectUrl(request, origin, "/login"));
  errorUrl.searchParams.set("auth_error", message);
  if (nextPath !== "/") {
    errorUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(errorUrl);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  const nextPath = getSafeNextPath(searchParams.get("next"));

  if (oauthError) {
    return buildLoginErrorRedirect(request, origin, oauthError, nextPath);
  }

  if (!code) {
    return buildLoginErrorRedirect(
      request,
      origin,
      "Missing OAuth authorization code.",
      nextPath,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return buildLoginErrorRedirect(request, origin, error.message, nextPath);
  }

  // Defense-in-depth check in case the Postgres Auth Hook has not been enabled yet.
  const email = data.user?.email?.toLowerCase().trim() ?? "";
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    return buildLoginErrorRedirect(
      request,
      origin,
      "Only @ontariotechu.net Google accounts are permitted.",
      nextPath,
    );
  }

  return NextResponse.redirect(buildRedirectUrl(request, origin, nextPath));
}
