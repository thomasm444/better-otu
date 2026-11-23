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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-slate-200/90 bg-[#F8FAFD] p-5 shadow-2xl dark:border-slate-800 dark:bg-[#090D16] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-white"
            >
              {resolvedName}
            </h2>
            {user.email && (
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {user.email}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-xl p-1.5 text-lg leading-none text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[#003C71]/35 focus-visible:outline-none dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            &times;
          </button>
        </div>

        <div className="mt-5 flex-1 space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Preferences
            </p>
            <ProfilePreferencesCard />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Academic Info
            </p>
            {loading && !payload ? (
              <div className="divide-y divide-slate-100 rounded-2xl border border-[#BFD7F2]/80 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="flex items-center justify-between px-5 py-4">
                    <div className="space-y-2">
                      <div className="h-3 w-14 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
                      <div className="h-4 w-40 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
                    </div>
                    <div className="h-7 w-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
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
          <div className="mt-6 border-t border-slate-200/80 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
