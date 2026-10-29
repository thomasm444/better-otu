import Link from "next/link";
import { Suspense } from "react";

import {
  RESULTS_PAGE_SIZE,
  TERM_LABEL,
  getSearchVocab,
  parseFilters,
  parsePage,
  searchSections,
  type Filters,
  type RawSearchParams,
} from "@/lib/queries";

import { SearchForm } from "./_components/search-form";
import { SectionRow } from "./_components/section-row";

export default function Home({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 font-sans">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Better OTU</h1>
        <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
          Search {TERM_LABEL} sections by subject, course, class type or
          instructor.
        </p>
      </header>

      {/* The suggestion lists are cached for a day, so this boundary resolves
          immediately once the cache is warm. */}
      <Suspense fallback={<SearchFormSkeleton />}>
        <SearchBar />
      </Suspense>

      {/* With Cache Components enabled, request data (searchParams) and the
          database query have to stream inside a Suspense boundary. */}
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SearchBar() {
  const vocab = await getSearchVocab();

  return <SearchForm vocab={vocab} />;
}

async function Results({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const { rows, total, page, pageCount } = await searchSections(
    filters,
    parsePage(params),
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-black/10 px-4 py-12 text-center text-sm text-zinc-500 dark:border-white/15">
        No sections match those filters.
      </p>
    );
  }

  const firstRow = (page - 1) * RESULTS_PAGE_SIZE + 1;
  const lastRow = firstRow + rows.length - 1;

  return (
    <>
      <p className="mb-3 text-xs uppercase tracking-wide text-zinc-500">
        Showing {firstRow}–{lastRow} of {total.toLocaleString()}
      </p>

      <div className="overflow-x-auto rounded-lg border border-black/[.08] dark:border-white/[.145]">
        <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
          <thead className="bg-black/[.03] text-xs uppercase tracking-wide text-zinc-500 dark:bg-white/[.04]">
            <tr>
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Instructor</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Meets</th>
              <th className="px-4 py-3 text-right font-medium">Seats</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SectionRow
                key={row.crn ?? `${row.subject}-${row.course_number}`}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Pagination filters={filters} page={page} pageCount={pageCount} />
    </>
  );
}

const PAGE_LINK =
  "rounded-lg border border-black/[.12] px-3 py-1.5 transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:hover:bg-white/[.06]";

function Pagination({
  filters,
  page,
  pageCount,
}: {
  filters: Filters;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between text-sm"
    >
      {page > 1 ? (
        <Link href={pageHref(filters, page - 1)} className={PAGE_LINK}>
          ← Previous
        </Link>
      ) : (
        <span className={`${PAGE_LINK} opacity-40`} aria-disabled="true">
          ← Previous
        </span>
      )}

      <span className="text-zinc-500">
        Page {page} of {pageCount}
      </span>

      {page < pageCount ? (
        <Link href={pageHref(filters, page + 1)} className={PAGE_LINK}>
          Next →
        </Link>
      ) : (
        <span className={`${PAGE_LINK} opacity-40`} aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  );
}

function pageHref(filters: Filters, page: number) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  if (page > 1) params.set("page", String(page));

  const query = params.toString();

  return query ? `/?${query}` : "/";
}

function SearchFormSkeleton() {
  return (
    <div className="mb-8 grid animate-pulse grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-[4.25rem] rounded-lg bg-black/[.05] dark:bg-white/[.06]"
        />
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="h-64 animate-pulse rounded-lg bg-black/[.05] dark:bg-white/[.06]" />
  );
}
