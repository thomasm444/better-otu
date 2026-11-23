import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  buildOnboardingCookieOptions,
  getSafeNextPath,
  hasResolvedOnboarding,
  ONBOARDING_COOKIE_NAME,
} from "@/lib/onboarding";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/privacy-policy" ||
    pathname.startsWith("/auth/")
  );
}

function isOnboardingExemptPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/privacy-policy" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/")
  );
}

function redirectWithCookies(
  url: URL,
  sourceResponse: NextResponse,
): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  sourceResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

/**
 * Next.js 16 renamed Middleware to Proxy: the file is `proxy.ts`, not
 * `middleware.ts`. It refreshes expiring Supabase auth tokens and enforces
 * mandatory @ontariotechu.net authentication across the application.
 */
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          // Auth responses must never be cached by a CDN or proxy.
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  // Refreshes the session if expired and returns the verified user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthorizedUser =
    Boolean(user?.email) &&
    user!.email!.toLowerCase().trim().endsWith(ALLOWED_EMAIL_DOMAIN);

  const { pathname, search } = request.nextUrl;

  if (!isAuthorizedUser) {
    if (isPublicAuthPath(pathname)) {
      return response;
    }

    // Allow external calendar apps (Google Calendar / Apple iCal) to poll the
    // HMAC-signed .ics feed without session cookies.
    if (pathname === "/api/course-schedules/calendar") {
      return response;
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  // Signed-in users visiting /login are redirected to their destination or home.
  if (pathname === "/login") {
    const destination = getSafeNextPath(request.nextUrl.searchParams.get("next"));
    const targetUrl = new URL(destination, request.url);
    return redirectWithCookies(targetUrl, response);
  }

  const isPrefetch =
    Boolean(request.headers.get("next-router-prefetch")) ||
    request.headers.get("purpose") === "prefetch";

  if (
    request.method === "GET" &&
    !isPrefetch &&
    !isOnboardingExemptPath(pathname) &&
    request.cookies.get(ONBOARDING_COOKIE_NAME)?.value !== user!.id
  ) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_completed_at, onboarding_skipped_at")
      .eq("id", user!.id)
      .maybeSingle();

    if (profileError) {
      return response;
    }

    if (hasResolvedOnboarding(profile)) {
      response.cookies.set(
        ONBOARDING_COOKIE_NAME,
        user!.id,
        buildOnboardingCookieOptions(),
      );
      return response;
    }

    const onboardingUrl = request.nextUrl.clone();
    onboardingUrl.pathname = "/onboarding";
    onboardingUrl.search = "";
    if (pathname !== "/") {
      onboardingUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return redirectWithCookies(onboardingUrl, response);
  }

  return response;
}

export const config = {
  // Everything except Next's static output and public assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
