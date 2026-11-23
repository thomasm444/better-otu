"use client";

import React, { useState } from "react";
import {
  createDefaultSchoolAccount,
  DEFAULT_ENABLED_GOOGLE_SERVICES,
  GOOGLE_SERVICES,
  normalizeMeetUrl,
  type GoogleAccountConfig,
  type GoogleMeetLink,
  type GoogleServiceId,
  type GoogleShortcutsState,
} from "@/lib/google-shortcuts";

export function GoogleLogoIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function GoogleMeetIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#00832D" d="M14.5 12 18 15.5V8.5L14.5 12Z" />
      <path
        fill="#0066DA"
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5H13v4.5H7.5v5H3V7.5Z"
      />
      <path fill="#E94235" d="M13 5h1.5A2.5 2.5 0 0 1 17 7.5V9l-4 3V5Z" />
      <path fill="#FFBA00" d="M3 14.5h4.5V19H5.5A2.5 2.5 0 0 1 3 16.5v-2Z" />
      <path
        fill="#00AC47"
        d="M7.5 14.5H13V12l4 3v1.5A2.5 2.5 0 0 1 14.5 19h-7v-4.5Z"
      />
      <path
        fill="#00AC47"
        d="M17 9.5 20.3 6.8A1 1 0 0 1 22 7.6v8.8a1 1 0 0 1-1.7.8L17 14.5v-5Z"
      />
    </svg>
  );
}

export function GoogleServiceIcon({
  serviceId,
  className = "h-6 w-6",
}: {
  serviceId: GoogleServiceId;
  className?: string;
}) {
  switch (serviceId) {
    case "gmail":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#EA4335"
            d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20v12Z"
          />
          <path fill="#4285F4" d="M4 6h2v12H4z" />
          <path fill="#34A853" d="M18 6h2v12h-2z" />
        </svg>
      );
    case "drive":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path fill="#0066DA" d="M8.5 3.5 2 14.8l3.2 5.7L11.7 9.2 8.5 3.5Z" />
          <path fill="#00AC47" d="M15.5 3.5h-7l6.5 11.3h7L15.5 3.5Z" />
          <path fill="#EA4335" d="M5.2 20.5h13.6l3.2-5.7H8.4l-3.2 5.7Z" />
        </svg>
      );
    case "gemini":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <defs>
            <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4285F4" />
              <stop offset="50%" stopColor="#9B72CB" />
              <stop offset="100%" stopColor="#D96570" />
            </linearGradient>
          </defs>
          <path
            fill="url(#gemini-grad)"
            d="M12 2c.4 5.2 4.8 9.6 10 10-5.2.4-9.6 4.8-10 10-.4-5.2-4.8-9.6-10-10 5.2-.4 9.6-4.8 10-10Z"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="3" fill="#4285F4" />
          <rect x="6" y="8" width="12" height="10" rx="1.5" fill="#FFFFFF" />
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="#1A73E8"
            fontFamily="system-ui, sans-serif"
          >
            31
          </text>
        </svg>
      );
    case "notebooklm":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="3" fill="#0F172A" />
          <path
            fill="none"
            stroke="#38BDF8"
            strokeWidth="2"
            strokeLinecap="round"
            d="M8 15c0-3.3 1.8-6 4-6s4 2.7 4 6M10 15c0-1.9.9-3.5 2-3.5s2 1.6 2 3.5"
          />
        </svg>
      );
    case "docs":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#4285F4"
            d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
          />
          <path fill="#A1C2FA" d="M14 2v5h5l-5-5Z" />
          <path stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" d="M8 12h8M8 15h8M8 18h5" />
        </svg>
      );
    case "slides":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#FBBC04"
            d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
          />
          <path fill="#FDE293" d="M14 2v5h5l-5-5Z" />
          <rect x="7.5" y="11" width="9" height="6" rx="1" fill="#FFFFFF" />
        </svg>
      );
    case "sheets":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#34A853"
            d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
          />
          <path fill="#A8DAB5" d="M14 2v5h5l-5-5Z" />
          <rect x="7.5" y="11" width="9" height="6.5" rx="0.8" fill="#FFFFFF" />
          <path stroke="#34A853" strokeWidth="1.2" d="M7.5 14.2h9M12 11v6.5" />
        </svg>
      );
  }
}

interface GoogleShortcutsModalProps {
  initialState: GoogleShortcutsState;
  onSave: (next: GoogleShortcutsState) => void;
  onClose: () => void;
}

export function GoogleShortcutsModal({
  initialState,
  onSave,
  onClose,
}: GoogleShortcutsModalProps) {
  const [accounts, setAccounts] = useState<GoogleAccountConfig[]>(() =>
    initialState.accounts.length > 0
      ? initialState.accounts
      : [createDefaultSchoolAccount()],
  );
  const [meetLinks, setMeetLinks] = useState<GoogleMeetLink[]>(
    () => initialState.meetLinks,
  );
  const [showTutorial, setShowTutorial] = useState<boolean>(
    () => initialState.accounts.length === 0,
  );

  const [meetLabel, setMeetLabel] = useState("");
  const [meetUrlInput, setMeetUrlInput] = useState("");
  const [meetAccountId, setMeetAccountId] = useState<string>(
    () => initialState.accounts[0]?.id ?? "",
  );

  const effectiveMeetAccountId =
    accounts.some((a) => a.id === meetAccountId)
      ? meetAccountId
      : (accounts[0]?.id ?? "");

  const updateAccount = (
    id: string,
    updater: (prev: GoogleAccountConfig) => GoogleAccountConfig,
  ) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? updater(a) : a)));
  };

  const toggleService = (accountId: string, serviceId: GoogleServiceId) => {
    updateAccount(accountId, (acct) => {
      const has = acct.enabledServices.includes(serviceId);
      return {
        ...acct,
        enabledServices: has
          ? acct.enabledServices.filter((s) => s !== serviceId)
          : [...acct.enabledServices, serviceId],
      };
    });
  };

  const handleAddAccount = (presetLabel: string) => {
    const usedNumbers = new Set(accounts.map((a) => a.authIndex));
    let nextIndex = 0;
    while (usedNumbers.has(nextIndex)) nextIndex += 1;

    const newAccount: GoogleAccountConfig = {
      id: `gacct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: presetLabel,
      authIndex: nextIndex,
      enabledServices:
        presetLabel === "Personal"
          ? ["gmail", "drive"]
          : [...DEFAULT_ENABLED_GOOGLE_SERVICES],
    };
    setAccounts((prev) => [...prev, newAccount]);
    if (!meetAccountId) setMeetAccountId(newAccount.id);
  };

  const handleRemoveAccount = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setMeetLinks((prev) => prev.filter((m) => m.accountId !== id));
  };

  const handleAddMeetLink = () => {
    const rawUrl = meetUrlInput.trim();
    if (!rawUrl || !effectiveMeetAccountId) return;
    const label = meetLabel.trim() || "Google Meet";
    const acct = accounts.find((a) => a.id === effectiveMeetAccountId);
    const formattedUrl = normalizeMeetUrl(rawUrl, acct?.authIndex ?? 0);
    if (!formattedUrl) return;

    setMeetLinks((prev) => [
      ...prev,
      {
        id: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        url: formattedUrl,
        accountId: effectiveMeetAccountId,
      },
    ]);
    setMeetLabel("");
    setMeetUrlInput("");
  };

  const handleRemoveMeetLink = (id: string) => {
    setMeetLinks((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedAccounts = accounts.map((a) => ({
      ...a,
      label: a.label.trim() || "Google",
      authIndex: Number.isFinite(a.authIndex) ? Math.max(0, Math.floor(a.authIndex)) : 0,
    }));
    const acctIndexById = new Map(
      cleanedAccounts.map((a) => [a.id, a.authIndex]),
    );
    const cleanedMeetLinks = meetLinks
      .filter((m) => acctIndexById.has(m.accountId))
      .map((m) => ({
        ...m,
        url: normalizeMeetUrl(m.url, acctIndexById.get(m.accountId) ?? 0),
      }));

    onSave({
      accounts: cleanedAccounts,
      meetLinks: cleanedMeetLinks,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configure Google Shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1018]/55 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSave}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line-subtle px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-subtle">
              <GoogleLogoIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">
                Google Workspace shortcuts
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            &times;
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs">
          {/* Account Number Tutorial */}
          <div className="rounded-xl border border-warning-line bg-warning-soft p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-warning">
                  Guide
                </span>
                <span className="font-medium text-ink">
                  How to find your Google account number
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowTutorial((prev) => !prev)}
                className="text-xs font-medium text-accent-ink hover:underline"
              >
                {showTutorial ? "Hide" : "Show"}
              </button>
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
              <strong className="font-medium text-ink">
                Only needed if you have multiple Google accounts
              </strong>{" "}
              (otherwise leave as <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">0</code>). Open Gmail in your school account and copy the number after <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">/u/</code> in the URL:
            </p>

            {showTutorial && (
              <div className="mt-2.5">
                {/* Annotated Screenshot with Red Arrow pointing to 6 */}
                <div className="relative overflow-hidden rounded-xl border border-line bg-[#1f2022]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/images/google-authuser-example.png"
                    alt="Browser address bar showing https://mail.google.com/mail/u/6/#inbox with a red arrow pointing to 6"
                    className="block h-auto w-full select-none"
                  />
                  <svg
                    viewBox="0 0 642 164"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    aria-hidden="true"
                  >
                    {/* Red highlight ring around the "6" in /u/6/ */}
                    <circle
                      cx="449"
                      cy="46"
                      r="16"
                      fill="rgba(239, 68, 68, 0.16)"
                      stroke="#EF4444"
                      strokeWidth="3.5"
                    />
                    {/* Red arrow pointing straight up to the 6 */}
                    <line
                      x1="449"
                      y1="126"
                      x2="449"
                      y2="71"
                      stroke="#EF4444"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M437 83 L449 66 L461 83"
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <rect
                      x="370"
                      y="128"
                      width="158"
                      height="26"
                      rx="13"
                      fill="#EF4444"
                    />
                    <text
                      x="449"
                      y="145"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="13"
                      fontWeight="700"
                      fontFamily="system-ui, sans-serif"
                    >
                      Your number (6)
                    </text>
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Configured Google Accounts (School, Personal, or multiple numbers) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-ink-secondary">
                Google accounts ({accounts.length})
              </h3>
              <button
                type="button"
                onClick={() => handleAddAccount(`Account ${accounts.length + 1}`)}
                className="rounded-lg border border-accent-line bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink transition-colors hover:bg-accent hover:text-accent-fg"
              >
                + Add another number
              </button>
            </div>

            {accounts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-ink-muted">
                No Google accounts added. Click &ldquo;+ Add another number&rdquo; above.
              </p>
            ) : (
              accounts.map((acct) => (
                <div
                  key={acct.id}
                  className="rounded-xl border border-line bg-surface-subtle/60 p-3.5"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="min-w-[130px] flex-1">
                      <label className="block text-[11px] font-medium text-ink-muted">
                        Account label
                      </label>
                      <input
                        type="text"
                        value={acct.label}
                        onChange={(e) =>
                          updateAccount(acct.id, (prev) => ({
                            ...prev,
                            label: e.target.value,
                          }))
                        }
                        placeholder="School or Personal"
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none"
                      />
                    </div>

                    <div className="w-28">
                      <label className="block text-[11px] font-medium text-ink-muted">
                        Account # (/u/x)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={acct.authIndex}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value, 10);
                          updateAccount(acct.id, (prev) => ({
                            ...prev,
                            authIndex: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                          }));
                        }}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-xs font-medium text-ink focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveAccount(acct.id)}
                      title="Remove this Google account"
                      className="mt-4 rounded-lg border border-danger-line px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Show / Hide Google Services */}
                  <div className="mt-3">
                    <span className="mb-1.5 block text-[11px] font-medium text-ink-muted">
                      Show / hide links
                    </span>

                    <div className="flex flex-wrap gap-1.5">
                      {GOOGLE_SERVICES.map((svc) => {
                        const enabled = acct.enabledServices.includes(svc.id);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            aria-pressed={enabled}
                            onClick={() => toggleService(acct.id, svc.id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              enabled
                                ? "border-accent-line bg-surface text-ink"
                                : "border-line-subtle bg-surface-subtle text-ink-muted line-through"
                            }`}
                          >
                            <GoogleServiceIcon
                              serviceId={svc.id}
                              className={`h-3.5 w-3.5 ${enabled ? "" : "opacity-40 grayscale"}`}
                            />
                            <span>{svc.shortLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Multiple Google Meet Links (?authuser=x) */}
          {accounts.length > 0 && (
            <div className="space-y-2.5 rounded-xl border border-line p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <GoogleMeetIcon className="h-4 w-4" />
                  <h3 className="text-xs font-medium text-ink">
                    Google Meet links
                  </h3>
                </div>
                <span className="font-mono text-[11px] text-ink-muted">
                  Auto-adds ?authuser=x
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <input
                  type="text"
                  placeholder="Label (CSCI 1030U)"
                  value={meetLabel}
                  onChange={(e) => setMeetLabel(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none sm:col-span-4"
                />
                <input
                  type="text"
                  placeholder="meet.google.com/abc-defg-hij"
                  value={meetUrlInput}
                  onChange={(e) => setMeetUrlInput(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none sm:col-span-5"
                />
                {accounts.length > 1 && (
                  <select
                    value={effectiveMeetAccountId}
                    onChange={(e) => setMeetAccountId(e.target.value)}
                    aria-label="Account for Meet link"
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none sm:col-span-3"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} (#{a.authIndex})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleAddMeetLink}
                  disabled={!meetUrlInput.trim()}
                  className={`rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 ${
                    accounts.length > 1 ? "sm:col-span-12" : "sm:col-span-3"
                  }`}
                >
                  + Add Meet link
                </button>
              </div>

              {meetLinks.length > 0 && (
                <ul className="space-y-1.5 pt-1">
                  {meetLinks.map((m) => {
                    const acct = accounts.find((a) => a.id === m.accountId);
                    const previewUrl = normalizeMeetUrl(
                      m.url,
                      acct?.authIndex ?? 0,
                    );
                    return (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-line-subtle bg-surface-subtle px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-ink">
                              {m.label}
                            </span>
                            {acct && (
                              <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-secondary">
                                {acct.label} #{acct.authIndex}
                              </span>
                            )}
                          </div>
                          <p className="truncate font-mono text-[11px] text-ink-muted">
                            {previewUrl}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMeetLink(m.id)}
                          aria-label={`Remove ${m.label}`}
                          className="rounded px-1.5 py-0.5 text-xs text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        >
                          &times;
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover"
          >
            Save Google links
          </button>
        </div>
      </form>
    </div>
  );
}
