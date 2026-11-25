import type { AcademyData, AcademyGroup } from "./types";
import { activeGroups, endMinutes, groupDays, groupStartMinutes, normalise, toIsoDate, WEEKDAYS } from "./utils";
import { plannedGroupEndDate } from "./schedule";

export interface BusyBlock { groupId: string; label: string; from: number; to: number; isPrivate: boolean }
export interface FreeRange { from: number; to: number }
export interface TeacherDay { day: number; name: string; busy: BusyBlock[]; free: FreeRange[] }

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

/** Weekly picture for one teacher between 5 PM and midnight: what is taken and what is free. */
export function teacherWeek(data: AcademyData, teacher: string, today = toIsoDate(), ignoreGroupId?: string): TeacherDay[] {
  const groups = occupyingGroups(data, teacher, today, ignoreGroupId);
  return WEEKDAYS.map(({ d, n }) => {
    const busy: BusyBlock[] = groups.flatMap((group) => {
      if (!groupDays(group).includes(d)) return [];
      const from = groupStartMinutes(group);
      const to = endMinutes(group);
      if (from < 0 || to <= from) return [];
      return [{ groupId: group.id, label: group.p ? `Private · ${group.lv ?? ""}` : String(group.lv ?? "جروب"), from, to, isPrivate: Boolean(group.p) }];
    }).sort((a, b) => a.from - b.from);
    const free: FreeRange[] = [];
    let cursor = AVAILABILITY_FROM;
    for (const block of busy) {
      if (block.from > cursor) free.push({ from: cursor, to: Math.min(block.from, AVAILABILITY_TO) });
      cursor = Math.max(cursor, block.to);
      if (cursor >= AVAILABILITY_TO) break;
    }
    if (cursor < AVAILABILITY_TO) free.push({ from: cursor, to: AVAILABILITY_TO });
    return { day: d, name: n, busy, free: free.filter((range) => range.to > range.from) };
  });
}
