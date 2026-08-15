import { createHash } from "node:crypto";

/** One-way representation stored for administrator bearer sessions. */
export function adminSessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
