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
  return tokens.every((token) => haystack.includes(token));
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

interface ProgramComboboxProps {
  options: ProgramSummary[];
  value: string | null;
  selectedProgram?: ProgramSummary | null;
  onChange: (programId: string | null) => void;
  placeholder: string;
  ariaLabel: string;
  emptyMessage?: string;
  showCredential?: boolean;
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
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pr-16 pl-3.5 text-sm text-slate-900 caret-[#003C71] transition-colors selection:bg-[#BFD7F2]/60 placeholder:text-slate-400 focus:border-[#003C71] focus:ring-2 focus:ring-[#003C71]/15 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:caret-sky-400 dark:selection:bg-sky-800/60 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
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
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
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
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg
              className={`h-4 w-4 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
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
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200/90 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/50"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-3.5 py-5 text-center text-sm text-slate-500 dark:text-slate-400">
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
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(prog);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-[#EBF3FC] font-medium text-[#003C71] dark:bg-sky-950/60 dark:text-sky-200"
                      : isHighlighted
                        ? "bg-slate-100 text-slate-900 dark:bg-slate-800/80 dark:text-slate-100"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <span className="min-w-0 truncate">{prog.name}</span>

                  <span className="flex shrink-0 items-center gap-2">
                    {showCredential && prog.credential && (
                      <span
                        className={`text-xs ${
                          isSelected
                            ? "text-[#003C71]/75 dark:text-sky-300/80"
                            : "text-slate-400 dark:text-slate-500"
                        }`}
                      >
                        {prog.credential}
                      </span>
                    )}
                    {isSelected && (
                      <svg
                        className="h-4 w-4 text-[#003C71] dark:text-sky-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
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
