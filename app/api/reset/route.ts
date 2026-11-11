import { getDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { badRequest, getUserId, json } from "@/lib/http";

export const runtime = "nodejs";

/** Clears this browser's data. The UI asks for confirmation first. */
export async function POST(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  const db = await getDB();
  await db.query(`DELETE FROM expenses WHERE user_id=$1`, [userId]);
  await db.query(`DELETE FROM budgets WHERE user_id=$1`, [userId]);
  await db.query(`DELETE FROM pending_actions WHERE user_id=$1`, [userId]);
  await logAudit(db, { userId, event: "system", status: "success", message: "User reset all data" });
  return json({ ok: true });
}
