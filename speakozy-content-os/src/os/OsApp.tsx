import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CheckCheck,
  Circle, Clock3, Copy, FileText, Goal, Home, Lightbulb, ListTodo, LogOut, Menu,
  MoreHorizontal, Plus, Search, Settings, Sparkles, Target, X
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, firestore } from "../services/firebase";

type Page = "dashboard" | "strategy" | "studio" | "calendar" | "tasks" | "reminders" | "planning" | "settings";
type ContentStatus = "idea" | "draft" | "ready" | "scheduled" | "published" | "overdue" | "rescheduled" | "archived";
type Content = { id: string; title: string; platform: string; format: string; category: string; text: string; mediaUrl: string; goalId: string; date: string; time: string; priority: string; status: ContentStatus; notes: string; createdAt: string };
type Task = { id: string; title: string; description: string; category: string; priority: string; dueDate: string; dueTime: string; status: "pending" | "progress" | "completed"; recurrence: "none" | "daily" | "weekly" | "monthly"; seriesId: string; contentId: string; goalId: string; notes: string };
type GoalItem = { id: string; title: string; description: string; objective: string; notes: string; targetDate: string; parentId: string };
type Reminder = { id: string; title: string; description: string; date: string; time: string; recurrence: "none" | "daily" | "weekly" | "monthly"; taskId: string; contentId: string; done: boolean; seriesId: string };
type Workspace = { goals: GoalItem[]; content: Content[]; tasks: Task[]; reminders: Reminder[]; priorities: Record<string, string>; weekPriorities: Record<string, string>; monthlyPlans: Record<string, { priority: string; theme: string; dates: string }>; settings: { timezone: string; weeklyDay: string; contentPlatforms: string[]; contentFormats: string[]; contentCategories: string[] } };
type ModalState = { kind: "content" | "idea" | "task" | "reminder" | "goal"; id?: string } | null;

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "لوحة اليوم", icon: Home },
  { id: "strategy", label: "الأهداف والاستراتيجية", icon: Target },
  { id: "studio", label: "استوديو المحتوى", icon: FileText },
  { id: "calendar", label: "تقويم المحتوى", icon: CalendarDays },
  { id: "tasks", label: "إدارة المهام", icon: ListTodo },
  { id: "reminders", label: "التذكيرات", icon: Bell },
  { id: "planning", label: "التخطيط الأسبوعي", icon: CheckCheck },
  { id: "settings", label: "الإعدادات", icon: Settings }
];
const STATUS: Record<ContentStatus, string> = { idea: "فكرة", draft: "مسودة", ready: "جاهز", scheduled: "مجدول", published: "منشور", overdue: "متأخر", rescheduled: "أُعيدت جدولته", archived: "مؤرشف" };
const STATUSES: ContentStatus[] = ["idea", "draft", "ready", "scheduled", "published", "overdue", "rescheduled", "archived"];
const PLATFORMS = ["Instagram", "X", "Facebook", "TikTok", "YouTube", "منصة أخرى"];
const FORMATS = ["منشور", "قصة", "ريلز", "فيديو قصير", "سلسلة منشورات", "حملة", "صيغة أخرى"];
const CATEGORIES = ["مشكلة يواجهها الجمهور", "قصة قريبة من الجمهور", "محتوى تعليمي", "تجربة أو شهادة", "محتوى ترويجي", "محتوى تفاعلي", "وعي بالعلامة", "من خلف الكواليس"];
const TASK_CATEGORIES = ["مهمة يومية", "مهمة أسبوعية", "مهمة شهرية", "مهمة لمرة واحدة", "مهمة محتوى", "مهمة تخطيط", "إنتاجية شخصية"];
const TIMEZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Europe/London", "UTC"];
type AppUser = Pick<User, "uid" | "email" | "displayName"> & { offline?: boolean };
const LOCAL_USER: AppUser = { uid: "local-speakozy", email: "حفظ على هذا الجهاز", displayName: "مساحة Speakozy", offline: true };
const LOCAL_KEY = "speakozy-content-os-v1";

const DEFAULT_GOALS: GoalItem[] = [
  { id: "g-brand", title: "العلامة التجارية", description: "ترسيخ هوية ورسالة واضحة ومتّسقة لـ Speakozy.", objective: "توضيح ما يميز Speakozy وبناء حضور يسهل تذكّره.", notes: "", targetDate: "", parentId: "" },
  { id: "g-audience", title: "الجمهور", description: "فهم احتياجات المهتمين بتعلّم الإنجليزية وبناء مجتمع مهتم.", objective: "نشر محتوى قريب من أسئلة المتعلمين واحتياجاتهم.", notes: "", targetDate: "", parentId: "" },
  { id: "g-content", title: "نظام المحتوى", description: "تنظيم التخطيط والإنتاج وإعادة استخدام المحتوى عبر المنصات.", objective: "إنشاء طريقة واضحة تحافظ على استمرارية النشر.", notes: "", targetDate: "", parentId: "" },
  { id: "g-marketing", title: "التسويق والتوزيع", description: "توزيع المحتوى على X وInstagram والفيديوهات القصيرة.", objective: "الحفاظ على حضور متناسق وإيصال المحتوى المناسب لكل منصة.", notes: "", targetDate: "", parentId: "" },
  { id: "g-consistency", title: "الاستمرارية والتنفيذ", description: "بناء عادات يومية ومراجعات أسبوعية وشهرية قابلة للاستمرار.", objective: "تحويل الخطة إلى خطوات يومية بسيطة ومنجزة.", notes: "", targetDate: "", parentId: "" }
];

function blankWorkspace(): Workspace {
  return { goals: DEFAULT_GOALS.map((goal) => ({ ...goal })), content: [], tasks: [], reminders: [], priorities: {}, weekPriorities: {}, monthlyPlans: {}, settings: { timezone: "Africa/Cairo", weeklyDay: "0", contentPlatforms: [...PLATFORMS], contentFormats: [...FORMATS], contentCategories: [...CATEGORIES] } };
}
function normalizeWorkspace(value: unknown): Workspace {
  const base = blankWorkspace();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<Workspace>;
  const savedSettings = (raw.settings as Partial<Workspace["settings"]> | undefined) ?? {};
  const settings = { timezone: savedSettings.timezone || base.settings.timezone, weeklyDay: savedSettings.weeklyDay || base.settings.weeklyDay, contentPlatforms: Array.isArray(savedSettings.contentPlatforms) ? savedSettings.contentPlatforms : base.settings.contentPlatforms, contentFormats: Array.isArray(savedSettings.contentFormats) ? savedSettings.contentFormats : base.settings.contentFormats, contentCategories: Array.isArray(savedSettings.contentCategories) ? savedSettings.contentCategories : base.settings.contentCategories };
  const reminders = Array.isArray(raw.reminders) ? raw.reminders.map((item) => { if (!item || typeof item !== "object") return item; const { channel: _removedChannel, ...reminder } = item as Reminder & { channel?: unknown }; return reminder; }) as Reminder[] : [];
  return { goals: Array.isArray(raw.goals) ? raw.goals : base.goals, content: Array.isArray(raw.content) ? raw.content : [], tasks: Array.isArray(raw.tasks) ? raw.tasks : [], reminders, priorities: raw.priorities && typeof raw.priorities === "object" ? raw.priorities : {}, weekPriorities: raw.weekPriorities && typeof raw.weekPriorities === "object" ? raw.weekPriorities : {}, monthlyPlans: raw.monthlyPlans && typeof raw.monthlyPlans === "object" ? raw.monthlyPlans : {}, settings };
}
function readLocalWorkspace() {
  try { const stored = localStorage.getItem(LOCAL_KEY); return stored ? normalizeWorkspace(JSON.parse(stored)) : blankWorkspace(); }
  catch { return blankWorkspace(); }
}
function isoToday(zone = "Africa/Cairo", date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${p.find((x) => x.type === "year")?.value}-${p.find((x) => x.type === "month")?.value}-${p.find((x) => x.type === "day")?.value}`;
}
function dateFromIso(iso: string) { return new Date(`${iso || isoToday()}T12:00:00Z`); }
function fmtDate(iso: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }, zone = "Africa/Cairo") {
  try { return new Intl.DateTimeFormat("ar-EG", { ...options, timeZone: zone }).format(dateFromIso(iso)); } catch { return iso; }
}
function uid() { return crypto.randomUUID(); }
function nextDue(date: string, recurrence: "none" | "daily" | "weekly" | "monthly") {
  const d = dateFromIso(date || isoToday());
  if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function getWeekStart(iso: string, weekStartsOn = 1) { const d = dateFromIso(iso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekStartsOn + 7) % 7)); return d.toISOString().slice(0, 10); }
function dayLabel(iso: string, zone: string) { return fmtDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, zone); }
function joinClass(...values: Array<string | false | undefined>) { return values.filter(Boolean).join(" "); }

export function OsApp() {
  const [user, setUser] = useState<AppUser | null>(auth ? null : LOCAL_USER);
  const [authReady, setAuthReady] = useState(!auth);
  const [workspace, setWorkspace] = useState<Workspace>(() => auth ? blankWorkspace() : readLocalWorkspace());
  const [dataReady, setDataReady] = useState(!auth);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">(auth ? "loading" : "saved");
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("month");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [taskView, setTaskView] = useState("today");
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [priorityEditing, setPriorityEditing] = useState(false);
  const [priorityDraft, setPriorityDraft] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [clockMinute, setClockMinute] = useState(() => Date.now());
  const initialSnapshot = useRef(false);
  const lastSavedFingerprint = useRef("");
  const today = isoToday(workspace.settings.timezone);
  const mainPriority = workspace.priorities[today] ?? "";
  const pageTitle = NAV.find((item) => item.id === page)?.label ?? "لوحة اليوم";

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true); });
  }, []);
  useEffect(() => {
    if (!user) { setWorkspace(blankWorkspace()); setDataReady(false); setSaveState("loading"); initialSnapshot.current = false; return; }
    if (!firestore || user.offline) { setWorkspace(readLocalWorkspace()); setDataReady(true); setSaveState("saved"); return; }
    setSaveState("loading");
    const db = firestore;
    const ref = doc(db, "contentOS", user.uid, "workspace", "main");
    return onSnapshot(ref, (snapshot) => {
      if (!snapshot.exists()) {
        if (!initialSnapshot.current) { const fresh = blankWorkspace(); initialSnapshot.current = true; lastSavedFingerprint.current = JSON.stringify(fresh); setWorkspace(fresh); }
      } else {
        initialSnapshot.current = true;
        const loaded = normalizeWorkspace(snapshot.data());
        lastSavedFingerprint.current = JSON.stringify(loaded);
        setWorkspace(loaded);
      }
      setDataReady(true); setSaveState("saved");
    }, (error) => { console.error("تعذّر تحميل مساحة العمل", error); setSaveState("error"); setDataReady(true); });
  }, [user]);
  useEffect(() => { const timer = window.setInterval(() => setClockMinute(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!user || !dataReady) return;
    if (!firestore || user.offline) {
      const timeout = window.setTimeout(() => {
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(workspace)); setSaveState("saved"); }
        catch { setSaveState("error"); }
      }, 350);
      return () => window.clearTimeout(timeout);
    }
    if (!initialSnapshot.current) return;
    const fingerprint = JSON.stringify(workspace);
    if (lastSavedFingerprint.current === fingerprint) { setSaveState("saved"); return; }
    setSaveState("saving");
    const db = firestore;
    const timeout = window.setTimeout(() => {
      setDoc(doc(db, "contentOS", user.uid, "workspace", "main"), { ...workspace, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => { lastSavedFingerprint.current = fingerprint; setSaveState("saved"); }).catch((error) => { console.error("تعذّر حفظ مساحة العمل", error); setSaveState("error"); });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [workspace, user, dataReady]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(""), 2600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { if (!selectedDate) setSelectedDate(isoToday(workspace.settings.timezone)); }, [selectedDate, workspace.settings.timezone]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase(); if (!needle) return [];
    const results: { kind: Page; id: string; title: string; detail: string }[] = [];
    workspace.content.forEach((x) => { if (`${x.title} ${x.text} ${x.platform}`.toLowerCase().includes(needle)) results.push({ kind: "studio", id: x.id, title: x.title || "محتوى بلا عنوان", detail: `محتوى · ${x.platform}` }); });
    workspace.tasks.forEach((x) => { if (`${x.title} ${x.description}`.toLowerCase().includes(needle)) results.push({ kind: "tasks", id: x.id, title: x.title, detail: "مهمة" }); });
    workspace.reminders.forEach((x) => { if (`${x.title} ${x.description}`.toLowerCase().includes(needle)) results.push({ kind: "reminders", id: x.id, title: x.title, detail: "تذكير" }); });
    workspace.goals.forEach((x) => { if (`${x.title} ${x.description}`.toLowerCase().includes(needle)) results.push({ kind: "strategy", id: x.id, title: x.title, detail: "هدف" }); });
    return results.slice(0, 8);
  }, [query, workspace]);

  function patchWorkspace(patch: Partial<Workspace>) { setWorkspace((current) => ({ ...current, ...patch })); }
  function openModal(kind: NonNullable<ModalState>["kind"], id?: string) { setModal({ kind, id }); }
  function completeTask(task: Task) {
    setWorkspace((current) => {
      const tasks = current.tasks.map((item) => {
        if (item.id !== task.id) return item;
        const status: Task["status"] = item.status === "completed" ? "pending" : "completed";
        return { ...item, status };
      });
      if (task.status !== "completed" && task.recurrence !== "none") {
        const date = nextDue(task.dueDate || today, task.recurrence); const seriesId = task.seriesId || task.id;
        if (!current.tasks.some((item) => (item.seriesId || item.id) === seriesId && item.dueDate === date)) {
          tasks.push({ ...task, id: uid(), seriesId, dueDate: date, status: "pending" });
        }
      }
      return { ...current, tasks };
    });
  }
  function saveContent(value: Omit<Content, "id" | "createdAt">, id?: string) {
    const item: Content = { ...value, id: id || uid(), createdAt: id ? workspace.content.find((x) => x.id === id)?.createdAt ?? new Date().toISOString() : new Date().toISOString() };
    patchWorkspace({ content: id ? workspace.content.map((x) => x.id === id ? item : x) : [item, ...workspace.content] }); setModal(null); setToast(id ? "تم تحديث المحتوى" : "أُضيف المحتوى إلى خطتك");
  }
  function saveTask(value: Omit<Task, "id" | "status" | "seriesId">, id?: string) {
    const previous = workspace.tasks.find((x) => x.id === id);
    const item: Task = { ...value, id: id || uid(), status: previous?.status ?? "pending", seriesId: previous?.seriesId || (value.recurrence !== "none" ? id || uid() : "") };
    patchWorkspace({ tasks: id ? workspace.tasks.map((x) => x.id === id ? item : x) : [item, ...workspace.tasks] }); setModal(null); setToast(id ? "تم تحديث المهمة" : "أُضيفت المهمة");
  }
  function saveReminder(value: Omit<Reminder, "id" | "done" | "seriesId">, id?: string) {
    const previous = workspace.reminders.find((x) => x.id === id);
    const item: Reminder = { ...value, id: id || uid(), done: previous?.done ?? false, seriesId: previous?.seriesId || (value.recurrence !== "none" ? id || uid() : "") };
    patchWorkspace({ reminders: id ? workspace.reminders.map((x) => x.id === id ? item : x) : [item, ...workspace.reminders] }); setModal(null); setToast("تم حفظ التذكير");
  }
  function toggleReminder(id: string) {
    setWorkspace((current) => {
      const reminder = current.reminders.find((x) => x.id === id);
      if (!reminder) return current;
      const nextDone = !reminder.done;
      const reminders = current.reminders.map((x) => x.id === id ? { ...x, done: nextDone } : x);
      if (nextDone && reminder.recurrence !== "none") {
        const date = nextDue(reminder.date, reminder.recurrence); const seriesId = reminder.seriesId || reminder.id;
        if (!current.reminders.some((x) => x.id !== id && (x.seriesId || x.id) === seriesId && x.date === date)) reminders.push({ ...reminder, id: uid(), seriesId, date, done: false });
      }
      return { ...current, reminders };
    });
  }
  function saveGoal(value: Omit<GoalItem, "id">, id?: string) {
    const item: GoalItem = { ...value, id: id || uid() };
    patchWorkspace({ goals: id ? workspace.goals.map((x) => x.id === id ? item : x) : [...workspace.goals, item] }); setModal(null); setToast("تم حفظ الهدف");
  }
  function addPriority(value: string) { patchWorkspace({ priorities: { ...workspace.priorities, [today]: value } }); setPriorityEditing(false); }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setAuthError("");
    if (!auth) return;
    try { await signInWithEmailAndPassword(auth, String(form.get("email")), String(form.get("password"))); }
    catch (error) { const code = (error as { code?: string }).code; setAuthError(code === "auth/invalid-credential" ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : "تعذّر تسجيل الدخول. تحقق من الاتصال وحاول مرة أخرى."); }
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), workspace }, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `speakozy-os-backup-${today}.json`; link.click(); URL.revokeObjectURL(link.href); setToast("تم تنزيل نسخة بياناتك");
  }

  if (!authReady) return <div className="os-loading"><div className="os-spinner"/><span>جارٍ فتح مساحة العمل…</span></div>;
  if (!user) return <LoginScreen onLogin={login} error={authError}/>;
  if (!dataReady && saveState === "loading") return <div className="os-loading"><div className="os-spinner"/><span>جارٍ مزامنة مساحتك بأمان…</span></div>;

  const todayContent = workspace.content.filter((x) => x.date === today && x.status !== "archived").sort((a, b) => a.time.localeCompare(b.time));
  const overdueTasks = workspace.tasks.filter((x) => x.dueDate && x.dueDate < today && x.status !== "completed");
  const progressTasks = workspace.tasks.filter((x) => x.dueDate === today || (x.dueDate < today && x.status !== "completed"));
  const doneCount = progressTasks.filter((x) => x.status === "completed").length;
  const progress = progressTasks.length ? Math.round(doneCount / progressTasks.length * 100) : 0;
  const todayReminders = workspace.reminders.filter((x) => !x.done && x.date >= today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 3);
  const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: workspace.settings.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(clockMinute));
  const dueReminders = workspace.reminders.filter((x) => !x.done && (x.date < today || (x.date === today && (!x.time || x.time <= currentTime)))).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  return <div className="os-shell">
    <aside className={joinClass("os-sidebar", drawerOpen && "os-sidebar--open")}>
      <div className="os-brand"><div className="os-logo">s</div><div><strong>SPEAKOZY</strong><small>مساحة المحتوى والإنجاز</small></div><button className="os-icon-btn os-close-drawer" aria-label="إغلاق القائمة" onClick={() => setDrawerOpen(false)}><X size={18}/></button></div>
      <div className="os-nav-caption">مساحة العمل</div>
      <nav className="os-nav">{NAV.map((item) => <button key={item.id} className={joinClass("os-nav-item", page === item.id && "is-active")} onClick={() => { setPage(item.id); setDrawerOpen(false); setQuery(""); }}><item.icon size={18}/><span>{item.label}</span>{item.id === "tasks" && overdueTasks.length > 0 && <small className="os-nav-count">{overdueTasks.length}</small>}</button>)}</nav>
      <div className="os-side-note"><Sparkles size={16}/><span>خطوات صغيرة اليوم تصنع حضورًا مستمرًا.</span></div>
      <div className="os-account"><div className="os-avatar">{(user.displayName || user.email || "S").slice(0, 1).toUpperCase()}</div><div className="os-account-copy"><b>{user.displayName || "مساحة Speakozy"}</b><small>{user.email}</small></div>{!user.offline && <button title="تسجيل الخروج" className="os-icon-btn os-logout" onClick={() => auth && void signOut(auth)}><LogOut size={17}/></button>}</div>
    </aside>
    {drawerOpen && <button className="os-backdrop" aria-label="إغلاق القائمة" onClick={() => setDrawerOpen(false)}/>}
    <main className="os-main">
      <header className="os-topbar">
        <div className="os-top-left"><button className="os-icon-btn os-mobile-menu" aria-label="فتح القائمة" onClick={() => setDrawerOpen(true)}><Menu size={20}/></button><div className="os-breadcrumb">مساحة Speakozy <span>/</span> <b>{pageTitle}</b></div></div>
        <div className="os-top-tools">
          <div className="os-search-wrap"><Search size={17}/><input aria-label="بحث شامل" placeholder="ابحث في المحتوى والمهام…" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button aria-label="مسح البحث" onClick={() => setQuery("")}><X size={14}/></button>}
            {query && <div className="os-search-pop">{searchResults.length ? searchResults.map((result) => <button key={`${result.kind}-${result.id}`} onClick={() => { setPage(result.kind); setQuery(""); }}>{result.title}<small>{result.detail}</small></button>) : <p>لا توجد نتائج مطابقة.</p>}</div>}
          </div>
          <span className={joinClass("os-save", `os-save--${saveState}`)}><i/>{saveState === "saved" ? "تم الحفظ" : saveState === "saving" ? "جارٍ الحفظ" : saveState === "error" ? "تعذّر الحفظ" : "جارٍ المزامنة"}</span>
          <div className="os-notifications-wrap"><button className={joinClass("os-notifications-button", notificationsOpen && "is-open")} aria-label={`إشعارات الموقع: ${dueReminders.length}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18}/>{dueReminders.length > 0 && <span className="os-notifications-count">{dueReminders.length > 9 ? "9+" : dueReminders.length}</span>}</button>{notificationsOpen && <section className="os-notifications-pop" aria-label="إشعارات الموقع"><div className="os-notifications-head"><b>إشعارات الموقع</b><small>{dueReminders.length} تذكيرات مستحقة</small></div>{dueReminders.length ? <div className="os-notifications-list">{dueReminders.map((reminder) => <button key={reminder.id} onClick={() => { setPage("reminders"); setNotificationsOpen(false); }}><span className="os-notification-dot"><Bell size={14}/></span><span><b>{reminder.title}</b><small>{reminder.date < today ? "متأخر" : "حان موعده"}{reminder.time ? ` · ${reminder.time}` : ""}</small></span><ArrowLeft size={14}/></button>)}</div> : <p className="os-notifications-empty">لا توجد تذكيرات مستحقة الآن.</p>}<div className="os-notifications-foot">تظهر التذكيرات هنا أثناء استخدام الموقع فقط.</div></section>}</div>
          <button className="os-avatar os-avatar--top" title={user.email || "الحساب"}>{(user.displayName || user.email || "S").slice(0, 1).toUpperCase()}</button>
        </div>
      </header>
      <div className="os-content">
        {page === "dashboard" && <Dashboard data={workspace} today={today} todayLabel={dayLabel(today, workspace.settings.timezone)} priority={mainPriority} editing={priorityEditing} priorityDraft={priorityDraft} setPriorityDraft={setPriorityDraft} onPriorityEdit={() => { setPriorityDraft(mainPriority); setPriorityEditing(true); }} onPrioritySave={addPriority} onPriorityCancel={() => setPriorityEditing(false)} progress={progress} doneCount={doneCount} totalTasks={progressTasks.length} todayContent={todayContent} tasks={workspace.tasks.filter((x) => x.dueDate === today && x.status !== "completed")} overdueTasks={overdueTasks} overdueContent={workspace.content.filter((x) => x.date && x.date < today && !["idea", "published", "archived"].includes(x.status)).map((x) => ({ ...x, status: "overdue" as ContentStatus }))} reminders={todayReminders} onToggleTask={completeTask} onEditContent={(id) => openModal("content", id)} onEditTask={(id) => openModal("task", id)} onAddContent={() => openModal("content")} onAddTask={() => openModal("task")} onAddReminder={() => openModal("reminder")} onAddIdea={() => openModal("idea")} onCalendar={() => setPage("calendar")} onNavigate={setPage} onCopyContent={async (text) => { await navigator.clipboard.writeText(text); setToast("تم نسخ المحتوى"); }} onPublish={(id) => patchWorkspace({ content: workspace.content.map((x) => x.id === id ? { ...x, status: "published" } : x) })} onRemindDone={(id) => toggleReminder(id)}/>}
        {page === "strategy" && <StrategyPage goals={workspace.goals} tasks={workspace.tasks} content={workspace.content} onAdd={() => openModal("goal")} onEdit={(id) => openModal("goal", id)} onNavigate={setPage}/>}
        {page === "studio" && <StudioPage content={workspace.content} goals={workspace.goals} platforms={workspace.settings.contentPlatforms} formats={workspace.settings.contentFormats} categories={workspace.settings.contentCategories} filter={statusFilter} setFilter={setStatusFilter} onAdd={() => openModal("content")} onIdea={() => openModal("idea")} onEdit={(id) => openModal("content", id)} onDuplicate={(item) => saveContent({ ...item, title: `${item.title} — نسخة`, status: "draft", date: "" })} onCopy={async (text) => { await navigator.clipboard.writeText(text); setToast("تم نسخ النص"); }} onArchive={(id) => patchWorkspace({ content: workspace.content.map((x) => x.id === id ? { ...x, status: "archived" } : x) })} onStatus={(id, status) => patchWorkspace({ content: workspace.content.map((x) => x.id === id ? { ...x, status } : x) })}/>}
        {page === "calendar" && <CalendarPage content={workspace.content} platforms={workspace.settings.contentPlatforms} selectedDate={selectedDate || today} setSelectedDate={setSelectedDate} monthCursor={monthCursor} setMonthCursor={setMonthCursor} view={calendarView} setView={setCalendarView} onAdd={(date) => { setSelectedDate(date); openModal("content"); }} onEdit={(id) => openModal("content", id)}/>}
        {page === "tasks" && <TasksPage tasks={workspace.tasks} view={taskView} setView={setTaskView} today={today} onAdd={() => openModal("task")} onEdit={(id) => openModal("task", id)} onToggle={completeTask} onRemove={(id) => patchWorkspace({ tasks: workspace.tasks.filter((x) => x.id !== id) })}/>}
        {page === "reminders" && <RemindersPage reminders={workspace.reminders} today={today} onAdd={() => openModal("reminder")} onEdit={(id) => openModal("reminder", id)} onToggle={toggleReminder} onRemove={(id) => patchWorkspace({ reminders: workspace.reminders.filter((x) => x.id !== id) })}/>}
        {page === "planning" && <PlanningPage data={workspace} today={today} onSaveWeekPriority={(value) => patchWorkspace({ weekPriorities: { ...workspace.weekPriorities, [getWeekStart(today, Number(workspace.settings.weeklyDay))]: value } })} onSaveMonth={(value) => patchWorkspace({ monthlyPlans: { ...workspace.monthlyPlans, [today.slice(0, 7)]: value } })} onAddContent={(date) => { setSelectedDate(date); openModal("content"); }} onAddTask={() => openModal("task")} onNavigateCalendar={() => setPage("calendar")}/>}
        {page === "settings" && <><SettingsPage data={workspace} user={user} onPatch={(settings) => patchWorkspace({ settings: { ...workspace.settings, ...settings } })} onExport={exportBackup}/><ContentTaxonomySettings settings={workspace.settings} onPatch={(settings) => patchWorkspace({ settings: { ...workspace.settings, ...settings } })}/></>}
      </div>
    </main>
    {modal && <Modal title={modalTitle(modal)} onClose={() => setModal(null)}><Editor modal={modal} data={workspace} defaultDate={selectedDate || today} onSaveContent={saveContent} onSaveTask={saveTask} onSaveReminder={saveReminder} onSaveGoal={saveGoal} onClose={() => setModal(null)}/></Modal>}
    {toast && <div className="os-toast"><Check size={17}/>{toast}</div>}
  </div>;
}

function modalTitle(modal: NonNullable<ModalState>) {
  const labels = { content: "إضافة محتوى جديد", idea: "حفظ فكرة محتوى", task: "إضافة مهمة", reminder: "إضافة تذكير", goal: "إضافة هدف" };
  return `${modal.id ? "تعديل" : ""} ${modal.id ? labels[modal.kind].replace("إضافة ", "") : labels[modal.kind]}`;
}

function LoginScreen({ onLogin, error }: { onLogin: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  return <main className="os-auth"><section className="os-auth-card"><div className="os-auth-brand"><div className="os-logo">s</div><div><strong>SPEAKOZY OS</strong><small>مساحة المحتوى والإنجاز</small></div></div><div className="os-auth-orb"/><span className="os-eyebrow">مساحتك تبدأ بخطوة</span><h1>أهلًا بك في خطتك اليومية.</h1><p>نظّم أفكار Speakozy ومحتواها ومهامها في مكان واحد واضح، وارجع إليها وقتما تحتاج.</p><form onSubmit={onLogin}><label>البريد الإلكتروني<input name="email" type="email" autoComplete="username" dir="ltr" required placeholder="name@example.com"/></label><label>كلمة المرور<input name="password" type="password" autoComplete="current-password" dir="ltr" required placeholder="••••••••"/></label>{error && <div className="os-form-error" role="alert">{error}</div>}<button className="os-btn os-btn--primary os-auth-submit">تسجيل الدخول <ArrowLeft size={17}/></button></form><div className="os-auth-foot"><span><i/> مساحة خاصة وآمنة</span><span>Africa/Cairo</span></div></section><section className="os-auth-art"><div className="os-art-top"><div className="os-art-brand"><span className="os-art-mark">s</span><span>SPEAKOZY<small>خطتك، محتواك، وإيقاعك</small></span></div><span className="os-art-pill"><Sparkles size={13}/> مساحة عمل شخصية</span></div><div className="os-art-copy"><div className="os-art-label">مساحة للتركيز</div><h2>كل يوم يبدأ<br/>بخطوة واضحة.</h2><p>اجمع أولوياتك وأفكارك ومحتواك في مكان يساعدك على الاستمرار بهدوء.</p><div className="os-art-line"/></div><div className="os-art-card"><span className="os-art-card-icon"><Target size={18}/></span><span><small>تركيز اليوم</small><b>خطوة واحدة تكفي للبدء</b></span><span className="os-art-check"><Check size={15}/></span></div><div className="os-art-footer"><span>01 — 05</span><span>نخطط. ننشر. نستمر.</span><span>● ● ● ●</span></div></section></main>;
}

function PageHeading({ eyebrow = "مساحة Speakozy", title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="os-page-heading"><div><span className="os-eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="os-heading-actions">{action}</div>}</div>; }
function Button({ children, secondary, icon, onClick, className = "", type = "button" }: { children: ReactNode; secondary?: boolean; icon?: ReactNode; onClick?: () => void; className?: string; type?: "button" | "submit" }) { return <button type={type} className={joinClass("os-btn", secondary ? "os-btn--soft" : "os-btn--primary", className)} onClick={onClick}>{icon}{children}</button>; }
function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <div className="os-section-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action}<ArrowLeft size={14}/></button>}</div>; }
function Empty({ title, detail, action, onAction, icon = <FileText size={20}/> }: { title: string; detail: string; action?: string; onAction?: () => void; icon?: ReactNode }) { return <div className="os-empty"><span>{icon}</span><b>{title}</b><p>{detail}</p>{action && <Button secondary icon={<Plus size={16}/>} onClick={onAction}>{action}</Button>}</div>; }
function StatusPill({ status }: { status: ContentStatus }) { return <span className={`os-status os-status--${status}`}>{STATUS[status]}</span>; }
function PlatformMark({ platform }: { platform: string }) { return <span className={joinClass("os-platform", platform === "X" ? "os-platform--x" : platform === "Instagram" ? "os-platform--ig" : platform === "TikTok" ? "os-platform--tt" : "os-platform--other")}>{platform === "Instagram" ? "ig" : platform === "X" ? "X" : platform === "TikTok" ? "tk" : platform.slice(0, 2)}</span>; }
function ContentCard({ item, onEdit, onPublish, onCopy, compact = false }: { item: Content; onEdit: () => void; onPublish?: () => void; onCopy?: () => void; compact?: boolean }) { return <article className={joinClass("os-content-card", compact && "os-content-card--compact")}><div className="os-card-title"><PlatformMark platform={item.platform}/><button className="os-title-button" onClick={onEdit}>{item.title || "محتوى بلا عنوان"}</button><button className="os-dots" aria-label="تعديل المحتوى" onClick={onEdit}><MoreHorizontal size={18}/></button></div><div className="os-card-meta"><span>{item.format || "محتوى"}</span><i/><span>{item.time || "دون وقت"}</span><StatusPill status={item.status}/></div>{!compact && item.text && <p className="os-card-preview">{item.text}</p>}{(onPublish || onCopy) && <div className="os-inline-actions">{onPublish && item.status !== "published" && item.status !== "archived" && <button className="os-inline-action" onClick={onPublish}><Check size={14}/> تم النشر</button>}{onCopy && <button className="os-inline-action" onClick={onCopy}><Copy size={14}/> نسخ</button>}</div>}</article>; }
function TaskRow({ item, onToggle, onEdit }: { item: Task; onToggle: () => void; onEdit: () => void }) { return <div className={joinClass("os-task-row", item.status === "completed" && "is-completed")}><button aria-label={item.status === "completed" ? "إلغاء الإنجاز" : "إنجاز المهمة"} className="os-check-btn" onClick={onToggle}>{item.status === "completed" ? <Check size={14}/> : <Circle size={17}/>}</button><button className="os-task-title" onClick={onEdit}>{item.title}</button><span className={`os-priority os-priority--${item.priority === "عالية" ? "high" : item.priority === "منخفضة" ? "low" : "medium"}`}>{item.priority || "متوسطة"}</span>{item.dueTime && <small className="os-task-time"><Clock3 size={13}/>{item.dueTime}</small>}</div>; }

function Dashboard(props: { data: Workspace; today: string; todayLabel: string; priority: string; editing: boolean; priorityDraft: string; setPriorityDraft: (value: string) => void; onPriorityEdit: () => void; onPrioritySave: (value: string) => void; onPriorityCancel: () => void; progress: number; doneCount: number; totalTasks: number; todayContent: Content[]; tasks: Task[]; overdueTasks: Task[]; overdueContent: Content[]; reminders: Reminder[]; onToggleTask: (task: Task) => void; onEditContent: (id: string) => void; onEditTask: (id: string) => void; onAddContent: () => void; onAddTask: () => void; onAddReminder: () => void; onAddIdea: () => void; onCalendar: () => void; onNavigate: (page: Page) => void; onCopyContent: (text: string) => void; onPublish: (id: string) => void; onRemindDone: (id: string) => void }) {
  const greeting = new Intl.DateTimeFormat("ar-EG", { hour: "numeric", timeZone: props.data.settings.timezone }).format(new Date());
  const hour = Number(greeting.replace(/\D/g, "").slice(0, 2)) || new Date().getHours();
  const salutation = hour < 12 ? "صباح الخير" : hour < 17 ? "يومك سعيد" : "مساء الخير";
  return <>
    <section className="os-welcome"><div className="os-welcome-text"><div className="os-date-line"><CalendarDays size={15}/>{props.todayLabel}</div><h1>{salutation} <span>👋</span></h1><p>هذه مساحة يومك. اختر خطوة وابدأ على مهلك.</p><div className="os-focus"><span className="os-focus-mark"><Target size={18}/></span><div className="os-focus-content"><small>أولوية اليوم</small>{props.editing ? <form className="os-priority-edit" onSubmit={(e) => { e.preventDefault(); props.onPrioritySave(props.priorityDraft); }}><input autoFocus value={props.priorityDraft} onChange={(e) => props.setPriorityDraft(e.target.value)} placeholder="ما أهم شيء تريد إنجازه؟"/><button type="submit"><Check size={15}/></button><button type="button" onClick={props.onPriorityCancel}><X size={15}/></button></form> : <button className="os-focus-value" onClick={props.onPriorityEdit}>{props.priority || "اختر أهم خطوة تود إنجازها اليوم"}<span>تعديل</span></button>}</div></div><div className="os-welcome-chips"><span><Sparkles size={14}/> {props.todayContent.length} محتوى اليوم</span><span><ListTodo size={14}/> {props.tasks.length} مهام مفتوحة</span></div></div><div className="os-progress-card"><div className="os-ring" style={{ "--progress": `${props.progress}%` } as React.CSSProperties}><div><b>{props.progress}<small>%</small></b><span>منجز</span></div></div><span className="os-progress-caption">إنجاز اليوم</span><small>{props.doneCount} من {props.totalTasks} مهام</small></div><div className="os-hero-orb os-hero-orb--one"/><div className="os-hero-orb os-hero-orb--two"/></section>
    <div className="os-quick-actions"><button onClick={props.onAddContent}><span className="os-quick-icon os-quick-icon--green"><Plus size={19}/></span><span><b>إضافة محتوى</b><small>منشور أو قصة جديدة</small></span><ArrowLeft size={16}/></button><button onClick={props.onAddTask}><span className="os-quick-icon os-quick-icon--cream"><ListTodo size={18}/></span><span><b>إضافة مهمة</b><small>خطوة تحتاج لإنجاز</small></span><ArrowLeft size={16}/></button><button onClick={props.onAddReminder}><span className="os-quick-icon os-quick-icon--lavender"><Bell size={17}/></span><span><b>إضافة تذكير</b><small>لا تنسَ موعدًا مهمًا</small></span><ArrowLeft size={16}/></button><button onClick={props.onAddIdea}><span className="os-quick-icon os-quick-icon--peach"><Lightbulb size={17}/></span><span><b>حفظ فكرة</b><small>التقط الفكرة الآن</small></span><ArrowLeft size={16}/></button></div>
    <div className="os-dashboard-grid">
      <section className="os-panel os-panel--main"><SectionTitle title="محتوى اليوم" action="تقويم المحتوى" onAction={props.onCalendar}/>{props.todayContent.length ? <div className="os-card-list">{props.todayContent.map((item) => <ContentCard key={item.id} item={item} onEdit={() => props.onEditContent(item.id)} onPublish={() => props.onPublish(item.id)} onCopy={() => props.onCopyContent(item.text)}/>)}</div> : <Empty icon={<CalendarDays size={20}/>} title="يومك مفتوح للأفكار" detail="لا يوجد محتوى مجدول اليوم. أضف محتوى جديدًا أو خطط ليوم آخر." action="إضافة محتوى" onAction={props.onAddContent}/>}</section>
      <section className="os-panel"><SectionTitle title="مهام اليوم" action="كل المهام" onAction={() => props.onNavigate("tasks")}/>{props.tasks.length ? <div className="os-task-list">{props.tasks.slice(0, 6).map((task) => <TaskRow key={task.id} item={task} onToggle={() => props.onToggleTask(task)} onEdit={() => props.onEditTask(task.id)}/>)}{props.tasks.length > 6 && <button className="os-view-more" onClick={() => props.onNavigate("tasks")}>عرض كل المهام ({props.tasks.length})</button>}</div> : <Empty icon={<CheckCheck size={20}/>} title="لا توجد مهام مستحقة اليوم" detail="أضف خطوة صغيرة إلى قائمة اليوم." action="إضافة مهمة" onAction={props.onAddTask}/>}</section>
      <section className="os-panel os-panel--overdue"><div className="os-overdue-head"><span><Clock3 size={16}/></span><div><h2>عناصر تحتاج مراجعة</h2><small>أعد جدولتها أو أنهها حين تكون مستعدًا.</small></div><b>{props.overdueTasks.length + props.overdueContent.length}</b></div>{props.overdueTasks.length || props.overdueContent.length ? <div className="os-task-list">{props.overdueTasks.slice(0, 3).map((task) => <TaskRow key={task.id} item={task} onToggle={() => props.onToggleTask(task)} onEdit={() => props.onEditTask(task.id)}/>)}{props.overdueContent.slice(0, 3).map((item) => <ContentCard key={item.id} item={item} onEdit={() => props.onEditContent(item.id)} onPublish={() => props.onPublish(item.id)} compact/>)}</div> : <p className="os-calm-message">كل شيء في وقته. واصل بإيقاعك.</p>}</section>
      <section className="os-panel"><SectionTitle title="تذكيرات قريبة" action="عرض التذكيرات" onAction={() => props.onNavigate("reminders")}/>{props.reminders.length ? <div className="os-reminder-list">{props.reminders.map((reminder) => <div className="os-reminder-row" key={reminder.id}><span><Bell size={15}/></span><div><b>{reminder.title}</b><small>{reminder.date === props.today ? "اليوم" : fmtDate(reminder.date)}{reminder.time ? ` · ${reminder.time}` : ""}</small></div><button aria-label="إنهاء التذكير" onClick={() => props.onRemindDone(reminder.id)}><Check size={15}/></button></div>)}</div> : <Empty icon={<Bell size={20}/>} title="لا توجد تذكيرات قريبة" detail="أضف تذكيرًا حتى تبقى خطوتك القادمة في بالك." action="إضافة تذكير" onAction={props.onAddReminder}/>}</section>
    </div>
  </>;
}

function StrategyPage({ goals, tasks, content, onAdd, onEdit, onNavigate }: { goals: GoalItem[]; tasks: Task[]; content: Content[]; onAdd: () => void; onEdit: (id: string) => void; onNavigate: (page: Page) => void }) {
  return <><PageHeading title="أهدافك ترسم الاتجاه" description="محاور بسيطة تساعدك على ربط المحتوى اليومي بصورة Speakozy الأكبر." action={<Button icon={<Plus size={17}/>} onClick={onAdd}>إضافة هدف</Button>}/><div className="os-strategy-intro"><Target size={20}/><p>المهم ليس أن تفعل كل شيء دفعة واحدة، بل أن تعرف إلى أين تتجه خطوتك التالية.</p></div><div className="os-goals-grid">{goals.map((goal, index) => { const linkedTasks = tasks.filter((x) => x.goalId === goal.id); const linkedContent = content.filter((x) => x.goalId === goal.id && x.status !== "archived"); const completed = linkedTasks.filter((x) => x.status === "completed").length; return <article className="os-goal-card" key={goal.id}><div className="os-goal-card-top"><span className={`os-goal-icon os-goal-icon--${index % 5}`}><Goal size={19}/></span><button className="os-dots" aria-label="تعديل الهدف" onClick={() => onEdit(goal.id)}><MoreHorizontal size={18}/></button></div><span className="os-goal-number">المحور {String(index + 1).padStart(2, "0")}</span><h2>{goal.title}</h2><p>{goal.description}</p><div className="os-goal-objective"><small>الهدف الرئيسي</small><span>{goal.objective || "أضف نتيجة ملموسة تسعى إليها."}</span></div><div className="os-goal-metrics"><button onClick={() => onNavigate("tasks")}><ListTodo size={15}/><b>{linkedTasks.length}</b> مهام <small>{completed}/{linkedTasks.length} منجزة</small></button><button onClick={() => onNavigate("studio")}><FileText size={15}/><b>{linkedContent.length}</b> محتوى</button></div>{goal.targetDate && <div className="os-goal-date"><CalendarDays size={14}/> الموعد المستهدف · {fmtDate(goal.targetDate, { day: "numeric", month: "short", year: "numeric" })}</div>}<button className="os-goal-edit" onClick={() => onEdit(goal.id)}>عرض وتعديل التفاصيل <ArrowLeft size={15}/></button></article>; })}</div></>;
}

function StudioPage({ content, goals, platforms, formats, categories, filter, setFilter, onAdd, onIdea, onEdit, onDuplicate, onCopy, onArchive, onStatus }: { content: Content[]; goals: GoalItem[]; platforms: string[]; formats: string[]; categories: string[]; filter: string; setFilter: (value: string) => void; onAdd: () => void; onIdea: () => void; onEdit: (id: string) => void; onDuplicate: (item: Content) => void; onCopy: (text: string) => void; onArchive: (id: string) => void; onStatus: (id: string, status: ContentStatus) => void }) {
  const [tab, setTab] = useState<"all" | "ideas">("all");
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all"); const [formatFilter, setFormatFilter] = useState("all"); const [categoryFilter, setCategoryFilter] = useState("all"); const [dateFilter, setDateFilter] = useState("");
  const visible = content.filter((item) => (filter === "archived" ? item.status === "archived" : item.status !== "archived") && (tab === "ideas" ? item.status === "idea" : item.status !== "idea") && (filter === "all" || item.status === filter) && (platformFilter === "all" || item.platform === platformFilter) && (formatFilter === "all" || item.format === formatFilter) && (categoryFilter === "all" || item.category === categoryFilter) && (!dateFilter || item.date.startsWith(dateFilter)) && `${item.title} ${item.text} ${item.platform} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeading title="استوديو المحتوى" description="من فكرة عابرة إلى محتوى جاهز للنشر، في مساحة واحدة." action={<><Button secondary icon={<Lightbulb size={17}/>} onClick={onIdea}>أضف فكرة</Button><Button icon={<Plus size={17}/>} onClick={onAdd}>محتوى جديد</Button></>}/><div className="os-toolbar"><div className="os-tabs"><button className={tab === "all" ? "is-selected" : ""} onClick={() => setTab("all")}>كل المحتوى <span>{content.filter((x) => x.status !== "archived" && x.status !== "idea").length}</span></button><button className={tab === "ideas" ? "is-selected" : ""} onClick={() => setTab("ideas")}>بنك الأفكار <span>{content.filter((x) => x.status === "idea").length}</span></button></div><div className="os-filter-row"><div className="os-mini-search"><Search size={15}/><input placeholder="ابحث عن محتوى…" value={search} onChange={(e) => setSearch(e.target.value)}/></div><input type="month" aria-label="فلترة حسب شهر النشر" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}/><select aria-label="فلترة حسب المنصة" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}><option value="all">كل المنصات</option>{platforms.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="فلترة حسب الصيغة" value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}><option value="all">كل الصيغ</option>{formats.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="فلترة حسب التصنيف" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="all">كل التصنيفات</option>{categories.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="فلترة حسب الحالة" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">كل الحالات</option>{STATUSES.map((status) => <option key={status} value={status}>{STATUS[status]}</option>)}</select></div></div>{visible.length ? <div className="os-library-grid">{visible.map((item) => <article className="os-library-card" key={item.id}><div className="os-library-card__top"><PlatformMark platform={item.platform}/><StatusPill status={item.status}/><button className="os-dots" aria-label="تعديل المحتوى" onClick={() => onEdit(item.id)}><MoreHorizontal size={18}/></button></div><button className="os-library-title" onClick={() => onEdit(item.id)}>{item.title || "محتوى بلا عنوان"}</button>{item.text && <p>{item.text}</p>}<div className="os-library-tags"><span>{item.format}</span><span>{item.category}</span></div><div className="os-library-meta">{item.date ? <span><CalendarDays size={13}/>{fmtDate(item.date, { day: "numeric", month: "short" })} {item.time && `· ${item.time}`}</span> : <span><Lightbulb size={13}/>دون موعد نشر</span>}{goals.find((x) => x.id === item.goalId) && <span>{goals.find((x) => x.id === item.goalId)?.title}</span>}</div><div className="os-library-actions"><button onClick={() => onCopy(item.text)}><Copy size={14}/> نسخ النص</button><button onClick={() => onDuplicate(item)}><FileText size={14}/> تكرار</button><select aria-label="تغيير الحالة" value={item.status} onChange={(e) => onStatus(item.id, e.target.value as ContentStatus)}>{STATUSES.map((x) => <option key={x} value={x}>{STATUS[x]}</option>)}</select><button title="أرشفة" onClick={() => onArchive(item.id)}><ArrowDownToLine size={14}/></button></div></article>)}</div> : <Empty title={tab === "ideas" ? "أفكارك تبدأ من هنا" : "مساحة جاهزة لأول محتوى"} detail={tab === "ideas" ? "التقط الفكرة الآن، ثم حوّلها إلى مسودة حين تكون مستعدًا." : "أنشئ محتوى جديدًا، احفظ مسودة، أو أضف فكرة للنشر لاحقًا."} action={tab === "ideas" ? "حفظ فكرة" : "إنشاء محتوى"} onAction={tab === "ideas" ? onIdea : onAdd} icon={tab === "ideas" ? <Lightbulb size={20}/> : <FileText size={20}/>}/>}</>;
}

function CalendarPage({ content, platforms, selectedDate, setSelectedDate, monthCursor, setMonthCursor, view, setView, onAdd, onEdit }: { content: Content[]; platforms: string[]; selectedDate: string; setSelectedDate: (value: string) => void; monthCursor: Date; setMonthCursor: (value: Date) => void; view: "month" | "week" | "day"; setView: (value: "month" | "week" | "day") => void; onAdd: (date: string) => void; onEdit: (id: string) => void }) {
  const [platformFilter, setPlatformFilter] = useState("all"); const [statusFilter, setStatusFilter] = useState("all");
  const visibleContent = content.filter((item) => item.status !== "archived" && (platformFilter === "all" || item.platform === platformFilter) && (statusFilter === "all" || item.status === statusFilter));
  const year = monthCursor.getFullYear(); const month = monthCursor.getMonth();
  const monthStart = new Date(Date.UTC(year, month, 1)); const offset = (monthStart.getUTCDay() + 6) % 7; const daysCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeek = dateFromIso(selectedDate); startWeek.setUTCDate(startWeek.getUTCDate() - ((startWeek.getUTCDay() + 6) % 7));
  const days = view === "day" ? [selectedDate] : view === "week" ? Array.from({ length: 7 }, (_, i) => { const d = new Date(startWeek); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }) : Array.from({ length: daysCount }, (_, i) => new Date(Date.UTC(year, month, i + 1)).toISOString().slice(0, 10));
  const displayedItems = visibleContent.filter((x) => x.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  const moveCursor = (direction: number) => { const next = new Date(monthCursor); next.setMonth(next.getMonth() + direction); setMonthCursor(next); };
  return <><PageHeading title="تقويم المحتوى" description="شاهد إيقاع النشر، واختر يومًا لتخطط له." action={<Button icon={<Plus size={17}/>} onClick={() => onAdd(selectedDate)}>جدولة محتوى</Button>}/><section className="os-calendar-panel"><div className="os-calendar-head"><div className="os-calendar-month"><button className="os-icon-btn os-light-icon" title="الشهر السابق" onClick={() => moveCursor(-1)}><ArrowRight size={17}/></button><h2>{new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(new Date(year, month, 1))}</h2><button className="os-icon-btn os-light-icon" title="الشهر التالي" onClick={() => moveCursor(1)}><ArrowLeft size={17}/></button><button className="os-today-btn" onClick={() => { const current = new Date(); setMonthCursor(current); setSelectedDate(isoToday()); }}>اليوم</button></div><div className="os-tabs os-calendar-tabs">{([ ["month", "شهري"], ["week", "أسبوعي"], ["day", "يومي"] ] as const).map(([id, label]) => <button key={id} className={view === id ? "is-selected" : ""} onClick={() => setView(id)}>{label}</button>)}</div></div><div className="os-calendar-controls"><select aria-label="فلترة التقويم حسب المنصة" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}><option value="all">كل المنصات</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="فلترة التقويم حسب الحالة" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">كل الحالات</option>{STATUSES.map((item) => <option key={item} value={item}>{STATUS[item]}</option>)}</select></div><div className={joinClass("os-calendar-grid", view !== "month" && "os-calendar-grid--range", view === "day" && "os-calendar-grid--single")}><div className="os-calendar-weekdays">{["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"].map((x) => <span key={x}>{x}</span>)}</div>{view === "month" && Array.from({ length: offset }, (_, i) => <div className="os-calendar-cell os-calendar-cell--blank" key={`blank-${i}`}/>)}{days.map((date) => { const items = visibleContent.filter((x) => x.date === date); const isToday = date === isoToday(); return <button className={joinClass("os-calendar-cell", selectedDate === date && "is-picked", isToday && "is-today")} key={date} onClick={() => setSelectedDate(date)} onDoubleClick={() => onAdd(date)}><span className="os-cell-date">{dateFromIso(date).getUTCDate()}</span>{items.slice(0, 2).map((item) => <span className={`os-calendar-event os-event--${item.status}`} key={item.id} onClick={(e) => { e.stopPropagation(); onEdit(item.id); }}><PlatformMark platform={item.platform}/><span>{item.title || item.platform}</span></span>)}{items.length > 2 && <small className="os-more-count">+{items.length - 2} أخرى</small>}{view !== "month" && items.length === 0 && <small className="os-empty-day">لا يوجد محتوى</small>}</button>; })}</div><div className="os-calendar-legend"><span><i className="os-legend-dot os-legend-dot--scheduled"/>مجدول</span><span><i className="os-legend-dot os-legend-dot--published"/>منشور</span><span><i className="os-legend-dot os-legend-dot--draft"/>مسودة</span><button onClick={() => onAdd(selectedDate)}><Plus size={14}/> إضافة في {fmtDate(selectedDate, { day: "numeric", month: "short" })}</button></div></section><section className="os-panel os-day-list"><SectionTitle title={`خطة ${fmtDate(selectedDate, { weekday: "long", day: "numeric", month: "long" })}`}/>{displayedItems.length ? <div className="os-card-list">{displayedItems.map((item) => <ContentCard key={item.id} item={item} onEdit={() => onEdit(item.id)}/>)}</div> : <Empty title="لا توجد منشورات في هذا اليوم" detail="يمكنك استخدام هذا اليوم للنشر أو إبقاؤه مساحة للتجهيز." action="جدولة محتوى" onAction={() => onAdd(selectedDate)} icon={<CalendarDays size={20}/>}/>}</section></>;
}

function TasksPage({ tasks, view, setView, today, onAdd, onEdit, onToggle, onRemove }: { tasks: Task[]; view: string; setView: (value: string) => void; today: string; onAdd: () => void; onEdit: (id: string) => void; onToggle: (task: Task) => void; onRemove: (id: string) => void }) {
  const views = [{ id: "today", label: "اليوم" }, { id: "upcoming", label: "القادمة" }, { id: "overdue", label: "المتأخرة" }, { id: "completed", label: "المنجزة" }, { id: "all", label: "كل المهام" }];
  const filtered = tasks.filter((item) => view === "today" ? item.dueDate === today && item.status !== "completed" : view === "upcoming" ? item.dueDate > today && item.status !== "completed" : view === "overdue" ? item.dueDate < today && item.status !== "completed" : view === "completed" ? item.status === "completed" : true).sort((a, b) => `${a.dueDate}${a.dueTime}`.localeCompare(`${b.dueDate}${b.dueTime}`));
  return <><PageHeading title="إدارة المهام" description="رتّب خطواتك حسب الوقت والأولوية، وتابع ما أنجزته." action={<Button icon={<Plus size={17}/>} onClick={onAdd}>مهمة جديدة</Button>}/><div className="os-task-overview"><div><span>المهام المفتوحة</span><b>{tasks.filter((x) => x.status !== "completed").length}</b></div><div><span>مهام اليوم</span><b>{tasks.filter((x) => x.dueDate === today && x.status !== "completed").length}</b></div><div><span>المهام المنجزة</span><b>{tasks.filter((x) => x.status === "completed").length}</b></div><div><span>مهام متكررة</span><b>{tasks.filter((x) => x.recurrence !== "none").length}</b></div></div><section className="os-panel os-task-board"><div className="os-toolbar"><div className="os-tabs">{views.map((item) => <button key={item.id} className={view === item.id ? "is-selected" : ""} onClick={() => setView(item.id)}>{item.label}<span>{tasks.filter((x) => item.id === "all" || item.id === "today" ? (item.id === "all" || x.dueDate === today) : item.id === "upcoming" ? x.dueDate > today : item.id === "overdue" ? x.dueDate < today && x.status !== "completed" : x.status === "completed").length}</span></button>)}</div><select aria-label="ترتيب المهام" onChange={(e) => setView(e.target.value)} value={view}><option value="today">عرض المهام</option>{views.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>{filtered.length ? <div className="os-task-table">{filtered.map((task) => <div className="os-task-line" key={task.id}><TaskRow item={task} onToggle={() => onToggle(task)} onEdit={() => onEdit(task.id)}/><div className="os-task-detail"><span>{task.category}</span>{task.recurrence !== "none" && <span>يتكرر {task.recurrence === "daily" ? "يوميًا" : task.recurrence === "weekly" ? "أسبوعيًا" : "شهريًا"}</span>}{task.dueDate && <span>{fmtDate(task.dueDate, { day: "numeric", month: "short", year: "numeric" })}</span>}<button className="os-link-button" onClick={() => onRemove(task.id)}>حذف</button></div></div>)}</div> : <Empty title={view === "today" ? "لا مهام لليوم" : "لا توجد مهام في هذا العرض"} detail="أضف مهمة واحدة تساعدك على التقدم." action="إضافة مهمة" onAction={onAdd} icon={<ListTodo size={20}/>}/>}</section></>;
}

function RemindersPage({ reminders, today, onAdd, onEdit, onToggle, onRemove }: { reminders: Reminder[]; today: string; onAdd: () => void; onEdit: (id: string) => void; onToggle: (id: string) => void; onRemove: (id: string) => void }) {
  const upcoming = reminders.filter((x) => !x.done).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)); const completed = reminders.filter((x) => x.done);
  return <><PageHeading title="تذكيراتك في وقتها" description="مواعيد النشر والتخطيط والخطوات التي تريد العودة إليها." action={<Button icon={<Plus size={17}/>} onClick={onAdd}>تذكير جديد</Button>}/><div className="os-reminder-note"><Bell size={18}/><div><b>تذكيرات داخل الموقع</b><p>عند حلول الموعد، يظهر التذكير في جرس الإشعارات أعلى الصفحة أثناء استخدام الموقع.</p></div></div><div className="os-reminder-layout"><section className="os-panel"><SectionTitle title="المواعيد القادمة"/>{upcoming.length ? <div className="os-reminders-board">{upcoming.map((item) => <article className="os-reminder-card" key={item.id}><button className="os-check-btn" onClick={() => onToggle(item.id)}><Circle size={17}/></button><div className="os-reminder-date"><b>{fmtDate(item.date, { day: "numeric" })}</b><small>{fmtDate(item.date, { month: "short" })}</small></div><div className="os-reminder-copy"><b>{item.title}</b><p>{item.description || ""}</p><span>{item.date === today ? "اليوم" : item.date < today ? "متأخر" : fmtDate(item.date, { weekday: "long" })}{item.time ? ` · ${item.time}` : ""}{item.recurrence !== "none" ? ` · ${item.recurrence === "daily" ? "يتكرر يوميًا" : item.recurrence === "weekly" ? "يتكرر أسبوعيًا" : "يتكرر شهريًا"}` : ""}</span></div><button className="os-dots" aria-label="تعديل التذكير" onClick={() => onEdit(item.id)}><MoreHorizontal size={18}/></button><button className="os-link-button" onClick={() => onRemove(item.id)}>حذف</button></article>)}</div> : <Empty title="لا مواعيد قريبة" detail="أضف تذكيرًا لموعد تخطيط أو نشر أو لأي خطوة تريد تذكرها." action="إضافة تذكير" onAction={onAdd} icon={<Bell size={20}/>}/>}</section><section className="os-panel os-reminder-summary"><span className="os-summary-icon"><Clock3 size={21}/></span><small>تذكيرات نشطة</small><b>{upcoming.length}</b><p>ستظهر المواعيد هنا حسب تاريخها.</p>{completed.length > 0 && <div className="os-completed-reminders"><CheckCheck size={15}/>{completed.length} تذكيرات مكتملة</div>}</section></div></>;
}

function PlanningPage({ data, today, onSaveWeekPriority, onSaveMonth, onAddContent, onAddTask, onNavigateCalendar }: { data: Workspace; today: string; onSaveWeekPriority: (value: string) => void; onSaveMonth: (value: { priority: string; theme: string; dates: string }) => void; onAddContent: (date: string) => void; onAddTask: () => void; onNavigateCalendar: () => void }) {
  const start = dateFromIso(getWeekStart(today, Number(data.settings.weeklyDay))); const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const monthKey = today.slice(0, 7);
  const [objective, setObjective] = useState(data.weekPriorities[week[0]] ?? "");
  const [monthPlan, setMonthPlan] = useState(data.monthlyPlans[monthKey] ?? { priority: "", theme: "", dates: "" });
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  useEffect(() => setObjective(data.weekPriorities[week[0]] ?? ""), [week[0], data.weekPriorities]);
  useEffect(() => setMonthPlan(data.monthlyPlans[monthKey] ?? { priority: "", theme: "", dates: "" }), [monthKey, data.monthlyPlans]);
  const updateMonth = (key: "priority" | "theme" | "dates", value: string) => setMonthPlan((current) => ({ ...current, [key]: value }));
  const saveMonth = () => onSaveMonth(monthPlan);
  const items = ["اختيار الهدف الأهم للأسبوع", "انتقاء أفكار المحتوى", "توزيع المحتوى على أيام النشر", "إضافة المهام المرتبطة", "مراجعة المهام المتكررة", "تأكيد الخطة الأسبوعية"];
  return <>
    <PageHeading title="خطّط لأسبوعك بهدوء" description="وزّع الأفكار على أيام الأسبوع واترك مساحة لما يستجد." action={<Button secondary icon={<CalendarDays size={17}/>} onClick={onNavigateCalendar}>فتح التقويم</Button>}/>
    <section className="os-week-objective"><span><Target size={20}/></span><div><small>الهدف الأهم لهذا الأسبوع</small><input placeholder="ما النتيجة التي ستسعدك بنهاية الأسبوع؟" value={objective} onChange={(e) => setObjective(e.target.value)} onBlur={() => onSaveWeekPriority(objective)}/></div><span className="os-week-label">{fmtDate(week[0], { day: "numeric", month: "short" })} — {fmtDate(week[6], { day: "numeric", month: "short" })}</span></section>
    <section className="os-panel os-week-panel"><SectionTitle title="خطة النشر الأسبوعية"/><div className="os-week-grid">{week.map((date, index) => { const itemsToday = data.content.filter((x) => x.date === date && x.status !== "archived"); return <div className={joinClass("os-week-day", date === today && "is-today")} key={date}><div className="os-week-day-head"><b>{["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"][index]}</b><span>{dateFromIso(date).getUTCDate()}</span></div>{itemsToday.map((item) => <div className={`os-week-content os-event--${item.status}`} key={item.id}><PlatformMark platform={item.platform}/><span>{item.title}</span></div>)}<button className="os-week-add" onClick={() => onAddContent(date)}><Plus size={14}/> محتوى</button></div>; })}</div></section>
    <div className="os-planning-grid"><section className="os-panel"><SectionTitle title="قائمة تأكيد الخطة"/><p className="os-planning-description">خطوات قصيرة تجعل بدء الأسبوع أسهل.</p><div className="os-planning-checklist">{items.map((item, index) => <label key={item}><input type="checkbox" checked={!!checked[index]} onChange={(e) => setChecked({ ...checked, [index]: e.target.checked })}/><span className="os-custom-checkbox">{checked[index] && <Check size={13}/>}</span><span className={checked[index] ? "is-done" : ""}>{item}</span></label>)}</div><Button secondary icon={<Plus size={16}/>} onClick={onAddTask}>إضافة مهمة للأسبوع</Button></section>
      <section className="os-panel os-month-card"><span className="os-goal-icon os-goal-icon--2"><CalendarDays size={19}/></span><h2>أولويات هذا الشهر</h2><label className="os-month-field"><small>الأولوية</small><input placeholder="أهم نتيجة هذا الشهر" value={monthPlan.priority} onChange={(e) => updateMonth("priority", e.target.value)} onBlur={saveMonth}/></label><label className="os-month-field"><small>موضوع المحتوى</small><input placeholder="موضوع أو محور الشهر" value={monthPlan.theme} onChange={(e) => updateMonth("theme", e.target.value)} onBlur={saveMonth}/></label><label className="os-month-field"><small>تواريخ أو حملات مهمة</small><input placeholder="أضف أيامًا أو حملات" value={monthPlan.dates} onChange={(e) => updateMonth("dates", e.target.value)} onBlur={saveMonth}/></label><div className="os-month-total"><b>{data.content.filter((x) => x.status === "published").length}</b><span>محتوى منشور<br/>من إجمالي {data.content.length}</span></div></section>
    </div>
  </>;
}

function SettingsPage({ data, user, onPatch, onExport }: { data: Workspace; user: AppUser; onPatch: (value: Partial<Workspace["settings"]>) => void; onExport: () => void }) {
  return <>
    <PageHeading title="إعدادات مساحتك" description="اضبط تفضيلاتك واحتفظ بنسخة من خطتك."/>
    <div className="os-settings-grid">
      <section className="os-panel os-settings-panel"><SectionTitle title="الملف الشخصي"/><div className="os-profile-row"><span className="os-avatar os-avatar--profile">{(user.displayName || user.email || "S").slice(0, 1).toUpperCase()}</span><div><b>{user.displayName || "حساب Speakozy"}</b><small>{user.email}</small></div></div><div className="os-settings-divider"/><label className="os-setting-field"><span><b>المنطقة الزمنية</b><small>تُستخدم في مواعيد النشر والمهام والتذكيرات.</small></span><select value={data.settings.timezone} onChange={(e) => onPatch({ timezone: e.target.value })}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label className="os-setting-field"><span><b>بداية الأسبوع</b><small>تنظيم الخطة الأسبوعية.</small></span><select value={data.settings.weeklyDay} onChange={(e) => onPatch({ weeklyDay: e.target.value })}><option value="0">الأحد</option><option value="1">الإثنين</option></select></label></section>
      <section className="os-panel os-settings-panel os-settings-data"><SectionTitle title="بياناتك"/><p>{user.offline ? "تُحفظ البيانات في المتصفح الحالي فقط؛ أضف إعداد Firebase لمزامنتها بين الأجهزة." : "مساحة العمل مرتبطة بحسابك وتُحفظ في قاعدة البيانات. احتفظ بنسخة قابلة للتنزيل وقتما تحتاج."}</p><Button secondary icon={<ArrowDownToLine size={17}/>} onClick={onExport}>تنزيل نسخة JSON</Button><div className="os-data-foot"><CheckCheck size={15}/>{user.offline ? "هذه نسخة محلية على هذا الجهاز." : "آخر تغييراتك تُزامن تلقائيًا عند توفر الاتصال."}</div></section>
    </div>
  </>;
}
function ContentTaxonomySettings({ settings, onPatch }: { settings: Workspace["settings"]; onPatch: (value: Partial<Workspace["settings"]>) => void }) {
  return <section className="os-panel os-taxonomy-panel"><SectionTitle title="منصات المحتوى وتصنيفاته"/><p className="os-taxonomy-description">أضف الخيارات التي تستخدمها في المحتوى، وستظهر مباشرة في نموذج الإضافة.</p><div className="os-taxonomy-grid"><TaxonomySetting title="المنصات" items={settings.contentPlatforms} onChange={(items) => onPatch({ contentPlatforms: items })}/><TaxonomySetting title="صيغ المحتوى" items={settings.contentFormats} onChange={(items) => onPatch({ contentFormats: items })}/><TaxonomySetting title="تصنيفات المحتوى" items={settings.contentCategories} onChange={(items) => onPatch({ contentCategories: items })}/></div></section>;
}
function TaxonomySetting({ title, items, onChange }: { title: string; items: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (event: FormEvent) => { event.preventDefault(); const value = draft.trim(); if (value && !items.includes(value)) onChange([...items, value]); setDraft(""); };
  return <div className="os-taxonomy-setting"><b>{title}</b><form onSubmit={add}><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`أضف ${title}`} /><button type="submit" aria-label={`إضافة إلى ${title}`}><Plus size={15}/></button></form><div className="os-taxonomy-tags">{items.map((item) => <span key={item}>{item}<button aria-label={`إزالة ${item}`} onClick={() => onChange(items.filter((x) => x !== item))}><X size={12}/></button></span>)}</div></div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose]); return <div className="os-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="os-modal" role="dialog" aria-modal="true" aria-label={title}><header><div><span className="os-eyebrow">مساحة Speakozy</span><h2>{title}</h2></div><button className="os-icon-btn os-light-icon" aria-label="إغلاق" onClick={onClose}><X size={19}/></button></header>{children}</section></div>; }

function Editor({ modal, data, defaultDate, onSaveContent, onSaveTask, onSaveReminder, onSaveGoal, onClose }: { modal: NonNullable<ModalState>; data: Workspace; defaultDate: string; onSaveContent: (value: Omit<Content, "id" | "createdAt">, id?: string) => void; onSaveTask: (value: Omit<Task, "id" | "status" | "seriesId">, id?: string) => void; onSaveReminder: (value: Omit<Reminder, "id" | "done" | "seriesId">, id?: string) => void; onSaveGoal: (value: Omit<GoalItem, "id">, id?: string) => void; onClose: () => void }) {
  if (modal.kind === "content" || modal.kind === "idea") return <ContentForm key={`${modal.kind}-${modal.id || "new"}`} initial={data.content.find((x) => x.id === modal.id)} goals={data.goals} platforms={data.settings.contentPlatforms} formats={data.settings.contentFormats} categories={data.settings.contentCategories} defaultDate={defaultDate} idea={modal.kind === "idea"} onSave={(value) => onSaveContent(value, modal.id)} onClose={onClose}/>;
  if (modal.kind === "task") return <TaskForm key={modal.id || "new"} initial={data.tasks.find((x) => x.id === modal.id)} goals={data.goals} content={data.content} defaultDate={defaultDate} onSave={(value) => onSaveTask(value, modal.id)} onClose={onClose}/>;
  if (modal.kind === "reminder") return <ReminderForm key={modal.id || "new"} initial={data.reminders.find((x) => x.id === modal.id)} tasks={data.tasks} content={data.content} defaultDate={defaultDate} onSave={(value) => onSaveReminder(value, modal.id)} onClose={onClose}/>;
  return <GoalForm key={modal.id || "new"} initial={data.goals.find((x) => x.id === modal.id)} goals={data.goals} onSave={(value) => onSaveGoal(value, modal.id)} onClose={onClose}/>;
}

function ContentForm({ initial, goals, platforms, formats, categories, defaultDate, idea, onSave, onClose }: { initial?: Content; goals: GoalItem[]; platforms: string[]; formats: string[]; categories: string[]; defaultDate: string; idea: boolean; onSave: (value: Omit<Content, "id" | "createdAt">) => void; onClose: () => void }) {
  const [value, setValue] = useState<Omit<Content, "id" | "createdAt">>(() => ({ title: initial?.title ?? "", platform: initial?.platform ?? "Instagram", format: initial?.format ?? "منشور", category: initial?.category ?? CATEGORIES[0], text: initial?.text ?? "", mediaUrl: initial?.mediaUrl ?? "", goalId: initial?.goalId ?? "", date: idea ? "" : initial?.date ?? defaultDate, time: initial?.time ?? "10:00", priority: initial?.priority ?? "متوسطة", status: idea ? "idea" : initial?.status ?? "draft", notes: initial?.notes ?? "" }));
  const update = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  const submit = (e: FormEvent) => { e.preventDefault(); if (!value.title.trim()) return; onSave({ ...value, status: idea && !initial ? "idea" : value.status }); };
  return <form className="os-form" onSubmit={submit}><div className="os-form-grid"><label className="os-field os-field--wide"><span>عنوان المحتوى <i>*</i></span><input required autoFocus placeholder="مثال: ٣ طرق لحفظ كلمات جديدة" value={value.title} onChange={(e) => update("title", e.target.value)}/></label><label className="os-field"><span>المنصة</span><select value={value.platform} onChange={(e) => update("platform", e.target.value)}>{platforms.map((x) => <option key={x}>{x}</option>)}</select></label><label className="os-field"><span>صيغة المحتوى</span><select value={value.format} onChange={(e) => update("format", e.target.value)}>{formats.map((x) => <option key={x}>{x}</option>)}</select></label><label className="os-field"><span>تصنيف المحتوى</span><select value={value.category} onChange={(e) => update("category", e.target.value)}>{categories.map((x) => <option key={x}>{x}</option>)}</select></label><label className="os-field"><span>الحالة</span><select value={value.status} onChange={(e) => update("status", e.target.value)}>{STATUSES.filter((x) => x !== "archived").map((x) => <option key={x} value={x}>{STATUS[x]}</option>)}</select></label>{!idea && <><label className="os-field"><span>تاريخ النشر</span><input type="date" value={value.date} onChange={(e) => update("date", e.target.value)}/></label><label className="os-field"><span>وقت النشر</span><input type="time" value={value.time} onChange={(e) => update("time", e.target.value)}/></label></>}<label className="os-field"><span>الأولوية</span><select value={value.priority} onChange={(e) => update("priority", e.target.value)}><option>منخفضة</option><option>متوسطة</option><option>عالية</option></select></label><label className="os-field"><span>الهدف المرتبط</span><select value={value.goalId} onChange={(e) => update("goalId", e.target.value)}><option value="">دون هدف</option>{goals.map((x) => <option value={x.id} key={x.id}>{x.title}</option>)}</select></label><label className="os-field os-field--wide"><span>النص أو الوصف</span><textarea rows={4} placeholder="اكتب مسودة المنشور أو ملخص الفكرة…" value={value.text} onChange={(e) => update("text", e.target.value)}/></label><label className="os-field os-field--wide"><span>رابط صورة أو فيديو (اختياري)</span><input dir="ltr" placeholder="https://" value={value.mediaUrl} onChange={(e) => update("mediaUrl", e.target.value)}/></label><label className="os-field os-field--wide"><span>ملاحظات</span><textarea rows={2} placeholder="تفاصيل أو تذكيرات للفريق…" value={value.notes} onChange={(e) => update("notes", e.target.value)}/></label></div><footer><Button secondary onClick={onClose}>إلغاء</Button><Button type="submit" icon={<Check size={16}/>} >{idea ? "حفظ الفكرة" : initial ? "حفظ التعديلات" : "إضافة للمحتوى"}</Button></footer></form>;
}
function TaskForm({ initial, goals, content, defaultDate, onSave, onClose }: { initial?: Task; goals: GoalItem[]; content: Content[]; defaultDate: string; onSave: (value: Omit<Task, "id" | "status" | "seriesId">) => void; onClose: () => void }) {
  const [value, setValue] = useState<Omit<Task, "id" | "status" | "seriesId">>(() => ({ title: initial?.title ?? "", description: initial?.description ?? "", category: initial?.category ?? "مهمة لمرة واحدة", priority: initial?.priority ?? "متوسطة", dueDate: initial?.dueDate ?? defaultDate, dueTime: initial?.dueTime ?? "", recurrence: initial?.recurrence ?? "none", contentId: initial?.contentId ?? "", goalId: initial?.goalId ?? "", notes: initial?.notes ?? "" }));
  const update = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  return <form className="os-form" onSubmit={(e) => { e.preventDefault(); if (value.title.trim()) onSave(value); }}><div className="os-form-grid"><label className="os-field os-field--wide"><span>اسم المهمة <i>*</i></span><input required autoFocus placeholder="ما الخطوة التي تريد إنجازها؟" value={value.title} onChange={(e) => update("title", e.target.value)}/></label><label className="os-field"><span>التصنيف</span><select value={value.category} onChange={(e) => update("category", e.target.value)}>{TASK_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></label><label className="os-field"><span>الأولوية</span><select value={value.priority} onChange={(e) => update("priority", e.target.value)}><option>منخفضة</option><option>متوسطة</option><option>عالية</option></select></label><label className="os-field"><span>تاريخ الاستحقاق</span><input type="date" value={value.dueDate} onChange={(e) => update("dueDate", e.target.value)}/></label><label className="os-field"><span>الوقت</span><input type="time" value={value.dueTime} onChange={(e) => update("dueTime", e.target.value)}/></label><label className="os-field"><span>التكرار</span><select value={value.recurrence} onChange={(e) => update("recurrence", e.target.value)}><option value="none">بدون تكرار</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option><option value="monthly">شهريًا</option></select></label><label className="os-field"><span>المحتوى المرتبط</span><select value={value.contentId} onChange={(e) => update("contentId", e.target.value)}><option value="">دون محتوى</option>{content.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label className="os-field"><span>الهدف المرتبط</span><select value={value.goalId} onChange={(e) => update("goalId", e.target.value)}><option value="">دون هدف</option>{goals.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label className="os-field os-field--wide"><span>الوصف أو الملاحظات</span><textarea rows={3} value={value.description} onChange={(e) => update("description", e.target.value)}/></label></div>{value.recurrence !== "none" && <div className="os-form-hint"><CheckCheck size={15}/> عند إنجاز المهمة يتولد موعدها القادم تلقائيًا.</div>}<footer><Button secondary onClick={onClose}>إلغاء</Button><Button type="submit" icon={<Check size={16}/>} >{initial ? "حفظ التعديلات" : "حفظ المهمة"}</Button></footer></form>;
}
function ReminderForm({ initial, tasks, content, defaultDate, onSave, onClose }: { initial?: Reminder; tasks: Task[]; content: Content[]; defaultDate: string; onSave: (value: Omit<Reminder, "id" | "done" | "seriesId">) => void; onClose: () => void }) {
  const [value, setValue] = useState<Omit<Reminder, "id" | "done" | "seriesId">>(() => ({ title: initial?.title ?? "", description: initial?.description ?? "", date: initial?.date ?? defaultDate, time: initial?.time ?? "09:00", recurrence: initial?.recurrence ?? "none", taskId: initial?.taskId ?? "", contentId: initial?.contentId ?? "" }));
  const update = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  return <form className="os-form" onSubmit={(e) => { e.preventDefault(); if (value.title.trim()) onSave(value); }}><div className="os-form-grid"><label className="os-field os-field--wide"><span>عنوان التذكير <i>*</i></span><input required autoFocus placeholder="مثال: مراجعة خطة الأسبوع" value={value.title} onChange={(e) => update("title", e.target.value)}/></label><label className="os-field"><span>التاريخ</span><input type="date" value={value.date} onChange={(e) => update("date", e.target.value)}/></label><label className="os-field"><span>الوقت</span><input type="time" value={value.time} onChange={(e) => update("time", e.target.value)}/></label><label className="os-field"><span>التكرار</span><select value={value.recurrence} onChange={(e) => update("recurrence", e.target.value)}><option value="none">مرة واحدة</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option><option value="monthly">شهريًا</option></select></label><label className="os-field"><span>المهمة المرتبطة</span><select value={value.taskId} onChange={(e) => update("taskId", e.target.value)}><option value="">دون مهمة</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label className="os-field"><span>المحتوى المرتبط</span><select value={value.contentId} onChange={(e) => update("contentId", e.target.value)}><option value="">دون محتوى</option>{content.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label className="os-field os-field--wide"><span>تفاصيل إضافية</span><textarea rows={3} value={value.description} onChange={(e) => update("description", e.target.value)}/></label></div><div className="os-form-hint"><Bell size={15}/> ستظهر التذكيرات المستحقة في جرس الموقع أثناء استخدامه.</div><footer><Button secondary onClick={onClose}>إلغاء</Button><Button type="submit" icon={<Check size={16}/>} >حفظ التذكير</Button></footer></form>;
}
function GoalForm({ initial, goals, onSave, onClose }: { initial?: GoalItem; goals: GoalItem[]; onSave: (value: Omit<GoalItem, "id">) => void; onClose: () => void }) {
  const [value, setValue] = useState<Omit<GoalItem, "id">>(() => ({ title: initial?.title ?? "", description: initial?.description ?? "", objective: initial?.objective ?? "", notes: initial?.notes ?? "", targetDate: initial?.targetDate ?? "", parentId: initial?.parentId ?? "" }));
  const update = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  return <form className="os-form" onSubmit={(e) => { e.preventDefault(); if (value.title.trim()) onSave(value); }}><div className="os-form-grid"><label className="os-field os-field--wide"><span>اسم الهدف <i>*</i></span><input required autoFocus value={value.title} onChange={(e) => update("title", e.target.value)} placeholder="مثال: تعزيز حضور Speakozy"/></label><label className="os-field os-field--wide"><span>الوصف</span><textarea rows={3} value={value.description} onChange={(e) => update("description", e.target.value)}/></label><label className="os-field os-field--wide"><span>النتيجة الرئيسية</span><input value={value.objective} onChange={(e) => update("objective", e.target.value)} placeholder="كيف تعرف أنك اقتربت من هدفك؟"/></label><label className="os-field"><span>موعد مستهدف (اختياري)</span><input type="date" value={value.targetDate} onChange={(e) => update("targetDate", e.target.value)}/></label><label className="os-field"><span>هدف فرعي تابع لـ</span><select value={value.parentId} onChange={(e) => update("parentId", e.target.value)}><option value="">هدف رئيسي</option>{goals.filter((x) => x.id !== initial?.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label className="os-field os-field--wide"><span>ملاحظات</span><textarea rows={2} value={value.notes} onChange={(e) => update("notes", e.target.value)}/></label></div><footer><Button secondary onClick={onClose}>إلغاء</Button><Button type="submit" icon={<Check size={16}/>} >حفظ الهدف</Button></footer></form>;
}
