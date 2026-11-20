export type DegreeSubject = {
  code: string;
  name: string | null;
  faculty: string | null;
  course_count: number;
};

export type PrereqAstNode =
  | { type: "course"; code: string; coid?: string | null }
  | { type: "condition"; kind?: string; text?: string }
  | { type: "and"; items: PrereqAstNode[] }
  | { type: "or"; items: PrereqAstNode[] };

export type CatalogCourse = {
  code: string;
  catalog_year?: string;
  subject: string;
  number: string;
  subject_course: string;
  level: number;
  faculty: string | null;
  subject_name: string | null;
  title: string;
  short_title: string | null;
  description?: string | null;
  credit_hours: number;
  hours_lecture?: string | null;
  hours_laboratory?: string | null;
  hours_tutorial?: string | null;
  terms_offered: string[];
  sections_in_offerings: number;
  prerequisite_codes: string[];
  prerequisite_text: string | null;
  prerequisite_ast: PrereqAstNode | null;
  formerly_codes?: string[];
  calendar_url: string | null;
};

export type CourseOffering = {
  subject_course: string;
  subject?: string;
  course_number?: string;
  terms: string[];
  sections: number;
  credit_hours: number;
};

export type OfferingEntry = {
  terms: Set<string>;
  termKeys: Set<string>;
  sections: number;
  credits: number;
};

export type OfferingContext = {
  knownTermKeys: Set<string>;
  minCalendarYear: number;
  maxCalendarYear: number;
};

export type ProgramSummary = {
  program_id: string;
  catalog_year: string;
  name: string;
  credential: string | null;
  degree: string | null;
  degree_abbrev: string | null;
  faculty: string | null;
  total_credit_hours: number | null;
  honours: boolean;
};

export type ProgramCourseRef = {
  code: string;
  subject?: string;
  number?: string;
  title?: string;
  coid?: string | null;
  credit_hours?: number | null;
  in_offerings?: boolean;
  prerequisite_codes?: string[];
  prerequisite_mode?: string | null;
  prerequisite_text?: string | null;
  has_prerequisites?: boolean;
  prerequisite_level?: number | null;
  unlocks?: string[];
};

export type ElectiveMatch = {
  label?: string | null;
  subjects?: string[] | null;
  exclude_subjects?: string[] | null;
  faculties?: string[] | null;
  exclude_faculties?: string[] | null;
  min_level?: number | null;
  max_level?: number | null;
};

export type ElectiveSubRequirement = {
  credits: number;
  text?: string | null;
  match: ElectiveMatch;
};

export type ProgramItemNode =
  | {
      type: "course";
      courses: ProgramCourseRef[];
      credit_hours?: number | null;
      footnote_markers?: string[];
    }
  | {
      type: "course_set";
      join?: "and" | "or" | string | null;
      courses: ProgramCourseRef[];
      credit_hours?: number | null;
      footnote_markers?: string[];
    }
  | {
      type: "any_of";
      required?: number | null;
      options: ProgramItemNode[];
      credit_hours?: number | null;
      footnote_markers?: string[];
    }
  | {
      type: "elective";
      text?: string | null;
      count?: number | null;
      credit_hours?: number | null;
      levels?: number[] | null;
      level_above?: number | null;
      match?: ElectiveMatch | null;
      sub_requirements?: ElectiveSubRequirement[] | null;
      footnote_markers?: string[];
    };

export type ProgramGroup = {
  group_id: string;
  kind: "all" | "choose" | "pool" | string;
  required: number | null;
  label: string | null;
  credit_hours: number | null;
  items: ProgramItemNode[];
};

export type ProgramSection = {
  section_id: string;
  title: string | null;
  title_clean: string | null;
  role: "requirements" | "elective_pool" | "info" | string;
  is_alternative_track: boolean;
  credit_hours: number | null;
  description: string | null;
  groups: ProgramGroup[];
};

export type DegreeProgramDetail = ProgramSummary & {
  url: string | null;
  catalog: string | null;
  description: string | null;
  footnotes: Record<string, unknown>;
  required_course_codes: string[];
  sections: ProgramSection[];
};

export type TermSeason = "Fall" | "Winter" | "Summer";

export type PlannerTerm = {
  label: string;
  season: TermSeason;
  year: number;
  summer?: boolean;
  slots: (string | null)[];
};

export type CustomCourse = {
  code: string;
  title: string;
  credit_hours: number;
  subject: string | null;
  level: number;
  faculty: string | null;
  custom: true;
  transfer: boolean;
};

export type SubBucket = {
  key: string;
  label: string;
  credits: number;
  match: ElectiveMatch;
};

export type ElectiveBucket = {
  key: string;
  label: string;
  match: ElectiveMatch;
  credits: number;
  sources: string[];
  subs: SubBucket[];
};

export type ChooseGroup = {
  id: string;
  required: number;
  options: string[];
  label: string;
};

export type RequirementModel = {
  required: { code: string }[];
  chooseGroups: ChooseGroup[];
  buckets: ElectiveBucket[];
  breadth: ElectiveBucket[];
};

export type UnscheduledItem = {
  code: string;
  reason: string;
};

export type PrereqFlag = {
  kind?: "prereq";
  cls: "bad" | "unknown";
  icon: string;
  title: string;
};

export type PickerState = {
  termIndex: number;
  slotIndex: number;
  bucketKey: string | null;
  modelSource?: "major" | "minor";
  initialQuery?: string;
};

export type DegreeBootstrapData = {
  subjects: DegreeSubject[];
  programs: ProgramSummary[];
  catalogYears: string[];
  courses: CatalogCourse[];
  offerings: CourseOffering[];
};
