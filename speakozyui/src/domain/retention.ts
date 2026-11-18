import type { AcademyData, AcademyGroup, Student } from "./types";
import { isEnrolledStudent, live, nonArchivedGroups, normalise } from "./utils";

export interface RetentionEntry {
  student: Student;
  group: AcademyGroup;
  key: string;
  paid: boolean;
  kept: boolean;
  pending: boolean;
}

export interface RetentionMonth {
  month: string;
  registrations: RetentionEntry[];
  paidRows: RetentionEntry[];
  nextMonth: string;
}

function retentionKey(student: Student): string {
  if (student.profileId) return `id:${student.profileId}`;
  const phone = String(student.ph ?? "").replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632)).replace(/\D/g, "");
  if (phone.length >= 9) return `p${phone.slice(-9)}`;
  const name = normalise(student.n);
  return name ? `n${name}` : "";
}

function isPaid(student: Student): boolean {
  return Number(student.pay) === 1 || Number(student.pay) === 2;
}

function nextCalendarMonth(month: string): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Number(yearText), Number(monthText) || 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function retentionByMonth(data: AcademyData): RetentionMonth[] {
  // Completed cohorts stay in retention while archived groups and rounds remain excluded.
  const eligibleGroups = nonArchivedGroups(data).filter((group) => Boolean(group.s));
  const groupsById = new Map(eligibleGroups.map((group) => [group.id, group]));
  const months = new Map<string, RetentionEntry[]>();

  live(data.m).forEach((student) => {
    if (!isEnrolledStudent(student)) return;
    const group = groupsById.get(student.g);
    if (!group || !group.s) return;
    const month = group.s.slice(0, 7);
    const list = months.get(month) ?? [];
    list.push({ student, group, key: retentionKey(student), paid: isPaid(student), kept: false, pending: false });
    months.set(month, list);
  });

  const keys = [...months.keys()].sort();
  return keys.map((month) => {
    const registrations = months.get(month) ?? [];
    const paidRows = registrations.filter((row) => row.paid);
    const expectedNextMonth = nextCalendarMonth(month);
    const nextMonth = months.has(expectedNextMonth) ? expectedNextMonth : "";
    if (nextMonth) {
      const nextRows = months.get(nextMonth) ?? [];
      const nextPaid = new Set(nextRows.filter((row) => row.paid && row.key).map((row) => row.key));
      const nextRegistered = new Set(nextRows.filter((row) => row.key).map((row) => row.key));
      paidRows.forEach((row) => {
        row.kept = Boolean(row.key && nextPaid.has(row.key));
        row.pending = !row.kept && Boolean(row.key && nextRegistered.has(row.key));
      });
    }
    return { month, registrations, paidRows, nextMonth };
  });
}
