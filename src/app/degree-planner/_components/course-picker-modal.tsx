"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  completedBefore,
  evalPrereq,
  findBucket,
  matchesBucket,
  matchingBuckets,
  normalizeCode,
  offeredIn,
  offeringOf,
  placedCodes,
  seasonsOf,
  termCalendarYear,
} from "@/lib/degree-planner";
import type {
  CatalogCourse,
  CustomCourse,
  OfferingContext,
  OfferingEntry,
  PickerState,
  PlannerTerm,
  RequirementModel,
} from "@/lib/degree-types";

type CoursePickerModalProps = {
  picker: PickerState;
  initialTransferMode: boolean;
  terms: PlannerTerm[];
  model: RequirementModel | null;
  catalogCourses: CatalogCourse[];
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, OfferingEntry>;
  offeringContext: OfferingContext;
  startYear: number;
  customs: Map<string, CustomCourse>;
  subjects: string[];
  subjectFaculty: Map<string, string | null>;
  onClose: () => void;
  onPlaceCourse: (termIndex: number, slotIndex: number, code: string) => void;
  onSaveCustom: (
    course: CustomCourse,
    target: { termIndex: number; slotIndex: number } | null,
  ) => void;
  onToast: (message: string) => void;
};

export function CoursePickerModal({
  picker,
  initialTransferMode,
  terms,
  model,
  catalogCourses,
  catalogMap,
  offeringsMap,
  offeringContext,
  startYear,
  customs,
  subjects,
  subjectFaculty,
  onClose,
  onPlaceCourse,
  onSaveCustom,
  onToast,
}: CoursePickerModalProps) {
  const [query, setQuery] = useState("");
  const [filterTerm, setFilterTerm] = useState(true);
  const [filterOffered, setFilterOffered] = useState(true);
  const [filterPrereq, setFilterPrereq] = useState(true);
  const [filterBucket, setFilterBucket] = useState(() =>
    Boolean(picker.bucketKey),
  );

  const [customOpen, setCustomOpen] = useState(initialTransferMode);
  const [cxCode, setCxCode] = useState("");
  const [cxTitle, setCxTitle] = useState("");
  const [cxCredits, setCxCredits] = useState("3");
  const [cxSubject, setCxSubject] = useState("");
  const [cxLevel, setCxLevel] = useState("1000");
  const [cxTransfer, setCxTransfer] = useState(initialTransferMode);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const bucket = useMemo(
    () => (picker.bucketKey ? findBucket(model, picker.bucketKey) : null),
    [model, picker],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (initialTransferMode) codeInputRef.current?.focus();
      else searchInputRef.current?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [initialTransferMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const term = terms[picker.termIndex];
  const calYear = term
    ? termCalendarYear(startYear, term.year, term.season)
    : startYear;
  const academicBaseYear = term ? startYear + (term.year - 1) : startYear;

  const openCustomForm = (prefill = "", transfer = false) => {
    const cleanPrefill = /[a-z]/i.test(prefill)
      ? prefill.toUpperCase().trim()
      : "";
    setCxSubject("");
    setCxLevel("1000");
    setCxCode(cleanPrefill);
    setCxTitle("");
    setCxCredits("3");
    setCxTransfer(transfer);
    setCustomOpen(true);
    applyCodeInference(cleanPrefill, "");
    setTimeout(() => codeInputRef.current?.focus(), 20);
  };

  const applyCodeInference = (rawCode: string, currentTitle: string) => {
    const code = normalizeCode(rawCode);
    const parts = code.match(/^([A-Z]{2,6}) (\d{4})/);

    if (parts && subjects.includes(parts[1])) {
      setCxSubject(parts[1]);
    }
    if (parts) {
      const lvl = Math.floor(Number(parts[2]) / 1000) * 1000;
      if (lvl >= 1000 && lvl <= 4000) {
        setCxLevel(String(lvl));
      }
    }

    const known = catalogMap.get(code);
    if (known) {
      if (!currentTitle) setCxTitle(known.title || "");
      if (known.credit_hours) setCxCredits(String(known.credit_hours));
      if (known.subject && subjects.includes(known.subject)) {
        setCxSubject(known.subject);
      }
      if (known.level) setCxLevel(String(known.level));
    }
  };

  const customDraft = useMemo<CustomCourse>(() => {
    const subject = cxSubject || null;
    return {
      code: normalizeCode(cxCode),
      title: cxTitle.trim() || "Custom course",
      credit_hours: Number(cxCredits) || 0,
      subject,
      level: Number(cxLevel) || 0,
      faculty: subject ? (subjectFaculty.get(subject) ?? null) : null,
      custom: true,
      transfer: cxTransfer,
    };
  }, [cxCode, cxTitle, cxCredits, cxSubject, cxLevel, cxTransfer, subjectFaculty]);

  const customHint = useMemo(() => {
    if (!customDraft.code) {
      return {
        line1:
          "Type a course code — the subject and level decide which requirements it can count for.",
        line2: "",
        buckets: [] as string[],
      };
    }

    const known = catalogMap.get(customDraft.code);
    const notes = [`${customDraft.credit_hours} cr`];
    if (customDraft.transfer) notes.push("transfer credit");
    else if (known && !offeringOf(customDraft.code, offeringsMap)) {
      notes.push("in the calendar, never offered");
    } else if (known) {
      notes.push("matches a calendar course");
    }

    if (!customDraft.subject) {
      return {
        line1: notes.join(" · "),
        line2:
          "Pick a subject — that's what makes it count as science, business, communication, a general elective, and so on.",
        buckets: [] as string[],
      };
    }

    notes.push(`${customDraft.subject} ${customDraft.level}`);
    const labels = matchingBuckets(customDraft, model);
    return {
      line1: notes.join(" · "),
      line2: labels.length
        ? "Counts toward:"
        : "Counts toward the total credits only.",
      buckets: labels,
    };
  }, [customDraft, catalogMap, offeringsMap, model]);

  const placed = useMemo(() => placedCodes(terms), [terms]);
  const completed = useMemo(
    () => completedBefore(terms, picker.termIndex),
    [terms, picker],
  );

  const filteredRows = useMemo(() => {
    if (!term) return [];

    let rows = catalogCourses;
    if (filterOffered) {
      rows = rows.filter(
        (c) =>
          seasonsOf(c.code, offeringsMap, customs, {
            academicBaseYear,
            context: offeringContext,
          }).length > 0,
      );
    }

    const seasonal = filterTerm && !(filterBucket && bucket);
    if (seasonal) {
      rows = rows.filter((c) =>
        offeredIn(c.code, term.season, offeringsMap, customs, {
          calendarYear: calYear,
          context: offeringContext,
        }),
      );
    }
    if (filterBucket && bucket) {
      rows = rows.filter((c) => matchesBucket(c, bucket.match));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q),
      );
    }
    if (filterPrereq) {
      rows = rows.filter(
        (c) => evalPrereq(c.prerequisite_ast, completed) !== false,
      );
    }

    const targetLevel = term.year * 1000;
    return rows
      .slice()
      .sort((a, b) => {
        const usedA = placed.has(a.code) ? 1 : 0;
        const usedB = placed.has(b.code) ? 1 : 0;
        if (usedA !== usedB) return usedA - usedB;
        const seasonA = offeredIn(a.code, term.season, offeringsMap, customs, {
          calendarYear: calYear,
          context: offeringContext,
        })
          ? 0
          : 1;
        const seasonB = offeredIn(b.code, term.season, offeringsMap, customs, {
          calendarYear: calYear,
          context: offeringContext,
        })
          ? 0
          : 1;
        if (seasonA !== seasonB) return seasonA - seasonB;
        const gapA = Math.abs((a.level || 0) - targetLevel);
        const gapB = Math.abs((b.level || 0) - targetLevel);
        if (gapA !== gapB) return gapA - gapB;
        return a.code.localeCompare(b.code);
      })
      .slice(0, 80);
  }, [
    term,
    catalogCourses,
    filterOffered,
    filterTerm,
    filterBucket,
    bucket,
    query,
    filterPrereq,
    offeringsMap,
    offeringContext,
    calYear,
    academicBaseYear,
    customs,
    completed,
    placed,
  ]);

  if (!term) return null;

  const handleSaveCustom = () => {
    if (!customDraft.code) {
      onToast("Give the course a code");
      codeInputRef.current?.focus();
      return;
    }
    if (!customDraft.subject) {
      onToast("Pick a subject so it counts toward the right electives");
      return;
    }
    if (customDraft.credit_hours <= 0) {
      onToast("How many credits is it worth?");
      return;
    }
    onSaveCustom(customDraft, {
      termIndex: picker.termIndex,
      slotIndex: picker.slotIndex,
    });
  };

  const titleText = initialTransferMode
    ? "Add a transfer credit"
    : bucket
      ? `Add a course for “${bucket.label}”`
      : `Add a course — Year ${term.year} ${term.season}`;

  const subText = initialTransferMode
    ? "Credit you already earned elsewhere — pick how it should count and it lands in the first free slot."
    : bucket
      ? `${bucket.credits} credits needed · choosing from the whole catalogue`
      : "Defaults to courses offered in this term whose prerequisites you already meet.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 py-[6vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[84vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div>
            <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
              {titleText}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {subText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-base text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ×
          </button>
        </div>

        {/* Search & filter chips */}
        {!initialTransferMode && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 py-2.5 dark:border-zinc-800">
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code or title…"
              autoComplete="off"
              className="min-w-[200px] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            {[
              {
                label: "Offered this term",
                active: filterTerm,
                onClick: () => setFilterTerm((v) => !v),
              },
              {
                label: `Offered ${String(academicBaseYear).slice(-2)}–${String(academicBaseYear + 1).slice(-2)}`,
                active: filterOffered,
                onClick: () => setFilterOffered((v) => !v),
              },
              {
                label: "Prereqs met",
                active: filterPrereq,
                onClick: () => setFilterPrereq((v) => !v),
              },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                aria-pressed={chip.active}
                onClick={chip.onClick}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  chip.active
                    ? "border-blue-200 bg-blue-50 font-medium text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                {chip.label}
              </button>
            ))}
            {bucket && (
              <button
                type="button"
                aria-pressed={filterBucket}
                onClick={() => setFilterBucket((v) => !v)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filterBucket
                    ? "border-blue-200 bg-blue-50 font-medium text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                Fits requirement
              </button>
            )}
            <button
              type="button"
              onClick={() => openCustomForm(query, false)}
              title="A course not listed in the timetable"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-blue-400 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              ＋ Custom course
            </button>
          </div>
        )}

        {/* Custom course panel */}
        {customOpen && (
          <div className="border-b border-zinc-200 bg-zinc-50/70 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950/60">
            <h4 className="mb-2.5 text-[11.5px] font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
              Custom course
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Course code
                <input
                  ref={codeInputRef}
                  value={cxCode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCxCode(next);
                    applyCodeInference(next, cxTitle);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveCustom();
                    }
                  }}
                  placeholder="CSCI 4150U"
                  autoComplete="off"
                  spellCheck={false}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Title
                <input
                  value={cxTitle}
                  onChange={(e) => setCxTitle(e.target.value)}
                  placeholder="Machine Learning II"
                  autoComplete="off"
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Credits
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  value={cxCredits}
                  onChange={(e) => setCxCredits(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Subject (drives what it counts for)
                <select
                  value={cxSubject}
                  onChange={(e) => setCxSubject(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="">— pick a subject —</option>
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Level
                <select
                  value={cxLevel}
                  onChange={(e) => setCxLevel(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="1000">1000</option>
                  <option value="2000">2000</option>
                  <option value="3000">3000</option>
                  <option value="4000">4000</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Faculty (from subject)
                <input
                  readOnly
                  tabIndex={-1}
                  value={customDraft.faculty || "—"}
                  className="rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-[13px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                />
              </label>
            </div>

            <div className="mt-2.5 text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              <div>{customHint.line1}</div>
              {customHint.line2 && (
                <div>
                  {customHint.line2}{" "}
                  {customHint.buckets.length > 0 && (
                    <strong className="text-blue-800 dark:text-blue-300">
                      {customHint.buckets.join(", ")}
                    </strong>
                  )}
                </div>
              )}
            </div>

            <label className="mt-3 flex items-center gap-2 text-[12.5px] text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={cxTransfer}
                onChange={(e) => setCxTransfer(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              Transfer credit — earned at another institution
            </label>

            <div className="mt-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSaveCustom}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                {cxTransfer ? "Add transfer credit" : "Add to this term"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (initialTransferMode) onClose();
                  else setCustomOpen(false);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Course list */}
        {!initialTransferMode && (
          <div className="flex-1 overflow-auto p-2 pb-3">
            {filteredRows.length === 0 ? (
                  <div className="px-6 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                    {query.trim()
                      ? `Nothing here matches “${query.trim()}”.`
                      : "Nothing matches those filters."}
                    <br />
                    It may not be running this year, or you may have taken it
                    elsewhere.
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => openCustomForm(query, false)}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-medium text-blue-800 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                      >
                        ＋ Add a custom course
                      </button>
                    </div>
                  </div>
                ) : (
                  filteredRows.map((course) => {
                    const check = evalPrereq(course.prerequisite_ast, completed);
                    const used = placed.has(course.code);
                    const academicBaseYear = startYear + (term.year - 1);
                    const isOfferedThisTerm = offeredIn(
                      course.code,
                      term.season,
                      offeringsMap,
                      customs,
                      { calendarYear: calYear, context: offeringContext },
                    );
                    const yearTerms = isOfferedThisTerm
                      ? []
                      : seasonsOf(course.code, offeringsMap, customs, {
                          academicBaseYear,
                          context: offeringContext,
                        });
                    const offered = isOfferedThisTerm
                      ? `Offered in ${term.season} ${calYear}`
                      : yearTerms.length > 0
                        ? `Offered in ${yearTerms.join(" · ")}`
                        : `Not offered in ${academicBaseYear}–${academicBaseYear + 1}`;

                    let missingText = "";
                    if (check === false) {
                      const missing = course.prerequisite_codes.filter(
                        (c) => !completed.has(c),
                      );
                      missingText = `needs ${missing.join(" / ") || "a prerequisite"}`;
                    }

                    return (
                      <div
                        key={course.code}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${
                          used ? "opacity-55" : ""
                        }`}
                      >
                        <span className="w-24 shrink-0 font-mono text-xs text-blue-800 dark:text-blue-300">
                          {course.code}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-zinc-900 dark:text-zinc-100">
                            {course.title}
                          </div>
                          <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                            {course.credit_hours} cr · {offered}{" "}
                            {check === false && (
                              <span className="text-amber-700 dark:text-amber-400">
                                · {missingText}
                              </span>
                            )}
                            {check === null && (
                              <span className="text-zinc-400">· conditions</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onPlaceCourse(
                              picker.termIndex,
                              picker.slotIndex,
                              course.code,
                            )
                          }
                          className="shrink-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:border-blue-500 hover:text-blue-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          {used ? "move here" : "add"}
                        </button>
                      </div>
                    );
                  })
                )}

                <div className="mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <span className="w-24 shrink-0 font-mono text-xs text-zinc-400">
                    —
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-zinc-900 dark:text-zinc-100">
                      Course not in the list?
                    </div>
                    <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                      Not offered this year, a transfer credit, or a summer
                      course — add it yourself.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCustomForm(query, false)}
                    className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:border-blue-500 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                  >
                    ＋ custom
                  </button>
                </div>
          </div>
        )}
      </div>
    </div>
  );
}
