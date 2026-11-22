import { NextResponse } from "next/server";

import { getSafeNextPath } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

function isValidSingleHost(host: string): boolean {
  return Boolean(host) && !/[/\\\s,@]/.test(host);
}

function getAllowedHost(request: Request): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      return new URL(siteUrl).host.toLowerCase();
    } catch {
      // Fall back to request URL host if NEXT_PUBLIC_SITE_URL is malformed.
    }
  }
  return new URL(request.url).host.toLowerCase();
}

function buildRedirectUrl(request: Request, origin: string, path: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (
    process.env.NODE_ENV !== "development" &&
    forwardedHost &&
    isValidSingleHost(forwardedHost) &&
    forwardedHost.toLowerCase() === getAllowedHost(request)
  ) {
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
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN) || !data.user) {
    await supabase.auth.signOut();
    return buildLoginErrorRedirect(
      request,
      origin,
      "Only @ontariotechu.net Google accounts are permitted.",
      nextPath,
    );
  }

  return NextResponse.redirect(
    buildRedirectUrl(request, origin, nextPath),
  );
}
