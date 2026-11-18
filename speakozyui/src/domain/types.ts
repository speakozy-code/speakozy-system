export type Role = "owner" | "admin" | "teacher" | "marketer" | "marketing";
export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "";
export type PaymentState = 0 | 1 | 2;
export type RenewalState = 0 | 1 | 2;
export type StudentKind = "new" | "old" | "returned";
export type SubscriptionClass = "new" | "renewal";
export type FeedbackMilestone = 1 | 4 | 7;
export type RenewalReminderMilestone = "session7" | "session8" | "afterSession8";
export type WorkScriptKind = "message" | "reply" | "followup" | "other";
export type StudentDestinationTab = "renewals" | "assessment" | "next" | "leads";

export interface Round {
  id: string;
  n?: string;
  on?: boolean;
  x?: 0 | 1;
  pl?: 0 | 1;
  createdAt?: number;
  [key: string]: unknown;
}

export interface Session {
  k: string;
  d?: string;
  c?: 0 | 1;
  [key: string]: unknown;
}

export interface AcademyGroup {
  id: string;
  r: string;
  p?: 0 | 1 | boolean;
  lv?: string;
  d?: string;
  t?: string;
  t1?: string;
  t2?: string;
  tc?: string;
  s?: string;
  e?: string;
  capacity?: number;
  c?: string | number[];
  ss?: Session[] | null;
  x?: 0 | 1;
  fd?: string;
  fu?: number;
  followupDoneAt?: number;
  feedbackSentAt?: Partial<Record<FeedbackMilestone, number>>;
  [key: string]: unknown;
}

export interface Student {
  id: string;
  g: string;
  r?: string;
  n?: string;
  ph?: string;
  lv?: string;
  nw?: 0 | 1 | boolean;
  kind?: StudentKind;
  source?: string;
  sourceOther?: string;
  renewalReason?: string;
  formerAt?: number;
  profileId?: string;
  subscriptionSource?: string;
  subscriptionSourceOther?: string;
  subscriptionClass?: SubscriptionClass;
  movedToTab?: StudentDestinationTab;
  movedToLeadId?: string;
  copiedFromStudentId?: string;
  autoFormerCustomer?: boolean;
  pay?: PaymentState;
  amount?: number;
  pn?: string;
  lvPaid?: number;
  ren?: RenewalState;
  nt?: string;
  pre?: boolean;
  pp?: number;
  x?: 0 | 1;
  fd?: string;
  fh?: unknown[];
  fu?: number;
  lu?: number;
  followupDoneAt?: number;
  renewalReminderAt?: Partial<Record<RenewalReminderMilestone, number>>;
  levelMatchFollowups?: Record<string, number>;
  [key: string]: unknown;
}

export interface Lead {
  id: string;
  n?: string;
  ph?: string;
  lv?: string;
  t?: string;
  nt?: string;
  tm?: string;
  source?: string;
  sourceOther?: string;
  st?: string;
  followupReason?: string;
  fd?: string;
  bucket?: "assessment" | "next" | string;
  source_sheet?: string;
  followupCat?: string;
  profileId?: string;
  movedFromStudentId?: string;
  copiedFromStudentId?: string;
  kind?: StudentKind;
  subscriptionClass?: SubscriptionClass;
  subscriptionSource?: string;
  subscriptionSourceOther?: string;
  followupDate?: string;
  followupHistory?: unknown[];
  fh?: unknown[];
  fu?: number;
  lu?: number;
  followupDoneAt?: number;
  ts?: number;
  levelMatchFollowups?: Record<string, number>;
  x?: 0 | 1;
  [key: string]: unknown;
}

export interface AttendanceRecord {
  id?: string;
  date: string;
  gid: string;
  mid: string;
  status: AttendanceStatus;
  teacher?: string;
  teacherUid?: string;
  updatedAt: number;
  [key: string]: unknown;
}

export interface FinanceRow {
  id: string;
  type: "expense" | string;
  amount: number;
  date: string;
  note?: string;
  x?: 0 | 1;
  xa?: number;
  createdAt?: number;
  [key: string]: unknown;
}

export interface TeacherHours {
  name: string;
  weeklyHours?: number;
  active?: boolean;
  archivedAt?: number;
  deletedAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface TeacherAccount {
  uid: string;
  name: string;
  email: string;
}

export interface WorkScript {
  id: string;
  title: string;
  kind: WorkScriptKind;
  category: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
export interface AcademyData {
  r: Round[];
  g: AcademyGroup[];
  m: Student[];
  l: Lead[];
  cur: string;
  attendance: AttendanceRecord[];
  teacherAbsences: unknown[];
  finance: FinanceRow[];
  teacherHours: TeacherHours[];
  scripts: WorkScript[];
  lb?: number;
  [key: string]: unknown;
}

export interface Profile {
  uid: string;
  email: string;
  role: Role;
  teacherName: string;
}

export interface AppNotice {
  id: string;
  kind: "lead" | "student" | "round" | "payment" | "absence" | "feedback";
  feedbackMilestone?: FeedbackMilestone;
  renewalReminderMilestone?: RenewalReminderMilestone;
  targetTab?: "renewals" | "assessment" | "next" | "leads";
  relatedGroupId?: string;
  levelMatchReminder?: boolean;
  title: string;
  description: string;
  phone?: string;
  groupId?: string;
  leadId?: string;
  studentId?: string;
}

export interface SessionHours {
  group: AcademyGroup;
  sessions: number;
  hours: number;
}

export const EMPTY_DATA: AcademyData = {
  r: [],
  g: [],
  m: [],
  l: [],
  cur: "",
  attendance: [],
  teacherAbsences: [],
  finance: [],
  teacherHours: [],
  scripts: []
};
