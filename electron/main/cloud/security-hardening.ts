import { createHash, timingSafeEqual } from "node:crypto";

export function safeTokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isValidRole(role: unknown): role is "owner" | "admin" | "employee" {
  return role === "owner" || role === "admin" || role === "employee";
}
