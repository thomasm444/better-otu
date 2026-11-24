"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ProfileDrawer } from "@/components/profile-drawer";
import { signInWithOntarioTechGoogle, signOut } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export function AuthButton({
  compact = false,
  isProfileActive = false,
}: {
  compact?: boolean;
  isProfileActive?: boolean;
} = {}) {
  const router = useRouter();
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;

      // Surface OAuth or domain-restriction errors redirected from /auth/callback.
      const url = new URL(window.location.href);
      const authError = url.searchParams.get("auth_error");
      if (authError) {
        setErrorMessage(authError);
        url.searchParams.delete("auth_error");
        window.history.replaceState({}, "", url.toString());
      }

      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === "SIGNED_OUT" && window.location.pathname !== "/login") {
        router.replace("/login");
        router.refresh();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSignIn() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signInWithOntarioTechGoogle();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start Google sign-in.",
      );
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to sign out.",
      );
      setSubmitting(false);
    }
  }

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    "Student";

  if (compact) {
    return (
      <>
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-7 w-24 rounded-md bg-surface-subtle" />
          ) : user ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden max-w-[140px] truncate text-xs text-ink-secondary md:inline">
                {displayName}
              </span>
              <button
                ref={profileTriggerRef}
                type="button"
                onClick={() => setProfileOpen(true)}
                aria-expanded={profileOpen}
                className={`inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-md border px-2 text-xs font-medium leading-none transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                  profileOpen || isProfileActive
                    ? "border-accent-line bg-accent-soft text-accent-ink"
                    : "border-line bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                }`}
              >
                Settings
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={submitting}
                className="inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-md border border-line bg-surface px-2 text-xs font-medium leading-none text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-50"
              >
                {submitting ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={submitting}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-50"
            >
              {submitting ? (
                "Redirecting..."
              ) : (
                <>
                  <span className="sm:hidden">Sign in</span>
                  <span className="hidden sm:inline">
                    Sign in with @ontariotechu.net
                  </span>
                </>
              )}
            </button>
          )}
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="fixed top-12 right-3 z-[2000] flex items-center gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-1.5 text-xs text-danger shadow-[var(--shadow-md)]"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="font-medium hover:underline"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}
        {user && (
          <ProfileDrawer
            isOpen={profileOpen}
            onClose={() => setProfileOpen(false)}
            user={user}
            displayName={displayName}
            onSignOut={handleSignOut}
            signingOut={submitting}
            triggerRef={profileTriggerRef}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {loading ? (
        <div className="h-9 w-48 rounded-lg bg-surface-subtle" />
      ) : user ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-1.5 shadow-[var(--shadow-sm)]">
          <div className="text-right">
            <p className="text-xs font-medium text-ink">
              {displayName}
            </p>
            {user.email && (
              <p className="text-[11px] text-ink-muted">
                {user.email}
              </p>
            )}
          </div>
          <button
            ref={profileTriggerRef}
            type="button"
            onClick={() => setProfileOpen(true)}
            aria-expanded={profileOpen}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={submitting}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
          >
            {submitting ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSignIn}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-[var(--shadow-sm)] transition-colors hover:bg-surface-subtle disabled:opacity-50"
        >
          {submitting ? "Redirecting..." : "Sign in with @ontariotechu.net"}
        </button>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-1.5 text-xs text-danger"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="font-medium hover:underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
