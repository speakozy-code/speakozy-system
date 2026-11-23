export const AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

export function isAutomaticFollowupDue(
  lastTouch: number,
  dueDate: string,
  now: number,
  today: string,
  intervalMs: number
): boolean {
  if (dueDate && dueDate > today) return false;
  return !lastTouch || now - lastTouch >= intervalMs;
}
