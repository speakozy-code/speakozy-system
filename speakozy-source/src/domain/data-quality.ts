import type { AcademyData, AcademyGroup, Student } from "./types";
import { findLiveDuplicates } from "./customer-stage";
import { isEnrolledStudent, live, nonArchivedGroups, normalise, studentKind } from "./utils";

export interface DataQualityIssue {
  id: string;
  kind: "live-duplicate" | "duplicate-phone" | "student-details" | "missing-group" | "group-setup" | "source";
  title: string;
  detail: string;
  groupId?: string;
  studentId?: string;
}

function normalizedPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function validDate(value: unknown): boolean {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00`);
  const [year, month, day] = text.split("-").map(Number);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function enrolledStudents(data: AcademyData, groups: AcademyGroup[]): Student[] {
  const groupIds = new Set(groups.map((group) => group.id));
  return live(data.m).filter((student) => isEnrolledStudent(student) && groupIds.has(student.g));
}

export function dataQualityIssues(data: AcademyData): DataQualityIssue[] {
  const groups = nonArchivedGroups(data);
  const groupIds = new Set(groups.map((group) => group.id));
  const students = enrolledStudents(data, groups);
  const issues: DataQualityIssue[] = [];

  const phoneRows = new Map<string, Student[]>();
  students.forEach((student) => {
    const phone = normalizedPhone(student.ph);
    if (phone.length < 7) return;
    const rows = phoneRows.get(phone) ?? [];
    rows.push(student);
    phoneRows.set(phone, rows);
  });
  phoneRows.forEach((rows, phone) => {
    const profiles = new Set(rows.map((student) => String(student.profileId || student.id)));
    if (profiles.size < 2) return;
    const names = [...new Set(rows.map((student) => student.n?.trim()).filter(Boolean))];
    issues.push({ id: `phone:${phone}`, kind: "duplicate-phone", title: "رقم هاتف مكرر", detail: `\u2066${rows[0].ph}\u2069 · ${names.join("، ") || `${profiles.size} سجلات طلاب`}` });
  });

  students.forEach((student) => {
    const missing = [!student.n?.trim() ? "الاسم" : "", !student.ph?.trim() ? "رقم الهاتف" : ""].filter(Boolean);
    if (missing.length) issues.push({ id: `student:${student.id}`, kind: "student-details", title: `بيانات ناقصة: ${student.n?.trim() || "طالب بدون اسم"}`, detail: `أكمل ${missing.join(" و")}.`, studentId: student.id, groupId: student.g });
    const subscriptionIsNew = (student.subscriptionClass || (studentKind(student) === "new" ? "new" : "renewal")) === "new";
    if (subscriptionIsNew && !String(student.source || student.subscriptionSource || "").trim()) {
      issues.push({ id: `source:${student.id}`, kind: "source", title: `مصدر تسجيل غير محدد: ${student.n?.trim() || "طالب بدون اسم"}`, detail: "تحديد المصدر يحسن تقارير التسويق ومقارنة القنوات.", studentId: student.id, groupId: student.g });
    }
  });

  live(data.m).filter(isEnrolledStudent).forEach((student) => {
    if (!student.g || groupIds.has(student.g)) return;
    if (data.g.some((group) => group.id === student.g)) return;
    issues.push({ id: `missing-group:${student.id}`, kind: "missing-group", title: `طالب غير مرتبط بجروب: ${student.n?.trim() || "بدون اسم"}`, detail: "سجل الطالب يشير إلى جروب غير موجود؛ لن يدخل في الإحصائيات الحالية.", studentId: student.id });
  });

  groups.forEach((group) => {
    const missing: string[] = [];
    if (!group.tc?.trim()) missing.push("المدرس");
    if (!group.d?.trim()) missing.push("الأيام");
    if (!group.t1 || !group.t2) missing.push("وقت الجلسة");
    if (!validDate(group.s)) missing.push("تاريخ البداية");
    if (missing.length) issues.push({ id: `group:${group.id}`, kind: "group-setup", title: `${group.p ? "Private" : "جروب"} غير مكتمل: ${group.lv?.trim() || "بدون اسم"}`, detail: `أكمل ${missing.join("، ")}.`, groupId: group.id });
  });

  const duplicateLabels = {
    "active-and-lead": "مسجل في راوند شغال وله ليد حي كمان",
    "active-and-former-copy": "مسجل في راوند شغال وله نسخة في عملاء الراوند الجاي",
    "active-twice": "مسجل في أكتر من جروب/Private شغالين"
  } as const;
  findLiveDuplicates(data).forEach((item) => {
    issues.push({ id: `live:${item.kind}:${item.ids.join(",")}`, kind: "live-duplicate", title: `تكرار حي: ${item.person}`, detail: `${duplicateLabels[item.kind]}${item.phone ? ` · ${item.phone}` : ""}. للمراجعة فقط، لا يُحذف شيء تلقائيًا.` });
  });

  return issues.sort((a, b) => a.kind.localeCompare(b.kind) || normalise(a.title).localeCompare(normalise(b.title), "ar"));
}
