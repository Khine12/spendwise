import { getDB } from "@/lib/db";
import { badRequest, getUserId, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  const rows = await (await getDB()).query(
    `SELECT id, request_id, event, action_type, status, message, detail, created_at
     FROM audit_log WHERE user_id=$1 ORDER BY id DESC LIMIT 100`, [userId]);
  return json({ entries: rows });
}
