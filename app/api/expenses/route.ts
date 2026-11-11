import { getDB } from "@/lib/db";
import { findExpenses } from "@/lib/executor";
import { todayInfo } from "@/lib/agent";
import { badRequest, getUserId, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  const db = await getDB();
  const month = todayInfo().today.slice(0, 7);
  const [expenses, byCategory, budgets] = await Promise.all([
    findExpenses(db, userId, {}, 200),
    db.query(`SELECT category AS label, SUM(amount_usd)::float8 AS value FROM expenses
              WHERE user_id=$1 AND to_char(spent_on,'YYYY-MM')=$2 GROUP BY 1 ORDER BY 2 DESC`, [userId, month]),
    db.query(`SELECT category, monthly_limit::float8 AS monthly_limit FROM budgets WHERE user_id=$1 ORDER BY category`, [userId]),
  ]);
  return json({ month, expenses, byCategory, budgets });
}
