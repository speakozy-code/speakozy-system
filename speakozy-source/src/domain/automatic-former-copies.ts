import type { AcademyData, AcademyGroup, Student } from "./types";
import { isEnrolledStudent, nonArchivedGroups, normalise, toIsoDate } from "./utils";
import { plannedGroupEndDate } from "./schedule";

function sameStudent(first: Student, second: Student): boolean {
  if (first.profileId && second.profileId) return first.profileId === second.profileId;

  const digits = (value?: string) => String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\D/g, "");
  const firstPhone = digits(first.ph);
  const secondPhone = digits(second.ph);
  if (firstPhone.length >= 9 && secondPhone.length >= 9) return firstPhone.slice(-9) === secondPhone.slice(-9);

  const firstName = normalise(first.n);
  const secondName = normalise(second.n);
  return Boolean(firstName && firstName === secondName);
}

function hasLaterEnrollment(data: AcademyData, source: Student, sourceGroup: AcademyGroup): boolean {
  const sourceStart = String(sourceGroup.s ?? "").slice(0, 10);
  const sourceEnd = plannedGroupEndDate(sourceGroup);
  const groups = new Map(data.g.map((group) => [group.id, group]));

  return data.m.some((candidate) => {
    if (candidate.x || candidate.id === source.id || candidate.g === sourceGroup.id || !sameStudent(source, candidate)) return false;
    const candidateGroup = groups.get(candidate.g);
    if (!candidateGroup) return false;
    const candidateStart = String(candidateGroup.s ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateStart)) return false;
    return sourceStart ? candidateStart > sourceStart : candidateStart >= sourceEnd;
  });
}

/**
 * Adds one separate Customers-Old copy for each completed no-renewal enrollment
 * that has no later group registration. Original rows and groups are untouched.
 */
export function addAutomaticFormerCustomerCopies(
  data: AcademyData,
  today = toIsoDate(),
  stamp = Date.now()
): number {
  const groups = new Map(nonArchivedGroups(data).map((group) => [group.id, group]));
  const sources = data.m.filter((student) => !student.x && Number(student.ren) === 2 && isEnrolledStudent(student));
  let added = 0;

  sources.forEach((source) => {
    const group = groups.get(source.g);
    if (!group) return;
    const endDate = plannedGroupEndDate(group);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate >= today) return;
    const alreadyCopied = data.m.some((student) =>
      student.copiedFromStudentId === source.id && student.movedToTab === "renewals"
    );
    if (alreadyCopied || hasLaterEnrollment(data, source, group)) return;

    data.m.push({
      ...source,
      id: `auto-former-${source.id}`,
      profileId: source.profileId || source.id,
      studentCode: source.studentCode || `SPK-${source.profileId || source.id}`,
      copiedFromStudentId: source.id,
      autoFormerCustomer: true,
      formerAt: stamp,
      movedToTab: "renewals",
      ren: 2
    });
    added += 1;
  });

  return added;
}
