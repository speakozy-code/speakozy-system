import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { enableNetwork } from "firebase/firestore";
import { auth, firestore } from "../services/firebase";
import { CloudRepository, mergeRemote, type CloudBackup } from "../services/cloudRepository";
import { EMPTY_DATA, type AcademyData, type AttendanceStatus, type Profile, type TeacherAccount } from "../domain/types";
import { canAccessFinance, isMarketingRole } from "../domain/permissions";
import { attendanceKey, deleteTeacher, ensureStudentCodes, pruneOrphanAttendance } from "../domain/utils";
import { addAutomaticFormerCustomerCopies } from "../domain/automatic-former-copies";
import { previewData } from "../domain/demo";

type Phase = "loading" | "signed-out" | "ready" | "error";
export interface Toast { text: string; tone: "success" | "error" | "info" }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const localKey = "spk-hub";
const AUTH_START_TIMEOUT_MS = 20_000;
const DATA_LOAD_TIMEOUT_MS = 75_000;

function isTransientConnectionError(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  const message = String(value?.message ?? error ?? "").toLowerCase();
  return ["unavailable", "deadline-exceeded", "cancelled"].includes(String(value?.code ?? ""))
    || /client is offline|network request failed|could not reach cloud firestore|offline/.test(message);
}

function readableLoadError(error: unknown): string {
  if (isTransientConnectionError(error)) return "تعذّر الاتصال بـFirestore. افحص اتصال الإنترنت أو وصول الشبكة إلى Firebase، ثم اختر «إعادة المحاولة». إذا استمر الخطأ، أرسل هذه الرسالة للدعم الفني؛ فهو خطأ اتصال وليس دليلًا وحده على رفض الصلاحيات.";
  const code = String((error as { code?: string })?.code ?? "");
  if (code.includes("permission-denied")) return "الحساب مسجل الدخول لكن Firestore رفض قراءة بيانات النظام. راجع صلاحية الحساب وقواعد المشروع الحالية.";
  return error instanceof Error ? error.message : "تعذر تحميل بيانات النظام.";
}

function localData(): AcademyData {
  try {
    const raw = localStorage.getItem(localKey);
    const value = raw ? JSON.parse(raw) as AcademyData : clone(EMPTY_DATA);
    ensureStudentCodes(value);
    return value;
  } catch { const value = clone(EMPTY_DATA); ensureStudentCodes(value); return value; }
}

function readHistory(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-50) : [];
  } catch { return []; }
}

export function useAcademy() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<AcademyData>(() => {
    const value = import.meta.env.DEV ? previewData() : localData();
    ensureStudentCodes(value);
    return value;
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [teacherAccounts, setTeacherAccounts] = useState<TeacherAccount[]>([]);
  const [error, setError] = useState("");
  const repository = useRef<CloudRepository | null>(null);
  const loadAttempt = useRef(0);
  const teacherUnsubscribe = useRef<(() => void) | null>(null);
  const currentData = useRef(data);
  const saveQueue = useRef(Promise.resolve());
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const historyKey = useRef("spk-hub-undo");
  const historyReady = useRef(false);

  useEffect(() => { currentData.current = data; }, [data]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const persistLocal = useCallback((value: AcademyData) => {
    try { localStorage.setItem(localKey, JSON.stringify(value)); } catch { /* storage can be unavailable */ }
  }, []);

  const loadUser = useCallback(async (user: User) => {
    const attemptId = ++loadAttempt.current;
    setPhase("loading");
    setError("");
    let lastError: unknown;
    const waits = [0, 800, 1800];
    for (let attempt = 0; attempt < waits.length; attempt += 1) {
      if (waits[attempt]) await new Promise((resolve) => window.setTimeout(resolve, waits[attempt]));
      if (attemptId !== loadAttempt.current) return;
      try {
        await enableNetwork(firestore);
        const repo = new CloudRepository(user);
        repository.current = repo;
        const loaded = await repo.load();
        if (attemptId !== loadAttempt.current) return;
        const combined = canAccessFinance(loaded.profile.role) ? loaded.data : { ...loaded.data, finance: [] };
        const migratedCodes = ensureStudentCodes(combined);
        if (migratedCodes && (loaded.profile.role === "owner" || loaded.profile.role === "admin") && !import.meta.env.DEV) {
          try { await repo.save(combined); }
          catch (migrationError) { console.warn("Student-code migration will be retried on a later save", migrationError); }
        }
        setTeacherAccounts(repo.getTeacherDirectory());
        if (loaded.profile.role !== "teacher" && !isMarketingRole(loaded.profile.role)) {
          try { setBackups(await repo.listBackups()); } catch (backupError) { console.warn("Backup list unavailable", backupError); }
        }
        historyKey.current = `spk-hub-undo-${user.uid}`;
        undoStack.current = readHistory(historyKey.current);
        redoStack.current = readHistory(historyKey.current.replace("undo", "redo"));
        if (!undoStack.current.length && loaded.profile.role === "owner") undoStack.current = readHistory("spk-hub-undo");
        if (!redoStack.current.length && loaded.profile.role === "owner") redoStack.current = readHistory("spk-hub-redo");
        currentData.current = combined;
        setData(combined);
        persistLocal(combined);
        setProfile(loaded.profile);
        teacherUnsubscribe.current?.();
        teacherUnsubscribe.current = repo.watchTeacherAccounts(() => currentData.current, setTeacherAccounts);
        historyReady.current = true;
        setPhase("ready");
        return;
      } catch (loadError: unknown) {
        lastError = loadError;
        console.error(`Speakozy load failed (attempt ${attempt + 1})`, loadError);
        if (!isTransientConnectionError(loadError) || attempt === waits.length - 1) break;
      }
    }
    if (attemptId !== loadAttempt.current) return;
    repository.current = null;
    setError(readableLoadError(lastError));
    setPhase("error");
  }, [persistLocal]);

  const retryConnection = useCallback(() => {
    const user = auth.currentUser;
    if (!user) { setPhase("signed-out"); return; }
    void loadUser(user);
  }, [loadUser]);

  const persistHistory = useCallback(() => {
    try {
      localStorage.setItem(historyKey.current, JSON.stringify(undoStack.current.slice(-50)));
      localStorage.setItem(historyKey.current.replace("undo", "redo"), JSON.stringify(redoStack.current.slice(-50)));
    } catch { /* history remains available for this session */ }
  }, []);

  const enqueueSave = useCallback((value: AcademyData) => {
    if (import.meta.env.DEV) {
      setToast({ text: "معاينة تجريبية: التعديل محلي فقط ولم يتم الاتصال بـ Firebase.", tone: "info" });
      return;
    }
    const repo = repository.current;
    if (!repo) return;
    setSaving(true);
    saveQueue.current = saveQueue.current
      .then(() => repo.save(value))
      .then((result) => {
        setToast(result === "preview"
          ? { text: "تغييرات المعاينة محلية فقط؛ لم تُكتب في Firebase.", tone: "info" }
          : { text: "تم الحفظ والمزامنة.", tone: "success" });
      })
      .catch((saveError: unknown) => {
        console.error("Speakozy save failed", saveError);
        setToast({ text: "تعذر الحفظ الآن. التعديل محفوظ على هذا الجهاز وسيعاد عند المحاولة التالية.", tone: "error" });
      })
      .finally(() => setSaving(false));
  }, []);

  const commit = useCallback((mutate: (draft: AcademyData) => void, message?: string) => {
    const prior = JSON.stringify(currentData.current);
    const next = clone(currentData.current);
    mutate(next);
    pruneOrphanAttendance(next);
    ensureStudentCodes(next);
    if (!canAccessFinance(profile?.role)) next.finance = [];
    const current = JSON.stringify(next);
    if (prior === current) return;
    if (historyReady.current && prior !== current) {
      undoStack.current.push(prior);
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      persistHistory();
    }
    currentData.current = next;
    setData(next);
    persistLocal(next);
    if (message) setToast({ text: message, tone: "success" });
    enqueueSave(next);
  }, [enqueueSave, persistHistory, persistLocal, profile]);

  const restoreHistory = useCallback((direction: "undo" | "redo") => {
    const source = direction === "undo" ? undoStack.current : redoStack.current;
    const target = direction === "undo" ? redoStack.current : undoStack.current;
    const snapshot = source.pop();
    if (!snapshot) return;
    try {
      target.push(JSON.stringify(currentData.current));
      if (target.length > 50) target.shift();
      const next = clone(JSON.parse(snapshot) as AcademyData);
      if (!canAccessFinance(profile?.role)) next.finance = [];
      currentData.current = next;
      setData(next);
      persistLocal(next);
      persistHistory();
      enqueueSave(next);
      setToast({ text: direction === "undo" ? "تم التراجع عن آخر إجراء." : "تمت إعادة الإجراء." , tone: "success" });
    } catch (restoreError) {
      console.error("Speakozy history restore failed", restoreError);
      setToast({ text: "تعذر استعادة هذا التغيير.", tone: "error" });
    }
  }, [enqueueSave, persistHistory, persistLocal, profile]);
  const undo = useCallback(() => restoreHistory("undo"), [restoreHistory]);
  const redo = useCallback(() => restoreHistory("redo"), [restoreHistory]);

  const refreshBackups = useCallback(async () => {
    const repo = repository.current;
    if (!repo || import.meta.env.DEV || repo.profile.role === "teacher" || isMarketingRole(repo.profile.role)) { setBackups([]); return []; }
    setBackupsLoading(true);
    try { const values = await repo.listBackups(); setBackups(values); return values; }
    catch (backupError) { console.warn("Backup list unavailable", backupError); return []; }
    finally { setBackupsLoading(false); }
  }, []);

  const refreshMarketingProjection = useCallback(async () => {
    if (profile?.role !== "owner") return;
    const repo = repository.current;
    if (!repo || import.meta.env.DEV) { setToast({ text: "المعاينة لا تكتب إلى Firebase.", tone: "info" }); return; }
    try { await repo.refreshMarketingProjection(currentData.current); setToast({ text: "تم تحديث إسقاط إحصائيات التسويق.", tone: "success" }); }
    catch (projectionError) { console.warn("Marketing projection update failed", projectionError); setToast({ text: "تعذر تحديث الإحصائيات. راجع قواعد hub/marketing.", tone: "error" }); }
  }, [profile]);

  const deleteTeacherFromSystem = useCallback(async (name: string): Promise<boolean> => {
    if (profile?.role !== "owner") throw new Error("حذف المدرس متاح للمالك فقط.");
    const repo = repository.current;
    if (!repo && !import.meta.env.DEV) throw new Error("تعذر الاتصال بالنظام؛ لم يتم حذف المدرس.");
    const next = clone(currentData.current);
    deleteTeacher(next, name);
    setSaving(true);
    try {
      if (repo && !import.meta.env.DEV) {
        await saveQueue.current;
        await repo.save(next);
        currentData.current = next;
        setData(next);
        persistLocal(next);
        const accountDisabled = await repo.disableTeacherAccount(name);
        setTeacherAccounts(repo.getTeacherDirectory());
        setToast({ text: accountDisabled ? "تم حذف المدرس من النظام وإيقاف دخوله. سجلاته التاريخية محفوظة." : "تم حذف اسم المدرس من القوائم مع حفظ سجلاته التاريخية.", tone: "success" });
      } else {
        currentData.current = next;
        setData(next);
        persistLocal(next);
        setToast({ text: "المعاينة فقط: تم إخفاء المدرس محليًا ولم يتغير Firebase.", tone: "info" });
      }
      return true;
    } catch (removeError) {
      console.error("Teacher removal failed", removeError);
      throw removeError;
    } finally { setSaving(false); }
  }, [persistLocal, profile]);

  const setAttendance = useCallback((date: string, gid: string, mid: string, status: AttendanceStatus, teacher: string) => {
    commit((draft) => {
      const index = draft.attendance.findIndex((item) => item.date === date && item.gid === gid && item.mid === mid);
      const next = { id: draft.attendance[index]?.id, date, gid, mid, status, teacher, updatedAt: Date.now() };
      if (index >= 0) draft.attendance[index] = { ...draft.attendance[index], ...next };
      else draft.attendance.push(next);
    }, status ? "تم تحديث الحضور." : "تم مسح علامة الحضور.");
  }, [commit]);

  const login = useCallback(async (email: string, password: string) => {
    if (import.meta.env.DEV) { setError("المعاينة تعمل ببيانات تجريبية ولا تستخدم تسجيل دخول أو بيانات Firebase."); return; }
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      window.location.href = "/system-preview.html";
    } catch (loginError: unknown) {
      console.error("Firebase sign-in error", loginError);
      setError("تعذّر تسجيل الدخول. راجع البريد الإلكتروني وكلمة المرور.");
    }
  }, []);

  const logout = useCallback(async () => {
    if (import.meta.env.DEV) { setToast({ text: "المعاينة لا تسجل الدخول إلى حساب حقيقي.", tone: "info" }); return; }
    await signOut(auth);
    window.location.href = "/login.html";
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const sample = previewData();
      currentData.current = sample;
      setData(sample);
      const requestedRole = new URLSearchParams(window.location.search).get("role");
      const previewRole = requestedRole === "marketing" ? "marketing" : requestedRole === "marketer" ? "marketer" : "owner";
      setProfile({ uid: `preview-${previewRole}`, email: `preview-${previewRole}@speakozy.test`, role: previewRole, teacherName: "" });
      historyReady.current = true;
      setPhase("ready");
      repository.current = null;
      return undefined;
    }
    let active = true;
    let authResolved = false;
    let authTimer = window.setTimeout(() => {
      if (active && !authResolved) {
        setError("استغرق التحقق من جلسة Firebase وقتًا أطول من المعتاد. أعد تحميل الصفحة أو سجّل الدخول مرة أخرى.");
        setPhase("error");
      }
    }, AUTH_START_TIMEOUT_MS);
    let dataTimer: number | undefined;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      authResolved = true;
      window.clearTimeout(authTimer);
      if (dataTimer !== undefined) window.clearTimeout(dataTimer);
      if (!user) {
        loadAttempt.current += 1;
        teacherUnsubscribe.current?.();
        teacherUnsubscribe.current = null;
        repository.current = null;
        setTeacherAccounts([]);
        setProfile(null);
        setPhase("signed-out");
        return;
      }
      let loadFinished = false;
      dataTimer = window.setTimeout(() => {
        if (!active || loadFinished) return;
        loadAttempt.current += 1;
        repository.current = null;
        setError("استغرق تحميل بيانات النظام أكثر من دقيقة. أعد المحاولة، وإذا استمر الخطأ أرسل هذه الرسالة للدعم.");
        setPhase("error");
      }, DATA_LOAD_TIMEOUT_MS);
      void loadUser(user).finally(() => {
        loadFinished = true;
        if (dataTimer !== undefined) window.clearTimeout(dataTimer);
      });
    });
    return () => {
      active = false;
      window.clearTimeout(authTimer);
      if (dataTimer !== undefined) window.clearTimeout(dataTimer);
      loadAttempt.current += 1;
      unsubscribe();
      teacherUnsubscribe.current?.();
      teacherUnsubscribe.current = null;
    };
  }, [loadUser]);

  useEffect(() => {
    if (import.meta.env.DEV || phase !== "error" || !isTransientConnectionError(error)) return undefined;
    const resume = () => { if (auth.currentUser) void loadUser(auth.currentUser); };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [phase, error, loadUser]);

  useEffect(() => {
    if (phase !== "ready" || !repository.current) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await repository.current?.refresh(currentData.current);
        if (next) {
          const safeNext = canAccessFinance(profile?.role) ? next : { ...next, finance: [] };
          currentData.current = safeNext;
          setData(safeNext);
          persistLocal(safeNext);
        }
      } catch (pollError) { console.warn("Speakozy poll failed", pollError); }
    }, profile?.role === "teacher" ? 15000 : 20000);
    return () => window.clearInterval(timer);
  }, [phase, profile?.role, persistLocal]);

  useEffect(() => {
    if (import.meta.env.DEV || phase !== "ready" || !profile || !["owner", "admin"].includes(profile.role)) return undefined;
    const syncFormerCustomers = () => {
      const next = clone(currentData.current);
      const added = addAutomaticFormerCustomerCopies(next);
      if (!added) return;
      ensureStudentCodes(next);
      currentData.current = next;
      setData(next);
      persistLocal(next);
      enqueueSave(next);
      setToast({ text: `أُضيفت ${added} نسخة تلقائية إلى «عملاء قدام» مع بقاء الطلاب في جروباتهم.`, tone: "success" });
    };
    syncFormerCustomers();
    const timer = window.setInterval(syncFormerCustomers, 60_000);
    return () => window.clearInterval(timer);
  }, [phase, profile?.role, data, enqueueSave, persistLocal]);

  const api = useMemo(() => ({ phase, profile, data, saving, toast, error, commit, setAttendance, login, logout, retryConnection, setToast, undo, redo, canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0, backups, backupsLoading, refreshBackups, refreshMarketingProjection, deleteTeacherFromSystem, teacherAccounts }), [phase, profile, data, saving, toast, error, commit, setAttendance, login, logout, retryConnection, undo, redo, backups, backupsLoading, refreshBackups, refreshMarketingProjection, deleteTeacherFromSystem, teacherAccounts]);
  return api;
}
