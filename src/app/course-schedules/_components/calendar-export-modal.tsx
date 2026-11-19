"use client";

import React, { useMemo, useState } from "react";

interface CalendarExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  term: string;
  termLabel: string;
  userId: string | null;
  activeCrns: string[];
}

export function CalendarExportModal({
  isOpen,
  onClose,
  term,
  termLabel,
  userId,
  activeCrns,
}: CalendarExportModalProps) {
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  const subscriptionUrl = useMemo(() => {
    if (!origin) return "";
    if (userId) {
      return `${origin}/api/course-schedules/calendar?user=${encodeURIComponent(userId)}&term=${encodeURIComponent(term)}`;
    }
    const crnsParam = activeCrns.join(",");
    return `${origin}/api/course-schedules/calendar?term=${encodeURIComponent(term)}&crns=${encodeURIComponent(crnsParam)}`;
  }, [origin, userId, term, activeCrns]);

  const webcalUrl = useMemo(() => {
    if (!subscriptionUrl) return "";
    return subscriptionUrl.replace(/^https?:\/\//i, "webcal://");
  }, [subscriptionUrl]);

  const googleSubscribeUrl = useMemo(() => {
    if (!webcalUrl) return "";
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  }, [webcalUrl]);

  const downloadUrl = useMemo(() => {
    if (!origin) return "";
    const params = new URLSearchParams({ term, download: "1" });
    if (activeCrns.length > 0) {
      params.set("crns", activeCrns.join(","));
    } else if (userId) {
      params.set("user", userId);
    }
    return `${origin}/api/course-schedules/calendar?${params.toString()}`;
  }, [origin, term, activeCrns, userId]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!subscriptionUrl) return;
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Sync to Apple &amp; Google Calendar ({termLabel})
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Includes weekly lectures, biweekly labs/tutorials, Reading Week &amp;
              holiday exclusions, and final exams.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            &times;
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* Dynamic Feed Status */}
          <div
            className={`rounded-lg border p-3 ${
              userId
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            {userId ? (
              <>
                <strong>Live Account Sync Active:</strong> Subscribing with the
                link below dynamically updates your calendar whenever you change
                your saved courses in Better OTU.
              </>
            ) : (
              <>
                <strong>Guest Snapshot Link:</strong> Sign in with your{" "}
                <code>@ontariotechu.net</code> account to get a live-updating
                link that reflects future schedule edits automatically.
              </>
            )}
          </div>

          {/* Subscription Link */}
          <div>
            <label className="block font-medium text-zinc-700 dark:text-zinc-300">
              Dynamic Calendar Feed URL (iCalendar / .ics)
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                readOnly
                value={subscriptionUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>

          {/* One-Click Actions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href={webcalUrl}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-medium text-zinc-900 shadow-xs transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <span>Subscribe in Apple Calendar</span>
            </a>

            <a
              href={googleSubscribeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 font-medium text-blue-900 shadow-xs transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/60"
            >
              <span>Subscribe in Google Calendar</span>
            </a>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">
              How Google Calendar subscription works:
            </p>
            <p className="mt-1">
              Click <strong>Subscribe in Google Calendar</strong> above, or in
              Google Calendar on desktop click{" "}
              <strong>Other calendars (+) &rarr; From URL</strong> and paste the
              feed URL. Google refreshes subscribed calendars periodically
              (typically every few hours).
            </p>
          </div>

          {/* Footer / Direct Download */}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <a
              href={downloadUrl}
              download={`better-otu-${term}.ics`}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Download .ics Snapshot ({activeCrns.length} sections)
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
