import type { AcademyGroup } from "./types";

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function latestScheduledSessionDate(group: AcademyGroup): string | null {
  const configuredEnd = String(group.e ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(configuredEnd)) return configuredEnd;

  const dates = (Array.isArray(group.ss) ? group.ss : [])
    .filter((session) => !session.c)
    .map((session) => String(session.d ?? session.k).slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const latestSession = dates.at(-1);
  if (latestSession) return latestSession;

  return null;
}

/** A group remains operational through its configured/planned end date. */
export function isGroupOperationalToday(group: AcademyGroup, today = todayIso()): boolean {
  const lastSessionDate = latestScheduledSessionDate(group);
  return !lastSessionDate || lastSessionDate >= today;
}
