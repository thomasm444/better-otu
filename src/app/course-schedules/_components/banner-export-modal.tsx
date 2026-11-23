"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

interface BannerExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  term: string;
  termLabel: string;
  crns: string[];
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

interface StepImageProps {
  src: string;
  alt: string;
}

function StepImage({ src, alt }: StepImageProps) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100/70 dark:border-slate-700/80 dark:bg-slate-800/70 sm:mt-0 sm:w-44 sm:shrink-0">
      <Image
        src={src}
        alt={alt}
        width={352}
        height={220}
        unoptimized
        onError={() => setHidden(true)}
        className="h-auto w-full object-cover"
      />
    </div>
  );
}

const STEP_IMAGES = [
  {
    src: "/images/banner-export/step-1.png",
    alt: "Banner Add/Drop Classes with the selected term",
  },
  {
    src: "/images/banner-export/step-2.png",
    alt: "Browser address bar with the copied CRN link pasted",
  },
  {
    src: "/images/banner-export/step-3.png",
    alt: "Browser Back button and Banner summary showing added course rows",
  },
  {
    src: "/images/banner-export/step-4.png",
    alt: "Banner Action dropdown changed and Submit button enabled",
  },
] as const;

type CopyTarget = "link" | "crns";

export function BannerExportModal({
  isOpen,
  onClose,
  term,
  termLabel,
  crns,
  triggerRef,
}: BannerExportModalProps) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const crnInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const normalizedCrns = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of crns) {
      const trimmed = raw.trim();
      if (/^\d{5}$/.test(trimmed) && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
    return result;
  }, [crns]);

  const crnListString = useMemo(() => normalizedCrns.join(","), [normalizedCrns]);

  const exportUrl = useMemo(
    () =>
      `https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/classRegistration/addCRNRegistrationItems?crnList=${crnListString}&term=${encodeURIComponent(term)}`,
    [crnListString, term],
  );

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Focus management, Escape handling, and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const triggerEl = triggerRef?.current ?? previouslyFocused;
    const focusTimer = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === first ||
          !dialogRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          last.focus();
        }
      } else if (
        document.activeElement === last ||
        !dialogRef.current.contains(document.activeElement)
      ) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      triggerEl?.focus();
    };
  }, [isOpen, onClose, triggerRef]);

  const copyText = useCallback(
    async (
      target: CopyTarget,
      value: string,
      inputRef: React.RefObject<HTMLInputElement | null>,
      fallbackMessage: string,
      announcement: string,
    ) => {
      setCopyError(null);
      let succeeded = false;

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          succeeded = true;
        } catch {
          succeeded = false;
        }
      }

      if (!succeeded && inputRef.current) {
        try {
          inputRef.current.focus();
          inputRef.current.select();
          inputRef.current.setSelectionRange(0, value.length);
          succeeded = document.execCommand("copy");
        } catch {
          succeeded = false;
        }
      }

      if (succeeded) {
        setCopiedTarget(target);
        setLiveAnnouncement(announcement);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          setCopiedTarget(null);
        }, 2000);
      } else {
        setCopiedTarget(null);
        setCopyError(fallbackMessage);
        setLiveAnnouncement(fallbackMessage);
      }
    },
    [],
  );

  if (!isOpen) return null;

  const steps = [
    `In your Banner tab, open Registration → Add/Drop Classes and select ${termLabel}. Leave that tab open.`,
    `Copy the link below, paste it into that tab's address bar, press Enter. You'll get a page of raw text — that's expected.`,
    `Press the browser Back button. Your classes appear in the summary. Do NOT refresh or reopen Add/Drop — that discards them.`,
    `Submit is greyed out until you make one change. Drop the class you're replacing, or flip any row's Action dropdown to None and back. Then click Submit.`,
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-3 dark:border-slate-800">
          <div>
            <h3
              id={titleId}
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Export to Add/Drop ({termLabel})
            </h3>
            <p
              id={subtitleId}
              className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"
            >
              Copies a link that adds all {normalizedCrns.length} CRNs at once.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-xl p-1 text-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            &times;
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* Ordered Steps */}
          <ol className="space-y-3">
            {steps.map((text, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/45 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white dark:bg-sky-500">
                    {index + 1}
                  </span>
                  <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                    {text}
                  </p>
                </div>
                <StepImage
                  src={STEP_IMAGES[index].src}
                  alt={STEP_IMAGES[index].alt}
                />
              </li>
            ))}
          </ol>

          {/* Prominent Amber Warning */}
          <div
            role="note"
            className="rounded-xl border border-amber-300/90 bg-amber-50/90 px-3.5 py-2.5 text-xs font-medium text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/45 dark:text-amber-100"
          >
            Refreshing the page, or opening Add/Drop in a new tab, will lose the
            classes you just added. Use the Back button.
          </div>

          {/* Primary Copy Control */}
          <div className="space-y-1.5">
            <label
              htmlFor="banner-export-url"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
            >
              Add/Drop CRN link
            </label>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <input
                id="banner-export-url"
                ref={linkInputRef}
                type="text"
                readOnly
                value={exportUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 select-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    "link",
                    exportUrl,
                    linkInputRef,
                    "Select the link and copy it manually",
                    "Add/Drop link copied to clipboard",
                  )
                }
                className="inline-flex shrink-0 items-center justify-center rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-sky-500 dark:hover:bg-sky-600"
              >
                {copiedTarget === "link" ? "Copied ✓" : "Copy link"}
              </button>
            </div>
            {copyError && (
              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {copyError}
              </p>
            )}
            <span className="sr-only" aria-live="polite">
              {liveAnnouncement}
            </span>
          </div>

          {/* CRN Preview */}
          <div className="space-y-1.5">
            <label
              htmlFor="banner-export-crns"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
            >
              CRNs included ({normalizedCrns.length})
            </label>
            <div className="flex items-center gap-2">
              <input
                id="banner-export-crns"
                ref={crnInputRef}
                type="text"
                readOnly
                value={crnListString}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] text-slate-700 select-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    "crns",
                    crnListString,
                    crnInputRef,
                    "Select the link and copy it manually",
                    "CRN list copied to clipboard",
                  )
                }
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:bg-slate-700"
              >
                {copiedTarget === "crns" ? "Copied ✓" : "Copy CRNs"}
              </button>
            </div>
          </div>

          {/* Tertiary Link */}
          <div className="border-t border-slate-200/80 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <a
              href={exportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-600 underline underline-offset-2 transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-slate-300 dark:hover:text-slate-100"
            >
              Advanced: open the link now
            </a>
            <p className="mt-0.5 text-slate-400 dark:text-slate-500">
              This opens in a new tab, so your Banner tab won&apos;t refresh.
              You&apos;ll still need the Back button.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
