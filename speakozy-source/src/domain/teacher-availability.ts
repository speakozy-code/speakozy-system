import type { AcademyData, AcademyGroup, TeacherHours } from "./types";
import { activeGroups, endMinutes, groupDays, groupStartMinutes, normalise, timeMinutes, toIsoDate, WEEKDAYS } from "./utils";
import { plannedGroupEndDate } from "./schedule";

export interface BusyBlock { groupId: string; label: string; from: number; to: number; isPrivate: boolean }
export interface FreeRange { from: number; to: number }
export interface TeacherDay { day: number; name: string; busy: BusyBlock[]; free: FreeRange[]; works: boolean }
export type WorkDays = NonNullable<TeacherHours["workDays"]>;

export const AVAILABILITY_FROM = 17 * 60;
export const AVAILABILITY_TO = 24 * 60;

export function minutesToTime(value: number): string {
  const clamped = Math.min(1439, Math.max(0, value));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Groups that still take the teacher's time: running now or starting later, not finished. */
function occupyingGroups(data: AcademyData, teacher: string, today: string, ignoreGroupId?: string): AcademyGroup[] {
  const key = normalise(teacher);
  if (!key) return [];
  return activeGroups(data).filter((group) => {
    if (group.id === ignoreGroupId || normalise(group.tc) !== key) return false;
    const end = plannedGroupEndDate(group);
    return !end || end >= today;
  });
}

export function teacherWorkDays(data: AcademyData, teacher: string): WorkDays | null {
  const row = data.teacherHours.find((item) => normalise(item.name) === normalise(teacher));
  return row?.workDays && typeof row.workDays === "object" ? row.workDays : null;
}

/** Save the weekdays and hours a teacher works. Days left out are days off. */
export function saveTeacherWorkDays(data: AcademyData, name: string, workDays: WorkDays): void {
  const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
  if (existing) { existing.workDays = workDays; existing.updatedAt = Date.now(); return; }
  data.teacherHours.push({ name, workDays, active: true, updatedAt: Date.now() });
}

function workWindow(range: { from: string; to: string }): FreeRange | null {
  const from = timeMinutes(range.from);
  let to = timeMinutes(range.to);
  if (to === 0) to = 1440;
  return from >= 0 && to > from ? { from, to: Math.min(to, 1440) } : null;
}

/**
 * Weekly picture for one teacher: the hours he works (from his work days; if none were set, every day
 * 5 PM-12 AM) minus what his running or upcoming groups and Private already take.
 */
export function teacherWeek(data: AcademyData, teacher: string, today = toIsoDate(), ignoreGroupId?: string): TeacherDay[] {
  const groups = occupyingGroups(data, teacher, today, ignoreGroupId);
  const configured = teacherWorkDays(data, teacher);
  return WEEKDAYS.map(({ d, n }) => {
    const window: FreeRange | null = configured
      ? (configured[String(d)] ? workWindow(configured[String(d)]) : null)
      : { from: AVAILABILITY_FROM, to: AVAILABILITY_TO };
    const busy: BusyBlock[] = groups.flatMap((group) => {
      if (!groupDays(group).includes(d)) return [];
      const from = groupStartMinutes(group);
      const to = endMinutes(group);
      if (from < 0 || to <= from) return [];
      return [{ groupId: group.id, label: group.p ? `Private · ${group.lv ?? ""}` : String(group.lv ?? "جروب"), from, to, isPrivate: Boolean(group.p) }];
    }).sort((a, b) => a.from - b.from);
    const free: FreeRange[] = [];
    if (window) {
      let cursor = window.from;
      for (const block of busy) {
        if (block.to <= cursor) continue;
        if (block.from > cursor) free.push({ from: cursor, to: Math.min(block.from, window.to) });
        cursor = Math.max(cursor, block.to);
        if (cursor >= window.to) break;
      }
      if (cursor < window.to) free.push({ from: cursor, to: window.to });
    }
    return { day: d, name: n, busy, free: free.filter((range) => range.to > range.from), works: Boolean(window) };
  });
}
