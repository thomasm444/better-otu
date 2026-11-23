"use client";

import type { User } from "@supabase/supabase-js";
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ProfileView } from "@/app/profile/_components/profile-view";
import { ProfilePreferencesCard } from "@/components/profile-preferences-card";
import type { ProgramSummary } from "@/lib/degree-types";
import type { StudentProfile } from "@/lib/student-courses";

interface ProfilePayload {
  initialProfile: StudentProfile | null;
  programs: ProgramSummary[];
  availableCatalogYears: string[];
  currentAcademicStartYear: number;
}

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  displayName: string;
  onSignOut?: () => void;
  signingOut?: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function ProfileDrawer({
  isOpen,
  onClose,
  user,
  displayName,
  onSignOut,
  signingOut = false,
  triggerRef,
}: ProfileDrawerProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loading = isOpen && !payload && !loadError;

  useEffect(() => {
    if (!isOpen) return;

    const triggerEl = triggerRef?.current;
    const raf = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      triggerEl?.focus();
    };
  }, [isOpen, onClose, triggerRef]);

  useEffect(() => {
    if (!isOpen || payload) return;
    let active = true;

    fetch("/api/profile")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load profile");
        return (await res.json()) as ProfilePayload;
      })
      .then((data) => {
        if (active) {
          setLoadError(null);
          setPayload(data);
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load profile.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, payload]);

  if (!isOpen || typeof document === "undefined") return null;

  const resolvedName =
    payload?.initialProfile?.full_name?.trim() || displayName;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0b1018]/55 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-canvas p-5 shadow-[var(--shadow-lg)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle pb-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-base font-semibold tracking-tight text-ink"
            >
              {resolvedName}
            </h2>
            {user.email && (
              <p className="mt-0.5 truncate text-xs text-ink-muted">
                {user.email}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-lg p-1.5 text-lg leading-none text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            &times;
          </button>
        </div>

        <div className="mt-5 flex-1 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-muted">
              Preferences
            </p>
            <ProfilePreferencesCard />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-muted">
              Academic info
            </p>
            {loading && !payload ? (
              <div className="divide-y divide-line-subtle rounded-xl border border-line bg-surface">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="flex items-center justify-between px-5 py-4">
                    <div className="space-y-2">
                      <div className="h-3 w-14 rounded bg-surface-subtle" />
                      <div className="h-4 w-40 rounded bg-surface-subtle" />
                    </div>
                    <div className="h-7 w-16 rounded-lg bg-surface-subtle" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-xs text-danger">
                {loadError}
              </div>
            ) : payload ? (
              <ProfileView
                embedded
                programs={payload.programs}
                availableCatalogYears={payload.availableCatalogYears}
                initialProfile={payload.initialProfile}
                displayName={resolvedName}
                email={user.email ?? ""}
                currentAcademicStartYear={payload.currentAcademicStartYear}
              />
            ) : null}
          </div>
        </div>

        {onSignOut && (
          <div className="mt-6 border-t border-line-subtle pt-4">
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-50"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
