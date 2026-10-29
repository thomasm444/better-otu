"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import type { Filters, Vocab } from "@/lib/queries";

type FieldKey = keyof Filters;
type Match = "prefix" | "contains";

const FIELDS: {
  key: FieldKey;
  label: string;
  placeholder: string;
  match: Match;
}[] = [
  { key: "subject", label: "Subject", placeholder: "MATH", match: "prefix" },
  {
    key: "courseCode",
    label: "Course",
    placeholder: "CSCI 1030U",
    match: "prefix",
  },
  {
    key: "classType",
    label: "Class type",
    placeholder: "Lecture",
    match: "prefix",
  },
  {
    key: "instructor",
    label: "Instructor",
    placeholder: "Surname, First",
    match: "contains",
  },
];

const COMMIT_DELAY_MS = 350;

export function SearchForm({ vocab }: { vocab: Vocab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Filters>(() =>
    parseSearchParams(searchParams),
  );
  const [resetToken, setResetToken] = useState(0);

  const urlKey = searchParams.toString();
  const lastCommitted = useRef(urlKey);

  const options: Record<FieldKey, string[]> = useMemo(
    () => ({
      subject: vocab.subjects,
      courseCode: vocab.courseCodes,
      classType: vocab.classTypes,
      instructor: vocab.instructors,
    }),
    [vocab],
  );

  // Follow back/forward navigation, but ignore the URL changes we caused.
  useEffect(() => {
    if (urlKey === lastCommitted.current) return;
    lastCommitted.current = urlKey;
    setValues(parseSearchParams(searchParams));
    // Remount the inputs so any half-typed text gives way to the URL state.
    setResetToken((token) => token + 1);
  }, [urlKey, searchParams]);

  // Commit once typing settles, so one keystroke burst = one query.
  useEffect(() => {
    const query = toQueryString(values);
    if (query === lastCommitted.current) return;

    const timer = setTimeout(() => {
      lastCommitted.current = query;
      startTransition(() => {
        router.replace(query ? `/?${query}` : "/", { scroll: false });
      });
    }, COMMIT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [values, router]);

  const hasFilters = Object.values(values).some(Boolean);

  function clearAll() {
    setValues({});
    setResetToken((token) => token + 1);
  }

  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((field) => (
          <Combobox
            key={`${field.key}-${resetToken}`}
            label={field.label}
            placeholder={field.placeholder}
            match={field.match}
            options={options[field.key]}
            value={values[field.key] ?? ""}
            onChange={(next) =>
              setValues((current) => ({ ...current, [field.key]: next }))
            }
          />
        ))}
      </div>

      <div className="mt-3 flex h-5 items-center justify-between text-xs text-zinc-500">
        <span role="status" aria-live="polite">
          {isPending ? "Searching…" : ""}
        </span>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="underline underline-offset-2 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}

function Combobox({
  label,
  placeholder,
  match,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  match: Match;
  options: string[];
  value: string;
  onChange: (next: string | undefined) => void;
}) {
  const id = useId();
  const listId = `${id}-listbox`;

  // `draft` is what the user is typing; null means "show the committed value".
  // Deriving the visible text avoids syncing state inside an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const query = draft ?? value;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const pool = needle
      ? options.filter((option) => {
          const haystack = option.toLowerCase();
          return match === "prefix"
            ? haystack.startsWith(needle)
            : haystack.includes(needle);
        })
      : options;

    return pool.slice(0, 8);
  }, [options, query, match]);

  function choose(option: string) {
    setDraft(option);
    setOpen(false);
    setActive(0);
    onChange(option);
  }

  function handleChange(text: string) {
    setDraft(text);
    setOpen(true);
    setActive(0);

    if (text.trim() === "") {
      onChange(undefined);
      return;
    }

    // Only commit values that exist in the vocabulary: the database query uses
    // exact equality, so "MAT" must not replace a valid "MATH" filter.
    const exact = options.find(
      (option) => option.toLowerCase() === text.trim().toLowerCase(),
    );
    onChange(exact);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const option = matches[active];
      if (open && option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500"
      >
        {label}
      </label>

      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${id}-option-${active}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-500 dark:border-white/[.18] dark:bg-zinc-900 dark:focus:border-zinc-400"
      />

      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-black/[.08] bg-white py-1 text-sm shadow-lg dark:border-white/[.15] dark:bg-zinc-900"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              // preventDefault keeps focus in the input so onBlur does not fire first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              className={`cursor-pointer px-3 py-1.5 ${
                index === active ? "bg-black/[.06] dark:bg-white/[.10]" : ""
              }`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function parseSearchParams(params: { get: (key: string) => string | null }) {
  return FIELDS.reduce<Filters>((filters, field) => {
    const value = params.get(field.key);
    if (value) filters[field.key] = value;
    return filters;
  }, {});
}

function toQueryString(filters: Filters) {
  const params = new URLSearchParams();

  for (const field of FIELDS) {
    const value = filters[field.key];
    if (value) params.set(field.key, value);
  }

  return params.toString();
}
