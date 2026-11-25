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
  DegreeProgramDetail,
  DegreeSubject,
  OfferingContext,
  OfferingEntry,
  PickerState,
  PlannerTerm,
  ProgramSummary,
  RequirementModel,
  TransferKind,
} from "@/lib/degree-types";

function isGraduateProgram(
  program: ProgramSummary | DegreeProgramDetail | null | undefined,
): boolean {
  if (!program) return false;
  const credentialFields = [
    program.credential,
    program.degree,
    program.degree_abbrev,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /\b(master|masters|doctor|doctoral|ph\.?d|graduate|m\.?sc|m\.?eng|m\.?a\.?sc|m\.?ed|m\.?h\.?sc|mba)\b/i.test(
      credentialFields,
    )
  ) {
    return true;
  }
  return /\b(master of|doctor of|ph\.?d|graduate diploma|graduate certificate)\b/i.test(
    program.name,
  );
}

function isGraduateCourse(course: CatalogCourse): boolean {
  return course.level >= 5000 || /\d{4}G$/i.test(course.code);
}

function getCourseDisplayTitle(course: Pick<CatalogCourse, "code" | "title">): {
  title: string;
  isFallback: boolean;
} {
  const trimmedTitle = course.title.trim();
  const trimmedCode = course.code.trim();
  if (
    !trimmedTitle ||
    trimmedTitle.toLowerCase() === trimmedCode.toLowerCase()
  ) {
    return {
      title: "Catalog title unavailable (offering only)",
      isFallback: true,
    };
  }
  return { title: trimmedTitle, isFallback: false };
}

function coopVariantKey(course: Pick<CatalogCourse, "code" | "title">): string | null {
  const m = course.code.trim().match(/^([A-Z]{2,6})\s+(\d{4})([CWU])$/i);
  if (!m) return null;
  const titleKey = course.title.trim().toLowerCase();
  if (!titleKey || titleKey === course.code.trim().toLowerCase()) return null;
  return `${m[1].toUpperCase()}:${m[2]}:${titleKey}`;
}

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
  program?: ProgramSummary | DegreeProgramDetail | null;
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
  degreeSubjects?: DegreeSubject[];
  subjectFaculty: Map<string, string | null>;
  onClose: () => void;
  onPlaceCourse: (termIndex: number, slotIndex: number, code: string) => void;
  onClearSlot?: (termIndex: number, slotIndex: number) => void;
  onSaveCustom: (
    course: CustomCourse,
    target: { termIndex: number; slotIndex: number } | null,
  ) => void;
  onToast: (message: string) => void;
  sidebarSlot?: React.ReactNode;
  suppressEscape?: boolean;
  onSelectedTermChange?: (termIndex: number) => void;
};

export function CoursePickerModal({
  picker,
  initialTransferMode,
  program,
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
  degreeSubjects,
  subjectFaculty,
  onClose,
  onPlaceCourse,
  onClearSlot,
  onSaveCustom,
  onToast,
  sidebarSlot,
  suppressEscape = false,
  onSelectedTermChange,
}: CoursePickerModalProps) {
  const initialSubjectCode = (() => {
    const raw = picker.initialQuery?.trim().toUpperCase();
    if (raw && subjects.includes(raw)) return raw;
    return "";
  })();

  const [query, setQuery] = useState(() =>
    initialSubjectCode ? "" : (picker.initialQuery ?? ""),
  );
  const [subjectFilter, setSubjectFilter] = useState(initialSubjectCode);
  const [selectedTermIndex, setSelectedTermIndex] = useState(
    () => picker.termIndex,
  );
  const [filterTerm, setFilterTerm] = useState(() => !picker.bucketKey);
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
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const [mobilePane, setMobilePane] = useState<"picker" | "requirements">(
    "picker",
  );

  const bucket = useMemo(
    () => (picker.bucketKey ? findBucket(model, picker.bucketKey) : null),
    [model, picker],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        !initialTransferMode &&
        typeof window !== "undefined" &&
        window.innerWidth >= 640
      ) {
        searchInputRef.current?.focus();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [initialTransferMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyLeft = body.style.left;
    const prevBodyRight = body.style.right;
    const prevBodyWidth = body.style.width;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.left = prevBodyLeft;
      body.style.right = prevBodyRight;
      body.style.width = prevBodyWidth;
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (suppressEscape) return;
        onClose();
        return;
      }
      if (event.key === "Tab" && !initialTransferMode && !customOpen) {
        if (sidebarContainerRef.current?.contains(event.target as Node)) {
          return;
        }
        if (terms.length === 0) return;
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        const nextIdx =
          (selectedTermIndex + delta + terms.length) % terms.length;
        setSelectedTermIndex(nextIdx);
        onSelectedTermChange?.(nextIdx);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onClose,
    initialTransferMode,
    customOpen,
    terms,
    selectedTermIndex,
    suppressEscape,
    onSelectedTermChange,
  ]);

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
    setMobilePane("picker");
    setCxSubject(subjectFilter || "");
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

  const isUndergradProgram = useMemo(
    () => !isGraduateProgram(program),
    [program],
  );

  const visibleCatalogCourses = useMemo(
    () =>
      isUndergradProgram
        ? catalogCourses.filter((c) => !isGraduateCourse(c))
        : catalogCourses,
    [catalogCourses, isUndergradProgram],
  );

  // Unlinked co-op/work-term code transitions (e.g. SCCO 0999U -> SCCO 0999C)
  // have no `formerly_codes` link in catalog_courses; index active C/W successors.
  const coopSuccessorByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of visibleCatalogCourses) {
      if (!/[CW]$/i.test(c.code.trim())) continue;
      const key = coopVariantKey(c);
      if (key && !map.has(key)) {
        map.set(key, c.code);
      }
    }
    return map;
  }, [visibleCatalogCourses]);

  const equivCandidates = useMemo(() => {
    if (!initialTransferMode || transferKind !== "equivalent") return [];
    const deduped = visibleCatalogCourses.filter((c) => {
      if (!/U$/i.test(c.code.trim())) return true;
      const key = coopVariantKey(c);
      return !(key && coopSuccessorByKey.has(key));
    });
    const list = txEquivQuery.trim()
      ? deduped.filter((c) => matchesCourseQuery(c, txEquivQuery))
      : deduped;
    return list.slice(0, 40);
  }, [
    initialTransferMode,
    transferKind,
    txEquivQuery,
    visibleCatalogCourses,
    coopSuccessorByKey,
  ]);

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

  const subjectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of degreeSubjects ?? []) {
      if (s.code && s.name) map.set(s.code, s.name);
    }
    for (const c of catalogCourses) {
      if (c.subject && c.subject_name && !map.has(c.subject)) {
        map.set(c.subject, c.subject_name);
      }
    }
    return map;
  }, [degreeSubjects, catalogCourses]);

  const placed = useMemo(() => earnedCodes(terms, customs), [terms, customs]);
  const completed = useMemo(
    () => completedBefore(terms, selectedTermIndex, equivMap, customs),
    [terms, selectedTermIndex, equivMap, customs],
  );

  const baseRows = useMemo(() => {
    if (!term) return [];

    const inThisTerm = new Set(term.slots.filter((s): s is string => Boolean(s)));
    let rows = visibleCatalogCourses.filter((c) => !inThisTerm.has(c.code));
    if (filterOffered) {
      rows = rows.filter(
        (c) =>
          seasonsOf(c.code, offeringsMap, customs, {
            academicBaseYear,
            context: offeringContext,
          }).length > 0,
      );
    }

    if (filterTerm) {
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

    const rowCodes = new Set(rows.map((r) => r.code));
    rows = rows.filter((c) => {
      if (!/U$/i.test(c.code.trim()) || placed.has(c.code)) return true;
      const key = coopVariantKey(c);
      const successor = key ? coopSuccessorByKey.get(key) : undefined;
      if (!successor) return true;
      return !(
        placed.has(successor) ||
        rowCodes.has(successor) ||
        academicBaseYear >= 2026
      );
    });

    return rows;
  }, [
    term,
    visibleCatalogCourses,
    coopSuccessorByKey,
    placed,
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
  ]);

  const subjectOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of baseRows) {
      if (!c.subject) continue;
      counts.set(c.subject, (counts.get(c.subject) ?? 0) + 1);
    }
    const allCodes = new Set<string>([
      ...subjects,
      ...counts.keys(),
      ...(subjectFilter ? [subjectFilter] : []),
    ]);
    return [...allCodes]
      .map((code) => ({
        code,
        name: subjectNameMap.get(code) ?? code,
        count: counts.get(code) ?? 0,
      }))
      .sort((a, b) => {
        if ((a.count > 0) !== (b.count > 0)) return a.count > 0 ? -1 : 1;
        return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
      });
  }, [baseRows, subjects, subjectFilter, subjectNameMap]);

  const { filteredRows, totalMatchingCount } = useMemo(() => {
    if (!term) return { filteredRows: [] as CatalogCourse[], totalMatchingCount: 0 };

    const matching = subjectFilter
      ? baseRows.filter((c) => c.subject === subjectFilter)
      : baseRows;

    const targetLevel = term.year * 1000;
    const sorted = matching.slice().sort((a, b) => {
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
    });

    const visible =
      subjectFilter || query.trim() ? sorted : sorted.slice(0, 80);

    return {
      filteredRows: visible,
      totalMatchingCount: matching.length,
    };
  }, [
    term,
    baseRows,
    subjectFilter,
    query,
    offeringsMap,
    offeringContext,
    calYear,
    customs,
    placed,
  ]);

  if (!term) return null;

  const handleAddCourse = (code: string) => {
    const alreadyPlaced = placed.has(code);
    onPlaceCourse(selectedTermIndex, activeSlotIndex, code);
    if (activeSlotIndex < MAX_SLOTS_PER_TERM) {
      onToast(
        alreadyPlaced
          ? `Moved ${code} to Year ${term.year} ${term.season}`
          : `Added ${code} to Year ${term.year} ${term.season}`,
      );
    }
    setQuery("");
    if (typeof window !== "undefined" && window.innerWidth >= 640) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
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

  const pickerCardContent = (
    <>
        {/* Header */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle bg-surface-subtle/60 px-3.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3 sm:px-5 sm:py-3.5">
          <div className="flex items-start justify-between gap-2 sm:min-w-0 sm:flex-1">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-ink sm:text-[15px]">
                {titleText}
              </h3>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted sm:text-xs">
                {subText}
              </p>
            </div>
            {!sidebarSlot && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-lg px-2 py-1 text-base leading-none text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink sm:hidden"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            {!initialTransferMode && terms.length > 0 && (
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-secondary sm:flex-initial">
                <span className="shrink-0">Add to:</span>
                <span className="relative inline-flex min-w-0 flex-1 items-center sm:flex-initial">
                  <select
                    value={selectedTermIndex}
                    onChange={(e) => {
                      const nextIdx = Number(e.target.value);
                      setSelectedTermIndex(nextIdx);
                      onSelectedTermChange?.(nextIdx);
                    }}
                    aria-label="Target year and term"
                    className="w-full appearance-none rounded-lg border border-line bg-surface py-1.5 pr-8 pl-2.5 text-xs font-medium text-ink focus:border-accent focus:ring-2 focus:ring-focus focus:outline-none sm:w-auto sm:pl-3"
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
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-ink-muted"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m6 8 4 4 4-4"
                    />
                  </svg>
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`hidden rounded-lg px-2 py-1 text-base text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink ${
                sidebarSlot ? "lg:inline-flex" : "sm:inline-flex"
              }`}
            >
              ×
            </button>
          </div>
        </div>

        {/* Search, Subject Box & Filter Chips */}
        {!initialTransferMode && !customOpen && (
          <div className="shrink-0 space-y-2 border-b border-line-subtle px-3.5 py-2 sm:space-y-2.5 sm:px-5 sm:py-3">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
                placeholder="Search code or title"
                autoComplete="off"
                className="min-w-0 w-full rounded-lg border border-line bg-surface-subtle px-3 py-1.5 text-base text-ink placeholder:text-ink-muted focus:border-accent focus:bg-surface focus:ring-2 focus:ring-focus focus:outline-none sm:w-auto sm:min-w-[200px] sm:flex-1 sm:text-sm"
              />
              {[
                {
                  label: `Offered ${term.season} ${calYear}`,
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
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors sm:px-2.5 sm:text-xs ${
                    chip.active
                      ? "border-accent-line bg-accent-soft font-medium text-accent-ink"
                      : "border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
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
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors sm:px-2.5 sm:text-xs ${
                    filterBucket
                      ? "border-accent-line bg-accent-soft font-medium text-accent-ink"
                      : "border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
                  }`}
                >
                  Fits requirement
                </button>
              )}
              <button
                type="button"
                onClick={() => openCustomForm(query)}
                title="A course not listed in the timetable"
                className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-accent-line hover:text-accent-ink sm:px-2.5 sm:text-xs"
              >
                + Custom course
              </button>
            </div>

            {/* Dedicated Subject / Department Filter Box */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/75 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:px-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center justify-between gap-2 sm:contents">
                <span className="shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">
                  Only show subject:
                </span>
                <span className="text-[11px] text-slate-500 tabular-nums sm:order-3 sm:ml-auto dark:text-slate-400">
                  {filteredRows.length === totalMatchingCount
                    ? `${totalMatchingCount} ${totalMatchingCount === 1 ? "course" : "courses"} shown`
                    : `Showing ${filteredRows.length} of ${totalMatchingCount} courses`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:contents">
                <span className="relative inline-flex min-w-0 flex-1 items-center sm:min-w-[220px] sm:max-w-xs">
                  <select
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    aria-label="Only show courses from subject"
                    className={`w-full appearance-none rounded-xl border py-1.5 pr-8 pl-3 text-xs font-medium focus:outline-none ${
                      subjectFilter
                        ? "border-sky-300 bg-sky-50/80 text-sky-900 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-800 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    }`}
                  >
                    <option value="">
                      All subjects ({baseRows.length} courses)
                    </option>
                    {subjectOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.name === opt.code
                          ? `${opt.code} (${opt.count})`
                          : `${opt.name} (${opt.code}) · ${opt.count}`}
                      </option>
                    ))}
                  </select>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={`pointer-events-none absolute right-2.5 h-3.5 w-3.5 ${
                      subjectFilter
                        ? "text-sky-600 dark:text-sky-300"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m6 8 4 4 4-4"
                    />
                  </svg>
                </span>

                {subjectFilter && (
                  <button
                    type="button"
                    onClick={() => setSubjectFilter("")}
                    className="shrink-0 rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/50"
                  >
                    Show all subjects ×
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dedicated Transfer Credit panel */}
        {initialTransferMode && (
          <div className="flex flex-1 flex-col overflow-auto overscroll-contain px-3.5 py-3 phone-landscape:flex-none! phone-landscape:overflow-visible! sm:px-5 sm:py-4">
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
                  (() => {
                    const { title: equivTitle, isFallback: isEquivFallback } =
                      getCourseDisplayTitle(txEquivCourse);
                    return (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5 dark:border-indigo-800/70 dark:bg-indigo-950/30">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          {txEquivCourse.code}
                        </span>
                        <span
                          className={`truncate text-[13px] font-medium ${
                            isEquivFallback
                              ? "italic text-zinc-500 dark:text-zinc-400"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {equivTitle}
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
                    );
                  })()
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
                        equivCandidates.map((c) => {
                          const { title: rowTitle, isFallback: isRowFallback } =
                            getCourseDisplayTitle(c);
                          return (
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
                            <span
                              className={`min-w-0 flex-1 truncate text-[12.5px] ${
                                isRowFallback
                                  ? "italic text-zinc-500 dark:text-zinc-400"
                                  : "text-zinc-800 dark:text-zinc-200"
                              }`}
                            >
                              {rowTitle}
                            </span>
                            <span className="shrink-0 text-[11px] text-zinc-400">
                              {c.credit_hours} cr · {c.level}
                            </span>
                          </button>
                          );
                        })
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50/70 px-3.5 py-3 phone-landscape:flex-none! phone-landscape:overflow-visible! sm:px-5 sm:py-4 dark:bg-zinc-950/60">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h4 className="text-[11.5px] font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                Custom course
              </h4>
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                ← Back to list
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <label className="col-span-2 flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:col-span-1 dark:text-zinc-400">
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
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-base text-zinc-900 focus:border-blue-500 focus:outline-none sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:col-span-1 dark:text-zinc-400">
                Title
                <input
                  value={cxTitle}
                  onChange={(e) => setCxTitle(e.target.value)}
                  placeholder="Machine Learning II"
                  autoComplete="off"
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-base text-zinc-900 focus:border-blue-500 focus:outline-none sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-base text-zinc-900 focus:border-blue-500 focus:outline-none sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:order-5 dark:text-zinc-400">
                Level
                <select
                  value={cxLevel}
                  onChange={(e) => setCxLevel(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-base text-zinc-900 focus:border-blue-500 focus:outline-none sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="1000">1000</option>
                  <option value="2000">2000</option>
                  <option value="3000">3000</option>
                  <option value="4000">4000</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:order-4 sm:col-span-1 dark:text-zinc-400">
                Subject (drives what it counts for)
                <select
                  value={cxSubject}
                  onChange={(e) => setCxSubject(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-base text-zinc-900 focus:border-blue-500 focus:outline-none sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="">— pick a subject —</option>
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11.5px] text-zinc-600 sm:order-6 sm:col-span-1 dark:text-zinc-400">
                Faculty (from subject)
                <input
                  readOnly
                  tabIndex={-1}
                  value={customDraft.faculty || "—"}
                  className="rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-500 sm:text-[13px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
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
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 sm:py-1.5"
              >
                Add to this term
              </button>
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 hover:border-zinc-300 sm:py-1.5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Course list */}
        {!initialTransferMode && !customOpen && (
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5 pb-3 phone-landscape:flex-none! phone-landscape:overflow-visible! sm:p-2 sm:pb-3">
            {term.slots.map((code, sIdx) => {
              if (!code) return null;
              const cat = catalogMap.get(code);
              const cust = customs.get(code);
              const titleInfo = cat
                ? getCourseDisplayTitle(cat)
                : { title: cust?.title ?? code, isFallback: false };
              const title = titleInfo.title;
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
                  className="flex items-center gap-2 rounded-lg bg-blue-50/45 px-2 py-1.5 hover:bg-blue-50/80 sm:gap-2.5 sm:px-2.5 sm:py-2 dark:bg-blue-950/20 dark:hover:bg-blue-950/35"
                >
                  <span className="w-20 shrink-0 font-mono text-xs font-medium text-blue-800 sm:w-24 dark:text-blue-300">
                    {code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[13px] ${
                        titleInfo.isFallback
                          ? "italic text-zinc-500 dark:text-zinc-400"
                          : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
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
                  <div className="px-6 py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
                    {query.trim()
                      ? `Nothing here matches “${query.trim()}”${subjectFilter ? ` in ${subjectNameMap.get(subjectFilter) ?? subjectFilter}` : ""}.`
                      : subjectFilter
                        ? `No ${subjectNameMap.get(subjectFilter) ?? subjectFilter} (${subjectFilter}) courses match those filters.`
                        : "Nothing matches those filters."}
                    <br />
                    Try turning off &ldquo;Prereqs met&rdquo; or &ldquo;Offered {term.season} {calYear}&rdquo;, or add a custom course.
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {filterPrereq && (
                        <button
                          type="button"
                          onClick={() => setFilterPrereq(false)}
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        >
                          Show courses with unmet prereqs
                        </button>
                      )}
                      {filterTerm && (
                        <button
                          type="button"
                          onClick={() => setFilterTerm(false)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        >
                          Show all terms
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openCustomForm(query)}
                        className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-1.5 text-xs font-medium text-sky-800 hover:border-sky-400 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
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

                    const { title: displayTitle, isFallback: isTitleFallback } =
                      getCourseDisplayTitle(course);

                    return (
                      <div
                        key={course.code}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 sm:gap-2.5 sm:px-2.5 sm:py-2 dark:hover:bg-zinc-800/60 ${
                          used ? "opacity-55" : ""
                        }`}
                      >
                        <span className="w-20 shrink-0 font-mono text-xs text-blue-800 sm:w-24 dark:text-blue-300">
                          {course.code}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate text-[13px] ${
                              isTitleFallback
                                ? "italic text-zinc-500 dark:text-zinc-400"
                                : "text-zinc-900 dark:text-zinc-100"
                            }`}
                          >
                            {displayTitle}
                          </div>
                          <div className="text-[11px] text-zinc-500 sm:text-[11.5px] dark:text-zinc-400">
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

                <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 sm:gap-2.5 sm:px-2.5 sm:py-2 dark:hover:bg-zinc-800/60">
                  <span className="w-20 shrink-0 font-mono text-xs text-zinc-400 sm:w-24">
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
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center overscroll-contain bg-[#0b1018]/55 px-2 pt-[calc(var(--site-nav-height,2.75rem)+0.5rem)] pb-[calc(var(--site-footer-height,2.5rem)+0.5rem)] backdrop-blur-sm phone-landscape:px-2.5! phone-landscape:pt-[calc(var(--site-nav-height,2.75rem)+0.35rem)]! phone-landscape:pb-[0.35rem]! sm:px-5 sm:pt-[calc(var(--site-nav-height,2.75rem)+3vh)] sm:pb-[3vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {sidebarSlot ? (
        <div
          className="flex h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2.5rem)-1rem)] w-full max-w-[1240px] flex-col gap-2 phone-landscape:h-[calc(100dvh-var(--site-nav-height,2.75rem)-0.75rem)]! phone-landscape:gap-1.5! sm:h-[calc(100dvh-var(--site-nav-height,2.75rem)-6vh)] sm:gap-3 lg:flex-row lg:items-stretch lg:gap-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-[var(--shadow-sm)]">
              <button
                type="button"
                onClick={() => {
                  setMobilePane("picker");
                  setCustomOpen(false);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  mobilePane === "picker"
                    ? "bg-brand text-brand-fg shadow-2xs"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Add course
              </button>
              <button
                type="button"
                onClick={() => setMobilePane("requirements")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  mobilePane === "requirements"
                    ? "bg-brand text-brand-fg shadow-2xs"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                What you need
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex w-10 shrink-0 self-stretch items-center justify-center rounded-xl border border-line bg-surface/95 text-lg leading-none text-ink-muted shadow-[var(--shadow-sm)] transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              ×
            </button>
          </div>

          <div
            className={`${
              mobilePane === "picker" ? "flex" : "hidden lg:flex"
            } min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] phone-landscape:overflow-y-auto! phone-landscape:overscroll-contain`}
          >
            {pickerCardContent}
          </div>

          <div
            ref={sidebarContainerRef}
            className={`${
              mobilePane === "requirements" ? "flex" : "hidden lg:flex"
            } min-h-0 w-full flex-1 flex-col lg:w-[390px] lg:flex-none xl:w-[410px]`}
          >
            {sidebarSlot}
          </div>
        </div>
      ) : (
        <div className="flex max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-var(--site-footer-height,2.5rem)-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] phone-landscape:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-0.75rem)]! phone-landscape:overflow-y-auto! phone-landscape:overscroll-contain sm:max-h-[calc(100dvh-var(--site-nav-height,2.75rem)-6vh)]">
          {pickerCardContent}
        </div>
      )}
    </div>
  );
}
