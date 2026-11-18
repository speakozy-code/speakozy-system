import type { AcademyData, AcademyGroup, AttendanceRecord, Lead, Round, Student, StudentKind, TeacherAccount, TeacherHours } from "./types";
import { isGroupOperationalToday } from "./lifecycle";

export const LEVELS = ["E1", "E2", "E3", "Pre 1", "Pre 2", "Pre 3", "Inter 1", "Inter 2", "Inter 3", "Upper 1", "Upper 2", "Upper 3", "Advanced 1", "Advanced 2", "Advanced 3"];
export const LEVEL_COUNTS = ["1", "2", "3", "4", "6"];
export const STUDENT_SOURCES = ["Facebook", "Instagram", "X/Twitter", "TikTok", "ترشيح صديق", "Google", "الموقع", "WhatsApp", "أخرى"] as const;
export const LEAD_FOLLOWUP_OPTIONS = [
  { value: "not_interested", label: "مش مهتم" },
  { value: "interested", label: "مهتم" },
  { value: "call_again", label: "تواصل تاني معاه" },
  { value: "hesitant", label: "متردد" },
  { value: "one_month", label: "عاوز كمان شهر" },
  { value: "waiting_salary", label: "مستني المرتب" },
  { value: "offline", label: "عاوز أوفلاين" },
  { value: "no_money", label: "مش معاه فلوس" },
  { value: "level", label: "هيعمل تحديد مستوى" },
  { value: "level_completed", label: "تم تحديد المستوى" }
] as const;
export const WEEKDAYS = [
  { d: 6, n: "السبت" }, { d: 0, n: "الأحد" }, { d: 1, n: "الاثنين" },
  { d: 2, n: "الثلاثاء" }, { d: 3, n: "الأربعاء" }, { d: 4, n: "الخميس" }, { d: 5, n: "الجمعة" }
] as const;

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const normalise = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ar-EG");
export const live = <T extends { x?: unknown }>(items: T[]) => items.filter((item) => !item.x);
export const toIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export function parseIsoDate(value: string): Date {
  const [year, month, day] = String(value ?? "").split("-").map(Number);
  return new Date(year || 2000, (month || 1) - 1, day || 1);
}

export function formatDate(value?: string, withWeekday = false): string {
  if (!value) return "—";
  const date = parseIsoDate(value.slice(0, 10));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit", month: "2-digit", year: "numeric", ...(withWeekday ? { weekday: "long" } : {})
  }).format(date);
}

export function timeMinutes(value?: string): number {
  const normalized = String(value ?? "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const matched = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM|صباح(?:ا|اً)?|مساء(?:ا|ً)?|ص|م)?/i);
  if (!matched) return -1;
  let hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const suffix = String(matched[3] ?? "").toLocaleLowerCase("ar-EG");
  if (/^(pm|م|مساء)/.test(suffix)) hour = hour % 12 + 12;
  else if (/^(am|ص|صباح)/.test(suffix)) hour %= 12;
  return hour * 60 + minute;
}

function legacyGroupTimeMinutes(group: AcademyGroup): [number, number] | null {
  const matches = [...String(group.t ?? "").matchAll(/\d{1,2}:\d{2}\s*(?:AM|PM|صباح(?:ا|اً)?|مساء(?:ا|ً)?|ص|م)?/gi)];
  if (matches.length < 2) return null;
  const start = timeMinutes(matches[0][0]);
  const end = timeMinutes(matches[1][0]);
  return start >= 0 && end >= 0 ? [start, end] : null;
}

export function groupStartMinutes(group: AcademyGroup): number {
  if (group.t1) return timeMinutes(group.t1);
  return legacyGroupTimeMinutes(group)?.[0] ?? -1;
}

export function endMinutes(group: AcademyGroup): number {
  const legacy = legacyGroupTimeMinutes(group);
  const start = group.t1 ? timeMinutes(group.t1) : legacy?.[0] ?? -1;
  const end = group.t2 ? timeMinutes(group.t2) : legacy?.[1] ?? -1;
  return start > 0 && end >= 0 && end < start ? end + 1440 : end;
}

export function formatTime(value?: string): string {
  const minutes = timeMinutes(value);
  if (minutes < 0) return String(value ?? "");
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function groupTime(group: AcademyGroup): string {
  if (group.t1 || group.t2) return [formatTime(group.t1), formatTime(group.t2)].filter(Boolean).join(" – ");
  return String(group.t ?? "");
}

export function groupLabel(group?: AcademyGroup): string {
  if (!group) return "جروب مؤرشف";
  return [group.p ? "Private" : "", group.lv, group.d, groupTime(group), group.tc].filter(Boolean).join(" · ");
}

export function isRoundActive(data: AcademyData, id: string): boolean {
  const round = data.r.find((item) => item.id === id);
  return Boolean(round && !round.x && !round.pl && round.on !== false);
}

export function nonArchivedGroups(data: AcademyData): AcademyGroup[] {
  const archivedRounds = new Set(data.r.filter((round) => Boolean(round.x)).map((round) => round.id));
  return live(data.g).filter((group) => !group.x && !archivedRounds.has(group.r));
}

export function activeGroups(data: AcademyData): AcademyGroup[] {
  return nonArchivedGroups(data).filter((group) => group.p || isRoundActive(data, group.r));
}

export function currentOperationalGroups(data: AcademyData, today?: string): AcademyGroup[] {
  return activeGroups(data).filter((group) => isGroupOperationalToday(group, today));
}

export function isTeacherDeleted(row: Pick<TeacherHours, "deletedAt">): boolean {
  return Boolean(row.deletedAt);
}

export function isTeacherArchived(row: Pick<TeacherHours, "active" | "archivedAt" | "deletedAt">): boolean {
  return isTeacherDeleted(row) || row.active === false || Boolean(row.archivedAt);
}

export function isTeacherNameArchived(data: AcademyData, name?: string): boolean {
  if (!String(name ?? "").trim()) return false;
  const row = data.teacherHours.find((item) => normalise(item.name) === normalise(name));
  return Boolean(row && isTeacherArchived(row));
}

export function studentKind(student: Student): StudentKind {
  if (student.kind === "new" || student.kind === "old" || student.kind === "returned") return student.kind;
  return student.nw ? "new" : "old";
}

export function canAddStudentToGroup(group: AcademyGroup, activeRosterCount: number): boolean {
  const count = Number.isFinite(activeRosterCount) ? Math.max(0, Math.floor(activeRosterCount)) : 0;
  if (group.p) return count === 0;
  const capacity = Number(group.capacity ?? 0);
  return !Number.isFinite(capacity) || capacity <= 0 || count < capacity;
}

export function copyStudentForGroup(source: Student, group: AcademyGroup, id: string): Student {
  const kind = studentKind(source);
  return {
    id,
    profileId: source.profileId || source.id,
    studentCode: source.studentCode || `SPK-${source.profileId || source.id}`,
    enrollmentType: group.p ? "private" : "group",
    subscriptionClass: "renewal",
    g: group.id,
    r: group.r,
    n: source.n ?? "",
    ph: source.ph ?? "",
    lv: source.lv ?? "",
    nw: kind === "new" ? 1 : 0,
    kind,
    source: source.source ?? "",
    sourceOther: source.sourceOther ?? "",
    pay: 0,
    amount: 0,
    pn: "",
    lvPaid: source.lvPaid ?? 1,
    ren: 0,
    renewalReason: "",
    nt: source.nt ?? ""
  };
}

/** Assigns one stable sequential customer code to each linked student/lead profile. */
export function ensureStudentCodes(data: AcademyData): boolean {
  type CodedRecord = { id: string; profileId?: string; studentCode?: string; copiedFromStudentId?: string; movedFromStudentId?: string; ph?: string; n?: string };
  const records: CodedRecord[] = [...data.m, ...data.l];
  const parents = records.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (first: number, second: number) => {
    const a = find(first); const b = find(second);
    if (a !== b) parents[b] = a;
  };
  const tokenOwner = new Map<string, number>();
  const idOwner = new Map<string, number>();
  const identityOwner = new Map<string, number>();
  const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10)).replace(/\D/g, "");
  records.forEach((record, index) => idOwner.set(record.id, index));
  records.forEach((record, index) => {
    const profile = String(record.profileId ?? "").trim();
    if (profile) {
      const prior = tokenOwner.get(`profile:${profile}`);
      if (prior !== undefined) join(index, prior); else tokenOwner.set(`profile:${profile}`, index);
    }
    for (const linkedId of [record.copiedFromStudentId, record.movedFromStudentId]) {
      if (!linkedId) continue;
      const prior = idOwner.get(linkedId) ?? tokenOwner.get(`id:${linkedId}`);
      if (prior !== undefined) join(index, prior); else tokenOwner.set(`id:${linkedId}`, index);
    }
    const phone = digits(String(record.ph ?? ""));
    const name = normalise(record.n);
    const identity = phone.length >= 8 ? `person:${phone.slice(-9)}:${name}` : name ? `name:${name}` : "";
    if (identity) {
      const prior = identityOwner.get(identity);
      if (prior !== undefined) join(index, prior); else identityOwner.set(identity, index);
    }
  });

  const groups = new Map<number, number[]>();
  records.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  const ordered = [...groups.entries()].sort((a, b) => a[1][0] - b[1][0]);
  const validCodes = ordered.map(([, indexes]) => indexes.map((index) => records[index].studentCode ?? "").map((code) => /^SPK-(\d+)$/i.exec(code)).find(Boolean)?.[1]).filter(Boolean).map(Number);
  let next = Math.max(0, ...validCodes) + 1;
  const used = new Set<number>();
  let changed = false;
  ordered.forEach(([, indexes]) => {
    const firstStudent = indexes.find((index) => index < data.m.length);
    const profileId = indexes.map((index) => records[index].profileId).find((value) => Boolean(String(value ?? "").trim()))
      || records[firstStudent ?? indexes[0]].id;
    const existing = indexes.map((index) => /^SPK-(\d+)$/i.exec(records[index].studentCode ?? "")).find((match) => match && !used.has(Number(match[1])));
    const numericCode = existing ? Number(existing[1]) : next++;
    used.add(numericCode);
    const code = `SPK-${numericCode}`;
    indexes.forEach((index) => {
      if (records[index].profileId !== profileId) { records[index].profileId = profileId; changed = true; }
      if (records[index].studentCode !== code) { records[index].studentCode = code; changed = true; }
    });
  });
  return changed;
}

export function studentKindLabel(kind: StudentKind): string {
  return kind === "new" ? "جديد" : kind === "returned" ? "قديم رجع بعد انقطاع" : "قديم";
}

export function studentSourceLabel(record: Pick<Student | Lead, "source" | "sourceOther" >): string {
  const source = String(record.source ?? "").trim();
  if (!source) return "بدون مصدر";
  return source === "أخرى" && String(record.sourceOther ?? "").trim() ? `أخرى · ${String(record.sourceOther).trim()}` : source;
}

export function teacherNames(data: AcademyData, accounts: TeacherAccount[] = []): string[] {
  const activeByName = new Map(data.teacherHours.map((row) => [normalise(row.name), !isTeacherArchived(row)]));
  const candidates = [
    ...data.teacherHours.map((row) => row.name),
    ...accounts.map((account) => account.name),
    ...nonArchivedGroups(data).map((group) => group.tc)
  ];
  const names = new Map<string, string>();
  candidates.forEach((candidate) => {
    const name = String(candidate ?? "").trim();
    const key = normalise(name);
    if (!key || activeByName.get(key) === false || names.has(key)) return;
    names.set(key, name);
  });
  return [...names.values()].sort((a, b) => a.localeCompare(b, "ar"));
}

export function deleteTeacher(data: AcademyData, name: string, now = Date.now()): void {
  const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
  if (existing) {
    existing.deletedAt = now;
    existing.active = false;
    existing.updatedAt = now;
    return;
  }
  data.teacherHours.push({ name: name.trim(), active: false, deletedAt: now, updatedAt: now });
}

export function canAssignTeacher(data: AcademyData, name: string, accounts: TeacherAccount[] = []): boolean {
  const key = normalise(name);
  return Boolean(key) && teacherNames(data, accounts).some((teacher) => normalise(teacher) === key);
}

export function archiveTeacher(data: AcademyData, name: string, now = Date.now()): void {
  const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
  if (existing) {
    existing.archivedAt = now;
    existing.updatedAt = now;
    return;
  }
  data.teacherHours.push({ name: name.trim(), archivedAt: now, updatedAt: now });
}

export function restoreTeacher(data: AcademyData, name: string, now = Date.now()): void {
  const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
  if (existing) {
    if (isTeacherDeleted(existing)) return;
    delete existing.archivedAt;
    existing.active = true;
    existing.updatedAt = now;
    return;
  }
  data.teacherHours.push({ name: name.trim(), active: true, updatedAt: now });
}

export function saveTeacherWeeklyHours(data: AcademyData, name: string, weeklyHours: number): void {
  const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
  if (existing) {
    existing.weeklyHours = weeklyHours;
    existing.updatedAt = Date.now();
    return;
  }
  data.teacherHours.push({ name, weeklyHours, active: true, updatedAt: Date.now() });
}

export function studentsOf(data: AcademyData, groupId: string): Student[] {
  return live(data.m).filter((student) => student.g === groupId);
}

export function activeStudentsOf(data: AcademyData, groupId: string): Student[] {
  return studentsOf(data, groupId).filter(isEnrolledStudent);
}

export function isEnrolledStudent(student: Student): boolean {
  // Legacy no-renewal flags used to move the original record out of its group.
  // Keep those registrations enrolled; explicit tab moves/copies remain excluded.
  return !student.movedToTab && (!student.formerAt || Number(student.ren) === 2);
}

export function studentsInNonArchivedGroups(data: AcademyData): Student[] {
  const groupIds = new Set(nonArchivedGroups(data).map((group) => group.id));
  return live(data.m).filter((student) => groupIds.has(student.g));
}

export function studentsInRound(data: AcademyData, roundId: string): Student[] {
  if (!roundId) return [];
  const groupIds = new Set(nonArchivedGroups(data).filter((group) => group.r === roundId).map((group) => group.id));
  return studentsInNonArchivedGroups(data).filter((student) => isEnrolledStudent(student) && groupIds.has(student.g));
}

export function activeAttendanceRecords(data: AcademyData, groupId: string): AttendanceRecord[] {
  if (!nonArchivedGroups(data).some((group) => group.id === groupId)) return [];
  const studentIds = new Set(studentsOf(data, groupId).filter(isEnrolledStudent).map((student) => student.id));
  return data.attendance.filter((row) => row.gid === groupId && studentIds.has(row.mid));
}

/** Removes attendance marks when an enrollment is removed from its group or Private record. */
export function removeStudentAttendance(data: AcademyData, studentId: string): number {
  const priorCount = data.attendance.length;
  data.attendance = data.attendance.filter((row) => row.mid !== studentId);
  return priorCount - data.attendance.length;
}

/** Keep attendance only for a non-archived enrollment that still belongs to the recorded group. */
export function pruneOrphanAttendance(data: AcademyData): number {
  const before = data.attendance.length;
  const groups = new Map(data.g.map((group) => [group.id, group]));
  const students = new Map(data.m.map((student) => [student.id, student]));
  data.attendance = data.attendance.filter((row) => {
    const group = groups.get(row.gid);
    const student = students.get(row.mid);
    return Boolean(group && !group.x && student && !student.x && student.g === row.gid && isEnrolledStudent(student));
  });
  return before - data.attendance.length;
}

export function privateGroupCanAccept(data: AcademyData, groupId: string, movingStudentId?: string): boolean {
  return !data.m.some((student) => student.g === groupId && !student.x && isEnrolledStudent(student) && student.id !== movingStudentId);
}

export function groupDays(group: AcademyGroup): number[] {
  const text = String(group.d ?? "").replace(/[أإآ]/g, "ا");
  const matchers: [RegExp, number][] = [
    [/الاحد|الأحد/, 0], [/الاثنين|الإثنين/, 1], [/الثلاثاء/, 2], [/الاربعاء|الأربعاء/, 3],
    [/الخميس/, 4], [/الجمعة/, 5], [/السبت/, 6]
  ];
  return matchers.filter(([matcher]) => matcher.test(text)).map(([, day]) => day);
}

export function attendanceKey(row: Pick<AttendanceRecord, "date" | "gid" | "mid">): string {
  return `${row.date}|${row.gid}|${row.mid}`;
}

export function attendanceFor(data: AcademyData, date: string, groupId: string, studentId: string): AttendanceRecord | undefined {
  return data.attendance.find((item) => item.date === date && item.gid === groupId && item.mid === studentId && Boolean(item.status));
}

export function leadBucket(lead: Lead): "next" | "leads" {
  const source = normalise(lead.source_sheet);
  if (lead.bucket === "next" || source.includes("next round") || source.includes("الراوند الجاي")) return "next";
  return "leads";
}

/** Normalizes customer codes copied from cards, including Arabic digits and separators. */
export function normalizeStudentCode(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isStudentCodeQuery(value: unknown): boolean {
  const query = normalizeStudentCode(value);
  return query.startsWith("SPK") && query.length > 3;
}

/** Matches a full SPK code (spacing/punctuation/digits normalized) or its exact numeric suffix. */
export function matchesStudentCode(code: unknown, query: unknown): boolean {
  const normalizedCode = normalizeStudentCode(code);
  const normalizedQuery = normalizeStudentCode(query);
  if (!normalizedCode || !normalizedQuery) return false;
  if (normalizedQuery.startsWith("SPK")) return normalizedQuery.length > 3 && normalizedCode === normalizedQuery;
  return /^\d+$/.test(normalizedQuery) && normalizedCode.startsWith("SPK") && normalizedCode.slice(3) === normalizedQuery;
}

export function leadFollowupDate(lead: Lead): string {
  return String(lead.fd ?? lead.followupDate ?? "");
}

export function leadCategory(lead: Lead): string {
  const category = String(lead.followupCat ?? "");
  if (category === "level_completed") return "level";
  if (["level", "contact", "waiting", "later", "done"].includes(category)) return category;
  if (["not_interested", "interested", "call_again", "one_month", "waiting_salary", "offline", "no_money", "hesitant"].includes(category)) {
    if (category === "not_interested") return "done";
    if (["hesitant"].includes(category)) return "waiting";
    if (category === "interested") return "contact";
    return "later";
  }
  const detailedCategory: Record<string, string> = {
    interested: "contact",
    not_interested: "done",
    call_again: "later",
    one_month: "later",
    waiting_salary: "later",
    hesitant: "waiting",
    no_money: "later",
    offline: "later",
    not_answering: "waiting"
  };
  if (detailedCategory[category]) return detailedCategory[category];
  if (/مكتمل|اشترك|مش مهتم|غير مهتم|لا يحتاج|مش محتاج/.test(String(lead.st ?? ""))) return "done";
  if (!String(lead.lv ?? "").trim()) return "level";
  if (lead.st === "مستني رد") return "waiting";
  return "contact";
}

export function isTerminalLead(lead: Lead): boolean {
  return leadCategory(lead) === "done" || /مكتمل|اشترك|مش مهتم|غير مهتم|لا يحتاج|مش محتاج/.test(String(lead.st ?? ""));
}

export function leadPriority(lead: Lead): number {
  if (isTerminalLead(lead)) {
    const status = String(lead.st ?? "");
    if (/مكتمل|اشترك/.test(status)) return 90;
    if (/لا يحتاج|مش محتاج/.test(status)) return 91;
    if (/مش مهتم|غير مهتم/.test(status)) return 92;
    return 99;
  }
  const cat = leadCategory(lead);
  if (cat === "level") return 1;
  if (cat === "contact") return 2;
  if (cat === "waiting") return 3;
  if (cat === "later") return 4;
  return 5;
}

export function sortLeads(items: Lead[]): Lead[] {
  return [...items].sort((a, b) => leadPriority(a) - leadPriority(b) || Number(b.ts ?? 0) - Number(a.ts ?? 0));
}

export function colourForGroup(group: AcademyGroup): string {
  const colours = ["#bfe6df", "#bfdbfe", "#fde68a", "#fbcfe8", "#ddd6fe", "#bbf7d0", "#fed7aa", "#bae6fd", "#fecdd3", "#d9f99d"];
  const key = String(group.id || group.lv || group.tc || "group");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return colours[hash % colours.length];
}

export function roundName(round?: Round): string { return String(round?.n ?? "راوند بدون اسم"); }

export function incomeStudentsForMonth(data: AcademyData, month: string): { student: Student; group: AcademyGroup }[] {
  const groups = nonArchivedGroups(data);
  const byId = new Map(groups.map((group) => [group.id, group]));
  return live(data.m).flatMap((student) => {
    const group = byId.get(student.g);
    if (!group || !isEnrolledStudent(student) || Number(student.amount) <= 0 || (group.s?.slice(0, 7) || monthKey()) !== month) return [];
    return [{ student, group }];
  });
}

export function incomeForMonth(data: AcademyData, month: string): number {
  return incomeStudentsForMonth(data, month).reduce((total, row) => total + Number(row.student.amount ?? 0), 0);
}

export function incomeStudentsByKindForMonth(data: AcademyData, month: string): Record<StudentKind, { student: Student; group: AcademyGroup }[]> {
  const rows = incomeStudentsForMonth(data, month);
  return {
    new: rows.filter(({ student }) => studentKind(student) === "new"),
    old: rows.filter(({ student }) => studentKind(student) === "old"),
    returned: rows.filter(({ student }) => studentKind(student) === "returned")
  };
}

export function expenseForMonth(data: AcademyData, month: string): number {
  return data.finance.filter((row) => row.type === "expense" && !row.x && row.date?.slice(0, 7) === month)
    .reduce((total, row) => total + Number(row.amount ?? 0), 0);
}

export function totalCurrentStudents(data: AcademyData): number {
  return currentStudentCounts(data).total;
}

export function currentStudentCounts(data: AcademyData, operationalGroups: AcademyGroup[] = currentOperationalGroups(data)): { groups: number; private: number; total: number } {
  const groups = new Map(operationalGroups.map((group) => [group.id, group]));
  const counts = { groups: 0, private: 0, total: 0 };
  live(data.m).filter(isEnrolledStudent).forEach((student) => {
    const group = groups.get(student.g);
    if (!group) return;
    counts.total += 1;
    if (group.p) counts.private += 1;
    else counts.groups += 1;
  });
  return counts;
}

export function formerStudents(data: AcademyData, today = toIsoDate()): { student: Student; group: AcademyGroup }[] {
  const groups = new Map(nonArchivedGroups(data).map((group) => [group.id, group]));
  const identity = (student: Student) => {
    const digits = String(student.ph ?? "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "");
    return digits.length >= 8 ? `p:${digits}` : `n:${normalise(student.n)}`;
  };
  const isCurrent = (group: AcademyGroup) => {
    const roundActive = isRoundActive(data, group.r) || Boolean(group.p && group.r === "pv" && (!group.e || group.e >= today));
    return roundActive && (!group.e || group.e >= today);
  };
  const activePeople = new Set(live(data.m).flatMap((student) => {
    const group = groups.get(student.g);
    return isEnrolledStudent(student) && group && isCurrent(group) ? [identity(student)] : [];
  }));
  const former = new Map<string, { student: Student; group: AcademyGroup }>();
  live(data.m).forEach((student) => {
    if (student.movedToTab) return;
    const group = groups.get(student.g);
    if (!group || (isEnrolledStudent(student) && (isCurrent(group) || activePeople.has(identity(student))))) return;
    const key = identity(student);
    const uniqueKey = student.formerAt ? student.id : key;
    const old = former.get(uniqueKey);
    if (!old || String(group.e ?? group.s ?? "") > String(old.group.e ?? old.group.s ?? "")) former.set(uniqueKey, { student, group });
  });
  return [...former.values()].sort((a, b) => String(a.student.fd ?? a.group.e ?? "").localeCompare(String(b.student.fd ?? b.group.e ?? "")));
}

export function safeCopy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}


export function uniquePhoneNumbers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const display = String(value ?? "").trim();
    const normalized = display.replace(/[^\d+]/g, "");
    if (!/\d/.test(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(display);
  });
  return result;
}
