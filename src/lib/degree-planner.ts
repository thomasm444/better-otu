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
 * Compacts all non-empty courses to the top of a term's slot list (no blank
 * gaps between courses), caps at MAX_SLOTS_PER_TERM (8), and pads up to
 * SLOTS_PER_TERM (5) with trailing empty slots.
 */
export function normalizeTermSlots(
  slots: (string | null)[],
): (string | null)[] {
  const courses = slots.filter((code): code is string => Boolean(code));
  const next: (string | null)[] = courses.slice(0, MAX_SLOTS_PER_TERM);
  while (next.length < SLOTS_PER_TERM) {
    next.push(null);
  }
  return next;
}
export const DEFAULT_START_YEAR = 2026;
export const MIN_START_YEAR = 2008;
export const MAX_START_YEAR = 2027;
export const MIN_PLAN_CATALOG_YEAR = "2021-22";

/**
 * Builds an undirected equivalence map from `formerly_codes` on catalog courses
 * (e.g. CSCI 1050U <-> CSCI 2050U, including transitive chains).
 * Each key maps to the set of *other* equivalent course codes.
 */
export function buildEquivalenceMap(
  courses: CatalogCourse[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    let sa = adj.get(a);
    if (!sa) {
      sa = new Set();
      adj.set(a, sa);
    }
    sa.add(b);
    let sb = adj.get(b);
    if (!sb) {
      sb = new Set();
      adj.set(b, sb);
    }
    sb.add(a);
  };

  for (const course of courses) {
    for (const former of course.formerly_codes ?? []) {
      addEdge(course.code, former);
    }
  }
  // CSCI 1050U (2026-27+) replaced CSCI 2050U (2025-26 and earlier)
  addEdge("CSCI 1050U", "CSCI 2050U");

  // Compute connected components so transitive renames are all linked
  const equiv = new Map<string, Set<string>>();
  const visited = new Set<string>();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    for (const code of comp) {
      const peers = new Set(comp.filter((c) => c !== code));
      if (peers.size > 0) equiv.set(code, peers);
    }
  }

  return equiv;
}

export function findEquivalentInSet(
  code: string,
  codeSet: Set<string>,
  equivMap?: Map<string, Set<string>>,
): string | null {
  if (codeSet.has(code)) return code;
  const peers = equivMap?.get(code);
  if (!peers) return null;
  for (const peer of peers) {
    if (codeSet.has(peer)) return peer;
  }
  return null;
}

export function expandWithEquivalents(
  codes: Set<string>,
  equivMap?: Map<string, Set<string>>,
): Set<string> {
  if (!equivMap || equivMap.size === 0) return codes;
  const expanded = new Set<string>(codes);
  for (const code of codes) {
    const peers = equivMap.get(code);
    if (!peers) continue;
    for (const peer of peers) expanded.add(peer);
  }
  return expanded;
}

export function startYearToCatalogYear(year: number): string {
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function catalogYearToStartYear(catalogYear: string): number | null {
  const match = String(catalogYear).match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

export function resolveCatalogYearForStartYear(
  startYear: number,
  availableYears: string[],
): string {
  const exact = startYearToCatalogYear(startYear);
  if (availableYears.length === 0) return exact;
  if (availableYears.includes(exact)) return exact;

  const parsed = availableYears
    .map((cy) => ({ cy, year: catalogYearToStartYear(cy) }))
    .filter((item): item is { cy: string; year: number } => item.year !== null)
    .sort((a, b) => b.year - a.year);

  if (parsed.length === 0) return availableYears[0];
  if (startYear >= parsed[0].year) return parsed[0].cy;
  if (startYear <= parsed[parsed.length - 1].year) {
    return parsed[parsed.length - 1].cy;
  }

  // Pick closest available catalog year <= startYear
  for (const item of parsed) {
    if (item.year <= startYear) return item.cy;
  }
  return parsed[parsed.length - 1].cy;
}

function normalizeProgramNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2013\u2014-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function findProgramInCatalogYear<
  T extends {
    program_id: string;
    catalog_year: string;
    name: string;
    credential?: string | null;
  },
>(
  programs: T[],
  current: { name: string; credential?: string | null },
  targetCatalogYear: string,
): T | null {
  const candidates = programs.filter(
    (p) => p.catalog_year === targetCatalogYear,
  );
  if (candidates.length === 0) return null;

  const targetName = normalizeProgramNameKey(current.name);
  const targetCred = (current.credential ?? "").trim().toLowerCase();

  if (targetCred) {
    const exactWithCred = candidates.find(
      (p) =>
        normalizeProgramNameKey(p.name) === targetName &&
        (p.credential ?? "").trim().toLowerCase() === targetCred,
    );
    if (exactWithCred) return exactWithCred;
  }

  const exactName = candidates.find(
    (p) => normalizeProgramNameKey(p.name) === targetName,
  );
  if (exactName) return exactName;

  return null;
}

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

export function transferCodes(customs: Map<string, CustomCourse>): Set<string> {
  const set = new Set<string>();
  for (const course of customs.values()) {
    if (course.transfer) set.add(course.code);
  }
  return set;
}

export function earnedCodes(
  terms: PlannerTerm[],
  customs: Map<string, CustomCourse>,
): Set<string> {
  const set = placedCodes(terms);
  for (const code of transferCodes(customs)) {
    set.add(code);
  }
  return set;
}

export function completedBefore(
  terms: PlannerTerm[],
  termIndex: number,
  equivMap?: Map<string, Set<string>>,
  customs?: Map<string, CustomCourse>,
): Set<string> {
  const set = new Set<string>();
  if (customs) {
    for (const code of transferCodes(customs)) {
      set.add(code);
    }
  }
  for (let i = 0; i < termIndex; i++) {
    for (const code of terms[i].slots) {
      if (code) set.add(code);
    }
  }
  return expandWithEquivalents(set, equivMap);
}

export type PrereqEvalContext = {
  termYear?: number;
  priorCredits?: number;
};

function evalConditionText(
  text: string,
  ctx?: PrereqEvalContext,
): boolean | null {
  if (!ctx) return null;
  const low = text.toLowerCase();

  // Keep high-school and co-op / registration gates as informational
  if (
    /grade\s+12|mhf4u|mcv4u|sph4u|sch4u|eng4u|co-?op\s+program|registration\s+in/i.test(
      low,
    )
  ) {
    return null;
  }

  if (
    /(?:fourth|4th)[- ]year\s+standing|at\s+least\s+three\s+years/i.test(low)
  ) {
    if (ctx.termYear === undefined && ctx.priorCredits === undefined) return null;
    return (ctx.termYear ?? 0) >= 4 || (ctx.priorCredits ?? 0) >= 84;
  }
  if (
    /(?:third|3rd)[- ]year\s+standing|at\s+least\s+two\s+years/i.test(low)
  ) {
    if (ctx.termYear === undefined && ctx.priorCredits === undefined) return null;
    return (ctx.termYear ?? 0) >= 3 || (ctx.priorCredits ?? 0) >= 54;
  }
  if (
    /(?:second|2nd)[- ]year\s+standing|at\s+least\s+one\s+year/i.test(low)
  ) {
    if (ctx.termYear === undefined && ctx.priorCredits === undefined) return null;
    return (ctx.termYear ?? 0) >= 2 || (ctx.priorCredits ?? 0) >= 24;
  }

  const crMatch = low.match(
    /(?:completed?|completion\s+of)\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?(\d+)\s+credit\s+hours?/i,
  );
  if (crMatch && ctx.priorCredits !== undefined) {
    return ctx.priorCredits >= Number(crMatch[1]);
  }

  // Assume clear academic standing
  if (/(?:be\s+in\s+)?clear\s+(?:academic\s+)?standing/i.test(low)) {
    return true;
  }

  return null;
}

export function evalPrereq(
  node: PrereqAstNode | null | undefined,
  completed: Set<string>,
  ctx?: PrereqEvalContext,
): boolean | null {
  if (!node) return true;
  if (node.type === "course") return completed.has(node.code);
  if (node.type === "condition") return evalConditionText(node.text ?? "", ctx);
  if (node.type === "and") {
    let unknown = false;
    for (const item of node.items) {
      const res = evalPrereq(item, completed, ctx);
      if (res === false) return false;
      if (res === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (node.type === "or") {
    let unknown = false;
    for (const item of node.items) {
      const res = evalPrereq(item, completed, ctx);
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
    equivMap?: Map<string, Set<string>>;
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

  const completed = completedBefore(terms, termIndex, options?.equivMap, customs);
  let priorCredits = 0;
  for (const c of customs.values()) {
    if (c.transfer) priorCredits += Number(c.credit_hours) || 0;
  }
  for (let i = 0; i < termIndex; i++) {
    for (const slotCode of terms[i].slots) {
      if (slotCode) priorCredits += creditsOf(slotCode, catalogMap, customs);
    }
  }
  const result = evalPrereq(ast, completed, {
    termYear: term?.year,
    priorCredits,
  });
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
        const isOfferedTerm =
          offeringsMap.size === 0 ||
          offeredIn(code, term.season, offeringsMap, customs, {
            calendarYear: calYear,
            context,
          }) ||
          (code === "CSCI 1050U" &&
            offeredIn("CSCI 2050U", term.season, offeringsMap, customs, {
              calendarYear: calYear,
              context,
            }));
        if (!isOfferedTerm) {
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
    term.slots = normalizeTermSlots(term.slots);
  }

  return { terms, unscheduled };
}

export function matchesBucket(
  course: CatalogCourse | CustomCourse | null | undefined,
  match: ElectiveMatch | null | undefined,
): boolean {
  if (!course || !match) return true;
  if ((course.credit_hours || 0) <= 0) return false;
  if (
    course.subject === "SCCO" &&
    (match.faculties ?? []).includes("Faculty of Science")
  ) {
    return false;
  }
  if (
    (match.subjects ?? []).length > 0 &&
    !(match.subjects ?? []).includes(course.subject ?? "")
  ) {
    return false;
  }
  if ((match.exclude_subjects ?? []).includes(course.subject ?? "")) {
    return false;
  }
  const faculty =
    course.code === "SUST 1001U" ? "Faculty of Science" : (course.faculty ?? null);
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
        const electiveItem = group.items.find(
          (item): item is Extract<ProgramItemNode, { type: "elective" }> =>
            item.type === "elective",
        );
        const key = `${group.required || 1}:${group.items.map(firstCode).join("|")}:${electiveItem?.text ?? ""}`;
        if (seenChoose.has(key)) continue;
        const options = group.items.flatMap((item) => nodeCodes(item));
        if (!options.length && !electiveItem) continue;
        seenChoose.add(key);
        chooseGroups.push({
          id: group.group_id,
          required: group.required || 1,
          options,
          label: group.label || `Choose ${group.required || 1}`,
          elective: electiveItem
            ? {
                credits: electiveItem.credit_hours || 3,
                match: electiveItem.match ?? {},
                label:
                  electiveItem.match?.subjects?.includes("CSCI") &&
                  electiveItem.match?.min_level === 3000
                    ? "Senior CS elective (3000/4000-level)"
                    : electiveItem.match?.label ||
                      electiveItem.text ||
                      "Elective",
              }
            : null,
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

  const breadthList = [...breadth.values()].sort((a, b) => b.credits - a.credits);
  const bucketList = [...buckets.values()]
    .filter((b) => {
      if (breadthList.length === 0) return true;
      const m = b.match ?? {};
      const isGenericAny =
        !m.subjects?.length &&
        !m.exclude_subjects?.length &&
        !m.faculties?.length &&
        !m.exclude_faculties?.length &&
        !m.min_level &&
        !m.max_level;
      return !isGenericAny;
    })
    .sort((a, b) => b.credits - a.credits);

  return {
    required: [...required.values()],
    chooseGroups,
    buckets: bucketList,
    breadth: breadthList,
  };
}

export function evaluatePlanRequirements(
  placed: Set<string>,
  model: RequirementModel,
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
  equivMap?: Map<string, Set<string>>,
): {
  freeCodes: string[];
  chooseHits: Map<string, number>;
} {
  const consumed = expandWithEquivalents(
    new Set(model.required.map((r) => r.code)),
    equivMap,
  );
  const chooseHits = new Map<string, number>();

  const consumeCode = (code: string) => {
    consumed.add(code);
    const peers = equivMap?.get(code);
    if (peers) {
      for (const peer of peers) consumed.add(peer);
    }
  };

  // First pass: satisfy chooseGroups using their explicit course options
  for (const group of model.chooseGroups) {
    let hits = 0;
    for (const opt of group.options) {
      if (hits >= group.required) break;
      const matched = findEquivalentInSet(opt, placed, equivMap);
      if (matched && !consumed.has(matched)) {
        consumeCode(matched);
        hits += 1;
      }
    }
    chooseHits.set(group.id, hits);
  }

  // Second pass: for chooseGroups with an elective fallback (e.g. "CSCI 4410U or Senior CS elective")
  for (const group of model.chooseGroups) {
    if (!group.elective) continue;
    let hits = chooseHits.get(group.id) ?? 0;
    if (hits >= group.required) continue;
    for (const code of placed) {
      if (hits >= group.required) break;
      if (consumed.has(code)) continue;
      const course = courseOf(code, catalogMap, customs);
      if (matchesBucket(course, group.elective.match)) {
        consumeCode(code);
        hits += 1;
      }
    }
    chooseHits.set(group.id, hits);
  }

  const freeCodes = [...placed].filter(
    (code) => !consumed.has(code) && creditsOf(code, catalogMap, customs) > 0,
  );
  return { freeCodes, chooseHits };
}

export function assignBreadthBuckets(
  freeCodes: string[],
  breadth: ElectiveBucket[],
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
  overrides: Record<string, string> = {},
): {
  assignedByBucket: Map<string, string[]>;
  assignedBucketOf: Map<string, string>;
} {
  const assignedByBucket = new Map<string, string[]>();
  const bucketCredits = new Map<string, number>();
  const assignedBucketOf = new Map<string, string>();
  for (const b of breadth) {
    assignedByBucket.set(b.key, []);
    bucketCredits.set(b.key, 0);
  }
  if (breadth.length === 0) {
    return { assignedByBucket, assignedBucketOf };
  }

  const bucketByKey = new Map(breadth.map((b) => [b.key, b]));
  const remaining: string[] = [];

  // 1. Apply user overrides first
  for (const code of freeCodes) {
    const targetKey = overrides[code];
    const targetBucket = targetKey ? bucketByKey.get(targetKey) : undefined;
    const course = courseOf(code, catalogMap, customs);
    if (targetBucket && matchesBucket(course, targetBucket.match)) {
      assignedByBucket.get(targetKey)!.push(code);
      bucketCredits.set(
        targetKey,
        (bucketCredits.get(targetKey) ?? 0) +
          creditsOf(code, catalogMap, customs),
      );
      assignedBucketOf.set(code, targetKey);
    } else {
      remaining.push(code);
    }
  }

  // 2. Auto-assign remaining courses: fewest eligible buckets first,
  //    then sub-requirement matches first so BUSI/COMM land in Outside Science.
  const eligibleOf = new Map<string, ElectiveBucket[]>();
  for (const code of remaining) {
    const course = courseOf(code, catalogMap, customs);
    eligibleOf.set(
      code,
      breadth.filter((b) => matchesBucket(course, b.match)),
    );
  }

  const ordered = remaining.slice().sort((a, b) => {
    const ea = eligibleOf.get(a) ?? [];
    const eb = eligibleOf.get(b) ?? [];
    if (ea.length !== eb.length) return ea.length - eb.length;
    const ca = courseOf(a, catalogMap, customs);
    const cb = courseOf(b, catalogMap, customs);
    const subA = ea.some((bk) => bk.subs.some((s) => matchesBucket(ca, s.match)))
      ? 0
      : 1;
    const subB = eb.some((bk) => bk.subs.some((s) => matchesBucket(cb, s.match)))
      ? 0
      : 1;
    if (subA !== subB) return subA - subB;
    // Place specific-subject/faculty courses before general transfer credits
    const genA = ca && "transfer" in ca && ca.transfer && !ca.subject ? 1 : 0;
    const genB = cb && "transfer" in cb && cb.transfer && !cb.subject ? 1 : 0;
    return genA - genB;
  });

  for (const code of ordered) {
    const eligible = eligibleOf.get(code) ?? [];
    if (eligible.length === 0) continue;
    const cr = creditsOf(code, catalogMap, customs);
    const course = courseOf(code, catalogMap, customs);

    // Prefer a bucket with remaining capacity (and matching sub-requirement first);
    // if all eligible buckets are already full, fall back to the broadest eligible
    // bucket (e.g. General electives) so every elective still appears in the sidebar.
    const target =
      eligible.find(
        (b) =>
          (bucketCredits.get(b.key) ?? 0) < b.credits &&
          b.subs.some((s) => matchesBucket(course, s.match)),
      ) ??
      eligible.find((b) => (bucketCredits.get(b.key) ?? 0) < b.credits) ??
      eligible.find(
        (b) =>
          !(b.match.faculties ?? []).length &&
          !(b.match.exclude_faculties ?? []).length &&
          !(b.match.subjects ?? []).length,
      ) ??
      eligible[eligible.length - 1];

    assignedByBucket.get(target.key)!.push(code);
    bucketCredits.set(target.key, (bucketCredits.get(target.key) ?? 0) + cr);
    assignedBucketOf.set(code, target.key);
  }

  return { assignedByBucket, assignedBucketOf };
}

export type DegreeCreditRules = {
  maxFirstYearCredits: number | null;
  min4000CsciCredits: number | null;
};

export function extractDegreeRules(
  program: DegreeProgramDetail,
): DegreeCreditRules {
  let maxFirstYearCredits: number | null = null;
  let min4000CsciCredits: number | null = null;

  for (const sec of program.sections) {
    const text = [sec.title, sec.description].filter(Boolean).join(" ");
    if (!text) continue;
    if (maxFirstYearCredits === null) {
      const m = text.match(
        /no\s+more\s+than\s+(\d+)\s+credit\s+hours?\s+may\s+be\s+taken\s+at\s+the\s+(?:first[- ]year|1000)[- ]level/i,
      );
      if (m) maxFirstYearCredits = Number(m[1]);
    }
    if (min4000CsciCredits === null) {
      const m = text.match(
        /at\s+least\s+(\d+)\s+credit\s+hours?\s+in\s+Computer\s+Science\s+(?:courses\s+)?at\s+the\s+4000[- ]?level/i,
      );
      if (m) min4000CsciCredits = Number(m[1]);
    }
  }

  return { maxFirstYearCredits, min4000CsciCredits };
}

export function evaluateDegreeRules(
  program: DegreeProgramDetail,
  placed: Set<string>,
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
): {
  rules: DegreeCreditRules;
  firstYearCredits: number;
  csci4000Credits: number;
} {
  const rules = extractDegreeRules(program);
  let firstYearCredits = 0;
  let csci4000Credits = 0;

  for (const code of placed) {
    const course = courseOf(code, catalogMap, customs);
    if (!course) continue;
    const cr = Number(course.credit_hours) || 0;
    if (course.level === 1000) firstYearCredits += cr;
    if (course.subject === "CSCI" && (course.level || 0) >= 4000) {
      csci4000Credits += cr;
    }
  }

  return { rules, firstYearCredits, csci4000Credits };
}

export type BucketAllocation = {
  credits: number;
  assignedCodes: string[];
};

function bucketSpecificityScore(bucket: ElectiveBucket): number {
  const m = bucket.match;
  let score = 0;
  if (m.subjects && m.subjects.length > 0) score += 40;
  if (m.faculties && m.faculties.length > 0) score += 30;
  if (m.min_level) score += 20 + m.min_level / 1000;
  if (m.max_level) score += 10;
  if (m.exclude_subjects && m.exclude_subjects.length > 0) score += 8;
  if (m.exclude_faculties && m.exclude_faculties.length > 0) score += 8;
  return score;
}

/**
 * Greedily assigns each free elective course to at most one bucket in this list,
 * allocating more constrained buckets (e.g. CSCI 4000+, Non-CSCI Science,
 * outside Science) before general "Any elective" buckets so courses aren't
 * confusingly double-counted across multiple bars.
 */
export function allocateBuckets(
  buckets: ElectiveBucket[],
  freeCodes: string[],
  catalogMap: Map<string, CatalogCourse>,
  customs: Map<string, CustomCourse>,
): Map<string, BucketAllocation> {
  const result = new Map<string, BucketAllocation>();
  for (const b of buckets) {
    result.set(b.key, { credits: 0, assignedCodes: [] });
  }
  if (buckets.length === 0 || freeCodes.length === 0) return result;

  const uniqueCodes = [...new Set(freeCodes)];
  const orderedIndices = buckets
    .map((b, idx) => ({ b, idx, score: bucketSpecificityScore(b) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((entry) => entry.idx);

  const used = new Set<string>();

  for (let pass = 0; pass < orderedIndices.length; pass++) {
    const bucket = buckets[orderedIndices[pass]];
    const isLast = pass === orderedIndices.length - 1;
    const entry = result.get(bucket.key)!;

    const candidates = uniqueCodes.filter(
      (code) =>
        !used.has(code) &&
        matchesBucket(courseOf(code, catalogMap, customs), bucket.match),
    );

    // If this bucket has sub-requirements (e.g. BUSI / COMM inside outside Science),
    // prioritize courses matching unsatisfied sub-requirements first.
    if (bucket.subs.length > 0) {
      candidates.sort((a, b) => {
        const ca = courseOf(a, catalogMap, customs);
        const cb = courseOf(b, catalogMap, customs);
        const subsA = bucket.subs.filter((s) => matchesBucket(ca, s.match)).length;
        const subsB = bucket.subs.filter((s) => matchesBucket(cb, s.match)).length;
        return subsB - subsA;
      });
    }

    for (const code of candidates) {
      if (!isLast && entry.credits >= bucket.credits) break;
      const cr = creditsOf(code, catalogMap, customs);
      if (cr <= 0) continue;
      used.add(code);
      entry.assignedCodes.push(code);
      entry.credits += cr;
    }
  }

  return result;
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
    planMismatches?: Map<string, string>;
    equivMap?: Map<string, Set<string>>;
  },
): PlannerWarning[] {
  const out: PlannerWarning[] = [];
  const placed = earnedCodes(terms, customs);
  const startYear = options?.startYear ?? DEFAULT_START_YEAR;
  const context = options?.context;
  const planMismatches = options?.planMismatches;
  const equivMap = options?.equivMap;

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
      const mismatchReason = planMismatches?.get(code);
      if (mismatchReason) {
        out.push({
          id: `mismatch-${termIndex}-${slotIdx}`,
          code,
          text: `${code}: ${mismatchReason}.`,
        });
      }
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
        { startYear, context, equivMap },
      );
      if (flag?.kind === "prereq") {
        const course = courseOf(code, catalogMap, customs);
        const deps =
          course && !("custom" in course) ? course.prerequisite_codes : [];
        const missingDeps = deps.filter(
          (d) => !findEquivalentInSet(d, placed, equivMap),
        );
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

  const missing = model.required.filter(
    (r) => !findEquivalentInSet(r.code, placed, equivMap),
  );
  if (missing.length > 0) {
    out.push({
      id: "missing-required",
      text: `${missing.length} required course${missing.length > 1 ? "s" : ""} not scheduled yet.`,
    });
  }

  return out;
}
