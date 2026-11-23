import { memo, type ElementType, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore, ArrowUp, BarChart3, Bell, BellRing, BookOpenCheck, CalendarDays, Check, ChevronDown,
  ClipboardCheck, Copy, DollarSign, FileDown, GraduationCap, LayoutDashboard, ListChecks,
  LockKeyhole, LogOut, Menu, MessageSquare, Plus, Redo2, Search, Settings, ShieldCheck, Trash2, Undo2, Users, UsersRound, X
} from "lucide-react";
import { useAcademy } from "./useAcademy";
import type { AcademyData, AcademyGroup, AppNotice, AttendanceStatus, Lead, Profile, RenewalReminderMilestone, Role, Session, Student, StudentDestinationTab, StudentKind, TeacherAccount, WorkScript, WorkScriptKind } from "../domain/types";
import { canAccessFinance, canAccessMarketingAnalytics, isMarketingRole } from "../domain/permissions";
import { activeAttendanceRecords, activeGroups, activeStudentsOf, archiveTeacher, attendanceFor, canAddStudentToGroup, canAssignTeacher, colourForGroup, copyStudentForGroup, currentStudentCounts, expenseForMonth, formerStudents, formatDate, formatTime, groupDays, groupLabel, groupTime, incomeForMonth, incomeStudentsByKindForMonth, incomeStudentsForMonth, isEnrolledStudent, isRoundActive, isStudentCodeQuery, isTeacherArchived, isTeacherDeleted, isTeacherNameArchived, isTerminalLead, leadBucket, leadCategory, leadFollowupDate, LEAD_FOLLOWUP_OPTIONS, LEVEL_COUNTS, LEVELS, live, matchesStudentCode, monthKey, nonArchivedGroups, normalise, parseIsoDate, privateGroupCanAccept, removeStudentAttendance, restoreTeacher, roundName, safeCopy, saveTeacherWeeklyHours, sortLeads, studentKind, studentKindLabel, studentSourceLabel, STUDENT_SOURCES, studentsInNonArchivedGroups, studentsInRound, studentsOf, teacherNames, toIsoDate, uid, uniquePhoneNumbers, WEEKDAYS } from "../domain/utils";
import { allTeacherScheduleConflicts, cancelSession, durationHours, ensureEightActiveSessions, feedbackSessionsDue, generateSessions, monthTeacherHours, plannedGroupEndDate, rescheduleGroupPreservingAttendance, rescheduleSession, restoreSession, scheduledSessionsOnDate, sessionsOf, teacherScheduleConflicts, teacherSessionsForMonth, weeklyScheduledHours } from "../domain/schedule";
import { isGroupOperationalToday } from "../domain/lifecycle";
import { retentionByMonth } from "../domain/retention";
import { dataQualityIssues } from "../domain/data-quality";
import { AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS, AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS, isAutomaticFollowupDue } from "../domain/followup";
import type { CloudBackup } from "../services/cloudRepository";

type Tab = "home" | "report" | "groups" | "private" | "next" | "leads" | "attendance" | "teachers" | "finance" | "retention" | "security" | "marketing" | "scripts";

interface TabDefinition { id: Tab; label: string; icon: ElementType; owner?: boolean; teacher?: boolean }
const TABS: TabDefinition[] = [
  { id: "home", label: "الرئيسية", icon: LayoutDashboard },
  { id: "report", label: "تقرير اليوم", icon: ClipboardCheck },
  { id: "groups", label: "المجموعات والراوندات", icon: UsersRound },
  { id: "private", label: "البرايفت", icon: LockKeyhole },
  { id: "scripts", label: "سكريبتات", icon: MessageSquare },
  { id: "next", label: "عملاء الراوند الجاي", icon: CalendarDays },
  { id: "leads", label: "الليدز", icon: UserRoundIcon },
  { id: "attendance", label: "الحضور والغياب", icon: ListChecks },
  { id: "teachers", label: "ساعات المدرسين", icon: CalendarDays },
  { id: "finance", label: "الإيرادات والمصروفات", icon: DollarSign, owner: true },
  { id: "retention", label: "الريتينشن", icon: BarChart3 },
  { id: "security", label: "الأمان والنسخ", icon: ShieldCheck },
  { id: "marketing", label: "إحصائيات التسويق", icon: BarChart3, owner: true }
];

function UserRoundIcon(props: React.ComponentProps<typeof Users>) { return <Users {...props} />; }

function Loading() {
  return <div className="loading"><div><div className="spinner" /><strong>جارٍ تجهيز نظام Speakozy…</strong><p>يتم تحميل الصلاحيات والبيانات بأمان.</p></div></div>;
}

function Login({ error, onLogin }: { error: string; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    await onLogin(email, password);
    setSubmitting(false);
  };
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title">
    <div className="auth-mark"><div className="auth-mark__badge"><BookOpenCheck size={23} /></div><div><strong>SPEAKOZY</strong><small>نظام إدارة الأكاديمية</small></div></div>
    <h1 id="login-title">أهلًا بعودتك</h1><p>سجّل الدخول للوصول إلى لوحة الأكاديمية حسب صلاحيات حسابك.</p>
    <form className="form-stack" onSubmit={submit}>
      <div className="field"><label htmlFor="email">البريد الإلكتروني</label><input id="email" dir="ltr" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <div className="field"><label htmlFor="password">كلمة المرور</label><input id="password" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn" type="submit" disabled={submitting}>{submitting ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</button>
    </form>
    <p className="auth-note">صلاحياتك تظهر تلقائيًا وفق حساب Firebase؛ لا يوجد اختيار دور يدوي داخل النظام.</p>
  </section></main>;
}

function visibleTabs(role: Role): TabDefinition[] {
  if (role === "teacher") return TABS.filter((tab) => tab.id === "groups" || tab.id === "attendance" || tab.id === "teachers").map((tab) => tab.id === "groups" ? { ...tab, label: "جروباتي" } : tab);
  if (isMarketingRole(role)) return TABS.filter((tab) => tab.id === "marketing");
  return TABS.filter((tab) => !tab.owner || role === "owner");
}

function roleLabel(role: Role) { return role === "owner" ? "Owner" : role === "admin" ? "Admin" : isMarketingRole(role) ? "Marketing" : "Teacher"; }

function visibleLevel(value?: string) {
  const level = String(value ?? "").trim();
  return ["private", "pv", "0"].includes(normalise(level)) ? "" : level;
}

function sessionCountAr(count: number) {
  if (count === 1) return "جلسة واحدة";
  if (count === 2) return "جلستين";
  if (count >= 3 && count <= 10) return `${count} جلسات`;
  return `${count} جلسة`;
}

function privateStudentLabel(group: AcademyGroup, data: AcademyData) {
  const student = activeStudentsOf(data, group.id)[0] ?? studentsOf(data, group.id)[0];
  return [student?.n || group.lv, visibleLevel(student?.lv), student?.ph].filter(Boolean).join(" · ");
}

function teacherDisplayName(data: AcademyData, name?: string) {
  if (!String(name ?? "").trim()) return "بدون مدرس";
  if (data.teacherHours.some((item) => normalise(item.name) === normalise(name) && isTeacherDeleted(item))) return "مدرس محذوف";
  return isTeacherNameArchived(data, name) ? "مدرس مؤرشف" : name;
}

function displayGroupLabel(group: AcademyGroup, data: AcademyData) {
  return groupLabel({ ...group, tc: teacherDisplayName(data, group.tc) });
}

function StudentNameWithNote({ name, note }: { name: string; note?: string }) {
  const value = String(note ?? "").trim();
  return <strong><span>{name}</span>{value && <small className="student-card__note" title={`ملاحظة: ${value}`}>ملاحظة: {value}</small>}</strong>;
}

function addIsoDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function followupTouchTime(item: { fu?: number; lu?: number; followupDoneAt?: number; ts?: number; formerAt?: number; fh?: unknown[] }): number {
  const historyTimes = (Array.isArray(item.fh) ? item.fh : []).map((entry) => {
    if (!entry || typeof entry !== "object") return 0;
    const row = entry as Record<string, unknown>;
    return Number(row.t ?? row.at ?? 0);
  });
  return Math.max(Number(item.fu ?? 0), Number(item.lu ?? 0), Number(item.followupDoneAt ?? 0), Number(item.ts ?? 0), Number(item.formerAt ?? 0), ...historyTimes);
}

function followupDueEverySevenDays(item: { fu?: number; lu?: number; followupDoneAt?: number; ts?: number; formerAt?: number; fh?: unknown[] }, dueDate: string, now: Date, today: string): boolean {
  return isAutomaticFollowupDue(followupTouchTime(item), dueDate, now.getTime(), today, AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS);
}

function followupDueEveryFourteenDays(item: { fu?: number; lu?: number; followupDoneAt?: number; ts?: number; formerAt?: number; fh?: unknown[] }, dueDate: string, now: Date, today: string): boolean {
  return isAutomaticFollowupDue(followupTouchTime(item), dueDate, now.getTime(), today, AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS);
}

function matchingLevel(value: unknown): string {
  return normalise(value).replace(/[\s._-]/g, "");
}

function deriveNotices(data: AcademyData, role: Role, teacherName?: string): AppNotice[] {
  const teacherKey = normalise(teacherName ?? "");
  if (role === "teacher" && (!teacherKey || isTeacherNameArchived(data, teacherName))) return [];
  const now = new Date();
  const today = toIsoDate(now);
  const recent = (item: { fu?: number; lu?: number; followupDoneAt?: number; ts?: number; formerAt?: number; fh?: unknown[] }, cooldown = AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS) => {
    const stamp = followupTouchTime(item);
    return stamp > 0 && now.getTime() - stamp < cooldown;
  };
  const withinWeek = new Date(now); withinWeek.setDate(now.getDate() + 7);
  const groupVisibleToRole = (group: AcademyGroup) =>
    !isTeacherNameArchived(data, group.tc) && (role !== "teacher" || normalise(group.tc) === teacherKey);
  const active = activeGroups(data).filter(groupVisibleToRole);
  const groupMap = new Map(nonArchivedGroups(data).filter(groupVisibleToRole).map((group) => [group.id, group]));
  const notices: AppNotice[] = [];
  const renewalReminderProfiles = new Set<string>();
  active.forEach((group) => {
    const endDate = plannedGroupEndDate(group);
    if (!group.p && endDate && !recent(group)) {
      const end = new Date(`${endDate}T00:00:00`);
      const followupDate = String(group.fd ?? "");
      if ((!followupDate || followupDate <= today) && end >= new Date(now.toDateString()) && end <= withinWeek) {
        notices.push({ id: `round-${group.id}`, kind: "round", title: "الراوند قربت تخلص", description: `${groupLabel(group)} · ينتهي ${formatDate(endDate)}`, groupId: group.id });
      }
    }
  });
  if (role !== "teacher") {
    const visibleScheduledGroups = nonArchivedGroups(data).filter(groupVisibleToRole);
    visibleScheduledGroups.forEach((group) => {
      const sessions = sessionsOf(ensureEightActiveSessions(group))
        .filter((session) => !session.c)
        .map((session) => String(session.d ?? session.k).slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();
      const session7Date = sessions[6];
      const session8Date = sessions[7];
      if (!session7Date || !session8Date) return;

      const renewalMilestones: { key: RenewalReminderMilestone; date: string; label: string }[] = [
        { key: "session7", date: session7Date, label: "بعد الجلسة السابعة" },
        { key: "session8", date: session8Date, label: "بعد الجلسة الثامنة" },
        { key: "afterSession8", date: addIsoDays(session8Date, 5), label: "متابعة بعد انتهاء الراوند" }
      ];
      activeStudentsOf(data, group.id).filter((student) => Number(student.ren ?? 0) !== 1).forEach((student) => {
        const identity = String(student.profileId || student.movedFromStudentId || student.copiedFromStudentId || student.id);
        if (renewalReminderProfiles.has(identity)) return;
        const milestone = renewalMilestones.find(({ key, date }) => date <= today && !student.renewalReminderAt?.[key]);
        if (!milestone) return;
        renewalReminderProfiles.add(identity);
        notices.push({
          id: `renewal-${group.id}-${student.id}-${milestone.key}`,
          kind: "student",
          title: `متابعة تجديد: ${student.n || "طالب"}`,
          description: `${displayGroupLabel(group, data)}${student.lv ? ` · المستوى ${student.lv}` : ""} · ${milestone.label} · ${formatDate(milestone.date)}`,
          phone: student.ph,
          studentId: student.id,
          groupId: group.id,
          renewalReminderMilestone: milestone.key
        });
      });

      if (group.p || session7Date > today || today > addIsoDays(session8Date, 5)) return;
      const level = matchingLevel(group.lv);
      if (!level) return;
      const successor = active.filter((candidate) => !candidate.p && candidate.id !== group.id && candidate.r !== group.r && matchingLevel(candidate.lv) === level)
        .map((candidate) => ({ group: candidate, start: sessionsOf(ensureEightActiveSessions(candidate)).filter((session) => !session.c).map((session) => String(session.d ?? session.k).slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0] ?? "" }))
        .filter((item) => item.start && item.start >= session8Date && item.start >= today)
        .sort((a, b) => a.start.localeCompare(b.start))[0]?.group;
      const seenProfiles: PersonRecord[] = [];
      const addLevelCandidate = (candidate: { id: string; n?: string; ph?: string; lv?: string; profileId?: string; copiedFromStudentId?: string; movedFromStudentId?: string; levelMatchFollowups?: Record<string, number> }, targetTab: AppNotice["targetTab"], recordId: string, targetKind: "student" | "lead") => {
        if (seenProfiles.some((seen) => sameStudentIdentity(seen, candidate)) || candidate.levelMatchFollowups?.[group.id]) return;
        seenProfiles.push(candidate);
        notices.push({
          id: `level-match-${group.id}-${candidate.id}`,
          kind: targetKind,
          title: candidate.n || candidate.ph || "عميل",
          description: `عميل بمستوى ${candidate.lv || group.lv} · الجروب الحالي ينتهي ${formatDate(session8Date)}${successor ? ` · جروب قادم مناسب: ${displayGroupLabel(successor, data)} (${formatDate(successor.s)})` : " · راجع ضمه للراوند القادم"}`,
          phone: candidate.ph,
          groupId: group.id,
          relatedGroupId: successor?.id,
          targetTab,
          levelMatchReminder: true,
          ...(targetKind === "lead" ? { leadId: recordId } : { studentId: recordId })
        });
      };
      live(data.l).filter((lead) => !isTerminalLead(lead) && !leadHasStudentRecord(lead, data) && matchingLevel(lead.lv) === level).forEach((lead) => addLevelCandidate(lead, leadBucket(lead), lead.id, "lead"));
      const formerIds = new Set(formerCustomerRows(data).map((student) => student.id));
      live(data.m).filter((student) => student.g !== group.id && student.g !== successor?.id && matchingLevel(student.lv) === level
        && !student.movedToLeadId && (formerIds.has(student.id) || isActiveStudentEnrollment(student, data)))
        .forEach((student) => addLevelCandidate(student, formerIds.has(student.id) ? "next" : undefined, student.id, "student"));
    });

    feedbackSessionsDue(active, today).forEach(({ group, milestone, sessionDate }) => {
      notices.push({
        id: "feedback-" + group.id + "-" + milestone,
        kind: "feedback",
        title: "إرسال فيدباك بعد الجلسة " + milestone,
        description: displayGroupLabel(group, data) + " · " + formatDate(sessionDate),
        groupId: group.id,
        feedbackMilestone: milestone
      });
    });
  }
  const notFinished = active.filter((group) => { const end = plannedGroupEndDate(group); return !end || end >= today; });
  notFinished.flatMap((group) => activeStudentsOf(data, group.id).map((student) => ({ group, student, ...absenceInfo(data, group, student, today) })))
    .forEach(({ group, student, absent, held }) => {
      if (recent(student)) return;
      const milestone = absent >= 4 ? "4" : absent >= 2 ? "2" : undefined;
      if (!milestone || student.absenceFollowups?.[milestone]) return;
      notices.push({ id: `absence-${student.id}-${group.id}-${milestone}`, kind: "absence", title: milestone === "4" ? `تنبيه مهم: ${student.n || "طالب"}` : `متابعة غياب: ${student.n || "طالب"}`, description: milestone === "4" ? `غاب ${absent} جلسات؛ تواصل معه فورًا حتى لا يضطر لإعادة المستوى · ${displayGroupLabel(group, data)}` : `غاب جلستين؛ تواصل معه للاطمئنان والمتابعة · ${displayGroupLabel(group, data)}`, phone: student.ph, studentId: student.id, groupId: group.id, absenceMilestone: milestone });
    });
  // Teachers may see only an approaching end date for their own active groups.
  // Lead follow-ups, student-renewal decisions, and payment notices stay owner/admin-only.
  if (role === "teacher") return notices;
  live(data.l).forEach((lead) => {
    if (isTerminalLead(lead)) return;
    const due = leadFollowupDate(lead);
    const hot = ["كلمته", "مستني رد", "رن تاني", "هيبدأ"].includes(String(lead.st ?? ""));
    if (due && due <= today) notices.push({ id: `lead-${lead.id}`, kind: "lead", title: lead.n || "ليد بدون اسم", description: `متابعة مستحقة ${formatDate(due)}${lead.lv ? ` · المستوى ${lead.lv}` : ""} · ${leadBucketLabel(leadBucket(lead))}`, phone: lead.ph, leadId: lead.id, targetTab: leadBucket(lead) });
    else if (!recent(lead) && hot) notices.push({ id: `lead-hot-${lead.id}`, kind: "lead", title: lead.n || "ليد بدون اسم", description: `متابعة العميل · ${lead.st}${lead.lv ? ` · المستوى ${lead.lv}` : ""} · ${leadBucketLabel(leadBucket(lead))}`, phone: lead.ph, leadId: lead.id, targetTab: leadBucket(lead) });
    else if (!recent(lead) && followupDueEverySevenDays(lead, due, now, today)) notices.push({ id: `lead-auto-${lead.id}`, kind: "lead", title: lead.n || "ليد بدون اسم", description: `متابعة دورية كل أسبوع${lead.lv ? ` · المستوى ${lead.lv}` : ""} · ${leadBucketLabel(leadBucket(lead))}`, phone: lead.ph, leadId: lead.id, targetTab: leadBucket(lead) });
  });
  live(data.m).filter((student) => isEnrolledStudent(student) && (!student.g || groupMap.has(student.g))).forEach((student) => {
    const identity = String(student.profileId || student.movedFromStudentId || student.copiedFromStudentId || student.id);
    if (renewalReminderProfiles.has(identity)) return;
    const group = groupMap.get(student.g);
    const due = String(student.fd ?? "");
    if (due && due <= today) {
      notices.push({ id: `student-${student.id}`, kind: "student", title: student.n || "طالب", description: `متابعة مستحقة ${formatDate(due)}${student.lv ? ` · المستوى ${student.lv}` : ""}${group ? ` · ${displayGroupLabel(group, data)}` : ""}`, phone: student.ph, studentId: student.id, groupId: group?.id });
      return;
    }
    if (recent(student)) return;
    if (role === "owner" && student.pay === 2 && student.pn) notices.push({ id: `payment-${student.id}`, kind: "payment", title: student.n || "طالب", description: `متبقي دفع: ${student.pn}${student.lv ? ` · المستوى ${student.lv}` : ""}${group ? ` · ${displayGroupLabel(group, data)}` : ""}`, phone: student.ph, studentId: student.id, groupId: group?.id });
  });
  live(data.m).filter((student) => student.movedToTab === "renewals" || Boolean(student.formerAt && Number(student.ren) !== 2)).forEach((student) => {
    const identity = String(student.profileId || student.movedFromStudentId || student.copiedFromStudentId || student.id);
    if (renewalReminderProfiles.has(identity)) return;
    const due = String(student.fd ?? "");
    if (due && due > today) return;
    const group = groupMap.get(student.g);
    const dueText = due && due <= today ? `متابعة مستحقة ${formatDate(due)}` : "متابعة دورية كل أسبوعين";
    if ((due && due <= today) || followupDueEveryFourteenDays(student, due, now, today)) {
      notices.push({ id: `former-${student.id}`, kind: "student", title: student.n || "عميل قديم", description: `${dueText}${student.lv ? ` · المستوى ${student.lv}` : ""}${group ? ` · ${displayGroupLabel(group, data)}` : " · عملاء الراوند الجاي"}`, phone: student.ph, studentId: student.id, targetTab: "next" });
    }
  });
  return notices;
}

function leadBucketLabel(bucket: "next" | "leads"): string {
  return bucket === "next" ? "عملاء الراوند الجاي" : "الليدز";
}

type NoticeFocus = { kind: "student" | "lead"; id: string };

function AppShell() {
  const academy = useAcademy();
  const [tab, setTab] = useState<Tab>("home");
  const [drawer, setDrawer] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [archiveFocusKey, setArchiveFocusKey] = useState("");
  const [noticeFocus, setNoticeFocus] = useState<NoticeFocus | null>(null);
  const [groupFocusId, setGroupFocusId] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [noticePulse, setNoticePulse] = useState(0);
  const [noticePosition, setNoticePosition] = useState({ top: 82, right: 265 });
  const notificationButton = useRef<HTMLButtonElement | null>(null);
  const { profile, data } = academy;
  const toggleNotifications = () => {
    if (!noticesOpen) {
      const rect = notificationButton.current?.getBoundingClientRect();
      if (rect) setNoticePosition({ top: rect.bottom + 8, right: Math.max(10, window.innerWidth - rect.right) });
    }
    setNoticesOpen((open) => !open);
  };

  useEffect(() => {
    const path = window.location.pathname;
    if (academy.phase === "signed-out" && path !== "/login.html") window.location.replace("/login.html");
    if (academy.phase === "ready" && path !== "/system-preview.html") window.location.replace("/system-preview.html");
  }, [academy.phase]);
  useEffect(() => {
    if (academy.phase === "ready" && profile?.role === "teacher" && tab === "home") setTab("groups");
  }, [academy.phase, profile?.role, tab]);
  useEffect(() => { if (academy.phase === "ready" && isMarketingRole(profile?.role) && tab !== "marketing") setTab("marketing"); }, [academy.phase, profile?.role]);
  useEffect(() => {
    if (academy.phase !== "ready") return undefined;
    const handleHistory = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target && (target.matches("input, textarea, select") || target.isContentEditable));
      if (event.key === "Escape") { setSearchOpen(false); setNoticesOpen(false); return; }
      if (!editing && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" || event.key === "/" && !event.ctrlKey && !event.metaKey)) { event.preventDefault(); setSearchOpen(true); return; }
      if (!(event.ctrlKey || event.metaKey) || editing) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (key === "y" || event.shiftKey) academy.redo(); else academy.undo();
      }
    };
    window.addEventListener("keydown", handleHistory);
    return () => window.removeEventListener("keydown", handleHistory);
  }, [academy.phase, academy.undo, academy.redo]);
  useEffect(() => {
    if (academy.phase !== "ready") return undefined;
    const timer = window.setInterval(() => setNoticePulse((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [academy.phase]);
  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 320);
    updateScrollTopVisibility();
    window.addEventListener("scroll", updateScrollTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollTopVisibility);
  }, []);
  useEffect(() => {
    if (!noticeFocus) return undefined;
    const elementId = `${noticeFocus.kind}-record-${noticeFocus.id}`;
    let attempts = 0;
    let timer = 0;
    const findAndFocus = () => {
      const target = document.getElementById(elementId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("notice-target-highlight");
        window.setTimeout(() => target.classList.remove("notice-target-highlight"), 2600);
        setNoticeFocus(null);
      } else if (attempts++ < 12) timer = window.setTimeout(findAndFocus, 120);
      else setNoticeFocus(null);
    };
    timer = window.setTimeout(findAndFocus, 150);
    return () => window.clearTimeout(timer);
  }, [noticeFocus, selectedGroup, tab]);
  useEffect(() => {
    if (!groupFocusId) return undefined;
    let attempts = 0;
    let timer = 0;
    const findAndFocus = () => {
      const target = document.getElementById(`group-record-${groupFocusId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        setGroupFocusId("");
      } else if (attempts++ < 12) timer = window.setTimeout(findAndFocus, 120);
      else setGroupFocusId("");
    };
    timer = window.setTimeout(findAndFocus, 150);
    return () => window.clearTimeout(timer);
  }, [groupFocusId, selectedGroup, tab]);

  // Keep hooks above phase-dependent returns so auth transitions preserve hook order.
  const notices = useMemo(() => profile ? deriveNotices(data, profile.role, profile.teacherName) : [], [data, profile?.role, profile?.teacherName, noticePulse]);

  if (academy.phase === "loading") return <Loading />;
  if (academy.phase === "signed-out") return window.location.pathname === "/login.html" ? <Login error={academy.error} onLogin={academy.login} /> : <Loading />;
  if (academy.phase === "error") return <main className="auth-page"><section className="auth-card"><div className="auth-mark"><div className="auth-mark__badge"><ShieldCheck size={23} /></div><div><strong>SPEAKOZY</strong><small>نظام إدارة الأكاديمية</small></div></div><h1>تعذر فتح النظام</h1><p>{academy.error || "تعذر تحميل البيانات أو صلاحيات هذا الحساب."}</p><div className="error-actions"><button className="btn" onClick={academy.retryConnection}>إعادة المحاولة</button><button className="btn btn--ghost" onClick={academy.logout}>العودة لتسجيل الدخول</button></div></section></main>;
  if (!profile) return <Loading />;

  const tabs = visibleTabs(profile.role);
  const chooseTab = (next: Tab) => { setTab(next); setDrawer(false); setNoticesOpen(false); if (next === "attendance") setSelectedGroup(""); };
  const openAttendance = (groupId?: string) => { setSelectedGroup(groupId ?? ""); setTab("attendance"); setDrawer(false); setNoticesOpen(false); };
  const openTeacherGroup = (requested: AcademyGroup) => {
    const group = data.g.find((item) => item.id === requested.id) ?? requested;
    if (group.x) { setArchiveFocusKey(`g:${group.id}`); setSelectedGroup(""); chooseTab("security"); return; }
    setArchiveFocusKey(""); setSelectedGroup(group.id); setGroupFocusId(group.id); chooseTab(group.p && profile.role !== "teacher" ? "private" : "groups");
  };
  const selectNoticeGroup = (groupId?: string) => {
    const group = data.g.find((item) => item.id === groupId);
    if (groupId) { setSelectedGroup(groupId); setGroupFocusId(groupId); }
    chooseTab(group?.p ? "private" : "groups");
  };
  const openNoticeCard = (notice: AppNotice) => {
    setNoticesOpen(false);
    if (notice.leadId) {
      const lead = data.l.find((item) => item.id === notice.leadId);
      setNoticeFocus({ kind: "lead", id: notice.leadId });
      const targetTab = notice.targetTab ?? (lead ? leadBucket(lead) : "leads");
      chooseTab(targetTab === "renewals" ? "next" : targetTab);
      return;
    }
    if (!notice.studentId) return;
    const student = data.m.find((item) => item.id === notice.studentId);
    if (student?.movedToLeadId) {
      const movedLead = data.l.find((item) => item.id === student.movedToLeadId && !item.x);
      if (movedLead) {
        setNoticeFocus({ kind: "lead", id: movedLead.id });
        chooseTab(leadBucket(movedLead));
        return;
      }
    }
    const group = data.g.find((item) => item.id === student?.g);
    const rawDestination = notice.targetTab ?? student?.movedToTab ?? (student?.formerAt ? "renewals" : group?.p ? "private" : "groups");
    const destination = rawDestination === "renewals" ? "next" : rawDestination;
    if (destination === "groups" || destination === "private") setSelectedGroup(student?.g ?? notice.groupId ?? "");
    setNoticeFocus({ kind: "student", id: notice.studentId });
    chooseTab(destination);
  };
  const doneNotice = (notice: AppNotice) => academy.commit((draft) => {
    const stamp = Date.now();
    const log = (item: { fd?: string; fh?: unknown[]; fu?: number; lu?: number; followupDoneAt?: number }) => { const history = Array.isArray(item.fh) ? item.fh : []; item.fh = [...history, { t: stamp, to: "", n: "تم إنهاء المتابعة" }].slice(-40); item.fd = ""; item.fu = stamp; item.lu = stamp; item.followupDoneAt = stamp; };
    if (notice.leadId) {
      const lead = draft.l.find((item) => item.id === notice.leadId);
      if (lead) {
        log(lead);
        if (notice.levelMatchReminder && notice.groupId) lead.levelMatchFollowups = { ...(lead.levelMatchFollowups ?? {}), [notice.groupId]: stamp };
      }
    }
    if (notice.kind === "round" && notice.groupId) { const group = draft.g.find((item) => item.id === notice.groupId); if (group) { group.fd = ""; group.fu = stamp; group.followupDoneAt = stamp; } }
    if (notice.kind === "feedback" && notice.groupId && notice.feedbackMilestone) {
      const group = draft.g.find((item) => item.id === notice.groupId);
      if (group) group.feedbackSentAt = { ...(group.feedbackSentAt ?? {}), [notice.feedbackMilestone]: stamp };
    }
    if (notice.studentId) {
      const student = draft.m.find((item) => item.id === notice.studentId);
      if (student) {
        log(student);
        if (notice.absenceMilestone) student.absenceFollowups = { ...(student.absenceFollowups ?? {}), [notice.absenceMilestone]: stamp };
        if (notice.renewalReminderMilestone) student.renewalReminderAt = { ...(student.renewalReminderAt ?? {}), [notice.renewalReminderMilestone]: stamp };
        if (notice.levelMatchReminder && notice.groupId) student.levelMatchFollowups = { ...(student.levelMatchFollowups ?? {}), [notice.groupId]: stamp };
      }
    }
  }, notice.kind === "feedback" ? "تم تسجيل إرسال الفيدباك." : "تم إنهاء الإشعار.");

  return <div className="app-shell">
    <button className="mobile-menu" onClick={() => setDrawer(true)} aria-label="فتح القائمة"><Menu size={20} /></button>
    {drawer && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
    <header className="topbar">
      <a className="brand" href="/system-preview.html" aria-label="SPEAKOZY">
        <span className="brand__mark"><BookOpenCheck size={20} /></span><span><span className="brand__text">SPEAKOZY</span><span className="brand__sub">نظام إدارة الأكاديمية</span></span>
      </a>
      <div className="topbar-tools">
        <span className="save-state">{import.meta.env.DEV ? <><Check size={14} /> معاينة فقط</> : academy.saving ? <><RotateIcon /> جارٍ الحفظ</> : <><Check size={14} /> محفوظ</>}</span>
        {!isMarketingRole(profile.role) && <><button className="icon-btn" onClick={academy.undo} disabled={!academy.canUndo} aria-label="تراجع" title="تراجع (Ctrl+Z)"><Undo2 size={18} /></button>
        <button className="icon-btn" onClick={academy.redo} disabled={!academy.canRedo} aria-label="إعادة" title="إعادة (Ctrl+Y)"><Redo2 size={18} /></button>
        <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="بحث"><Search size={19} /></button>
        <button ref={notificationButton} className="icon-btn" onClick={toggleNotifications} aria-label="الإشعارات"><Bell size={19} />{notices.length > 0 && <span className="notification-count">{Math.min(notices.length, 99)}</span>}</button></>}
        <div className="account-pill"><Users size={15} /><span>{profile.email}</span><b>· {roleLabel(profile.role)}</b></div>
      </div>
    </header>
    <aside className={`sidebar ${drawer ? "open" : ""}`} aria-label="القائمة الرئيسية">
      <div className="sidebar__heading">نظام إدارة الأكاديمية</div><nav className="nav-list">{tabs.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => chooseTab(item.id)}><Icon /><span>{item.label}</span></button>;
      })}</nav>
      <div className="sidebar__footer"><button className="logout" onClick={academy.logout}><LogOut size={17} />تسجيل الخروج</button></div>
    </aside>
    <main className="page">
      {(profile.role === "owner" || profile.role === "admin") && ["groups", "private", "next", "leads"].includes(tab) && <StudentCodeTransfer key={tab} data={data} commit={academy.commit} />}
       {tab === "home" && !isMarketingRole(profile.role) && <HomeView data={data} profile={profile} onTab={chooseTab} onOpenGroup={openTeacherGroup} onOpenNotice={openNoticeCard} commit={academy.commit} />}
      {tab === "report" && <ReportView data={data} profile={profile} onOpenAttendance={openAttendance} />}
      {tab === "groups" && <GroupsView data={data} profile={profile} teacherAccounts={academy.teacherAccounts} isPrivate={false} selectedGroup={selectedGroup} onSelected={setSelectedGroup} onOpenAttendance={openAttendance} commit={academy.commit} />}
      {tab === "private" && <GroupsView data={data} profile={profile} teacherAccounts={academy.teacherAccounts} isPrivate selectedGroup={selectedGroup} onSelected={setSelectedGroup} onOpenAttendance={openAttendance} commit={academy.commit} />}
      {tab === "next" && <LeadsView data={data} bucket="next" commit={academy.commit} />}
      {tab === "leads" && <LeadsView data={data} bucket="leads" commit={academy.commit} />}
      {tab === "attendance" && <AttendanceView data={data} profile={profile} initialGroup={selectedGroup} onSelected={setSelectedGroup} setAttendance={academy.setAttendance} commit={academy.commit} />}
      {tab === "teachers" && <TeachersView data={data} profile={profile} commit={academy.commit} teacherAccounts={academy.teacherAccounts} onDeleteTeacher={academy.deleteTeacherFromSystem} onOpenGroup={openTeacherGroup} />}
      {tab === "finance" && profile.role === "owner" && <FinanceView data={data} commit={academy.commit} onOpenGroup={openTeacherGroup} />}
      {tab === "retention" && profile.role !== "teacher" && <RetentionView data={data} />}
      {tab === "security" && profile.role !== "teacher" && <SecurityView data={data} profile={profile} commit={academy.commit} backups={academy.backups} backupsLoading={academy.backupsLoading} loadBackups={academy.loadBackups} refreshBackups={academy.refreshBackups} focusArchiveKey={archiveFocusKey} />}
      {tab === "scripts" && (profile.role === "owner" || profile.role === "admin") && <ScriptsView data={data} commit={academy.commit} />}
      {tab === "marketing" && canAccessMarketingAnalytics(profile.role) && <MarketingView data={data} profile={profile} commit={academy.commit} refreshProjection={academy.refreshMarketingProjection} />}
    </main>
    {noticesOpen && <Overlay className="popover-overlay" style={{ top: noticePosition.top, right: noticePosition.right }} onClose={() => setNoticesOpen(false)}><div className="popover notification-popover"><div className="popover__head"><h2>الإشعارات</h2><button className="btn btn--ghost btn--icon" onClick={() => setNoticesOpen(false)} aria-label="إغلاق"><X size={17} /></button></div>{notices.length === 0 ? <div className="empty">لا توجد إشعارات تحتاج إجراء الآن.</div> : notices.map((notice) => <div className="notice-row" key={notice.id}><h3>{notice.title}</h3><p>{notice.description}</p>{notice.phone && <button type="button" className="notification-phone-link" dir="ltr" onClick={() => openNoticeCard(notice)} aria-label={`فتح كارت ${notice.title} برقم ${notice.phone}`}>{notice.phone}</button>}<div className="notice-row__actions"><button className="btn btn--ghost btn--small" disabled={!notice.phone} onClick={() => notice.phone && void safeCopy(notice.phone).then(() => academy.setToast({ text: "تم نسخ الرقم.", tone: "success" }))}><Copy size={13} />نسخ الرقم</button><button className="btn btn--small" onClick={() => doneNotice(notice)}>تمت المتابعة</button><button className="btn btn--ghost btn--small" disabled={!notice.studentId && !notice.leadId} onClick={() => openNoticeCard(notice)}>مكان العميل</button></div></div>)}</div></Overlay>}
    {searchOpen && <SearchOverlay data={data} profile={profile} onClose={() => setSearchOpen(false)} onGroup={(id, isPrivate) => { setSelectedGroup(id); setGroupFocusId(id); chooseTab(isPrivate ? "private" : "groups"); }} onStudent={(student) => openNoticeCard({ id: `search-${student.id}`, kind: "student", title: student.n || "طالب", description: "", phone: student.ph, studentId: student.id, groupId: student.g })} onLead={(lead) => { setNoticeFocus({ kind: "lead", id: lead.id }); chooseTab(leadBucket(lead)); }} />}
    {academy.toast && <div className={`toast ${academy.toast.tone}`} role="status">{academy.toast.tone === "success" ? <Check size={17} /> : <BellRing size={17} />}<span>{academy.toast.text}</span></div>}
    {showScrollTop && <button type="button" className="scroll-top-button" aria-label="الرجوع لأول الصفحة" title="الرجوع لأول الصفحة" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={19} /><span>أعلى الصفحة</span></button>}
  </div>;
}

function StudentCodeTransfer({ data, commit }: { data: AcademyData; commit: Commit }) {
  const [identifier, setIdentifier] = useState("");
  const [destination, setDestination] = useState<"" | "group" | "private" | "leads" | "next">("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [targetRoundId, setTargetRoundId] = useState("");
  const [selectedRecordKey, setSelectedRecordKey] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const needle = identifier.trim().toLocaleUpperCase();
  const phoneNeedle = personPhone(identifier);
  const matches = (record: PersonRecord & { studentCode?: string }) => {
    if (!needle) return false;
    if (matchesStudentCode(studentCodeFor(record), identifier)) return true;
    if (isStudentCodeQuery(identifier)) return false;
    const phone = personPhone(record.ph);
    return phoneNeedle.length >= 3 && phone.includes(phoneNeedle);
  };
  const matchedLeads = live(data.l).filter(matches).sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0));
  const matchedStudents = live(data.m).filter(matches).sort((a, b) => {
    const aActive = isActiveStudentEnrollment(a, data) ? 1 : 0;
    const bActive = isActiveStudentEnrollment(b, data) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aFormerCopy = a.movedToTab === "renewals" && a.copiedFromStudentId ? 1 : 0;
    const bFormerCopy = b.movedToTab === "renewals" && b.copiedFromStudentId ? 1 : 0;
    if (aFormerCopy !== bFormerCopy) return bFormerCopy - aFormerCopy;
    return Number(b.formerAt ?? 0) - Number(a.formerAt ?? 0);
  });
  const matchOptions: Array<{ kind: "student" | "lead"; item: Student | Lead }> = [
    ...matchedStudents.map((item) => ({ kind: "student" as const, item })),
    ...matchedLeads.map((item) => ({ kind: "lead" as const, item }))
  ].filter((entry, index, all) => !all.slice(0, index).some((seen) => sameStudentIdentity(seen.item, entry.item)));
  const recordKey = (entry: { kind: "student" | "lead"; item: Student | Lead }) => `${entry.kind}:${entry.item.id}`;
  const selectedMatch = matchOptions.find((entry) => recordKey(entry) === selectedRecordKey) ?? (matchOptions.length === 1 ? matchOptions[0] : undefined);
  const record = selectedMatch?.item;
  const availableRounds = live(data.r).filter((round) => !round.pl && activeGroups(data).some((group) => !group.p && group.r === round.id && isGroupOperationalToday(group))).sort((a, b) => String(a.s ?? "").localeCompare(String(b.s ?? "")));
  const groups = destination === "group" || destination === "private"
    ? activeGroups(data).filter((group) => isGroupOperationalToday(group) && Boolean(group.p) === (destination === "private") && (destination !== "group" || group.r === targetRoundId))
    : [];
  const clearFeedback = () => setFeedback(null);
  const submit = () => {
    if (!record) { setFeedback({ text: matchOptions.length > 1 ? "اختار العميل الصحيح من النتائج أولًا." : "لم أجد عميلًا بهذا الكود أو الرقم.", error: true }); return; }
    if (!destination) { setFeedback({ text: "اختار المكان اللي هتنقل أو تضيف العميل فيه.", error: true }); return; }
    const isLead = selectedMatch?.kind === "lead";
    if (destination === "group" && !targetRoundId) { setFeedback({ text: "اختار الراوند أولًا، ثم اختار الجروب.", error: true }); return; }
    if ((destination === "group" || destination === "private") && !targetGroupId) { setFeedback({ text: "اختار الجروب أو الـPrivate المستهدف.", error: true }); return; }
    if ((destination === "group" || destination === "private") && leadFollowupValue(record as Lead) === "level_completed" && !record.lv) { setFeedback({ text: "اختار مستوى العميل أولًا من كارت الليد.", error: true }); return; }

    let failure = "";
    const stamp = Date.now();
    commit((draft) => {
      let sourceLead = isLead ? draft.l.find((item) => item.id === record.id && !item.x) : undefined;
      let sourceStudent = !isLead ? draft.m.find((item) => item.id === record.id && !item.x) : undefined;
      if (!sourceStudent && !isLead) sourceStudent = draft.m.find((item) => !item.x && sameStudentIdentity(item, record));
      if (!sourceLead && isLead) sourceLead = draft.l.find((item) => !item.x && sameStudentIdentity(item, record));
      if (!sourceLead && !sourceStudent) {
        sourceStudent = draft.m.find((item) => !item.x && sameStudentIdentity(item, record));
        sourceLead = sourceStudent ? undefined : draft.l.find((item) => !item.x && sameStudentIdentity(item, record));
      }
      const source = sourceLead ?? sourceStudent;
      if (!source) { failure = "السجل لم يعد متاحًا؛ ابحث بالكود مرة أخرى."; return; }
      if (destination === "leads" || destination === "next") {
        if (sourceLead) {
          sourceLead.bucket = destination === "next" ? "next" : "";
          sourceLead.source_sheet = destination === "next" ? "next round" : "lead";
          if (sourceLead.movedFromStudentId) removeStudentAttendance(draft, sourceLead.movedFromStudentId);
          return;
        }
        const student = sourceStudent;
        if (!student) return;
        const linkedLead = draft.l.find((item) => !item.x && item.id === student.movedToLeadId)
          ?? draft.l.find((item) => !item.x && samePerson(student, item));
        const leadId = linkedLead?.id ?? uid();
        const newLead: Lead = {
          ...(linkedLead ?? {}),
          id: leadId,
          profileId: student.profileId || student.id,
          studentCode: student.studentCode || studentCodeFor(student),
          movedFromStudentId: student.id,
          n: student.n ?? "", ph: student.ph ?? "", lv: student.lv ?? "", nt: student.nt ?? "",
          source: student.source ?? "", sourceOther: student.sourceOther ?? "",
          st: linkedLead?.st ?? "مهتم", followupCat: linkedLead?.followupCat ?? "interested",
          bucket: destination === "next" ? "next" : "",
          source_sheet: destination === "next" ? "next round" : "lead",
          enrollmentType: student.enrollmentType ?? (draft.g.find((group) => group.id === student.g)?.p ? "private" : "group"),
          kind: studentKind(student),
          subscriptionClass: student.subscriptionClass ?? (studentKind(student) === "new" ? "new" : "renewal"),
          subscriptionSource: student.subscriptionSource ?? student.source ?? "",
          subscriptionSourceOther: student.subscriptionSourceOther ?? student.sourceOther ?? "",
          ts: linkedLead?.ts ?? stamp
        };
        if (linkedLead) Object.assign(linkedLead, newLead); else draft.l.push(newLead);
        draft.l.filter((item) => !item.x && item.id !== leadId && sameStudentIdentity(student, item)).forEach((item) => { item.x = 1; item.xa = stamp; });
        const wasActiveEnrollment = isActiveStudentEnrollment(student, draft);
        student.movedToTab = destination;
        if (!wasActiveEnrollment) student.formerAt = student.formerAt || stamp;
        student.movedToLeadId = leadId;
        removeStudentAttendance(draft, student.id);
        if (student.copiedFromStudentId) { student.x = 1; student.xa = stamp; }
        return;
      }
      const selectedGroup = draft.g.find((group) => group.id === targetGroupId && !group.x);
      if (!selectedGroup || Boolean(selectedGroup.p) !== (destination === "private")) { failure = "اختيار المجموعة غير صالح؛ حدّث الصفحة ثم اخترها مرة أخرى."; return; }
      const person: PersonRecord = source;
      if (hasActiveStudentEnrollment(person, draft)) { failure = "العميل مسجل في جروب شغال بالفعل؛ انقله من بطاقة الطالب أولًا."; return; }
      const currentCount = draft.m.filter((student) => student.g === selectedGroup.id && !student.x && isEnrolledStudent(student)).length;
      if (selectedGroup.p ? !privateGroupCanAccept(draft, selectedGroup.id) : !canAddStudentToGroup(selectedGroup, currentCount)) { failure = "الجروب وصل للسعة أو الـPrivate مشغول؛ اختر مكانًا آخر."; return; }
      const kind = sourceStudent ? (studentKind(sourceStudent) === "new" ? "old" : studentKind(sourceStudent)) : sourceLead?.kind ?? "new";
      const newStudentId = uid();
      draft.m.push({
        id: newStudentId,
        profileId: source.profileId || (sourceStudent?.profileId ?? sourceLead?.movedFromStudentId) || source.id,
        studentCode: source.studentCode || (sourceStudent ? studentCodeFor(sourceStudent) : sourceLead ? studentCodeFor(sourceLead) : undefined),
        g: selectedGroup.id,
        r: selectedGroup.r,
        n: source.n ?? "", ph: source.ph ?? "", lv: source.lv ?? "",
        enrollmentType: destination === "private" ? "private" : "group",
        kind,
        subscriptionClass: source.subscriptionClass ?? (sourceStudent || sourceLead?.movedFromStudentId ? "renewal" : "new"),
        source: source.source ?? "", sourceOther: source.sourceOther ?? "",
        subscriptionSource: sourceStudent?.subscriptionSource ?? sourceLead?.subscriptionSource ?? source.source ?? "",
        subscriptionSourceOther: sourceStudent?.subscriptionSourceOther ?? sourceLead?.subscriptionSourceOther ?? source.sourceOther ?? "",
        nw: kind === "new" ? 1 : 0,
        pay: 0, amount: 0, pn: "", ren: 0, lvPaid: sourceStudent?.lvPaid ?? 1,
        nt: source.nt ?? "", c: [0, 0, 0, 0, 0]
      });
      if (sourceLead) draft.l.filter((item) => !item.x && sameStudentIdentity(sourceLead, item)).forEach((item) => { item.x = 1; item.xa = stamp; });
      if (sourceStudent) draft.l.filter((item) => !item.x && sameStudentIdentity(sourceStudent, item)).forEach((item) => { item.x = 1; item.xa = stamp; });
      if (sourceStudent?.copiedFromStudentId) { sourceStudent.x = 1; sourceStudent.xa = stamp; }
      if (sourceStudent?.movedToLeadId) {
        const lead = draft.l.find((item) => item.id === sourceStudent.movedToLeadId);
        if (lead) { lead.x = 1; lead.xa = stamp; }
      }
      if (sourceStudent) removeStudentAttendance(draft, sourceStudent.id);
      else if (sourceLead?.movedFromStudentId) removeStudentAttendance(draft, sourceLead.movedFromStudentId);
    }, "تم نقل العميل للمكان المحدد.");
    if (failure) { setFeedback({ text: failure, error: true }); return; }
    setFeedback({ text: "تم النقل بنجاح؛ بيانات العميل وتاريخه محفوظان.", error: false });
    setIdentifier("");
    setSelectedRecordKey("");
    setTargetGroupId("");
  };
  return <details className="section code-transfer-panel"><summary><span><strong>نقل أو إضافة طالب بالكود</strong><small>اكتب كود SPK كاملًا أو ٣ أرقام على الأقل؛ تظهر النتائج المطابقة لتختار العميل الصحيح.</small></span><ChevronDown size={17} /></summary><div className="code-transfer-panel__body">
    <div className="grid-form"><div className="field"><label htmlFor="student-code-lookup">كود العميل أو جزء من رقم الهاتف</label><input id="student-code-lookup" value={identifier} onChange={(event) => { setIdentifier(event.target.value); setSelectedRecordKey(""); setFeedback(null); }} placeholder="SPK-1 أو جزء من الرقم" dir="auto" /></div><div className="field"><label htmlFor="student-code-destination">المكان الجديد</label><select id="student-code-destination" value={destination} onChange={(event) => { setDestination(event.target.value as typeof destination); setTargetGroupId(""); setTargetRoundId(""); clearFeedback(); }}><option value="">اختر المكان</option><option value="group">جروب</option><option value="private">Private</option><option value="leads">الليدز</option><option value="next">عملاء الراوند الجاي</option></select></div>{destination === "group" && <div className="field"><label htmlFor="student-code-round">الراوند</label><select id="student-code-round" value={targetRoundId} onChange={(event) => { setTargetRoundId(event.target.value); setTargetGroupId(""); }}><option value="">اختر الراوند</option>{availableRounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select></div>}{groups.length > 0 && <div className="field"><label htmlFor="student-code-group">{destination === "private" ? "جلسة Private" : "الجروب"}</label><select id="student-code-group" value={targetGroupId} onChange={(event) => setTargetGroupId(event.target.value)}><option value="">اختر {destination === "private" ? "Private" : "جروبًا"}</option>{groups.map((group) => <option key={group.id} value={group.id}>{displayGroupLabel(group, data)}</option>)}</select></div>}
      {matchOptions.length > 1 && <div className="field"><label htmlFor="student-code-match">اختر العميل المطابق</label><select id="student-code-match" value={selectedRecordKey} onChange={(event) => setSelectedRecordKey(event.target.value)}><option value="">اختر العميل</option>{matchOptions.map((entry) => <option key={recordKey(entry)} value={recordKey(entry)}>{entry.item.n || "بدون اسم"} · {studentCodeFor(entry.item)} · {entry.item.ph || "بدون رقم"}</option>)}</select></div>}
      {record && <div className="code-transfer-preview"><b>{displayStudentName(record as Student, data)}</b><span>{studentCodeFor(record)} · {record.ph || "بدون رقم"}</span></div>}
      <button className="btn" type="button" disabled={!identifier.trim() || !destination || matchOptions.length > 1 && !selectedMatch || destination === "group" && !targetRoundId} onClick={submit}>نقل / إضافة</button>
    </div>
    {feedback && <div className={`notice ${feedback.error ? "notice--warning" : ""}`} role="status">{feedback.text}</div>}
  </div></details>;
}

function RotateIcon() { return <span aria-hidden="true">↻</span>; }

function Overlay({ children, onClose, className = "", style }: { children: React.ReactNode; onClose: () => void; className?: string; style?: React.CSSProperties }) {
  return <div className={`modal-backdrop ${className}`} role="presentation" onMouseDown={onClose}><div role="dialog" aria-modal="true" style={style} onMouseDown={(event) => event.stopPropagation()}>{children}</div></div>;
}

function PageHead({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) { return <div className="page-head"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-head__actions">{actions}</div>}</div>; }

function Metric({ icon: Icon, value, label }: { icon: typeof Users; value: string | number; label: string }) { return <div className="metric-card"><div className="metric-card__icon"><Icon size={18} /></div><strong>{value}</strong><span>{label}</span></div>; }

function scheduledOnDate(group: AcademyGroup, date: string): boolean {
  return scheduledSessionsOnDate(group, date).some((session) => !session.c);
}

const ABSENCE_LIMIT = 3;

function absenceInfo(data: AcademyData, group: AcademyGroup, student: Student, upTo: string): { held: number; absent: number } {
  const heldSessions = sessionsOf(group).filter((session) => !session.c && String(session.d ?? session.k).slice(0, 10) <= upTo);
  return { held: heldSessions.length, absent: heldSessions.filter((session) => attendanceFor(data, String(session.k ?? session.d).slice(0, 10), group.id, student.id)?.status === "absent").length };
}

function absenceRisks(data: AcademyData, groups: AcademyGroup[], upTo: string) {
  return groups.flatMap((group) => activeStudentsOf(data, group.id).map((student) => ({ group, student, ...absenceInfo(data, group, student, upTo) })))
    .filter((row) => row.absent >= ABSENCE_LIMIT)
    .sort((a, b) => b.absent - a.absent || a.student.n?.localeCompare(b.student.n ?? "", "ar") || 0);
}

function HomeView({ data, profile, onTab, onOpenGroup, onOpenNotice, commit }: { data: AcademyData; profile: Profile; onTab: (tab: Tab) => void; onOpenGroup: (group: AcademyGroup) => void; onOpenNotice: (notice: AppNotice) => void; commit: Commit }) {
  const operationalGroups = activeGroups(data).filter((group) => {
    const endDate = plannedGroupEndDate(group);
    return !endDate || endDate >= toIsoDate();
  });
  const groups = operationalGroups.filter((group) => profile.role !== "teacher" || (!isTeacherNameArchived(data, group.tc) && normalise(group.tc) === normalise(profile.teacherName)));
  const studentCounts = currentStudentCounts(data, operationalGroups);
  const activeGroupIds = new Set(groups.map((group) => group.id));
  const activeStudents = live(data.m).filter((student) => isEnrolledStudent(student) && activeGroupIds.has(student.g));
  const renewals = activeStudents.filter((student) => student.ren === 1).length;
  const oldCustomers = activeStudents.filter((student) => studentKind(student) !== "new");
  const oldRenewed = oldCustomers.filter((student) => student.ren === 1).length;
  const oldNotRenewing = oldCustomers.filter((student) => student.ren === 2).length;
  const month = monthKey();
  const pending = activeStudents.filter((student) => student.pay === 2).length;
  const dueNotices = deriveNotices(data, profile.role, profile.teacherName);
  const rounds = live(data.r).filter((round) => isRoundActive(data, round.id));
  const classificationRounds = live(data.r);
  const [classificationRoundId, setClassificationRoundId] = useState("");
  const classificationRound = classificationRounds.find((round) => round.id === classificationRoundId)
    ?? classificationRounds.find((round) => round.id === data.cur)
    ?? classificationRounds[0]
    ?? null;
  const roundStudentsNow = classificationRound ? studentsInRound(data, classificationRound.id) : [];
  const roundSources = new Map<string, number>();
  roundStudentsNow.forEach((student) => { const label = studentSourceLabel(student); roundSources.set(label, (roundSources.get(label) ?? 0) + 1); });
  return <><PageHead title={profile.role === "teacher" ? "لوحة المدرس" : "لوحة التشغيل"} description={profile.role === "teacher" ? "جروباتك وجلساتك وحضور الطلاب المسندين إليك." : "نظرة تشغيلية على الجروبات والطلاب والمتابعات اليومية."} />
    <div className="metric-grid">
      <Metric icon={UsersRound} value={groups.filter((group) => !group.p).length} label={profile.role === "teacher" ? "جروباتي الحالية" : "الجروبات الحالية"} />
      <Metric icon={LockKeyhole} value={groups.filter((group) => group.p).length} label="جروبات Private" />
      {profile.role === "owner" && <><Metric icon={GraduationCap} value={studentCounts.groups} label="طلاب الجروبات الحالية" /><Metric icon={LockKeyhole} value={studentCounts.private} label="طلاب Private الحاليون" /><Metric icon={Users} value={studentCounts.total} label="إجمالي الطلاب الحاليين" /></>}
      {profile.role !== "teacher" && <Metric icon={ArchiveRestore} value={renewals} label="طلاب هيجددوا" />}
      {profile.role === "owner" && <Metric icon={DollarSign} value={`${incomeForMonth(data, month).toLocaleString("en-US")} ج.م`} label="إيرادات الشهر" />}
      {profile.role === "owner" && <Metric icon={Bell} value={pending} label="مدفوعات جزئية" />}
      {profile.role !== "teacher" && <Metric icon={BellRing} value={dueNotices.length} label="متابعات تحتاج إجراء" />}
    </div>
    {profile.role !== "teacher" && <section className="section round-classification"><div className="section-head"><div><h2>تجديد العملاء القدام</h2><p>يشمل الجروبات والـPrivate النشطة، ولا يغيّر مقام الريتينشن.</p></div></div><div className="round-classification__stats"><span><b>{oldRenewed}</b> قدام جددوا</span><span><b>{oldNotRenewing}</b> قدام مش هيجددوا</span></div></section>}
    {profile.role !== "teacher" && <section className="section round-classification">
      <div className="section-head round-classification__head">
        <div>
          <h2>{classificationRound ? `تصنيف طلاب ${roundName(classificationRound)}` : "تصنيف الطلاب"}</h2>
          <p>تصنيف ومصادر طلاب الجروبات غير المؤرشفة للراوند المختار؛ مستقل عن إجمالي الطلاب والريتينشن.</p>
        </div>
        <div className="round-classification__selector">
          <label className="sr-only" htmlFor="home-classification-round">اختيار الراوند</label>
          <select id="home-classification-round" aria-label="اختيار الراوند لتصنيف الطلاب" value={classificationRound?.id ?? ""} disabled={!classificationRounds.length} onChange={(event) => setClassificationRoundId(event.target.value)}>
            {!classificationRounds.length && <option value="">لا توجد راوندات غير مؤرشفة</option>}
            {classificationRounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}{round.on === false ? " · متوقفة" : ""}</option>)}
          </select>
          <span className="tag tag--muted">{roundStudentsNow.length} طالب</span>
        </div>
      </div>
      <div className="round-classification__stats">
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) === "new").length}</b> جديد</span>
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) === "old").length}</b> قديم</span>
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) === "returned").length}</b> رجع بعد انقطاع</span>
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) !== "new" && student.ren === 1).length}</b> قديم جدد</span>
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) !== "new" && student.ren === 2).length}</b> قديم لم يجدد</span>
        <span><b>{roundStudentsNow.filter((student) => studentKind(student) !== "new" && (student.ren ?? 0) === 0).length}</b> قرار التجديد لم يُسجل</span>
      </div>
      <div className="entity-card__meta">{roundSources.size ? [...roundSources].map(([source, count]) => <span className="tag tag--muted" key={source}>{source}: {count}</span>) : <span className="tag tag--muted">لا توجد بيانات مصادر في هذه الراوند</span>}</div>
    </section>}
    {profile.role !== "teacher" && <><SmartRenewalPanel data={data} notices={dueNotices} onTab={onTab} onOpenGroup={onOpenGroup} onOpenNotice={onOpenNotice} /><LeadFollowupPanel data={data} onTab={onTab} /><GroupOccupancyPanel data={data} onTab={onTab} /></>}
    {(profile.role === "owner" || profile.role === "admin") && <><DataQualityPanel data={data} onTab={onTab} onOpenGroup={onOpenGroup} /><TeacherConflictsPanel data={data} onOpenGroup={onOpenGroup} /></>}
    {profile.role !== "teacher" && <section className="section"><div className="section-head"><div><h2>الراوندات النشطة</h2><p>عدد الطلاب والمتابعات في كل راوند نشط، مع فصل الـPrivate.</p></div><button className="btn btn--ghost btn--small" onClick={() => onTab("groups")}>إدارة الجروبات</button></div><div className="round-card-list">{rounds.map((round) => { const roundGroups = groups.filter((group) => !group.p && group.r === round.id); const groupIds = new Set(roundGroups.map((group) => group.id)); const roundStudents = live(data.m).filter((student) => isEnrolledStudent(student) && groupIds.has(student.g)); const decided = roundStudents.filter((student) => student.ren === 1 || student.ren === 2).length; return <button className="round-card" key={round.id} onClick={() => onTab("groups")}><div className="round-card__top"><strong>{roundName(round)}</strong><span className="tag">{roundGroups.length} جروب</span></div><div className="round-card__stats"><span><b>{roundStudents.length}</b> طالب</span><span><b>{roundStudents.filter((student) => student.ren === 1).length}</b> هيجددوا</span><span><b>{roundStudents.filter((student) => student.ren === 2).length}</b> مش هيجددوا</span></div><div className="progress-track"><span style={{ width: roundStudents.length ? `${Math.round(decided / roundStudents.length * 100)}%` : "0%" }} /></div></button>; })}{!rounds.length && <div className="empty">لا توجد راوندات نشطة.</div>}</div></section>}
    <div className="split"><section className="section"><div className="section-head"><div><h2>إجراءات سريعة</h2><p>افتح الصفحات الأكثر استخدامًا.</p></div></div><div className="card-list"><QuickAction icon={UsersRound} title="إدارة الجروبات والطلاب" description="أضف جروبًا أو طالبًا، وراجع المواعيد والمدفوعات." onClick={() => onTab("groups")} /><QuickAction icon={ListChecks} title="الحضور والغياب" description="اختر الجروب وسجّل حاضرًا أو غائبًا أو اترك الخانة بلا علامة." onClick={() => onTab("attendance")} /><QuickAction icon={GraduationCap} title="تصنيفات الليدز" description="تابع العملاء وتحديد المستوى من قائمة الليدز." onClick={() => onTab("leads")} /></div></section>
      <section className="section"><div className="section-head"><div><h2>ملخص اليوم</h2><p>{formatDate(toIsoDate(), true)}</p></div><button className="btn btn--ghost btn--small" onClick={() => onTab("report")}>التقرير اليومي</button></div><TodaySummary data={data} profile={profile} onTab={onTab} /></section></div>
    {profile.role !== "teacher" && <FormerStudentsPanel data={data} commit={commit} former={formerStudents(data)} />}
  </>;
}

function SmartRenewalPanel({ data, notices, onTab, onOpenGroup, onOpenNotice }: { data: AcademyData; notices: AppNotice[]; onTab: (tab: Tab) => void; onOpenGroup: (group: AcademyGroup) => void; onOpenNotice: (notice: AppNotice) => void }) {
  const rows = notices.filter((notice) => ["round", "student", "lead", "payment", "feedback", "absence"].includes(notice.kind)).slice(0, 10);
  return <section className="section"><div className="section-head"><div><h2>تنبيهات التشغيل والتجديد</h2><p>نهاية الراوند، والفيدباك بعد الجلسات 1 و4 و7، والغياب المتكرر وقرارات التجديد.</p></div><button className="btn btn--ghost btn--small" onClick={() => onTab("next")}>فتح عملاء الراوند الجاي</button></div>{rows.length ? <div className="card-list">{rows.map((notice) => {
    const student = notice.studentId ? data.m.find((item) => item.id === notice.studentId) : undefined;
    const group = notice.groupId ? data.g.find((item) => item.id === notice.groupId && !item.x) : undefined;
    const phone = String(notice.phone ?? "").replace(/[^+\d]/g, "");
    const label = notice.kind === "feedback" ? "فيدباك مطلوب" : notice.kind === "absence" ? "غياب متكرر" : student?.ren === 2 ? "مش هيجدد" : student && Number(student.ren ?? 0) === 0 ? "لسه ما قررش" : notice.kind === "round" ? "قربت تنتهي" : "متابعة";
    const warning = notice.kind === "absence" || notice.kind === "feedback" || notice.kind === "round" || student?.ren === 2 || (student && Number(student.ren ?? 0) === 0);
    return <div className="entity-card" key={notice.id}><div className="entity-card__top"><div><h3>{notice.title}</h3><p>{notice.description}{student?.ren === 2 ? ` · السبب: ${student.renewalReason?.trim() || "لم يُسجل السبب"}` : ""}</p></div><span className={`tag ${warning ? "tag--warning" : "tag--muted"}`}>{label}</span></div><div className="entity-card__actions">{phone && <><a className="btn btn--ghost btn--small" href={`tel:${phone}`}>اتصال سريع</a><button className="btn btn--ghost btn--small" onClick={() => safeCopy(notice.phone ?? "")}>نسخ الرقم</button></>}{(notice.studentId || notice.leadId) && <button className="btn btn--ghost btn--small" onClick={() => onOpenNotice(notice)}>افتح الشخص</button>}{group && <button className="btn btn--small" onClick={() => onOpenGroup(group)}>{notice.kind === "feedback" ? "افتح الجروب" : "اعرض الجروب"}</button>}</div></div>;
  })}</div> : <div className="empty">لا توجد تنبيهات تشغيلية مستحقة الآن.</div>}</section>;
}
function DataQualityPanel({ data, onTab, onOpenGroup }: { data: AcademyData; onTab: (tab: Tab) => void; onOpenGroup: (group: AcademyGroup) => void }) {
  const issues = dataQualityIssues(data);
  const labels: Record<string, string> = { "duplicate-phone": "أرقام مكررة", "student-details": "بيانات طالب ناقصة", "missing-group": "طلاب بلا جروب", "group-setup": "إعداد جروب ناقص", source: "مصدر غير محدد" };
  const counts = [...new Set(issues.map((issue) => issue.kind))].map((kind) => ({ kind, count: issues.filter((issue) => issue.kind === kind).length }));
  return <section className="section"><div className="section-head"><div><h2>مراجعة جودة البيانات</h2><p>كشف السجلات التي تحتاج استكمالًا أو مراجعة؛ لا يتم تعديل أي بيانات تلقائيًا.</p></div><span className={`tag ${issues.length ? "tag--warning" : "tag--muted"}`}>{issues.length} ملاحظة</span></div>
    {issues.length ? <><div className="quality-summary">{counts.map((item) => <span className="tag tag--muted" key={item.kind}>{labels[item.kind] || item.kind}: {item.count}</span>)}</div><div className="card-list quality-issues">{issues.slice(0, 8).map((issue) => <div className="entity-card" key={issue.id}><div className="entity-card__top"><div><h3>{issue.title}</h3><p>{issue.detail}</p></div><span className="tag tag--warning">{labels[issue.kind] || "مراجعة"}</span></div><div className="entity-card__actions"><button className="btn btn--ghost btn--small" onClick={() => { const group = issue.groupId ? data.g.find((item) => item.id === issue.groupId) : undefined; if (group) onOpenGroup(group); else onTab("groups"); }}>مراجعة السجل</button></div></div>)}</div>{issues.length > 8 && <p className="quality-more">يعرض أول 8 ملاحظات من أصل {issues.length}.</p>}</> : <div className="empty">لم تظهر مشكلات بيانات تحتاج مراجعة.</div>}
  </section>;
}
function TeacherConflictsPanel({ data, onOpenGroup }: { data: AcademyData; onOpenGroup: (group: AcademyGroup) => void }) {
  const groups = activeGroups(data).filter((group) => !isTeacherNameArchived(data, group.tc));
  const conflicts = allTeacherScheduleConflicts(groups);
  return <section className="section"><div className="section-head"><div><h2>تعارض مواعيد المدرسين</h2><p>يعرض الجروبات ذات المدرس والأيام والوقت المتداخل في جلسة مجدولة بتاريخ واحد.</p></div><span className={`tag ${conflicts.length ? "tag--danger" : "tag--muted"}`}>{conflicts.length} تعارض</span></div>
    {conflicts.length ? <div className="card-list">{conflicts.slice(0, 10).map((conflict) => <div className="entity-card" key={`${conflict.first.id}:${conflict.second.id}`}><div className="entity-card__top"><div><h3>{teacherDisplayName(data, conflict.first.tc)}</h3><p>{groupLabel(conflict.first)} ↔ {groupLabel(conflict.second)}</p><small>جلسات متزامنة: {conflict.dates.slice(0, 3).map((date) => formatDate(date)).join("، ")}{conflict.dates.length > 3 ? ` · و${conflict.dates.length - 3} أخرى` : ""}</small></div><span className="tag tag--danger">تعارض</span></div><div className="entity-card__actions"><button className="btn btn--ghost btn--small" onClick={() => onOpenGroup(conflict.first)}>افتح الجروب الأول</button><button className="btn btn--ghost btn--small" onClick={() => onOpenGroup(conflict.second)}>افتح الجروب الثاني</button></div></div>)}</div> : <div className="empty">لا يوجد تعارض بين مواعيد الجروبات النشطة.</div>}
  </section>;
}
function LeadFollowupPanel({ data, onTab }: { data: AcademyData; onTab: (tab: Tab) => void }) {
  const today = toIsoDate();
  const leads = live(data.l).filter((lead) => !isTerminalLead(lead) && leadBucket(lead) !== "next");
  const due = leads.filter((lead) => leadFollowupDate(lead) && leadFollowupDate(lead) <= today).sort((a, b) => leadFollowupDate(a).localeCompare(leadFollowupDate(b)));
  const unscheduledAll = leads.filter((lead) => !leadFollowupDate(lead));
  const unscheduled = unscheduledAll.slice(0, 5);
  const contactActions = (phone?: string) => {
    if (!phone) return null;
    const tel = phone.replace(/[^+\d]/g, "");
    return <div className="entity-card__actions"><a className="btn btn--ghost btn--small" href={`tel:${tel}`}>اتصال سريع</a><button className="btn btn--ghost btn--small" onClick={() => safeCopy(phone)}>نسخ الرقم</button></div>;
  };
  return <section className="section"><div className="section-head"><div><h2>متابعات الليدز</h2><p>متابعات النهارده والمتأخرة، مع سبب واضح عند عدم وجود موعد.</p></div><button className="btn btn--ghost btn--small" onClick={() => onTab("leads")}>فتح الليدز</button></div>{due.length ? <div className="card-list">{due.slice(0, 8).map((lead) => { const followup = leadFollowupDate(lead); return <div className="entity-card" key={lead.id}><div className="entity-card__top"><div><h3>{lead.n || lead.ph || "ليد بدون اسم"}</h3><p>{followup < today ? `متأخرة من ${formatDate(followup)}` : "مستحقة النهارده"}{lead.nt ? ` · ${lead.nt}` : ""}</p></div><span className={`tag ${followup < today ? "tag--danger" : "tag--warning"}`}>{lead.st || leadCategory(lead)}</span></div>{contactActions(lead.ph)}</div>; })}</div> : <div className="empty">لا توجد متابعة مستحقة اليوم.</div>}{unscheduledAll.length > 0 && <div className="lead-unscheduled"><div className="section-head"><div><h3>{unscheduledAll.length} ليد بدون موعد متابعة</h3><p>الحالة أو الملاحظة الحالية توضح سبب احتياجهم لتحديد موعد.</p></div></div><div className="card-list">{unscheduled.map((lead) => <div className="entity-card" key={lead.id}><div className="entity-card__top"><div><h3>{lead.n || lead.ph || "ليد بدون اسم"}</h3><p>لا يوجد موعد متابعة محدد · السبب: {lead.followupReason?.trim() || "غير مسجل"}{lead.nt?.trim() ? ` · الملاحظة: ${lead.nt.trim()}` : ""}</p></div><span className="tag tag--warning">بدون موعد</span></div>{contactActions(lead.ph)}</div>)}</div></div>}</section>;
}
function GroupOccupancyPanel({ data, onTab }: { data: AcademyData; onTab: (tab: Tab) => void }) {
  const rows = activeGroups(data).filter((group) => !group.p && !isTeacherNameArchived(data, group.tc)).map((group) => {
    const count = activeStudentsOf(data, group.id).length;
    const rawCapacity = Number(group.capacity ?? 0);
    const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 0;
    return { group, count, capacity, remaining: capacity > 0 ? Math.max(0, capacity - count) : null };
  }).sort((a, b) => {
    const aPriority = a.count <= 2 || (a.remaining !== null && a.remaining <= 2) ? 1 : 0;
    const bPriority = b.count <= 2 || (b.remaining !== null && b.remaining <= 2) ? 1 : 0;
    return bPriority - aPriority || (b.capacity ? b.count / b.capacity : 0) - (a.capacity ? a.count / a.capacity : 0);
  });
  const priorityCount = rows.filter((row) => row.count <= 2 || (row.remaining !== null && row.remaining <= 2)).length;
  return <section className="section"><div className="section-head"><div><h2>إشغال كل الجروبات</h2><p>الأماكن المتاحة حسب السعة التي تحددها الإدارة؛ يظهر تنبيه للجروب القريب من الامتلاء أو الذي عدد طلابه قليل.</p></div><button className="btn btn--ghost btn--small" onClick={() => onTab("groups")}>إدارة الجروبات</button></div>{rows.length ? <><div className="tag tag--muted">{rows.length} جروب · {priorityCount} يحتاج مراجعة</div><div className="card-list">{rows.slice(0, 20).map(({ group, count, capacity, remaining }) => {
    const low = count <= 2;
    const full = remaining === 0;
    const near = remaining !== null && remaining > 0 && remaining <= 2;
    return <div className={`occupancy-row ${full ? "group-capacity--full" : near || low ? "group-capacity--near" : ""}`} key={group.id}><div><strong>{groupLabel(group)}</strong><small>{capacity ? `${count} من ${capacity} · ${remaining === 0 ? "مكتمل" : `متاح ${remaining} مقعد`}` : `${count} طالب · لم تُحدد سعة الجروب`}{low ? " · عدد طلاب قليل" : near ? " · قرب الامتلاء" : ""}</small></div><div className="group-capacity__track">{capacity > 0 ? <span style={{ width: `${Math.min(100, Math.round(count / capacity * 100))}%` }} /> : <span style={{ width: "0%" }} />}</div></div>;
  })}</div>{rows.length > 20 && <div className="notice">يعرض أول 20 جروبًا حسب الأولوية؛ افتح إدارة الجروبات لرؤية الباقي.</div>}</> : <div className="empty">لا توجد جروبات نشطة حاليًا.</div>}</section>;
}
function QuickAction({ icon: Icon, title, description, onClick }: { icon: typeof Users; title: string; description: string; onClick: () => void }) { return <button className="entity-card" onClick={onClick}><div className="entity-card__top"><div><h3>{title}</h3><p>{description}</p></div><Icon color="#3e928d" size={20} /></div></button>; }

function TodaySummary({ data, profile, onTab }: { data: AcademyData; profile: Profile; onTab: (tab: Tab) => void }) {
  const date = toIsoDate();
  const groups = activeGroups(data).filter((group) =>
    !isTeacherNameArchived(data, group.tc) && (profile.role !== "teacher" || normalise(group.tc) === normalise(profile.teacherName)) && scheduledOnDate(group, date)
  );
  const rows = groups.flatMap((group) => studentsOf(data, group.id).map((student) => ({ group, student, record: attendanceFor(data, date, group.id, student.id) })));
  const missing = rows.filter((row) => !row.record || !["present", "absent"].includes(String(row.record.status))).length;
  const absent = rows.filter((row) => row.record?.status === "absent").length;
  const due = deriveNotices(data, profile.role, profile.teacherName).filter((notice) => notice.kind !== "round").length;
  return <div className="stack">
    <div className="today-summary-grid">
      <button className="today-stat" onClick={() => onTab("report")}><strong>{groups.length}</strong><span>جلسات اليوم</span></button>
      <button className="today-stat" onClick={() => onTab("attendance")}><strong>{missing}</strong><span>خانة حضور بلا علامة</span></button>
      <button className="today-stat" onClick={() => onTab("report")}><strong>{absent}</strong><span>طالب غائب</span></button>
    </div>
    <div className="entity-card"><div className="entity-card__top"><div><h3>{due} متابعة مستحقة</h3><p>ليدز وطلاب يحتاجون إلى تواصل.</p></div><BellRing color="#3e928d" size={19} /></div></div>
    {groups.map((group) => {
      const roster = activeStudentsOf(data, group.id).filter((student) => !isListedInFormerCustomers(student, data));
      const unfinished = roster.filter((student) => !attendanceFor(data, date, group.id, student.id)?.status).length;
      const title = group.p ? privateStudentLabel(group, data) : groupLabel(group);
      return <button className="entity-card today-group" key={group.id} onClick={() => onTab("attendance")}>
        <span className="group-choice__colour" style={{ background: colourForGroup(group) }} />
        <span className="grow"><strong>{title}</strong><small>{group.p ? "Private" : "جروب"} · {group.tc || "بدون مدرس"} · {groupTime(group)} · {unfinished ? `${unfinished} بلا علامة` : "الحضور مكتمل"}</small></span>
        <ChevronDown size={16} />
      </button>;
    })}
    {!groups.length && <div className="empty">لا توجد جروبات أو جلسات Private مجدولة اليوم.</div>}
  </div>;
}

function FormerStudentsPanel({ data, commit, former }: { data: AcademyData; commit: Commit; former: { student: Student; group: AcademyGroup }[] }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="section"><div className="section-head"><div><h2>طلاب سابقون يحتاجون متابعة</h2><p>طلاب جروبات منتهية أو موقوفة، ولا يوجد لهم قيد حالي بنفس الرقم.</p></div><button className="btn btn--ghost btn--small" onClick={() => setExpanded((value) => !value)}>{expanded ? "إخفاء" : `عرض ${former.length}`}</button></div>{expanded && <div className="card-list">{former.slice(0, 30).map(({ student, group }, index) => <div className="entity-card" key={student.id}><div className="entity-card__top"><div><h3>{student.n || "طالب بدون اسم"}</h3><p>{group.p ? "Private" : roundName(data.r.find((round) => round.id === group.r))} · {displayGroupLabel(group, data)}{group.e ? ` · انتهى ${formatDate(group.e)}` : ""}</p><div className="entity-card__meta"><span className="tag tag--muted">{studentKindLabel(studentKind(student))}</span><span className="tag tag--muted">المصدر: {studentSourceLabel(student)}</span></div></div><span className="tag tag--warning">متابعة قديمة</span></div>{student.ph && <div className="entity-card__actions"><button className="btn btn--ghost btn--small" onClick={() => safeCopy(student.ph ?? "")}>نسخ الرقم</button></div>}<FollowupControls record={student} data={data} onSave={(date, note) => commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) saveFollowup(target, date, note); }, "تم حفظ متابعة الطالب السابق.")} /></div>)}{!former.length && <div className="empty">لا توجد طلاب سابقون مستحقون للمتابعة حاليًا.</div>}</div>}</section>;
}

function ReportView({ data, profile, onOpenAttendance }: { data: AcademyData; profile: Profile; onOpenAttendance: (id?: string) => void }) {
  const [date, setDate] = useState(toIsoDate());
  const operationalGroups = activeGroups(data).filter((group) => !isTeacherNameArchived(data, group.tc));
  const groupScope = operationalGroups.filter((group) => !group.p && (profile.role !== "teacher" || normalise(group.tc) === normalise(profile.teacherName)));
  const groups = groupScope.filter((group) => scheduledOnDate(group, date));
  const rows = groups.flatMap((group) => studentsOf(data, group.id).map((student) => ({ group, student, record: attendanceFor(data, date, group.id, student.id) })));
  const absent = rows.filter((row) => row.record?.status === "absent").length;
  const present = rows.filter((row) => row.record?.status === "present").length;
  const missing = rows.filter((row) => !row.record || !["present", "absent"].includes(String(row.record.status))).length;
  const risks = absenceRisks(data, groupScope, date);
  const allAssignedGroups = operationalGroups.filter((group) => profile.role !== "teacher" || normalise(group.tc) === normalise(profile.teacherName));
  const dailySessions = allAssignedGroups.flatMap((group) => {
    const explicit = sessionColumns(group, data).filter((session) => String(session.d ?? session.k).slice(0, 10) === date);
    if (explicit.length) return explicit.map((session) => ({ group, session, cancelled: Boolean(session.c) }));
    return scheduledOnDate(group, date) ? [{ group, session: { d: date, k: date }, cancelled: false }] : [];
  }).sort((a, b) => String(a.group.t1 ?? "").localeCompare(String(b.group.t1 ?? "")) || groupLabel(a.group).localeCompare(groupLabel(b.group), "ar"));
  return <><PageHead title="تقرير اليوم" description="جلسات التاريخ المحدد وحالات الحضور والخانات التي ما زالت بلا علامة." actions={<button className="btn" onClick={() => onOpenAttendance()}>فتح الحضور والغياب</button>} />
    <section className="section"><div className="toolbar"><label className="field"><span>تاريخ التقرير</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="btn btn--ghost btn--small" onClick={() => setDate(toIsoDate())}>اليوم</button><span className="tag tag--muted">{formatDate(date, true)}</span></div></section>
    <div className="metric-grid"><Metric icon={CalendarDays} value={groups.length} label="جلسات اليوم" /><Metric icon={Check} value={present} label="حاضر" /><Metric icon={X} value={absent} label="غائب" /><Metric icon={ClipboardCheck} value={missing} label="خانات بلا علامة" /><Metric icon={BellRing} value={risks.length} label={`في خطر (${ABSENCE_LIMIT}+ غياب)`} /></div>
    <section className="section risk-section"><div className="section-head"><div><h2>طلاب في خطر الغياب</h2><p>من غابوا {ABSENCE_LIMIT} جلسات أو أكثر منذ بداية الجروب حتى {formatDate(date)}.</p></div><span className="tag tag--danger">{risks.length} طالب</span></div>{risks.length ? <div className="card-list">{risks.map(({ group, student, absent: absenceCount, held }) => <div className="entity-card" key={`${group.id}:${student.id}`}><div className="entity-card__top"><div><h3>{student.n || "طالب بدون اسم"}</h3><p>{groupLabel(group)} · حضر/لديه {held} جلسة</p></div><span className="tag tag--danger">غاب {absenceCount} من {held}</span></div><div className="entity-card__actions">{student.ph && <button className="btn btn--ghost btn--small" onClick={() => safeCopy(student.ph ?? "")}>نسخ الرقم</button>}<button className="btn btn--ghost btn--small" onClick={() => onOpenAttendance(group.id)}>جدول الغياب</button></div></div>)}</div> : <div className="empty">لا يوجد طالب وصل إلى حد الغياب الحالي.</div>}</section>
    <section className="section"><div className="section-head"><div><h2>الجروبات المجدولة</h2><p>القائمة المعتادة للجروبات والغياب كما هي؛ تفاصيل كل جلسات اليوم تضاف في الجدول التالي.</p></div></div><div className="card-list">{groups.map((group) => { const groupRows = rows.filter((row) => row.group.id === group.id); const noMark = groupRows.filter((row) => !row.record?.status); const absentees = groupRows.filter((row) => row.record?.status === "absent"); return <div className="entity-card" key={group.id}><div className="entity-card__top"><div><span className="tag tag--muted">جروب</span><h3>{groupLabel(group)}</h3><p>{groupRows.length} طالب · {noMark.length} بلا علامة · {absentees.length} غائب</p></div><button className="btn btn--ghost btn--small" onClick={() => onOpenAttendance(group.id)}>جدول الغياب</button></div>{absentees.length > 0 && <div className="notice-row"><strong>غياب يحتاج متابعة</strong><div className="card-list">{absentees.map(({ student }) => <div className="entity-card__actions" key={student.id}><span>{student.n || "طالب بدون اسم"}</span>{student.ph && <button className="btn btn--ghost btn--small" onClick={() => safeCopy(student.ph ?? "")}>نسخ الرقم</button>}</div>)}</div></div>}</div>; })}{!groups.length && <div className="empty">لا توجد جلسات جروبات في التاريخ المحدد.</div>}</div></section>
    <section className="section daily-sessions-section"><div className="section-head"><div><h2>كل جلسات المدرسين والجروبات والـPrivate</h2><p>إضافة على التقرير المعتاد: كل جلسة في {formatDate(date, true)} مع المدرس والوقت، بما فيها الجلسات الملغاة.</p></div><span className="tag tag--muted">{dailySessions.length} جلسة</span></div>{dailySessions.length ? <div className="teacher-sessions-wrap daily-sessions-wrap"><table className="daily-sessions-table"><thead><tr><th>الوقت</th><th>المدرس</th><th>النوع</th><th>الجروب / الطالب</th><th>عدد الطلاب</th><th>الحالة والحضور</th><th></th></tr></thead><tbody>{dailySessions.map(({ group, session, cancelled }, index) => { const roster = activeStudentsOf(data, group.id).filter((student) => !isListedInFormerCustomers(student, data)); const presentCount = roster.filter((student) => attendanceFor(data, date, group.id, student.id)?.status === "present").length; const absentCount = roster.filter((student) => attendanceFor(data, date, group.id, student.id)?.status === "absent").length; const title = group.p ? privateStudentLabel(group, data) : [roundName(data.r.find((round) => round.id === group.r)), group.lv].filter(Boolean).join(" · "); return <tr key={`${group.id}:${String(session.d ?? session.k)}:${index}`} className={cancelled ? "teacher-session-cancelled" : ""}><td>{groupTime(group) || "—"}</td><td>{group.tc || "—"}</td><td>{group.p ? "Private" : "جروب"}</td><td className="daily-session-name">{title || "بدون اسم"}</td><td>{group.p ? "1" : roster.length}</td><td>{cancelled ? <span className="tag tag--danger">ملغاة</span> : <span>{presentCount} حاضر · {absentCount} غائب</span>}</td><td><button className="btn btn--ghost btn--small" onClick={() => onOpenAttendance(group.id)}>الحضور</button></td></tr>; })}</tbody></table></div> : <div className="empty">لا توجد جلسات مسجلة لهذا التاريخ.</div>}</section>
  </>;
}

type Commit = (mutate: (draft: AcademyData) => void, message?: string) => void;

function GroupsView({ data, profile, teacherAccounts, isPrivate, selectedGroup, onSelected, onOpenAttendance, commit }: { data: AcademyData; profile: Profile; teacherAccounts: TeacherAccount[]; isPrivate: boolean; selectedGroup: string; onSelected: (id: string) => void; onOpenAttendance: (id?: string) => void; commit: Commit }) {
  const [addMode, setAddMode] = useState(false);
  const [roundFilter, setRoundFilter] = useState(data.cur);
  const [roundMonth, setRoundMonth] = useState(monthKey());
  useEffect(() => { if (data.cur && roundFilter) setRoundFilter(data.cur); }, [data.cur]);
  useEffect(() => { if (!selectedGroup) return; const selected = data.g.find((group) => group.id === selectedGroup); if (selected && !selected.p) { setRoundMonth(selected.s?.slice(0, 7) || monthKey()); setRoundFilter(selected.r); } }, [selectedGroup, data.g]);
  const activeRound = data.r.find((round) => round.id === data.cur && !round.x) ?? live(data.r).find((round) => !round.pl);
  const rounds = live(data.r).filter((round) => !round.pl);
  const monthRoundIds = [...new Set(nonArchivedGroups(data).filter((group) => !group.p && teacherSessionsForMonth([group], roundMonth).some(({ session }) => !session.c)).map((group) => group.r))].filter((id) => rounds.some((round) => round.id === id));
  const selectedRoundFilter = monthRoundIds.includes(roundFilter) ? roundFilter : "";
  const monthRoundName = (id: string) => roundName(data.r.find((round) => round.id === id));
  const groups = nonArchivedGroups(data).filter((group) => {
    if (profile.role !== "teacher" && Boolean(group.p) !== isPrivate) return false;
    if (isPrivate) {
      const students = live(data.m).filter((student) => student.g === group.id);
      if (students.length && students.every((student) => !isActiveStudentEnrollment(student, data) || isListedInFormerCustomers(student, data))) return false;
    }
    if (profile.role === "teacher") {
      if (!group.p && !isRoundActive(data, group.r)) return false;
      if (isTeacherNameArchived(data, group.tc) || normalise(group.tc) !== normalise(profile.teacherName)) return false;
    } else if (!isPrivate) {
      if (!teacherSessionsForMonth([group], roundMonth).some(({ session }) => !session.c)) return false;
      if (selectedRoundFilter && group.r !== selectedRoundFilter) return false;
    }
    return true;
  }).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), "ar"));
  const canEdit = profile.role !== "teacher";
  const privateAddAction = isPrivate ? <button className="btn btn--icon private-add-icon" title="إضافة Private" aria-label="إضافة Private" onClick={() => setAddMode(true)}><Plus size={19} /></button> : <button className="btn" onClick={() => setAddMode((open) => !open)}><Plus size={16} />إضافة جروب</button>;
  return <><PageHead title={isPrivate ? "البرايفت" : profile.role === "teacher" ? "جروباتي" : "المجموعات والراوندات"} description={profile.role === "teacher" ? "جروباتك والطلاب الخاصون المسندون إليك، مع بيانات كل طالب مباشرة." : isPrivate ? "كل Private جروب لطالب واحد؛ الاسم والمستوى والهاتف وبيانات الموعد ظاهرة مباشرة، والجلسات والحضور في التبويب المخصص." : "جروبات الراوند المحدد، الطلاب، المواعيد والمدفوعات."} actions={canEdit ? privateAddAction : undefined} />
    {!isPrivate && canEdit && <RoundControl data={data} commit={commit} />}
    {!isPrivate && canEdit && <section className="section"><div className="toolbar month-round-simple-filter"><label className="field"><span>الشهر</span><input type="month" value={roundMonth} onChange={(event) => { setRoundMonth(event.target.value); setRoundFilter(""); }} /></label><label className="field"><span>الراوند</span><select className="search-input" value={selectedRoundFilter} onChange={(event) => setRoundFilter(event.target.value)}><option value="">كل راوندات الشهر</option>{monthRoundIds.map((id) => { const round = rounds.find((item) => item.id === id); return <option key={id} value={id}>{monthRoundName(id)}{round?.on === false ? " · موقوف" : ""}</option>; })}</select></label></div>{!monthRoundIds.length && <p className="quality-more">لا توجد راوندات لها جلسات مجدولة في هذا الشهر.</p>}</section>}
    {addMode && (isPrivate ? <Overlay className="private-form-overlay" onClose={() => setAddMode(false)}><div className="private-form-dialog"><GroupForm data={data} profile={profile} teacherAccounts={teacherAccounts} isPrivate onCancel={() => setAddMode(false)} commit={commit} /></div></Overlay> : <GroupForm data={data} profile={profile} teacherAccounts={teacherAccounts} isPrivate={false} onCancel={() => setAddMode(false)} commit={commit} />)}
    {!groups.length ? <section className="section"><div className="empty">لا توجد {isPrivate ? "طلاب Private" : "جروبات"} مطابقة حاليًا.</div></section> : groups.map((group, index) => group.p ? <PrivateStudentEntry key={group.id} group={group} data={data} profile={profile} teacherAccounts={teacherAccounts} toneOffset={index} commit={commit} /> : <GroupAccordion key={group.id} group={group} data={data} profile={profile} teacherAccounts={teacherAccounts} open={selectedGroup === group.id} onOpen={(open) => onSelected(open ? group.id : "")} onOpenAttendance={onOpenAttendance} commit={commit} />)}
    {isPrivate && canEdit && <ArchivedPrivateRecords data={data} commit={commit} />}
    {!isPrivate && canEdit && activeRound && <div className="notice">الراوند الحالي: {roundName(activeRound)}. يمكنك اختيار «كل الراوندات النشطة» لعرض غيره.</div>}
  </>;
}

function RoundControl({ data, commit }: { data: AcademyData; commit: Commit }) {
  const [newRoundName, setNewRoundName] = useState("");
  const [editRoundName, setEditRoundName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const rounds = live(data.r).filter((round) => !round.pl);
  const current = rounds.find((round) => round.id === data.cur) ?? rounds[0];
  useEffect(() => { setEditingName(false); setEditRoundName(current?.n ?? ""); }, [data.cur, current?.n]);
  const archive = () => {
    if (!current || !window.confirm(`أرشفة الراوند «${roundName(current)}»؟ تظل البيانات محفوظة ويمكن استعادتها من الأرشيف.`)) return;
    commit((draft) => { const target = draft.r.find((round) => round.id === current.id); if (target) { target.x = 1; target.xa = Date.now(); } const next = draft.r.find((round) => round.id !== current.id && !round.x && !round.pl); draft.cur = next?.id ?? ""; }, "تمت أرشفة الراوند.");
  };
  return <section className="section"><div className="section-head"><div><h2>إدارة الراوندات</h2><p>اختر الراوند الحالي أو أوقفه أو غيّر اسمه؛ الأرشفة لا تحذف بياناته.</p></div></div>
    <div className="toolbar"><select className="search-input" value={current?.id ?? ""} onChange={(event) => commit((draft) => { draft.cur = event.target.value; }, "تم اختيار الراوند الحالي.")}>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select>
      <input className="search-input" placeholder="اسم راوند جديد" value={newRoundName} onChange={(event) => setNewRoundName(event.target.value)} />
      <button className="btn btn--ghost" onClick={() => { const value = newRoundName.trim(); if (!value) return; const id = uid(); commit((draft) => { draft.r.push({ id, n: value, on: true, createdAt: Date.now() }); draft.cur = id; }, "تمت إضافة الراوند."); setNewRoundName(""); }}><Plus size={15} />إضافة راوند</button>
      {current && <>
        <button className="btn btn--ghost" onClick={() => setEditingName((value) => !value)}>{editingName ? "إلغاء تعديل الاسم" : "تعديل الاسم"}</button>
        <button className="btn btn--ghost" onClick={() => commit((draft) => { const target = draft.r.find((round) => round.id === current.id); if (target) target.on = target.on === false; }, current.on === false ? "تم تفعيل الراوند." : "تم إيقاف الراوند.")}>{current.on === false ? "تفعيل الراوند" : "إيقاف الراوند"}</button>
        <button className="btn btn--ghost btn--danger" onClick={archive}>أرشفة الراوند</button>
      </>}
    </div>
    {editingName && current && <div className="toolbar"><input className="search-input" aria-label="اسم الراوند" value={editRoundName} onChange={(event) => setEditRoundName(event.target.value)} /><button className="btn" onClick={() => { const value = editRoundName.trim(); if (!value) return; commit((draft) => { const target = draft.r.find((round) => round.id === current.id); if (target) target.n = value; }, "تم حفظ اسم الراوند."); setEditingName(false); }}>حفظ الاسم</button></div>}
  </section>;
}

function GroupForm({ data, profile, teacherAccounts, isPrivate, onCancel, commit }: { data: AcademyData; profile: Profile; teacherAccounts: TeacherAccount[]; isPrivate: boolean; onCancel: () => void; commit: Commit }) {
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupFeedback, setLookupFeedback] = useState("");
  const [loadedStudent, setLoadedStudent] = useState<Student | null>(null);
  const [studentPhone, setStudentPhone] = useState("");
  const [studentLevel, setStudentLevel] = useState("");
  const [studentLevelCount, setStudentLevelCount] = useState("1");
  const [studentKind, setStudentKind] = useState<StudentKind>("new");
  const [studentSource, setStudentSource] = useState("");
  const [studentSourceOther, setStudentSourceOther] = useState("");
  const [days, setDays] = useState("السبت والثلاثاء");
  const [teacher, setTeacher] = useState("");
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("18:00");
  const [startDate, setStartDate] = useState(toIsoDate());
  const [endDate, setEndDate] = useState("");
  const [capacity, setCapacity] = useState("");
  const [formError, setFormError] = useState("");
  const [round, setRound] = useState(data.cur);
  const teachers = useMemo(() => teacherNames(data, teacherAccounts), [data, teacherAccounts]);
  const loadPrivateStudent = () => {
    const value = lookup.trim();
    if (!value) { setLookupFeedback("اكتب كود SPK أو جزءًا من رقم الهاتف."); return; }
    const phoneNeedle = personPhone(value);
    const matches = live(data.m).filter((student) => matchesStudentCode(studentCodeFor(student), value)
      || (!isStudentCodeQuery(value) && phoneNeedle.length >= 3 && personPhone(student.ph).includes(phoneNeedle)))
      .filter((student, index, all) => !all.slice(0, index).some((other) => sameStudentIdentity(other, student)))
      .sort((a, b) => Number(isActiveStudentEnrollment(b, data)) - Number(isActiveStudentEnrollment(a, data)));
    if (!matches.length) { setLoadedStudent(null); setLookupFeedback("لم أجد سجلًا بهذا الكود أو جزء الهاتف."); return; }
    if (matches.length > 1 && isActiveStudentEnrollment(matches[0], data) === isActiveStudentEnrollment(matches[1], data)) {
      setLoadedStudent(null); setLookupFeedback(`وجدت ${matches.length} سجلات محتملة. استخدم رقمًا أطول لتحديد الطالب بدقة.`); return;
    }
    const student = matches[0];
    setLoadedStudent(student);
    setName(student.n ?? ""); setStudentPhone(student.ph ?? ""); setStudentLevel(student.lv ?? "");
    setStudentKind(student.kind === "new" || student.kind === "old" || student.kind === "returned" ? student.kind : student.nw ? "new" : "old"); setStudentSource(student.source ?? ""); setStudentSourceOther(student.sourceOther ?? "");
    setLookupFeedback(`تم جلب بيانات ${student.n || "الطالب"} (${student.studentCode || studentCodeFor(student)}).`);
    setFormError("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const privateIncomplete = isPrivate && (!studentPhone.trim() || !studentLevel || !endDate || endDate < startDate || start >= end);
    if (!name.trim() || !teacher.trim() || privateIncomplete) {
      setFormError(isPrivate ? "اكمل اسم الطالب ورقمه ومستواه وأيام وموعد ومدرس وتاريخ بداية ونهاية صحيحين." : "اختر مستوى الجروب والمدرس قبل الحفظ.");
      return;
    }
    const privateCandidate: PersonRecord = { id: loadedStudent?.id ?? "new-private", profileId: loadedStudent?.profileId || loadedStudent?.id, n: name.trim(), ph: studentPhone.trim() };
    if (isPrivate && hasActiveStudentEnrollment(privateCandidate, data)) {
      setFormError("الطالب موجود بالفعل في جروب شغال. استخدم بطاقة الطالب أو انتظر انتهاء تسجيله قبل إنشاء Private جديد.");
      return;
    }
    if (isPrivate) {
      const planned = generateSessions({ id: "private-plan", r: "pv", p: 1, lv: name.trim(), d: days, tc: teacher.trim(), t1: start, t2: end, s: startDate, e: endDate, ss: null });
      if (planned.length < 8) {
        const eighthDate = generateSessions({ id: "private-plan", r: "pv", p: 1, lv: name.trim(), d: days, tc: teacher.trim(), t1: start, t2: end, s: startDate, e: undefined, ss: null }).at(7)?.d;
        setFormError(`الفترة المحددة تسمح بـ${planned.length} جلسات فقط. اجعل تاريخ النهاية ${eighthDate ? `في ${formatDate(eighthDate)} أو بعده` : "أبعد"} لإكمال 8 جلسات.`);
        return;
      }
    }
    const id = uid();
    const group: AcademyGroup = { id, r: isPrivate ? "pv" : round, p: isPrivate ? 1 : 0, lv: name.trim(), d: days, tc: teacher.trim(), t1: start, t2: end, s: startDate, e: endDate, ss: null, ...(!isPrivate && Number(capacity) > 0 ? { capacity: Number(capacity) } : {}) };
    const conflicts = (isPrivate || isRoundActive(data, round)) ? teacherScheduleConflicts(activeGroups(data), group) : [];
    if (conflicts.length) {
      const message = `يوجد ${conflicts.length} تعارض في موعد المدرس ${teacher.trim()} مع: ${conflicts.slice(0, 3).map((item) => groupLabel(item.second)).join("؛ ")}${conflicts.length > 3 ? "؛ وجروبات أخرى" : ""}.`;
      setFormError(message);
      if (!window.confirm(`${message}\n\nهل تريد الحفظ رغم التعارض؟`)) return;
    }
    commit((draft) => {
      draft.g.push(group);
      if (isPrivate) { const studentId = uid(); const historical = draft.m.find((student) => loadedStudent && student.id === loadedStudent.id) ?? draft.m.find((student) => samePerson(privateCandidate, student)); const kind = historical && studentKind === "new" ? "returned" : studentKind; draft.m.push({ id: studentId, profileId: historical?.profileId || historical?.id || studentId, studentCode: historical?.studentCode || (historical ? studentCodeFor(historical) : undefined), enrollmentType: "private", g: id, r: "pv", n: name.trim(), ph: studentPhone.trim(), lv: studentLevel, kind, subscriptionClass: historical ? "renewal" : studentKind === "new" ? "new" : "renewal", source: studentSource || historical?.subscriptionSource || historical?.source || "", subscriptionSource: studentSource || historical?.subscriptionSource || historical?.source || "", sourceOther: studentSourceOther.trim() || historical?.sourceOther || "", nw: kind === "new" ? 1 : 0, pay: 0, ren: 0, lvPaid: profile.role === "owner" ? Number(studentLevelCount) : 1 }); draft.l.filter((lead) => !lead.x && samePerson(privateCandidate, lead)).forEach((lead) => { lead.x = 1; lead.xa = Date.now(); }); }
    }, isPrivate ? "تم إنشاء جروب Private للطالب." : "تمت إضافة الجروب.");
    onCancel();
  };
  return <section className="section">
    <div className="section-head"><div><h2>{isPrivate ? "إضافة Private" : "إضافة جروب"}</h2><p>{isPrivate ? "ينشأ جروب بعنوان اسم الطالب، ويضم طالبًا واحدًا مع بيانات المستوى والهاتف والأيام والمدرس والموعد والفترة." : "اختر مستوى الجروب والمدرس من القوائم المعتمدة؛ سيظهر الموعد ككتلة واحدة من البداية للنهاية."}</p></div><button className="btn btn--ghost btn--icon" onClick={onCancel} aria-label="إلغاء"><X size={17} /></button></div>
    <form className="grid-form" onSubmit={submit}>
      {isPrivate && <div className="field span-2"><label htmlFor="private-student-lookup">جلب بيانات طالب موجود</label><div className="toolbar"><input id="private-student-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); loadPrivateStudent(); } }} placeholder="كود SPK أو جزء من رقم الهاتف" /><button type="button" className="btn btn--ghost" onClick={loadPrivateStudent}>جلب البيانات</button></div>{lookupFeedback && <small role="status">{lookupFeedback}</small>}</div>}
      <div className="field"><label>{isPrivate ? "اسم الطالب واسم الجروب" : "مستوى الجروب"}</label>{isPrivate ? <input value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} required /> : <select value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} required><option value="">اختر المستوى</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select>}</div>
      {isPrivate && <><div className="field"><label>هاتف الطالب</label><input dir="ltr" value={studentPhone} onChange={(event) => setStudentPhone(event.target.value)} required /><small>رقم واحد للطالب صاحب هذا الجروب.</small></div><div className="field"><label>مستوى الطالب</label><select value={studentLevel} onChange={(event) => setStudentLevel(event.target.value)} required><option value="">اختر المستوى</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></div><div className="field"><label>تصنيف الطالب</label><select value={studentKind} onChange={(event) => setStudentKind(event.target.value as StudentKind)}><option value="new">جديد</option><option value="old">قديم</option><option value="returned">قديم رجع بعد انقطاع</option></select></div><div className="field"><label>مصدر الطالب</label><select value={studentSource} onChange={(event) => setStudentSource(event.target.value)}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></div>{studentSource === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={studentSourceOther} onChange={(event) => setStudentSourceOther(event.target.value)} /></div>}{profile.role === "owner" && <div className="field"><label>عدد الليفلات المدفوعة للطالب</label><select value={studentLevelCount} onChange={(event) => setStudentLevelCount(event.target.value)}>{LEVEL_COUNTS.map((count) => <option key={count} value={count}>{count} ليفل مدفوع</option>)}</select></div>}</>}
      <div className="field"><label>الأيام</label><select value={days} onChange={(event) => setDays(event.target.value)} required={isPrivate}><option>السبت والثلاثاء</option><option>الأحد والأربعاء</option><option>الاثنين والخميس</option></select></div>
      <div className="field"><label>المدرس</label><select value={teacher} onChange={(event) => { setTeacher(event.target.value); setFormError(""); }} required><option value="">{teachers.length ? "اختر المدرس" : "أضف مدرسًا أولًا من ساعات المدرسين"}</option>{teachers.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      {!isPrivate && <><div className="field"><label>الراوند</label><select value={round} onChange={(event) => setRound(event.target.value)}>{live(data.r).filter((item) => !item.pl).map((item) => <option key={item.id} value={item.id}>{roundName(item)}</option>)}</select></div><div className="field"><label>سعة الجروب (اختياري)</label><input type="number" min="1" max="100" value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="بدون حد محدد" /></div></>}
      <div className="field"><label>من</label><input type="time" value={start} onChange={(event) => setStart(event.target.value)} required={isPrivate} /></div>
      <div className="field"><label>إلى</label><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} required={isPrivate} /></div>
      <div className="field"><label>تاريخ البداية</label><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required={isPrivate} /></div>
      <div className="field"><label>تاريخ النهاية</label><input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setFormError(""); }} required={isPrivate} /></div>
      {formError && <div className="notice notice--warning span-2" role="alert">{formError}</div>}
      <button className="btn" type="submit"><Plus size={16} />{isPrivate ? "حفظ Private" : "حفظ الجروب"}</button>
    </form>
  </section>;
}

function GroupAccordion({ group, data, profile, teacherAccounts, open, onOpen, onOpenAttendance, commit }: { group: AcademyGroup; data: AcademyData; profile: Profile; teacherAccounts: TeacherAccount[]; open: boolean; onOpen: (open: boolean) => void; onOpenAttendance: (id?: string) => void; commit: Commit }) {
  const roster = activeStudentsOf(data, group.id); const [edit, setEdit] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const summaryRef = useRef<HTMLElement | null>(null);
  const capacity = Number(group.capacity ?? 0);
  const remainingSeats = capacity > 0 ? Math.max(0, capacity - roster.length) : null;
  const endDate = plannedGroupEndDate(group);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, group.id]);
  return <details id={`group-record-${group.id}`} className="accordion" open={open} onToggle={(event) => { const isOpen = (event.currentTarget as HTMLDetailsElement).open; if (isOpen) onOpen(true); else if (open) onOpen(false); }}><summary ref={summaryRef} className="accordion__summary"><span className="group-choice__colour" style={{ background: colourForGroup(group) }} /><div className="grow"><h3>{group.p ? "Private · " : ""}{group.lv || "بدون اسم"}</h3><span className="phone">{group.d} · {groupTime(group)} · {teacherDisplayName(data, group.tc)}</span></div><span className="group-end-date"><CalendarDays size={14} />{endDate ? `ينتهي ${formatDate(endDate)}` : "تاريخ النهاية غير محدد"}</span><span className="tag">{roster.length} طالب{capacity > 0 ? ` / ${capacity}` : ""}</span><ChevronDown size={17} /></summary><div className="accordion__body">
    {capacity > 0 && <div className={`group-capacity ${remainingSeats === 0 ? "group-capacity--full" : remainingSeats !== null && remainingSeats <= 2 ? "group-capacity--near" : ""}`}><div><strong>إشغال الجروب</strong><span>{roster.length} من {capacity} · {remainingSeats === 0 ? "مكتمل" : `متاح ${remainingSeats} مقعد`}</span></div><div className="group-capacity__track"><span style={{ width: `${Math.min(100, Math.round(roster.length / capacity * 100))}%` }} /></div></div>}
    <div className="toolbar"><span className="tag">{groupTime(group)}</span><span style={{ flex: 1 }} /><button className="btn btn--ghost btn--small" onClick={() => onOpenAttendance(group.id)}>فتح الحضور والغياب</button>{profile.role !== "teacher" && <button className="btn btn--ghost btn--small" onClick={() => setEdit((value) => !value)}>تعديل</button>}{profile.role !== "teacher" && <button className="btn btn--ghost btn--small" onClick={() => { if (!window.confirm(`أرشفة «${group.lv || "الجروب"}»؟ ستظل بياناته قابلة للاستعادة.`)) return; commit((draft) => { const target = draft.g.find((item) => item.id === group.id); if (target) { target.x = 1; target.xa = Date.now(); } }, "تمت أرشفة الجروب."); onOpen(false); }}>أرشفة</button>}{roster.length > 0 && <button className="btn btn--ghost btn--small" onClick={() => safeCopy(roster.map((student) => student.ph).filter(Boolean).join("\n"))}><Copy size={13} />نسخ الأرقام</button>}</div>
    {edit && <EditableGroup group={group} data={data} teacherAccounts={teacherAccounts} commit={commit} onClose={() => setEdit(false)} />}
    <div className="section-head"><div><h2>الطلاب</h2><p>{roster.length ? "يمكن تعديل حالة الدفع والتجديد داخل الجروب." : "أضف أول طالب لهذا الجروب."}</p></div></div>
    <div className="roster">{roster.filter((student) => !isListedInFormerCustomers(student, data)).length ? roster.filter((student) => !isListedInFormerCustomers(student, data)).map((student, index) => <StudentRow key={student.id} student={student} index={index} canEditPayment={profile.role === "owner"} canEditRenewal={profile.role !== "teacher"} commit={commit} data={data} showLevelCount />) : roster.length ? <div className="empty">الطالب ظاهر في تبويب «عملاء الراوند الجاي»؛ سجله الأصلي محفوظ للجروب والإحصائيات.</div> : null}</div>
    {profile.role !== "teacher" && (group.p ? roster.length ? <div className={roster.length > 1 ? "notice notice--warning" : "notice"}>{roster.length > 1 ? "جروب Private قديم مرتبط بأكثر من طالب؛ لم نغيّر السجلات الموجودة. أنشئ جروبًا مستقلًا لكل طالب جديد." : "كل جروب Private لطالب واحد؛ أضف الطالب من زر «إضافة Private» أعلى التبويب."}</div> : <AddStudent group={group} data={data} canEditPayment={profile.role === "owner"} commit={commit} /> : <><button type="button" className="btn btn--ghost btn--small" aria-expanded={showAddStudent} onClick={() => setShowAddStudent((value) => !value)}><Plus size={14} />{showAddStudent ? "إغلاق إضافة طالب" : "إضافة طالب للجروب"}</button>{showAddStudent && <AddStudent group={group} data={data} canEditPayment={profile.role === "owner"} commit={commit} />}</>)}
  </div></details>;
}

function CopyRenewers({ group, students, data, teacherAccounts, commit }: { group: AcademyGroup; students: Student[]; data: AcademyData; teacherAccounts: TeacherAccount[]; commit: Commit }) {
  const [targetRound, setTargetRound] = useState("");
  const rounds = live(data.r).filter((round) => !round.pl && round.id !== group.r);
  const renewers = students.filter((student) => student.ren === 1 || Boolean(student.pre && Number(student.pp) > 0));
  if (group.p && !renewers.length) return null;
  if (!group.p && !rounds.length) return null;
  const copy = () => {
    if (!renewers.length) return;
    if (!canAssignTeacher(data, group.tc ?? "", teacherAccounts)) {
      window.alert("المدرس المسند لهذا الجروب موقوف أو غير موجود في قائمة التعيين. عدّل الجروب واختر مدرسًا نشطًا قبل نسخ الطلاب للراوند الجديد.");
      return;
    }
    if (group.p) {
      if (!window.confirm(`إنشاء ${renewers.length} جروب Private منفصل، طالب واحد في كل جروب؟`)) return;
      commit((draft) => {
        renewers.forEach((student) => {
          const nextGroup: AcademyGroup = { id: uid(), r: "pv", p: 1, lv: student.n || group.lv, d: group.d, t1: group.t1, t2: group.t2, tc: group.tc, s: toIsoDate(), e: undefined, ss: null, c: Array.isArray(group.c) ? [...group.c] : [] };
          nextGroup.ss = generateSessions(nextGroup);
          nextGroup.e = String(nextGroup.ss.at(-1)?.d ?? "");
          draft.g.push(nextGroup);
          { const id = uid(); draft.m.push({ id, profileId: student.profileId || student.id, studentCode: student.studentCode || studentCodeFor(student), enrollmentType: "private", g: nextGroup.id, r: "pv", n: student.n, ph: student.ph, lv: student.lv, kind: studentKind(student) === "new" ? "old" : studentKind(student), subscriptionClass: "renewal", source: student.source ?? "", subscriptionSource: student.subscriptionSource || student.source || "", sourceOther: student.sourceOther ?? "", nw: 0, pay: student.pay ?? 0, amount: student.amount ?? 0, lvPaid: student.lvPaid ?? 1, pn: student.pn ?? "", nt: student.nt ?? "", ren: 0, pre: student.pre, pp: student.pp }); }
        });
      }, "تم إنشاء جروبات Private منفصلة، طالب واحد لكل جروب.");
      return;
    }
    const roundId = targetRound || rounds[0].id;
    if (!window.confirm(`نسخ ${renewers.length} طالب ممن سيجددون إلى جروب جديد في الراوند المختار؟`)) return;
    commit((draft) => {
      const nextGroup: AcademyGroup = { id: uid(), r: roundId, p: 0, lv: group.lv, d: group.d, t1: group.t1, t2: group.t2, tc: group.tc, s: "", e: "", ss: null, c: Array.isArray(group.c) ? [...group.c] : [] };
      draft.g.push(nextGroup);
      renewers.forEach((student) => { const id = uid(); draft.m.push({ id, profileId: student.profileId || student.id, studentCode: student.studentCode || studentCodeFor(student), enrollmentType: "group", g: nextGroup.id, r: roundId, n: student.n, ph: student.ph, lv: student.lv, kind: studentKind(student) === "new" ? "old" : studentKind(student), subscriptionClass: "renewal", source: student.source ?? "", subscriptionSource: student.subscriptionSource || student.source || "", sourceOther: student.sourceOther ?? "", nw: 0, pay: student.pay ?? 0, amount: student.amount ?? 0, lvPaid: student.lvPaid ?? 1, pn: student.pn ?? "", nt: student.nt ?? "", ren: 0, pre: student.pre, pp: student.pp }); });
      draft.cur = roundId;
    }, "تم نسخ الطلاب المحتمل تجديدهم إلى جروب جديد.");
  };
  return <div className="toolbar copy-renewers">{!group.p && <select value={targetRound || rounds[0].id} onChange={(event) => setTargetRound(event.target.value)}>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select>}{(!group.p || renewers.length > 0) && <button className="btn btn--ghost btn--small" disabled={!renewers.length} onClick={copy}>{group.p ? `إنشاء جروبات Private (${renewers.length})` : `نسخ اللي هيجددوا (${renewers.length}) للراوند الجاي`}</button>}</div>;
}
function EditableGroup({ group, student, data, teacherAccounts, commit, onClose }: { group: AcademyGroup; student?: Student; data: AcademyData; teacherAccounts: TeacherAccount[]; commit: Commit; onClose: () => void }) {
  const [draft, setDraft] = useState({ lv: group.lv ?? "", d: group.d ?? "", tc: group.tc ?? "", t1: group.t1 ?? "", t2: group.t2 ?? "", s: group.s ?? "", e: group.e ?? "", capacity: group.capacity ? String(group.capacity) : "" });
  const [studentDraft, setStudentDraft] = useState({ n: student?.n ?? group.lv ?? "", ph: student?.ph ?? "", lv: student?.lv ?? "", nt: student?.nt ?? "", kind: student ? studentKind(student) : "new" as StudentKind, source: student?.source ?? "", sourceOther: student?.sourceOther ?? "" });
  const teachers = useMemo(() => teacherNames(data, teacherAccounts), [data, teacherAccounts]);
  const legacyTeacher = Boolean(draft.tc) && !teachers.some((name) => normalise(name) === normalise(draft.tc));
  const legacyLevel = !group.p && Boolean(draft.lv) && !LEVELS.includes(draft.lv);
  const legacyStudentLevel = Boolean(studentDraft.lv) && !LEVELS.includes(studentDraft.lv);
  const groupName = group.p && student ? studentDraft.n.trim() : draft.lv.trim();
  const save = () => {
    if (!groupName || !draft.tc.trim()) return;
    const changedSessions = group.d !== draft.d || group.s !== draft.s || group.e !== draft.e;
    const candidateBase: AcademyGroup = { ...group, ...draft, capacity: draft.capacity ? Number(draft.capacity) : undefined };
    const candidate = changedSessions ? rescheduleGroupPreservingAttendance(group, candidateBase, data.attendance) : candidateBase;
    const conflicts = teacherScheduleConflicts(activeGroups(data), candidate);
    if (conflicts.length) {
      const message = `التعديل يسبب ${conflicts.length} تعارض في موعد المدرس ${draft.tc} مع: ${conflicts.slice(0, 3).map((item) => groupLabel(item.second)).join("؛ ")}${conflicts.length > 3 ? "؛ وجروبات أخرى" : ""}.`;
      if (!window.confirm(`${message}\n\nهل تريد حفظ التعديل رغم التعارض؟`)) return;
    }
    const hasSchedule = sessionsOf(group).length > 0 || data.attendance.some((record) => record.gid === group.id && Boolean(record.status));
    if (changedSessions && hasSchedule && !window.confirm("تغيير الأيام أو تواريخ الفترة سيعيد جدولة الجلسات غير المسجلة عليها حضور أو غياب. الجلسات التي عليها علامات ستبقى بتاريخها الأصلي، ولن تُنقل العلامة إلى موعد جديد؛ كما ستبقى الإلغاءات القديمة ظاهرة. سيبقى عدد الجلسات النشطة 8 على الأقل؛ إذا تجاوزت الجلسة الثامنة تاريخ النهاية فسيُمدد تلقائيًا، وإذا كان تاريخ النهاية أبعد من الجلسة الثامنة فسيبقى كما اخترته. هل تريد المتابعة؟")) return;
    commit((current) => {
      const target = current.g.find((item) => item.id === group.id);
      if (target) {
        const previousGroup = { ...target, ss: Array.isArray(target.ss) ? target.ss.map((session) => ({ ...session })) : target.ss };
        const updatedGroup = { ...previousGroup, ...draft, capacity: draft.capacity ? Number(draft.capacity) : undefined };
        if (previousGroup.e !== draft.e) target.followupDoneAt = undefined;
        if (changedSessions) {
          const rebuilt = rescheduleGroupPreservingAttendance(previousGroup, updatedGroup, current.attendance);
          Object.assign(target, draft, { ss: rebuilt.ss, capacity: draft.capacity ? Number(draft.capacity) : undefined });
          if (rebuilt.e) target.e = rebuilt.e;
          else delete target.e;
        } else Object.assign(target, draft, { capacity: draft.capacity ? Number(draft.capacity) : undefined });
        if (!draft.capacity) delete target.capacity;
        if (target.p) {
          target.lv = student ? studentDraft.n.trim() : draft.lv.trim();
          if (!target.s) target.s = toIsoDate();
          if (!changedSessions) {
            const source = Array.isArray(target.ss) && target.ss.length ? target.ss : generateSessions(target);
            const complete = ensureEightActiveSessions(target, source);
            target.ss = complete.ss ?? [];
            if (complete.e) target.e = complete.e;
            else delete target.e;
          }
        }
      }
      if (student) {
        const linkedStudent = current.m.find((item) => item.id === student.id && !item.x);
        if (linkedStudent) Object.assign(linkedStudent, studentDraft, { n: studentDraft.n.trim(), ph: studentDraft.ph.trim(), nw: studentDraft.kind === "new" ? 1 : 0, sourceOther: studentDraft.sourceOther.trim() });
      }
    }, changedSessions ? "تم حفظ التعديل مع الحفاظ على الجلسات المسجلة بتاريخها الأصلي." : group.p ? "تم حفظ بيانات الطالب والجروب Private." : "تم حفظ تعديل الجروب.");
    onClose();
  };
  return <div className="group-editor grid-form" role="group" aria-label={group.p ? "تعديل بيانات Private" : "تعديل بيانات الجروب"} style={{ marginBottom: 14 }}>
    <div className="group-editor__heading"><strong>{group.p ? "تعديل بيانات الطالب والجروب" : "تعديل بيانات الجروب"}</strong><p>غيّر بيانات الطالب والجروب من هنا؛ تعديل جلسة مفردة يظل من تبويب الحضور والغياب.</p></div>
    {group.p && student && <>
      <div className="group-editor__section-title">بيانات الطالب</div>
      <div className="field"><label>اسم الطالب / اسم الجروب</label><input value={studentDraft.n} onChange={(event) => setStudentDraft({ ...studentDraft, n: event.target.value })} /></div>
      <div className="field"><label>رقم الهاتف</label><input dir="ltr" value={studentDraft.ph} onChange={(event) => setStudentDraft({ ...studentDraft, ph: event.target.value })} /></div>
      <div className="field"><label>المستوى</label><select value={studentDraft.lv} onChange={(event) => setStudentDraft({ ...studentDraft, lv: event.target.value })}><option value="">اختر المستوى</option>{legacyStudentLevel && <option value={studentDraft.lv}>{studentDraft.lv} · مستوى سابق</option>}{LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></div>
      <div className="field"><label>ملاحظة الطالب</label><input value={studentDraft.nt} onChange={(event) => setStudentDraft({ ...studentDraft, nt: event.target.value })} /></div><div className="field"><label>تصنيف الطالب</label><select value={studentDraft.kind} onChange={(event) => setStudentDraft({ ...studentDraft, kind: event.target.value as StudentKind })}><option value="new">جديد</option><option value="old">قديم</option><option value="returned">قديم رجع بعد انقطاع</option></select></div><div className="field"><label>مصدر الطالب</label><select value={studentDraft.source} onChange={(event) => setStudentDraft({ ...studentDraft, source: event.target.value })}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></div>{studentDraft.source === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={studentDraft.sourceOther} onChange={(event) => setStudentDraft({ ...studentDraft, sourceOther: event.target.value })} /></div>}
      <div className="group-editor__section-title">بيانات الجروب</div>
    </>}
    {group.p && !student && <div className="field"><label>اسم الطالب / اسم الجروب</label><input value={draft.lv} onChange={(event) => setDraft({ ...draft, lv: event.target.value })} /></div>}
    {!group.p && <div className="field"><label>مستوى الجروب</label><select value={draft.lv} onChange={(event) => setDraft({ ...draft, lv: event.target.value })}><option value="">اختر المستوى</option>{legacyLevel && <option value={draft.lv}>{draft.lv} · مستوى سابق</option>}{LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></div>}
    <div className="field"><label>الأيام</label><select value={draft.d} onChange={(event) => setDraft({ ...draft, d: event.target.value })}><option>السبت والثلاثاء</option><option>الأحد والأربعاء</option><option>الاثنين والخميس</option></select></div>
    <div className="field"><label>المدرس</label><select value={draft.tc} onChange={(event) => setDraft({ ...draft, tc: event.target.value })}><option value="">اختر المدرس</option>{legacyTeacher && <option value={draft.tc}>{isTeacherNameArchived(data, draft.tc) ? "مدرس مؤرشف · التكليف الحالي محفوظ" : `${draft.tc} · مدرس قديم`}</option>}{teachers.map((name) => <option key={name} value={name}>{name}</option>)}</select>{legacyTeacher && <small>الاسم الحالي محفوظ للسجل؛ اختر مدرسًا نشطًا لأي تعيين جديد.</small>}</div>
    <div className="field"><label>من الساعة</label><input type="time" value={draft.t1} onChange={(event) => setDraft({ ...draft, t1: event.target.value })} /></div>
    <div className="field"><label>إلى الساعة</label><input type="time" value={draft.t2} onChange={(event) => setDraft({ ...draft, t2: event.target.value })} /></div>
    <div className="field"><label>تاريخ البداية</label><input type="date" value={draft.s} onChange={(event) => setDraft({ ...draft, s: event.target.value })} /></div>
    <div className="field"><label>تاريخ النهاية</label><input type="date" value={draft.e} onChange={(event) => setDraft({ ...draft, e: event.target.value })} /></div>
    {!group.p && <div className="field"><label>سعة الجروب (اختياري)</label><input type="number" min="1" max="100" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} placeholder="بدون حد محدد" /></div>}
    <button className="btn group-editor__save" disabled={!groupName || !draft.tc.trim()} onClick={save}>{group.p ? "حفظ بيانات Private" : "حفظ الجروب"}</button>
  </div>;
}

function AddStudent({ group, data, canEditPayment, commit }: { group: AcademyGroup; data: AcademyData; canEditPayment: boolean; commit: Commit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState("");
  const [loadedCode, setLoadedCode] = useState("");
  const [loadedIdentity, setLoadedIdentity] = useState<PersonRecord | null>(null);
  const [level, setLevel] = useState(group.lv ?? "");
  const [levelCount, setLevelCount] = useState("1");
  const [kind, setKind] = useState<StudentKind>("new");
  const [source, setSource] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [message, setMessage] = useState("");
  const loadByCode = () => {
    const query = lookup.trim().toLocaleUpperCase();
    const digits = personPhone(lookup);
    if (!query) { setMessage("اكتب كود العميل أو جزءًا من رقم الهاتف."); return; }
    const records: Array<Student | Lead> = [...live(data.m), ...live(data.l)];
    const candidates = records.filter((record) => matchesStudentCode(studentCodeFor(record), lookup)
      || (!isStudentCodeQuery(lookup) && digits.length >= 3 && personPhone(record.ph).includes(digits)));
    const unique = candidates.filter((record, index) => !candidates.slice(0, index).some((seen) => sameStudentIdentity(record, seen)));
    if (!unique.length) { setMessage("لم أجد عميلًا بهذا الكود أو جزء الرقم."); setLoadedCode(""); setLoadedIdentity(null); return; }
    if (unique.length > 1) { setMessage("الجزء المدخل يطابق أكثر من عميل؛ أدخل كود SPK كاملًا أو أرقامًا أكثر."); setLoadedCode(""); setLoadedIdentity(null); return; }
    const record = unique[0];
    setName(record.n ?? ""); setPhone(record.ph ?? ""); setLevel(record.lv ?? "");
    setSource(record.source ?? ""); setSourceOther(record.sourceOther ?? "");
    if (data.m.includes(record as Student)) setKind(studentKind(record as Student)); else setKind(record.kind ?? "new");
    setLoadedCode(studentCodeFor(record));
    setLoadedIdentity({ id: record.id, profileId: record.profileId, n: record.n, ph: record.ph });
    setMessage(`تم جلب بيانات ${record.n || "العميل"}. راجعها ثم اضغط «إضافة طالب».`);
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    let blocked = false;
    let duplicate = false;
    const candidate: PersonRecord = { id: loadedIdentity?.id ?? "new-student", profileId: loadedIdentity?.profileId, n: name.trim(), ph: phone.trim() };
    commit((data) => {
      if (hasActiveStudentEnrollment(candidate, data) || Boolean(loadedCode && data.m.some((student) => !student.x && matchesStudentCode(studentCodeFor(student), loadedCode) && isActiveStudentEnrollment(student, data)))) { duplicate = true; return; }
      const activeRosterCount = data.m.filter((student) => student.g === group.id && !student.x && isEnrolledStudent(student)).length;
      if (group.p && activeRosterCount) { blocked = true; return; }
      if (!group.p && Number(group.capacity) > 0 && activeRosterCount >= Number(group.capacity)) { blocked = true; return; }
      const historical = data.m.find((student) => !student.x && (sameStudentIdentity(candidate, student) || Boolean(loadedCode && matchesStudentCode(studentCodeFor(student), loadedCode))))
        ?? data.m.find((student) => sameStudentIdentity(candidate, student) || Boolean(loadedCode && matchesStudentCode(studentCodeFor(student), loadedCode)));
      const historicalLead = data.l.find((lead) => !lead.x && (sameStudentIdentity(candidate, lead) || Boolean(loadedCode && matchesStudentCode(studentCodeFor(lead), loadedCode))));
      const studentId = uid();
      const priorKind = historical ? studentKind(historical) : historicalLead?.kind;
      const registrationKind = (historical || historicalLead) && kind === "new" ? "returned" : kind;
      const registrationSource = source || historical?.subscriptionSource || historical?.source || historicalLead?.subscriptionSource || historicalLead?.source || "";
      data.m.push({ id: studentId, profileId: historical?.profileId || historicalLead?.profileId || historicalLead?.movedFromStudentId || historical?.id || historicalLead?.id || studentId, studentCode: historical?.studentCode || historicalLead?.studentCode || loadedCode || undefined, enrollmentType: group.p ? "private" : "group", g: group.id, r: group.r, n: name.trim(), ph: phone.trim(), lv: level, kind: priorKind && kind === "new" ? "returned" : registrationKind, subscriptionClass: historical?.subscriptionClass || historicalLead?.subscriptionClass || (historical || historicalLead ? "renewal" : kind === "new" ? "new" : "renewal"), source: registrationSource, subscriptionSource: registrationSource, sourceOther: sourceOther.trim() || historical?.sourceOther || historicalLead?.sourceOther || "", nw: registrationKind === "new" ? 1 : 0, pay: 0, ren: 0, lvPaid: canEditPayment ? Number(levelCount) : 1 });
      data.l.filter((lead) => !lead.x && (sameStudentIdentity(candidate, lead) || Boolean(loadedCode && studentCodeFor(lead) === loadedCode))).forEach((lead) => { lead.x = 1; lead.xa = Date.now(); });
      if (group.p) { const target = data.g.find((item) => item.id === group.id); if (target) { target.lv = name.trim(); if (!target.s) target.s = toIsoDate(); const source = Array.isArray(target.ss) && target.ss.length ? target.ss : generateSessions(target); const complete = ensureEightActiveSessions(target, source); target.ss = complete.ss ?? []; if (complete.e) target.e = complete.e; else delete target.e; } }
    }, group.p ? "تمت إضافة الطالب إلى جروب Private." : "تمت إضافة الطالب.");
    if (duplicate) { setMessage("الطالب موجود بالفعل في جروب شغال. استخدم بطاقة الطالب أو انتظر انتهاء تسجيله قبل إضافته مرة أخرى."); return; }
    if (blocked) { setMessage(group.p ? "هذا الجروب Private به طالب بالفعل؛ أنشئ جروبًا منفصلًا للطالب الآخر." : "الجروب وصل للسعة المحددة؛ زوّد السعة أو اختر جروبًا آخر."); return; }
    setName(""); setPhone(""); setLookup(""); setLoadedCode(""); setLoadedIdentity(null); setMessage("");
  };
  return <>{message && <div className="notice notice--warning" role="status">{message}</div>}<form className="grid-form" onSubmit={add} style={{ marginTop: 14 }}><div className="field add-student-code-lookup"><label>إضافة من ملف موجود بالكود أو جزء من رقم الهاتف</label><div className="toolbar"><input dir="auto" value={lookup} onChange={(event) => { setLookup(event.target.value); setLoadedCode(""); setLoadedIdentity(null); setMessage(""); }} placeholder="SPK-44 أو جزء من الرقم" /><button className="btn btn--ghost btn--small" type="button" onClick={loadByCode}>جلب البيانات</button></div></div><div className="field"><label>{group.p ? "اسم طالب Private" : "اسم طالب جديد"}</label><input value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="field"><label>التليفون</label><input dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} required={Boolean(group.p)} /></div><div className="field"><label>المستوى</label><select value={level} onChange={(event) => setLevel(event.target.value)} required={Boolean(group.p)}><option value="">{group.p ? "اختر المستوى" : "بدون مستوى"}</option>{!group.p && level && !LEVELS.includes(level) && <option value={level}>{level} · مستوى قديم</option>}{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></div><div className="field"><label>تصنيف الطالب</label><select value={kind} onChange={(event) => setKind(event.target.value as StudentKind)}><option value="new">جديد</option><option value="old">قديم</option><option value="returned">قديم رجع بعد انقطاع</option></select></div><div className="field"><label>مصدر الطالب</label><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></div>{source === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={sourceOther} onChange={(event) => setSourceOther(event.target.value)} /></div>}{canEditPayment && <div className="field"><label>عدد الليفلات المدفوعة</label><select value={levelCount} onChange={(event) => setLevelCount(event.target.value)}>{LEVEL_COUNTS.map((count) => <option key={count} value={count}>{count} ليفل مدفوع</option>)}</select></div>}<button className="btn" type="submit"><Plus size={16} />{group.p ? "إضافة طالب واحد" : "إضافة طالب"}</button></form></>;
}
type FollowupRecord = (Student | Lead | AcademyGroup) & { fd?: string; fh?: unknown[]; fu?: number; lu?: number; followupDoneAt?: number };

function saveFollowup(target: FollowupRecord, date: string, note: string) {
  const stamp = Date.now();
  target.fd = date;
  target.fh = [...(Array.isArray(target.fh) ? target.fh : []), { t: stamp, to: date, n: note.trim() || (date ? "متابعة مجدولة" : "تم") }].slice(-40);
  target.fu = stamp;
  target.lu = stamp;
  target.followupDoneAt = undefined;
}

function FollowupControls({ record, data, onSave }: { record: FollowupRecord; data: AcademyData; onSave: (date: string, note: string) => void }) {
  const initialDate = "followupDate" in record ? leadFollowupDate(record as Lead) : String(record.fd ?? "");
  const [date, setDate] = useState(initialDate);
  const [note, setNote] = useState("");
  const nextRound = live(data.r).filter((round) => !round.pl).map((round) => String(round.s ?? "")).filter((value) => value >= toIsoDate()).sort()[0] ?? "";
  const quick = (days: number) => { const target = new Date(); target.setDate(target.getDate() + days); const value = toIsoDate(target); setDate(value); onSave(value, note); };
  const history = (Array.isArray(record.fh) ? record.fh : []).slice(-4).reverse().filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  return <details className="followup-controls"><summary>{date ? `فولو أب: ${formatDate(date)}` : "إضافة / تحديث فولو أب"}</summary><div className="field" style={{ marginTop: 8 }}><label>ملاحظة التواصل (اختياري)</label><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="ماذا تم في المتابعة؟" /></div><div className="toolbar" style={{ marginTop: 8 }}><button className="btn btn--ghost btn--small" onClick={() => quick(3)}>كمان 3 أيام</button><button className="btn btn--ghost btn--small" onClick={() => quick(7)}>كمان أسبوع</button><button className="btn btn--ghost btn--small" onClick={() => quick(14)}>كمان أسبوعين</button>{nextRound && <button className="btn btn--ghost btn--small" onClick={() => { setDate(nextRound); onSave(nextRound, note); }}>الراوند الجاي</button>}</div><div className="toolbar"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button className="btn btn--small" disabled={!date} onClick={() => onSave(date, note)}>حفظ التاريخ</button><button className="btn btn--ghost btn--small" onClick={() => { setDate(""); onSave("", note || "تم"); }}>خلص بدون فولو أب</button></div>{history.map((entry, index) => { const stamp = Number(entry.t ?? entry.at); return <p className="followup-history" key={`${stamp}-${index}`}>• {stamp ? formatDate(toIsoDate(new Date(stamp))) : "تواصل سابق"} · {String(entry.n ?? "تواصل")}{entry.to ? ` ← الجاي ${String(entry.to)}` : ""}</p>; })}</details>;
}

const StudentRow = memo(function StudentRow({ student, index, toneIndex = index, canEditPayment, canEditRenewal, commit, data, showLevelCount = false, groupSummary, privateDetails }: { student: Student; index: number; toneIndex?: number; canEditPayment: boolean; canEditRenewal: boolean; commit: Commit; data: AcademyData; showLevelCount?: boolean; groupSummary?: AcademyGroup; privateDetails?: AcademyGroup }) {
  const [editing, setEditing] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [targetGroup, setTargetGroup] = useState("");
  const [targetEnrollmentType, setTargetEnrollmentType] = useState<"" | "group" | "private">("");
  const [targetRoundId, setTargetRoundId] = useState("");
  const [targetStudentTab, setTargetStudentTab] = useState<"" | StudentDestinationTab>("");
  const sourceGroup = data.g.find((group) => group.id === student.g);
  const formerCard = student.movedToTab === "renewals" || Boolean(student.formerAt);
  const inferredEnrollmentType = student.enrollmentType ?? (sourceGroup?.p ? "private" : "group");
  const [enrollmentType, setEnrollmentType] = useState<"group" | "private">(inferredEnrollmentType);
  const [moveFeedback, setMoveFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [draft, setDraft] = useState({ n: student.n ?? "", ph: student.ph ?? "", lv: student.lv ?? "", nt: student.nt ?? "", kind: studentKind(student), source: student.source ?? "", sourceOther: student.sourceOther ?? "" });
  const [reason, setReason] = useState(String(student.renewalReason ?? ""));
  const [amount, setAmount] = useState(String(student.amount ?? ""));
  const [remaining, setRemaining] = useState(String(student.pn ?? ""));
  const displayedPrivateDetails = groupSummary ?? privateDetails;
  const transferRounds = transferOpen ? live(data.r).filter((round) => !round.pl && activeGroups(data).some((group) => !group.p && group.r === round.id && isGroupOperationalToday(group))).sort((a, b) => String(a.s ?? "").localeCompare(String(b.s ?? ""))) : [];
  const targets = transferOpen ? activeGroups(data).filter((group) => {
    if (group.id === student.g || isTeacherNameArchived(data, group.tc)) return false;
    if (!isGroupOperationalToday(group)) return false;
    if (!targetEnrollmentType || (group.p ? "private" : "group") !== targetEnrollmentType) return false;
    if (!group.p && group.r !== targetRoundId) return false;
    if (formerCard && (group.p ? "private" : "group") !== enrollmentType) return false;
    const count = data.m.filter((item) => item.g === group.id && !item.x && isEnrolledStudent(item) && item.id !== student.id).length;
    return group.p ? privateGroupCanAccept(data, group.id, student.id) : canAddStudentToGroup(group, count);
  }) : [];
  const saveEdit = () => { commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) Object.assign(target, draft, { nw: draft.kind === "new" ? 1 : 0, sourceOther: draft.sourceOther.trim() }); if (groupSummary) { const linkedGroup = current.g.find((item) => item.id === groupSummary.id); if (linkedGroup) linkedGroup.lv = draft.n.trim(); } }, "تم حفظ بيانات الطالب."); setEditing(false); };
  const moveStudent = () => {
    if (!targetGroup || !targetEnrollmentType || (targetEnrollmentType === "group" && !targetRoundId)) return;
    const selected = data.g.find((group) => group.id === targetGroup);
    if (selected?.p && !privateGroupCanAccept(data, selected.id, student.id)) {
      setMoveFeedback({ text: "هذا الجروب Private به طالب بالفعل؛ أنشئ جروبًا منفصلًا لكل طالب.", error: true });
      return;
    }
    if (selected && !selected.p && !canAddStudentToGroup(selected, data.m.filter((item) => item.g === selected.id && !item.x && isEnrolledStudent(item) && item.id !== student.id).length)) {
      setMoveFeedback({ text: "الجروب وصل للسعة المحددة؛ اختر جروبًا آخر أو زِد السعة أولًا.", error: true });
      return;
    }
    let blocked = false;
    commit((current) => {
      const target = current.m.find((item) => item.id === student.id);
      const group = current.g.find((item) => item.id === targetGroup);
      const targetCount = current.m.filter((item) => item.g === group?.id && !item.x && isEnrolledStudent(item) && item.id !== target?.id).length;
      if (!target || !group || (group.p ? !privateGroupCanAccept(current, group.id, target.id) : group.r !== targetRoundId || !canAddStudentToGroup(group, targetCount))) { blocked = true; return; }
      archiveRelatedLeads(current, target);
      removeStudentAttendance(current, target.id);
      target.g = group.id;
      target.r = group.r;
      target.enrollmentType = group.p ? "private" : "group";
      delete target.formerAt;
      delete target.movedToTab;
      delete target.movedToLeadId;
      if (group.p) group.lv = target.n ?? group.lv;
    });
    if (blocked) setMoveFeedback({ text: "لم يتم النقل؛ لم تعد المجموعة تقبل طالبًا إضافيًا. اختر مجموعة أخرى.", error: true });
    else { setMoveFeedback({ text: "تم نقل الطالب.", error: false }); setTargetGroup(""); }
  };
  const moveStudentToTab = () => {
    if (!targetStudentTab || !data.m.some((item) => item.id === student.id && !item.x)) return;
    const destination = targetStudentTab;
    const stamp = Date.now();
    const destinationLabel = destination === "renewals" ? "عملاء الراوند الجاي" : destination === "next" ? "عملاء الراوند الجاي" : "الليدز";
    commit((current) => {
      const target = current.m.find((item) => item.id === student.id && !item.x);
      if (!target) return;
      const linkedLead = current.l.find((item) => item.id === target.movedToLeadId);
      if (destination === "renewals") {
        if (linkedLead) { linkedLead.x = 1; linkedLead.xa = stamp; }
        removeStudentAttendance(current, target.id);
        target.formerAt = stamp;
        target.movedToTab = "renewals";
        delete target.movedToLeadId;
        return;
      }
      const leadId = linkedLead?.id ?? uid();
      const lead: Lead = {
        ...(linkedLead ?? {}),
        id: leadId,
        n: target.n ?? "",
        ph: target.ph ?? "",
        lv: target.lv ?? "",
        nt: target.nt ?? "",
        source: target.source ?? "",
        sourceOther: target.sourceOther ?? "",
        st: linkedLead?.st ?? "مهتم",
        bucket: destination === "next" ? "next" : "",
        source_sheet: destination === "next" ? "next round" : "lead",
        followupCat: linkedLead?.followupCat ?? "interested",
        fd: linkedLead?.fd ?? target.fd,
        fh: linkedLead?.fh ?? target.fh,
        fu: linkedLead?.fu ?? target.fu,
        lu: linkedLead?.lu ?? target.lu,
        followupDoneAt: linkedLead?.followupDoneAt ?? target.followupDoneAt,
        ts: linkedLead?.ts ?? (typeof target.ts === "number" ? target.ts : stamp),
        profileId: target.profileId || target.id,
        studentCode: target.studentCode || studentCodeFor(target),
        movedFromStudentId: target.id,
        kind: studentKind(target),
        subscriptionClass: target.subscriptionClass ?? (studentKind(target) === "new" ? "new" : "renewal"),
        subscriptionSource: target.subscriptionSource ?? target.source ?? "",
        subscriptionSourceOther: target.subscriptionSourceOther ?? target.sourceOther ?? "",
        enrollmentType
      };
      if (linkedLead) Object.assign(linkedLead, lead);
      else current.l.push(lead);
      const updatedLead = current.l.find((item) => item.id === leadId);
      if (updatedLead) { delete updatedLead.x; delete updatedLead.xa; }
      current.l.filter((item) => !item.x && item.id !== leadId && samePerson(target, item)).forEach((item) => { item.x = 1; item.xa = stamp; });
      removeStudentAttendance(current, target.id);
      target.movedToTab = destination;
      delete target.formerAt;
      target.movedToLeadId = leadId;
      if (target.copiedFromStudentId) { target.x = 1; target.xa = stamp; }
    }, `تم نقل الطالب إلى «${destinationLabel}» مع الاحتفاظ بتسجيله وتاريخه.`);
    setTargetStudentTab("");
  };
  const copyStudentToTab = () => {
    if (!targetStudentTab || !data.m.some((item) => item.id === student.id && !item.x)) return;
    if (targetStudentTab !== "next") {
      setMoveFeedback({ text: "لمنع ظهور الطالب في مكانين، استخدم «نقل للتبويب» إلى الليدز.", error: true });
      return;
    }
    if (student.movedToTab === "renewals" || student.formerAt) {
      setMoveFeedback({ text: "العميل موجود بالفعل في قائمة عملاء الراوند الجاي.", error: true });
      return;
    }
    if (hasActiveStudentEnrollment(student, data)) {
      setMoveFeedback({ text: "الطالب مسجل في جروب شغال؛ لا يمكن نسخ بطاقة إضافية إلى قائمة العملاء.", error: true });
      return;
    }
    const stamp = Date.now();
    const destinationLabel = "عملاء الراوند الجاي";
    if (!window.confirm(`نسخ «${student.n || "بدون اسم"}» إلى «${destinationLabel}»؟ سيظل سجل الطالب الأصلي في مكانه.`)) return;
    let duplicate = false;
    commit((current) => {
      const source = current.m.find((item) => item.id === student.id && !item.x);
      if (!source) return;
      if (current.m.some((item) => !item.x && item.id !== source.id && item.movedToTab === "renewals" && samePerson(source, item)) || current.l.some((item) => !item.x && samePerson(source, item))) { duplicate = true; return; }
      const copy: Student = { ...source, id: uid(), profileId: source.profileId || source.id, studentCode: source.studentCode || studentCodeFor(source), copiedFromStudentId: source.id, movedToTab: "renewals", formerAt: stamp, ren: 2 };
      delete copy.movedToLeadId; delete copy.x; delete copy.xa;
      current.m.push(copy);
    });
    setMoveFeedback(duplicate ? { text: `العميل موجود بالفعل في «${destinationLabel}».`, error: true } : { text: `تم نسخ الطالب إلى «${destinationLabel}» وبقي سجله السابق محفوظًا.`, error: false });
    setTargetStudentTab("");
  };
  const copyVisibleData = () => {
    const value = [displayStudentName(student, data), student.ph || "", student.lv || "", studentCodeFor(student)].join("\t");
    void safeCopy(value).then(() => setMoveFeedback({ text: "تم نسخ بيانات الطالب.", error: false }));
  };
  const copyPhone = () => {
    if (student.ph) void safeCopy(student.ph).then(() => setMoveFeedback({ text: "تم نسخ رقم الهاتف.", error: false }));
  };
  const copyCode = () => void safeCopy(studentCodeFor(student)).then(() => setMoveFeedback({ text: "تم نسخ كود العميل.", error: false }));
  return <div id={"student-record-" + student.id} className={"student-card student-card--roster " + (toneIndex % 2 === 0 ? "student-card--light" : "student-card--gray")}>
    <div className="student-card__summary">
      <div className="student-card__identity"><StudentNameWithNote name={displayStudentName(student, data)} note={student.nt} /><div className="student-card__phone-line"><bdi className="phone phone-number" dir="ltr">{student.ph || "—"}</bdi>{student.ph && <button type="button" className="btn btn--ghost btn--small student-card__copy-phone" onClick={copyPhone} aria-label="نسخ رقم الهاتف" title="نسخ رقم الهاتف"><Copy size={13} /></button>}</div></div>
      <span className="tag student-card__level">{visibleLevel(student.lv) || student.lv || "بدون Level"}</span>
      <button type="button" className="tag tag--muted student-system-id code-copy" title="نسخ كود العميل" onClick={copyCode}><bdi dir="ltr">{studentCodeFor(student)}</bdi><Copy size={12} /></button>
      <button type="button" className="btn btn--ghost btn--small student-card__copy-all" onClick={copyVisibleData}><Copy size={13} />نسخ البيانات</button>
    </div>
    {(canEditPayment || canEditRenewal) && <details className="student-actions-panel"><summary>إجراءات أخرى<ChevronDown size={15} /></summary><div className="student-actions-panel__body">
      <div className="student-actions-panel__section"><h4>الدفع والتجديد</h4><div className="toolbar student-actions-panel__controls">
        {canEditPayment && <select value={String(student.pay ?? 0)} aria-label="حالة الدفع" onChange={(event) => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.pay = Number(event.target.value) as Student["pay"]; }, "تم تحديث الدفع.")}><option value="0">لسه</option><option value="1">دفع</option><option value="2">جزئي</option></select>}
        {canEditPayment && <input className="student-money" aria-label="قيمة الدفع" type="number" min="0" value={amount} placeholder="قيمة الدفع" onChange={(event) => setAmount(event.target.value)} onBlur={() => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.amount = Math.max(0, Number(amount) || 0); }, "تم تحديث قيمة الدفع.")} />}
        {canEditPayment && showLevelCount && <select aria-label="عدد الليفلات المدفوعة" value={String(student.lvPaid ?? 1)} onChange={(event) => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.lvPaid = Number(event.target.value); }, "تم تحديث عدد الليفلات المدفوعة.")}>{LEVEL_COUNTS.map((count) => <option key={count} value={count}>{count} Level</option>)}</select>}
        {canEditPayment && Number(student.pay) === 2 && <input className="student-money" aria-label="المتبقي من الدفع" value={remaining} placeholder="المتبقي" onChange={(event) => setRemaining(event.target.value)} onBlur={() => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.pn = remaining; }, "تم تحديث المتبقي.")} />}
        {canEditRenewal && <select value={String(student.ren ?? 0)} aria-label="حالة التجديد" onChange={(event) => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) { target.ren = Number(event.target.value) as Student["ren"]; delete target.formerAt; } }, "تم تحديث التجديد. سيظل الطالب في جروبه؛ انسخه إلى عملاء الراوند الجاي إذا أردت قائمة متابعة منفصلة.")}><option value="0">لسه</option><option value="1">هيجدد</option><option value="2">مش هيجدد</option></select>}
        {canEditRenewal && !groupSummary && <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing((value) => !value)}>{editing ? "إغلاق تعديل الطالب" : "تعديل بيانات الطالب"}</button>}
      </div></div>
      <div className="student-card__meta"><span className="tag tag--muted">المصدر: {studentSourceLabel(student)}</span></div>
      {displayedPrivateDetails && <div className="private-group-meta"><div><small>الأيام</small><strong>{displayedPrivateDetails.d || "—"}</strong></div><div><small>المدرس</small><strong>{teacherDisplayName(data, displayedPrivateDetails.tc)}</strong></div><div><small>الوقت</small><strong>{groupTime(displayedPrivateDetails) || "—"}</strong></div><div><small>الفترة</small><strong>{displayedPrivateDetails.s ? formatDate(displayedPrivateDetails.s, true) : "—"} – {displayedPrivateDetails.e ? formatDate(displayedPrivateDetails.e, true) : "—"}</strong></div></div>}
      {editing && canEditRenewal && <div className="grid-form student-edit"><div className="field"><label>الاسم</label><input value={draft.n} onChange={(event) => setDraft({ ...draft, n: event.target.value })} /></div><div className="field"><label>التليفون</label><input dir="ltr" value={draft.ph} onChange={(event) => setDraft({ ...draft, ph: event.target.value })} /></div><div className="field"><label>المستوى</label><select value={draft.lv} onChange={(event) => setDraft({ ...draft, lv: event.target.value })}>{draft.lv && !LEVELS.includes(draft.lv) && <option value={draft.lv}>{draft.lv} · مستوى قديم</option>}{LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="field"><label>ملاحظة</label><input value={draft.nt} onChange={(event) => setDraft({ ...draft, nt: event.target.value })} /></div><div className="field"><label>تصنيف الطالب</label><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as StudentKind })}><option value="new">جديد</option><option value="old">قديم</option><option value="returned">قديم رجع بعد انقطاع</option></select></div><div className="field"><label>المصدر</label><select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></div>{draft.source === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={draft.sourceOther} onChange={(event) => setDraft({ ...draft, sourceOther: event.target.value })} /></div>}<button type="button" className="btn" onClick={saveEdit}>حفظ بيانات الطالب</button></div>}
      {canEditRenewal && <div className="student-tools">{formerCard && <div className="field student-enrollment-type"><label htmlFor={"student-kind-" + student.id}>نوع الاشتراك المطلوب</label><select id={"student-kind-" + student.id} value={enrollmentType} onChange={(event) => { const value = event.target.value as "group" | "private"; setEnrollmentType(value); setTargetGroup(""); commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.enrollmentType = value; }, "تم تحديث نوع الاشتراك المطلوب."); }}><option value="group">جروب</option><option value="private">Private</option></select></div>}{student.ren === 2 && <div className="field student-renewal-reason"><label>سبب عدم التجديد</label><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} onBlur={() => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) target.renewalReason = reason.trim(); }, "تم حفظ سبب عدم التجديد.")} placeholder="اكتب سبب القرار…" /></div>}<FollowupControls record={student} data={data} onSave={(date, note) => commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) saveFollowup(target, date, note); }, "تم حفظ متابعة الطالب.")} />
        <details className="student-transfer-panel" onToggle={(event) => setTransferOpen(event.currentTarget.open)}><summary>نقل أو نسخ الطالب</summary><div className="toolbar student-transfer">
          <div className="student-transfer__action"><label htmlFor={"student-destination-" + student.id}>نقل إلى</label><div className="student-transfer__controls"><select id={"student-destination-" + student.id} value={targetEnrollmentType} onChange={(event) => { setTargetEnrollmentType(event.target.value as typeof targetEnrollmentType); setTargetRoundId(""); setTargetGroup(""); setMoveFeedback(null); }}><option value="">اختر جروب أو Private</option><option value="group">جروب</option><option value="private">Private</option></select>{targetEnrollmentType === "group" && <select aria-label="اختر الراوند" value={targetRoundId} onChange={(event) => { setTargetRoundId(event.target.value); setTargetGroup(""); }}><option value="">اختر الراوند</option>{transferRounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select>}<select id={"student-group-" + student.id} value={targetGroup} disabled={!targetEnrollmentType || targetEnrollmentType === "group" && !targetRoundId} onChange={(event) => { setTargetGroup(event.target.value); setMoveFeedback(null); }}><option value="">{targetEnrollmentType === "group" && !targetRoundId ? "اختر الراوند أولًا" : "اختر المجموعة"}</option>{targets.map((group) => <option key={group.id} value={group.id}>{group.p ? "Private · " : ""}{displayGroupLabel(group, data)}</option>)}</select><button type="button" className="btn btn--ghost btn--small" disabled={!targetGroup || !targetEnrollmentType || targetEnrollmentType === "group" && !targetRoundId} onClick={moveStudent}>نقل الطالب</button></div></div>
          <StudentCopyControls student={student} data={data} commit={commit} onFeedback={setMoveFeedback} />
          <div className="student-transfer__action"><label htmlFor={"student-tab-" + student.id}>نقل إلى تبويب</label><div className="student-transfer__controls"><select id={"student-tab-" + student.id} aria-label="نقل الطالب إلى تبويب" value={targetStudentTab} onChange={(event) => { setTargetStudentTab(event.target.value as typeof targetStudentTab); setMoveFeedback(null); }}><option value="">اختر التبويب</option><option value="next">عملاء الراوند الجاي</option><option value="leads">الليدز</option></select><div className="student-transfer__tab-actions"><button type="button" className="btn btn--ghost btn--small" disabled={!targetStudentTab} onClick={moveStudentToTab}>نقل</button><button type="button" className="btn btn--small" disabled={!targetStudentTab || targetStudentTab !== "next"} onClick={copyStudentToTab}><Copy size={13} />نسخ</button></div></div></div>
          {!(formerCard && student.copiedFromStudentId) && <button type="button" className="btn btn--ghost btn--small student-transfer__archive" onClick={() => { if (!window.confirm("أرشفة الطالب «" + (student.n || "بدون اسم") + "»؟")) return; commit((current) => { const target = current.m.find((item) => item.id === student.id); if (target) { removeStudentAttendance(current, target.id); target.x = 1; target.xa = Date.now(); archiveRelatedLeads(current, target); } }, "تمت أرشفة الطالب وحذف علامات حضوره وغيابه."); }}>أرشفة</button>}
        </div></details>
      </div>}
    </div></details>}
    {moveFeedback && <div className={"student-card__feedback " + (moveFeedback.error ? "student-card__feedback--error" : "")} role="status">{moveFeedback.text}</div>}
  </div>;
});
function StudentCopyControls({ student, data, commit, onFeedback }: { student: Student; data: AcademyData; commit: Commit; onFeedback: (feedback: { text: string; error: boolean } | null) => void }) {
  const [open, setOpen] = useState(false);
  const [roundId, setRoundId] = useState("");
  const [groupId, setGroupId] = useState("");
  const rounds = open ? live(data.r).filter((round) => isRoundActive(data, round.id)).sort((a, b) => roundName(a).localeCompare(roundName(b), "ar")) : [];
  const matchesStudent = (candidate: Student, targetId: string) => !candidate.x && isEnrolledStudent(candidate) && candidate.g === targetId && normalise(candidate.n) === normalise(student.n) && normalise(candidate.ph) === normalise(student.ph);
  const groups = open && roundId ? nonArchivedGroups(data).filter((group) => {
    if (group.r !== roundId || group.p || group.id === student.g || isTeacherNameArchived(data, group.tc) || data.m.some((candidate) => matchesStudent(candidate, group.id))) return false;
    if (!isGroupOperationalToday(group)) return false;
    const count = data.m.filter((candidate) => candidate.g === group.id && !candidate.x && isEnrolledStudent(candidate)).length;
    return canAddStudentToGroup(group, count);
  }).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), "ar")) : [];
  const copy = () => {
    const selected = groups.find((group) => group.id === groupId);
    if (!selected) return;
    if (!window.confirm(`نسخ «${student.n || "بدون اسم"}» إلى «${displayGroupLabel(selected, data)}»؟ لن يتغير الطالب الأصلي، وستبدأ حالة الدفع والتجديد في النسخة من جديد.`)) return;
    const id = uid();
    let blocked = false;
    commit((current) => {
      const source = current.m.find((item) => item.id === student.id && !item.x);
      const target = nonArchivedGroups(current).find((group) => group.id === groupId && group.r === roundId && !group.p && group.id !== student.g && isRoundActive(current, group.r) && !isTeacherNameArchived(current, group.tc));
      const targetCount = current.m.filter((candidate) => candidate.g === target?.id && !candidate.x && isEnrolledStudent(candidate)).length;
      if (!source || !target || current.m.some((candidate) => matchesStudent(candidate, target.id)) || !canAddStudentToGroup(target, targetCount)) { blocked = true; return; }
      current.m.push(copyStudentForGroup(source, target, id));
    }, "تم نسخ الطالب إلى الجروب المحدد.");
    if (blocked) { onFeedback({ text: "لم يتم النسخ؛ تغيّرت حالة الجروب أو امتلأت سعته. اختر جروبًا نشطًا به مكان متاح.", error: true }); return; }
    onFeedback({ text: "تم نسخ الطالب دون تغيير السجل الأصلي. بيانات الدفع والتجديد في النسخة تبدأ من جديد.", error: false });
    setOpen(false);
    setRoundId("");
    setGroupId("");
  };
  return <div className={"student-copy" + (open ? " student-copy--open" : "")}>
    <button type="button" className="btn btn--ghost btn--small" aria-expanded={open} onClick={() => { setOpen((value) => !value); onFeedback(null); }}><Copy size={13} />نسخ الطالب لجروب</button>
    {open && <div className="student-copy__panel">
      <label className="field"><span>الراوند النشط</span><select value={roundId} onChange={(event) => { setRoundId(event.target.value); setGroupId(""); }}><option value="">اختر راوندًا نشطًا</option>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select></label>
      <label className="field"><span>الجروب</span><select value={groupId} disabled={!roundId || !groups.length} onChange={(event) => setGroupId(event.target.value)}><option value="">{!roundId ? "اختر الراوند أولًا" : groups.length ? "اختر الجروب" : "لا توجد جروبات نشطة متاحة"}</option>{groups.map((group) => <option key={group.id} value={group.id}>{displayGroupLabel(group, data)}</option>)}</select></label>
      <button type="button" className="btn btn--small" disabled={!groupId} onClick={copy}>تأكيد النسخ</button>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => { setOpen(false); setRoundId(""); setGroupId(""); }}>إلغاء</button>
    </div>}
  </div>;
}

function ArchivedPrivateRecords({ data, commit }: { data: AcademyData; commit: Commit }) {
  const [open, setOpen] = useState(false);
  const archivedGroups = data.g.filter((group) => Boolean(group.p && group.x));
  const archivedStudents = data.m.filter((student) => Boolean(student.x && data.g.find((group) => group.id === student.g)?.p));
  if (!archivedGroups.length && !archivedStudents.length) return null;
  const restoreGroup = (group: AcademyGroup) => {
    commit((draft) => {
      const targetGroup = draft.g.find((item) => item.id === group.id);
      if (targetGroup) { delete targetGroup.x; delete targetGroup.xa; }
    }, "تمت استعادة مجموعة Private؛ استعد سجل الطالب من الأرشيف إذا كان مؤرشفًا.");
  };
  const restoreStudent = (student: Student) => {
    const duplicate = data.m.some((item) => item.id !== student.id && !item.x && isEnrolledStudent(item) && sameStudentIdentity(item, student));
    if (duplicate && !window.confirm("يوجد تسجيل نشط آخر لهذا الطالب. استعادة هذا السجل قد تُظهره مرتين في الجروبات. هل تريد الاستمرار؟")) return;
    commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { delete target.x; delete target.xa; } }, "تمت استعادة طالب Private.");
  };
  return <section className="section archived-private-records"><button type="button" className="section-head archived-private-records__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span><h2>سجلات Private المؤرشفة</h2><p>اعرض السجلات المخفية واستعدها لتعديلها.</p></span><span className="tag tag--muted">{archivedGroups.length + archivedStudents.length}</span><ChevronDown size={17} /></button>{open && <div className="card-list">
    {archivedGroups.map((group) => {
      const students = data.m.filter((item) => item.g === group.id);
      return (
        <article className="entity-card archived-private-record" key={`g:${group.id}`}>
          <div>
            <h3><StudentNameWithNote name={students[0]?.n || group.lv || "Private بدون اسم"} note={students[0]?.nt} />{students.length > 1 ? ` · ${students.length} سجلات` : ""}</h3>
            {students.map((student) => (
              <p key={student.id}>
                {students.length > 1 && <><StudentNameWithNote name={student.n || "طالب بدون اسم"} note={student.nt} /> · </>}
                {student.studentCode || "بدون كود"} · <bdi dir="ltr" className="phone-number">{student.ph || "بدون هاتف"}</bdi> · {student.lv || "بدون مستوى"}{student.x ? " · طالب مؤرشف" : " · محفوظ"}
              </p>
            ))}
            <small>مجموعة Private مؤرشفة · {group.tc || "بدون مدرس"}</small>
          </div>
          <button type="button" className="btn btn--small" onClick={() => restoreGroup(group)}><ArchiveRestore size={14} />استعادة المجموعة للتعديل</button>
        </article>
      );
    })}
    {archivedStudents.filter((student) => !archivedGroups.some((group) => group.id === student.g)).map((student) => { const group = data.g.find((item) => item.id === student.g); return <article className="entity-card archived-private-record" key={`m:${student.id}`}><div><h3><StudentNameWithNote name={student.n || "طالب بدون اسم"} note={student.nt} /></h3><p>{student.studentCode || "بدون كود"} · <bdi dir="ltr" className="phone-number">{student.ph || "بدون هاتف"}</bdi> · {student.lv || "بدون مستوى"}</p><small>طالب Private مؤرشف · {group?.lv || "مجموعة غير موجودة"}</small></div><button type="button" className="btn btn--small" onClick={() => restoreStudent(student)}><ArchiveRestore size={14} />استعادة للتعديل</button></article>; })}
  </div>}</section>;
}
function PrivateStudentEntry({ group, data, profile, teacherAccounts, toneOffset = 0, commit }: { group: AcademyGroup; data: AcademyData; profile: Profile; teacherAccounts: TeacherAccount[]; toneOffset?: number; commit: Commit }) {
  const roster = activeStudentsOf(data, group.id);
  const movedRecords = live(data.m).filter((student) => student.g === group.id && !isEnrolledStudent(student));
  const visibleRoster = roster;
  const [editingGroup, setEditingGroup] = useState(false);
  const archivePrivate = (studentName: string) => {
    if (!window.confirm(`أرشفة جروب Private «${studentName || group.lv || "بدون اسم"}»؟ ستظل البيانات قابلة للاستعادة.`)) return;
    commit((draft) => { const target = draft.g.find((item) => item.id === group.id); if (target) { target.x = 1; target.xa = Date.now(); } }, "تمت أرشفة جروب Private.");
  };
  return <div id={`group-record-${group.id}`} className="private-student-list">
    {roster.length > 1 && <div className="notice notice--warning">هذا سجل Private قديم مرتبط بأكثر من طالب؛ لم ننقل أو نحذف أي طالب تلقائيًا.</div>}
    {visibleRoster.length > 0 && <div className="private-student-item">
      {visibleRoster.map((student, index) => <StudentRow key={student.id} student={student} index={index} toneIndex={toneOffset + index} canEditPayment={profile.role === "owner"} canEditRenewal={profile.role !== "teacher"} commit={commit} data={data} showLevelCount groupSummary={group} />)}
      {profile.role !== "teacher" && <div className="toolbar private-group-actions"><button className="btn btn--ghost btn--small" aria-expanded={editingGroup} onClick={() => setEditingGroup((value) => !value)}>{editingGroup ? "إغلاق التعديل" : "تعديل بيانات Private"}</button><button className="btn btn--ghost btn--small" onClick={() => archivePrivate(roster[0]?.n || "")}>أرشفة Private</button></div>}
      {editingGroup && profile.role !== "teacher" && <EditableGroup group={group} student={roster[0]} data={data} teacherAccounts={teacherAccounts} commit={commit} onClose={() => setEditingGroup(false)} />}
    </div>}
    {!roster.length && <section className="section private-empty-student"><div className="section-head"><div><h2>جروب Private بدون طالب</h2><p>هذا سجل قديم غير مرتبط بطالب؛ يمكنك إضافة الطالب الوحيد أو تعديل الجروب أو أرشفته.</p></div><span className="tag tag--warning">بدون طالب</span></div>{profile.role !== "teacher" && <div className="toolbar private-empty-actions"><span className="tag tag--muted">سجل Private قديم</span><button className="btn btn--ghost btn--small" onClick={() => archivePrivate("")}>أرشفة Private</button></div>}{profile.role !== "teacher" ? <><EditableGroup group={group} data={data} teacherAccounts={teacherAccounts} commit={commit} onClose={() => undefined} /><AddStudent group={group} data={data} canEditPayment={profile.role === "owner"} commit={commit} /></> : <div className="empty">لا توجد بيانات طالب مسجلة لهذا الجروب.</div>}</section>}
    {!visibleRoster.length && roster.length > 0 && <div className="empty">الطالب ظاهر في تبويب «عملاء الراوند الجاي»؛ سجله الأصلي محفوظ للجروب والإحصائيات.</div>}
  </div>;
}

function CopyAllNumbersButton({ phones }: { phones: Array<string | null | undefined> }) {
  const [feedback, setFeedback] = useState("");
  const numbers = uniquePhoneNumbers(phones);
  const signature = numbers.join("\u001f");
  useEffect(() => { setFeedback(""); }, [signature]);
  const copy = async () => {
    try {
      await safeCopy(numbers.join("\n"));
      setFeedback(`تم نسخ ${numbers.length} رقمًا.`);
    } catch {
      setFeedback("تعذر النسخ. حاول السماح بالوصول إلى الحافظة.");
    }
  };
  return <div className="copy-all-numbers">
    <button type="button" className="btn btn--ghost btn--small" disabled={!numbers.length} onClick={() => void copy()} aria-label={`نسخ كل الأرقام الظاهرة (${numbers.length})`}>
      <Copy size={14} />نسخ كل الأرقام <span className="copy-all-numbers__count">({numbers.length})</span>
    </button>
    {feedback && <span className="copy-all-numbers__feedback" role="status" aria-live="polite">{feedback}</span>}
  </div>;
}

function ScriptsView({ data, commit }: { data: AcademyData; commit: Commit }) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [viewingScript, setViewingScript] = useState<WorkScript | null>(null);
  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkScriptKind>("message");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const kindLabels: Record<WorkScriptKind, string> = {
    message: "رسالة للطالب",
    reply: "رد جاهز",
    followup: "متابعة",
    other: "أخرى"
  };
  const scripts = (data.scripts ?? [])
    .filter((script) => !kindFilter || script.kind === kindFilter)
    .filter((script) => !categoryFilter || script.category === categoryFilter)
    .filter((script) => (script.title + " " + script.category + " " + script.body).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const categories = Array.from(new Set((data.scripts ?? []).map((script) => script.category.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
  const resetEditor = () => {
    setShowEditor(false);
    setEditingId("");
    setTitle("");
    setKind("message");
    setCategory("");
    setBody("");
  };
  const startNew = () => {
    setEditingId("");
    setTitle("");
    setKind("message");
    setCategory("");
    setBody("");
    setShowEditor(true);
  };
  const editScript = (script: WorkScript) => {
    setEditingId(script.id);
    setTitle(script.title);
    setKind(script.kind);
    setCategory(script.category);
    setBody(script.body);
    setShowEditor(true);
  };
  const viewScript = (script: WorkScript) => setViewingScript(script);
  const saveScript = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const stamp = Date.now();
    commit((draft) => {
      const existing = draft.scripts.find((script) => script.id === editingId);
      if (existing) Object.assign(existing, { title: title.trim(), kind, category: category.trim(), body: body.trim(), updatedAt: stamp });
      else draft.scripts.unshift({ id: uid(), title: title.trim(), kind, category: category.trim(), body: body.trim(), createdAt: stamp, updatedAt: stamp });
    }, editingId ? "تم تحديث السكريبت." : "تم حفظ السكريبت.");
    resetEditor();
  };
  const copyScript = async (script: WorkScript) => {
    try {
      await safeCopy(script.body);
      setCopiedId(script.id);
      setCopyMessage("تم نسخ نص السكريبت.");
    } catch {
      setCopiedId(script.id);
      setCopyMessage("تعذر النسخ إلى الحافظة.");
    }
  };
  return <>
    <PageHead title="سكريبتات ورسائل العمل" description="احفظ الرسائل والردود الجاهزة، وابحث فيها وانسخها وقت التواصل مع الطلاب." actions={<button className="btn" onClick={startNew}><Plus size={16} />إضافة سكريبت</button>} />
    {showEditor && <section className="section script-editor">
      <div className="section-head"><div><h2>{editingId ? "تعديل السكريبت" : "إضافة سكريبت جديد"}</h2><p>احفظ النص كاملًا مع تصنيفه لتسهيل العثور عليه.</p></div><button className="btn btn--ghost btn--icon" type="button" onClick={resetEditor} aria-label="إغلاق"><X size={17} /></button></div>
      <form className="grid-form" onSubmit={saveScript}>
        <div className="field"><label>اسم السكريبت</label><input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="مثال: رسالة ترحيب" /></div>
        <div className="field"><label>النوع</label><select value={kind} onChange={(event) => setKind(event.target.value as WorkScriptKind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="field"><label>التصنيف</label><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="مثال: تحديد مستوى أو تجديد" /></div>
        <div className="field span-2"><label>نص الرسالة أو الرد</label><textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} required placeholder="اكتب النص الذي تريد حفظه…" /></div>
        <div className="toolbar span-2"><button className="btn" type="submit"><Check size={15} />حفظ</button><button className="btn btn--ghost" type="button" onClick={resetEditor}>إلغاء</button></div>
      </form>
    </section>}
    <section className="section">
      <div className="toolbar script-filters">
        <input className="search-input" placeholder="ابحث في الاسم أو التصنيف أو النص" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="فلترة حسب النوع" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="">كل الأنواع</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="فلترة حسب التصنيف" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">كل التصنيفات</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <span className="tag tag--muted">{scripts.length} سكريبت</span>
      </div>
      <div className="card-list script-list">{scripts.length ? scripts.map((script) => <article className="entity-card script-card" key={script.id}>
        <div className="entity-card__top"><h3>{script.title}</h3></div>
        <div className="entity-card__actions"><button className="btn btn--small" type="button" onClick={() => void copyScript(script)}><Copy size={14} />نسخ</button><button className="btn btn--ghost btn--small" type="button" onClick={() => viewScript(script)}>عرض</button><button className="btn btn--danger btn--small" type="button" onClick={() => { if (!window.confirm("حذف السكريبت «" + script.title + "»؟")) return; commit((draft) => { draft.scripts = draft.scripts.filter((item) => item.id !== script.id); }, "تم حذف السكريبت."); }}>حذف</button></div>
        {copyMessage && copiedId === script.id && <p className="script-copy-feedback" role="status">{copyMessage}</p>}
      </article>) : <div className="empty">لا توجد سكريبتات مطابقة. أضف أول رسالة جاهزة من الزر أعلاه.</div>}</div>
    </section>
    {viewingScript && <Overlay onClose={() => setViewingScript(null)}><section className="section script-view-dialog"><div className="section-head"><div><h2>{viewingScript.title}</h2><p>{kindLabels[viewingScript.kind]}{viewingScript.category ? ` · ${viewingScript.category}` : ""}</p></div><button className="btn btn--ghost btn--icon" type="button" onClick={() => setViewingScript(null)} aria-label="إغلاق"><X size={17} /></button></div><div className="script-card__body script-view-dialog__body">{viewingScript.body}</div><div className="toolbar"><button className="btn btn--small" type="button" onClick={() => void copyScript(viewingScript)}><Copy size={14} />نسخ</button><button className="btn btn--ghost btn--small" type="button" onClick={() => { editScript(viewingScript); setViewingScript(null); }}>تعديل</button></div>{copyMessage && copiedId === viewingScript.id && <p className="script-copy-feedback" role="status">{copyMessage}</p>}</section></Overlay>}
  </>;
}
type PersonRecord = { id: string; profileId?: string; n?: string; ph?: string; movedToLeadId?: string; movedFromStudentId?: string; copiedFromStudentId?: string };

function studentCodeFor(record: { studentCode?: string; profileId?: string; movedFromStudentId?: string; copiedFromStudentId?: string; id: string }): string {
  const stableId = String(record.profileId || record.movedFromStudentId || record.copiedFromStudentId || record.id);
  return record.studentCode || `SPK-${stableId}`;
}

function personPhone(value?: string): string {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10)).replace(/\D/g, "");
}

function samePerson(first: PersonRecord, second: PersonRecord): boolean {
  const firstIds = [first.profileId, first.id, first.movedToLeadId, first.movedFromStudentId, first.copiedFromStudentId].filter(Boolean);
  const secondIds = [second.profileId, second.id, second.movedToLeadId, second.movedFromStudentId, second.copiedFromStudentId].filter(Boolean);
  if (firstIds.some((id) => secondIds.includes(id))) return true;
  const firstPhone = personPhone(first.ph);
  const secondPhone = personPhone(second.ph);
  if (firstPhone.length >= 8 && secondPhone.length >= 8) return firstPhone.slice(-9) === secondPhone.slice(-9);
  return firstPhone.length < 8 && secondPhone.length < 8 && Boolean(normalise(first.n)) && normalise(first.n) === normalise(second.n);
}

function sameStudentIdentity(first: PersonRecord, second: PersonRecord): boolean {
  if (samePerson(first, second)) return true;
  const firstCode = studentCodeFor(first).toLocaleUpperCase();
  const secondCode = studentCodeFor(second).toLocaleUpperCase();
  return firstCode === secondCode;
}

function displayStudentName(student: Student, data: AcademyData): string {
  const clean = (value?: string) => {
    const name = String(value ?? "").trim();
    return /^[-–—]+$/.test(name) ? "" : name;
  };
  const ownName = clean(student.n);
  if (ownName) return ownName;
  const linkedLead = live(data.l).find((lead) => sameStudentIdentity(student, lead) && clean(lead.n))
    ?? data.l.find((lead) => sameStudentIdentity(student, lead) && clean(lead.n));
  if (linkedLead?.n) return clean(linkedLead.n);
  const group = data.g.find((item) => item.id === student.g);
  return clean(group?.p ? group.lv : "") || "بدون اسم";
}

function archiveRelatedLeads(data: AcademyData, student: Student, stamp = Date.now()): void {
  data.l.filter((lead) => !lead.x && samePerson(student, lead)).forEach((lead) => { lead.x = 1; lead.xa = stamp; });
}

function isListedInFormerCustomers(student: Student, data: AcademyData): boolean {
  return data.m.some((copy) => copy.movedToTab === "renewals" && copy.copiedFromStudentId === student.id);
}

function isActiveStudentEnrollment(student: Student, data: AcademyData): boolean {
  if (student.x || !isEnrolledStudent(student)) return false;
  const group = data.g.find((item) => item.id === student.g);
  if (!group || group.x || !isGroupOperationalToday(group)) return false;
  return group.p ? true : isRoundActive(data, group.r);
}

function hasActiveStudentEnrollment(person: PersonRecord, data: AcademyData): boolean {
  return live(data.m).some((student) => sameStudentIdentity(person, student) && isActiveStudentEnrollment(student, data));
}

function leadHasStudentRecord(lead: Lead, data: AcademyData): boolean {
  return hasActiveStudentEnrollment(lead, data);
}

function uniqueLeads(items: Lead[]): Lead[] {
  const newestFirst = [...items].sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0));
  return newestFirst.filter((lead, index) => !newestFirst.slice(0, index).some((seen) => sameStudentIdentity(lead, seen)));
}

function formerCustomerRows(data: AcademyData): Student[] {
  const candidates = studentsInNonArchivedGroups(data)
    .filter((student) => !hasLaterStudentEnrollment(student, data) && (student.movedToTab === "renewals" || (!student.movedToTab && Boolean(student.formerAt) && Number(student.ren) !== 2)))
    .sort((a, b) => Number(b.formerAt ?? 0) - Number(a.formerAt ?? 0));
  return candidates.filter((student, index) => !candidates.slice(0, index).some((seen) => sameStudentIdentity(student, seen)));
}

function LeadsView({ data, bucket, commit }: { data: AcademyData; bucket: "next" | "leads"; commit: Commit }) {
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const title = bucket === "next" ? "عملاء الراوند الجاي" : "الليدز";
  const queryDigits = personPhone(query);
  const matchesCustomerQuery = (name: string, phone: string, extra = "", code = "") => `${name} ${phone} ${extra}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    || Boolean(!isStudentCodeQuery(query) && queryDigits && personPhone(phone).includes(queryDigits))
    || matchesStudentCode(code, query);
  const formerCustomers = formerCustomerRows(data).filter((student) => !hasActiveStudentEnrollment(student, data));
  const formerRows = bucket === "next" ? formerCustomers : [];
  const visibleFormerRows = formerRows
    .filter((student) => !statusFilter || leadFollowupValue(student) === statusFilter)
    .filter((student) => !sourceFilter || student.source === sourceFilter)
    .filter((student) => matchesCustomerQuery(student.n ?? "", student.ph ?? "", `${student.source ?? ""} ${student.sourceOther ?? ""}`, studentCodeFor(student)));
  const leads = sortLeads(uniqueLeads(live(data.l).filter((lead) => !lead.convertedStudentId && !leadHasStudentRecord(lead, data)))
    .filter((lead) => leadBucket(lead) === bucket)
    .filter((lead) => !formerCustomers.some((student) => samePerson(student, lead)))
    .filter((lead) => !statusFilter || lead.followupCat === statusFilter)
    .filter((lead) => !sourceFilter || lead.source === sourceFilter)
    .filter((lead) => matchesCustomerQuery(lead.n ?? "", lead.ph ?? "", `${lead.lv ?? ""} ${lead.nt ?? ""} ${lead.followupReason ?? ""} ${lead.source ?? ""} ${lead.sourceOther ?? ""}`, studentCodeFor(lead))));
  const totalCount = leads.length + visibleFormerRows.length;
  return <><PageHead title={title} description={bucket === "next" ? "عملاء الراوند الجاي، ويظهر هنا أيضًا العملاء السابقون الذين لم يجددوا." : "إدارة الليدز وتصنيف المتابعة والمستوى المطلوب من قائمة واحدة."} actions={<><CopyAllNumbersButton phones={[...visibleFormerRows.map((student) => student.ph), ...leads.map((lead) => lead.ph)]} /><button className="btn" onClick={() => setShowForm((open) => !open)}><Plus size={16} />إضافة عميل</button></>} />
    {showForm && <LeadForm initialBucket={bucket} data={data} onClose={() => setShowForm(false)} commit={commit} />}
    <section className="section"><div className="toolbar"><input className="search-input" placeholder="بحث بالاسم أو الرقم أو المستوى" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">كل التصنيفات</option>{LEAD_FOLLOWUP_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="فلترة حسب المصدر" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">كل المصادر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select><span className="tag tag--muted">{totalCount} عنصر</span></div>
      <div className="former-customer-list">{visibleFormerRows.map((student) => <FormerCustomerCard key={`former-${student.id}`} student={student} data={data} commit={commit} canEdit />)}</div>
      <div className="card-list">{leads.map((lead, index) => <LeadCard key={lead.id} lead={lead} data={data} commit={commit} toneIndex={index} />)}{totalCount === 0 && <div className="empty">لا توجد عناصر في هذه القائمة.</div>}</div>
    </section></>;
}

function LeadForm({ initialBucket, data, onClose, commit }: { initialBucket: "next" | "leads"; data: AcademyData; onClose: () => void; commit: Commit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [category, setCategory] = useState("interested");
  const [followup, setFollowup] = useState("");
  const [followupReason, setFollowupReason] = useState("");
  const [enrollmentType, setEnrollmentType] = useState<"" | "group" | "private">("");
  const [formError, setFormError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !phone.trim()) { setFormError("اكتب الاسم أو رقم التواصل."); return; }
    if (!enrollmentType) { setFormError("اختار نوع الاشتراك جروب أو Private."); return; }
    if (category === "level_completed" && !level) { setFormError("اختار المستوى بعد «تم تحديد المستوى»."); return; }
    const candidate: Lead = { id: "new-lead", n: name.trim(), ph: phone.trim() };
    if (formerCustomerRows(data).some((student) => samePerson(candidate, student) && !hasActiveStudentEnrollment(student, data))) {
      setFormError("العميل موجود بالفعل ضمن عملاء الراوند الجاي؛ حدّث بطاقته هناك بدل إنشاء سجل مكرر.");
      return;
    }
    if (hasActiveStudentEnrollment(candidate, data)) {
      setFormError("للشخص ده تسجيل في جروب شغال بالفعل. استخدم بطاقة الطالب أو أضف راوندًا جديدًا بعد انتهاء تسجيله.");
      return;
    }
    const stamp = Date.now();
    const selectedCategory = LEAD_FOLLOWUP_OPTIONS.find((option) => option.value === category);
    const relatedStudent = live(data.m).find((student) => samePerson(candidate, student));
    let existed = false;
    commit((draft) => {
      const matches = live(draft.l).filter((lead) => samePerson(candidate, lead));
      const existing = matches.sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0))[0];
      if (existing) {
        existed = true;
        matches.filter((lead) => lead.id !== existing.id).forEach((lead) => { lead.x = 1; lead.xa = stamp; });
        Object.assign(existing, { profileId: existing.profileId || relatedStudent?.profileId || relatedStudent?.id || existing.id, studentCode: existing.studentCode || relatedStudent?.studentCode, kind: existing.kind ?? (relatedStudent ? studentKind(relatedStudent) === "new" ? "returned" : studentKind(relatedStudent) : undefined), subscriptionClass: existing.subscriptionClass ?? (relatedStudent ? "renewal" : undefined), n: name.trim(), ph: phone.trim(), lv: level, tm: time, nt: note, source, sourceOther: sourceOther.trim(), st: selectedCategory?.label ?? "مهتم",
          bucket: initialBucket === "next" ? "next" : "",
          source_sheet: initialBucket === "next" ? "next round" : "lead",
          followupCat: category, fd: followup, followupReason: followup ? "" : followupReason.trim(), enrollmentType, ts: stamp });
      } else { const id = uid(); const historical = draft.m.find((student) => samePerson(candidate, student)); draft.l.push({ id, profileId: historical?.profileId || historical?.id || id, studentCode: historical?.studentCode, kind: historical ? studentKind(historical) === "new" ? "returned" : studentKind(historical) : "new", subscriptionClass: historical ? "renewal" : "new", subscriptionSource: source, subscriptionSourceOther: sourceOther.trim(), n: name.trim(), ph: phone.trim(), lv: level, tm: time, nt: note, source, sourceOther: sourceOther.trim(), st: selectedCategory?.label ?? "مهتم",
        bucket: initialBucket === "next" ? "next" : "",
        source_sheet: initialBucket === "next" ? "next round" : "lead",
        followupCat: category, fd: followup, followupReason: followup ? "" : followupReason.trim(), enrollmentType, ts: stamp }); }
    }, existed ? "تم تحديث ملف العميل الموجود ونقله إلى هذا التبويب." : "تمت إضافة العميل.");
    onClose();
  };
  return <section className="section"><div className="section-head"><div><h2>إضافة عميل</h2><p>أضف بيانات التواصل وموعد المتابعة والتصنيف المناسب.</p></div><button className="btn btn--ghost btn--icon" onClick={onClose}><X size={17} /></button></div>
    <form className="grid-form" onSubmit={submit}>
      <div className="field"><label>الاسم</label><input value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="field"><label>التليفون / يوزر</label><input dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
      <div className="field"><label>نوع الاشتراك</label><select required value={enrollmentType} onChange={(event) => { setEnrollmentType(event.target.value as typeof enrollmentType); setFormError(""); }}><option value="">اختر النوع</option><option value="group">جروب</option><option value="private">Private</option></select></div>
      <div className="field"><label>{category === "level_completed" ? "المستوى بعد التحديد *" : "المستوى (اختياري)"}</label><select required={category === "level_completed"} value={level} onChange={(event) => { setLevel(event.target.value); setFormError(""); }}><option value="">{category === "level_completed" ? "اختار المستوى" : "غير محدد"}</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="field"><label>الوقت المفضل</label><input value={time} onChange={(event) => setTime(event.target.value)} /></div>
      <div className="field"><label>المصدر</label><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></div>{source === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={sourceOther} onChange={(event) => setSourceOther(event.target.value)} /></div>}
      <div className="field"><label>تصنيف المتابعة</label><select value={category} onChange={(event) => { setCategory(event.target.value); setFormError(""); }} aria-label="تصنيف المتابعة">{LEAD_FOLLOWUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <div className="field"><label>موعد المتابعة</label><input type="date" value={followup} onChange={(event) => setFollowup(event.target.value)} /></div>
      {!followup && <div className="field span-2"><label>سبب عدم تحديد المتابعة</label><input value={followupReason} onChange={(event) => setFollowupReason(event.target.value)} placeholder="مثال: انتظار رد أو تحديد مستوى" /></div>}
      <div className="field"><label>ملاحظة</label><input value={note} onChange={(event) => setNote(event.target.value)} /></div>
      {formError && <div className="form-error span-2" role="alert">{formError}</div>}
      <button className="btn" type="submit">حفظ العميل</button>
    </form>
  </section>;
}

function leadFollowupValue(lead: { followupCat?: string; st?: string }): string {
  const value = String(lead.followupCat ?? "");
  if (value === "level" && String(lead.st ?? "").includes("تم تحديد")) return "level_completed";
  if (LEAD_FOLLOWUP_OPTIONS.some((option) => option.value === value)) return value;
  if (value === "contact") return "interested";
  if (value === "waiting") return "hesitant";
  if (value === "later") return "call_again";
  if (value === "done" || /مش مهتم|غير مهتم/.test(String(lead.st ?? ""))) return "not_interested";
  if (value === "level" || /هيعمل.*تحديد/.test(String(lead.st ?? ""))) return "level";
  if (/تم تحديد المستوى/.test(String(lead.st ?? ""))) return "level_completed";
  return "interested";
}

function hasLaterStudentEnrollment(student: Student, data: AcademyData): boolean {
  const originalGroup = data.g.find((group) => group.id === student.g);
  if (!originalGroup) return false;
  const originalEnd = plannedGroupEndDate(originalGroup) || String(originalGroup.e ?? originalGroup.s ?? "").slice(0, 10);
  if (!originalEnd) return false;
  return live(data.m).some((candidate) => {
    if (candidate.id === student.id || candidate.g === student.g || !samePerson(student, candidate)) return false;
    const group = data.g.find((item) => item.id === candidate.g);
    if (!group || group.x || !isEnrolledStudent(candidate)) return false;
    const start = String(group.s ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(start) && start > originalEnd;
  });
}

function LeadCard({ lead, data, commit, toneIndex }: { lead: Lead; data: AcademyData; commit: Commit; toneIndex: number }) {
  const [category, setCategory] = useState(leadFollowupValue(lead));
  const [levelValue, setLevelValue] = useState(lead.lv ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ n: lead.n ?? "", ph: lead.ph ?? "", lv: lead.lv ?? "", tm: lead.tm ?? "", nt: lead.nt ?? "", followupReason: lead.followupReason ?? "", source: lead.source ?? "", sourceOther: lead.sourceOther ?? "" });
  const [copyFeedback, setCopyFeedback] = useState("");
  const linkedSource = data.m.find((student) => student.id === lead.movedFromStudentId) ?? live(data.m).find((student) => sameStudentIdentity(lead, student));
  const cleanName = (value?: string) => { const name = String(value ?? "").trim(); return /^[-–—]+$/.test(name) ? "" : name; };
  const displayName = cleanName(lead.n) || cleanName(linkedSource?.n) || "بدون اسم";
  const [enrollmentType, setEnrollmentType] = useState<"" | "group" | "private">(lead.enrollmentType ?? linkedSource?.enrollmentType ?? (linkedSource ? (data.g.find((group) => group.id === linkedSource.g)?.p ? "private" : "group") : ""));
  const updateBucket = (value: string) => {
    commit((current) => {
      const target = current.l.find((item) => item.id === lead.id);
      if (!target) return;
      target.bucket = value === "next" ? "next" : "";
      target.source_sheet = value === "next" ? "next round" : "lead";
    }, "تم نقل العميل.");
  };
  const changeFollowupCategory = (value: string) => {
    setCategory(value);
    if (value === "level_completed" && !levelValue) return;
    const selectedCategory = LEAD_FOLLOWUP_OPTIONS.find((option) => option.value === value);
    commit((current) => {
      const target = current.l.find((item) => item.id === lead.id);
      if (!target) return;
      target.followupCat = value;
      target.st = selectedCategory?.label ?? "مهتم";
      target.followupDoneAt = undefined;
    }, "تم تحديث تصنيف المتابعة.");
  };
  const saveLevelClassification = () => {
    if (!levelValue) return;
    commit((current) => {
      const target = current.l.find((item) => item.id === lead.id);
      if (!target) return;
      target.lv = levelValue;
      target.followupCat = "level_completed";
      target.st = "تم تحديد المستوى";
    }, "تم حفظ المستوى المحدد.");
    setCategory("level_completed");
  };
  const saveEdit = () => {
    if (category === "level_completed" && !draft.lv) { window.alert("اختار المستوى قبل حفظ بيانات تحديد المستوى."); return; }
    commit((current) => { const target = current.l.find((item) => item.id === lead.id); if (target) Object.assign(target, draft, { enrollmentType: enrollmentType || undefined }); }, "تم حفظ بيانات العميل.");
    setEditing(false);
  };
  const changeEnrollmentType = (value: "group" | "private" | "") => {
    setEnrollmentType(value);
    commit((current) => { const target = current.l.find((item) => item.id === lead.id); if (target) target.enrollmentType = value || undefined; }, "تم تحديث نوع الاشتراك المطلوب.");
  };
  const archiveLead = () => {
    if (!window.confirm(`أرشفة «${lead.n || lead.ph || "العميل"}»؟ ستظل بياناته محفوظة في الأرشيف.`)) return;
    const stamp = Date.now();
    commit((current) => {
      current.l.filter((item) => !item.x && samePerson(lead, item)).forEach((item) => { item.x = 1; item.xa = stamp; });
    }, "تمت أرشفة العميل مع الاحتفاظ ببياناته.");
  };
  const copy = (value: string, label: string) => safeCopy(value).then(() => { setCopyFeedback(`تم نسخ ${label}.`); window.setTimeout(() => setCopyFeedback(""), 2500); });
  const code = studentCodeFor(lead);
  const phone = lead.ph || linkedSource?.ph || "";
  return <div id={`lead-record-${lead.id}`} className={`entity-card prospect-card ${toneIndex % 2 ? "prospect-card--gray" : "prospect-card--light"}`}>
    <div className="student-card__summary crm-card-summary">
      <div className="student-card__identity"><StudentNameWithNote name={displayName} note={lead.nt} /><div className="student-card__phone-line"><bdi className="phone-number" dir="ltr">{phone || "بدون رقم"}</bdi>{phone && <button type="button" className="btn btn--ghost btn--small student-card__copy-phone" onClick={() => void copy(phone, "رقم الهاتف")} aria-label="نسخ رقم الهاتف" title="نسخ رقم الهاتف"><Copy size={13} /></button>}</div></div>
      <span className="tag student-card__level">{visibleLevel(lead.lv) || lead.lv || "بدون Level"}</span>
      <button type="button" className="tag tag--muted student-system-id code-copy" title="نسخ كود العميل" onClick={() => void copy(code, "كود العميل")}><bdi dir="ltr">{code}</bdi><Copy size={12} /></button>
      <button type="button" className="btn btn--ghost btn--small student-card__copy-all" onClick={() => void copy([displayName, phone, lead.lv || "", code].join("\t"), "بيانات العميل")}><Copy size={13} />نسخ البيانات</button>
    </div>
    <details className="student-actions-panel lead-actions-panel"><summary>إجراءات أخرى<ChevronDown size={15} /></summary><div className="student-actions-panel__body">
      {editing ? <div className="grid-form"><div className="field"><label>الاسم</label><input value={draft.n} onChange={(event) => setDraft({ ...draft, n: event.target.value })} /></div><div className="field"><label>التليفون / يوزر</label><input dir="ltr" value={draft.ph} onChange={(event) => setDraft({ ...draft, ph: event.target.value })} /></div><div className="field"><label>{category === "level_completed" ? "المستوى *" : "المستوى"}</label><select required={category === "level_completed"} value={draft.lv} onChange={(event) => setDraft({ ...draft, lv: event.target.value })}><option value="">{category === "level_completed" ? "اختار المستوى" : "غير محدد"}</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></div><div className="field"><label>الوقت المفضل</label><input value={draft.tm} onChange={(event) => setDraft({ ...draft, tm: event.target.value })} /></div><div className="field"><label>ملاحظة</label><input value={draft.nt} onChange={(event) => setDraft({ ...draft, nt: event.target.value })} /></div>{!leadFollowupDate(lead) && <div className="field span-2"><label>سبب عدم تحديد المتابعة</label><input value={draft.followupReason} onChange={(event) => setDraft({ ...draft, followupReason: event.target.value })} placeholder="مثال: انتظار رد أو تحديد مستوى" /></div>}<div className="field"><label>المصدر</label><select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></div>{draft.source === "أخرى" && <div className="field"><label>وصف المصدر</label><input value={draft.sourceOther} onChange={(event) => setDraft({ ...draft, sourceOther: event.target.value })} /></div>}<button className="btn" onClick={saveEdit}>حفظ التعديل</button></div> : <>
        <div className="entity-card__meta"><span className="tag tag--muted">المصدر: {studentSourceLabel(lead)}</span>{leadFollowupDate(lead) && <span className="tag tag--warning">متابعة {formatDate(leadFollowupDate(lead))}</span>}{lead.nt && <span className="tag tag--muted">{lead.nt}</span>}{!leadFollowupDate(lead) && <span className={`tag ${lead.followupReason?.trim() ? "tag--warning" : "tag--danger"}`}>{lead.followupReason?.trim() ? `سبب عدم المتابعة: ${lead.followupReason}` : "سبب عدم المتابعة غير مسجل"}</span>}{Boolean(lead.convertedStudentId) && <span className="tag">تم تحويله لطالب</span>}</div>
        <div className="entity-card__actions"><select value={category} onChange={(event) => changeFollowupCategory(event.target.value)} aria-label="تصنيف المتابعة">{LEAD_FOLLOWUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select defaultValue="" onChange={(event) => { if (event.target.value) updateBucket(event.target.value); }}><option value="">نقل إلى…</option><option value="next">عملاء الراوند الجاي</option><option value="leads">الليدز</option></select>
          {lead.ph && <button className="btn btn--ghost btn--small" onClick={() => void copy(lead.ph ?? "", "الرقم")}><Copy size={13} />نسخ الرقم</button>}
          <button className="btn btn--ghost btn--small" onClick={() => setEditing(true)}>تعديل بيانات</button>
          <button className="btn btn--ghost btn--small" onClick={archiveLead}><ArchiveRestore size={13} />أرشفة الطالب</button>
        </div>
        {category === "level_completed" && !lead.lv && <div className="entity-card__actions lead-level-required"><label className="field-inline"><span>المستوى بعد التحديد *</span><select required value={levelValue} onChange={(event) => setLevelValue(event.target.value)}><option value="">اختار المستوى</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label><button className="btn btn--small" disabled={!levelValue} onClick={saveLevelClassification}>حفظ المستوى</button></div>}
        <FollowupControls record={lead} data={data} onSave={(dateValue, noteValue) => commit((current) => { const target = current.l.find((item) => item.id === lead.id); if (target) saveFollowup(target, dateValue, noteValue); }, "تم حفظ متابعة الليد.")} />
        {!lead.convertedStudentId && <div className="entity-card__actions"><label className="field-inline"><span>نوع الاشتراك المطلوب</span><select aria-label="نوع الاشتراك المطلوب" value={enrollmentType} onChange={(event) => changeEnrollmentType(event.target.value as typeof enrollmentType)}><option value="">اختر النوع</option><option value="group">جروب</option><option value="private">Private</option></select></label></div>}
      </>}
      {copyFeedback && <p className="copy-feedback" role="status">{copyFeedback}</p>}
    </div></details>
  </div>;
}

function FormerCustomerCard({ student, data, commit, canEdit }: { student: Student; data: AcademyData; commit: Commit; canEdit: boolean }) {
  const [enrollmentType, setEnrollmentType] = useState<"group" | "private">(student.enrollmentType ?? (data.g.find((group) => group.id === student.g)?.p ? "private" : "group"));
  const [followupCategory, setFollowupCategory] = useState(leadFollowupValue(student));
  const [levelValue, setLevelValue] = useState(student.lv ?? "");
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ n: student.n ?? "", ph: student.ph ?? "", lv: student.lv ?? "", nt: student.nt ?? "", source: student.source ?? "", sourceOther: student.sourceOther ?? "" });
  const [copied, setCopied] = useState("");
  const group = data.g.find((item) => item.id === student.g);
  const copy = (value: string, label: string) => safeCopy(value).then(() => { setCopied(`تم نسخ ${label}.`); window.setTimeout(() => setCopied(""), 2500); });
  const isCopy = Boolean(student.copiedFromStudentId);
  const changeFollowupCategory = (value: string) => {
    setFollowupCategory(value);
    if (value === "level_completed" && !levelValue) return;
    const label = LEAD_FOLLOWUP_OPTIONS.find((option) => option.value === value)?.label ?? value;
    commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { target.followupCat = value; target.st = label; target.followupDoneAt = undefined; } }, "تم تحديث تصنيف المتابعة.");
  };
  const saveCompletedLevel = () => {
    if (!levelValue) return;
    commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { target.lv = levelValue; target.followupCat = "level_completed"; target.st = "تم تحديد المستوى"; target.followupDoneAt = undefined; } }, "تم حفظ المستوى المحدد.");
    setFollowupCategory("level_completed");
  };
  const saveEdit = () => {
    if (!editDraft.n.trim()) { window.alert("اكتب اسم الطالب قبل الحفظ."); return; }
    if (followupCategory === "level_completed" && !editDraft.lv) { window.alert("اختار المستوى قبل حفظ بيانات تحديد المستوى."); return; }
    commit((draft) => {
      const target = draft.m.find((item) => item.id === student.id && !item.x);
      if (!target) return;
      Object.assign(target, editDraft, { n: editDraft.n.trim(), ph: editDraft.ph.trim(), nt: editDraft.nt.trim(), sourceOther: editDraft.sourceOther.trim() });
      if (followupCategory === "level_completed") { target.followupCat = "level_completed"; target.st = "تم تحديد المستوى"; target.followupDoneAt = undefined; }
    }, "تم تعديل بيانات نسخة المتابعة فقط؛ السجل الأصلي محفوظ دون تغيير.");
    setLevelValue(editDraft.lv);
    setEditing(false);
  };
  const moveBack = () => commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { delete target.formerAt; delete target.movedToTab; delete target.movedToLeadId; } }, "أُعيد الطالب إلى سجله السابق.");
  const archive = () => {
    if (!window.confirm(`أرشفة «${student.n || "الطالب"}» من قائمة العملاء القدام؟`)) return;
    commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { removeStudentAttendance(draft, target.id); target.x = 1; target.xa = Date.now(); } }, isCopy ? "تمت أرشفة النسخة؛ السجل الأصلي محفوظ." : "تمت أرشفة الطالب مع الاحتفاظ ببياناته وحذف علامات حضوره وغيابه.");
  };
  return <article id={"student-record-" + student.id} className="former-customer-card">
    <div className="student-card__summary former-card-summary">
      <div className="student-card__identity"><StudentNameWithNote name={displayStudentName(student, data)} note={student.nt} /><div className="student-card__phone-line">{student.ph ? <button type="button" className="phone phone-number former-customer-phone" dir="ltr" onClick={() => void copy(student.ph ?? "", "رقم الهاتف")}>{student.ph}<Copy size={12} /></button> : <span className="phone">بدون رقم</span>}</div></div>
      <span className="tag student-card__level">{student.lv || "بدون Level"}</span>
      <button type="button" className="tag tag--muted student-system-id code-copy" title="نسخ كود العميل" onClick={() => void copy(studentCodeFor(student), "كود العميل")}><bdi dir="ltr">{studentCodeFor(student)}</bdi><Copy size={12} /></button>
      <button type="button" className="btn btn--ghost btn--small student-card__copy-all" onClick={() => void copy([displayStudentName(student, data), student.ph || "", student.lv || "", studentCodeFor(student)].join("\t"), "بيانات الطالب")}><Copy size={13} />نسخ البيانات</button>
    </div>
    <details className="student-actions-panel former-customer-actions"><summary>إجراءات أخرى<ChevronDown size={15} /></summary><div className="student-actions-panel__body">
      <div className="former-customer-card__meta"><span>{isCopy ? student.autoFormerCustomer ? "نسخة تلقائية" : "نسخة" : "عميل قديم"}</span><span>{group?.p ? "Private" : roundName(data.r.find((round) => round.id === student.r || round.id === group?.r))}</span><span>{group ? groupLabel(group) : "مجموعة غير موجودة"}</span><span>{studentKindLabel(studentKind(student))}</span><span>{studentSourceLabel(student)}</span></div>
      {editing && canEdit && <div className="grid-form former-customer-card__edit"><div className="field"><label>اسم الطالب</label><input value={editDraft.n} onChange={(event) => setEditDraft({ ...editDraft, n: event.target.value })} /></div><div className="field"><label>رقم الهاتف</label><input dir="ltr" value={editDraft.ph} onChange={(event) => setEditDraft({ ...editDraft, ph: event.target.value })} /></div><div className="field"><label>المستوى</label><select value={editDraft.lv} onChange={(event) => setEditDraft({ ...editDraft, lv: event.target.value })}><option value="">غير محدد</option>{editDraft.lv && !LEVELS.includes(editDraft.lv) && <option value={editDraft.lv}>{editDraft.lv} · مستوى محفوظ</option>}{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></div><div className="field"><label>المصدر</label><select value={editDraft.source} onChange={(event) => setEditDraft({ ...editDraft, source: event.target.value })}><option value="">اختر المصدر</option>{STUDENT_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></div>{editDraft.source === "أخرى" && <div className="field"><label>تفاصيل المصدر</label><input value={editDraft.sourceOther} onChange={(event) => setEditDraft({ ...editDraft, sourceOther: event.target.value })} /></div>}<div className="field span-2"><label>ملاحظة</label><input value={editDraft.nt} onChange={(event) => setEditDraft({ ...editDraft, nt: event.target.value })} /></div><div className="toolbar span-2"><button type="button" className="btn btn--small" onClick={saveEdit}>حفظ التعديل</button><button type="button" className="btn btn--ghost btn--small" onClick={() => { setEditDraft({ n: student.n ?? "", ph: student.ph ?? "", lv: student.lv ?? "", nt: student.nt ?? "", source: student.source ?? "", sourceOther: student.sourceOther ?? "" }); setEditing(false); }}>إلغاء</button></div></div>}
      {canEdit && <div className="former-customer-card__actions"><label className="field-inline"><span>نوع الاشتراك القادم</span><select value={enrollmentType} onChange={(event) => { const value = event.target.value as "group" | "private"; setEnrollmentType(value); commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) target.enrollmentType = value; }, "تم تحديث نوع الاشتراك المطلوب."); }}><option value="group">جروب</option><option value="private">Private</option></select></label><label className="field-inline"><span>تصنيف المتابعة</span><select value={followupCategory} onChange={(event) => changeFollowupCategory(event.target.value)}>{LEAD_FOLLOWUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{followupCategory === "level_completed" && !student.lv && <div className="field-inline"><span>المستوى بعد التحديد *</span><select required value={levelValue} onChange={(event) => setLevelValue(event.target.value)}><option value="">اختر المستوى</option>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select><button type="button" className="btn btn--small" disabled={!levelValue} onClick={saveCompletedLevel}>حفظ المستوى</button></div>}<FollowupControls record={student} data={data} onSave={(date, note) => commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) saveFollowup(target, date, note); }, "تم حفظ متابعة العميل.")} /><button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing((value) => !value)}>{editing ? "إغلاق تعديل البيانات" : "تعديل بيانات الطالب"}</button>{!isCopy && <button type="button" className="btn btn--ghost btn--small" onClick={moveBack}>إعادة للسجل السابق</button>}<button type="button" className="btn btn--ghost btn--small" onClick={archive}><ArchiveRestore size={13} />أرشفة الطالب</button></div>}
    </div></details>
    {copied && <p className="copy-feedback" role="status">{copied}</p>}
  </article>;
}
function AttendanceView({ data, profile, initialGroup, onSelected, setAttendance, commit }: {
  data: AcademyData;
  profile: Profile;
  initialGroup: string;
  onSelected: (id: string) => void;
  setAttendance: (date: string, gid: string, mid: string, status: AttendanceStatus, teacher: string) => void;
  commit: Commit;
}) {
  const allActiveGroups = activeGroups(data).filter((group) => !isTeacherNameArchived(data, group.tc)
    && (!group.p || activeStudentsOf(data, group.id).some((student) => !isListedInFormerCustomers(student, data))));
  const [teacherFilter, setTeacherFilter] = useState(profile.role === "teacher" ? String(profile.teacherName ?? "") : "");
  const matchesTeacher = (group: AcademyGroup, filter = teacherFilter) => {
    if (profile.role === "teacher") return Boolean(profile.teacherName) && normalise(group.tc) === normalise(profile.teacherName);
    if (!filter) return true;
    if (filter === "__unassigned") return !String(group.tc ?? "").trim();
    return normalise(group.tc) === normalise(filter);
  };
  const teacherGroups = allActiveGroups.filter((group) => matchesTeacher(group));
  const teacherOptions = [...new Map(allActiveGroups.map((group) => String(group.tc ?? "").trim()).filter(Boolean).map((name) => [normalise(name), name])).values()].sort((a, b) => a.localeCompare(b, "ar"));
  const hasUnassigned = allActiveGroups.some((group) => !String(group.tc ?? "").trim());
  const rounds = live(data.r).filter((round) => isRoundActive(data, round.id) && teacherGroups.some((group) => !group.p && group.r === round.id));
  const initialGroupData = allActiveGroups.find((group) => group.id === initialGroup);
  const startingRound = initialGroupData && !initialGroupData.p ? initialGroupData.r : (rounds.some((round) => round.id === data.cur) ? data.cur : rounds[0]?.id ?? "");
  const [roundFilter, setRoundFilter] = useState(startingRound);
  const [groupId, setGroupId] = useState(initialGroup);
  useEffect(() => {
    setGroupId(initialGroup);
    const selected = allActiveGroups.find((item) => item.id === initialGroup);
    if (selected) {
      if (profile.role !== "teacher") setTeacherFilter(String(selected.tc ?? "").trim() || "__unassigned");
      if (!selected.p) setRoundFilter(selected.r);
    } else if (initialGroup) setGroupId("");
  }, [initialGroup]);
  const groups = teacherGroups.filter((group) => profile.role === "teacher" || Boolean(group.p) || !roundFilter || group.r === roundFilter).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), "ar"));
  const regularGroups = groups.filter((group) => !group.p);
  const privateGroups = groups.filter((group) => Boolean(group.p));
  const group = groupId ? groups.find((item) => item.id === groupId) : undefined;
  const selectGroup = (id: string) => { setGroupId(id); onSelected(id); };
  const selectRound = (id: string) => { setRoundFilter(id); setGroupId(""); onSelected(""); };
  const selectTeacher = (value: string) => {
    setTeacherFilter(value);
    const matching = allActiveGroups.filter((item) => matchesTeacher(item, value) && !item.p);
    const roundStillAvailable = matching.some((item) => item.r === roundFilter);
    if (roundFilter && !roundStillAvailable) setRoundFilter("");
    setGroupId(""); onSelected("");
  };
  const fullGroupName = (item: AcademyGroup) => item.p ? [privateStudentLabel(item, data), item.d, groupTime(item), teacherDisplayName(data, item.tc)].filter(Boolean).join(" · ") : [roundName(data.r.find((round) => round.id === item.r)), item.lv || "بدون اسم", item.d, groupTime(item), teacherDisplayName(data, item.tc)].filter(Boolean).join(" · ");
  const renderGroupChoices = (items: AcademyGroup[]) => <div className="attendance-groups">{items.map((item) => <button className="group-choice" key={item.id} onClick={() => selectGroup(item.id)}><span className="group-choice__colour" style={{ background: colourForGroup(item) }} /><span><strong>{item.p ? privateStudentLabel(item, data) : item.lv || "بدون اسم"}</strong><small>{item.p ? [item.d, groupTime(item), item.tc || "بدون مدرس"].filter(Boolean).join(" · ") : fullGroupName(item)}</small></span></button>)}</div>;

  if (!group) return <><PageHead title="الحضور والغياب" description={profile.role === "teacher" ? "اختر جروبًا من الجروبات المسندة إليك لعرض جدول الجلسات والحضور." : "اختر المدرس والراوند، ثم الجروب أو Private لعرض جدول الجلسات والحضور."} />
    <section className="section"><div className="section-head"><div><h2>الجروبات والـPrivate</h2><p>{profile.role === "teacher" ? "تظهر جروباتك فقط؛ اختَر المجموعة مباشرة دون اختيار راوند." : "تظهر الجروبات النشطة وPrivate المسندة للمدرس؛ اضغط الاسم لفتح التفاصيل الكاملة."}</p></div><span className="tag tag--muted">{groups.length} مجموعة</span></div>
      <div className="toolbar">
        {profile.role !== "teacher" && <label className="field"><span>المدرس</span><select className="search-input" value={teacherFilter} onChange={(event) => selectTeacher(event.target.value)}><option value="">كل المدرسين</option>{teacherOptions.map((name) => <option key={name} value={name}>{name}</option>)}{hasUnassigned && <option value="__unassigned">بدون مدرس</option>}</select></label>}
        {profile.role !== "teacher" && <label className="field"><span>الراوند</span><select className="search-input" value={roundFilter} onChange={(event) => selectRound(event.target.value)}><option value="">كل الراوندات النشطة</option>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select></label>}
      </div>
      {regularGroups.length > 0 && <><div className="section-head"><h3>الجروبات</h3><span className="tag tag--muted">{regularGroups.length}</span></div>{renderGroupChoices(regularGroups)}</>}
      {privateGroups.length > 0 && <><div className="section-head"><h3>Private</h3><span className="tag tag--muted">{privateGroups.length}</span></div>{renderGroupChoices(privateGroups)}</>}
      {!groups.length && <div className="empty">{profile.role === "teacher" ? "لا توجد جروبات نشطة مسندة إليك حاليًا." : "لا توجد جروبات أو جلسات Private مطابقة للمدرس والراوند المختارين."}</div>}
    </section></>;

  return <><PageHead title="الحضور والغياب" description={fullGroupName(group)} actions={<button className="btn btn--ghost" onClick={() => { setGroupId(""); onSelected(""); }}>العودة إلى الجروبات والـPrivate</button>} />
    <AttendanceMatrix group={group} data={data} profile={profile} commit={commit} setAttendance={setAttendance} />
    <AttendanceHistory data={data} group={group} profile={profile} />
  </>;
}
function AttendanceHistory({ data, group, profile }: { data: AcademyData; group: AcademyGroup; profile: Profile }) {
  const students = new Map(studentsOf(data, group.id).map((student) => [student.id, student]));
  const labels: Record<string, string> = { present: "حاضر", absent: "غائب", late: "علامة قديمة", excused: "علامة قديمة" };
  const rows = activeAttendanceRecords(data, group.id).filter((row) => Boolean(row.status)).filter((row) => profile.role !== "teacher" || normalise(row.teacher) === normalise(profile.teacherName) || !row.teacher).slice().sort((a, b) => b.date.localeCompare(a.date));
  return <section className="section"><div className="section-head"><div><h2>سجل الحضور والغياب</h2><p>آخر علامات الحضور المسجلة لهذا {group.p ? "الـPrivate" : "الجروب"}.</p></div><span className="tag tag--muted">{rows.length} سجل</span></div>{rows.length ? <div className="card-list">{rows.slice(0, 100).map((row) => <div className="entity-card" key={`${row.date}:${row.mid}`}><div className="entity-card__top"><div><h3>{students.get(row.mid)?.n || "طالب مؤرشف"}</h3><p>{formatDate(row.date, true)}{profile.role !== "teacher" && row.teacher ? ` · سجله ${row.teacher}` : ""}</p></div><span className={`tag ${row.status === "absent" ? "tag--danger" : row.status === "present" ? "" : "tag--warning"}`}>{labels[row.status] ?? row.status}</span></div></div>)}</div> : <div className="empty">لا توجد علامات حضور أو غياب محفوظة لهذا الجروب بعد.</div>}</section>;
}

function sessionColumns(group: AcademyGroup, data: AcademyData, limit = 0): Session[] {
  const today = toIsoDate();
  const hasStoredSchedule = Array.isArray(group.ss) && group.ss.length > 0;
  const stored = hasStoredSchedule ? group.ss!.map((session) => ({ ...session })) : generateSessions(group);
  const start = String(group.s ?? "").slice(0, 10);
  const end = String(group.e ?? "").slice(0, 10);
  const seen = new Set(stored.map((session) => String(session.d ?? session.k).slice(0, 10)));
  const recorded = [...new Set(activeAttendanceRecords(data, group.id).filter((row) => row.date <= today && (!start || row.date >= start) && (!end || row.date <= end)).map((row) => row.date))].sort().slice(-8);
  recorded.forEach((date) => { if (!seen.has(date)) { stored.push({ k: date, d: date }); seen.add(date); } });
  const ordered = stored.sort((a, b) => String(a.d ?? a.k).localeCompare(String(b.d ?? b.k)));
  if (!limit) return ordered;
  const active = ordered.filter((session) => !session.c);
  const upcomingSessions = active.filter((session) => String(session.d ?? session.k).slice(0, 10) >= today).slice(0, limit);
  const pastCount = Math.max(0, limit - upcomingSessions.length);
  const recentPast = pastCount ? active.filter((session) => String(session.d ?? session.k).slice(0, 10) < today).slice(-pastCount) : [];
  return [...recentPast, ...upcomingSessions].sort((a, b) => String(a.d ?? a.k).localeCompare(String(b.d ?? b.k))).slice(-limit);
}

type ScheduleSnapshot = { ss: Session[] | null; e?: string };
type SessionMove = { from: string; to: string };
type PendingScheduleChange = { ss: Session[]; e?: string; moves: SessionMove[] };

function AttendanceMatrix({ group, data, profile, commit, setAttendance }: { group: AcademyGroup; data: AcademyData; profile: Profile; commit: Commit; setAttendance: (date: string, gid: string, mid: string, status: AttendanceStatus, teacher: string) => void }) {
  const rawSessions = sessionColumns(group, data);
  const scheduleCompletionPending = rawSessions.length > 0 && groupDays(group).length > 0 && rawSessions.filter((session) => !session.c).length < 8;
  const completedGroup = scheduleCompletionPending ? ensureEightActiveSessions({ ...group, ss: rawSessions }, rawSessions) : { ...group, ss: rawSessions };
  const allSessions = sessionColumns(completedGroup, data);
  const activeSessions = sessionColumns(completedGroup, data, 8);
  const sessionKey = (session: Session) => `${String(session.d ?? session.k).slice(0, 10)}:${session.c ? "c" : "a"}:${String(session.rescheduledFrom ?? "")}`;
  const rawSessionKeys = new Set(rawSessions.map(sessionKey));
  const suggestedDates = new Set(allSessions.filter((session) => !rawSessionKeys.has(sessionKey(session))).map((session) => String(session.d ?? session.k).slice(0, 10)));
    const activeKeys = new Set(activeSessions.map(sessionKey));
  const cancelledSessions = allSessions.filter((session) => Boolean(session.c));
  const sessions = [...activeSessions, ...cancelledSessions.filter((session) => !activeKeys.has(sessionKey(session)))].sort((a, b) => String(a.d ?? a.k).localeCompare(String(b.d ?? b.k)));
  const scheduledGroup = { ...completedGroup, ss: allSessions };
  const roster = activeStudentsOf(data, group.id).filter((student) => !isListedInFormerCustomers(student, data));
  const teacher = profile.role === "teacher" ? profile.teacherName : group.tc || "Admin";
  const canEdit = profile.role !== "teacher";
  const boardRef = useRef<HTMLDivElement>(null);
  const initializedGroup = useRef("");
  const [scrollControl, setScrollControl] = useState({ max: 0, value: 0 });
  const [undoStack, setUndoStack] = useState<ScheduleSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<ScheduleSnapshot[]>([]);
  const [message, setMessage] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<PendingScheduleChange | null>(null);
  const cloneSchedule = (value: Session[] | null | undefined) => value ? JSON.parse(JSON.stringify(value)) as Session[] : null;
  const captureSchedule = (): ScheduleSnapshot => ({ ss: cloneSchedule(group.ss), e: group.e });
  const cloneSnapshot = (value: ScheduleSnapshot): ScheduleSnapshot => ({ ss: cloneSchedule(value.ss), e: value.e });
  const applySchedule = (value: ScheduleSnapshot, note: string, recordHistory = true) => {
    if (recordHistory) { setUndoStack((items) => [...items, cloneSnapshot(captureSchedule())].slice(-30)); setRedoStack([]); }
    commit((draft) => {
      const target = draft.g.find((item) => item.id === group.id);
      if (target) {
        target.ss = cloneSchedule(value.ss);
        if (value.e === undefined) delete target.e;
        else target.e = value.e;
      }
    }, note);
    setPendingSchedule(null);
    setMessage("");
  };
  const undo = () => { const prior = undoStack.at(-1); if (!prior) return; setUndoStack((items) => items.slice(0, -1)); setRedoStack((items) => [...items, cloneSnapshot(captureSchedule())].slice(-30)); applySchedule(prior, "تم التراجع عن تعديل الجلسات.", false); };
  const redo = () => { const next = redoStack.at(-1); if (!next) return; setRedoStack((items) => items.slice(0, -1)); setUndoStack((items) => [...items, cloneSnapshot(captureSchedule())].slice(-30)); applySchedule(next, "تمت إعادة تعديل الجلسات.", false); };
  const sourceIndex = (session: Session) => allSessions.findIndex((item) => sessionKey(item) === sessionKey(session));
  const updateDate = (session: Session, value: string) => {
    setPendingSchedule(null);
    const index = sourceIndex(session);
    const oldDate = String(session.d ?? session.k).slice(0, 10);
    const protectedDates = new Set(activeAttendanceRecords(data, group.id).filter((row) => Boolean(row.status)).map((row) => row.date));
    if (protectedDates.has(oldDate)) { setMessage("لا يمكن تغيير جلسة مسجل لها حضور أو غياب."); return; }
    const result = rescheduleSession(scheduledGroup, index, value, protectedDates);
    if (!result || !Array.isArray(result.ss)) { setMessage("تعذر ترحيل الجلسة؛ قد توجد جلسة لاحقة لها حضور/غياب مسجل أو تعارض مع مواعيد الجروب."); return; }
    const moves = allSessions.flatMap((item, position) => {
      const next = result.ss?.[position];
      if (!next) return [];
      const from = String(item.d ?? item.k).slice(0, 10);
      const to = String(next.d ?? next.k).slice(0, 10);
      return from === to ? [] : [{ from, to }];
    });
    if (!moves.length) { setMessage("لم يتغير الموعد؛ اختر تاريخًا جديدًا."); return; }
    setMessage("");
    setPendingSchedule({ ss: result.ss, e: result.e, moves });
  };
  const changeCancelled = (session: Session) => {
    setPendingSchedule(null);
    const index = sourceIndex(session);
    const protectedDates = new Set(activeAttendanceRecords(data, group.id).filter((row) => Boolean(row.status)).map((row) => row.date));
    if (session.c) {
      const result = restoreSession(scheduledGroup, index, protectedDates);
      if (result === scheduledGroup) { setMessage("تعذر الاستعادة مع وجود حضور/غياب على آخر جلسة بديلة. امسح علامتها أو عدّلها أولًا للحفاظ على 8 جلسات نشطة."); return; }
      applySchedule({ ss: result.ss ?? null, e: result.e }, "تم استرجاع الجلسة مع الحفاظ على 8 جلسات نشطة.");
    }
    else {
      const result = cancelSession(scheduledGroup, index);
      const replacementAdded = (result.ss?.length ?? 0) > allSessions.length;
      applySchedule({ ss: result.ss ?? null, e: result.e }, replacementAdded ? "تم إلغاء الجلسة، وأعيد ترقيم النشطة وإضافة موعد لإكمال 8 جلسات." : "تم إلغاء الجلسة وأعيد ترقيم الجلسات النشطة.");
    }
  };
  const saveCompletion = () => applySchedule({ ss: allSessions, e: scheduledGroup.e }, "تم حفظ جدول 8 جلسات نشطة للجروب.");
  useEffect(() => { setUndoStack([]); setRedoStack([]); setMessage(""); setPendingSchedule(null); }, [group.id]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const update = () => {
      const max = Math.max(0, board.scrollWidth - board.clientWidth);
      if (max > 0 && initializedGroup.current !== group.id) { board.scrollLeft = max; initializedGroup.current = group.id; }
      const left = Math.max(0, Math.min(max, board.scrollLeft));
      setScrollControl({ max, value: Math.max(0, max - left) });
    };
    update();
    board.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(board);
    if (board.firstElementChild) observer?.observe(board.firstElementChild);
    return () => { board.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [group.id, sessions.length, roster.length]);
  const changeAttendance = (session: Session, student: Student, status: AttendanceStatus) => {
    const date = String(session.k ?? session.d ?? "").slice(0, 10);
    const current = attendanceFor(data, date, group.id, student.id)?.status ?? "";
    setAttendance(date, group.id, student.id, current === status ? "" : status, teacher);
  };
  return <section className="session-schedule">
    <div className="section-head"><div><h2>جدول الحضور والغياب</h2><p>٨ جلسات نشطة؛ إلغاء جلسة يعيد ترقيم الباقي ويضيف موعدًا في النهاية. تعديل التاريخ يحرك الجلسات التالية وفق أيام الجروب.</p></div><div className="toolbar">{scheduleCompletionPending && <span className="tag tag--warning">مواعيد مقترحة</span>}<span className="tag">{activeSessions.length} نشطة · {cancelledSessions.length} ملغاة</span>{canEdit && scheduleCompletionPending && <button className="btn btn--small" onClick={saveCompletion}>حفظ 8 جلسات</button>}{canEdit && <><button className="btn btn--ghost btn--small" disabled={!undoStack.length} onClick={undo}>↶ تراجع</button><button className="btn btn--ghost btn--small" disabled={!redoStack.length} onClick={redo}>↷ إعادة</button></>}</div></div>
    {scheduleCompletionPending && <div className="notice notice--warning" role="status">{canEdit ? "تم اقتراح مواعيد حتى يكتمل العدد إلى 8 حسب أيام الجروب؛ لم تُحفظ بعد. اضغط «حفظ 8 جلسات» لاعتمادها وتحديث نهاية الجروب." : "جدول الجلسات غير مكتمل؛ أبلغ الإدارة لحفظ 8 جلسات حسب أيام الجروب."}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {pendingSchedule && <div className="session-change-review" role="region" aria-label="مراجعة تأجيل الجلسات"><div><strong>مراجعة تأجيل الجلسات</strong><p>سيُعاد توزيع {sessionCountAr(pendingSchedule.moves.length)} حسب أيام الجروب ({group.d || "الأيام المحددة"})، وسيظل إجمالي الجلسات النشطة {activeSessions.length} كما هو.</p>{pendingSchedule.e && group.e && pendingSchedule.e > group.e && <small>سيتم تمديد نهاية الجروب إلى {formatDate(pendingSchedule.e)}.</small>}</div><div className="session-change-list">{pendingSchedule.moves.map((move, index) => <span key={`${move.from}-${move.to}-${index}`}>جلسة {index + 1}: {formatDate(move.from)} ← {formatDate(move.to)}</span>)}</div><div className="toolbar"><button className="btn btn--small" onClick={() => applySchedule({ ss: pendingSchedule.ss, e: pendingSchedule.e }, "تم تأجيل الجلسة وإعادة توزيع الجلسات التالية وفق أيام الجروب.")}>تأكيد التأجيل</button><button className="btn btn--ghost btn--small" onClick={() => setPendingSchedule(null)}>إلغاء</button></div></div>}
    {scrollControl.max > 0 && <div className="session-scroll-control"><span dir="rtl">الجلسة الأولى</span><input type="range" min="0" max={scrollControl.max} step="1" value={Math.min(scrollControl.max, scrollControl.value)} aria-label={`اسحب لإظهار الجلسات حتى ${sessions.length}`} onChange={(event) => { if (boardRef.current) boardRef.current.scrollLeft = scrollControl.max - Number(event.target.value); }} /><span dir="rtl">الجلسة {sessions.length}</span></div>}
    <div ref={boardRef} className="attendance-board session-board"><table className="attendance-table session-table"><thead><tr><th className="sticky-col">الطالب</th>{sessions.map((session, index) => {
      const date = String(session.d ?? session.k).slice(0, 10);
      const indexInSource = sourceIndex(session);
      const activeNumber = activeSessions.findIndex((item) => sessionKey(item) === sessionKey(session)) + 1;
      const number = session.c ? "ملغاة" : `جلسة ${activeNumber}`;
      const proposedDate = pendingSchedule?.moves.find((move) => move.from === date)?.to ?? date;
      return <th key={`${sessionKey(session)}-${index}`} className={session.c ? "cancelled-session" : ""}><strong>{number}</strong><small>{proposedDate === date ? formatDate(date, true) : `${formatDate(date, true)} ← ${formatDate(proposedDate, true)}`}</small>{suggestedDates.has(date) && <small className="suggested-session-label">مقترحة</small>}{canEdit && <div className="session-header-controls">{!session.c && <input aria-label={`تغيير تاريخ الجلسة ${activeNumber}`} type="date" value={proposedDate} onChange={(event) => updateDate(session, event.target.value)} />}<button className={`btn btn--ghost btn--small ${session.c ? "session-restore" : "session-cancel"}`} aria-label={session.c ? "استعادة الجلسة الملغاة" : `إلغاء الجلسة ${activeNumber}`} onClick={() => changeCancelled(session)}>{session.c ? "استعادة" : "إلغاء"}</button></div>}{indexInSource < 0 && <small>موعد غير محفوظ</small>}</th>;
    })}</tr></thead>
      <tbody>{roster.map((student, index) => <tr key={student.id}><th className="sticky-col student-sticky"><span className="student-table-name">{index + 1}. {student.n || "بدون اسم"}</span>{student.lv && <small>{student.lv}</small>}</th>{sessions.map((session, sessionIndex) => {
        const date = String(session.k ?? session.d ?? "").slice(0, 10);
        const status = attendanceFor(data, date, group.id, student.id)?.status ?? "";
        return <td key={`${student.id}-${sessionIndex}`} className={session.c ? "cancelled-session" : ""}>{session.c ? <span className="cancelled-session-label">ملغاة</span> : <div className="attendance-marks"><button className={`attendance-mark present ${status === "present" ? "selected" : ""}`} aria-label={`حاضر: ${student.n || "الطالب"}`} aria-pressed={status === "present"} onClick={() => changeAttendance(session, student, "present")}>✔</button><button className={`attendance-mark absent ${status === "absent" ? "selected" : ""}`} aria-label={`غائب: ${student.n || "الطالب"}`} aria-pressed={status === "absent"} onClick={() => changeAttendance(session, student, "absent")}>✘</button></div>}</td>;
      })}</tr>)}</tbody>
    </table></div>
    {!roster.length && <div className="empty">لا يوجد طلاب داخل هذا الجروب بعد.</div>}
  </section>;
}

function teacherMonthSessions(groups: AcademyGroup[], month: string) { return teacherSessionsForMonth(groups, month); }

function TeacherSessionSchedule({ groups, data, month, onOpenGroup }: { groups: AcademyGroup[]; data: AcademyData; month: string; onOpenGroup: (group: AcademyGroup) => void }) {
  const rows = teacherMonthSessions(groups, month);
  const cancelledCount = rows.filter(({ session }) => Boolean(session.c)).length;
  const label = (group: AcademyGroup) => group.p ? privateStudentLabel(group, data) : [roundName(data.r.find((round) => round.id === group.r)), group.lv, group.tc, group.d, groupTime(group)].filter(Boolean).join(" · ");
  return <details className="section teacher-month-sessions compact-section"><summary className="section-head compact-section__summary"><div><h2>جلسات المدرس في الشهر</h2><p>الجلسات الملغاة تظهر هنا ولا تُحتسب ضمن ساعات العمل.</p></div><span className="tag tag--muted">{rows.length - cancelledCount} نشطة · {cancelledCount} ملغاة</span><ChevronDown size={17} /></summary>{rows.length ? <div className="teacher-sessions-wrap"><table className="teacher-sessions-table"><thead><tr><th>الجروب / الطالب</th><th>التاريخ</th><th>الوقت</th><th>المدة المحسوبة</th><th>الحالة</th></tr></thead><tbody>{rows.map(({ group, session, suggested }, index) => { const date = String(session.d ?? session.k).slice(0, 10); const cancelled = Boolean(session.c); return <tr key={`${group.id}:${date}:${index}`} className={cancelled ? "teacher-session-cancelled" : suggested ? "teacher-session-proposed" : ""}><td><button type="button" className="hours-group-link" title={label(group)} onClick={() => onOpenGroup(group)}>{label(group)}</button></td><td>{formatDate(date, true)}</td><td>{groupTime(group)}</td><td>{cancelled ? 0 : durationHours(group)} ساعة</td><td><span className={`tag ${cancelled ? "tag--danger" : suggested ? "tag--warning" : ""}`}>{cancelled ? "ملغاة" : suggested ? "مقترحة" : "مجدولة"}</span></td></tr>; })}</tbody></table></div> : <div className="empty">لا توجد جلسات لهذا المدرس في الشهر المحدد.</div>}</details>;
}

function TeachersView({ data, profile, commit, teacherAccounts, onDeleteTeacher, onOpenGroup }: { data: AcademyData; profile: Profile; commit: Commit; teacherAccounts: TeacherAccount[]; onDeleteTeacher: (name: string) => Promise<boolean>; onOpenGroup: (group: AcademyGroup) => void }) {
  const activeDirectory = useMemo(() => teacherNames(data, teacherAccounts), [data, teacherAccounts]);
  const archivedDirectory = useMemo(() => [...new Map(data.teacherHours.filter((row) => isTeacherArchived(row) && !isTeacherDeleted(row) && row.name.trim()).map((row) => [normalise(row.name), row.name.trim()])).values()].sort((a, b) => a.localeCompare(b, "ar")), [data.teacherHours]);
  const reportNames = useMemo(() => {
    if (profile.role === "teacher") return profile.teacherName && !isTeacherNameArchived(data, profile.teacherName) ? [profile.teacherName] : [];
    return activeDirectory;
  }, [activeDirectory, data, profile.role, profile.teacherName]);
  const [teacher, setTeacher] = useState(profile.role === "teacher" ? profile.teacherName : reportNames[0] ?? "");
  const [newTeacher, setNewTeacher] = useState("");
  const [directoryMessage, setDirectoryMessage] = useState("");
  const [month, setMonth] = useState(monthKey());
  const [roundFilter, setRoundFilter] = useState("");
  const [today, setToday] = useState(toIsoDate());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDate = toIsoDate();
      setToday((previousDate) => previousDate === currentDate ? previousDate : currentDate);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const allTeacherGroups = isTeacherNameArchived(data, teacher) ? [] : nonArchivedGroups(data).filter((group) => normalise(group.tc) === normalise(teacher));
  const monthSessionGroupIds = new Set(teacherMonthSessions(allTeacherGroups, month).map(({ group }) => group.id));
  const monthGroups = allTeacherGroups.filter((group) => monthSessionGroupIds.has(group.id));
  const monthRoundIds = [...new Set(monthGroups.filter((group) => !group.p).map((group) => group.r))];
  const monthRoundKey = monthRoundIds.join("|");
  const roundOptions = data.r.filter((round) => monthRoundIds.includes(round.id));
  const includesPrivate = monthGroups.some((group) => Boolean(group.p));
  useEffect(() => {
    if (roundFilter === "pv" && !includesPrivate) setRoundFilter("");
    else if (roundFilter && roundFilter !== "pv" && !monthRoundIds.includes(roundFilter)) setRoundFilter("");
  }, [includesPrivate, month, monthRoundKey, roundFilter]);
  const groups = monthGroups.filter((group) => !roundFilter || (roundFilter === "pv" ? Boolean(group.p) : !group.p && group.r === roundFilter));
  const timetableGroups = groups.filter((group) => {
    const endDate = plannedGroupEndDate(group);
    return !endDate || endDate >= today;
  });
  const record = data.teacherHours.find((row) => normalise(row.name) === normalise(teacher));
  const [weekly, setWeekly] = useState(String(record?.weeklyHours ?? ""));
  useEffect(() => { if (profile.role !== "teacher" && (!teacher || !reportNames.some((name) => normalise(name) === normalise(teacher)))) setTeacher(reportNames[0] ?? ""); }, [profile.role, teacher, reportNames]);
  useEffect(() => { setWeekly(String(record?.weeklyHours ?? "")); }, [teacher, record?.weeklyHours]);
  const hours = monthTeacherHours(groups, month);
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const daysInMonth = monthYear && monthNumber ? new Date(monthYear, monthNumber, 0).getDate() : 30;
  const plannedMonthlyHours = Number(record?.weeklyHours ?? 0) * daysInMonth / 7;
  const performancePercent = plannedMonthlyHours > 0 ? Math.round(hours.hours / plannedMonthlyHours * 100) : null;
  const cancelledSessions = groups.reduce((total, group) => total + sessionsOf(group).filter((session) => session.c && String(session.d ?? session.k).slice(0, 7) === month).length, 0);
  const activeAssignments = (name: string) => activeGroups(data).filter((group) => normalise(group.tc) === normalise(name));
  const hasAccount = (name: string) => teacherAccounts.some((account) => normalise(account.name) === normalise(name));
  const saveWeekly = () => {
  const value = Number(weekly);
    if (!teacher || Number.isNaN(value) || value < 0 || value > 80) return;
    commit((draft) => saveTeacherWeeklyHours(draft, teacher, value), "تم حفظ الساعات الأسبوعية.");
  };
  const addTeacher = () => {
    const name = newTeacher.trim();
    if (!name) return;
    const existing = data.teacherHours.find((row) => normalise(row.name) === normalise(name));
    if (existing && isTeacherDeleted(existing)) { setDirectoryMessage("تم حذف هذا المدرس من النظام؛ استخدم اسمًا جديدًا إذا كان المطلوب إنشاء سجل مستقل."); return; }
    if (existing && isTeacherArchived(existing)) { setDirectoryMessage("المدرس موجود في الأرشيف؛ استخدم زر «استعادة من الأرشيف» بدل إضافته مرة أخرى."); return; }
    if (activeDirectory.some((item) => normalise(item) === normalise(name))) { setDirectoryMessage("هذا المدرس موجود بالفعل في القائمة أو لديه حساب متزامن."); return; }
    commit((draft) => {
      draft.teacherHours.push({ name, active: true, updatedAt: Date.now() });
    }, "تمت إضافة المدرس للقائمة.");
    setDirectoryMessage("تمت إضافة المدرس إلى قائمة الاختيار.");
    setTeacher(name); setNewTeacher("");
  };
  const archiveTeacherEntry = (name: string) => {
    const assignments = nonArchivedGroups(data).filter((group) => normalise(group.tc) === normalise(name));
    if (!window.confirm(`أرشفة المدرس «${name}»؟ سيختفي المدرس وجلساته من الحضور والتقارير التشغيلية وقوائم التعيين؛ الجروبات والطلاب غير المؤرشفة ستظل محفوظة ومحسوبة في الأعداد والإيرادات، ولن يُحذف الحساب أو يتغير الإسناد. هل تريد المتابعة؟`)) return;
    commit((draft) => archiveTeacher(draft, name), assignments.length ? `تمت أرشفة المدرس. بقيت ${assignments.length} تكليفات محفوظة كما هي.` : "تمت أرشفة المدرس دون حذف حسابه أو سجلاته.");
    if (normalise(teacher) === normalise(name)) setTeacher(activeDirectory.find((item) => normalise(item) !== normalise(name)) ?? "");
  };
  const deleteTeacherEntry = async (name: string) => {
    const hasAccount = teacherAccounts.some((account) => normalise(account.name) === normalise(name));
    const message = hasAccount
      ? `حذف المدرس «${name}» من النظام؟ سيتم إيقاف دخوله ومسح نسخة بياناته التعليمية، مع الاحتفاظ بكل بيانات الطلاب والجروبات والحضور. حساب Firebase Authentication نفسه لن يُحذف من لوحة Firebase.`
      : `حذف المدرس «${name}» من القوائم؟ ستظل سجلات الجروبات والطلاب والحضور محفوظة.`;
    if (!window.confirm(message)) return;
    try {
      await onDeleteTeacher(name);
      if (normalise(teacher) === normalise(name)) setTeacher("");
      setDirectoryMessage(hasAccount ? "تم حذف المدرس من النظام وإيقاف دخوله مع حفظ التاريخ." : "تم حذف المدرس من القوائم مع حفظ التاريخ.");
    } catch (error) {
      setDirectoryMessage(error instanceof Error ? error.message : "تعذر حذف المدرس؛ لم يتغير الحساب.");
    }
  };
  const restoreArchivedTeacher = (name: string) => {
    commit((draft) => restoreTeacher(draft, name), "تمت استعادة المدرس من الأرشيف إلى قوائم التعيين.");
    setTeacher(name);
  };
  return <>
    <PageHead title={profile.role === "teacher" ? "جروباتي" : "ساعات المدرسين"} description={profile.role === "teacher" ? "الجدول الأسبوعي والساعات الشهرية لجروباتك والـPrivate المسندة إليك." : "حدد ساعات العمل الأسبوعية، وأضف المدرسين أو أرشفهم أو احذفهم من النظام."} />
    {profile.role !== "teacher" && <section className="section teacher-manager"><div className="section-head"><div><h2>إدارة قائمة المدرسين</h2><p>الأرشفة قابلة للاستعادة. الحذف يوقف حساب المدرس داخل النظام، بينما تظل بيانات الطلاب والجروبات والحضور محفوظة.</p></div><span className="tag tag--muted">{activeDirectory.length} نشط</span></div><div className="toolbar teacher-manager__add"><input className="search-input" value={newTeacher} onChange={(event) => setNewTeacher(event.target.value)} placeholder="اسم مدرس جديد" aria-label="اسم مدرس جديد" /><button type="button" className="btn" disabled={!newTeacher.trim()} onClick={addTeacher}><Plus size={16} />إضافة مدرس للقائمة</button></div>{directoryMessage && <div className="notice" role="status">{directoryMessage}</div>}<div className="teacher-directory">{activeDirectory.length ? activeDirectory.map((name) => { const assignments = activeAssignments(name).length; return <div className="teacher-directory__row" key={normalise(name)}><div><strong>{name}</strong><p>{hasAccount(name) ? "حساب مدرس متزامن" : "اسم يدوي للقائمة"} · {assignments} جروب/Private نشط</p></div><div className="toolbar"><button type="button" className="btn btn--ghost btn--small" onClick={() => archiveTeacherEntry(name)}>أرشفة المدرس</button>{profile.role === "owner" && <button type="button" className="btn btn--ghost btn--small" onClick={() => void deleteTeacherEntry(name)}><Trash2 size={14} />حذف من النظام</button>}</div></div>; }) : <div className="empty">أضف أول مدرس ليظهر في قوائم إنشاء الجروب والـPrivate.</div>}</div>{archivedDirectory.length > 0 && <div className="teacher-directory teacher-directory--inactive"><h3>مدرسون في الأرشيف</h3><p>الحساب والتكليفات محفوظة؛ المدرس وجلساته مخفيان من الحضور والتقارير حتى الاستعادة.</p>{archivedDirectory.map((name) => <div className="teacher-directory__row" key={normalise(name)}><div><strong>{name}</strong><p>{activeAssignments(name).length} جروب/Private قائم محفوظ دون تغيير.</p></div><div className="toolbar"><button type="button" className="btn btn--ghost btn--small" onClick={() => restoreArchivedTeacher(name)}>استعادة من الأرشيف</button>{profile.role === "owner" && <button type="button" className="btn btn--ghost btn--small" onClick={() => void deleteTeacherEntry(name)}><Trash2 size={14} />حذف من النظام</button>}</div></div>)}</div>}</section>}
    {profile.role !== "teacher" && <section className="section"><div className="toolbar"><select className="search-input" value={teacher} onChange={(event) => { setTeacher(event.target.value); const newRecord = data.teacherHours.find((row) => normalise(row.name) === normalise(event.target.value)); setWeekly(String(newRecord?.weeklyHours ?? "")); }}><option value="">اختر مدرسًا للتقرير</option>{reportNames.map((name) => <option key={normalise(name)} value={name}>{name}{archivedDirectory.some((item) => normalise(item) === normalise(name)) ? " · مؤرشف" : ""}</option>)}</select><input className="search-input" type="number" min="0" max="80" step="0.5" placeholder="ساعات أسبوعيًا" value={weekly} onChange={(event) => setWeekly(event.target.value)} /><button className="btn" disabled={!teacher} onClick={saveWeekly}>حفظ الساعات</button></div></section>}
    <details className="section compact-section teacher-month-summary">
      <summary className="section-head compact-section__summary"><div><h2>ملخص {teacher || "المدرس"}</h2><p>يعرض جروبات المدرس التي لها جلسة في الشهر المحدد، حتى لو بدأت في شهر سابق.</p></div><div className="field"><label className="sr-only" htmlFor="work-month">الشهر</label><input id="work-month" type="month" value={month} onClick={(event) => event.stopPropagation()} onChange={(event) => { setMonth(event.target.value); setRoundFilter(""); }} /></div><ChevronDown size={17} /></summary>
      <div className="toolbar teacher-month-filter"><label className="field"><span>راوندات الشهر</span><select className="search-input" aria-label="تصفية راوندات المدرس حسب الشهر" value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}><option value="">كل راوندات الشهر</option>{roundOptions.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}{includesPrivate && <option value="pv">Private</option>}</select></label></div>
      <div className="hours-summary"><span className="tag">ساعات العمل الأسبوعية: {record?.weeklyHours ?? "غير محددة"}</span><span className="tag">الساعات الأسبوعية للجروبات المحددة: {Math.round(weeklyScheduledHours(groups) * 100) / 100}</span></div>
      <div className="month-hours"><div><strong>{hours.sessions}</strong><span>جلسة في الشهر</span></div><div><strong>{Math.round(hours.hours * 100) / 100}</strong><span>ساعة فعلية</span></div><div><strong>{groups.filter((group) => !group.p).length} / {groups.filter((group) => Boolean(group.p)).length}</strong><span>جروبات / Private في الشهر</span></div><div><strong>{plannedMonthlyHours ? Math.round(plannedMonthlyHours * 100) / 100 : "—"}</strong><span>الخطة الشهرية التقديرية</span></div><div><strong>{performancePercent === null ? "—" : `${performancePercent}%`}</strong><span>{performancePercent === null ? "حدد الساعات الأسبوعية" : `فرق ${Math.round((hours.hours - plannedMonthlyHours) * 100) / 100} ساعة`}</span></div><div><strong>{cancelledSessions}</strong><span>جلسات ملغاة غير محسوبة</span></div></div>
      {hours.details.length ? <div className="card-list">{hours.details.map((detail) => <div className="entity-card" key={detail.group.id}><div className="entity-card__top"><div><h3><button type="button" className="hours-group-link" onClick={() => onOpenGroup(detail.group)}>{detail.group.p ? privateStudentLabel(detail.group, data) : groupLabel(detail.group)}</button></h3><p>{detail.sessions} جلسة × {durationHours(detail.group)} ساعة</p></div><span className="tag">{Math.round(detail.hours * 100) / 100} ساعة</span></div><div className="entity-card__actions"><button className="btn btn--ghost btn--small" onClick={() => onOpenGroup(detail.group)}>فتح الجروب</button></div></div>)}</div> : <div className="empty">لا توجد جلسات بهذا الشهر والراوند للمدرس المختار.</div>}
    </details>
    <TeacherSessionSchedule groups={groups} data={data} month={month} onOpenGroup={onOpenGroup} />
     <section className="section"><div className="section-head"><div><h2>الجدول الأسبوعي</h2><p>الجروبات التي لم يمر تاريخ آخر جلسة لها تظهر هنا؛ وتبقى الجلسات السابقة ضمن ملخص الشهر والساعات المحسوبة.</p></div></div><Timetable groups={timetableGroups} data={data} onOpenGroup={onOpenGroup} /></section>
  </>;
}
function Timetable({ groups, data, onOpenGroup }: { groups: AcademyGroup[]; data: AcademyData; onOpenGroup: (group: AcademyGroup) => void }) {
  const slots = Array.from({ length: 16 }, (_, index) => index + 8);
  const occupied: Record<number, Record<number, boolean>> = {};
  WEEKDAYS.forEach((day) => { occupied[day.d] = {}; });
  return <div className="schedule-wrap"><table className="schedule"><thead><tr><th>الوقت</th>{WEEKDAYS.map((day) => <th key={day.d}>{day.n}</th>)}</tr></thead><tbody>{slots.map((hour) => <tr key={hour}>
    <td className="schedule__time">{formatTime(`${String(hour).padStart(2, "0")}:00`)} – {formatTime(`${String((hour + 1) % 24).padStart(2, "0")}:00`)}</td>
    {WEEKDAYS.map((day) => {
      if (occupied[day.d][hour]) return null;
      const starts = groups.filter((group) => Math.floor(Number(group.t1?.split(":")[0])) === hour && String(group.d ?? "").includes(day.n));
      if (!starts.length) return <td key={day.d} />;
      const end = Math.max(...starts.map((group) => hour + Math.max(1, Math.ceil(durationHours(group)))));
      const rowSpan = Math.max(1, Math.min(24 - hour, end - hour));
      for (let slot = hour + 1; slot < hour + rowSpan; slot += 1) occupied[day.d][slot] = true;
      return <td key={day.d} rowSpan={rowSpan}>{starts.map((group) => {
        const name = group.p ? privateStudentLabel(group, data) : [roundName(data.r.find((round) => round.id === group.r)), group.lv, teacherDisplayName(data, group.tc)].filter(Boolean).join(" · ");
        const complete = [name, group.d, groupTime(group)].filter(Boolean).join(" · ");
        return <button type="button" className="schedule-block" key={group.id} title={complete} aria-label={complete} style={{ background: colourForGroup(group) }} onClick={() => onOpenGroup(group)}><strong>{name}</strong><br /><small>{group.d} · {groupTime(group)}</small></button>;
      })}</td>;
    })}
  </tr>)}</tbody></table></div>;
}
function FinanceView({ data, commit, onOpenGroup }: { data: AcademyData; commit: Commit; onOpenGroup: (group: AcademyGroup) => void }) {
  const [month, setMonth] = useState(monthKey());
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(`${month}-01`);
  const revenue = incomeForMonth(data, month);
  const [excludedByMonth, setExcludedByMonth] = useState<Record<string, string[]>>(() => { try { return JSON.parse(localStorage.getItem("speakozy-income-detail-exclusions") || "{}"); } catch { return {}; } });
  const allPaidStudents = incomeStudentsForMonth(data, month).sort((a, b) => String(a.student.n ?? "").localeCompare(String(b.student.n ?? ""), "ar"));
  const excludedIds = new Set(excludedByMonth[month] ?? []);
  const paidStudents = allPaidStudents.filter(({ student }) => !excludedIds.has(student.id));
  const excludedStudents = allPaidStudents.filter(({ student }) => excludedIds.has(student.id));
  const setExcluded = (studentId: string, exclude: boolean) => { const next = { ...excludedByMonth, [month]: exclude ? [...new Set([...(excludedByMonth[month] ?? []), studentId])] : (excludedByMonth[month] ?? []).filter((id) => id !== studentId) }; setExcludedByMonth(next); localStorage.setItem("speakozy-income-detail-exclusions", JSON.stringify(next)); };
  const classifiedIncome = incomeStudentsByKindForMonth(data, month);
  const categoryTotal = (rows: typeof paidStudents) => rows.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0);
  const expenses = expenseForMonth(data, month);
  const expenseRows = data.finance.filter((row) => row.type === "expense" && !row.x && row.date?.slice(0, 7) === month);
  const addExpense = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!value || !date) return;
    commit((draft) => draft.finance.push({ id: uid(), type: "expense", amount: value, date, note: note.trim(), createdAt: Date.now() }), "تمت إضافة المصروف.");
    setNote(""); setAmount("");
  };
  return <><PageHead title="الإيرادات والمصروفات" description="مبالغ الطلاب تُسند لشهر بداية الجروب/Private؛ إيقاف الراوند لا يلغي إيرادها، والأرشفة وحدها تستبعده." />
    <section className="section"><div className="toolbar"><div className="field"><label>الشهر (حسب بداية الجروب)</label><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setDate(`${event.target.value}-01`); }} /></div></div><div className="finance-grid"><FinanceStat value={revenue} label="إيرادات الشهر" /><FinanceStat value={expenses} label="مصروفات الشهر" /><FinanceStat value={revenue - expenses} label="صافي الربح" /><FinanceStat value={revenue ? `${Math.round(((revenue - expenses) / revenue) * 1000) / 10}%` : "—"} label="نسبة الربح" /></div></section>
    <section className="section"><div className="section-head"><div><h2>تصنيف إيراد الطلاب</h2><p>التقسيم يستخدم نفس أساس إيراد الشهر: تاريخ بداية الجروب/Private.</p></div></div><div className="finance-grid"><FinanceStat value={categoryTotal(classifiedIncome.new)} label="اشتراكات طلاب جدد" /><FinanceStat value={categoryTotal(classifiedIncome.old)} label="طلاب قدام مستمرون" /><FinanceStat value={categoryTotal(classifiedIncome.returned)} label="قدام رجعوا بعد انقطاع" /></div></section>
    <section className="section revenue-students-section"><div className="section-head"><div><h2>الطلاب في إيراد {month}</h2><p>يمكن إخفاء صف من هذا الكشف لهذا الشهر فقط؛ لا يتغير ملف الطالب أو المبالغ أو إجمالي الإيراد.</p></div><span className="tag tag--muted">{paidStudents.length} ظاهر · {excludedStudents.length} مخفي · إجمالي الإيراد {revenue.toLocaleString("en-US")} ج.م</span></div>{paidStudents.length ? <div className="teacher-sessions-wrap revenue-students-wrap"><table className="revenue-students-table"><thead><tr><th>الطالب</th><th>رقم الهاتف</th><th>الجروب / Private</th><th>تصنيف / مصدر</th><th>المبلغ المدفوع</th><th>إجراء</th></tr></thead><tbody>{paidStudents.map(({ student, group }) => <tr key={student.id}><td><button type="button" className="revenue-student-link" onClick={() => onOpenGroup(group)}>{student.n || "بدون اسم"}</button></td><td><span dir="ltr">{student.ph || "—"}</span>{student.ph && <button className="btn btn--ghost btn--small" aria-label={`نسخ رقم ${student.n || "الطالب"}`} onClick={() => safeCopy(student.ph ?? "")}><Copy size={13} /></button>}</td><td>{group.p ? (student.n || group.lv || "Private") : group.lv || "جروب"}</td><td>{studentKindLabel(studentKind(student))} · {studentSourceLabel(student)}</td><td>{Number(student.amount ?? 0).toLocaleString("en-US")} ج.م</td><td><button type="button" className="btn btn--ghost btn--small btn--danger" onClick={() => setExcluded(student.id, true)}>استبعاد من الكشف</button></td></tr>)}</tbody></table></div> : <div className="empty">لا يوجد طلاب ظاهرون في كشف الشهر المختار.</div>}{excludedStudents.length > 0 && <div className="excluded-income"><strong>صفوف مستبعدة لهذا الشهر ({excludedStudents.length})</strong>{excludedStudents.map(({ student, group }) => <div key={student.id}><span>{student.n || "بدون اسم"} · {Number(student.amount ?? 0).toLocaleString("en-US")} ج.م</span><button className="btn btn--ghost btn--small" onClick={() => setExcluded(student.id, false)}>إعادة للكشف</button><button className="btn btn--ghost btn--small" onClick={() => onOpenGroup(group)}>فتح الجروب</button></div>)}</div>}</section>
    <section className="section"><div className="section-head"><div><h2>إضافة مصروف</h2><p>تظهر المصروفات للمالك فقط وتدخل في صافي الشهر.</p></div></div><form className="grid-form" onSubmit={addExpense}><div className="field span-2"><label>البند</label><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="إيجار، مرتبات…" /></div><div className="field"><label>المبلغ</label><input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div><div className="field"><label>التاريخ</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></div><button className="btn" type="submit"><Plus size={16} />إضافة مصروف</button></form></section>
    <section className="section"><div className="section-head"><div><h2>مصروفات الشهر</h2><p>{expenseRows.length} بند</p></div></div><div className="card-list">{expenseRows.length ? expenseRows.map((row) => <div className="entity-card" key={row.id}><div className="entity-card__top"><div><h3>{row.note || "مصروف"}</h3><p>{formatDate(row.date)}</p></div><strong>{Number(row.amount).toLocaleString("en-US")} ج.م</strong></div><div className="entity-card__actions"><button className="btn btn--ghost btn--small" onClick={() => commit((draft) => { const target = draft.finance.find((item) => item.id === row.id); if (target) { target.x = 1; target.xa = Date.now(); } }, "تمت أرشفة المصروف.")}>أرشفة</button></div></div>) : <div className="empty">لا توجد مصروفات في الشهر المختار.</div>}</div></section>
  </>;
}

function FinanceStat({ value, label }: { value: string | number; label: string }) { return <div className="finance-stat"><strong>{typeof value === "number" ? `${value.toLocaleString("en-US")} ج.م` : value}</strong><span>{label}</span></div>; }

function MarketingView({ data, profile, commit, refreshProjection }: { data: AcademyData; profile: Profile; commit: Commit; refreshProjection: () => Promise<void> }) {
  const months = [...new Set(nonArchivedGroups(data).map((group) => group.s?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort().reverse();
  const [month, setMonth] = useState(months[0] ?? monthKey());
  const [compareFirst, setCompareFirst] = useState(months[0] ?? monthKey());
  const [compareSecond, setCompareSecond] = useState(months[1] ?? months[0] ?? monthKey());
  const [roundId, setRoundId] = useState("");
  const [source, setSource] = useState("");
  const groups = new Map(nonArchivedGroups(data).map((group) => [group.id, group]));
  const rows = live(data.m).flatMap((student) => {
    const group = groups.get(student.g);
    if (!group || group.s?.slice(0, 7) !== month || (roundId && (group.p ? "pv" : group.r) !== roundId)) return [];
    return [{ student, group, source: student.source || student.subscriptionSource || "" }];
  }).filter(({ student }) => isEnrolledStudent(student)).filter((row) => !source || row.source === source);
  const newRows = rows.filter(({ student }) => (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new");
  const groupCount = rows.filter(({ group }) => !group.p).length;
  const privateCount = rows.filter(({ group }) => Boolean(group.p)).length;
  const newSubscriptionValue = newRows.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0);
  const rounds = live(data.r).filter((round) => !round.x && !round.pl);
  const sourceOptions = [...new Set([...STUDENT_SOURCES, ...live(data.m).map((student) => student.source || student.subscriptionSource || "").filter(Boolean)])];
  const sourceStats = sourceOptions.map((sourceName) => {
    const sourceRows = rows.filter(({ student }) => (student.source || student.subscriptionSource || "") === sourceName);
    const subscriptions = sourceRows.filter(({ student }) => (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new");
    return { source: sourceName, total: sourceRows.length, newCount: sourceRows.filter(({ student }) => studentKind(student) === "new").length, oldCount: sourceRows.filter(({ student }) => studentKind(student) === "old").length, returnedCount: sourceRows.filter(({ student }) => studentKind(student) === "returned").length, subscriptionCount: subscriptions.length, revenue: subscriptions.reduce((sum, { student }) => sum + Number(student.amount ?? 0), 0) };
  }).filter((item) => item.total > 0);
  const maxSourceRevenue = Math.max(1, ...sourceStats.map((item) => item.revenue));
  const categoryCount = (kind: StudentKind) => rows.filter(({ student }) => studentKind(student) === kind).length;
  const retentionMonths = retentionByMonth(data);
  const comparisonStats = (period: string) => {
    const periodRows = live(data.m).flatMap((student) => {
      const group = groups.get(student.g);
      if (!group || group.s?.slice(0, 7) !== period || (roundId && (group.p ? "pv" : group.r) !== roundId)) return [];
      const rowSource = student.source || student.subscriptionSource || "";
      if (source && rowSource !== source) return [];
      return [{ student, group, source: rowSource }];
    }).filter(({ student }) => isEnrolledStudent(student));
    const cohort = retentionMonths.find((entry) => entry.month === period);
    const cohortRows = (cohort?.registrations ?? []).filter((row) => (!roundId || (row.group.p ? "pv" : row.group.r) === roundId) && (!source || (row.student.source || row.student.subscriptionSource || "") === source));
    const paidCohort = cohort?.nextMonth ? cohortRows.filter((row) => row.paid) : [];
    const kept = paidCohort.filter((row) => row.kept).length;
    const newSubscriptions = periodRows.filter(({ student }) => (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new");
    return {
      registrations: periodRows.length,
      newStudents: periodRows.filter(({ student }) => studentKind(student) === "new").length,
      oldStudents: periodRows.filter(({ student }) => studentKind(student) === "old").length,
      returned: periodRows.filter(({ student }) => studentKind(student) === "returned").length,
      newSubscriptions: newSubscriptions.length,
      newRevenue: newSubscriptions.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0),
      retention: paidCohort.length ? kept / paidCohort.length * 100 : null
    };
  };
  const firstComparison = comparisonStats(compareFirst);
  const secondComparison = comparisonStats(compareSecond);
  const comparisonSourceRows = live(data.m).flatMap((student) => {
    const group = groups.get(student.g);
    if (!group || group.s?.slice(0, 7) !== compareSecond || (roundId && (group.p ? "pv" : group.r) !== roundId)) return [];
    const rowSource = student.source || student.subscriptionSource || "";
    return !source || rowSource === source ? [{ student, source: rowSource }] : [];
  }).filter(({ student }) => isEnrolledStudent(student));
  const comparisonSourceStats = [...new Set(comparisonSourceRows.map((row) => row.source).filter(Boolean))].map((sourceName) => {
    const sourceRows = comparisonSourceRows.filter((row) => row.source === sourceName);
    const newSubscriptions = sourceRows.filter(({ student }) => (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new");
    return { source: sourceName, total: sourceRows.length, newCount: sourceRows.filter(({ student }) => studentKind(student) === "new").length, oldCount: sourceRows.filter(({ student }) => studentKind(student) === "old").length, returnedCount: sourceRows.filter(({ student }) => studentKind(student) === "returned").length, revenue: newSubscriptions.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0) };
  }).sort((a, b) => b.total - a.total);
  const monthTitle = (value: string) => value ? new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`)) : "—";
  const comparisonRows: { label: string; first: string | number; second: string | number; change: string }[] = [
    { label: "إجمالي التسجيلات", first: firstComparison.registrations, second: secondComparison.registrations, change: `${secondComparison.registrations - firstComparison.registrations}` },
    { label: "طلاب جدد", first: firstComparison.newStudents, second: secondComparison.newStudents, change: `${secondComparison.newStudents - firstComparison.newStudents}` },
    { label: "طلاب قدام", first: firstComparison.oldStudents, second: secondComparison.oldStudents, change: `${secondComparison.oldStudents - firstComparison.oldStudents}` },
    { label: "قدام رجعوا بعد انقطاع", first: firstComparison.returned, second: secondComparison.returned, change: `${secondComparison.returned - firstComparison.returned}` },
    { label: "الاشتراكات الجديدة", first: firstComparison.newSubscriptions, second: secondComparison.newSubscriptions, change: `${secondComparison.newSubscriptions - firstComparison.newSubscriptions}` },
    { label: "إيراد الاشتراكات الجديدة", first: `${firstComparison.newRevenue.toLocaleString("en-US")} ج.م`, second: `${secondComparison.newRevenue.toLocaleString("en-US")} ج.م`, change: `${(secondComparison.newRevenue - firstComparison.newRevenue).toLocaleString("en-US")} ج.م` },
    { label: "Retention", first: firstComparison.retention === null ? "—" : `${firstComparison.retention.toFixed(1)}%`, second: secondComparison.retention === null ? "—" : `${secondComparison.retention.toFixed(1)}%`, change: firstComparison.retention === null || secondComparison.retention === null ? "—" : `${(secondComparison.retention - firstComparison.retention).toFixed(1)} نقطة` }
  ];
  return <><PageHead title="إحصائيات التسويق" description="أعداد التسجيلات وتصنيفاتها ومصادرها وإيراد الاشتراكات الجديدة، حسب الشهر والراوند." actions={profile.role === "owner" ? <button className="btn btn--ghost btn--small" onClick={() => void refreshProjection()}>تحديث بيانات المسوّق</button> : undefined} />
    <section className="section"><div className="toolbar"><label className="field"><span>الشهر</span><select className="search-input" value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="field"><span>الراوند</span><select className="search-input" value={roundId} onChange={(event) => setRoundId(event.target.value)}><option value="">كل الراوندات</option><option value="pv">Private</option>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select></label><label className="field"><span>المصدر</span><select className="search-input" value={source} onChange={(event) => setSource(event.target.value)}><option value="">كل المصادر</option>{sourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
      <div className="metric-grid"><Metric icon={Users} value={rows.length} label="إجمالي تسجيلات الشهر" /><Metric icon={UsersRound} value={groupCount} label="طلاب الجروبات" /><Metric icon={LockKeyhole} value={privateCount} label="طلاب Private" /><Metric icon={GraduationCap} value={categoryCount("new")} label="طلاب جدد" /><Metric icon={Users} value={categoryCount("old")} label="طلاب قدام" /><Metric icon={Users} value={categoryCount("returned")} label="قدام رجعوا بعد انقطاع" /></div>
      <div className="retention-grid"><div className="retention-card"><strong>{newRows.length}</strong><span>اشتراكات مصنفة جديدة</span></div><div className="retention-card"><strong>{newSubscriptionValue.toLocaleString("en-US")} ج.م</strong><span>إيراد الاشتراكات المصنفة جديدة فقط · حسب الفلاتر</span></div></div>
    </section>
    <section className="section marketing-comparison"><div className="section-head"><div><h2>مقارنة الفترات</h2><p>قارن التسجيلات والتصنيفات وإيراد الاشتراكات الجديدة والـRetention؛ فلاتر الراوند والمصدر المختارة تنطبق على الفترتين.</p></div></div><div className="toolbar marketing-comparison__filters"><label className="field"><span>الفترة الأولى</span><select className="search-input" value={compareFirst} onChange={(event) => setCompareFirst(event.target.value)}>{months.map((item) => <option key={item} value={item}>{monthTitle(item)}</option>)}</select></label><label className="field"><span>الفترة الثانية</span><select className="search-input" value={compareSecond} onChange={(event) => setCompareSecond(event.target.value)}>{months.map((item) => <option key={item} value={item}>{monthTitle(item)}</option>)}</select></label></div><div className="teacher-sessions-wrap"><table className="daily-sessions-table"><thead><tr><th>المؤشر</th><th>{monthTitle(compareFirst)}</th><th>{monthTitle(compareSecond)}</th><th>التغيير</th></tr></thead><tbody>{comparisonRows.map((item) => <tr key={item.label}><th scope="row">{item.label}</th><td>{item.first}</td><td>{item.second}</td><td>{item.change}</td></tr>)}</tbody></table></div><div className="marketing-comparison__sources"><strong>مصادر {monthTitle(compareSecond)}</strong>{comparisonSourceStats.length ? comparisonSourceStats.map((item) => <span className="tag tag--muted" key={item.source}>{item.source}: {item.total} تسجيل · جديد {item.newCount} · قديم {item.oldCount} · عائد {item.returnedCount} · {item.revenue.toLocaleString("en-US")} ج.م اشتراكات جديدة</span>) : <span className="tag tag--muted">لا توجد تسجيلات مطابقة.</span>}</div></section>
    <section className="section marketing-chart"><div className="section-head"><div><h2>الإيراد والتصنيفات حسب المصدر</h2><p>يعرض الإيراد فقط للتسجيلات المصنفة كاشتراك جديد. الطالب القديم العائد يظل تحت مصدر اكتسابه الأصلي، مثل Instagram.</p></div></div>{sourceStats.length ? <div className="marketing-chart__rows">{sourceStats.map((item) => <div className="marketing-chart__row" key={item.source}><div className="marketing-chart__head"><strong>{item.source}</strong><span>{item.subscriptionCount} اشتراك · {item.revenue.toLocaleString("en-US")} ج.م</span></div><div className="marketing-chart__track"><i style={{ width: `${Math.max(item.revenue ? 3 : 0, item.revenue / maxSourceRevenue * 100)}%` }} /></div><div className="marketing-chart__meta"><span>{item.total} تسجيل</span><span>جديد {item.newCount}</span><span>قديم {item.oldCount}</span><span>عائد بعد انقطاع {item.returnedCount}</span></div></div>)}</div> : <div className="empty">لا توجد بيانات مصدر مطابقة للشهر والراوند.</div>}</section>
    <section className="section"><div className="section-head"><div><h2>تفاصيل التسجيلات</h2><p>المصدر هنا مصدر اكتساب الطالب؛ وتصنيف الاشتراك مستقل لكل تسجيل جولة.</p></div><span className="tag tag--muted">{rows.length} تسجيل</span></div>{rows.length ? <div className="teacher-sessions-wrap"><table className="daily-sessions-table"><thead><tr><th>الطالب</th><th>النوع</th><th>تصنيف الطالب</th><th>المصدر</th><th>تصنيف الاشتراك</th><th>إيراد الاشتراك</th></tr></thead><tbody>{rows.map(({ student, group, source: studentSource }) => { const subscriptionIsNew = (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new"; return <tr key={student.id}><td>{student.n || "بدون اسم"}</td><td>{group.p ? "Private" : roundName(data.r.find((round) => round.id === group.r))}</td><td>{studentKindLabel(studentKind(student))}</td><td>{profile.role === "owner" ? <select aria-label={`مصدر ${student.n || "طالب"}`} value={student.source || studentSource} onChange={(event) => commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) { target.source = event.target.value; target.subscriptionSource = event.target.value; } }, "تم تحديث مصدر الطالب.")}><option value="">بدون مصدر</option>{sourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select> : studentSource || "بدون مصدر"}</td><td>{profile.role === "owner" ? <select aria-label={`تصنيف اشتراك ${student.n || "طالب"}`} value={subscriptionIsNew ? "new" : "renewal"} onChange={(event) => commit((draft) => { const target = draft.m.find((item) => item.id === student.id); if (target) target.subscriptionClass = event.target.value as Student["subscriptionClass"]; }, "تم تحديث تصنيف الاشتراك.")}><option value="new">اشتراك جديد</option><option value="renewal">تجديد</option></select> : subscriptionIsNew ? "اشتراك جديد" : "تجديد"}</td><td>{subscriptionIsNew ? `${Number(student.amount ?? 0).toLocaleString("en-US")} ج.م` : "—"}</td></tr>; })}</tbody></table></div> : <div className="empty">لا توجد تسجيلات مطابقة للفلاتر.</div>}</section>
  </>;
}

function RetentionView({ data }: { data: AcademyData }) {
  const [monthFilter, setMonthFilter] = useState("");
  const [roundFilter, setRoundFilter] = useState("");
  const months = retentionByMonth(data);
  const shown = months.filter((entry) => !monthFilter || entry.month === monthFilter).map((entry) => {
    const registrations = entry.registrations.filter((row) => !roundFilter || row.group.r === roundFilter);
    return { ...entry, registrations, paidRows: registrations.filter((row) => row.paid) };
  }).filter((entry) => entry.registrations.length).slice().reverse();
  const registrations = shown.flatMap((entry) => entry.registrations);
  const paid = shown.flatMap((entry) => entry.paidRows);
  const cohortsWithNext = shown.filter((entry) => entry.nextMonth).flatMap((entry) => entry.paidRows);
  const kept = cohortsWithNext.filter((entry) => entry.kept).length;
  const rate = cohortsWithNext.length ? `${Math.round((kept / cohortsWithNext.length) * 1000) / 10}%` : "—";
  const privateRegistrations = registrations.filter((entry) => Boolean(entry.group.p));
  const dateLabel = (value: string) => new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00`));
  const rounds = live(data.r).filter((round) => !round.pl);

  return <><PageHead title="الريتينشن" description="حساب حسب شهر بداية الجروب، مع إدخال طلاب الـPrivate وتفاصيلهم بوصف Private مستقل." />
    <section className="section"><div className="toolbar"><label className="field"><span>الشهر</span><select className="search-input" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="">كل الشهور</option>{months.slice().reverse().map((entry) => <option key={entry.month} value={entry.month}>{dateLabel(entry.month)}</option>)}</select></label><label className="field"><span>الراوند</span><select className="search-input" value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}><option value="">كل الراوندات</option><option value="pv">Private</option>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}</option>)}</select></label></div>
      <div className="retention-grid">
        <div className="retention-card"><strong>{registrations.length}</strong><span>إجمالي التسجيلات في الفترة</span></div>
        <div className="retention-card"><strong>{paid.length}</strong><span>طلاب دفعوا في الفترة</span></div>
        <div className="retention-card"><strong>{registrations.length - paid.length}</strong><span>طلاب لم يدفعوا</span></div>
        <div className="retention-card"><strong>{kept}</strong><span>جددوا فعلًا في الشهر التالي</span></div>
        <div className="retention-card"><strong>{rate}</strong><span>نسبة الريتينشن للحالات ذات شهر لاحق</span></div>
        <div className="retention-card"><strong>{privateRegistrations.length}</strong><span>تسجيلات Private ضمن الفترة</span></div>
      </div>
    </section>
    <section className="section"><div className="section-head"><div><h2>الأشهر والراوندات</h2><p>الطالب يعدّ مجددًا عند العثور عليه بالهاتف أو الاسم ودفعه في مجموعة بدأت في الشهر التقويمي التالي.</p></div></div>
      <div className="card-list">{shown.map((entry) => {
        const groupMap = new Map<string, typeof entry.registrations>();
        entry.registrations.forEach((row) => { const rows = groupMap.get(row.group.id) ?? []; rows.push(row); groupMap.set(row.group.id, rows); });
        const monthKept = entry.paidRows.filter((row) => row.kept).length;
        const monthRate = entry.nextMonth ? `${Math.round((monthKept / Math.max(1, entry.paidRows.length)) * 100)}%` : "لا توجد بيانات للشهر التالي";
        return <details className="accordion" key={entry.month}>
          <summary className="accordion__summary"><div className="grow"><h3>{dateLabel(entry.month)}</h3><span>{entry.nextMonth ? `مقارنة مع ${dateLabel(entry.nextMonth)}` : "لا توجد بيانات للشهر التقويمي التالي"}</span></div><span className="tag">{entry.registrations.length} طالب</span><span className="tag tag--muted">دفع {entry.paidRows.length}</span><span className="tag">{monthRate}</span><ChevronDown size={17} /></summary>
          <div className="accordion__body"><div className="card-list" style={{ marginTop: 12 }}>{[...groupMap.values()].map((rows) => {
            const group = rows[0].group;
            const paidRows = rows.filter((row) => row.paid);
            const retainedRows = paidRows.filter((row) => row.kept);
            const round = group.p ? "Private" : roundName(data.r.find((roundItem) => roundItem.id === group.r));
            return <div className={`entity-card ${group.p ? "retention-private" : ""}`} key={group.id}>
              <div className="entity-card__top"><div><h3>{group.p ? "Private · " : ""}{group.lv || "بدون اسم"}</h3><p>{round} · {teacherDisplayName(data, group.tc)} · {groupTime(group)}</p></div><span className="tag">{retainedRows.length} من {paidRows.length} دفعوا وجددوا</span></div>
              <div className="roster">{rows.map((row, index) => {
                const status = !row.paid ? "لم يدفع" : !entry.nextMonth ? "لا توجد بيانات للشهر التالي" : row.kept ? "جدد بالفعل" : row.pending ? "مسجل ولم يدفع بعد" : "لم يجدد";
                const tone = !row.paid ? "tag--muted" : row.kept ? "" : row.pending ? "tag--warning" : "tag--danger";
                return <div className="roster-row" key={row.student.id}><div className="name-line"><span className="tag tag--muted">{index + 1}</span><strong>{row.student.n || "بدون اسم"}</strong><span className="tag tag--muted">{studentKindLabel(studentKind(row.student))}</span><span className="tag tag--muted">{studentSourceLabel(row.student)}</span></div><bdi className="phone phone-number" dir="ltr">{row.student.ph || "—"}</bdi><span className={`tag ${tone}`}>{status}</span></div>;
              })}</div>
            </div>;
          })}</div></div>
        </details>;
      })}{!shown.length && <div className="empty">لا توجد مجموعات مطابقة لتاريخ البداية أو فلتر الراوند.</div>}</div>
    </section>
  </>;
}

interface ArchiveItem {
  key: string;
  collection: "r" | "g" | "m" | "l" | "finance";
  id: string;
  kind: string;
  label: string;
  archivedAt: number;
  item: { id: string; x?: unknown; xa?: unknown };
}

function mergeBackup(draft: AcademyData, value: Partial<AcademyData>) {
  const keys = ["r", "g", "m", "l", "attendance", "teacherAbsences", "finance", "teacherHours", "scripts"] as const;
  keys.forEach((key) => {
    const destination = draft[key] as unknown[];
    const incoming = Array.isArray(value[key]) ? value[key] as unknown[] : [];
    const identity = (item: unknown) => {
      const row = item as Record<string, unknown>;
      if (key === "attendance") return `${String(row.date ?? "")}|${String(row.gid ?? "")}|${String(row.mid ?? "")}`;
      if (key === "teacherHours") return normalise(row.name);
      if (key === "teacherAbsences") return String(row.id ?? JSON.stringify(row));
      return String(row.id ?? "");
    };
    const seen = new Set(destination.map(identity));
    incoming.forEach((item) => { const id = identity(item); if (id && !seen.has(id)) { destination.push(item); seen.add(id); } });
  });
  if (!draft.cur && value.cur) draft.cur = value.cur;
}

function SecurityView({ data, profile, commit, backups, backupsLoading, loadBackups, refreshBackups, focusArchiveKey }: { data: AcademyData; profile: Profile; commit: Commit; backups: CloudBackup[]; backupsLoading: boolean; loadBackups: () => Promise<CloudBackup[]>; refreshBackups: () => Promise<CloudBackup[]>; focusArchiveKey?: string }) {
  const [importing, setImporting] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [focusedArchiveKey, setFocusedArchiveKey] = useState(focusArchiveKey ?? "");
  useEffect(() => { setFocusedArchiveKey(focusArchiveKey ?? ""); if (focusArchiveKey) setArchiveQuery(""); }, [focusArchiveKey]);
  useEffect(() => { void loadBackups(); }, [loadBackups]);
  const latestBackup = Math.max(Number(data.lb ?? 0), backups[0]?.createdAt ?? 0);
  const backupIsOld = !latestBackup || Date.now() - latestBackup > 8 * 86400000;
  const archived: ArchiveItem[] = [
    ...data.r.filter((item) => item.x).map((item) => ({ key: `r:${item.id}`, collection: "r" as const, id: item.id, kind: "راوند", label: item.n || "راوند بدون اسم", archivedAt: Number(item.xa ?? 0), item })),
    ...data.g.filter((item) => item.x).map((item) => ({ key: `g:${item.id}`, collection: "g" as const, id: item.id, kind: item.p ? "Private" : "جروب", label: item.lv || "جروب بدون اسم", archivedAt: Number(item.xa ?? 0), item })),
    ...data.m.filter((item) => item.x).map((item) => ({ key: `m:${item.id}`, collection: "m" as const, id: item.id, kind: "طالب", label: item.n || "طالب بدون اسم", archivedAt: Number(item.xa ?? 0), item })),
    ...data.l.filter((item) => item.x).map((item) => ({ key: `l:${item.id}`, collection: "l" as const, id: item.id, kind: "ليد", label: item.n || item.ph || "ليد", archivedAt: Number(item.xa ?? 0), item })),
    ...(canAccessFinance(profile.role) ? data.finance.filter((item) => item.x).map((item) => ({ key: `finance:${item.id}`, collection: "finance" as const, id: item.id, kind: "مصروف", label: item.note || "مصروف مؤرشف", archivedAt: Number(item.xa ?? 0), item })) : [])
  ].sort((a, b) => b.archivedAt - a.archivedAt);
  const shownArchive = archived.filter((item) => (!focusedArchiveKey || item.key === focusedArchiveKey) && `${item.kind} ${item.label}`.toLocaleLowerCase().includes(archiveQuery.toLocaleLowerCase()));
  const downloadJson = () => {
    const snapshot = { ...data, finance: canAccessFinance(profile.role) ? data.finance : [], lb: Date.now() };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `speakozy-backup-${toIsoDate()}.json`; link.click(); URL.revokeObjectURL(url);
    commit((draft) => { draft.lb = snapshot.lb; }, "تم تنزيل نسخة JSON احتياطية.");
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AcademyData>;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      const safeParsed = canAccessFinance(profile.role) ? parsed : { ...parsed, finance: [] };
      commit((draft) => { mergeBackup(draft, safeParsed); if (!canAccessFinance(profile.role)) draft.finance = []; }, "تمت إضافة السجلات الجديدة من النسخة دون استبدال بيانات النظام الحالية.");
    } catch { window.alert("الملف ليس نسخة JSON صالحة."); }
    finally { setImporting(false); }
  };
  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const roundRows = data.r.map((round) => ({ الراوند: roundName(round), المعرف: round.id, الحالة: round.x ? "مؤرشف" : round.on === false ? "موقوف" : "نشط" }));
      const groupRows = data.g.map((group) => ({ النوع: group.p ? "Private" : "جروب", الراوند: roundName(data.r.find((round) => round.id === group.r)), المستوى: group.lv ?? "", الأيام: group.d ?? "", من: group.t1 ?? "", إلى: group.t2 ?? "", المدرس: teacherDisplayName(data, group.tc), البداية: group.s ?? "", النهاية: group.e ?? "", مؤرشف: Boolean(group.x) }));
      const studentRows = data.m.map((student) => { const group = data.g.find((item) => item.id === student.g); return { الطالب: student.n ?? "", الهاتف: student.ph ?? "", المستوى: student.lv ?? "", تصنيف_الطالب: studentKindLabel(studentKind(student)), المصدر: studentSourceLabel(student), سبب_عدم_التجديد: student.renewalReason ?? "", الليفلات_المدفوعة: student.lvPaid ?? 1, النوع: group?.p ? "Private" : "جروب", المجموعة: displayGroupLabel(group ?? { id: "", r: "", p: 0 }, data), الدفع: ["لسه", "دفع", "جزئي"][Number(student.pay ?? 0)] ?? "", قيمة_الدفع: Number(student.amount ?? 0), المتبقي: student.pn ?? "", التجديد: ["لسه", "هيجدد", "مش هيجدد"][Number(student.ren ?? 0)] ?? "", الملاحظات: student.nt ?? "", مؤرشف: Boolean(student.x) }; });
      const leadRows = data.l.map((lead) => ({ الاسم: lead.n ?? "", الهاتف_أو_المستخدم: lead.ph ?? "", المستوى: lead.lv ?? "", المصدر: studentSourceLabel(lead), التصنيف: leadCategory(lead), الحالة: lead.st ?? "", الوقت_المفضل: lead.tm ?? "", موعد_المتابعة: leadFollowupDate(lead), الملاحظات: lead.nt ?? "", مؤرشف: Boolean(lead.x) }));
      const visibleAttendance = data.attendance.filter((row) => { const group = data.g.find((item) => item.id === row.gid); return !isTeacherNameArchived(data, group?.tc ?? "") && !isTeacherNameArchived(data, row.teacher ?? ""); });
      const attendanceRows = visibleAttendance.map((row) => ({ التاريخ: row.date, الجروب: displayGroupLabel(data.g.find((group) => group.id === row.gid) ?? { id: "", r: "", p: 0 }, data), الطالب: data.m.find((student) => student.id === row.mid)?.n ?? "", الحالة: ({ present: "حاضر", absent: "غائب", late: "متأخر", excused: "غياب بعذر" } as Record<string, string>)[row.status] ?? row.status, المدرس: teacherDisplayName(data, row.teacher ?? "") }));
      const financeRows = canAccessFinance(profile.role) ? data.finance.map((row) => ({ النوع: row.type === "income" ? "إيراد" : "مصروف", المبلغ: row.amount, التاريخ: row.date, البيان: row.note ?? "", مؤرشف: Boolean(row.x) })) : [];
      const visibleTeacherHours = data.teacherHours.filter((item) => !isTeacherNameArchived(data, item.name));
      const scriptRows = (data.scripts ?? []).map((script) => ({ الاسم: script.title, النوع: script.kind, التصنيف: script.category, النص: script.body, آخر_تحديث: script.updatedAt }));
      const sheets: [string, unknown[]][] = [["الراوندات", roundRows], ["الجروبات والبرايفت", groupRows], ["الطلاب", studentRows], ["الليدز", leadRows], ["السكريبتات", scriptRows], ["الحضور", attendanceRows], ["ساعات المدرسين", visibleTeacherHours]];
      if (canAccessFinance(profile.role)) sheets.splice(5, 0, ["الحركات المالية", financeRows]);
      sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name));
      XLSX.writeFile(workbook, `Speakozy-Backup-${toIsoDate()}.xlsx`);
      commit((draft) => { draft.lb = Date.now(); }, "تم تنزيل نسخة Excel احتياطية.");
    } catch (error) { console.error("Excel backup failed", error); window.alert("تعذر تجهيز ملف Excel الآن."); }
  };
  const exportArchivedRounds = async () => {
    const rounds = data.r.filter((round) => Boolean(round.x));
    if (!rounds.length) { window.alert("لا توجد راوندات مؤرشفة لتصديرها."); return; }
    try {
      const XLSX = await import("xlsx"); const workbook = XLSX.utils.book_new();
      const roundGroups = data.g.filter((group) => rounds.some((round) => round.id === group.r));
      const groupIds = new Set(roundGroups.map((group) => group.id));
      const students = data.m.filter((student) => groupIds.has(student.g));
      const roundRows = rounds.map((round) => ({ الراوند: roundName(round), المعرف: round.id }));
      const studentRows = students.map((student) => ({ الطالب: student.n ?? "", الهاتف: student.ph ?? "", المستوى: student.lv ?? "", المجموعة: groupLabel(data.g.find((group) => group.id === student.g)), الدفع: student.pay ?? 0, قيمة_الدفع: student.amount ?? 0, المتبقي: student.pn ?? "", التجديد: student.ren ?? 0 }));
      const attendanceRows = data.attendance.filter((row) => groupIds.has(row.gid)).map((row) => ({ التاريخ: row.date, الجروب: groupLabel(data.g.find((group) => group.id === row.gid)), الطالب: data.m.find((student) => student.id === row.mid)?.n ?? "", الحالة: row.status, المدرس: row.teacher ?? "" }));
      [["بيانات الراوندات", roundRows], ["الجروبات", roundGroups.map((group) => ({ النوع: group.p ? "Private" : "جروب", الراوند: roundName(rounds.find((round) => round.id === group.r)), المستوى: group.lv ?? "", الأيام: group.d ?? "", من: group.t1 ?? "", إلى: group.t2 ?? "", المدرس: group.tc ?? "" }))], ["الطلاب", studentRows], ["الحضور", attendanceRows]].forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows as object[]), name as string));
      XLSX.writeFile(workbook, `Speakozy-Archived-Rounds-${toIsoDate()}.xlsx`);
    } catch (error) { console.error("Archived rounds export failed", error); window.alert("تعذر تجهيز ملف الراوندات المؤرشفة."); }
  };
  const restoreArchive = (entry: ArchiveItem) => commit((draft) => {
    const target = (draft[entry.collection] as { id: string; x?: unknown; xa?: unknown }[]).find((item) => item.id === entry.id);
    if (target) { target.x = 0; delete target.xa; }
  }, "تم استرجاع العنصر من الأرشيف.");
  const permanentlyDelete = (entry: ArchiveItem) => {
    if (!window.confirm(`حذف نهائي لـ«${entry.label}»؟ لا يمكن استرجاعه بعد ذلك.`)) return;
    if (window.prompt("للتأكيد اكتب: حذف نهائي") !== "حذف نهائي") return;
    commit((draft) => {
      if (entry.collection === "r") {
        const groups = new Set(draft.g.filter((group) => group.r === entry.id).map((group) => group.id));
        const students = new Set(draft.m.filter((student) => groups.has(student.g)).map((student) => student.id));
        draft.r = draft.r.filter((item) => item.id !== entry.id); draft.g = draft.g.filter((item) => !groups.has(item.id)); draft.m = draft.m.filter((item) => !students.has(item.id)); draft.attendance = draft.attendance.filter((row) => !groups.has(row.gid) && !students.has(row.mid));
      } else if (entry.collection === "g") {
        const students = new Set(draft.m.filter((student) => student.g === entry.id).map((student) => student.id));
        draft.g = draft.g.filter((item) => item.id !== entry.id); draft.m = draft.m.filter((item) => !students.has(item.id)); draft.attendance = draft.attendance.filter((row) => row.gid !== entry.id && !students.has(row.mid));
      } else if (entry.collection === "m") { draft.m = draft.m.filter((item) => item.id !== entry.id); draft.attendance = draft.attendance.filter((row) => row.mid !== entry.id); }
      else draft[entry.collection] = draft[entry.collection].filter((item) => item.id !== entry.id) as never;
    }, "تم الحذف النهائي بعد التأكيد.");
  };
  const restoreCloudBackup = (backup: CloudBackup) => {
    if (backup.kind === "finance" && !canAccessFinance(profile.role)) { window.alert("النسخ المالية متاحة للمالك فقط."); return; }
    if (!window.confirm("ستُضاف السجلات غير الموجودة فقط؛ لن تُستبدل السجلات الحالية. هل تريد المتابعة؟")) return;
    try {
      const parsed = JSON.parse(backup.data) as Partial<AcademyData> | AcademyData["finance"];
      if (backup.kind === "finance") {
        const finance = Array.isArray(parsed) ? parsed : [];
        commit((draft) => mergeBackup(draft, { finance }), "تمت إضافة الحركات المالية غير الموجودة من النسخة.");
      } else {
        const safeParsed = canAccessFinance(profile.role) ? parsed as Partial<AcademyData> : { ...(parsed as Partial<AcademyData>), finance: [] };
        commit((draft) => { mergeBackup(draft, safeParsed); if (!canAccessFinance(profile.role)) draft.finance = []; }, "تمت إضافة السجلات غير الموجودة من النسخة.");
      }
    } catch { window.alert("تعذر قراءة النسخة المختارة."); }
  };
  const ageDays = latestBackup ? Math.floor((Date.now() - latestBackup) / 86400000) : null;
  return <><PageHead title="الأمان والنسخ" description="نسخ محلية وسحابية قابلة للاستعادة، وأرشيف يحتفظ بالسجلات بدل حذفها." />
    {backupIsOld && <div className="notice notice--warning">تنبيه: لا توجد نسخة احتياطية حديثة خلال آخر 8 أيام. نزّل نسخة محلية الآن.</div>}
    <section className="section"><div className="section-head"><div><h2>حالة النسخ</h2><p>{latestBackup ? `آخر نسخة قبل ${ageDays} يوم · ${formatDate(toIsoDate(new Date(latestBackup)))}` : "لم تُسجّل نسخة احتياطية بعد."}</p></div><button className="btn btn--ghost" onClick={() => void refreshBackups()} disabled={backupsLoading}>{backupsLoading ? "جارٍ التحديث…" : "تحديث النسخ السحابية"}</button></div>
      <div className="card-list"><div className="entity-card"><div className="entity-card__top"><div><h3>نسخة Excel كاملة</h3><p>الراوندات والجروبات والـPrivate والطلاب والليدز والحضور{canAccessFinance(profile.role) ? " والحركات المالية" : ""} وساعات المدرسين.</p></div><FileDown color="#3e928d" /></div><div className="entity-card__actions"><button className="btn" onClick={() => void exportExcel()}>تحميل Excel</button><button className="btn btn--ghost" onClick={downloadJson}>تنزيل JSON</button><button className="btn btn--ghost" onClick={() => { const snapshot = { ...data, finance: canAccessFinance(profile.role) ? data.finance : [] }; void safeCopy(JSON.stringify(snapshot)).then(() => window.alert("تم نسخ JSON.")); }}><Copy size={14} />نسخ JSON</button></div></div>
        <div className="entity-card"><div className="entity-card__top"><div><h3>نسخة الراوندات المؤرشفة</h3><p>تصدير بيانات الراوندات المؤرشفة والطلاب والجروبات والحضور في ملف مستقل.</p></div><ArchiveRestore color="#3e928d" /></div><div className="entity-card__actions"><button className="btn btn--ghost" onClick={() => void exportArchivedRounds()}>تصدير الراوندات المؤرشفة Excel</button></div></div>
        <div className="entity-card"><div className="entity-card__top"><div><h3>استعادة إضافية من JSON</h3><p>تضيف السجلات غير الموجودة فقط ولا تستبدل سجلات النظام الحالية.</p></div><ArchiveRestore color="#3e928d" /></div><div className="entity-card__actions"><label className="btn btn--ghost" htmlFor="backup-file">{importing ? "جارٍ الاستيراد…" : "اختيار ملف JSON"}</label><input className="sr-only" id="backup-file" type="file" accept="application/json" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div></div>
      </div>
    </section>
    <section className="section"><div className="section-head"><div><h2>النسخ السحابية اليومية</h2><p>تُنشأ نسخة Firestore يومية بعد تسجيل الدخول، مع فصل نسخة المالية الخاصة بالمالك.</p></div></div><div className="card-list">{backups.length ? backups.map((backup) => <div className="entity-card" key={`${backup.kind}:${backup.id}`}><div className="entity-card__top"><div><h3>{backup.kind === "finance" ? "نسخة مالية" : "نسخة بيانات النظام"}</h3><p>{backup.day ? formatDate(backup.day) : "تاريخ غير متاح"} · {backup.by || ""}</p></div><button className="btn btn--ghost btn--small" onClick={() => restoreCloudBackup(backup)}>استعادة إضافية</button></div></div>) : <div className="empty">{import.meta.env.DEV ? "المعاينة لا تقرأ النسخ السحابية أو بيانات Firebase." : "لا توجد نسخ سحابية ظاهرة لهذا الحساب."}</div>}</div></section>
    <section className="section"><div className="section-head"><div><h2>الأرشيف</h2><p>السجلات محفوظة هنا للاستعادة أو الحذف النهائي المؤكد.</p></div></div><div className="toolbar"><input className="search-input" placeholder="بحث في الأرشيف" value={archiveQuery} onChange={(event) => { setArchiveQuery(event.target.value); setFocusedArchiveKey(""); }} /></div><div className="card-list">{shownArchive.map((entry) => <div className={`entity-card ${focusedArchiveKey === entry.key ? "archive-focused" : ""}`} key={entry.key}><div className="entity-card__top"><div><span className="tag tag--muted">{entry.kind}</span><h3>{entry.label}</h3><p>{entry.archivedAt ? `أُرشف ${formatDate(toIsoDate(new Date(entry.archivedAt)))}` : "محفوظ في الأرشيف ويمكن استعادته."}</p></div><div className="toolbar"><button className="btn btn--ghost btn--small" onClick={() => restoreArchive(entry)}>استرجاع</button><button className="btn btn--ghost btn--small btn--danger" onClick={() => permanentlyDelete(entry)}>حذف نهائي</button></div></div></div>)}{!shownArchive.length && <div className="empty">لا توجد عناصر مطابقة في الأرشيف.</div>}</div></section>
  </>;
}

function SearchOverlay({ data, profile, onClose, onGroup, onStudent, onLead }: { data: AcademyData; profile: Profile; onClose: () => void; onGroup: (id: string, isPrivate: boolean) => void; onStudent: (student: Student) => void; onLead: (lead: Lead) => void }) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [roundFilter, setRoundFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [renewalFilter, setRenewalFilter] = useState("");
  const text = query.trim().toLocaleLowerCase();
  const archivedTeacher = profile.role === "teacher" && isTeacherNameArchived(data, profile.teacherName);
  const visibleGroups = archivedTeacher ? [] : activeGroups(data).filter((group) => (profile.role !== "teacher" || normalise(group.tc) === normalise(profile.teacherName))
    && (!group.p || !live(data.m).some((student) => student.g === group.id && !student.x) || live(data.m).some((student) => student.g === group.id && isActiveStudentEnrollment(student, data) && !isListedInFormerCustomers(student, data))));
  const visibleIds = new Set(visibleGroups.map((group) => group.id));
  const formerStudents = profile.role === "teacher" ? [] : formerCustomerRows(data).filter((student) => !hasActiveStudentEnrollment(student, data));
  const formerStudentIds = new Set(formerStudents.map((student) => student.id));
  const rounds = profile.role === "teacher" ? [] : live(data.r);
  const teachers = profile.role === "teacher" ? [] : teacherNames(data);
  const sources = STUDENT_SOURCES;
  const canFilterPayments = canAccessFinance(profile.role);
  const canFilterRenewals = profile.role !== "teacher";
  const matchesText = (value: string) => !text || value.toLocaleLowerCase().includes(text);
  const phoneQuery = personPhone(text);
  const matchesPersonText = (name: string, phone: string, extra = "") => matchesText(`${name} ${phone} ${extra}`)
    || Boolean(!isStudentCodeQuery(text) && phoneQuery && personPhone(phone).includes(phoneQuery));
  const studentsForGroup = (group: AcademyGroup) => live(data.m).filter((student) => student.g === group.id);
  const acceptsStudentType = (group: AcademyGroup) => !kindFilter || kindFilter === (group.p ? "private" : "group");
  const acceptsRosterFilters = (group: AcademyGroup) => {
    const roster = studentsForGroup(group);
    return (!sourceFilter || roster.some((student) => student.source === sourceFilter))
      && (!classificationFilter || roster.some((student) => studentKind(student) === classificationFilter))
      && (!canFilterPayments || !paymentFilter || roster.some((student) => String(student.pay ?? 0) === paymentFilter))
      && (!canFilterRenewals || !renewalFilter || roster.some((student) => String(student.ren ?? 0) === renewalFilter));
  };
  const eligibleGroups = visibleGroups.filter((group) => (!roundFilter || group.r === roundFilter)
    && (!teacherFilter || normalise(group.tc) === normalise(teacherFilter))
    && (!kindFilter || kindFilter === "group" && !group.p || kindFilter === "private" && Boolean(group.p))
    && acceptsRosterFilters(group));
  const groups = eligibleGroups.filter((group) => !group.p && matchesText(`${displayGroupLabel(group, data)} ${teacherDisplayName(data, group.tc)}`)).slice(0, 15);
  const students = !archivedTeacher ? live(data.m).filter((student) => {
    const group = data.g.find((item) => item.id === student.g);
    if ((!group || !visibleIds.has(student.g)) && !formerStudentIds.has(student.id)) return false;
    if (!formerStudentIds.has(student.id) && (!isActiveStudentEnrollment(student, data) || isListedInFormerCustomers(student, data))) return false;
    return (!roundFilter || group?.r === roundFilter)
      && (!teacherFilter || Boolean(group && normalise(group.tc) === normalise(teacherFilter)))
      && (!kindFilter || kindFilter === "student" || kindFilter === (group?.p || student.enrollmentType === "private" ? "private" : "group"))
      && (!classificationFilter || studentKind(student) === classificationFilter)
      && (!sourceFilter || student.source === sourceFilter)
      && (!canFilterPayments || !paymentFilter || String(student.pay ?? 0) === paymentFilter)
      && (!canFilterRenewals || !renewalFilter || String(student.ren ?? 0) === renewalFilter)
      && (matchesPersonText(student.n ?? "", student.ph ?? "", `${student.source ?? ""} ${student.sourceOther ?? ""}`) || matchesStudentCode(studentCodeFor(student), text));
  }).slice(0, 15) : [];
  const canShowLeads = profile.role !== "teacher" && (!kindFilter || kindFilter === "lead")
    && !classificationFilter && !roundFilter && !teacherFilter && !paymentFilter && !renewalFilter;
  const leads = canShowLeads ? uniqueLeads(live(data.l)).filter((lead) => (!sourceFilter || lead.source === sourceFilter)
    && !formerStudents.some((student) => samePerson(student, lead))
    && (matchesPersonText(lead.n ?? "", lead.ph ?? "", `${lead.source ?? ""} ${lead.sourceOther ?? ""} ${lead.followupReason ?? ""}`) || matchesStudentCode(studentCodeFor(lead), text))).slice(0, 15) : [];
  const activeFilters = Boolean(text || kindFilter || classificationFilter || roundFilter || sourceFilter || teacherFilter || paymentFilter || renewalFilter);
  const studentPaymentLabel = (student: Student) => student.pay === 2 ? "دفع جزئي" : student.pay === 1 ? "مدفوع" : "غير مدفوع";
  const studentRenewalLabel = (student: Student) => student.ren === 2 ? "مش هيجدد" : student.ren === 1 ? "هيجدد" : "لم يقرر";
  return <Overlay onClose={onClose}><div className="popover"><div className="popover__head"><h2>بحث شامل</h2><button className="btn btn--ghost btn--icon" onClick={onClose}><X size={17} /></button></div>
    <input autoFocus className="search-input" placeholder="الاسم أو الهاتف أو كود SPK أو اسم الجروب…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="search-filters">
      <select aria-label="نوع النتيجة" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="">كل الأنواع</option><option value="student">طلاب</option><option value="lead">ليدز</option><option value="group">جروبات</option><option value="private">Private</option></select>
      <select aria-label="تصنيف الطالب" value={classificationFilter} onChange={(event) => setClassificationFilter(event.target.value)}><option value="">كل تصنيفات الطلاب</option><option value="new">جديد</option><option value="old">قديم</option><option value="returned">قديم رجع بعد انقطاع</option></select>
      {profile.role !== "teacher" && <select aria-label="الراوند" value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}><option value="">كل الراوندات</option>{rounds.map((round) => <option key={round.id} value={round.id}>{roundName(round)}{round.on === false ? " · متوقفة" : ""}</option>)}</select>}
      <select aria-label="المصدر" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">كل المصادر</option>{sources.map((source) => <option key={source}>{source}</option>)}</select>
      {profile.role !== "teacher" && <select aria-label="المدرس" value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}><option value="">كل المدرسين النشطين</option>{teachers.map((name) => <option key={name}>{name}</option>)}</select>}
      {canFilterRenewals && <select aria-label="حالة التجديد" value={renewalFilter} onChange={(event) => setRenewalFilter(event.target.value)}><option value="">كل حالات التجديد</option><option value="0">لم يقرر</option><option value="1">هيجدد</option><option value="2">مش هيجدد</option></select>}
      {canFilterPayments && <select aria-label="حالة الدفع" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="">كل حالات الدفع</option><option value="0">غير مدفوع</option><option value="1">مدفوع بالكامل</option><option value="2">مدفوع جزئيًا</option></select>}
    </div>
    {activeFilters && <div className="card-list" style={{ marginTop: 12 }}>
      {groups.map((group) => <button className="entity-card" key={group.id} onClick={() => { onGroup(group.id, Boolean(group.p)); onClose(); }}><h3>{displayGroupLabel(group, data)}</h3><p>{group.p ? "Private" : "جروب"} · {teacherDisplayName(data, group.tc)} · {group.r ? roundName(data.r.find((round) => round.id === group.r)) : ""}</p></button>)}
      {students.map((student) => { const group = data.g.find((item) => item.id === student.g); return <button className="entity-card" key={student.id} onClick={() => { onStudent(student); onClose(); }}><h3>{displayStudentName(student, data)}</h3><p>طالب · <bdi className="phone-number" dir="ltr">{student.ph || "بدون رقم"}</bdi> · <bdi dir="ltr">{studentCodeFor(student)}</bdi> · {studentKindLabel(studentKind(student))} · {studentSourceLabel(student)}{profile.role !== "teacher" ? ` · ${studentRenewalLabel(student)}${canFilterPayments ? ` · ${studentPaymentLabel(student)}` : ""}` : ""} · {group?.p || student.enrollmentType === "private" ? "Private" : "جروب"}</p></button>; })}
      {leads.map((lead) => <button className="entity-card" key={lead.id} onClick={() => { onLead(lead); onClose(); }}><h3>{lead.n || "بدون اسم"}</h3><p>ليد · <bdi className="phone-number" dir="ltr">{lead.ph || "بدون رقم"}</bdi> · <bdi dir="ltr">{studentCodeFor(lead)}</bdi> · {studentSourceLabel(lead)}</p></button>)}
      {!groups.length && !students.length && !leads.length && <div className="empty">لا توجد نتائج مطابقة.</div>}
    </div>}
  </div></Overlay>;
}

export default function App() { return <AppShell />; }
