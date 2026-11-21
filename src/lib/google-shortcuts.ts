export type GoogleServiceId =
  | "gmail"
  | "drive"
  | "gemini"
  | "calendar"
  | "notebooklm"
  | "docs"
  | "slides"
  | "sheets";

export interface GoogleServiceDefinition {
  id: GoogleServiceId;
  label: string;
  shortLabel: string;
  buildUrl: (authIndex: number) => string;
}

export const GOOGLE_SERVICES: readonly GoogleServiceDefinition[] = [
  {
    id: "gmail",
    label: "Gmail",
    shortLabel: "Gmail",
    buildUrl: (x) => `https://mail.google.com/mail/u/${x}/`,
  },
  {
    id: "drive",
    label: "Google Drive",
    shortLabel: "Drive",
    buildUrl: (x) => `https://drive.google.com/drive/u/${x}/`,
  },
  {
    id: "gemini",
    label: "Gemini",
    shortLabel: "Gemini",
    buildUrl: (x) => `https://gemini.google.com/u/${x}/app`,
  },
  {
    id: "calendar",
    label: "Google Calendar",
    shortLabel: "Calendar",
    buildUrl: (x) => `https://calendar.google.com/calendar/u/${x}/r`,
  },
  {
    id: "notebooklm",
    label: "NotebookLM",
    shortLabel: "NotebookLM",
    buildUrl: (x) => `https://notebooklm.google.com/?authuser=${x}`,
  },
  {
    id: "docs",
    label: "Google Docs",
    shortLabel: "Docs",
    buildUrl: (x) => `https://docs.google.com/document/u/${x}/`,
  },
  {
    id: "slides",
    label: "Google Slides",
    shortLabel: "Slides",
    buildUrl: (x) => `https://docs.google.com/presentation/u/${x}/`,
  },
  {
    id: "sheets",
    label: "Google Sheets",
    shortLabel: "Sheets",
    buildUrl: (x) => `https://docs.google.com/spreadsheets/u/${x}/`,
  },
] as const;

export const DEFAULT_ENABLED_GOOGLE_SERVICES: GoogleServiceId[] = [
  "gmail",
  "drive",
  "gemini",
  "calendar",
  "notebooklm",
];

export interface GoogleAccountConfig {
  id: string;
  label: string;
  authIndex: number;
  enabledServices: GoogleServiceId[];
}

export interface GoogleMeetLink {
  id: string;
  label: string;
  url: string;
  accountId: string;
}

export interface GoogleShortcutsState {
  accounts: GoogleAccountConfig[];
  meetLinks: GoogleMeetLink[];
}

export const GOOGLE_SHORTCUTS_STORAGE_KEY = "better-otu:portal-google-shortcuts:v1";

export const EMPTY_GOOGLE_STATE: GoogleShortcutsState = {
  accounts: [],
  meetLinks: [],
};

export function createDefaultSchoolAccount(): GoogleAccountConfig {
  return {
    id: `gacct-${Date.now()}-school`,
    label: "School",
    authIndex: 0,
    enabledServices: [...DEFAULT_ENABLED_GOOGLE_SERVICES],
  };
}

export function normalizeMeetUrl(rawUrl: string, authIndex: number): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    parsed.searchParams.set("authuser", String(Math.max(0, Math.floor(authIndex))));
    return parsed.toString();
  } catch {
    const sep = withScheme.includes("?") ? "&" : "?";
    return `${withScheme}${sep}authuser=${Math.max(0, Math.floor(authIndex))}`;
  }
}

export function loadGoogleShortcutsState(): GoogleShortcutsState {
  if (typeof window === "undefined") return EMPTY_GOOGLE_STATE;
  try {
    const raw = window.localStorage.getItem(GOOGLE_SHORTCUTS_STORAGE_KEY);
    if (!raw) return EMPTY_GOOGLE_STATE;
    const parsed = JSON.parse(raw) as Partial<GoogleShortcutsState>;
    const validIds = new Set<string>(GOOGLE_SERVICES.map((s) => s.id));
    const accounts: GoogleAccountConfig[] = Array.isArray(parsed.accounts)
      ? parsed.accounts
          .filter(
            (a): a is GoogleAccountConfig =>
              Boolean(a) &&
              typeof a.id === "string" &&
              typeof a.label === "string" &&
              typeof a.authIndex === "number" &&
              Number.isFinite(a.authIndex) &&
              Array.isArray(a.enabledServices),
          )
          .map((a) => ({
            id: a.id,
            label: a.label.trim() || "Google",
            authIndex: Math.max(0, Math.floor(a.authIndex)),
            enabledServices: a.enabledServices.filter((s): s is GoogleServiceId =>
              validIds.has(s),
            ),
          }))
      : [];

    const accountIds = new Set(accounts.map((a) => a.id));
    const meetLinks: GoogleMeetLink[] = Array.isArray(parsed.meetLinks)
      ? parsed.meetLinks.filter(
          (m): m is GoogleMeetLink =>
            Boolean(m) &&
            typeof m.id === "string" &&
            typeof m.label === "string" &&
            typeof m.url === "string" &&
            typeof m.accountId === "string" &&
            accountIds.has(m.accountId),
        )
      : [];

    return { accounts, meetLinks };
  } catch {
    return EMPTY_GOOGLE_STATE;
  }
}

export function saveGoogleShortcutsState(state: GoogleShortcutsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GOOGLE_SHORTCUTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}
