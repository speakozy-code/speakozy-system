import type { AcademyData, Lead, Student } from "./types";
import { isActiveStudentEnrollment, samePerson, sameStudentIdentity } from "./customer-stage";
import { live } from "./utils";

/**
 * Safe duplicate clean-up. Nothing is ever deleted: affected rows get the existing
 * archive flag (x / xa) plus `xr` (reason + batch tag) so a batch can be undone.
 */
export type CleanupReason = "lead-of-enrolled" | "former-copy-of-enrolled" | "lead-duplicates-former-copy" | "duplicate-former-copy" | "duplicate-lead";

export interface CleanupAction {
  record: "lead" | "student";
  id: string;
  reason: CleanupReason;
  name: string;
  phone: string;
}

export interface CleanupPlan {
  actions: CleanupAction[];
  /** Duplicates that carry follow-up data or are newer than the copy: listed, never archived. */
  needsDecision: { id: string; name: string; phone: string; why: string }[];
}

export const REASON_LABELS: Record<CleanupReason, string> = {
  "lead-of-enrolled": "ليد لشخص مسجل في راوند/Private شغال",
  "former-copy-of-enrolled": "نسخة في عملاء الراوند الجاي لشخص مسجل في راوند/Private شغال",
  "lead-duplicates-former-copy": "ليد مكرر لنسخة في عملاء الراوند الجاي (بدون متابعة)",
  "duplicate-former-copy": "نسخة مكررة في عملاء الراوند الجاي",
  "duplicate-lead": "ليد مكرر لنفس الشخص"
};

const hasFollowup = (lead: Lead): boolean => Boolean(lead.followupCat || lead.fd || lead.followupDate || lead.followupReason || String(lead.nt ?? "").trim());
const leadStamp = (lead: Lead): number => Number(lead.ts ?? 0);
const describe = (record: { n?: string; ph?: string }) => ({ name: String(record.n ?? "").trim() || "بدون اسم", phone: String(record.ph ?? "") });

export function planDuplicateCleanup(data: AcademyData): CleanupPlan {
  const leads = live(data.l ?? []).filter((lead) => !lead.convertedStudentId);
  const students = live(data.m);
  const taken = new Set<string>();
  const actions: CleanupAction[] = [];
  const needsDecision: CleanupPlan["needsDecision"] = [];
  const add = (record: CleanupAction["record"], item: Lead | Student, reason: CleanupReason) => {
    if (taken.has(item.id)) return;
    taken.add(item.id);
    actions.push({ record, id: item.id, reason, ...describe(item) });
  };

  // 1) Leads and former-customer copies of people who are enrolled right now.
  const enrolled = students.filter((student) => isActiveStudentEnrollment(student, data));
  leads.filter((lead) => enrolled.some((student) => sameStudentIdentity(student, lead))).forEach((lead) => add("lead", lead, "lead-of-enrolled"));
  students.filter((copy) => copy.movedToTab === "renewals" && enrolled.some((student) => student.id !== copy.id && sameStudentIdentity(student, copy))).forEach((copy) => add("student", copy, "former-copy-of-enrolled"));

  // 2) More than one former-customer copy for the same person: keep one (manual first, then newest).
  const copies = students.filter((student) => student.movedToTab === "renewals");
  const copyGroups: Student[][] = [];
  copies.forEach((copy) => { const group = copyGroups.find((items) => samePerson(items[0], copy)); if (group) group.push(copy); else copyGroups.push([copy]); });
  copyGroups.filter((group) => group.length > 1).forEach((group) => {
    const keep = [...group].sort((a, b) => Number(Boolean(a.autoFormerCustomer)) - Number(Boolean(b.autoFormerCustomer)) || Number(b.formerAt ?? 0) - Number(a.formerAt ?? 0))[0];
    group.filter((copy) => copy.id !== keep.id).forEach((copy) => add("student", copy, "duplicate-former-copy"));
  });
  const keptCopies = copies.filter((copy) => !taken.has(copy.id));

  // 3) A live lead that duplicates a former-customer copy: archive only the older lead without follow-up data.
  leads.filter((lead) => !taken.has(lead.id)).forEach((lead) => {
    const copy = keptCopies.find((item) => samePerson(item, lead));
    if (!copy) return;
    if (hasFollowup(lead)) { needsDecision.push({ id: lead.id, ...describe(lead), why: "عليه متابعة أو ملاحظة" }); return; }
    if (leadStamp(lead) > Number(copy.formerAt ?? 0)) { needsDecision.push({ id: lead.id, ...describe(lead), why: "أحدث من النسخة" }); return; }
    add("lead", lead, "lead-duplicates-former-copy");
  });

  // 4) Several live leads for one person: keep the newest (prefer one that has follow-up data).
  const rest = leads.filter((lead) => !taken.has(lead.id));
  const leadGroups: Lead[][] = [];
  rest.forEach((lead) => { const group = leadGroups.find((items) => samePerson(items[0], lead)); if (group) group.push(lead); else leadGroups.push([lead]); });
  leadGroups.filter((group) => group.length > 1).forEach((group) => {
    const keep = [...group].sort((a, b) => Number(hasFollowup(b)) - Number(hasFollowup(a)) || leadStamp(b) - leadStamp(a))[0];
    group.filter((lead) => lead.id !== keep.id).forEach((lead) => add("lead", lead, "duplicate-lead"));
  });

  return { actions, needsDecision };
}

/** Archives the planned rows in `draft`. Returns the batch tag used for undo. */
export function applyDuplicateCleanup(draft: AcademyData, plan: CleanupPlan, stamp = Date.now()): { tag: string; archived: number } {
  const tag = `dup-cleanup:${stamp}`;
  let archived = 0;
  plan.actions.forEach((action) => {
    const row = (action.record === "lead" ? draft.l : draft.m).find((item) => item.id === action.id && !item.x);
    if (!row) return;
    row.x = 1;
    row.xa = stamp;
    row.xr = `${tag}:${action.reason}`;
    archived += 1;
  });
  return { tag, archived };
}

/** Restores every row archived by one clean-up batch. */
export function undoDuplicateCleanup(draft: AcademyData, tag: string): number {
  let restored = 0;
  [...draft.l, ...draft.m].forEach((row) => {
    if (row.x && typeof row.xr === "string" && row.xr.startsWith(`${tag}:`)) {
      delete row.x; delete row.xa; delete row.xr;
      restored += 1;
    }
  });
  return restored;
}

/** Batches that can still be undone, newest first. */
export function cleanupBatches(data: AcademyData): { tag: string; count: number; at: number }[] {
  const batches = new Map<string, number>();
  [...data.l, ...data.m].forEach((row) => {
    if (row.x && typeof row.xr === "string" && row.xr.startsWith("dup-cleanup:")) {
      const tag = row.xr.split(":").slice(0, 2).join(":");
      batches.set(tag, (batches.get(tag) ?? 0) + 1);
    }
  });
  return [...batches.entries()].map(([tag, count]) => ({ tag, count, at: Number(tag.split(":")[1]) })).sort((a, b) => b.at - a.at);
}
