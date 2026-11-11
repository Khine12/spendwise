import type { DB } from "./db";

export interface AuditEntry {
  userId: string;
  requestId?: string;
  event: "request" | "plan" | "clarify" | "action" | "confirm" | "error" | "system";
  actionType?: string;
  status: string;
  message?: string;
  detail?: unknown;
}

/** Append-only audit log. Logging must never break the request, so errors are swallowed. */
export async function logAudit(db: DB, e: AuditEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, request_id, event, action_type, detail, status, message)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [e.userId, e.requestId ?? null, e.event, e.actionType ?? null,
       e.detail === undefined ? null : JSON.stringify(e.detail), e.status, e.message?.slice(0, 2000) ?? null]);
  } catch (err) {
    console.error("[audit] failed to write", err);
  }
}
