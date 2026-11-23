import type { AttendanceRecord } from "./types";
import { attendanceKey } from "./utils";

export type AttendanceDelta = { type: "upsert" | "remove"; record: AttendanceRecord };

export function sameAttendanceRecord(left?: AttendanceRecord, right?: AttendanceRecord): boolean {
  if (!left || !right) return left === right;
  return left.date === right.date
    && left.gid === right.gid
    && left.mid === right.mid
    && left.status === right.status
    && (left.teacher ?? "") === (right.teacher ?? "")
    && (left.teacherUid ?? "") === (right.teacherUid ?? "")
    && Number(left.updatedAt ?? 0) === Number(right.updatedAt ?? 0);
}

export function applyAttendanceDeltas(
  current: AttendanceRecord[],
  deltas: AttendanceDelta[],
  dirtyKeys: Iterable<string> = []
): AttendanceRecord[] {
  if (!deltas.length) return current;
  const dirty = new Set(dirtyKeys);
  const values = new Map(current.map((record) => [attendanceKey(record), record]));
  let changed = false;

  deltas.forEach(({ type, record }) => {
    const key = attendanceKey(record);
    if (dirty.has(key)) return;
    const existing = values.get(key);
    if (type === "remove") {
      if (existing && sameAttendanceRecord(existing, record)) {
        values.delete(key);
        changed = true;
      }
      return;
    }
    if (!existing || Number(record.updatedAt ?? 0) >= Number(existing.updatedAt ?? 0)) {
      if (!sameAttendanceRecord(existing, record)) {
        values.set(key, record);
        changed = true;
      }
    }
  });

  return changed ? [...values.values()] : current;
}

export function mergeAttendanceRecords(
  current: AttendanceRecord[],
  remote: AttendanceRecord[],
  base: AttendanceRecord[] = []
): AttendanceRecord[] {
  const values = new Map(current.map((record) => [attendanceKey(record), record]));
  const currentByKey = new Map(current.map((record) => [attendanceKey(record), record]));
  const remoteByKey = new Map(remote.map((record) => [attendanceKey(record), record]));
  const baseByKey = new Map(base.map((record) => [attendanceKey(record), record]));

  baseByKey.forEach((previous, key) => {
    if (remoteByKey.has(key)) return;
    const local = currentByKey.get(key);
    if (local && sameAttendanceRecord(local, previous)) values.delete(key);
  });

  remoteByKey.forEach((record, key) => {
    const existing = values.get(key);
    const previous = baseByKey.get(key);
    if (previous && sameAttendanceRecord(record, previous)) return;
    if (!existing || Number(record.updatedAt ?? 0) >= Number(existing.updatedAt ?? 0)) values.set(key, record);
  });
  return [...values.values()];
}
