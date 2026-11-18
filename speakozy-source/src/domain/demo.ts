import type { AcademyData } from "./types";
import { toIsoDate, uid } from "./utils";
import { generateSessions } from "./schedule";

function offsetDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function previewData(): AcademyData {
  const roundId = "preview-round-2026";
  const groupId = "preview-group-pre2";
  const copyTargetGroupId = "preview-copy-target-group";
  const archivedTeacherGroupId = "preview-archived-teacher-group";
  const nearEndGroupId = "preview-group-ending-soon";
  const privateId = "preview-private-student";
  const emptyPrivateId = "preview-empty-private-demo";
  const twoWeeksAgo = offsetDate(-14);
  const today = toIsoDate();
  const privateSeed = { id: privateId, r: "pv", p: 1 as const, lv: "سارة تجريبية", d: "الأحد والأربعاء", s: twoWeeksAgo };
  const privateSessions = generateSessions(privateSeed);
  const privateEnd = String(privateSessions.at(-1)?.d ?? offsetDate(7));
  const scheduleSeed = { id: groupId, r: roundId, d: "السبت والثلاثاء", s: today, e: offsetDate(40) };
  const nearEndSchedule = { id: nearEndGroupId, r: roundId, d: "الاثنين والأربعاء", s: offsetDate(-24), e: today };
  const nearEndSessions = generateSessions(nearEndSchedule);
  const originalSessions = generateSessions(scheduleSeed);
  const lastOriginalDate = String(originalSessions.at(-1)?.d ?? today);
  const dayAfterLast = new Date(`${lastOriginalDate}T00:00:00`);
  dayAfterLast.setDate(dayAfterLast.getDate() + 1);
  const replacementDate = generateSessions({ ...scheduleSeed, s: toIsoDate(dayAfterLast), e: offsetDate(60) })[0]?.d ?? lastOriginalDate;
  const cancelledIndex = Math.min(2, originalSessions.length - 1);
  const groupSessions = originalSessions.map((session, index) => index === cancelledIndex ? { ...session, c: 1 as const } : { ...session });
  groupSessions.push({ k: replacementDate, d: replacementDate, c: 0 as const });
  const archivedTeacherSeed = { id: archivedTeacherGroupId, r: roundId, d: "الأحد والأربعاء", s: today, e: offsetDate(40) };
  const archivedTeacherSessions = generateSessions(archivedTeacherSeed);
  return {
    r: [{ id: roundId, n: "راوند تجريبي · أكتوبر", on: true, createdAt: Date.now() - 86400000 * 30 }],
    g: [
      { id: groupId, r: roundId, p: 0, lv: "Pre 2", d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "مدرس تجريبي", s: today, e: replacementDate, ss: groupSessions, c: [0, 0, 0, 0, 0] },
      { id: copyTargetGroupId, r: roundId, p: 0, lv: "E1", d: "الاثنين والخميس", t1: "14:00", t2: "16:00", tc: "مدرس تجريبي", ss: [] },
      { id: nearEndGroupId, r: roundId, p: 0, lv: "A2 · متابعة تجديد", d: "الاثنين والأربعاء", t1: "19:00", t2: "21:00", tc: "مدرس تجريبي", s: nearEndSchedule.s, e: today, ss: nearEndSessions, c: [0, 0, 0, 0, 0] },
      { id: archivedTeacherGroupId, r: roundId, p: 0, lv: "A2", d: "الأحد والأربعاء", t1: "14:00", t2: "16:00", tc: "مدرس مؤرشف تجريبي", s: today, e: offsetDate(40), ss: archivedTeacherSessions, c: [0, 0, 0, 0, 0] },
      { id: privateId, r: "pv", p: 1, lv: "سارة تجريبية", d: "الأحد والأربعاء", t1: "18:00", t2: "20:00", tc: "مدرس تجريبي", s: twoWeeksAgo, e: privateEnd, ss: privateSessions, c: [0, 0, 0, 0, 0] },
      { id: emptyPrivateId, r: "pv", p: 1, lv: "Private قديم بلا طالب · Demo", d: "الاثنين والخميس", tc: "مدرس تجريبي", ss: [] }
    ],
    m: [
      { id: "preview-student-1", g: groupId, r: roundId, n: "طالب تجريبي أول", ph: "01000000001", lv: "Pre 2", nw: 1, kind: "new", source: "Facebook", pay: 1, amount: 1200, lvPaid: 1, ren: 1, nt: "بيانات عرض فقط" },
      { id: "preview-student-2", g: groupId, r: roundId, n: "طالب تجريبي ثانٍ", ph: "01000000002", lv: "Pre 2", nw: 0, kind: "old", source: "ترشيح صديق", pay: 2, amount: 600, pn: "600", lvPaid: 1, ren: 2, renewalReason: "ظروف الوقت؛ بيانات تجريبية", nt: "بيانات عرض فقط" },
      { id: "preview-student-undecided", g: nearEndGroupId, r: roundId, n: "طالب تجريبي لم يقرر التجديد", ph: "01000000007", lv: "A2", nw: 0, kind: "old", source: "Facebook", pay: 0, amount: 0, lvPaid: 1, ren: 0, nt: "بيانات عرض فقط" },
      { id: "preview-archived-teacher-student", g: archivedTeacherGroupId, r: roundId, n: "طالب تجريبي لمدرس مؤرشف", ph: "01000000006", lv: "A2", nw: 1, kind: "new", source: "Google", pay: 1, amount: 900, lvPaid: 1, ren: 0 },
      { id: "preview-private-student-1", profileId: "preview-private-profile-1", g: privateId, r: "pv", n: "سارة تجريبية", ph: "01000000003", lv: "E2", nw: 0, kind: "returned", subscriptionClass: "new", source: "Instagram", subscriptionSource: "Instagram", pay: 1, amount: 1800, lvPaid: 1, ren: 1 }
    ],
    l: [
      { id: "preview-lead-today", n: "عميل تجريبي للمتابعة", ph: "01000000004", lv: "E2", st: "كلمته", bucket: "", source_sheet: "lead", source: "TikTok", followupCat: "contact", fd: today, ts: Date.now() - 86400000 },
      { id: "preview-lead-assessment", n: "عميل تجريبي لتحديد المستوى", ph: "01000000005", lv: "", st: "جديد", bucket: "new", source_sheet: "new cust", source: "Instagram", followupCat: "level", fd: offsetDate(3), ts: Date.now() },
      { id: "preview-lead-no-followup", n: "عميل تجريبي بلا موعد متابعة", ph: "01000000008", st: "مستني رد", source_sheet: "lead", source: "Facebook", followupCat: "waiting", followupReason: "بانتظار رد الأسرة بعد تحديد المستوى؛ بيانات عرض فقط", ts: Date.now() - 86400000 }
    ],
    cur: roundId,
    attendance: [{ id: `preview-attendance-${uid()}`, date: String(groupSessions[0]?.d ?? today), gid: groupId, mid: "preview-student-1", status: "present", teacher: "مدرس تجريبي", updatedAt: Date.now() }],
    teacherAbsences: [],
    finance: [{ id: "preview-expense-1", type: "expense", amount: 250, date: today, note: "مصروف تجريبي" }],
    teacherHours: [
      { name: "مدرس تجريبي", weeklyHours: 12, updatedAt: Date.now() },
      { name: "مدرس مؤرشف تجريبي", active: false, archivedAt: Date.now() - 86400000, updatedAt: Date.now() }
    ],
    scripts: [],
    lb: Date.now() - 86400000 * 2
  };
}
