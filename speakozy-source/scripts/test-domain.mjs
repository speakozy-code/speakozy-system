import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "speakozy-domain-tests-"));
const modules = [
  ["src/domain/utils.ts", "domain/utils.js"],
  ["src/domain/lifecycle.ts", "domain/lifecycle.js"],
  ["src/domain/schedule.ts", "domain/schedule.js"],
  ["src/domain/demo.ts", "domain/demo.js"],
  ["src/domain/retention.ts", "domain/retention.js"],
  ["src/domain/automatic-former-copies.ts", "domain/automatic-former-copies.js"],
  ["src/domain/data-quality.ts", "domain/data-quality.js"],
  ["src/domain/permissions.ts", "domain/permissions.js"],
  ["src/domain/followup.ts", "domain/followup.js"],
  ["src/services/attendance-sync.ts", "services/attendance-sync.js"]
];

try {
  for (const [sourceName, outputName] of modules) {
    const source = readFileSync(join(projectRoot, sourceName), "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: sourceName,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, strict: true }
    });
    const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${sourceName}: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
    const outputPath = join(tempRoot, outputName);
    const directory = dirname(outputPath);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
    writeFileSync(outputPath, compiled.outputText);
  }

  const require = createRequire(import.meta.url);
  const { toIsoDate, privateGroupCanAccept, canAddStudentToGroup, copyStudentForGroup, attendanceKey, attendanceFor, activeAttendanceRecords, activeGroups, archiveTeacher, canAssignTeacher, currentStudentCounts, deleteTeacher, ensureStudentCodes, expenseForMonth, formerStudents, incomeForMonth, incomeStudentsByKindForMonth, incomeStudentsForMonth, isEnrolledStudent, isStudentCodeQuery, isTeacherArchived, isTeacherDeleted, isTeacherNameArchived, LEVELS, LEVEL_COUNTS, matchesStudentCode, normalizeStudentCode, nonArchivedGroups, removeStudentAttendance, restoreTeacher, saveTeacherWeeklyHours, studentKind, studentKindLabel, studentSourceLabel, studentsInNonArchivedGroups, studentsInRound, teacherNames, totalCurrentStudents, uniquePhoneNumbers } = require(join(tempRoot, "domain/utils.js"));
  const { retentionByMonth } = require(join(tempRoot, "domain/retention.js"));
  const { addAutomaticFormerCustomerCopies } = require(join(tempRoot, "domain/automatic-former-copies.js"));
  const { previewData } = require(join(tempRoot, "domain/demo.js"));
  const { canAccessFinance, canAccessMarketingAnalytics, isMarketingRole } = require(join(tempRoot, "domain/permissions.js"));
  const { allTeacherScheduleConflicts, cancelSession, durationHours, ensureEightActiveSessions, feedbackSessionsDue, generateSessions, monthTeacherHours, plannedGroupEndDate, rescheduleGroupPreservingAttendance, rescheduleSession, restoreSession, scheduledSessionsOnDate, teacherScheduleConflicts, teacherSessionsForMonth, weeklyScheduledHours } = require(join(tempRoot, "domain/schedule.js"));
  const { dataQualityIssues } = require(join(tempRoot, "domain/data-quality.js"));
  const { AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS, AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS, isAutomaticFollowupDue } = require(join(tempRoot, "domain/followup.js"));
  const followupStart = 1_800_000_000_000;
  assert.equal(AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS, 14 * 24 * 60 * 60 * 1000, "student automatic follow-up interval is two weeks");
  assert.equal(AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000, "lead automatic follow-up remains weekly");
  assert.equal(isAutomaticFollowupDue(followupStart, "", followupStart + 13 * 24 * 60 * 60 * 1000, "2026-12-01", AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS), false, "student follow-up does not repeat before fourteen days");
  assert.equal(isAutomaticFollowupDue(followupStart, "", followupStart + AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS, "2026-12-01", AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS), true, "student follow-up becomes due after fourteen days");
  assert.equal(isAutomaticFollowupDue(followupStart, "", followupStart + AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS, "2026-12-01", AUTOMATIC_LEAD_FOLLOWUP_INTERVAL_MS), true, "lead follow-up stays due after seven days");
  assert.equal(isAutomaticFollowupDue(followupStart, "2026-12-02", followupStart + AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS, "2026-12-01", AUTOMATIC_STUDENT_FOLLOWUP_INTERVAL_MS), false, "a future explicit follow-up date overrides the automatic interval");
  const legacyTimedGroup = { id: "legacy-time", r: "legacy-round", t: "10:30 PM - 12:00 AM", ss: [{ k: "2026-11-11", d: "2026-11-11" }] };
  assert.equal(durationHours(legacyTimedGroup), 1.5, "a legacy combined time range is counted even when t1/t2 are absent");
  assert.equal(monthTeacherHours([legacyTimedGroup], "2026-11").hours, 1.5, "monthly teacher hours use the duration displayed from a legacy combined time range");
  assert.equal(durationHours({ id: "legacy-24h-time", r: "legacy-round", t: "22:30 - 00:00" }), 1.5, "legacy 24-hour ranges crossing midnight count correctly");
  const { attendanceDocumentId, removedAttendanceKeys } = require(join(tempRoot, "services/attendance-sync.js"));

  const moveDays = (iso, amount) => {
    const date = new Date(`${iso}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return toIsoDate(date);
  };
  const firstOccurrence = (start, weekdays) => {
    for (let offset = 0; offset < 14; offset += 1) {
      const candidate = moveDays(start, offset);
      if (weekdays.includes(new Date(`${candidate}T00:00:00`).getDay())) return candidate;
    }
    throw new Error("No weekday occurrence found");
  };
  const occurrences = (start, weekdays, count) => {
    const result = [firstOccurrence(start, weekdays)];
    while (result.length < count) {
      const next = firstOccurrence(moveDays(result.at(-1), 1), weekdays);
      result.push(next);
    }
    return result;
  };
  const monthKeys = (start, end) => {
    const values = [];
    const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00`);
    const last = new Date(`${end.slice(0, 7)}-01T00:00:00`);
    while (cursor <= last) {
      values.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return values;
  };
  const sumMonthHours = (group) => monthKeys(group.s, group.e).map((month) => monthTeacherHours([group], month)).reduce((total, row) => ({ sessions: total.sessions + row.sessions, hours: total.hours + row.hours }), { sessions: 0, hours: 0 });
  const session = (date, cancelled = false) => ({ k: date, d: date, ...(cancelled ? { c: 1 } : {}) });

  const qualityData = {
    r: [{ id: "round-q", on: true }],
    g: [
      { id: "quality-a", r: "round-q", d: "الأحد", tc: "Teacher A", t1: "10:00", t2: "11:00", s: "2026-11-01" },
      { id: "quality-b", r: "round-q", d: "الأحد", tc: "Teacher B", t1: "12:00", t2: "13:00", s: "2026-11-01" },
      { id: "quality-incomplete", r: "round-q", d: "", tc: "", t1: "", t2: "", s: "invalid" }
    ],
    m: [
      { id: "quality-student-a", profileId: "profile-a", g: "quality-a", n: "طالب أول", ph: "01012345678", subscriptionClass: "new", source: "" },
      { id: "quality-student-a-next-round", profileId: "profile-a", g: "quality-b", n: "طالب أول", ph: "+20 10 12345678", subscriptionClass: "renewal", source: "Instagram" },
      { id: "quality-student-b", profileId: "profile-b", g: "quality-b", n: "طالب آخر", ph: "+20 10 12345678", subscriptionClass: "renewal", source: "Instagram" },
      { id: "quality-orphan", g: "missing-group", n: "بدون جروب", ph: "01011111111" }
    ],
    attendance: [],
    finance: [],
    teacherHours: [],
    teacherAbsences: [],
    scripts: [],
    l: [],
    cur: "round-q"
  };
  const qualityIssues = dataQualityIssues(qualityData);
  assert.equal(qualityIssues.filter((issue) => issue.kind === "duplicate-phone").length, 1, "possible duplicate phones are detected while repeat cards for the same profile remain linked");
  assert.ok(qualityIssues.some((issue) => issue.kind === "source" && issue.studentId === "quality-student-a"), "a new subscription missing its source is flagged for marketing attribution");
  assert.ok(qualityIssues.some((issue) => issue.kind === "missing-group" && issue.studentId === "quality-orphan"), "an enrolled student pointing to a missing group is flagged");
  assert.ok(qualityIssues.some((issue) => issue.kind === "group-setup" && issue.groupId === "quality-incomplete"), "groups missing their teacher, schedule, or valid start date are flagged");

  assert.deepEqual(uniquePhoneNumbers([" 010 123-456 ", "010123 456", "", undefined, null, "+20 (10) 123-456"]), ["010 123-456", "+20 (10) 123-456"], "bulk copy keeps one formatted phone per number and ignores empty/non-phone entries");

  // Saturday/Tuesday: eight active lessons plus one fixed cancellation record.
  assert.equal(canAddStudentToGroup({ id: "cap-5", r: "round-1", capacity: 5 }, 4), true, "a group with one available seat accepts a student");
  assert.equal(canAddStudentToGroup({ id: "cap-5", r: "round-1", capacity: 5 }, 5), false, "a full group rejects an additional student");
  assert.equal(canAddStudentToGroup({ id: "uncapped", r: "round-1" }, 500), true, "a group without a capacity remains unrestricted");

  const today = toIsoDate();
  assert.equal(normalizeStudentCode(" spk-٤٤ "), "SPK44", "customer-code normalization accepts Arabic digits, spaces and separators");
  assert.equal(matchesStudentCode("SPK-44", "spk ٤٤"), true, "customer code lookup ignores formatting differences");
  assert.equal(matchesStudentCode("SPK-44", "44"), true, "customer code lookup accepts an exact numeric suffix");
  assert.equal(matchesStudentCode("SPK-144", "44"), false, "numeric customer-code lookup does not match a partial suffix");
  assert.equal(isStudentCodeQuery("SPK - ٤٤"), true, "formatted SPK code input is recognized as a code, not a phone fragment");
  const codeSequenceData = { m: [{ id: "old-code-230", profileId: "old-code-230", studentCode: "SPK-230", x: 1 }, { id: "new-code-record" }], l: [] };
  ensureStudentCodes(codeSequenceData);
  assert.equal(codeSequenceData.m[1].studentCode, "SPK-231", "a new customer receives the next code after the highest archived code");
  const satTueDates = occurrences(today, [6, 2], 9);
  const satTueDays = [satTueDates[0], satTueDates[1], satTueDates[2], satTueDates[3], satTueDates[4], satTueDates[5], satTueDates[6], satTueDates[7], satTueDates[8]];
  const satTueSessions = satTueDays.map((date, index) => session(date, index === 2));
  const satTueGroup = { id: "sat-tue", r: "round-1", d: "السبت والثلاثاء", s: satTueDates[0], e: satTueDates[8], t1: "16:00", t2: "18:00", ss: satTueSessions };
  const conflictA = { id: "conflict-a", r: "round-1", d: "السبت والثلاثاء", tc: "Teacher A", t1: "16:00", t2: "18:00", s: satTueDates[0], e: satTueDates[8], ss: satTueDates.slice(0, 8).map((date) => session(date)) };
  const conflictB = { ...conflictA, id: "conflict-b", tc: "teacher a", t1: "17:00", t2: "19:00" };
  assert.equal(teacherScheduleConflicts([conflictA], conflictB).length, 1, "overlapping teacher sessions on a shared scheduled date are detected case-insensitively");
  assert.equal(allTeacherScheduleConflicts([conflictA, conflictB]).length, 1, "the dashboard conflict list reports each overlapping group pair once");
  assert.equal(teacherScheduleConflicts([conflictA], { ...conflictB, t1: "18:00", t2: "19:00" }).length, 0, "back-to-back teacher sessions are allowed");
  assert.equal(teacherScheduleConflicts([conflictA], { ...conflictB, tc: "Teacher B" }).length, 0, "sessions assigned to different teachers are not conflicts");
  const originalActive = satTueSessions.filter((item) => !item.c).length;
  assert.equal(originalActive, 8);
  const selectedDate = satTueDates[4];
  const selectedIndex = satTueGroup.ss.findIndex((item) => item.d === selectedDate);
  const targetDate = satTueDates[6];
  const moved = rescheduleSession(satTueGroup, selectedIndex, targetDate, new Set([satTueDates[0]]));
  assert.ok(moved, "Saturday/Tuesday postponement should be accepted");
  const movedDates = moved.ss.map((item) => String(item.d ?? item.k).slice(0, 10));
  assert.deepEqual(movedDates, [...movedDates].sort(), "session list stays date-sorted after cascade");
  assert.equal(moved.ss.filter((item) => !item.c).length, 8, "postponement preserves all eight active sessions");
  assert.equal(moved.ss.filter((item) => item.c).length, 1, "cancellation row stays visible");
  assert.equal(moved.ss.find((item) => item.c).d, satTueDates[2], "cancelled date is not moved");
  assert.ok(moved.e > satTueGroup.e, "group end extends through the shifted final session");
  for (const item of moved.ss.filter((row) => !row.c)) {
    const weekday = new Date(`${item.d}T00:00:00`).getDay();
    assert.ok([6, 2].includes(weekday), `shifted date ${item.d} follows Saturday/Tuesday`);
  }
  const markedFollowingDate = satTueDates[5];
  assert.equal(rescheduleSession(satTueGroup, selectedIndex, targetDate, new Set([markedFollowingDate])), null, "cascade is blocked if a later affected session has attendance");
  const movedHours = sumMonthHours(moved);
  assert.equal(movedHours.sessions, 8, "cancelled session is excluded from monthly teacher hours");
  assert.equal(movedHours.hours, 16, "eight two-hour active sessions equal sixteen teacher hours");

  const cancelledIndex = moved.ss.findIndex((item) => Boolean(item.c));
  const latestActiveDate = moved.ss.filter((item) => !item.c).map((item) => item.d).sort().at(-1);
  const protectedRestore = restoreSession(moved, cancelledIndex, new Set([latestActiveDate]));
  assert.strictEqual(protectedRestore, moved, "restore is refused instead of leaving nine active sessions when the removable replacement is marked");
  const restored = restoreSession(moved, cancelledIndex, new Set());
  assert.equal(restored.ss.filter((item) => !item.c).length, 8, "restoring a cancellation removes the last replacement and returns to eight active sessions");
  assert.equal(restored.ss.filter((item) => item.c).length, 0);
  assert.equal(restored.e, restored.ss.map((item) => item.d).sort().at(-1), "restore brings the tracked group end back to the last remaining session");
  const restoredHours = sumMonthHours(restored);
  assert.equal(restoredHours.sessions, 8);
  assert.equal(restoredHours.hours, 16);

  // Cancelling any active lesson retains the cancelled column, renumbers the remaining lessons, and appends one matching weekday to keep eight active lessons.
  const eightDates = occurrences(today, [6, 2], 8);
  const eightLessonGroup = { id: "cancel-8", r: "round-1", d: "السبت والثلاثاء", s: eightDates[0], e: eightDates[7], t1: "16:00", t2: "18:00", ss: eightDates.map((date) => session(date)) };
  const cancelledSixth = cancelSession(eightLessonGroup, 5);
  const activeAfterCancel = cancelledSixth.ss.filter((item) => !item.c);
  const canceledAfterCancel = cancelledSixth.ss.filter((item) => item.c);
  assert.equal(activeAfterCancel.length, 8, "cancelling the sixth lesson still leaves eight active lessons");
  assert.equal(canceledAfterCancel.length, 1, "cancelled lesson remains visible as a separate record");
  assert.equal(activeAfterCancel[5].d, eightDates[6], "the original seventh lesson becomes the sixth active lesson");
  assert.equal(activeAfterCancel[6].d, eightDates[7], "the original eighth lesson becomes the seventh active lesson");
  assert.ok(activeAfterCancel[7].d > eightDates[7], "an eighth active lesson is appended after the previous end");
  assert.ok(cancelledSixth.e >= activeAfterCancel[7].d, "group end date extends through the replacement lesson");
  assert.equal(plannedGroupEndDate(cancelledSixth), activeAfterCancel[7].d, "group card end date matches the final session used by attendance and teacher hours");
  assert.ok(activeAfterCancel.every((item) => [6, 2].includes(new Date(`${item.d}T00:00:00`).getDay())), "replacement stays on Saturday/Tuesday");

  const legacySeven = { ...eightLessonGroup, id: "legacy-seven", ss: eightDates.map((date, index) => session(date, index === 5)) };
  const completedLegacy = ensureEightActiveSessions(legacySeven);
  assert.equal(legacySeven.ss.filter((item) => !item.c).length, 7, "legacy data is not mutated just by calculating its proposal");
  assert.equal(completedLegacy.ss.filter((item) => !item.c).length, 8, "legacy schedule proposal fills the missing active lesson");
  assert.equal(completedLegacy.ss.filter((item) => item.c).length, 1, "legacy cancelled date stays visible during completion");
  assert.ok(completedLegacy.ss.filter((item) => !item.c).at(-1).d > eightDates[7], "legacy completion proposes a new last date beyond the old end");
  assert.ok(completedLegacy.e >= completedLegacy.ss.filter((item) => !item.c).at(-1).d, "legacy completion extends group end through the proposed session");

  const cancelPrivate = cancelSession({ ...eightLessonGroup, id: "private-cancel", r: "pv", p: 1 }, 0);
  assert.equal(cancelPrivate.ss.filter((item) => !item.c).length, 8, "Private cancellation also preserves eight active lessons");
  assert.equal(cancelPrivate.ss.filter((item) => item.c).length, 1, "Private cancelled lesson remains visible");

  const feedbackDates = occurrences("2026-10-31", [6, 2], 8);
  const feedbackGroup = { id: "feedback-group", r: "round-1", d: "السبت والثلاثاء", s: feedbackDates[0], e: feedbackDates[7], ss: feedbackDates.map((date) => session(date)) };
  const feedbackDue = feedbackSessionsDue([feedbackGroup], feedbackDates[6]);
  assert.deepEqual(feedbackDue.map((item) => item.milestone), [1, 4, 7], "feedback reminders appear after sessions 1, 4, and 7");
  const acknowledgedFeedback = { ...feedbackGroup, feedbackSentAt: { 1: 100, 4: 100 } };
  assert.deepEqual(feedbackSessionsDue([acknowledgedFeedback], feedbackDates[6]).map((item) => item.milestone), [7], "sent feedback stages do not repeat");
  const cancelledFeedback = { ...feedbackGroup, ss: feedbackGroup.ss.map((item, index) => index === 1 ? { ...item, c: 1 } : item) };
  const afterFourActiveSessions = feedbackSessionsDue([cancelledFeedback], feedbackDates[4]);
  assert.deepEqual(afterFourActiveSessions.map((item) => item.milestone), [1, 4], "cancelled sessions do not count toward a feedback milestone");
  assert.equal(afterFourActiveSessions[1].sessionDate, feedbackDates[4], "the fourth active session sets the feedback due date");
  const privateFeedbackGroup = { ...feedbackGroup, id: "feedback-private", r: "pv", p: 1 };
  assert.deepEqual(feedbackSessionsDue([privateFeedbackGroup], feedbackDates[3]).map((item) => item.milestone), [1, 4], "Private groups receive the same feedback reminders");

  // Sunday/Wednesday: arbitrary chosen dates snap forward to the next allowed weekday.
  const sunWedDates = occurrences(today, [0, 3], 8);
  const sunWedGroup = { id: "sun-wed", r: "round-2", d: "الأحد والأربعاء", s: sunWedDates[0], e: sunWedDates[7], t1: "18:00", t2: "20:00", ss: sunWedDates.map((date) => session(date)) };
  const arbitraryDate = moveDays(sunWedDates[1], 1);
  const sunWedResult = rescheduleSession(sunWedGroup, 1, arbitraryDate, new Set());
  assert.ok(sunWedResult);
  assert.equal(sunWedResult.ss.filter((item) => !item.c).length, 8);
  assert.ok(sunWedResult.ss.every((item) => [0, 3].includes(new Date(`${item.d}T00:00:00`).getDay())), "all Sunday/Wednesday sessions remain on the configured weekdays");
  assert.deepEqual(sunWedResult.ss.map((item) => item.d), [...sunWedResult.ss.map((item) => item.d)].sort());

  const historyDates = occurrences("2026-10-31", [6, 2], 8);
  const historyGroup = { id: "history-reschedule", r: "round-1", d: "السبت والثلاثاء", s: historyDates[0], e: historyDates[7], t1: "16:00", t2: "18:00", ss: historyDates.map((date, index) => session(date, index === 2)) };
  const historyRecords = [
    { date: historyDates[0], gid: historyGroup.id, mid: "history-student-1", status: "present", updatedAt: 1 },
    { date: historyDates[1], gid: historyGroup.id, mid: "history-student-2", status: "absent", updatedAt: 2 },
    { date: historyDates[2], gid: historyGroup.id, mid: "history-student-4", status: "present", updatedAt: 5 },
    { date: "2026-10-29", gid: historyGroup.id, mid: "history-student-1", status: "present", updatedAt: 3 },
    { date: historyDates[0], gid: historyGroup.id, mid: "history-student-3", status: "", updatedAt: 4 }
  ];
  const changedHistoryGroup = rescheduleGroupPreservingAttendance(historyGroup, { ...historyGroup, d: "الأحد والأربعاء", s: "2026-11-01", e: "2026-11-30" }, historyRecords);
  const changedHistoryDates = changedHistoryGroup.ss.map((item) => String(item.k ?? item.d).slice(0, 10));
  const changedActive = changedHistoryGroup.ss.filter((item) => !item.c);
  assert.equal(changedActive.length, 8, "changing the group schedule keeps at least eight active sessions");
  assert.ok(changedHistoryDates.includes(historyDates[0]) && changedHistoryDates.includes(historyDates[1]), "marked attendance sessions remain at their original dates");
  assert.ok(changedHistoryDates.includes("2026-10-29"), "an existing attendance record with no matching session remains visible as a dated session");
  assert.equal(attendanceFor({ attendance: historyRecords }, historyDates[0], historyGroup.id, "history-student-1")?.status, "present", "a present mark is not moved or overwritten by schedule regeneration");
  assert.equal(attendanceFor({ attendance: historyRecords }, historyDates[1], historyGroup.id, "history-student-2")?.status, "absent", "an absent mark is not moved or overwritten by schedule regeneration");
  assert.equal(attendanceFor({ attendance: historyRecords }, historyDates[2], historyGroup.id, "history-student-4")?.status, "present", "a mark recorded on a cancelled date remains in attendance history");
  assert.equal(changedHistoryGroup.ss.filter((item) => item.c).length, 1, "old cancellation history remains visible after the schedule edit");
  assert.equal(changedHistoryGroup.ss.find((item) => item.c)?.d, historyDates[2], "the old cancelled date is preserved");
  assert.equal(changedActive.some((item) => String(item.k ?? item.d).slice(0, 10) === historyDates[2]), false, "a cancelled date with a mark is not silently revived as an active session");
  assert.equal(changedHistoryDates.includes(historyDates[3]), false, "an unmarked old date is replaced instead of being mistaken for attendance history");
  assert.ok(changedActive.filter((item) => ![...historyDates.slice(0, 2), "2026-10-29"].includes(String(item.k ?? item.d).slice(0, 10))).every((item) => [0, 3].includes(new Date(`${item.d}T00:00:00`).getDay())), "new unmarked sessions follow the newly selected days");
  const longSelectedEnd = rescheduleGroupPreservingAttendance(historyGroup, { ...historyGroup, d: "الأحد والأربعاء", s: "2026-11-01", e: "2026-12-15" }, historyRecords);
  assert.equal(longSelectedEnd.e, "2026-12-15", "an end date later than session eight remains the user's selected date");
  const shortSelectedEnd = rescheduleGroupPreservingAttendance(historyGroup, { ...historyGroup, d: "الأحد والأربعاء", s: "2026-11-01", e: "2026-11-05" }, historyRecords);
  assert.equal(shortSelectedEnd.e, shortSelectedEnd.ss.filter((item) => !item.c).at(-1).d, "the end date extends only when needed to fit eight active sessions");

  const octoberToNovemberDates = occurrences("2026-10-15", [4, 0], 8);
  const octoberToNovemberGroup = { id: "october-to-november", r: "round-october", p: 0, d: "الخميس والأحد", s: octoberToNovemberDates[0], e: octoberToNovemberDates.at(-1), t1: "18:00", t2: "20:00", ss: octoberToNovemberDates.map((date) => session(date)) };
  const novemberSessions = teacherSessionsForMonth([octoberToNovemberGroup], "2026-11");
  const novemberHours = monthTeacherHours([octoberToNovemberGroup], "2026-11");
  assert.equal(novemberSessions.length, 3, "an October group is included in November when its sessions continue into that month");
  assert.equal(novemberHours.sessions, 3, "November counts only the sessions dated in November for an October-started group");
  assert.equal(novemberHours.hours, 6, "November teacher hours include each two-hour session from a carried-over group");
  const longPrivate = { id: "private-long", r: "pv", p: 1, d: "السبت والثلاثاء", s: "2026-10-01", e: "2026-11-30", t1: "16:00", t2: "18:00", ss: null };
  const archivedPrivateSchedule = { ...longPrivate, id: "private-archived", x: 1 };
  assert.equal(monthTeacherHours([archivedPrivateSchedule], "2026-10").sessions, 0, "archived Private group has no monthly teacher hours");
  assert.equal(weeklyScheduledHours([archivedPrivateSchedule]), 0, "archived Private group has no weekly scheduled hours");
  assert.equal(teacherSessionsForMonth([archivedPrivateSchedule], "2026-10").length, 0, "archived Private group has no teacher month rows");
  assert.equal(scheduledSessionsOnDate(archivedPrivateSchedule, "2026-10-03").length, 0, "archived Private group has no daily schedule rows");
  const longPrivateHours = monthTeacherHours([longPrivate], "2026-10");
  assert.equal(longPrivateHours.sessions, 8, "a long group end date does not create a ninth recurring session");
  assert.equal(longPrivateHours.hours, 16, "monthly teacher hours match the eight generated Private sessions");
  assert.equal(monthTeacherHours([longPrivate], "2026-11").sessions, 0, "weeks after the eighth session are not counted from a long end date");
  assert.equal(teacherSessionsForMonth([longPrivate], "2026-10").length, 8, "the teacher month table and hours use the same eight-session schedule");
  assert.equal(scheduledSessionsOnDate(longPrivate, "2026-11-03").length, 0, "daily reports do not show a ninth weekly recurrence beyond the eight-session schedule");

  const incompletePrivate = { ...longPrivate, id: "private-incomplete", e: "2026-10-27", ss: occurrences("2026-10-01", [6, 2], 8).map((date, index) => session(date, index === 5)) };
  const proposedMonthRows = teacherSessionsForMonth([incompletePrivate], "2026-10");
  assert.equal(proposedMonthRows.filter((row) => !row.session.c).length, 8, "teacher month planning fills an old incomplete Private schedule to eight active sessions");
  assert.equal(proposedMonthRows.filter((row) => row.suggested).length, 1, "the extra date is clearly flagged as a proposal until saved");
  assert.equal(monthTeacherHours([incompletePrivate], "2026-10").sessions, 8, "teacher hours include the same proposed eighth session");
  assert.equal(scheduledSessionsOnDate(incompletePrivate, proposedMonthRows.find((row) => row.suggested).session.d).length, 1, "daily schedule includes the proposed replacement date");
  assert.equal(plannedGroupEndDate(incompletePrivate), proposedMonthRows.filter((row) => !row.session.c).at(-1).session.d, "the collapsed group card shows the same projected end date as attendance and teacher hours");
  assert.equal(incompletePrivate.e, "2026-10-27", "planning the old schedule does not mutate Firestore data on view");

  // Group names are academic levels; paid level counts live only on the student payment record.
  assert.equal(LEVELS[0], "E1", "the group level list starts at E1");
  assert.equal(LEVELS.at(-1), "Advanced 3", "the group level list ends at Advanced 3");
  assert.equal(LEVELS.includes("1"), false, "a numeric paid-level count is not a group level");
  assert.deepEqual(LEVEL_COUNTS, ["1", "2", "3", "4", "6"], "the permitted paid-level counts remain explicit");
  const paidLevelStudent = { id: "paid-level-student", g: "level-group", lv: "E2", lvPaid: 6 };
  assert.equal(paidLevelStudent.lv, "E2", "the student's academic level remains independent");
  assert.equal(paidLevelStudent.lvPaid, 6, "the student's payment record retains its paid-level count");

  // A teacher directory joins manual rows, Firebase accounts, and active assignments, while hidden rows stay unavailable for new assignments.
  const teacherDirectoryData = {
    r: [{ id: "teacher-round", on: true }],
    g: [{ id: "assigned-group", r: "teacher-round", tc: "Assigned Teacher" }, { id: "archived-assignment", r: "teacher-round", tc: "Archived Group Teacher", x: 1 }],
    teacherHours: [{ name: "Manual Teacher", active: true }, { name: "Stopped Teacher", active: false }, { name: "Archived Teacher", active: true, archivedAt: 100 }]
  };
  const directory = teacherNames(teacherDirectoryData, [
    { uid: "account-active", name: "Account Teacher", email: "account@example.test" },
    { uid: "account-stopped", name: "Stopped Teacher", email: "stopped@example.test" }
  ]);
  assert.deepEqual([...directory].sort(), ["Account Teacher", "Assigned Teacher", "Manual Teacher"], "teacher directory merges active sources and hides soft-disabled names");
  assert.equal(directory.includes("Stopped Teacher"), false, "a soft-disabled teacher cannot be newly assigned");
  assert.equal(directory.includes("Archived Teacher"), false, "an archived teacher cannot be newly assigned");
  assert.equal(directory.includes("Archived Group Teacher"), false, "an archived group alone does not recreate a teacher directory entry");
  assert.equal(canAssignTeacher(teacherDirectoryData, "Stopped Teacher"), false, "renewals and new assignments reject a soft-disabled teacher");
  assert.equal(canAssignTeacher(teacherDirectoryData, "Archived Teacher"), false, "renewals and new assignments reject an archived teacher");
  assert.equal(canAssignTeacher(teacherDirectoryData, "Assigned Teacher"), true, "a current active assignment remains eligible for new assignment flows");
  const inactiveTeacherHours = { ...teacherDirectoryData, teacherHours: [{ name: "Stopped Teacher", active: false, weeklyHours: 4 }] };
  saveTeacherWeeklyHours(inactiveTeacherHours, "Stopped Teacher", 12);
  assert.equal(inactiveTeacherHours.teacherHours[0].weeklyHours, 12, "weekly hours can be updated for historical reporting");
  assert.equal(inactiveTeacherHours.teacherHours[0].active, false, "saving weekly hours never reactivates a soft-disabled teacher");

  const archivedTeacherData = {
    r: [{ id: "archive-round", on: true }],
    g: [{ id: "archive-group", r: "archive-round", tc: "Archive Teacher" }],
    teacherHours: [{ name: "Archive Teacher", active: true, weeklyHours: 8 }]
  };
  archiveTeacher(archivedTeacherData, "Archive Teacher", 1234);
  assert.equal(isTeacherArchived(archivedTeacherData.teacherHours[0]), true, "the teacher can be archived without changing the active-account field");
  assert.equal(archivedTeacherData.teacherHours[0].archivedAt, 1234, "archive time is stored for restoration and auditability");
  assert.equal(archivedTeacherData.teacherHours[0].weeklyHours, 8, "archiving preserves historical weekly hours");
  assert.equal(archivedTeacherData.g[0].tc, "Archive Teacher", "archiving preserves existing group assignment");
  assert.equal(canAssignTeacher(archivedTeacherData, "Archive Teacher"), false, "an archived teacher is excluded from new assignments");
  saveTeacherWeeklyHours(archivedTeacherData, "Archive Teacher", 12);
  assert.equal(archivedTeacherData.teacherHours[0].archivedAt, 1234, "saving weekly hours does not clear archive status");
  assert.equal(canAssignTeacher(archivedTeacherData, "Archive Teacher"), false, "saving hours does not silently restore the teacher");
  restoreTeacher(archivedTeacherData, "Archive Teacher", 5678);
  assert.equal(isTeacherArchived(archivedTeacherData.teacherHours[0]), false, "the teacher can be restored explicitly");
  assert.equal(archivedTeacherData.teacherHours[0].active, true, "restoring the teacher makes the assignment option active");
  assert.equal(archivedTeacherData.teacherHours[0].weeklyHours, 12, "restoration preserves the updated weekly hours");
  assert.equal(canAssignTeacher(archivedTeacherData, "Archive Teacher"), true, "the restored teacher is available to new assignments");
  deleteTeacher(archivedTeacherData, "Archive Teacher", 6789);
  assert.equal(isTeacherDeleted(archivedTeacherData.teacherHours[0]), true, "teacher removal is recorded as a permanent tombstone");
  assert.equal(teacherNames(archivedTeacherData).includes("Archive Teacher"), false, "a removed teacher cannot return through historical group assignments");
  assert.equal(archivedTeacherData.g[0].tc, "Archive Teacher", "removing a teacher preserves historical group assignments");
  restoreTeacher(archivedTeacherData, "Archive Teacher", 7890);
  assert.equal(isTeacherDeleted(archivedTeacherData.teacherHours[0]), true, "ordinary restore cannot undo permanent teacher removal");

  // Private capacity, role access and central attendance deletion diff.
  const privateData = { m: [{ id: "student-a", g: "private-a" }, { id: "archived", g: "private-a", x: 1 }] };
  assert.equal(privateGroupCanAccept(privateData, "private-a"), false, "occupied Private cannot accept another student");
  assert.equal(privateGroupCanAccept(privateData, "private-a", "student-a"), true, "same student does not count as a second occupant");
  assert.equal(privateGroupCanAccept(privateData, "private-empty"), true);
  const sourceStudent = { id: "source-student", g: "old-group", r: "old-round", n: "نسخة تجريبية", ph: "01000000000", lv: "E2", kind: "returned", source: "Facebook", sourceOther: "", pay: 2, amount: 600, pn: "200", lvPaid: 3, ren: 2, renewalReason: "سبب قديم", nt: "ملاحظة مهمة", fd: "2026-11-05", fh: [{ t: 1 }], pre: true, pp: 500 };
  const studentCopy = copyStudentForGroup(sourceStudent, { id: "copy-group", r: "active-round" }, "copy-student");
  assert.equal(studentCopy.id, "copy-student", "student copy gets a fresh id");
  assert.equal(studentCopy.profileId, sourceStudent.id, "independent round cards retain a stable profile link");
  assert.equal(studentCopy.g, "copy-group", "student copy points to the selected group");
  assert.equal(studentCopy.r, "active-round", "student copy points to the selected round");
  assert.equal(studentCopy.n, sourceStudent.n, "student identity is copied");
  assert.equal(studentCopy.nt, sourceStudent.nt, "student note is copied");
  assert.equal(studentCopy.kind, "returned", "student classification is copied");
  assert.equal(studentCopy.lvPaid, 3, "paid-level count is retained for review");
  assert.equal(studentCopy.pay, 0, "copy starts unpaid");
  assert.equal(studentCopy.amount, 0, "copy does not duplicate revenue");
  assert.equal(studentCopy.pn, "", "copy has no duplicated remaining balance");
  assert.equal(studentCopy.ren, 0, "copy starts with a fresh renewal decision");
  assert.equal(studentCopy.renewalReason, "", "copy does not inherit a past renewal reason");
  assert.equal(studentCopy.fd, undefined, "copy does not inherit an old follow-up date");
  assert.equal(studentCopy.fh, undefined, "copy does not inherit follow-up history");
  assert.equal(studentCopy.pre, undefined, "copy does not inherit payment/prepayment flags");
  assert.equal(sourceStudent.g, "old-group", "copy leaves the original group unchanged");
  assert.equal(sourceStudent.amount, 600, "copy leaves the original payment unchanged");
  assert.equal(canAccessFinance("owner"), true);
  assert.equal(canAccessFinance("admin"), false);
  assert.equal(canAccessFinance("teacher"), false);
  assert.equal(canAccessFinance("marketer"), false);
  assert.equal(canAccessMarketingAnalytics("owner"), true);
  assert.equal(canAccessMarketingAnalytics("marketer"), true);
  assert.equal(canAccessMarketingAnalytics("marketing"), true);
  assert.equal(isMarketingRole("marketer"), true);
  assert.equal(isMarketingRole("marketing"), true);
  assert.equal(canAccessMarketingAnalytics("admin"), false);
  const revenueData = {
    r: [{ id: "active-round", on: true }, { id: "inactive-round", on: false }],
    g: [
      { id: "group-paid", r: "active-round", s: "2026-10-01" },
      { id: "private-paid", r: "pv", p: 1, s: "2026-10-15" },
      { id: "inactive-paid", r: "inactive-round", s: "2026-10-01" }
    ],
    m: [
      { id: "student-group", g: "group-paid", n: "طالب جروب", ph: "01000000001", amount: 250 },
      { id: "student-private", g: "private-paid", n: "طالب Private", ph: "01000000002", amount: 200 },
      { id: "student-inactive", g: "inactive-paid", n: "غير نشط", ph: "01000000003", amount: 500 },
      { id: "student-unpaid", g: "group-paid", n: "غير مدفوع", ph: "01000000004", amount: 0 }
    ]
  };
  const revenueRows = incomeStudentsForMonth(revenueData, "2026-10");
  assert.equal(revenueRows.length, 3, "monthly detail includes active group, Private, and non-archived stopped-round payers");
  assert.equal(revenueRows.reduce((sum, row) => sum + Number(row.student.amount), 0), 950, "student detail sum includes 500 from the stopped but non-archived round");
  assert.equal(incomeForMonth(revenueData, "2026-10"), 950, "detailed amount matches the monthly total including a stopped round");
  assert.equal(incomeStudentsForMonth(revenueData, "2026-11").length, 0, "monthly student detail stays separate by month");
  const classifiedRevenue = incomeStudentsByKindForMonth({ ...revenueData, m: [
    { ...revenueData.m[0], kind: "new" },
    { ...revenueData.m[1], kind: "returned" },
    { ...revenueData.m[2], kind: "old" }
  ] }, "2026-10");
  assert.equal(classifiedRevenue.new.reduce((sum, row) => sum + row.student.amount, 0), 250);
  assert.equal(classifiedRevenue.returned.reduce((sum, row) => sum + row.student.amount, 0), 200);
  assert.equal(classifiedRevenue.old.reduce((sum, row) => sum + row.student.amount, 0), 500);
  assert.equal(studentKind({ id: "legacy-new", g: "g", nw: 1 }), "new", "legacy new flag maps to the new category without a migration write");
  assert.equal(studentKind({ id: "legacy-old", g: "g", nw: 0 }), "old", "legacy old flag maps to the old category");
  assert.equal(studentKind({ id: "returning", g: "g", nw: 0, kind: "returned" }), "returned", "explicit return-after-break category takes precedence");
  assert.equal(studentKindLabel("returned"), "قديم رجع بعد انقطاع");
  assert.equal(studentSourceLabel({ source: "أخرى", sourceOther: "معرفة" }), "أخرى · معرفة");

  const monthStart = `${today.slice(0, 7)}-01`;
  const futureEnd = moveDays(today, 40);
  const pastEnd = moveDays(today, -1);
  const archiveData = {
    r: [{ id: "round-active", on: true }, { id: "round-archived", on: true, x: 1 }, { id: "round-paused", on: false }],
    g: [
      { id: "active-group", r: "round-active", s: monthStart, e: futureEnd, d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "Teacher" },
      { id: "active-private", r: "pv", p: 1, s: monthStart, e: futureEnd, d: "الأحد والأربعاء", t1: "17:00", t2: "18:00", tc: "Teacher" },
      { id: "empty-private", r: "pv", p: 1, lv: "Private بلا طالب" },
      { id: "archived-private", r: "round-archived", p: 1, s: monthStart, e: futureEnd, d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "Teacher" },
      { id: "archived-round-group", r: "round-archived", s: monthStart, e: futureEnd, d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "Teacher" },
      { id: "archived-group", r: "round-active", x: 1, s: monthStart, e: futureEnd, d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "Teacher" },
      { id: "paused-group", r: "round-paused", s: monthStart, e: pastEnd, d: "السبت والثلاثاء", t1: "16:00", t2: "18:00", tc: "Teacher" }
    ],
    m: [
      { id: "student-active-group", g: "active-group", n: "طالب جروب نشط", ph: "01011111111", amount: 100, pay: 1 },
      { id: "student-active-private", g: "active-private", n: "طالب Private نشط", ph: "01022222222", amount: 200, pay: 1 },
      { id: "student-archived-private", g: "archived-private", n: "Private مؤرشف", ph: "01033333333", amount: 999, pay: 1 },
      { id: "student-archived-round", g: "archived-round-group", n: "راوند مؤرشف", ph: "01044444444", amount: 888, pay: 1 },
      { id: "student-archived-group", g: "archived-group", n: "جروب مؤرشف", ph: "01055555555", amount: 777, pay: 1 },
      { id: "student-paused", g: "paused-group", n: "راوند متوقف", ph: "01066666666", amount: 50, pay: 1 },
      { id: "student-archived-record", g: "active-group", n: "طالب مؤرشف", ph: "01077777777", amount: 666, pay: 1, x: 1 }
    ],
    finance: [
      { id: "expense-active", type: "expense", amount: 30, date: monthStart },
      { id: "expense-archived", type: "expense", amount: 999, date: monthStart, x: 1 }
    ],
    attendance: [
      { date: today, gid: "active-group", mid: "student-active-group", status: "present" },
      { date: today, gid: "active-group", mid: "student-archived-record", status: "absent" },
      { date: today, gid: "archived-group", mid: "student-archived-group", status: "present" },
      { date: today, gid: "archived-round-group", mid: "student-archived-round", status: "absent" }
    ]
  };
  assert.deepEqual(nonArchivedGroups(archiveData).map((group) => group.id).sort(), ["active-group", "active-private", "empty-private", "paused-group"], "non-archived groups include empty Private records while excluding archived groups and rounds");
  assert.deepEqual(studentsInNonArchivedGroups(archiveData).map((student) => student.id).sort(), ["student-active-group", "student-active-private", "student-paused"], "follow-up and renewals cannot draw students from archived groups/rounds");
  assert.deepEqual(activeAttendanceRecords(archiveData, "active-group").map((row) => row.mid), ["student-active-group"], "attendance history ignores archived students in an otherwise active group");
  assert.equal(activeAttendanceRecords(archiveData, "archived-group").length, 0, "attendance history ignores an archived group");
  assert.equal(activeAttendanceRecords(archiveData, "archived-round-group").length, 0, "attendance history ignores a group from an archived round");
  assert.deepEqual(activeGroups(archiveData).map((group) => group.id).sort(), ["active-group", "active-private", "empty-private"], "operational groups include empty non-archived Private records and exclude archived groups and rounds");
  assert.deepEqual(studentsInRound(archiveData, "round-active").map((student) => student.id), ["student-active-group"], "round classification includes only students in its non-archived groups");
  assert.deepEqual(studentsInRound(archiveData, "round-paused").map((student) => student.id), ["student-paused"], "classification can be viewed for a stopped but non-archived round");
  assert.deepEqual(studentsInRound(archiveData, "round-archived"), [], "archived rounds stay excluded from classification");
  assert.deepEqual(studentsInRound(archiveData, "missing-round"), [], "unknown round selection has no students");
  assert.equal(totalCurrentStudents(archiveData), 2, "main student count excludes archived groups, rounds and students");
  assert.deepEqual(currentStudentCounts(archiveData), { groups: 1, private: 1, total: 2 }, "main dashboard separates group and Private students without changing retention");
  const noRenewalRow = { id: "student-no-renewal", g: "active-group", n: "طالب لن يجدد", ph: "01090909090", profileId: "profile-no-renewal", ren: 2, formerAt: Date.now(), pay: 1, amount: 75 };
  const noRenewalData = { ...archiveData, m: [...archiveData.m, noRenewalRow] };
  assert.equal(isEnrolledStudent(noRenewalRow), true, "legacy no-renewal students remain enrolled unless explicitly moved to another tab");
  assert.equal(currentStudentCounts(noRenewalData).total, 3, "marking no-renewal does not remove a student from current group totals");
  assert.equal(retentionByMonth(noRenewalData).flatMap((row) => row.registrations).some((row) => row.student.id === noRenewalRow.id), true, "no-renewal stays in the original retention cohort");
  assert.equal(incomeForMonth(noRenewalData, today.slice(0, 7)), 425, "no-renewal keeps the original month subscription in income history");
  const copiedFormerRow = { ...noRenewalRow, id: "student-no-renewal-copy", copiedFromStudentId: noRenewalRow.id, movedToTab: "renewals" };
  const noRenewalWithCopy = { ...noRenewalData, m: [...noRenewalData.m, copiedFormerRow] };
  assert.equal(currentStudentCounts(noRenewalWithCopy).total, 3, "a former-customer copy does not inflate current student totals");
  assert.equal(retentionByMonth(noRenewalWithCopy).flatMap((row) => row.registrations).filter((row) => row.student.profileId === noRenewalRow.profileId).length, 1, "copying a no-renewal student does not double-count their retention registration");
  assert.equal(incomeForMonth(noRenewalWithCopy, today.slice(0, 7)), 425, "copying a no-renewal student does not duplicate historical income");
  assert.equal(formerStudents(noRenewalData, today).some((row) => row.student.id === noRenewalRow.id), false, "a no-renewal student in a current group is not incorrectly listed as a former student");
  const autoFormerSource = { id: "auto-former-source", profileId: "auto-former-profile", g: "auto-former-old-group", r: "auto-former-round", n: "طالب انتهى جروبه", ph: "01012345678", ren: 2, pay: 1, amount: 900 };
  const autoFormerData = {
    ...archiveData,
    r: [...archiveData.r, { id: "auto-former-round", n: "راوند قديم" }],
    g: [...archiveData.g, { id: "auto-former-old-group", r: "auto-former-round", s: "2026-10-01", e: "2026-11-08", ss: [{ k: "2026-11-08", d: "2026-11-08" }] }],
    m: [autoFormerSource]
  };
  assert.equal(addAutomaticFormerCustomerCopies(autoFormerData, "2026-11-09", 1234), 1, "completed no-renewal enrollment gets an automatic former-customer copy");
  const autoFormerCopy = autoFormerData.m.find((student) => student.autoFormerCustomer);
  assert.ok(autoFormerCopy, "automatic former-customer copy is stored as its own student row");
  assert.equal(autoFormerCopy.copiedFromStudentId, autoFormerSource.id, "automatic copy points to the original enrollment");
  assert.equal(autoFormerCopy.movedToTab, "renewals", "automatic copy appears in Customers Old");
  assert.equal(isEnrolledStudent(autoFormerSource), true, "automatic copying leaves the original no-renewal enrollment active in its group history");
  assert.equal(isEnrolledStudent(autoFormerCopy), false, "automatic copy does not enter current student or retention counts");
  assert.equal(addAutomaticFormerCustomerCopies(autoFormerData, "2026-11-09", 5678), 0, "automatic former copies are idempotent");
  const autoFormerRenewed = { ...autoFormerData, g: [...autoFormerData.g, { id: "auto-former-new-group", r: "auto-former-round", s: "2026-11-09", e: "2026-12-31" }], m: [...autoFormerData.m, { ...autoFormerSource, id: "auto-former-new-enrollment", g: "auto-former-new-group" }] };
  assert.equal(addAutomaticFormerCustomerCopies(autoFormerRenewed, "2026-11-09", 9999), 0, "a student registered in a later group is not copied to Customers Old");
  assert.equal(addAutomaticFormerCustomerCopies(autoFormerData, "2026-11-08", 9999), 0, "a group is not completed until the last scheduled date has passed");
  const stoppedRoundData = { ...archiveData, r: archiveData.r.map((round) => round.id === "round-active" ? { ...round, on: false } : round) };
  assert.equal(currentStudentCounts(stoppedRoundData).total, 1, "stopping a round removes its group students from current dashboard totals while Private remains active");
  assert.equal(retentionByMonth(stoppedRoundData).flatMap((row) => row.registrations).some((row) => row.student.id === "student-active-group"), true, "stopping a round does not erase its non-archived cohort from retention");
  const finishedActiveRoundData = { ...archiveData, g: archiveData.g.map((group) => group.id === "active-group" ? { ...group, e: pastEnd } : group) };
  assert.equal(currentStudentCounts(finishedActiveRoundData).total, 1, "a finished group in a still-active round is removed from the current total");
  assert.equal(retentionByMonth(finishedActiveRoundData).flatMap((row) => row.registrations).some((row) => row.student.id === "student-active-group"), true, "the finished group's enrolled student remains in retention history");
  const archivedTeacherStillActive = { ...archiveData, teacherHours: [{ name: "Teacher", archivedAt: Date.now() }] };
  assert.equal(isTeacherNameArchived(archivedTeacherStillActive, "teacher"), true, "teacher archive state is detected case-insensitively");
  assert.equal(currentStudentCounts(archivedTeacherStillActive).total, 2, "archiving a teacher does not remove their unarchived groups/students from current totals");
  assert.equal(incomeForMonth(archivedTeacherStillActive, today.slice(0, 7)), 350, "archiving a teacher does not remove unarchived student revenue");
  const demoData = previewData();
  assert.deepEqual(currentStudentCounts(demoData), { groups: 4, private: 1, total: 5 }, "demo seed covers separate group/Private/total counts, including a student awaiting renewal");
  assert.equal(isTeacherNameArchived(demoData, "مدرس مؤرشف تجريبي"), true, "demo seed contains an archived teacher for visibility checks");
  assert.equal(teacherNames(demoData, []).includes("مدرس مؤرشف تجريبي"), false, "archived demo teacher is absent from assignment pickers");
  const demoMonth = String(demoData.g.find((group) => group.id === "preview-group-pre2")?.s ?? today).slice(0, 7);
  assert.equal(incomeForMonth(demoData, demoMonth), incomeStudentsByKindForMonth(demoData, demoMonth).new.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0) + incomeStudentsByKindForMonth(demoData, demoMonth).old.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0) + incomeStudentsByKindForMonth(demoData, demoMonth).returned.reduce((sum, row) => sum + Number(row.student.amount ?? 0), 0), "Demo income category amounts reconcile to existing monthly income");
  assert.equal(incomeForMonth(archiveData, today.slice(0, 7)), 350, "a stopped but non-archived round remains in income while archived records stay excluded");
  assert.equal(incomeStudentsForMonth(archiveData, today.slice(0, 7)).length, 3, "monthly payer detail includes the stopped round but excludes archived records");
  assert.equal(retentionByMonth(archiveData).flatMap((row) => row.registrations).length, 3, "retention includes the completed non-archived cohort while excluding archived groups, rounds and students");
  assert.equal(expenseForMonth(archiveData, today.slice(0, 7)), 30, "archived finance rows do not enter expense totals");
  const formerIds = formerStudents(archiveData, today).map((row) => row.student.id);
  assert.deepEqual(formerIds, ["student-paused"], "former-student follow-up excludes archived groups and rounds but keeps non-archived inactive records");
  const movedStudent = { id: "student-moved-to-next", g: "active-group", n: "نُقل لقائمة الراوند الجاي", ph: "01088888888", pay: 1, amount: 500, profileId: "profile-moved", formerAt: Date.now(), movedToTab: "next" };
  const movedData = { ...archiveData, m: [...archiveData.m, movedStudent] };
  assert.equal(formerStudents(movedData, today).some((row) => row.student.id === movedStudent.id), false, "students transferred to another lead tab do not also appear as old-customer follow-ups");
  assert.equal(retentionByMonth(movedData).flatMap((row) => row.registrations).some((row) => row.student.id === movedStudent.id), false, "students outside Groups and Private no longer appear in retention statistics");
  assert.equal(currentStudentCounts(movedData).total, 2, "students transferred out of Groups and Private do not inflate live counts");
  assert.equal(incomeForMonth(movedData, today.slice(0, 7)), 350, "students transferred out of Groups and Private are excluded from student-income statistics");
  const formerData = { ...archiveData, m: [...archiveData.m, { ...movedStudent, id: "student-former-only", formerAt: Date.now(), movedToTab: undefined }] };
  assert.equal(retentionByMonth(formerData).flatMap((row) => row.registrations).some((row) => row.student.id === "student-former-only"), false, "students marked as former are excluded even when no destination tab is recorded");
  assert.equal(incomeForMonth(formerData, today.slice(0, 7)), 350, "former students stay out of monthly student income statistics");
  const formerCounts = currentStudentCounts({ ...archiveData, m: [...archiveData.m, { id: "former-row", g: "active-group", formerAt: 1 }] });
  assert.deepEqual(formerCounts, { groups: 1, private: 1, total: 2 }, "former customers stay in records but do not inflate current student totals");
  const priorRows = [
    { date: today, gid: "g1", mid: "m1", status: "present" },
    { date: today, gid: "g1", mid: "m2", status: "absent" }
  ];
  const attendanceCleanup = { attendance: [...priorRows] };
  assert.equal(removeStudentAttendance(attendanceCleanup, "m1"), 1, "removing a student clears that enrollment's attendance marks");
  assert.deepEqual(attendanceCleanup.attendance, [priorRows[1]], "attendance marks for other students remain intact");
  const retained = new Set([attendanceKey(priorRows[0])]);
  assert.deepEqual(removedAttendanceKeys(retained, [priorRows[0]]), []);
  assert.deepEqual(removedAttendanceKeys(retained, []), [attendanceKey(priorRows[0])]);
  assert.equal(attendanceDocumentId(priorRows[0]), `${today}__g1__m1`, "central document ID matches the existing Firestore schema");

  const noEnd = { ...satTueGroup, e: undefined };
  const generated = generateSessions(noEnd);
  assert.ok(generated.length <= 8);
  console.log("All domain tests passed: schedules, two-week student reminders, weekly lead reminders, no-renewal cohort continuity, former-customer copies, archive boundaries, capacity, finance roles, and attendance sync.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
