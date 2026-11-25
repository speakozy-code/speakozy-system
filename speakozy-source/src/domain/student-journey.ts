import type { AcademyData, AcademyGroup, Lead, Round, Student } from "./types";
import { customerStage, isActiveStudentEnrollment, sameStudentIdentity, type CustomerStage, type PersonRecord } from "./customer-stage";
import { plannedGroupEndDate } from "./schedule";
import { leadBucket } from "./utils";

export type EnrollmentStatus = "running" | "finished" | "archived-group" | "archived-row" | "missing-group";

export interface JourneyEnrollment {
  student: Student;
  group?: AcademyGroup;
  round?: Round;
  isPrivate: boolean;
  level: string;
  start: string;
  end: string;
  status: EnrollmentStatus;
}

export interface JourneyMove { student: Student; at: number; destination: string; auto: boolean }
export interface JourneyLead { lead: Lead; bucket: "next" | "leads"; archived: boolean }
export interface JourneyNote { at: number; text: string; source: string }

export interface StudentJourney {
  name: string;
  phone: string;
  stage: CustomerStage;
  enrollments: JourneyEnrollment[];
  moves: JourneyMove[];
  leads: JourneyLead[];
  notes: JourneyNote[];
}

const iso = (value: unknown) => String(value ?? "").slice(0, 10);
// Imported rows contain junk in the level field ("paid", "23"); only show level-looking values.
const levelText = (value: unknown) => { const text = String(value ?? "").trim(); return /^(e\d|pre|inter|int|upper|in\d)/i.test(text) ? text : ""; };

/**
 * Read-only history of one person, matched across students, leads and former-customer copies
 * by the same identity rule used everywhere else. Nothing here changes data.
 */
export function studentJourney(person: PersonRecord, data: AcademyData): StudentJourney {
  const groups = new Map(data.g.map((group) => [group.id, group]));
  const rounds = new Map(data.r.map((round) => [round.id, round]));
  const matches = data.m.filter((student) => sameStudentIdentity(person, student));
  const leadRows = (data.l ?? []).filter((lead) => sameStudentIdentity(person, lead));

  const enrollments: JourneyEnrollment[] = matches
    .filter((student) => !student.movedToTab)
    .map((student) => {
      const group = groups.get(student.g);
      const round = group ? rounds.get(group.r) : undefined;
      let status: EnrollmentStatus = "finished";
      if (student.x) status = "archived-row";
      else if (!group) status = "missing-group";
      else if (group.x || round?.x) status = "archived-group";
      else if (isActiveStudentEnrollment(student, data)) status = "running";
      return {
        student, group, round,
        isPrivate: Boolean(group?.p),
        level: (group && !group.p ? levelText(group.lv) : "") || levelText(student.lv),
        start: group ? iso(group.s) : "",
        end: group ? iso(plannedGroupEndDate(group)) : "",
        status
      };
    })
    .sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"));

  const moves: JourneyMove[] = matches
    .filter((student) => student.movedToTab)
    .map((student) => ({ student, at: Number(student.formerAt ?? 0), destination: String(student.movedToTab), auto: Boolean(student.autoFormerCustomer) }))
    .sort((a, b) => a.at - b.at);

  const leads: JourneyLead[] = leadRows
    .map((lead) => ({ lead, bucket: leadBucket(lead), archived: Boolean(lead.x) }))
    .sort((a, b) => Number(a.lead.ts ?? 0) - Number(b.lead.ts ?? 0));

  const notes: JourneyNote[] = [...matches, ...leadRows].flatMap((record) =>
    (Array.isArray(record.fh) ? record.fh : []).flatMap((entry) => {
      const item = entry as { t?: unknown; n?: unknown };
      const text = String(item?.n ?? "").trim();
      return text ? [{ at: Number(item.t ?? 0), text, source: "x" in record && "g" in record ? "طالب" : "ليد" }] : [];
    })
  ).sort((a, b) => b.at - a.at);

  const best = matches[0] ?? leadRows[0] ?? person;
  return {
    name: String(best.n ?? person.n ?? "").trim() || "بدون اسم",
    phone: String(best.ph ?? person.ph ?? ""),
    stage: customerStage(person, data),
    enrollments, moves, leads, notes
  };
}
