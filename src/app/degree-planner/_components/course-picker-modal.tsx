"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  completedBefore,
  earnedCodes,
  evalPrereq,
  findBucket,
  matchesBucket,
  matchingBuckets,
  MAX_SLOTS_PER_TERM,
  normalizeCode,
  offeredIn,
  offeringOf,
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
  TransferKind,
} from "@/lib/degree-types";

function matchesCourseQuery(course: CatalogCourse, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (
    course.code.toLowerCase().includes(q) ||
    course.title.toLowerCase().includes(q)
  ) {
    return true;
  }
  const qCompact = q.replace(/\s+/g, "");
  return course.code.toLowerCase().replace(/\s+/g, "").includes(qCompact);
}

type CoursePickerModalProps = {
  picker: PickerState;
  initialTransferMode: boolean;
  terms: PlannerTerm[];
  model: RequirementModel | null;
  catalogCourses: CatalogCourse[];
  catalogMap: Map<string, CatalogCourse>;
  offeringsMap: Map<string, OfferingEntry>;
  offeringContext: OfferingContext;
  equivMap?: Map<string, Set<string>>;
  startYear: number;
  customs: Map<string, CustomCourse>;
  subjects: string[];
  subjectFaculty: Map<string, string | null>;
  onClose: () => void;
  onPlaceCourse: (termIndex: number, slotIndex: number, code: string) => void;
  onClearSlot?: (termIndex: number, slotIndex: number) => void;
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
  equivMap,
  startYear,
  customs,
  subjects,
  subjectFaculty,
  onClose,
  onPlaceCourse,
  onClearSlot,
  onSaveCustom,
  onToast,
}: CoursePickerModalProps) {
  const [query, setQuery] = useState(() => picker.initialQuery ?? "");
  const [selectedTermIndex, setSelectedTermIndex] = useState(
    () => picker.termIndex,
  );
  const [filterTerm, setFilterTerm] = useState(true);
  const [filterOffered, setFilterOffered] = useState(true);
  const [filterPrereq, setFilterPrereq] = useState(true);
  const [filterBucket, setFilterBucket] = useState(() =>
    Boolean(picker.bucketKey),
  );

  const [customOpen, setCustomOpen] = useState(false);
  const [cxCode, setCxCode] = useState("");
  const [cxTitle, setCxTitle] = useState("");
  const [cxCredits, setCxCredits] = useState("3");
  const [cxSubject, setCxSubject] = useState("");
  const [cxLevel, setCxLevel] = useState("1000");

  const [transferKind, setTransferKind] = useState<TransferKind>("general");
  const [txLevel, setTxLevel] = useState("1000");
  const [txCredits, setTxCredits] = useState("3");
  const [txNote, setTxNote] = useState("");
  const [txEquivQuery, setTxEquivQuery] = useState("");
  const [txEquivCourse, setTxEquivCourse] = useState<CatalogCourse | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const txEquivInputRef = useRef<HTMLInputElement>(null);

  const bucket = useMemo(
    () => (picker.bucketKey ? findBucket(model, picker.bucketKey) : null),
    [model, picker],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!initialTransferMode) searchInputRef.current?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [initialTransferMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && !initialTransferMode && !customOpen) {
        if (terms.length === 0) return;
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        const nextIdx =
          (selectedTermIndex + delta + terms.length) % terms.length;
        setSelectedTermIndex(nextIdx);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, initialTransferMode, customOpen, terms, selectedTermIndex]);

  const term = terms[selectedTermIndex] ?? terms[picker.termIndex];
  const activeSlotIndex = useMemo(() => {
    const t = terms[selectedTermIndex];
    if (!t) return 0;
    if (
      selectedTermIndex === picker.termIndex &&
      t.slots[picker.slotIndex] === null
    ) {
      return picker.slotIndex;
    }
    const emptyIdx = t.slots.indexOf(null);
    return emptyIdx >= 0 ? emptyIdx : t.slots.length;
  }, [selectedTermIndex, picker.termIndex, picker.slotIndex, terms]);
  const calYear = term
    ? termCalendarYear(startYear, term.year, term.season)
    : startYear;
  const academicBaseYear = term ? startYear + (term.year - 1) : startYear;

  const openCustomForm = (prefill = "") => {
    const cleanPrefill = /[a-z]/i.test(prefill)
      ? prefill.toUpperCase().trim()
      : "";
    setCxSubject("");
    setCxLevel("1000");
    setCxCode(cleanPrefill);
    setCxTitle("");
    setCxCredits("3");
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
      transfer: false,
    };
  }, [cxCode, cxTitle, cxCredits, cxSubject, cxLevel, subjectFaculty]);

  const equivCandidates = useMemo(() => {
    if (!initialTransferMode || transferKind !== "equivalent") return [];
    const list = txEquivQuery.trim()
      ? catalogCourses.filter((c) => matchesCourseQuery(c, txEquivQuery))
      : catalogCourses;
    return list.slice(0, 40);
  }, [initialTransferMode, transferKind, txEquivQuery, catalogCourses]);

  const transferDraft = useMemo<CustomCourse | null>(() => {
    const level = Number(txLevel) || 1000;
    const credits = Number(txCredits) || 0;
    if (transferKind === "general") {
      let idx = 1;
      let code = `TRCR-${level}-${idx}`;
      while (customs.has(code)) {
        idx += 1;
        code = `TRCR-${level}-${idx}`;
      }
      return {
        code,
        title: txNote.trim() || "General transfer credit",
        credit_hours: credits,
        subject: null,
        level,
        faculty: null,
        custom: true,
        transfer: true,
        transfer_kind: "general",
      };
    }
    if (!txEquivCourse) return null;
    return {
      code: txEquivCourse.code,
      title: txEquivCourse.title,
      credit_hours: credits,
      subject: txEquivCourse.subject || null,
      level,
      faculty: txEquivCourse.faculty ?? null,
      custom: true,
      transfer: true,
      transfer_kind: "equivalent",
      equivalent_code: txEquivCourse.code,
    };
  }, [transferKind, txLevel, txCredits, txNote, txEquivCourse, customs]);

  const transferHint = useMemo(() => {
    if (!transferDraft) {
      return {
        line1: "Search and select the equivalent Ontario Tech course.",
        buckets: [] as string[],
        isRequired: false,
      };
    }
    const isRequired = Boolean(
      transferDraft.transfer_kind === "equivalent" &&
        model?.required.some((r) => r.code === transferDraft.code),
    );
    const buckets = isRequired ? [] : matchingBuckets(transferDraft, model);
    return {
      line1: isRequired
        ? `Satisfies required course ${transferDraft.code} and its prerequisites.`
        : transferDraft.transfer_kind === "equivalent"
          ? `Satisfies ${transferDraft.code} (prerequisites & degree requirements).`
          : "Counts toward outside-Science and general electives without taking a term slot.",
      buckets,
      isRequired,
    };
  }, [transferDraft, model]);

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

  const placed = useMemo(() => earnedCodes(terms, customs), [terms, customs]);
  const completed = useMemo(
    () => completedBefore(terms, selectedTermIndex, equivMap, customs),
    [terms, selectedTermIndex, equivMap, customs],
  );

  const filteredRows = useMemo(() => {
    if (!term) return [];

    const inThisTerm = new Set(term.slots.filter((s): s is string => Boolean(s)));
    let rows = catalogCourses.filter((c) => !inThisTerm.has(c.code));
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
    if (query.trim()) {
      rows = rows.filter((c) => matchesCourseQuery(c, query));
    }
    if (filterPrereq) {
      rows = rows.filter(
        (c) =>
          evalPrereq(c.prerequisite_ast, completed, { termYear: term.year }) !==
          false,
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

  const handleAddCourse = (code: string) => {
    onPlaceCourse(selectedTermIndex, activeSlotIndex, code);
    setQuery("");
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

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
      termIndex: selectedTermIndex,
      slotIndex: activeSlotIndex,
    });
  };

  const handleSaveTransfer = () => {
    if (transferKind === "equivalent" && !txEquivCourse) {
      onToast("Pick an equivalent OTU course");
      txEquivInputRef.current?.focus();
      return;
    }
    if (!transferDraft || transferDraft.credit_hours <= 0) {
      onToast("How many credits is it worth?");
      return;
    }
    onSaveCustom(transferDraft, null);
  };

  const titleText = initialTransferMode
    ? "Add a transfer credit"
    : bucket
      ? `Add a course for “${bucket.label}”`
      : `Add a course — Year ${term.year} ${term.season}`;

  const subText = initialTransferMode
    ? "Credit earned elsewhere — counts toward your degree without taking a slot on the term map."
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
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
              {titleText}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {subText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!initialTransferMode && terms.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <span>Add to:</span>
                <select
                  value={selectedTermIndex}
                  onChange={(e) => setSelectedTermIndex(Number(e.target.value))}
                  aria-label="Target year and term"
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {terms.map((t, idx) => {
                    const usedCount = t.slots.filter(Boolean).length;
                    const isFull =
                      usedCount >= MAX_SLOTS_PER_TERM &&
                      idx !== picker.termIndex;
                    const yCal = termCalendarYear(startYear, t.year, t.season);
                    return (
                      <option
                        key={`${t.year}-${t.season}-${idx}`}
                        value={idx}
                        disabled={isFull}
                      >
                        Year {t.year} · {t.season} {yCal} ({usedCount}/
                        {MAX_SLOTS_PER_TERM}
                        {isFull ? " full" : ""})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-base text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              ×
            </button>
          </div>
        </div>

        {/* Search & filter chips */}
        {!initialTransferMode && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 py-2.5 dark:border-zinc-800">
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !customOpen &&
                  filteredRows.length > 0
                ) {
                  e.preventDefault();
                  handleAddCourse(filteredRows[0].code);
                }
              }}
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
              onClick={() => openCustomForm(query)}
              title="A course not listed in the timetable"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-blue-400 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              ＋ Custom course
            </button>
          </div>
        )}

        {/* Dedicated Transfer Credit panel */}
        {initialTransferMode && (
          <div className="flex flex-1 flex-col overflow-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTransferKind("general")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  transferKind === "general"
                    ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-400/20 dark:border-indigo-700 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-zinc-700"
                }`}
              >
                <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                  General transfer credit
                </div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                  No specific OTU equivalent · covers outside-Science and/or general electives
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTransferKind("equivalent");
                  setTimeout(() => txEquivInputRef.current?.focus(), 20);
                }}
                className={`rounded-xl border p-3 text-left transition-all ${
                  transferKind === "equivalent"
                    ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-400/20 dark:border-indigo-700 dark:bg-indigo-950/40"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-zinc-700"
                }`}
              >
                <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                  Equivalent OTU class
                </div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                  Matches a specific OTU course · satisfies core, prereqs, or electives
                </div>
              </button>
            </div>

            {transferKind === "equivalent" && (
              <div className="mt-3.5">
                {txEquivCourse ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5 dark:border-indigo-800/70 dark:bg-indigo-950/30">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          {txEquivCourse.code}
                        </span>
                        <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                          {txEquivCourse.title}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {[txEquivCourse.subject, txEquivCourse.faculty]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTxEquivCourse(null);
                        setTimeout(() => txEquivInputRef.current?.focus(), 20);
                      }}
                      className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className="flex flex-col gap-1 text-[11.5px] font-medium text-zinc-600 dark:text-zinc-400">
                      Equivalent OTU course
                      <input
                        ref={txEquivInputRef}
                        type="search"
                        value={txEquivQuery}
                        onChange={(e) => setTxEquivQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && equivCandidates.length > 0) {
                            e.preventDefault();
                            const first = equivCandidates[0];
                            setTxEquivCourse(first);
                            setTxCredits(String(first.credit_hours || 3));
                            if (first.level >= 1000 && first.level <= 4000) {
                              setTxLevel(String(first.level));
                            }
                          }
                        }}
                        placeholder="Search code or title (e.g. CSCI 1060U, MATH 1010U)…"
                        autoComplete="off"
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                    <div className="mt-1.5 max-h-48 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50/40 p-1 dark:border-zinc-800 dark:bg-zinc-950/40">
                      {equivCandidates.length === 0 ? (
                        <div className="py-5 text-center text-xs text-zinc-500">
                          No matching courses found.
                        </div>
                      ) : (
                        equivCandidates.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setTxEquivCourse(c);
                              setTxCredits(String(c.credit_hours || 3));
                              if (c.level >= 1000 && c.level <= 4000) {
                                setTxLevel(String(c.level));
                              }
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-white dark:hover:bg-zinc-800/70"
                          >
                            <span className="w-24 shrink-0 font-mono text-xs font-medium text-indigo-700 dark:text-indigo-300">
                              {c.code}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-200">
                              {c.title}
                            </span>
                            <span className="shrink-0 text-[11px] text-zinc-400">
                              {c.credit_hours} cr · {c.level}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Level
                <select
                  value={txLevel}
                  onChange={(e) => setTxLevel(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="1000">1000 level</option>
                  <option value="2000">2000 level</option>
                  <option value="3000">3000 level</option>
                  <option value="4000">4000 level</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">
                Credits
                <input
                  type="number"
                  min={0.5}
                  max={18}
                  step={0.5}
                  value={txCredits}
                  onChange={(e) => setTxCredits(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              {transferKind === "general" && (
                <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:col-span-2 dark:text-zinc-400">
                  Label (optional)
                  <input
                    value={txNote}
                    onChange={(e) => setTxNote(e.target.value)}
                    placeholder="General transfer credit"
                    autoComplete="off"
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </label>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
              <div>{transferHint.line1}</div>
              {transferHint.buckets.length > 0 && (
                <div className="mt-0.5">
                  Counts toward:{" "}
                  <strong className="text-indigo-700 dark:text-indigo-300">
                    {transferHint.buckets.join(", ")}
                  </strong>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSaveTransfer}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
              >
                Add transfer credit
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Custom course panel */}
        {!initialTransferMode && customOpen && (
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

            <div className="mt-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSaveCustom}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                Add to this term
              </button>
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
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
            {term.slots.map((code, sIdx) => {
              if (!code) return null;
              const cat = catalogMap.get(code);
              const cust = customs.get(code);
              const title = cat?.title ?? cust?.title ?? code;
              const cr = cat?.credit_hours ?? cust?.credit_hours ?? 3;
              if (query.trim()) {
                const q = query.trim().toLowerCase();
                const qCompact = q.replace(/\s+/g, "");
                const hit =
                  code.toLowerCase().includes(q) ||
                  code.toLowerCase().replace(/\s+/g, "").includes(qCompact) ||
                  title.toLowerCase().includes(q);
                if (!hit) return null;
              }
              return (
                <div
                  key={`added:${sIdx}:${code}`}
                  className="flex items-center gap-2.5 rounded-lg bg-blue-50/45 px-2.5 py-2 hover:bg-blue-50/80 dark:bg-blue-950/20 dark:hover:bg-blue-950/35"
                >
                  <span className="w-24 shrink-0 font-mono text-xs font-medium text-blue-800 dark:text-blue-300">
                    {code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-zinc-900 dark:text-zinc-100">
                      {title}
                    </div>
                    <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                      {cr} cr · Added to Year {term.year} {term.season}
                    </div>
                  </div>
                  {onClearSlot && (
                    <button
                      type="button"
                      onClick={() => onClearSlot(selectedTermIndex, sIdx)}
                      className="shrink-0 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs text-rose-600 hover:border-rose-400 hover:bg-rose-50 dark:border-rose-800/70 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      remove
                    </button>
                  )}
                </div>
              );
            })}
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
                        onClick={() => openCustomForm(query)}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-medium text-blue-800 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                      >
                        ＋ Add a custom course
                      </button>
                    </div>
                  </div>
                ) : (
                  filteredRows.map((course) => {
                    const check = evalPrereq(course.prerequisite_ast, completed, {
                      termYear: term.year,
                    });
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
                          onClick={() => handleAddCourse(course.code)}
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
                    onClick={() => openCustomForm(query)}
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
