import type {
  CatalogCourse,
  ChooseGroup,
  CourseOffering,
  CustomCourse,
  DegreeProgramDetail,
  ElectiveBucket,
  ElectiveMatch,
  OfferingContext,
  OfferingEntry,
  PlannerTerm,
  PrereqAstNode,
  PrereqFlag,
  ProgramItemNode,
  RequirementModel,
  TermSeason,
  UnscheduledItem,
} from "@/lib/degree-types";

export const STORE_PREFIX = "otu-plan-v3:";
export const SLOTS_PER_TERM = 5;
export const MAX_SLOTS_PER_TERM = 8;
export const CREDIT_CAP = 15;

/**
 * Ensures a term has at least SLOTS_PER_TERM (5) slots and at most
 * MAX_SLOTS_PER_TERM (8) slots, trimming trailing empty slots beyond 5.
 */
export function normalizeTermSlots(
  slots: (string | null)[],
): (string | null)[] {
  const next = slots.slice(0, MAX_SLOTS_PER_TERM);
  while (next.length > SLOTS_PER_TERM && next[next.length - 1] === null) {
    next.pop();
  }
  while (next.length < SLOTS_PER_TERM) {
    next.push(null);
  }
  return next;
}
export const DEFAULT_START_YEAR = 2026;
export const MIN_START_YEAR = 2008;
export const MAX_START_YEAR = 2027;

export function parseTermDesc(
  termDesc: string,
): { season: TermSeason; calendarYear: number } | null {
  const yearMatch = termDesc.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const calendarYear = Number(yearMatch[1]);
  const lower = termDesc.toLowerCase();
  if (lower.includes("fall")) return { season: "Fall", calendarYear };
  if (lower.includes("winter")) return { season: "Winter", calendarYear };
  if (lower.includes("summer")) return { season: "Summer", calendarYear };
  return null;
}

export function termKey(season: TermSeason, calendarYear: number): string {
  return `${season}:${calendarYear}`;
}

export function termCalendarYear(
  startYear: number,
  academicYear: number,
  season: TermSeason,
): number {
  const base = startYear + (academicYear - 1);
  return season === "Fall" ? base : base + 1;
}

export function compactCourseKey(code: string | null | undefined): string {
  return String(code ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function normalizeCode(raw: string): string {
  const flat = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const parts = flat.match(/^([A-Z]{2,6})(\d.*)$/);
  return parts ? `${parts[1]} ${parts[2]}` : flat;
}

function extractTermKeys(terms: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const raw of terms) {
    const parsed = parseTermDesc(raw);
    if (parsed) {
      keys.add(termKey(parsed.season, parsed.calendarYear));
    }
  }
  return keys;
}

export function buildOfferingContext(
  offerings: CourseOffering[],
  courses: CatalogCourse[],
): OfferingContext {
  const knownTermKeys = new Set<string>();
  let minCalendarYear = MAX_START_YEAR;
  let maxCalendarYear = MIN_START_YEAR;

  const scan = (terms: Iterable<string>) => {
    for (const raw of terms) {
      const parsed = parseTermDesc(raw);
      if (!parsed) continue;
      knownTermKeys.add(termKey(parsed.season, parsed.calendarYear));
      if (parsed.calendarYear < minCalendarYear) minCalendarYear = parsed.calendarYear;
      if (parsed.calendarYear > maxCalendarYear) maxCalendarYear = parsed.calendarYear;
    }
  };

  for (const row of offerings) scan(row.terms);
  if (knownTermKeys.size === 0) {
    for (const course of courses) scan(course.terms_offered);
  }

  return { knownTermKeys, minCalendarYear, maxCalendarYear };
}

export function buildOfferingsMap(
  offerings: CourseOffering[],
  courses: CatalogCourse[],
): Map<string, OfferingEntry> {
  const map = new Map<string, OfferingEntry>();

  for (const row of offerings) {
    if (!row.subject_course) continue;
    map.set(row.subject_course, {
      terms: new Set(row.terms),
      termKeys: extractTermKeys(row.terms),
      sections: row.sections,
      credits: row.credit_hours,
    });
  }

  // Fallback to terms_offered baked into catalog_courses if offerings view is empty
  if (map.size === 0) {
    for (const course of courses) {
      if (!course.terms_offered.length) continue;
      map.set(compactCourseKey(course.code), {
        terms: new Set(course.terms_offered),
        termKeys: extractTermKeys(course.terms_offered),
        sections: course.sections_in_offerings,
        credits: course.credit_hours,
      });
    }
  }

  return map;
}

export function offeringOf(
  code: string,
  offeringsMap: Map<string, OfferingEntry>,
): OfferingEntry | null {
  return offeringsMap.get(compactCourseKey(code)) ?? null;
}

export function isOffered(
  code: string,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
): boolean {
  if (customs.has(code)) return true;
  const entry = offeringOf(code, offeringsMap);
  return Boolean(entry && entry.terms.size > 0);
}

export function offeredIn(
  code: string,
  season: TermSeason,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  options?: {
    calendarYear?: number;
    context?: OfferingContext;
  },
): boolean {
  if (customs.has(code)) return true;
  const entry = offeringOf(code, offeringsMap);
  if (!entry || !entry.terms.size) return false;

  if (options?.calendarYear !== undefined && options?.context) {
    const key = termKey(season, options.calendarYear);
    if (options.context.knownTermKeys.has(key)) {
      return entry.termKeys.has(key);
    }
    // Future term not yet in the database: check recent 2 years for that season
    const recentCutoff = options.context.maxCalendarYear - 2;
    for (const k of entry.termKeys) {
      const [kSeason, kYearStr] = k.split(":");
      if (kSeason === season && Number(kYearStr) >= recentCutoff) return true;
    }
    return false;
  }

  if (season === "Summer") return false;
  const needle = season.toLowerCase();
  for (const term of entry.terms) {
    if (term.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function seasonsOf(
  code: string,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  options?: {
    academicBaseYear?: number;
    context?: OfferingContext;
  },
): string[] {
  if (customs.has(code)) return ["custom"];
  const entry = offeringOf(code, offeringsMap);
  if (!entry) return [];

  if (options?.academicBaseYear !== undefined) {
    const base = options.academicBaseYear;
    const checks: [TermSeason, number][] = [
      ["Fall", base],
      ["Winter", base + 1],
      ["Summer", base + 1],
    ];
    return checks
      .filter(([season, calYear]) =>
        offeredIn(code, season, offeringsMap, customs, {
          calendarYear: calYear,
          context: options.context,
        }),
      )
      .map(([season, calYear]) => `${season} ${calYear}`);
  }

  return [...entry.terms];
}

export function courseOf(
  code: string,
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
): CatalogCourse | CustomCourse | null {
  return customs.get(code) ?? catalogMap.get(code) ?? null;
}

export function creditsOf(
  code: string,
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
): number {
  const course = courseOf(code, catalogMap, customs);
  return course ? Number(course.credit_hours) || 0 : 0;
}

export function placedTermIndex(terms: PlannerTerm[], code: string): number {
  for (let i = 0; i < terms.length; i++) {
    if (terms[i].slots.includes(code)) return i;
  }
  return -1;
}

export function placedCodes(terms: PlannerTerm[]): Set<string> {
  const set = new Set<string>();
  for (const term of terms) {
    for (const code of term.slots) {
      if (code) set.add(code);
    }
  }
  return set;
}

export function completedBefore(
  terms: PlannerTerm[],
  termIndex: number,
): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < termIndex; i++) {
    for (const code of terms[i].slots) {
      if (code) set.add(code);
    }
  }
  return set;
}

export function evalPrereq(
  node: PrereqAstNode | null | undefined,
  completed: Set<string>,
): boolean | null {
  if (!node) return true;
  if (node.type === "course") return completed.has(node.code);
  if (node.type === "condition") return null;
  if (node.type === "and") {
    let unknown = false;
    for (const item of node.items) {
      const res = evalPrereq(item, completed);
      if (res === false) return false;
      if (res === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (node.type === "or") {
    let unknown = false;
    for (const item of node.items) {
      const res = evalPrereq(item, completed);
      if (res === true) return true;
      if (res === null) unknown = true;
    }
    return unknown ? null : false;
  }
  return null;
}

export function prereqFlag(
  code: string,
  termIndex: number,
  terms: PlannerTerm[],
  catalogMap: Map<string, CatalogCourse>,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  options?: {
    startYear?: number;
    context?: OfferingContext;
  },
): PrereqFlag | null {
  const term = terms[termIndex];
  const startYear = options?.startYear ?? DEFAULT_START_YEAR;
  if (term) {
    const calYear = termCalendarYear(startYear, term.year, term.season);
    const shouldCheckOfferings =
      term.season !== "Summer" ||
      Boolean(options?.context?.knownTermKeys.has(termKey("Summer", calYear)));
    if (shouldCheckOfferings) {
      if (!isOffered(code, offeringsMap, customs)) {
        return {
          cls: "bad",
          icon: "⚠",
          title: "No recorded offerings in the course database",
        };
      }
      if (
        !offeredIn(code, term.season, offeringsMap, customs, {
          calendarYear: calYear,
          context: options?.context,
        })
      ) {
        return {
          cls: "bad",
          icon: "⚠",
          title: `Not offered in ${term.season} ${calYear}`,
        };
      }
    }
  }

  const course = courseOf(code, catalogMap, customs);
  if (!course || "custom" in course) return null;

  const ast = course.prerequisite_ast;
  if (!ast) return null;

  const completed = completedBefore(terms, termIndex);
  const result = evalPrereq(ast, completed);
  if (result === true) return null;
  if (result === null) {
    return {
      cls: "unknown",
      icon: "i",
      title: "Has conditions a planner can't verify",
    };
  }

  const missing = (course.prerequisite_codes ?? []).filter(
    (dep) => !completed.has(dep),
  );
  return {
    kind: "prereq",
    cls: "bad",
    icon: "⚠",
    title: missing.length
      ? `Needs ${missing.join(" / ")} from an earlier term`
      : "Prerequisite not met by an earlier term",
  };
}

function firstCode(node: ProgramItemNode | undefined): string | null {
  if (!node) return null;
  if (node.type === "course" || node.type === "course_set") {
    return node.courses?.[0]?.code ?? null;
  }
  if (node.type === "any_of") return firstCode(node.options?.[0]);
  return null;
}

function nodeCodes(node: ProgramItemNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === "course" || node.type === "course_set") {
    for (const c of node.courses ?? []) {
      if (c.code) out.push(c.code);
    }
  } else if (node.type === "any_of") {
    for (const opt of node.options ?? []) nodeCodes(opt, out);
  }
  return out;
}

type RequirementShape =
  | { kind: "required"; code: string; codes?: undefined }
  | { kind: "required"; codes: string[]; code?: undefined }
  | { kind: "choose"; takes: number; options: string[]; label: string }
  | { kind: "none" };

export function requirementShape(item: ProgramItemNode | undefined): RequirementShape {
  if (!item) return { kind: "none" };
  if (item.type === "course") {
    const code = item.courses?.[0]?.code;
    return code ? { kind: "required", code } : { kind: "none" };
  }
  if (item.type === "course_set") {
    const codes = (item.courses ?? []).map((c) => c.code).filter(Boolean);
    if (item.join !== "or") {
      return codes.length ? { kind: "required", codes } : { kind: "none" };
    }
    if (!codes.length) return { kind: "none" };
    if (codes.length === 1) return { kind: "required", code: codes[0] };
    return { kind: "choose", takes: 1, options: codes, label: "Choose one" };
  }
  if (item.type === "any_of") {
    const takes = item.required || 1;
    const options = nodeCodes(item);
    if (!options.length) return { kind: "none" };
    if (options.length <= takes) return { kind: "required", code: options[0] };
    return { kind: "choose", takes, options, label: `Choose ${takes}` };
  }
  return { kind: "none" };
}

function orderWithinYear(
  codes: (string | null)[],
  catalogMap: Map<string, CatalogCourse>,
): (string | null)[] {
  const present = new Set(codes.filter((c): c is string => Boolean(c)));
  const done = new Set<string>();
  let remaining = codes.slice();
  const out: (string | null)[] = [];
  let guard = 0;

  while (remaining.length && guard++ < 200) {
    const next: (string | null)[] = [];
    let progressed = false;
    for (const code of remaining) {
      if (!code) {
        out.push(null);
        progressed = true;
        continue;
      }
      const course = catalogMap.get(code);
      const deps = course?.prerequisite_codes ?? [];
      const blockers = deps.filter((d) => present.has(d) && !done.has(d));
      if (blockers.length) {
        next.push(code);
        continue;
      }
      out.push(code);
      done.add(code);
      progressed = true;
    }
    remaining = next;
    if (!progressed) break;
  }

  return out.concat(remaining);
}

function distributeYear(
  codes: (string | null)[],
  ownTerms: PlannerTerm[],
  catalogMap: Map<string, CatalogCourse>,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  unscheduled: UnscheduledItem[],
  startYear: number,
  context?: OfferingContext,
): (string | null)[] {
  const present = new Set(codes.filter((c): c is string => Boolean(c)));
  const termOf = new Map<string, number>();
  const remaining: (string | null)[] = [];
  const calStart = ownTerms[0]
    ? startYear + (ownTerms[0].year - 1)
    : startYear;

  for (const code of codes) {
    if (
      code &&
      !isOffered(code, offeringsMap, customs) &&
      offeringsMap.size > 0
    ) {
      unscheduled.push({
        code,
        reason: `not offered in ${calStart}–${calStart + 1}`,
      });
      continue;
    }
    remaining.push(code);
  }

  for (let t = 0; t < ownTerms.length; t++) {
    const term = ownTerms[t];
    const calYear = termCalendarYear(startYear, term.year, term.season);
    while (term.slots.length < SLOTS_PER_TERM && remaining.length) {
      const eligible: { index: number; code: string | null }[] = [];
      remaining.forEach((code, index) => {
        if (!code) {
          eligible.push({ index, code });
          return;
        }
        if (
          offeringsMap.size > 0 &&
          !offeredIn(code, term.season, offeringsMap, customs, {
            calendarYear: calYear,
            context,
          })
        ) {
          return;
        }
        const deps = catalogMap.get(code)?.prerequisite_codes ?? [];
        const ok = deps.every(
          (d) => !present.has(d) || (termOf.has(d) && (termOf.get(d) ?? 0) < t),
        );
        if (ok) eligible.push({ index, code });
      });

      if (!eligible.length) break;
      const pick = eligible.find((e) => e.code !== null) ?? eligible[0];
      remaining.splice(pick.index, 1);
      term.slots.push(pick.code);
      if (pick.code) termOf.set(pick.code, t);
    }
  }

  return remaining;
}

export function buildDefaultPlan(
  program: DegreeProgramDetail,
  catalogMap: Map<string, CatalogCourse>,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  options?: {
    startYear?: number;
    gapYears?: number[];
    context?: OfferingContext;
  },
): { terms: PlannerTerm[]; unscheduled: UnscheduledItem[] } {
  const startYear = options?.startYear ?? DEFAULT_START_YEAR;
  const gapSet = new Set(options?.gapYears ?? []);
  const context = options?.context;

  const unscheduled: UnscheduledItem[] = [];
  const terms: PlannerTerm[] = [];
  const studyToAcademicYear = new Map<number, number>();
  let academicYear = 1;
  for (let studyYear = 1; studyYear <= 4; studyYear++) {
    while (gapSet.has(academicYear)) {
      academicYear++;
    }
    studyToAcademicYear.set(studyYear, academicYear);
    terms.push({ label: "Fall", season: "Fall", year: academicYear, slots: [] });
    terms.push({ label: "Winter", season: "Winter", year: academicYear, slots: [] });
    academicYear++;
  }

  const plan = new Map<number, (string | null)[]>();
  const push = (year: number, code: string | null) => {
    const list = plan.get(year) ?? [];
    list.push(code);
    plan.set(year, list);
  };

  const yearSections = program.sections.filter(
    (s) => /^year\s*\d/i.test(s.title || "") && s.groups.length > 0,
  );

  if (yearSections.length > 0) {
    for (const section of yearSections) {
      const match = (section.title || "").match(/^year\s*(\d+)/i);
      const year = Number(match?.[1] ?? 1) || 1;
      for (const group of section.groups) {
        if (group.kind === "choose") {
          const takes = group.required || 1;
          for (let i = 0; i < takes; i++) push(year, null);
          continue;
        }
        for (const item of group.items) {
          if (item.type === "elective") {
            const count =
              item.count || Math.round((item.credit_hours || 0) / 3) || 1;
            for (let i = 0; i < count; i++) push(year, null);
            continue;
          }
          const shape = requirementShape(item);
          if (shape.kind === "required") {
            if (shape.code) push(year, shape.code);
            for (const code of shape.codes ?? []) push(year, code);
          } else if (shape.kind === "choose") {
            for (let i = 0; i < shape.takes; i++) push(year, null);
          }
        }
      }
    }
  } else {
    const codes: (string | null)[] = [];
    for (const section of program.sections) {
      if (section.role !== "requirements" || section.is_alternative_track) {
        continue;
      }
      for (const group of section.groups) {
        if (group.kind === "choose") {
          for (let i = 0; i < (group.required || 1); i++) codes.push(null);
          continue;
        }
        for (const item of group.items) {
          if (item.type === "elective") {
            const count =
              item.count || Math.round((item.credit_hours || 0) / 3) || 1;
            for (let i = 0; i < count; i++) codes.push(null);
            continue;
          }
          const shape = requirementShape(item);
          if (shape.kind === "required") {
            if (shape.code) codes.push(shape.code);
            for (const code of shape.codes ?? []) codes.push(code);
          } else if (shape.kind === "choose") {
            for (let i = 0; i < shape.takes; i++) codes.push(null);
          }
        }
      }
    }
    codes.forEach((code, index) =>
      push(Math.min(4, Math.floor(index / 10) + 1), code),
    );
  }

  let carry: (string | null)[] = [];
  for (let studyYear = 1; studyYear <= 4; studyYear++) {
    const targetAcademicYear = studyToAcademicYear.get(studyYear) ?? studyYear;
    const codes = (plan.get(studyYear) ?? []).slice();
    carry = distributeYear(
      orderWithinYear(carry.concat(codes), catalogMap),
      terms.filter((t) => t.year === targetAcademicYear),
      catalogMap,
      offeringsMap,
      customs,
      unscheduled,
      startYear,
      context,
    );
  }

  if (carry.some(Boolean)) {
    const placedAt = new Map<string, number>();
    terms.forEach((term, index) => {
      for (const code of term.slots) {
        if (code && !placedAt.has(code)) placedAt.set(code, index);
      }
    });

    const stillLeft: (string | null)[] = [];
    for (const code of carry) {
      if (!code) continue;
      let done = false;
      for (let index = 0; index < terms.length && !done; index++) {
        const term = terms[index];
        if (term.season === "Summer") continue;
        const calYear = termCalendarYear(startYear, term.year, term.season);
        if (
          !offeredIn(code, term.season, offeringsMap, customs, {
            calendarYear: calYear,
            context,
          })
        ) {
          continue;
        }
        const slot =
          term.slots.length < SLOTS_PER_TERM
            ? term.slots.length
            : term.slots.indexOf(null);
        if (slot === -1) continue;
        const deps = catalogMap.get(code)?.prerequisite_codes ?? [];
        if (
          !deps.every(
            (d) => !placedAt.has(d) || (placedAt.get(d) ?? 0) < index,
          )
        ) {
          continue;
        }
        if (slot === term.slots.length) term.slots.push(code);
        else term.slots[slot] = code;
        if (!placedAt.has(code)) placedAt.set(code, index);
        done = true;
      }
      if (!done) stillLeft.push(code);
    }
    carry = stillLeft;
  }

  for (const code of carry) {
    if (!code) continue;
    unscheduled.push({
      code,
      reason: "could not be fitted into a 4-year, 5-course-per-term grid",
    });
  }

  for (const term of terms) {
    while (term.slots.length < SLOTS_PER_TERM) term.slots.push(null);
  }

  return { terms, unscheduled };
}

export function matchesBucket(
  course: CatalogCourse | CustomCourse | null | undefined,
  match: ElectiveMatch | null | undefined,
): boolean {
  if (!course || !match) return true;
  if (match.subjects && !match.subjects.includes(course.subject ?? "")) {
    return false;
  }
  if ((match.exclude_subjects ?? []).includes(course.subject ?? "")) {
    return false;
  }
  const faculty = course.faculty ?? null;
  if (
    (match.faculties ?? []).length > 0 &&
    (!faculty || !(match.faculties ?? []).includes(faculty))
  ) {
    return false;
  }
  if (faculty && (match.exclude_faculties ?? []).includes(faculty)) {
    return false;
  }
  const level = course.level || 0;
  if (match.min_level && level < match.min_level) return false;
  if (match.max_level && level > match.max_level) return false;
  return true;
}

export function buildModel(program: DegreeProgramDetail): RequirementModel {
  const required = new Map<string, { code: string }>();
  const chooseGroups: ChooseGroup[] = [];
  const buckets = new Map<string, ElectiveBucket>();
  const breadth = new Map<string, ElectiveBucket>();
  const seenChoose = new Set<string>();

  const addBucket = (
    store: Map<string, ElectiveBucket>,
    item: Extract<ProgramItemNode, { type: "elective" }>,
  ) => {
    const match = item.match ?? {};
    const key = JSON.stringify([
      match.subjects,
      match.exclude_subjects,
      match.faculties,
      match.exclude_faculties,
      match.min_level,
      match.max_level,
    ]);
    const bucket: ElectiveBucket = store.get(key) ?? {
      key,
      label: match.label || "Elective",
      match,
      credits: 0,
      sources: [],
      subs: [],
    };
    bucket.credits += item.credit_hours || 0;
    if (item.text) bucket.sources.push(item.text);
    for (const sub of item.sub_requirements ?? []) {
      const skey = JSON.stringify([
        sub.match.subjects,
        sub.match.exclude_subjects,
        sub.match.faculties,
        sub.match.exclude_faculties,
        sub.match.min_level,
        sub.match.max_level,
      ]);
      if (!bucket.subs.some((s) => s.key === skey)) {
        bucket.subs.push({
          key: skey,
          label: sub.match.label || sub.text || "Sub-requirement",
          credits: sub.credits,
          match: sub.match,
        });
      }
    }
    store.set(key, bucket);
  };

  for (const section of program.sections) {
    if (section.role === "info" || section.is_alternative_track) continue;
    for (const group of section.groups ?? []) {
      if (group.kind === "pool") {
        for (const item of group.items) {
          if (item.type === "elective") addBucket(breadth, item);
        }
        continue;
      }
      if (group.kind === "choose") {
        const key = `${group.required || 1}:${group.items.map(firstCode).join("|")}`;
        if (seenChoose.has(key)) continue;
        const options = group.items.flatMap((item) => nodeCodes(item));
        if (!options.length) continue;
        seenChoose.add(key);
        chooseGroups.push({
          id: group.group_id,
          required: group.required || 1,
          options,
          label: group.label || `Choose ${group.required || 1}`,
        });
        continue;
      }
      for (const item of group.items) {
        if (item.type === "elective") {
          addBucket(buckets, item);
          continue;
        }
        const shape = requirementShape(item);
        if (shape.kind === "required") {
          if (shape.code) required.set(shape.code, { code: shape.code });
          for (const code of shape.codes ?? []) required.set(code, { code });
        } else if (shape.kind === "choose") {
          const key = `any:${shape.takes}:${shape.options.join("|")}`;
          if (seenChoose.has(key)) continue;
          seenChoose.add(key);
          chooseGroups.push({
            id: `${group.group_id || "any"}_${chooseGroups.length}`,
            required: shape.takes,
            options: shape.options,
            label: shape.label,
          });
        }
      }
    }
  }

  return {
    required: [...required.values()],
    chooseGroups,
    buckets: [...buckets.values()].sort((a, b) => b.credits - a.credits),
    breadth: [...breadth.values()].sort((a, b) => b.credits - a.credits),
  };
}

export function findBucket(
  model: RequirementModel | null,
  key: string | null,
): { label: string; credits: number; match: ElectiveMatch } | null {
  if (!model || !key) return null;
  for (const pool of [model.buckets, model.breadth]) {
    const direct = pool.find((b) => b.key === key);
    if (direct) return direct;
    for (const bucket of pool) {
      const sub = bucket.subs.find((s) => s.key === key);
      if (sub) return sub;
    }
  }
  return null;
}

export function matchingBuckets(
  course: CustomCourse | CatalogCourse,
  model: RequirementModel | null,
): string[] {
  if (!model) return [];
  const labels = new Set<string>();
  for (const pool of [model.buckets, model.breadth]) {
    for (const bucket of pool) {
      if (matchesBucket(course, bucket.match)) labels.add(bucket.label);
      for (const sub of bucket.subs) {
        if (matchesBucket(course, sub.match)) labels.add(sub.label);
      }
    }
  }
  return [...labels];
}

export function termCredits(
  term: PlannerTerm,
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
): number {
  return term.slots.reduce(
    (sum, code) => sum + (code ? creditsOf(code, catalogMap, customs) : 0),
    0,
  );
}

export function firstFreeSlot(terms: PlannerTerm[]): {
  termIndex: number;
  slotIndex: number;
} {
  for (let t = 0; t < terms.length; t++) {
    const empty = terms[t].slots.indexOf(null);
    if (empty >= 0) return { termIndex: t, slotIndex: empty };
    if (terms[t].slots.length < SLOTS_PER_TERM) {
      return { termIndex: t, slotIndex: terms[t].slots.length };
    }
  }
  const last = Math.max(0, terms.length - 1);
  return {
    termIndex: last,
    slotIndex: terms[last]?.slots.length ?? 0,
  };
}

export type PlannerWarning = {
  id: string;
  code?: string;
  text: string;
};

export function collectWarnings(
  terms: PlannerTerm[],
  model: RequirementModel,
  unscheduled: UnscheduledItem[],
  catalogMap: Map<string, CatalogCourse>,
  offeringsMap: Map<string, OfferingEntry>,
  customs: Map<string, CustomCourse>,
  options?: {
    startYear?: number;
    context?: OfferingContext;
  },
): PlannerWarning[] {
  const out: PlannerWarning[] = [];
  const placed = placedCodes(terms);
  const startYear = options?.startYear ?? DEFAULT_START_YEAR;
  const context = options?.context;

  terms.forEach((term, termIndex) => {
    const calYear = termCalendarYear(startYear, term.year, term.season);
    const credits = termCredits(term, catalogMap, customs);
    if (credits > CREDIT_CAP) {
      out.push({
        id: `cap-${termIndex}`,
        text: `${term.season} ${calYear} has ${credits} credits (over ${CREDIT_CAP}).`,
      });
    }

    term.slots.forEach((code, slotIdx) => {
      if (!code) return;
      const shouldCheckOfferings =
        term.season !== "Summer" ||
        Boolean(context?.knownTermKeys.has(termKey("Summer", calYear)));
      if (shouldCheckOfferings) {
        if (!isOffered(code, offeringsMap, customs)) {
          out.push({
            id: `not-offered-${termIndex}-${slotIdx}`,
            code,
            text: `${code} has no recorded offerings in the course database.`,
          });
          return;
        }
        if (
          !offeredIn(code, term.season, offeringsMap, customs, {
            calendarYear: calYear,
            context,
          })
        ) {
          out.push({
            id: `wrong-season-${termIndex}-${slotIdx}`,
            code,
            text: `${code} isn't offered in ${term.season} ${calYear}.`,
          });
          return;
        }
      }

      const flag = prereqFlag(
        code,
        termIndex,
        terms,
        catalogMap,
        offeringsMap,
        customs,
        { startYear, context },
      );
      if (flag?.kind === "prereq") {
        const course = courseOf(code, catalogMap, customs);
        const deps =
          course && !("custom" in course) ? course.prerequisite_codes : [];
        const missingDeps = deps.filter((d) => !placed.has(d));
        const needs = missingDeps.length
          ? `${missingDeps.join(" / ")} first`
          : "an earlier-term prerequisite";
        out.push({
          id: `prereq-${termIndex}-${slotIdx}`,
          code,
          text: `${code} in Year ${term.year} ${term.season} needs ${needs}.`,
        });
      }
    });
  });

  unscheduled.forEach((item, idx) => {
    out.push({
      id: `unsched-${idx}-${item.code}`,
      code: item.code,
      text: `${item.code} is in the degree map but ${item.reason} — pick an alternative.`,
    });
  });

  const missing = model.required.filter((r) => !placed.has(r.code));
  if (missing.length > 0) {
    out.push({
      id: "missing-required",
      text: `${missing.length} required course${missing.length > 1 ? "s" : ""} not scheduled yet.`,
    });
  }

  return out;
}
