import type { AttendanceRecord } from "../domain/types";
import { attendanceKey } from "../domain/utils";

type AttendanceIdentity = Pick<AttendanceRecord, "date" | "gid" | "mid">;

export function attendanceDocumentId(row: AttendanceIdentity): string {
  return `${row.date}__${row.gid}__${row.mid}`;
}

export function removedAttendanceKeys(previousKeys: Iterable<string>, currentRows: AttendanceIdentity[]): string[] {
  const current = new Set(currentRows.map(attendanceKey));
  return [...previousKeys].filter((key) => !current.has(key));
}
