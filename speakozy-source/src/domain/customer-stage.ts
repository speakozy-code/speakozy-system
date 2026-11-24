import type { AcademyData, Lead, Student } from "./types";
import { isGroupOperationalToday } from "./lifecycle";
import { isEnrolledStudent, isRoundActive, leadBucket, live, normalise } from "./utils";

/**
 * One place that decides where a customer lives right now.
 *
 * Rule: a person with a live enrollment (a student row in a running round, or an
 * active Private) may appear in exactly one operational place. Finished rounds keep
 * their student rows as history; they never count as "live" and are never removed.
 */
export type PersonRecord = {
  id: string;
  profileId?: string;
  studentCode?: string;
  n?: string;
  ph?: string;
  movedToLeadId?: string;
  movedFromStudentId?: string;
  copiedFromStudentId?: string;
};

export type CustomerStage = "group" | "private" | "next" | "lead" | "former" | "none";

export function studentCodeFor(record: PersonRecord): string {
  const stableId = String(record.profileId || record.movedFromStudentId || record.copiedFromStudentId || record.id);
  return record.studentCode || `SPK-${stableId}`;
}

export function personPhone(value?: string): string {
  return String(value ?? "")
    .replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10))
    .replace(/\D/g, "");
}

export function samePerson(first: PersonRecord, second: PersonRecord): boolean {
  const firstIds = [first.profileId, first.id, first.movedToLeadId, first.movedFromStudentId, first.copiedFromStudentId].filter(Boolean);
  const secondIds = [second.profileId, second.id, second.movedToLeadId, second.movedFromStudentId, second.copiedFromStudentId].filter(Boolean);
  if (firstIds.some((id) => secondIds.includes(id))) return true;
  const firstPhone = personPhone(first.ph);
  const secondPhone = personPhone(second.ph);
  if (firstPhone.length >= 8 && secondPhone.length >= 8) return firstPhone.slice(-9) === secondPhone.slice(-9);
  return firstPhone.length < 8 && secondPhone.length < 8 && Boolean(normalise(first.n)) && normalise(first.n) === normalise(second.n);
}

export function sameStudentIdentity(first: PersonRecord, second: PersonRecord): boolean {
  if (samePerson(first, second)) return true;
  return studentCodeFor(first).toLocaleUpperCase() === studentCodeFor(second).toLocaleUpperCase();
}

/** A student row that counts as a current enrollment: not deleted, in a running round (or active Private). */
export function isActiveStudentEnrollment(student: Student, data: AcademyData): boolean {
  if (student.x || !isEnrolledStudent(student)) return false;
  const group = data.g.find((item) => item.id === student.g);
  if (!group || group.x || !isGroupOperationalToday(group)) return false;
  return group.p ? true : isRoundActive(data, group.r);
}

export function activeEnrollmentsOf(person: PersonRecord, data: AcademyData): Student[] {
  return live(data.m).filter((student) => sameStudentIdentity(person, student) && isActiveStudentEnrollment(student, data));
}

export function hasActiveStudentEnrollment(person: PersonRecord, data: AcademyData): boolean {
  return activeEnrollmentsOf(person, data).length > 0;
}

export function customerStage(person: PersonRecord, data: AcademyData): CustomerStage {
  const active = activeEnrollmentsOf(person, data)[0];
  if (active) return data.g.find((group) => group.id === active.g)?.p ? "private" : "group";
  const lead = live(data.l ?? []).find((item) => !item.convertedStudentId && sameStudentIdentity(person, item));
  if (lead) return leadBucket(lead) === "next" ? "next" : "lead";
  const former = live(data.m).some((student) => sameStudentIdentity(person, student) && (student.movedToTab === "renewals" || student.formerAt));
  return former ? "former" : "none";
}

export interface LiveDuplicate {
  kind: "active-and-lead" | "active-and-former-copy" | "active-twice";
  person: string;
  phone: string;
  ids: string[];
}

/**
 * People who break the one-live-place rule. Read-only: it never changes data.
 * Finished-round history rows are ignored on purpose.
 */
export function findLiveDuplicates(data: AcademyData): LiveDuplicate[] {
  const out: LiveDuplicate[] = [];
  const seen: Student[] = [];
  live(data.m).filter((student) => isActiveStudentEnrollment(student, data)).forEach((student) => {
    if (seen.some((other) => sameStudentIdentity(student, other))) return;
    seen.push(student);
    const active = activeEnrollmentsOf(student, data);
    const name = student.n?.trim() || "بدون اسم";
    const phone = student.ph ?? "";
    if (active.length > 1) out.push({ kind: "active-twice", person: name, phone, ids: active.map((item) => item.id) });
    const leads = live(data.l ?? []).filter((lead: Lead) => !lead.convertedStudentId && sameStudentIdentity(student, lead));
    if (leads.length) out.push({ kind: "active-and-lead", person: name, phone, ids: leads.map((lead) => lead.id) });
    const copies = live(data.m).filter((item) => item.movedToTab && !isActiveStudentEnrollment(item, data) && sameStudentIdentity(student, item) && item.id !== student.id);
    if (copies.length) out.push({ kind: "active-and-former-copy", person: name, phone, ids: copies.map((item) => item.id) });
  });
  return out;
}
