import type { User } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, where } from "firebase/firestore";
import { EMPTY_DATA, type AcademyData, type AttendanceRecord, type Profile, type Role, type TeacherAccount } from "../domain/types";
import { canAccessFinance, isMarketingRole } from "../domain/permissions";
import { activeGroups, attendanceKey, isEnrolledStudent, normalise, toIsoDate } from "../domain/utils";
import { mergeAttendanceRecords, sameAttendanceRecord, type AttendanceDelta } from "../domain/attendance-deltas";
import { attendanceDocumentId } from "./attendance-sync";
import { firestore } from "./firebase";

interface HubDocument { d?: string; updatedAt?: number; by?: string; n?: number }
interface UserDocument { role?: string; teacherName?: string; email?: string; disabledAt?: number }
interface TeacherDocument { d?: string; gids?: string[]; updatedAt?: number }
interface AttendanceDocument { date?: string; gid?: string; mid?: string; status?: string; teacher?: string; teacherUid?: string; updatedAt?: number }
interface BackupDocument { d?: string; day?: string; createdAt?: number; by?: string; count?: number }
export interface CloudBackup { id: string; kind: "main" | "finance"; data: string; day: string; createdAt: number; by: string }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const toData = (raw?: Partial<AcademyData>): AcademyData => ({
  ...clone(EMPTY_DATA),
  ...(raw ?? {}),
  r: Array.isArray(raw?.r) ? raw.r : [],
  g: Array.isArray(raw?.g) ? raw.g : [],
  m: Array.isArray(raw?.m) ? raw.m : [],
  l: Array.isArray(raw?.l) ? raw.l : [],
  attendance: Array.isArray(raw?.attendance) ? raw.attendance : [],
  teacherAbsences: Array.isArray(raw?.teacherAbsences) ? raw.teacherAbsences : [],
  finance: Array.isArray(raw?.finance) ? raw.finance : [],
  teacherHours: Array.isArray(raw?.teacherHours) ? raw.teacherHours : [],
  scripts: Array.isArray(raw?.scripts) ? raw.scripts : [],
  cur: String(raw?.cur ?? "")
});

function parseData(value?: string): AcademyData {
  try { return toData(value ? JSON.parse(value) as Partial<AcademyData> : undefined); }
  catch { return clone(EMPTY_DATA); }
}

function parseFinance(value?: string): AcademyData["finance"] {
  try {
    const parsed = JSON.parse(value ?? "[]") as AcademyData["finance"] | { finance?: AcademyData["finance"] };
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.finance) ? parsed.finance : [];
  } catch { return []; }
}

function attendanceRecord(id: string, value: unknown): AttendanceRecord | null {
  const row = value as AttendanceDocument;
  if (!row.date || !row.gid || !row.mid) return null;
  return {
    id, date: row.date, gid: row.gid, mid: row.mid,
    status: (row.status ?? "") as AttendanceRecord["status"],
    teacher: row.teacher ?? "", teacherUid: row.teacherUid ?? "", updatedAt: Number(row.updatedAt ?? 0)
  };
}

function marketingProjection(data: AcademyData): AcademyData {
  return toData({
    r: data.r.filter((row) => !row.x).map(({ id, n }) => ({ id, n })),
    g: data.g.filter((row) => !row.x).map(({ id, r, p, lv, s }) => ({ id, r, p, lv, s })),
    m: data.m.filter((row) => !row.x && isEnrolledStudent(row)).map((row) => ({
      id: row.id, profileId: row.profileId || row.id, g: row.g, r: row.r, n: row.n,
      kind: row.kind, nw: row.nw, source: row.source, sourceOther: row.sourceOther,
      subscriptionSource: row.subscriptionSource || row.source,
      subscriptionSourceOther: row.subscriptionSourceOther || row.sourceOther,
      subscriptionClass: row.subscriptionClass || ((row.kind === "new" || (!row.kind && row.nw)) ? "new" : "renewal"),
      ren: row.ren, formerAt: row.formerAt,
      ...((row.subscriptionClass === "new") || (!row.subscriptionClass && (row.kind === "new" || (!row.kind && row.nw))) ? { amount: Number(row.amount ?? 0) } : {})
    })),
    l: [], cur: data.cur, attendance: [], teacherAbsences: [], finance: [], teacherHours: []
  });
}

function mergeCollection<T extends { id: string }>(local: T[], remote: T[], base?: T[]): T[] {
  const values = new Map(local.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const baseById = new Map((base ?? []).map((item) => [item.id, item]));
  remote.forEach((item) => {
    const current = localById.get(item.id);
    const prior = baseById.get(item.id);
    if (!current) { values.set(item.id, item); return; }
    if (!prior) return;
    const currentFields = current as Record<string, unknown>;
    const remoteFields = item as Record<string, unknown>;
    const priorFields = prior as Record<string, unknown>;
    Object.keys(remoteFields).forEach((field) => {
      if (JSON.stringify(currentFields[field]) === JSON.stringify(priorFields[field]) && JSON.stringify(remoteFields[field]) !== JSON.stringify(priorFields[field])) currentFields[field] = remoteFields[field];
    });
  });
  return [...values.values()];
}

export function mergeRemote(local: AcademyData, remote: AcademyData, base?: AcademyData): AcademyData {
  const next = clone(local);
  next.r = mergeCollection(next.r, remote.r, base?.r);
  next.g = mergeCollection(next.g, remote.g, base?.g);
  next.m = mergeCollection(next.m, remote.m, base?.m);
  next.l = mergeCollection(next.l, remote.l, base?.l);
  next.scripts = mergeCollection(next.scripts ?? [], remote.scripts ?? [], base?.scripts ?? []);
  next.attendance = mergeAttendanceRecords(next.attendance, remote.attendance, base?.attendance);
  if (base && next.cur === base.cur && remote.cur !== base.cur) next.cur = remote.cur;
  else if (!next.cur && remote.cur) next.cur = remote.cur;
  if (base && next.lb === base.lb && remote.lb !== base.lb) next.lb = remote.lb;
  else if (!next.lb && remote.lb) next.lb = remote.lb;
  next.teacherAbsences = mergeCollection(next.teacherAbsences as { id: string }[], remote.teacherAbsences as { id: string }[], base?.teacherAbsences as { id: string }[] | undefined);
  next.teacherHours = mergeCollection(next.teacherHours.map((row) => ({ ...row, id: normalise(row.name) })), remote.teacherHours.map((row) => ({ ...row, id: normalise(row.name) })), base?.teacherHours.map((row) => ({ ...row, id: normalise(row.name) }))).map(({ id: _id, ...row }) => row);
  return toData(next);
}

export class CloudRepository {
  readonly user: User;
  profile!: Profile;
  private attendanceMirror = new Map<string, AttendanceRecord>();
  private attendanceKeyByDocumentId = new Map<string, string>();
  private pendingAttendance = new Map<string, { revision: number; record: AttendanceRecord | null }>();
  private attendanceRevision = 0;
  private attendanceSyncReady = false;
  private attendanceReadyPromise: Promise<void> | null = null;
  private resolveAttendanceReady: (() => void) | null = null;
  private rejectAttendanceReady: ((error: unknown) => void) | null = null;
  private attendanceUnsubscribe: (() => void) | null = null;
  private attendanceObserver: ((changes: AttendanceDelta[]) => void) | null = null;
  private pendingAttendanceBatches: AttendanceDelta[][] = [];
  private teacherProjectionSignatures = new Map<string, string>();
  private baseData: AcademyData | null = null;
  private lastMain = 0;
  private lastFinance = 0;
  private lastTeacher = 0;
  private lastBackupAttemptDay = "";
  private teacherProjectionSyncPending = true;
  private teacherDirectory: TeacherAccount[] = [];

  constructor(user: User) { this.user = user; }

  dispose(): void {
    this.attendanceUnsubscribe?.();
    this.attendanceUnsubscribe = null;
    this.attendanceObserver = null;
    this.attendanceMirror.clear();
    this.attendanceKeyByDocumentId.clear();
    this.pendingAttendanceBatches = [];
    this.rejectAttendanceReady?.(new Error("Attendance listener disposed"));
    this.rejectAttendanceReady = null;
    this.resolveAttendanceReady = null;
    this.attendanceReadyPromise = null;
  }

  recordAttendanceIntent(before: AttendanceRecord[], after: AttendanceRecord[]): void {
    const prior = new Map(before.map((record) => [attendanceKey(record), record]));
    const next = new Map(after.map((record) => [attendanceKey(record), record]));
    const keys = new Set([...prior.keys(), ...next.keys()]);
    keys.forEach((key) => {
      const oldRecord = prior.get(key);
      const newRecord = next.get(key);
      if (sameAttendanceRecord(oldRecord, newRecord)) return;
      this.pendingAttendance.set(key, { revision: ++this.attendanceRevision, record: newRecord ?? null });
    });
  }

  watchAttendance(onChange: (changes: AttendanceDelta[]) => void): () => void {
    this.attendanceObserver = onChange;
    this.pendingAttendanceBatches.splice(0).forEach((batch) => this.deliverAttendanceChanges(batch));
    return () => { if (this.attendanceObserver === onChange) this.attendanceObserver = null; };
  }

  private deliverAttendanceChanges(changes: AttendanceDelta[]): void {
    const filtered = changes.filter(({ record }) => !this.pendingAttendance.has(attendanceKey(record)));
    if (!filtered.length) return;
    if (this.attendanceObserver) this.attendanceObserver(filtered);
    else this.pendingAttendanceBatches.push(filtered);
  }

  async load(): Promise<{ profile: Profile; data: AcademyData }> {
    const userSnapshot = await getDoc(doc(firestore, "users", this.user.uid));
    const userDocument = (userSnapshot.data() ?? {}) as UserDocument;
    if (userDocument.role === "disabled" || userDocument.disabledAt) throw new Error("تم إيقاف هذا الحساب من النظام. تواصل مع مالك الأكاديمية إذا كنت تعتقد أن هذا بالخطأ.");
    if (userDocument.role === "teacher") {
      this.profile = { uid: this.user.uid, email: this.user.email ?? "", role: "teacher", teacherName: userDocument.teacherName ?? "" };
      const data = await this.loadTeacher();
      return { profile: this.profile, data };
    }
    if (isMarketingRole(userDocument.role)) {
      const projectionSnapshot = await getDoc(doc(firestore, "hub", "marketing"));
      if (!projectionSnapshot.exists()) throw new Error("إحصائيات التسويق لم تُجهز بعد من حساب المالك.");
      this.profile = { uid: this.user.uid, email: this.user.email ?? "", role: userDocument.role, teacherName: "" };
      const data = parseData((projectionSnapshot.data() as HubDocument).d);
      data.finance = [];
      this.baseData = clone(data);
      return { profile: this.profile, data };
    }
    const mainSnapshot = await getDoc(doc(firestore, "hub", "main"));
    if (!mainSnapshot.exists()) throw new Error("الحساب غير مفعّل على النظام. تواصل مع المالك.");
    const mainDocument = mainSnapshot.data() as HubDocument;
    this.lastMain = Number(mainDocument.updatedAt ?? 0);
    // Prefer an explicit existing user role. Older owner accounts may have no
    // role field, so retain the legacy finance-read probe as a compatibility fallback.
    let role: Role = userDocument.role === "owner" ? "owner" : userDocument.role === "admin" ? "admin" : "admin";
    let finance: AcademyData["finance"] = [];
    this.lastFinance = 0;
    if (userDocument.role !== "admin") {
      try {
        const financeSnapshot = await getDoc(doc(firestore, "hub", "finance"));
        const financeDocument = financeSnapshot.data() as HubDocument | undefined;
        this.lastFinance = Number(financeDocument?.updatedAt ?? 0);
        if (financeDocument?.d) finance = parseFinance(financeDocument.d);
        // Preserve the finance-read probe only for legacy accounts without an explicit role.
        if (userDocument.role !== "owner") role = "owner";
      } catch {
        // An explicit owner record remains owner, but receives no finance data if read is denied.
        if (role !== "owner") role = "admin";
      }
    }
    this.profile = { uid: this.user.uid, email: this.user.email ?? "", role, teacherName: "" };
    const data = parseData(mainDocument.d);
    data.finance = finance;
    this.baseData = clone(data);
    await this.reconcileAllAttendance(data);
    if (!import.meta.env.DEV) {
      void this.ensureDailyBackups(data);
    }
    return { profile: this.profile, data };
  }

  getTeacherDirectory(): TeacherAccount[] { return [...this.teacherDirectory]; }

  async disableTeacherAccount(name: string): Promise<boolean> {
    if (this.profile.role !== "owner") throw new Error("حذف حساب المدرس متاح للمالك فقط.");
    const account = this.teacherDirectory.find((item) => normalise(item.name) === normalise(name));
    if (!account) return false;
    const disabledAt = Date.now();
    await setDoc(doc(firestore, "teachers", account.uid), {
      d: JSON.stringify(EMPTY_DATA), gids: [], updatedAt: disabledAt
    });
    await setDoc(doc(firestore, "users", account.uid), {
      role: "disabled", teacherName: account.name, email: account.email, disabledAt
    }, { merge: true });
    this.teacherDirectory = this.teacherDirectory.filter((item) => item.uid !== account.uid);
    return true;
  }

  watchTeacherAccounts(getCurrentData: () => AcademyData, onDirectory?: (accounts: TeacherAccount[]) => void): () => void {
    if (import.meta.env.DEV || this.profile.role === "teacher" || isMarketingRole(this.profile.role)) return () => undefined;
    return onSnapshot(collection(firestore, "users"), (snapshot) => {
      this.teacherDirectory = snapshot.docs.flatMap((userSnapshot) => {
        const userDocument = userSnapshot.data() as UserDocument;
        return userDocument.role === "teacher" && userDocument.teacherName?.trim() ? [{ uid: userSnapshot.id, name: userDocument.teacherName.trim(), email: userDocument.email ?? "" }] : [];
      });
      onDirectory?.(this.getTeacherDirectory());
      void this.publishTeachers(getCurrentData()).catch((error: unknown) => console.warn("Teacher account sync deferred", error));
    }, (error) => console.warn("Teacher account listener unavailable", error));
  }

  private async loadTeacher(): Promise<AcademyData> {
    const teacherSnapshot = await getDoc(doc(firestore, "teachers", this.user.uid));
    const teacherDocument = (teacherSnapshot.data() ?? {}) as TeacherDocument;
    this.lastTeacher = Number(teacherDocument.updatedAt ?? 0);
    const data = parseData(teacherDocument.d);
    data.l = [];
    data.finance = [];
    await this.reconcileTeacherAttendance(data);
    this.baseData = clone(data);
    return data;
  }

  async refresh(current: AcademyData): Promise<AcademyData | null> {
    if (isMarketingRole(this.profile.role)) {
      const snapshot = await getDoc(doc(firestore, "hub", "marketing"));
      const value = (snapshot.data() as HubDocument | undefined)?.d;
      if (!value) return null;
      const next = parseData(value);
      next.finance = [];
      return JSON.stringify(next) !== JSON.stringify(current) ? next : null;
    }
    if (this.profile.role === "teacher") {
      const teacherSnapshot = await getDoc(doc(firestore, "teachers", this.user.uid));
      const teacherDocument = (teacherSnapshot.data() ?? {}) as TeacherDocument;
      let next = current;
      if (Number(teacherDocument.updatedAt ?? 0) > this.lastTeacher && teacherDocument.d) {
        this.lastTeacher = Number(teacherDocument.updatedAt ?? 0);
        const remote = parseData(teacherDocument.d);
        remote.attendance = current.attendance;
        next = { ...current, r: remote.r, g: remote.g, m: remote.m, cur: remote.cur, teacherHours: remote.teacherHours };
      }
      return next !== current ? toData(next) : null;
    }
    const financeRead = canAccessFinance(this.profile.role) ? getDoc(doc(firestore, "hub", "finance")) : Promise.resolve(null);
    const [mainSnapshot, financeSnapshot] = await Promise.all([getDoc(doc(firestore, "hub", "main")), financeRead]);
    const mainDocument = (mainSnapshot.data() ?? {}) as HubDocument;
    if (!mainDocument.d) return null;
    const mainUpdatedAt = Number(mainDocument.updatedAt ?? 0);
    const financeDocument = financeSnapshot?.data() as HubDocument | undefined;
    const financeUpdatedAt = Number(financeDocument?.updatedAt ?? 0);
    const mainChanged = mainUpdatedAt !== this.lastMain;
    const financeChanged = Boolean(financeSnapshot) && financeUpdatedAt !== this.lastFinance;
    if (!mainChanged && !financeChanged) {
      if (!import.meta.env.DEV) {
        void this.ensureDailyBackups(current);
        if (this.teacherProjectionSyncPending) void this.publishTeachers(current);
      }
      return null;
    }
    const remote = parseData(mainDocument.d);
    if (financeSnapshot) {
      if (financeDocument?.d) remote.finance = parseFinance(financeDocument.d);
    } else remote.finance = [];
    const next = mergeRemote(current, remote, this.baseData ?? remote);
    if (!canAccessFinance(this.profile.role)) next.finance = [];
    this.baseData = clone(remote);
    this.lastMain = mainUpdatedAt;
    if (financeSnapshot) this.lastFinance = financeUpdatedAt;
    if (!import.meta.env.DEV) void this.ensureDailyBackups(next);
    if (!import.meta.env.DEV && mainChanged) void this.publishTeachers(next);
    return JSON.stringify(next) !== JSON.stringify(current) ? next : null;
  }

  async listBackups(): Promise<CloudBackup[]> {
    if (import.meta.env.DEV || this.profile.role === "teacher" || isMarketingRole(this.profile.role)) return [];
    const mainSnapshots = await getDocs(query(collection(firestore, "hubBackups"), orderBy("createdAt", "desc"), limit(30)));
    const backups: CloudBackup[] = mainSnapshots.docs.map((snapshot) => {
      const value = snapshot.data() as BackupDocument;
      const raw = value.d ?? "";
      const backupData = canAccessFinance(this.profile.role) ? raw : JSON.stringify({ ...parseData(raw), finance: [] });
      return { id: snapshot.id, kind: "main", data: backupData, day: value.day ?? "", createdAt: Number(value.createdAt ?? 0), by: value.by ?? "" };
    });
    if (this.profile.role === "owner") {
      const financeSnapshots = await getDocs(query(collection(firestore, "finBackups"), orderBy("createdAt", "desc"), limit(30)));
      financeSnapshots.docs.forEach((snapshot) => {
        const value = snapshot.data() as BackupDocument;
        backups.push({ id: snapshot.id, kind: "finance", data: value.d ?? "[]", day: value.day ?? "", createdAt: Number(value.createdAt ?? 0), by: value.by ?? "" });
      });
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
  }

  private async ensureDailyBackups(data: AcademyData): Promise<void> {
    if (import.meta.env.DEV || this.profile.role === "teacher") return;
    const day = toIsoDate();
    if (this.lastBackupAttemptDay === day) return;
    this.lastBackupAttemptDay = day;
    try {
      const existingMain = await getDocs(query(collection(firestore, "hubBackups"), where("day", "==", day), limit(1)));
      if (existingMain.empty) {
        const main = clone(data);
        delete (main as Partial<AcademyData>).finance;
        await addDoc(collection(firestore, "hubBackups"), { d: JSON.stringify(main), day, createdAt: Date.now(), by: this.profile.email, count: main.r.length + main.g.length + main.m.length + main.l.length });
      }
      if (this.profile.role === "owner") {
        const existingFinance = await getDocs(query(collection(firestore, "finBackups"), where("day", "==", day), limit(1)));
        if (existingFinance.empty) await addDoc(collection(firestore, "finBackups"), { d: JSON.stringify(data.finance), day, createdAt: Date.now(), by: this.profile.email, count: data.finance.length });
      }
    } catch (error) {
      this.lastBackupAttemptDay = "";
      console.warn("Daily backup skipped; original application data remains unchanged", error);
    }
  }

  async save(data: AcademyData): Promise<"saved" | "preview"> {
    if (import.meta.env.DEV) return "preview";
    if (isMarketingRole(this.profile.role)) throw new Error("حساب المسوّق للعرض فقط.");
    if (this.profile.role === "teacher") {
      const teacherData = clone(data);
      this.applyPendingAttendance(teacherData);
      await this.syncTeacherAttendance(teacherData);
      return "saved";
    }
    const clean = clone(data);
    this.applyPendingAttendance(clean);
    if (!canAccessFinance(this.profile.role)) clean.finance = [];
    const finance = clean.finance;
    delete (clean as Partial<AcademyData>).finance;
    const updatedAt = Date.now();
    await setDoc(doc(firestore, "hub", "main"), {
      d: JSON.stringify(clean), updatedAt, by: this.profile.email,
      n: clean.r.length + clean.g.length + clean.m.length + clean.l.length
    });
    this.lastMain = updatedAt;
    if (canAccessFinance(this.profile.role)) {
      await setDoc(doc(firestore, "hub", "finance"), { d: JSON.stringify(finance), updatedAt });
      this.lastFinance = updatedAt;
    }
    await this.syncCentralAttendance(clean);
    await this.publishTeachers(data);
    try { await this.refreshMarketingProjection(data); }
    catch (error) { console.warn("Marketing statistics projection was not updated", error); }
    this.baseData = clone({ ...clean, finance: canAccessFinance(this.profile.role) ? finance : [] });
    return "saved";
  }

  async refreshMarketingProjection(data: AcademyData): Promise<void> {
    if (import.meta.env.DEV) return;
    if (this.profile.role !== "owner" && this.profile.role !== "admin") throw new Error("تحديث إحصائيات التسويق متاح للمالك أو الأدمن فقط.");
    await setDoc(doc(firestore, "hub", "marketing"), { d: JSON.stringify(marketingProjection(data)), updatedAt: Date.now() });
  }

  private applyPendingAttendance(data: AcademyData): void {
    const rows = new Map(data.attendance.map((record) => [attendanceKey(record), record]));
    this.pendingAttendance.forEach(({ record }, key) => {
      if (record) rows.set(key, record);
      else rows.delete(key);
    });
    data.attendance = [...rows.values()];
  }

  private async reconcileAllAttendance(data: AcademyData): Promise<void> {
    await this.startAttendanceListener(data, false);
  }

  private async reconcileTeacherAttendance(data: AcademyData): Promise<void> {
    await this.startAttendanceListener(data, true);
  }

  private async startAttendanceListener(data: AcademyData, teacherOnly: boolean): Promise<void> {
    if (this.attendanceUnsubscribe) return;
    this.attendanceReadyPromise = new Promise<void>((resolve, reject) => {
      this.resolveAttendanceReady = resolve;
      this.rejectAttendanceReady = reject;
    });
    const source = teacherOnly
      ? query(collection(firestore, "attendance"), where("teacherUid", "==", this.user.uid))
      : collection(firestore, "attendance");
    this.attendanceUnsubscribe = onSnapshot(source, (snapshot) => {
      if (!this.attendanceSyncReady) {
        const nextMirror = new Map<string, AttendanceRecord>();
        const documentKeys = new Map<string, string>();
        snapshot.forEach((entry) => {
          const record = attendanceRecord(entry.id, entry.data());
          if (!record) return;
          const key = attendanceKey(record);
          nextMirror.set(key, record);
          documentKeys.set(entry.id, key);
        });
        this.attendanceMirror = nextMirror;
        this.attendanceKeyByDocumentId = documentKeys;
        data.attendance = mergeAttendanceRecords(data.attendance, [...nextMirror.values()], data.attendance);
        this.attendanceSyncReady = true;
        this.resolveAttendanceReady?.();
        this.resolveAttendanceReady = null;
        this.rejectAttendanceReady = null;
        return;
      }
      const changes: AttendanceDelta[] = [];
      snapshot.docChanges().forEach((change) => {
        const documentId = change.doc.id;
        const previousKey = this.attendanceKeyByDocumentId.get(documentId);
        const previous = previousKey ? this.attendanceMirror.get(previousKey) : undefined;
        if (change.type === "removed") {
          if (previous) changes.push({ type: "remove", record: previous });
          if (previousKey) this.attendanceMirror.delete(previousKey);
          this.attendanceKeyByDocumentId.delete(documentId);
          return;
        }
        const record = attendanceRecord(documentId, change.doc.data());
        if (!record) {
          if (previous) changes.push({ type: "remove", record: previous });
          if (previousKey) this.attendanceMirror.delete(previousKey);
          this.attendanceKeyByDocumentId.delete(documentId);
          return;
        }
        const key = attendanceKey(record);
        if (previousKey && previousKey !== key) {
          if (previous) changes.push({ type: "remove", record: previous });
          this.attendanceMirror.delete(previousKey);
        }
        const existing = this.attendanceMirror.get(key);
        if (!sameAttendanceRecord(existing, record)) changes.push({ type: "upsert", record });
        this.attendanceMirror.set(key, record);
        this.attendanceKeyByDocumentId.set(documentId, key);
      });
      this.deliverAttendanceChanges(changes);
    }, (error) => {
      this.rejectAttendanceReady?.(error);
      this.rejectAttendanceReady = null;
      this.resolveAttendanceReady = null;
      console.warn("Attendance listener unavailable", error);
    });
    await this.attendanceReadyPromise;
  }

  private async syncCentralAttendance(data: AcademyData): Promise<void> {
    const groupTeacherIds = await this.teacherGroupMap();
    const revisions = new Map(this.pendingAttendance);
    const writes = data.attendance.map(async (row) => {
      const key = attendanceKey(row);
      const teacherUid = groupTeacherIds.get(row.gid) ?? "";
      const outgoing = { ...row, teacher: row.teacher ?? "", teacherUid, updatedAt: row.updatedAt || Date.now() };
      const previous = this.attendanceMirror.get(key);
      if (!row.status) {
        if (previous) await deleteDoc(doc(firestore, "attendance", attendanceDocumentId(row)));
        this.attendanceMirror.delete(key);
        this.attendanceKeyByDocumentId.delete(attendanceDocumentId(row));
      } else if (!sameAttendanceRecord(previous, outgoing)) {
        const documentId = attendanceDocumentId(row);
        await setDoc(doc(firestore, "attendance", documentId), {
          date: row.date, gid: row.gid, mid: row.mid, status: row.status, teacher: outgoing.teacher,
          teacherUid, updatedAt: outgoing.updatedAt
        });
        this.attendanceMirror.set(key, outgoing);
        this.attendanceKeyByDocumentId.set(documentId, key);
      } else {
        this.attendanceKeyByDocumentId.set(attendanceDocumentId(row), key);
      }
      this.clearSavedAttendanceIntent(key, revisions.get(key), row);
    });
    const removals = [...revisions].filter(([, intent]) => intent.record === null).map(async ([key]) => {
      const [date, gid, mid] = key.split("|");
      if (date && gid && mid) {
        const documentId = attendanceDocumentId({ date, gid, mid });
        await deleteDoc(doc(firestore, "attendance", documentId));
        this.attendanceKeyByDocumentId.delete(documentId);
      }
      this.attendanceMirror.delete(key);
      this.clearSavedAttendanceIntent(key, revisions.get(key), null);
    });
    await Promise.all([...writes, ...removals]);
  }

  private async syncTeacherAttendance(data: AcademyData): Promise<void> {
    const revisions = new Map(this.pendingAttendance);
    const writes = data.attendance.map(async (row) => {
      const key = attendanceKey(row);
      const outgoing = { ...row, teacher: row.teacher ?? this.profile.teacherName, teacherUid: this.user.uid, updatedAt: row.updatedAt || Date.now() };
      const previous = this.attendanceMirror.get(key);
      if (!row.status) {
        if (previous) await deleteDoc(doc(firestore, "attendance", attendanceDocumentId(row)));
        this.attendanceMirror.delete(key);
        this.attendanceKeyByDocumentId.delete(attendanceDocumentId(row));
      } else if (!sameAttendanceRecord(previous, outgoing)) {
        const documentId = attendanceDocumentId(row);
        await setDoc(doc(firestore, "attendance", documentId), {
          date: row.date, gid: row.gid, mid: row.mid, status: row.status,
          teacher: outgoing.teacher, teacherUid: this.user.uid, updatedAt: outgoing.updatedAt
        });
        this.attendanceMirror.set(key, outgoing);
        this.attendanceKeyByDocumentId.set(documentId, key);
      } else {
        this.attendanceKeyByDocumentId.set(attendanceDocumentId(row), key);
      }
      this.clearSavedAttendanceIntent(key, revisions.get(key), row);
    });
    const removals = [...revisions].filter(([, intent]) => intent.record === null).map(async ([key]) => {
      const [date, gid, mid] = key.split("|");
      if (date && gid && mid) {
        const documentId = attendanceDocumentId({ date, gid, mid });
        await deleteDoc(doc(firestore, "attendance", documentId));
        this.attendanceKeyByDocumentId.delete(documentId);
      }
      this.attendanceMirror.delete(key);
      this.clearSavedAttendanceIntent(key, revisions.get(key), null);
    });
    await Promise.all([...writes, ...removals]);
  }

  private clearSavedAttendanceIntent(key: string, saved: { revision: number; record: AttendanceRecord | null } | undefined, record: AttendanceRecord | null): void {
    if (!saved || this.pendingAttendance.get(key)?.revision !== saved.revision) return;
    if (record ? sameAttendanceRecord(saved.record ?? undefined, record) : saved.record === null) this.pendingAttendance.delete(key);
  }

  private async teacherGroupMap(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const snapshots = await getDocs(collection(firestore, "teachers"));
      snapshots.forEach((snapshot) => {
        const teacher = snapshot.data() as TeacherDocument;
        (teacher.gids ?? []).forEach((groupId) => result.set(groupId, snapshot.id));
      });
    } catch { /* attendance remains visible to admin/owner even if teacher projection is pending */ }
    return result;
  }

  private async publishTeachers(data: AcademyData): Promise<void> {
    if (this.profile.role === "teacher") return;
    try {
      const users = await getDocs(collection(firestore, "users"));
      this.teacherDirectory = users.docs.flatMap((userSnapshot) => {
        const userDocument = userSnapshot.data() as UserDocument;
        return userDocument.role === "teacher" && userDocument.teacherName?.trim() ? [{ uid: userSnapshot.id, name: userDocument.teacherName.trim(), email: userDocument.email ?? "" }] : [];
      });
      const liveRounds = data.r.filter((round) => !round.x && !round.pl);
      const allowedRounds = new Set(["pv", ...liveRounds.map((round) => round.id)]);
      const groups = data.g.filter((group) => !group.x && (Boolean(group.p) || allowedRounds.has(group.r)));
      // Teacher projections must preserve enrollment state. If moved/archived flags are
      // stripped, a student removed by the owner reappears in the teacher roster.
      const students = data.m.filter((student) => !student.x && isEnrolledStudent(student)
        && !data.m.some((copy) => !copy.x && copy.movedToTab === "renewals" && copy.copiedFromStudentId === student.id));
      await Promise.all(users.docs.map(async (userSnapshot) => {
        const userDocument = userSnapshot.data() as UserDocument;
        if (userDocument.role !== "teacher" || !userDocument.teacherName) return;
        const assigned = groups.filter((group) => normalise(group.tc) === normalise(userDocument.teacherName));
        const payload: Partial<AcademyData> = {
          r: liveRounds,
          g: assigned,
          m: students.filter((student) => assigned.some((group) => group.id === student.g)).map((student) => ({ id: student.id, g: student.g, n: student.n, lv: student.lv })),
          teacherHours: data.teacherHours.filter((row) => normalise(row.name) === normalise(userDocument.teacherName)),
          cur: allowedRounds.has(data.cur) ? data.cur : (liveRounds[0]?.id ?? "")
        };
        const payloadJson = JSON.stringify(payload);
        const gids = assigned.map((group) => group.id);
        const signature = `${payloadJson}|${gids.join(",")}`;
        if (this.teacherProjectionSignatures.get(userSnapshot.id) === signature) return;
        await setDoc(doc(firestore, "teachers", userSnapshot.id), { d: payloadJson, gids, updatedAt: Date.now() });
        this.teacherProjectionSignatures.set(userSnapshot.id, signature);
      }));
      this.teacherProjectionSyncPending = false;
    } catch (error) {
      this.teacherProjectionSyncPending = true;
      console.warn("Teacher projection publish skipped", error);
    }
  }
}
