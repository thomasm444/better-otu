import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { collectPages } from "@/lib/queries";
import { getPublicClient } from "@/lib/supabase/public";

const DEGREE_PAGE_SIZE = 1000;

/**
 * Keyset (cursor) pagination over rows ordered ascending by a unique text key.
 * Avoids Postgres OFFSET scans that degrade on later pages and trigger cold-start timeouts.
 */
async function collectPagesByStringKey(
  keyField: string,
  fetchPage: (
    lastKey: string | null,
    limit: number,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let lastKey: string | null = null;

  for (;;) {
    let result = await fetchPage(lastKey, DEGREE_PAGE_SIZE);
    if (result.error && /statement timeout/i.test(result.error.message)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await fetchPage(lastKey, DEGREE_PAGE_SIZE);
    }

    if (result.error) {
      throw new Error(`Supabase pagination failed: ${result.error.message}`);
    }

    const page = (result.data ?? []) as Record<string, unknown>[];
    rows.push(...page);

    if (page.length < DEGREE_PAGE_SIZE) return rows;
    const nextRaw = page[page.length - 1][keyField];
    if (nextRaw === null || nextRaw === undefined) return rows;
    lastKey = String(nextRaw);
  }
}
import type {
  CatalogCourse,
  CourseOffering,
  DegreeBootstrapData,
  DegreeProgramDetail,
  DegreeSubject,
  ElectiveMatch,
  ElectiveSubRequirement,
  PrereqAstNode,
  ProgramCourseRef,
  ProgramGroup,
  ProgramItemNode,
  ProgramSection,
  ProgramSummary,
} from "@/lib/degree-types";

export async function getDegreeSubjects(): Promise<DegreeSubject[]> {
  "use cache";
  cacheLife("days");
  cacheTag("degree-subjects");

  const supabase = getPublicClient();
  const { data, error } = await supabase
    .from("degree_subjects")
    .select("code, name, faculty, course_count")
    .order("code", { ascending: true });

  if (error) {
    throw new Error(`getDegreeSubjects failed: ${error.message}`);
  }

  return (data ?? []) as DegreeSubject[];
}

export async function getProgramSummaries(): Promise<ProgramSummary[]> {
  "use cache";
  cacheLife("days");
  cacheTag("degree-programs");

  const supabase = getPublicClient();
  const rows = await collectPages((from, to) =>
    supabase
      .from("degree_programs")
      .select(
        "program_id, catalog_year, name, credential, degree, degree_abbrev, faculty, total_credit_hours, honours",
      )
      .order("catalog_year", { ascending: false })
      .order("name", { ascending: true })
      .order("program_id", { ascending: true })
      .range(from, to),
  );

  return (rows as Record<string, unknown>[]).map((row) => ({
    program_id: String(row.program_id),
    catalog_year: String(row.catalog_year ?? "2026-27"),
    name: String(row.name),
    credential: (row.credential as string | null) ?? null,
    degree: (row.degree as string | null) ?? null,
    degree_abbrev: (row.degree_abbrev as string | null) ?? null,
    faculty: (row.faculty as string | null) ?? null,
    total_credit_hours:
      row.total_credit_hours !== null && row.total_credit_hours !== undefined
        ? Number(row.total_credit_hours)
        : null,
    honours: Boolean(row.honours),
  }));
}

export async function getCatalogCourses(): Promise<CatalogCourse[]> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog-courses");

  const supabase = getPublicClient();
  const rows = await collectPagesByStringKey("code", (lastKey, limit) => {
    let query = supabase
      .from("catalog_courses")
      .select(
        "code, catalog_year, subject, number, subject_course, level, faculty, subject_name, title, short_title, description, credit_hours, hours_lecture, hours_laboratory, hours_tutorial, terms_offered, sections_in_offerings, prerequisite_codes, prerequisite_text, prerequisite_ast, formerly_codes, calendar_url",
      )
      .order("code", { ascending: true })
      .limit(limit);
    if (lastKey !== null) {
      query = query.gt("code", lastKey);
    }
    return query;
  });

  return rows.map((row) => ({
    code: String(row.code),
    catalog_year: row.catalog_year ? String(row.catalog_year) : undefined,
    subject: String(row.subject),
    number: String(row.number),
    subject_course: String(row.subject_course),
    level: Number(row.level ?? 0),
    faculty: (row.faculty as string | null) ?? null,
    subject_name: (row.subject_name as string | null) ?? null,
    title: String(row.title),
    short_title: (row.short_title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    credit_hours: Number(row.credit_hours ?? 3),
    hours_lecture: (row.hours_lecture as string | null) ?? null,
    hours_laboratory: (row.hours_laboratory as string | null) ?? null,
    hours_tutorial: (row.hours_tutorial as string | null) ?? null,
    terms_offered: Array.isArray(row.terms_offered)
      ? (row.terms_offered as string[])
      : [],
    sections_in_offerings: Number(row.sections_in_offerings ?? 0),
    prerequisite_codes: Array.isArray(row.prerequisite_codes)
      ? (row.prerequisite_codes as string[])
      : [],
    prerequisite_text: (row.prerequisite_text as string | null) ?? null,
    prerequisite_ast: (row.prerequisite_ast as PrereqAstNode | null) ?? null,
    formerly_codes: Array.isArray(row.formerly_codes)
      ? (row.formerly_codes as string[])
      : [],
    calendar_url: (row.calendar_url as string | null) ?? null,
  }));
}

export async function getCourseOfferings(): Promise<CourseOffering[]> {
  "use cache";
  cacheLife("days");
  cacheTag("course-offerings");

  const supabase = getPublicClient();
  const rows = await collectPagesByStringKey(
    "subject_course",
    (lastKey, limit) => {
      let query = supabase
        .from("course_offerings_summary")
        .select(
          "subject_course, subject, course_number, terms, sections, credit_hours",
        )
        .order("subject_course", { ascending: true })
        .limit(limit);
      if (lastKey !== null) {
        query = query.gt("subject_course", lastKey);
      }
      return query;
    },
  );

  return rows.map((row) => ({
    subject_course: String(row.subject_course),
    subject: row.subject ? String(row.subject) : undefined,
    course_number: row.course_number ? String(row.course_number) : undefined,
    terms: Array.isArray(row.terms) ? (row.terms as string[]) : [],
    sections: Number(row.sections ?? 0),
    credit_hours: Number(row.credit_hours ?? 0),
  }));
}

export async function getDegreeBootstrap(): Promise<DegreeBootstrapData> {
  "use cache";
  cacheLife("days");
  cacheTag("degree-bootstrap");

  const [subjects, programs, catalogCourses] = await Promise.all([
    getDegreeSubjects(),
    getProgramSummaries(),
    getCatalogCourses(),
  ]);

  let offerings: CourseOffering[] = [];
  try {
    offerings = await getCourseOfferings();
  } catch (error) {
    console.warn(
      "getCourseOfferings failed; falling back to catalog_courses terms_offered:",
      error,
    );
  }

  const subjectMap = new Map(subjects.map((s) => [s.code, s]));
  const existingKeys = new Set(
    catalogCourses.map((c) => c.subject_course.toUpperCase()),
  );
  const courses = [...catalogCourses];

  for (const off of offerings) {
    const key = off.subject_course.toUpperCase();
    if (existingKeys.has(key) || !off.subject || !off.course_number) continue;
    existingKeys.add(key);

    const numMatch = off.course_number.match(/\d{4}/);
    const level = numMatch ? Math.floor(Number(numMatch[0]) / 1000) * 1000 : 0;
    const subj = subjectMap.get(off.subject);

    courses.push({
      code: `${off.subject} ${off.course_number}`,
      subject: off.subject,
      number: off.course_number,
      subject_course: off.subject_course,
      level,
      faculty: subj?.faculty ?? null,
      subject_name: subj?.name ?? null,
      title: `${off.subject} ${off.course_number}`,
      short_title: null,
      credit_hours: off.credit_hours > 0 ? off.credit_hours : 3,
      terms_offered: off.terms,
      sections_in_offerings: off.sections,
      prerequisite_codes: [],
      prerequisite_text: null,
      prerequisite_ast: null,
      calendar_url: null,
    });
  }

  const catalogYears = [...new Set(programs.map((p) => p.catalog_year))].sort(
    (a, b) => b.localeCompare(a),
  );

  return { subjects, programs, catalogYears, courses, offerings };
}

type RawSectionRow = {
  id: number;
  section_id: string;
  position: number;
  title: string | null;
  title_clean: string | null;
  role: string;
  is_alternative_track: boolean;
  credit_hours: number | string | null;
  description: string | null;
};

type RawGroupRow = {
  id: number;
  section_row_id: number;
  group_id: string;
  position: number;
  kind: string;
  required: number | null;
  label: string | null;
  credit_hours: number | string | null;
};

type RawItemRow = {
  id: number;
  group_row_id: number;
  position: number;
  item_type: string;
  credit_hours: number | string | null;
  join_type: string | null;
  required_count: number | null;
  elective_text: string | null;
  elective_count: number | null;
  levels: number[] | null;
  level_above: number | null;
  match: ElectiveMatch | null;
  sub_requirements: ElectiveSubRequirement[] | null;
  courses: ProgramCourseRef[] | null;
  options: ProgramItemNode[] | null;
  footnote_markers: string[] | null;
};

function toItemNode(row: RawItemRow): ProgramItemNode {
  const creditHours =
    row.credit_hours !== null && row.credit_hours !== undefined
      ? Number(row.credit_hours)
      : null;
  const footnoteMarkers = row.footnote_markers ?? [];

  if (row.item_type === "course") {
    return {
      type: "course",
      courses: row.courses ?? [],
      credit_hours: creditHours,
      footnote_markers: footnoteMarkers,
    };
  }
  if (row.item_type === "course_set") {
    return {
      type: "course_set",
      join: row.join_type ?? "and",
      courses: row.courses ?? [],
      credit_hours: creditHours,
      footnote_markers: footnoteMarkers,
    };
  }
  if (row.item_type === "any_of") {
    return {
      type: "any_of",
      required: row.required_count ?? 1,
      options: row.options ?? [],
      credit_hours: creditHours,
      footnote_markers: footnoteMarkers,
    };
  }
  return {
    type: "elective",
    text: row.elective_text,
    count: row.elective_count,
    credit_hours: creditHours,
    levels: row.levels,
    level_above: row.level_above,
    match: row.match,
    sub_requirements: row.sub_requirements,
    footnote_markers: footnoteMarkers,
  };
}

type RawProgramRow = {
  program_id: string | number;
  catalog_year?: string | null;
  name: string;
  url?: string | null;
  catalog?: string | null;
  description?: string | null;
  faculty?: string | null;
  degree?: string | null;
  degree_abbrev?: string | null;
  credential?: string | null;
  honours?: boolean | null;
  total_credit_hours?: number | string | null;
  required_course_codes?: string[] | null;
  footnotes?: Record<string, unknown> | null;
};

function buildProgramDetail(
  p: RawProgramRow,
  sectionRows: RawSectionRow[],
  groupRows: RawGroupRow[],
  itemRows: RawItemRow[],
): DegreeProgramDetail {
  const itemsByGroup = new Map<number, ProgramItemNode[]>();
  for (const row of itemRows) {
    const list = itemsByGroup.get(row.group_row_id) ?? [];
    list.push(toItemNode(row));
    itemsByGroup.set(row.group_row_id, list);
  }

  const groupsBySection = new Map<number, ProgramGroup[]>();
  for (const row of groupRows) {
    const list = groupsBySection.get(row.section_row_id) ?? [];
    list.push({
      group_id: row.group_id,
      kind: row.kind,
      required: row.required,
      label: row.label,
      credit_hours:
        row.credit_hours !== null && row.credit_hours !== undefined
          ? Number(row.credit_hours)
          : null,
      items: itemsByGroup.get(row.id) ?? [],
    });
    groupsBySection.set(row.section_row_id, list);
  }

  const sections: ProgramSection[] = sectionRows.map((row) => ({
    section_id: row.section_id,
    title: row.title,
    title_clean: row.title_clean,
    role: row.role,
    is_alternative_track: Boolean(row.is_alternative_track),
    credit_hours:
      row.credit_hours !== null && row.credit_hours !== undefined
        ? Number(row.credit_hours)
        : null,
    description: row.description,
    groups: groupsBySection.get(row.id) ?? [],
  }));

  return {
    program_id: String(p.program_id),
    catalog_year: String(p.catalog_year ?? "2026-27"),
    name: String(p.name),
    url: p.url ?? null,
    catalog: p.catalog ?? null,
    description: p.description ?? null,
    faculty: p.faculty ?? null,
    degree: p.degree ?? null,
    degree_abbrev: p.degree_abbrev ?? null,
    credential: p.credential ?? null,
    honours: Boolean(p.honours),
    total_credit_hours:
      p.total_credit_hours !== null && p.total_credit_hours !== undefined
        ? Number(p.total_credit_hours)
        : null,
    required_course_codes: Array.isArray(p.required_course_codes)
      ? (p.required_course_codes as string[])
      : [],
    footnotes: (p.footnotes as Record<string, unknown>) ?? {},
    sections,
  };
}

export async function getProgramDetail(
  programId: string,
): Promise<DegreeProgramDetail | null> {
  "use cache";
  cacheLife("days");
  cacheTag("degree-programs", `degree-program-${programId}`);

  const supabase = getPublicClient();

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_program_detail_json",
      { p_program_id: programId } as never,
    );

    if (!rpcError && rpcData === null) {
      return null;
    }

    if (
      !rpcError &&
      rpcData &&
      typeof rpcData === "object" &&
      !Array.isArray(rpcData)
    ) {
      const payload = rpcData as {
        program?: RawProgramRow | null;
        program_sections?: RawSectionRow[] | null;
        program_groups?: RawGroupRow[] | null;
        program_items?: RawItemRow[] | null;
        sections?: RawSectionRow[] | null;
        groups?: RawGroupRow[] | null;
        items?: RawItemRow[] | null;
      };
      if ("program" in payload) {
        if (!payload.program) return null;
        const sections = payload.program_sections ?? payload.sections;
        const groups = payload.program_groups ?? payload.groups;
        const items = payload.program_items ?? payload.items;
        return buildProgramDetail(
          payload.program,
          Array.isArray(sections) ? sections : [],
          Array.isArray(groups) ? groups : [],
          Array.isArray(items) ? items : [],
        );
      }
    }
  } catch {
    // Fall back to the 4-query path if the RPC is not yet deployed.
  }

  const { data: progRow, error: progError } = await supabase
    .from("degree_programs")
    .select(
      "program_id, catalog_year, name, url, catalog, description, faculty, degree, degree_abbrev, credential, honours, total_credit_hours, required_course_codes, footnotes",
    )
    .eq("program_id", programId)
    .maybeSingle();

  if (progError) {
    throw new Error(`getProgramDetail failed: ${progError.message}`);
  }
  if (!progRow) return null;

  const [sectionRows, groupRows, itemRows] = await Promise.all([
    collectPages((from, to) =>
      supabase
        .from("program_sections")
        .select(
          "id, section_id, position, title, title_clean, role, is_alternative_track, credit_hours, description",
        )
        .eq("program_id", programId)
        .order("position", { ascending: true })
        .range(from, to),
    ),
    collectPages((from, to) =>
      supabase
        .from("program_groups")
        .select(
          "id, section_row_id, group_id, position, kind, required, label, credit_hours",
        )
        .eq("program_id", programId)
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    collectPages((from, to) =>
      supabase
        .from("program_items")
        .select(
          "id, group_row_id, position, item_type, credit_hours, join_type, required_count, elective_text, elective_count, levels, level_above, match, sub_requirements, courses, options, footnote_markers",
        )
        .eq("program_id", programId)
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  return buildProgramDetail(
    progRow as unknown as RawProgramRow,
    sectionRows as RawSectionRow[],
    groupRows as RawGroupRow[],
    itemRows as RawItemRow[],
  );
}
