"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import type { ProgramSummary } from "@/lib/degree-types";

const CREDENTIAL_ORDER: Record<string, number> = {
  Major: 0,
  Specialization: 1,
  "Double Major": 2,
  Diploma: 3,
  "Advanced Entry": 4,
  "Co-operative Education": 5,
};

const PROGRAM_SEARCH_ALIASES: Record<string, string> = {
  cs: "computer science",
  ai: "artificial intelligence",
  it: "information technology",
};

export function programIdentityKey(program: ProgramSummary): string {
  const name = program.name
    .toLowerCase()
    .replace(/[\u2013\u2014-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const credential = (program.credential ?? "").trim().toLowerCase();
  const degree = (program.degree_abbrev ?? program.degree ?? "")
    .trim()
    .toLowerCase();
  return `${name}::${credential}::${degree}`;
}

/**
 * Returns one representative entry per distinct program across all catalog
 * years, preferring the version in `targetCatalogYear` and falling back to
 * the newest available catalog year for programs offered only in other years.
 */
export function mergeProgramsPreferringCatalogYear(
  programs: ProgramSummary[],
  targetCatalogYear: string,
): ProgramSummary[] {
  const byIdentity = new Map<string, ProgramSummary>();

  for (const p of programs) {
    if (p.catalog_year !== targetCatalogYear) continue;
    const key = programIdentityKey(p);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, p);
    }
  }

  const byNewestYear = [...programs].sort((a, b) =>
    b.catalog_year.localeCompare(a.catalog_year),
  );
  for (const p of byNewestYear) {
    const key = programIdentityKey(p);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, p);
    }
  }

  return [...byIdentity.values()];
}

export function matchesProgramSearch(
  program: ProgramSummary,
  rawQuery: string,
): boolean {
  const tokens = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    program.name,
    program.credential,
    program.degree,
    program.degree_abbrev,
    program.faculty,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => {
    if (haystack.includes(token)) return true;
    const alias = PROGRAM_SEARCH_ALIASES[token];
    return alias ? haystack.includes(alias) : false;
  });
}

export function sortDegreePrograms(
  programs: ProgramSummary[],
  query: string,
): ProgramSummary[] {
  const q = query.trim().toLowerCase();
  return [...programs].sort((a, b) => {
    if (q) {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
    }
    const rankA = CREDENTIAL_ORDER[a.credential ?? ""] ?? 99;
    const rankB = CREDENTIAL_ORDER[b.credential ?? ""] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name);
  });
}

export function sortMinorPrograms(
  programs: ProgramSummary[],
  query: string,
): ProgramSummary[] {
  const q = query.trim().toLowerCase();
  return [...programs].sort((a, b) => {
    if (q) {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
    }
    return a.name.localeCompare(b.name);
  });
}

function formatProgramTooltip(prog: ProgramSummary): string {
  const details = [
    prog.credential,
    prog.degree_abbrev ?? prog.degree,
    prog.faculty,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return details.length > 0
    ? `${prog.name} (${details.join(" · ")})`
    : prog.name;
}

interface ProgramComboboxProps {
  options: ProgramSummary[];
  value: string | null;
  selectedProgram?: ProgramSummary | null;
  onChange: (programId: string | null) => void;
  placeholder: string;
  ariaLabel: string;
  emptyMessage?: string;
  showCredential?: boolean;
  preferredCatalogYear?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function ProgramCombobox({
  options,
  value,
  selectedProgram = null,
  onChange,
  placeholder,
  ariaLabel,
  emptyMessage = "No matching programs found.",
  showCredential = true,
  preferredCatalogYear,
  disabled = false,
  inputRef,
}: ProgramComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const resolvedSelected = useMemo(() => {
    if (!value) return null;
    return options.find((o) => o.program_id === value) ?? selectedProgram ?? null;
  }, [value, options, selectedProgram]);

  const filteredOptions = useMemo(() => {
    if (!isSearching || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options
      .filter((p) => matchesProgramSearch(p, query))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return 0;
      });
  }, [options, isSearching, query]);

  const displayValue = isSearching ? query : (resolvedSelected?.name ?? "");

  function setMergedInputRef(node: HTMLInputElement | null) {
    internalInputRef.current = node;
    if (inputRef) {
      inputRef.current = node;
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleOutsideMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setIsSearching(false);
        setQuery("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideMouseDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [isOpen, highlightedIndex]);

  function openDropdown() {
    if (disabled) return;
    setIsOpen(true);
    if (!isSearching && value) {
      const selectedIdx = filteredOptions.findIndex(
        (o) => o.program_id === value,
      );
      setHighlightedIndex(selectedIdx);
    }
  }

  function closeDropdown() {
    setIsOpen(false);
    setIsSearching(false);
    setQuery("");
    setHighlightedIndex(-1);
  }

  function selectOption(program: ProgramSummary) {
    onChange(program.program_id);
    closeDropdown();
  }

  function clearSelection() {
    onChange(null);
    setIsSearching(false);
    setQuery("");
    setHighlightedIndex(-1);
    setIsOpen(true);
    internalInputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        if (filteredOptions.length > 0 && highlightedIndex < 0) {
          setHighlightedIndex(0);
        }
        return;
      }
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((prev) =>
        prev + 1 < filteredOptions.length ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((prev) =>
        prev - 1 >= 0 ? prev - 1 : filteredOptions.length - 1,
      );
    } else if (e.key === "Enter" && isOpen) {
      if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        e.preventDefault();
        selectOption(filteredOptions[highlightedIndex]);
      }
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closeDropdown();
    }
  }

  const activeDescendantId =
    isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]
      ? `${listboxId}-opt-${filteredOptions[highlightedIndex].program_id}`
      : undefined;

  return (
    <div
      ref={containerRef}
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          containerRef.current?.contains(e.relatedTarget as Node)
        ) {
          return;
        }
        closeDropdown();
      }}
      className="relative"
    >
      <div className="relative flex items-center">
        <input
          ref={setMergedInputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendantId}
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          title={!isSearching && resolvedSelected ? formatProgramTooltip(resolvedSelected) : undefined}
          placeholder={placeholder}
          onFocus={openDropdown}
          onClick={openDropdown}
          onChange={(e) => {
            const next = e.target.value;
            setIsSearching(true);
            setQuery(next);
            setIsOpen(true);
            setHighlightedIndex(0);
            if (next === "") {
              onChange(null);
            }
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-line bg-surface py-2.5 pr-16 pl-3 text-sm text-ink caret-accent transition-colors selection:bg-accent-soft placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="absolute right-2 flex items-center gap-0.5">
          {(value !== null || (isSearching && query !== "")) && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onMouseDown={(e) => {
                e.preventDefault();
                clearSelection();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label={isOpen ? "Close options" : "Open options"}
            onMouseDown={(e) => {
              e.preventDefault();
              if (disabled) return;
              if (isOpen) {
                closeDropdown();
              } else {
                openDropdown();
                internalInputRef.current?.focus();
              }
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <div
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-md)]"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-3.5 py-5 text-center text-sm text-ink-muted">
              {emptyMessage}
            </div>
          ) : (
            filteredOptions.map((prog, index) => {
              const isSelected = prog.program_id === value;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={prog.program_id}
                  id={`${listboxId}-opt-${prog.program_id}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={formatProgramTooltip(prog)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(prog);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-accent-soft font-medium text-accent-ink"
                      : isHighlighted
                        ? "bg-surface-subtle text-ink"
                        : "text-ink-secondary hover:bg-surface-subtle"
                  }`}
                >
                  <span className="min-w-0 truncate">{prog.name}</span>

                  <span className="flex shrink-0 items-center gap-2">
                    {preferredCatalogYear &&
                      prog.catalog_year !== preferredCatalogYear && (
                        <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-muted">
                          {prog.catalog_year}
                        </span>
                      )}
                    {showCredential && prog.credential && (
                      <span
                        className={`text-xs ${
                          isSelected
                            ? "text-accent-ink/80"
                            : "text-ink-muted"
                        }`}
                      >
                        {prog.credential}
                      </span>
                    )}
                    {isSelected && (
                      <svg
                        className="h-4 w-4 text-accent"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
