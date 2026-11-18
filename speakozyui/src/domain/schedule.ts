import type { AcademyGroup, AttendanceRecord, FeedbackMilestone, Session, SessionHours } from "./types";
import { endMinutes, groupDays, groupStartMinutes, normalise, parseIsoDate, toIsoDate } from "./utils";

export interface TeacherScheduleConflict {
  first: AcademyGroup;
  second: AcademyGroup;
  dates: string[];
}

function nextDay(iso: string, days: number[]): string {
  const date = parseIsoDate(iso);
  for (let i = 0; i < 14; i += 1) {
    date.setDate(date.getDate() + 1);
    if (days.includes(date.getDay())) return toIsoDate(date);
  }
  return iso;
}

function onOrAfterScheduledDay(iso: string, days: number[]): string | null {
  const date = parseIsoDate(iso);
  if (Number.isNaN(date.getTime()) || !days.length) return null;
  for (let i = 0; i < 14; i += 1) {
    if (days.includes(date.getDay())) return toIsoDate(date);
    date.setDate(date.getDate() + 1);
  }
  return null;
}

export function generateSessions(group: AcademyGroup, fromDate?: string): Session[] {
  const days = groupDays(group);
  const startDate = fromDate && (!group.s || fromDate > group.s.slice(0, 10)) ? fromDate : group.s;
  if (!startDate || !days.length) return [];
  const date = parseIsoDate(startDate);
  const sessions: Session[] = [];
  let guard = 0;
  while (sessions.length < 8 && guard < 120) {
    if (group.e && toIsoDate(date) > group.e.slice(0, 10)) break;
    if (days.includes(date.getDay())) {
      const iso = toIsoDate(date);
      sessions.push({ k: iso, d: iso });
    }
    date.setDate(date.getDate() + 1);
    guard += 1;
  }
  return sessions;
}

export function sessionsOf(group: AcademyGroup): Session[] {
  return Array.isArray(group.ss) && group.ss.length ? group.ss : generateSessions(group);
}

export function feedbackSessionsDue(groups: AcademyGroup[], today = toIsoDate()): { group: AcademyGroup; milestone: FeedbackMilestone; sessionDate: string }[] {
  const milestones: FeedbackMilestone[] = [1, 4, 7];
  return groups.flatMap((group) => {
    const heldSessions = sessionsOf(group)
      .filter((session) => !session.c)
      .map((session) => String(session.d ?? session.k).slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    return milestones.flatMap((milestone) => {
      const sessionDate = heldSessions[milestone - 1];
      if (!sessionDate || sessionDate > today || Number(group.feedbackSentAt?.[milestone] ?? 0) > 0) return [];
      return [{ group, milestone, sessionDate }];
    });
  });
}
export function isCancelledOn(group: AcademyGroup, date: string): boolean {
  return sessionsOf(group).some((session) => session.c && String(session.d ?? session.k).slice(0, 10) === date);
}

export function durationHours(group: AcademyGroup): number {
  const start = groupStartMinutes(group);
  const end = endMinutes(group);
  return start >= 0 && end > start ? (end - start) / 60 : 0;
}

function sessionIdentity(session: Session): string {
  return `${String(session.d ?? session.k).slice(0, 10)}:${session.c ? "c" : "a"}:${String(session.rescheduledFrom ?? "")}`;
}

function plannedSchedule(group: AcademyGroup): { group: AcademyGroup; sessions: Session[]; actualKeys: Set<string> } {
  if (group.x) return { group, sessions: [], actualKeys: new Set() };
  const actual = sessionsOf(group).map((session) => ({ ...session }));
  const incomplete = groupDays(group).length > 0 && actual.filter((session) => !session.c).length < 8;
  const completed = incomplete ? ensureEightActiveSessions({ ...group, ss: actual }, actual) : { ...group, ss: actual };
  return { group: completed, sessions: sessionsOf(completed), actualKeys: new Set(actual.map(sessionIdentity)) };
}

export function plannedGroupEndDate(group: AcademyGroup): string {
  const plan = plannedSchedule(group);
  const lastSession = plan.sessions
    .filter((session) => !session.c)
    .map((session) => String(session.d ?? session.k).slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    .at(-1);
  return String(plan.group.e ?? lastSession ?? "").slice(0, 10);
}

export function scheduledSessionsOnDate(group: AcademyGroup, date: string): Session[] {
  return plannedSchedule(group).sessions.filter((session) => String(session.d ?? session.k).slice(0, 10) === date);
}

export function teacherSessionsForMonth(groups: AcademyGroup[], month: string): { group: AcademyGroup; session: Session; suggested: boolean }[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return groups.flatMap((group) => {
    const plan = plannedSchedule(group);
    return plan.sessions
      .filter((session) => String(session.d ?? session.k).slice(0, 7) === month)
      .map((session) => ({ group, session, suggested: !plan.actualKeys.has(sessionIdentity(session)) }));
  }).sort((a, b) => String(a.session.d ?? a.session.k).localeCompare(String(b.session.d ?? b.session.k)) || String(a.group.lv ?? "").localeCompare(String(b.group.lv ?? ""), "ar"));
}

function scheduledDateSet(group: AcademyGroup): Set<string> {
  return new Set(plannedSchedule(group).sessions
    .filter((session) => !session.c)
    .map((session) => String(session.d ?? session.k).slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
}

function timesOverlap(first: AcademyGroup, second: AcademyGroup): boolean {
  const firstStart = groupStartMinutes(first);
  const firstEnd = endMinutes(first);
  const secondStart = groupStartMinutes(second);
  const secondEnd = endMinutes(second);
  if (firstStart < 0 || secondStart < 0 || firstEnd <= firstStart || secondEnd <= secondStart) return false;
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function teacherScheduleConflicts(groups: AcademyGroup[], candidate: AcademyGroup): TeacherScheduleConflict[] {
  const teacher = normalise(candidate.tc);
  if (!teacher || candidate.x || !groupDays(candidate).length) return [];
  const candidateDates = scheduledDateSet(candidate);
  if (!candidateDates.size) return [];
  return groups.flatMap((group) => {
    if (group.id === candidate.id || group.x || normalise(group.tc) !== teacher || !timesOverlap(candidate, group)) return [];
    if (!groupDays(candidate).some((day) => groupDays(group).includes(day))) return [];
    const dates = [...scheduledDateSet(group)].filter((date) => candidateDates.has(date)).sort();
    return dates.length ? [{ first: candidate, second: group, dates }] : [];
  });
}

export function allTeacherScheduleConflicts(groups: AcademyGroup[]): TeacherScheduleConflict[] {
  const active = groups.filter((group) => !group.x);
  return active.flatMap((group, index) => teacherScheduleConflicts(active.slice(index + 1), group));
}

export function monthTeacherHours(groups: AcademyGroup[], month: string): { sessions: number; hours: number; details: SessionHours[] } {
  if (!/^\d{4}-\d{2}$/.test(month)) return { sessions: 0, hours: 0, details: [] };
  const details: SessionHours[] = [];
  let sessions = 0;
  let hours = 0;
  groups.forEach((group) => {
    if (group.x) return;
    const duration = durationHours(group);
    if (!duration) return;
    const counted = new Set(plannedSchedule(group).sessions
      .filter((session) => !session.c && String(session.d ?? session.k).slice(0, 7) === month)
      .map((session) => String(session.d ?? session.k).slice(0, 10)));
    const count = counted.size;
    if (count) {
      const groupHours = count * duration;
      sessions += count;
      hours += groupHours;
      details.push({ group, sessions: count, hours: groupHours });
    }
  });
  return { sessions, hours, details };
}

export function weeklyScheduledHours(groups: AcademyGroup[]): number {
  return groups.reduce((total, group) => total + (group.x ? 0 : durationHours(group) * groupDays(group).length), 0);
}

function ensureActiveSessionCount(group: AcademyGroup, source: Session[], targetCount: number): AcademyGroup {
  const sessions = source.map((session) => ({ ...session }));
  const originalLatest = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const currentEnd = String(group.e ?? "").slice(0, 10);
  const endTracksSchedule = Boolean(currentEnd && currentEnd === originalLatest);
  const days = groupDays(group);
  let latest = originalLatest ?? String(group.s ?? toIsoDate()).slice(0, 10);
  let activeCount = sessions.filter((session) => !session.c).length;
  let guard = 0;
  while (activeCount < targetCount && days.length && guard < 40) {
    let next = nextDay(latest, days);
    let collisionGuard = 0;
    while (sessions.some((session) => String(session.d ?? session.k).slice(0, 10) === next) && collisionGuard < 64) {
      next = nextDay(next, days);
      collisionGuard += 1;
    }
    if (collisionGuard >= 64 || next === latest) break;
    sessions.push({ k: next, d: next, c: 0 });
    latest = next;
    activeCount += 1;
    guard += 1;
  }
  sessions.sort((a, b) => String(a.d ?? a.k).slice(0, 10).localeCompare(String(b.d ?? b.k).slice(0, 10)));
  const latestDate = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const result = { ...group, ss: sessions };
  if (latestDate && (!currentEnd || latestDate > currentEnd || endTracksSchedule)) result.e = latestDate;
  return result;
}

export function ensureEightActiveSessions(group: AcademyGroup, source: Session[] = sessionsOf(group)): AcademyGroup {
  const sessions = source.map((session) => ({ ...session }));
  return ensureActiveSessionCount(group, sessions, Math.max(8, sessions.filter((session) => !session.c).length));
}

export function rescheduleGroupPreservingAttendance(previousGroup: AcademyGroup, updatedGroup: AcademyGroup, attendance: AttendanceRecord[]): AcademyGroup {
  const source = sessionsOf(previousGroup);
  const dateOf = (value: unknown) => String(value ?? "").slice(0, 10);
  const sessionDate = (session: Session) => dateOf(session.k ?? session.d);
  const sessionMatchesDate = (session: Session, date: string) => dateOf(session.k) === date || dateOf(session.d) === date;
  const recordedDates = new Set(attendance
    .filter((record) => record.gid === previousGroup.id && Boolean(record.status))
    .map((record) => dateOf(record.date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  const cancelled = source.filter((session) => Boolean(session.c)).map((session) => {
    const markedDate = [...recordedDates].find((date) => sessionMatchesDate(session, date));
    return markedDate ? { ...session, k: markedDate, d: markedDate } : { ...session };
  });
  const cancelledDates = new Set(cancelled.map(sessionDate));
  const activeRecordedDates = [...recordedDates].filter((date) => !cancelled.some((session) => sessionMatchesDate(session, date)));
  const preserved: Session[] = activeRecordedDates.map((date) => {
    const existing = source.find((session) => !session.c && sessionMatchesDate(session, date));
    return existing ? { ...existing, k: date, d: date, c: 0 as const } : { k: date, d: date };
  });
  const excludedDates = new Set([...recordedDates, ...cancelled.flatMap((session) => [dateOf(session.k), dateOf(session.d)])]);
  const targetActiveCount = Math.max(8, activeRecordedDates.length);
  const days = groupDays(updatedGroup);
  const cursor = parseIsoDate(String(updatedGroup.s || toIsoDate()).slice(0, 10));
  const generated: Session[] = [];
  let guard = 0;
  while (days.length && activeRecordedDates.length + generated.length < targetActiveCount && guard < 366) {
    const date = toIsoDate(cursor);
    if (days.includes(cursor.getDay()) && !excludedDates.has(date)) {
      generated.push({ k: date, d: date });
      excludedDates.add(date);
    }
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  const sessions = [...preserved, ...generated, ...cancelled]
    .sort((a, b) => sessionDate(a).localeCompare(sessionDate(b)));
  const result = { ...updatedGroup, ss: sessions };
  const oldLatest = source.filter((session) => !session.c).map(sessionDate).sort().at(-1);
  const newLatest = sessions.filter((session) => !session.c).map(sessionDate).sort().at(-1);
  const oldEnd = String(previousGroup.e ?? "").slice(0, 10);
  const newEnd = String(updatedGroup.e ?? "").slice(0, 10);
  const endWasEdited = oldEnd !== newEnd;
  const endTrackedPreviousSchedule = Boolean(oldEnd && oldEnd === oldLatest);
  if (newLatest && (!newEnd || newLatest > newEnd || (!endWasEdited && endTrackedPreviousSchedule))) result.e = newLatest;
  return result;
}

export function cancelSession(group: AcademyGroup, index: number): AcademyGroup {
  const sessions = sessionsOf(group).map((session) => ({ ...session }));
  if (!sessions[index] || sessions[index].c) return group;
  const targetCount = Math.max(8, sessions.filter((session) => !session.c).length);
  sessions[index].c = 1;
  return ensureActiveSessionCount(group, sessions, targetCount);
}

export function restoreSession(group: AcademyGroup, index: number, protectedDates: Set<string>): AcademyGroup {
  const sessions = sessionsOf(group).map((session) => ({ ...session }));
  if (!sessions[index]) return group;
  const targetCount = sessions.filter((session) => !session.c).length;
  const currentEnd = String(group.e ?? "").slice(0, 10);
  const originalLatest = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const endTracksSchedule = Boolean(currentEnd && currentEnd === originalLatest);
  sessions[index].c = 0;
  let restoredIndex = index;
  const today = toIsoDate();
  while (sessions.filter((session) => !session.c).length > targetCount) {
    const candidates = sessions.map((session, candidate) => ({ session, candidate, date: String(session.d ?? session.k).slice(0, 10) }))
      .filter(({ session, candidate }) => !session.c && candidate !== restoredIndex);
    const future = candidates.filter((entry) => entry.date >= today);
    const removable = (future.length ? future : candidates).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!removable || protectedDates.has(removable.date)) return group;
    sessions.splice(removable.candidate, 1);
    if (removable.candidate < restoredIndex) restoredIndex -= 1;
  }
  const remainingLatest = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const result = { ...group, ss: sessions };
  if (endTracksSchedule) {
    if (remainingLatest) result.e = remainingLatest;
    else delete result.e;
  }
  return result;
}

export function rescheduleSession(group: AcademyGroup, index: number, date: string, protectedDates: Set<string> = new Set()): AcademyGroup | null {
  const sessions = sessionsOf(group).map((session) => ({ ...session }));
  const target = sessions[index];
  const parsed = date ? parseIsoDate(date) : new Date(Number.NaN);
  if (!target || target.c || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(parsed) !== date) return null;
  const originalLatest = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const days = groupDays(group);
  const requestedDate = group.s && date < group.s.slice(0, 10) ? group.s.slice(0, 10) : date;
  const firstDate = onOrAfterScheduledDay(requestedDate, days);
  if (!firstDate) return null;

  const ordered = sessions.map((session, sessionIndex) => ({
    session,
    index: sessionIndex,
    date: String(session.d ?? session.k).slice(0, 10)
  })).sort((a, b) => a.date.localeCompare(b.date));
  const selectedPosition = ordered.findIndex((entry) => entry.index === index);
  if (selectedPosition < 0) return null;
  const previousActive = ordered.slice(0, selectedPosition).filter((entry) => !entry.session.c).at(-1);
  const firstScheduledDate = previousActive && firstDate <= previousActive.date ? nextDay(previousActive.date, days) : firstDate;
  const reserved = new Set([
    ...ordered.slice(0, selectedPosition).filter((entry) => !entry.session.c).map((entry) => entry.date),
    ...ordered.filter((entry) => entry.session.c).map((entry) => entry.date)
  ]);
  const affected = ordered.slice(selectedPosition).filter((entry) => !entry.session.c);
  if (!affected.some((entry) => entry.index === index)) return null;

  let previousDate = previousActive?.date ?? "";
  const assignedDates: string[] = [];
  for (const [affectedIndex, entry] of affected.entries()) {
    let candidate = affectedIndex === 0 ? firstScheduledDate : nextDay(previousDate, days);
    let guard = 0;
    while (reserved.has(candidate) && guard < 64) {
      candidate = nextDay(candidate, days);
      guard += 1;
    }
    if (guard >= 64) return null;
    if (protectedDates.has(entry.date) && candidate !== entry.date) return null;

    if (candidate !== entry.date) {
      const original = String(entry.session.rescheduledFrom ?? entry.date).slice(0, 10);
      entry.session.d = candidate;
      entry.session.k = candidate;
      if (candidate === original) delete entry.session.rescheduledFrom;
      else entry.session.rescheduledFrom = original;
    }
    reserved.add(candidate);
    previousDate = candidate;
    assignedDates.push(candidate);
  }

  sessions.sort((a, b) => String(a.d ?? a.k).slice(0, 10).localeCompare(String(b.d ?? b.k).slice(0, 10)));
  const lastAssigned = assignedDates.at(-1);
  const currentEnd = String(group.e ?? "").slice(0, 10);
  const latestAfter = sessions.map((session) => String(session.d ?? session.k).slice(0, 10)).sort().at(-1);
  const endTracksSchedule = Boolean(currentEnd && currentEnd === originalLatest);
  const nextEnd = currentEnd && lastAssigned && lastAssigned > currentEnd ? latestAfter : endTracksSchedule ? latestAfter : group.e;
  const result = { ...group, ss: sessions };
  if (nextEnd) result.e = nextEnd;
  else if (group.e !== undefined) result.e = group.e;
  return result;
}
