"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { signInWithOntarioTechGoogle } from "@/lib/auth";

export function LoginCard() {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string>("/");

  useEffect(() => {
    // Schedule URL inspection in a microtask to avoid synchronous setState in effect.
    void Promise.resolve().then(() => {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        setNextPath(next);
      }

      const authError = url.searchParams.get("auth_error");
      if (authError) {
        setErrorMessage(authError);
        url.searchParams.delete("auth_error");
        window.history.replaceState({}, "", url.toString());
      }
    });
  }, []);

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signInWithOntarioTechGoogle(nextPath);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start Google sign-in.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-md)] sm:p-8">
      {/* Brand / Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3.5 flex justify-center">
          <Image
            src="/images/better-otu-logo-light.svg"
            alt="Better OTU logo"
            width={48}
            height={48}
            priority
            className="block h-12 w-12 object-contain dark:hidden"
          />
          <Image
            src="/images/better-otu-logo-dark.svg"
            alt="Better OTU logo"
            width={48}
            height={48}
            priority
            className="hidden h-12 w-12 object-contain dark:block"
          />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Sign in to Better OTU
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Independent Ontario Tech Student Portal
        </p>
      </div>

      {/* Prominent Unofficial Project Disclaimer */}
      <div
        role="note"
        className="mb-5 flex items-start gap-2.5 rounded-xl border border-accent-line bg-accent-soft px-3.5 py-2.5 text-left text-xs leading-relaxed text-ink-secondary"
      >
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <p className="font-semibold text-ink">Unofficial student project</p>
          <p className="mt-0.5 text-ink-secondary">
            Not affiliated with, sponsored by, or endorsed by Ontario Tech
            University.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-xs leading-relaxed text-danger"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="shrink-0 font-semibold hover:underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Google Sign-In Action */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-ink shadow-[var(--shadow-sm)] transition-colors hover:border-line-strong hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.04v3.14C3.05 21.14 7.21 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.03 14.02c-.25-.73-.39-1.51-.39-2.32s.14-1.59.39-2.32V6.24H1.04A11.98 11.98 0 0 0 0 11.7c0 1.93.46 3.76 1.04 5.46l3.99-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.65c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.09 15.3 0 12 0 7.21 0 3.05 2.86 1.04 7.06l3.99 3.14c.98-2.94 3.73-5.13 6.97-5.13Z"
          />
        </svg>
        <span>
          {submitting
            ? "Redirecting to Google..."
            : "Continue with @ontariotechu.net Google"}
        </span>
      </button>

      {/* Info Divider */}
      <div className="mt-6 border-t border-line-subtle pt-5 text-center">
        <p className="text-xs leading-relaxed text-ink-muted">
          Access is restricted to{" "}
          <span className="font-medium text-ink">@ontariotechu.net</span>{" "}
          accounts. Your course schedules and degree plans are saved securely to
          your student profile.
        </p>
        <p className="mt-2.5">
          <Link
            href="/privacy-policy"
            className="text-[11px] font-medium text-ink-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
          >
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
