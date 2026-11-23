"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  const [feedToken, setFeedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !userId) return;
    let cancelled = false;
    fetch("/api/course-schedules/calendar/token")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { token?: string } | null) => {
        if (!cancelled && data?.token) {
          setFeedToken(data.token);
        }
      })
      .catch(() => {
        // Ignored; feed URL remains empty until token is available.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  const subscriptionUrl = useMemo(() => {
    if (!origin) return "";
    if (userId) {
      if (!feedToken) return "";
      return `${origin}/api/course-schedules/calendar?user=${encodeURIComponent(userId)}&term=${encodeURIComponent(term)}&token=${encodeURIComponent(feedToken)}`;
    }
    const crnsParam = activeCrns.join(",");
    return `${origin}/api/course-schedules/calendar?term=${encodeURIComponent(term)}&crns=${encodeURIComponent(crnsParam)}`;
  }, [origin, userId, feedToken, term, activeCrns]);

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
      if (feedToken) {
        params.set("token", feedToken);
      }
    }
    return `${origin}/api/course-schedules/calendar?${params.toString()}`;
  }, [origin, term, activeCrns, userId, feedToken]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1018]/55 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-lg)]">
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle pb-3">
          <div>
            <h3 className="text-base font-semibold text-ink">
              Sync to Apple &amp; Google Calendar ({termLabel})
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              Includes weekly lectures, biweekly labs/tutorials, Reading Week &amp;
              holiday exclusions, and final exams
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-lg text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            &times;
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* Dynamic Feed Status */}
          <div
            className={`rounded-xl border p-3 ${
              userId
                ? "border-positive-line bg-positive-soft text-positive"
                : "border-warning-line bg-warning-soft text-warning"
            }`}
          >
            {userId ? (
              <>
                <strong>Live account sync active:</strong> Subscribing with the
                link below dynamically updates your calendar whenever you change
                your saved courses in Better OTU.
              </>
            ) : (
              <>
                <strong>Guest snapshot link:</strong> Sign in with your{" "}
                <code>@ontariotechu.net</code> account to get a live-updating
                link that reflects future schedule edits automatically.
              </>
            )}
          </div>

          {/* Subscription Link */}
          <div>
            <label className="block font-medium text-ink-secondary">
              Dynamic Calendar Feed URL (iCalendar / .ics)
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                readOnly
                value={subscriptionUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-lg border border-line bg-surface-subtle px-2.5 py-1.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-medium text-brand-fg transition-colors hover:bg-brand-hover"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>

          {/* One-Click Actions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href={webcalUrl}
              className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-subtle"
            >
              <span>Subscribe in Apple Calendar</span>
            </a>

            <a
              href={googleSubscribeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent hover:text-accent-fg"
            >
              <span>Subscribe in Google Calendar</span>
            </a>
          </div>

          <div className="rounded-xl border border-line-subtle bg-surface-subtle p-3 text-xs text-ink-secondary">
            <p className="font-medium text-ink">
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
          <div className="flex items-center justify-between border-t border-line-subtle pt-3">
            <a
              href={downloadUrl}
              download={`better-otu-${term}.ics`}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-ink-secondary transition-colors hover:border-line-strong hover:bg-surface-subtle hover:text-ink"
            >
              Download .ics snapshot ({activeCrns.length} sections)
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 font-medium text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
