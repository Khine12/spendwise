import { getDB } from "@/lib/db";
import { todayInfo } from "@/lib/agent";
import { logAudit } from "@/lib/audit";
import { badRequest, getUserId, json } from "@/lib/http";

export const runtime = "nodejs";

/** Loads realistic sample data so the demo has something to work with. Not an LLM action. */
export async function POST(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  const db = await getDB();
  const base = new Date(todayInfo().today + "T12:00:00Z");
  const d = (daysAgo: number) => new Date(base.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
  const sample: [number, string, string, string | null, number][] = [
    [6.25, "Food", "Starbucks", "coffee", 0], [42.1, "Groceries", "Trader Joe's", null, 1],
    [18.4, "Transport", "Uber", "ride to campus", 2], [5.75, "Food", "Starbucks", "coffee", 3],
    [15.99, "Subscriptions", "Netflix", null, 4], [64.0, "Transport", "Chevron", "gas", 6],
    [12.5, "Food", "Chipotle", "lunch", 7], [89.99, "Education", "Amazon", "textbook", 9],
    [6.5, "Food", "Starbucks", "coffee", 10], [120.0, "Utilities", "SoCal Edison", "electric bill", 12],
    [33.2, "Entertainment", "AMC", "movie night", 15], [55.3, "Groceries", "Costco", null, 18],
    [24.0, "Health", "CVS", "vitamins", 22], [10.99, "Subscriptions", "Spotify", null, 27],
    [38.75, "Food", "Din Tai Fung", "dinner", 33], [71.4, "Groceries", "Costco", null, 40],
  ];
  for (const [amount, category, merchant, note, ago] of sample) {
    await db.query(`INSERT INTO expenses (user_id, amount, currency, amount_usd, category, merchant, note, spent_on)
                    VALUES ($1,$2,'USD',$2,$3,$4,$5,$6::date)`, [userId, amount, category, merchant, note, d(ago)]);
  }
  await db.query(`INSERT INTO budgets (user_id, category, monthly_limit) VALUES ($1,'Food',150),($1,'Groceries',250)
                  ON CONFLICT (user_id, category) DO NOTHING`, [userId]);
  await logAudit(db, { userId, event: "system", status: "success", message: `Loaded ${sample.length} sample expenses` });
  return json({ ok: true, count: sample.length });
}
