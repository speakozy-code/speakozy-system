import type { Role } from "./types";

export function canAccessFinance(role: Role | null | undefined): boolean {
  return role === "owner";
}

export function isMarketingRole(role: unknown): role is "marketer" | "marketing" {
  return role === "marketer" || role === "marketing";
}

export function canAccessMarketingAnalytics(role: Role | null | undefined): boolean {
  return role === "owner" || isMarketingRole(role);
}
