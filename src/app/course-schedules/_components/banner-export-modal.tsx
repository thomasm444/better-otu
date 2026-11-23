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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1018]/55 p-4 backdrop-blur-sm"
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
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-lg)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle pb-3">
          <div>
            <h3
              id={titleId}
              className="text-base font-semibold text-ink"
            >
              Export to Add/Drop ({termLabel})
            </h3>
            <p
              id={subtitleId}
              className="mt-0.5 text-xs text-ink-muted"
            >
              Copies a link that adds all {normalizedCrns.length} CRNs at once
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-lg text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
                className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-surface-subtle/60 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-medium text-brand-fg">
                    {index + 1}
                  </span>
                  <p className="leading-relaxed text-ink-secondary">
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
            className="rounded-xl border border-warning-line bg-warning-soft px-3.5 py-2.5 text-xs font-medium text-warning"
          >
            Refreshing the page, or opening Add/Drop in a new tab, will lose the
            classes you just added. Use the Back button.
          </div>

          {/* Primary Copy Control */}
          <div className="space-y-1.5">
            <label
              htmlFor="banner-export-url"
              className="block text-xs font-medium text-ink-secondary"
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
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-subtle px-3 py-2 font-mono text-[11px] text-ink select-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus"
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
                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand px-4 py-2 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {copiedTarget === "link" ? "Copied" : "Copy link"}
              </button>
            </div>
            {copyError && (
              <p className="text-xs font-medium text-warning">
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
              className="block text-xs font-medium text-ink-secondary"
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
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-subtle px-3 py-1.5 font-mono text-[11px] text-ink select-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus"
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
                className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-line-strong hover:bg-surface-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {copiedTarget === "crns" ? "Copied" : "Copy CRNs"}
              </button>
            </div>
          </div>

          {/* Tertiary Link */}
          <div className="border-t border-line-subtle pt-3 text-xs text-ink-muted">
            <a
              href={exportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent-ink underline underline-offset-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Advanced: open the link now
            </a>
            <p className="mt-0.5 text-ink-muted">
              This opens in a new tab, so your Banner tab won&apos;t refresh.
              You&apos;ll still need the Back button.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
