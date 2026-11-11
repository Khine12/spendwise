/**
 * Action executor: turns validated actions into real operations.
 * Domains: database writes/queries, external API calls (exchange rates),
 * file generation (CSV export), and data visualisation (chart data).
 * All SQL is parameterised; the LLM never writes SQL.
 */
import type { DB } from "./db";
import type { Action, Filters } from "./actions";

export type ExpenseRow = {
  id: number; amount: number; currency: string; amount_usd: number; category: string;
  merchant: string | null; note: string | null; spent_on: string;
};

export type ResultData =
  | { kind: "expense"; expense: ExpenseRow }
  | { kind: "table"; rows: ExpenseRow[]; total_usd: number }
  | { kind: "summary"; group_by: string; rows: { label: string; total: number; count: number }[]; total_usd: number }
  | { kind: "chart"; chart: "bar" | "pie" | "line"; group_by: string; points: { label: string; value: number }[] }
  | { kind: "budget"; month: string; items: { category: string; limit: number; spent: number; remaining: number; pct: number }[] }
  | { kind: "conversion"; amount: number; from: string; to: string; result: number; rate: number; date: string }
  | { kind: "file"; filename: string; mime: string; content: string; rows: number }
  | { kind: "deleted"; count: number; ids: number[] }
  | { kind: "budget_set"; category: string; monthly_limit: number };

export type Deps = { fetch: typeof fetch };
export const defaultDeps: Deps = { fetch: (...a) => fetch(...a) };

const EXPENSE_COLS = `id, amount::float8 AS amount, currency, amount_usd::float8 AS amount_usd, category,
  merchant, note, to_char(spent_on, 'YYYY-MM-DD') AS spent_on`;

export class ActionFailure extends Error {}

/** Build a parameterised WHERE clause from structured filters. */
export function buildWhere(userId: string, f: Filters = {}, start = 1) {
  const clauses = [`user_id = $${start}`];
  const params: unknown[] = [userId];
  const add = (sql: string, v: unknown) => { params.push(v); clauses.push(sql.replace("?", `$${start + params.length - 1}`)); };
  if (f.category) add("category = ?", f.category);
  if (f.merchant) add("merchant ILIKE ?", `%${escapeLike(f.merchant)}%`);
  if (f.from) add("spent_on >= ?::date", f.from);
  if (f.to) add("spent_on <= ?::date", f.to);
  if (f.min_amount !== undefined) add("amount_usd >= ?", f.min_amount);
  if (f.max_amount !== undefined) add("amount_usd <= ?", f.max_amount);
  if (f.search) {
    const p = `%${escapeLike(f.search)}%`;
    params.push(p);
    const n = `$${start + params.length - 1}`;
    clauses.push(`(merchant ILIKE ${n} OR note ILIKE ${n} OR category ILIKE ${n})`);
  }
  return { where: clauses.join(" AND "), params };
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export async function getRate(from: string, to: string, deps: Deps): Promise<{ rate: number; date: string }> {
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  let res: Response;
  try {
    res = await deps.fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new ActionFailure("The exchange-rate service could not be reached.");
  }
  if (res.status === 404 || res.status === 422) throw new ActionFailure(`Unsupported currency (${from} or ${to}).`);
  if (!res.ok) throw new ActionFailure(`Exchange-rate service error (${res.status}).`);
  const body = (await res.json()) as { rates?: Record<string, number>; date?: string };
  const rate = body.rates?.[to];
  if (typeof rate !== "number") throw new ActionFailure(`No rate available for ${from} → ${to}.`);
  return { rate, date: body.date ?? "" };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function groupExpr(group_by: string) {
  switch (group_by) {
    case "category": return "category";
    case "merchant": return "COALESCE(merchant, '(none)')";
    case "month": return "to_char(spent_on, 'YYYY-MM')";
    case "day": return "to_char(spent_on, 'YYYY-MM-DD')";
    default: throw new ActionFailure(`cannot group by ${group_by}`);
  }
}

async function grouped(db: DB, userId: string, group_by: string, filters: Filters) {
  const { where, params } = buildWhere(userId, filters);
  const g = groupExpr(group_by);
  const order = group_by === "month" || group_by === "day" ? "label ASC" : "total DESC";
  const rows = await db.query<{ label: string; total: number; count: number }>(
    `SELECT ${g} AS label, SUM(amount_usd)::float8 AS total, COUNT(*)::int AS count
     FROM expenses WHERE ${where} GROUP BY 1 ORDER BY ${order} LIMIT 50`, params);
  return rows.map((r) => ({ ...r, total: round2(r.total) }));
}

export async function findExpenses(db: DB, userId: string, filters: Filters, limit = 100) {
  const { where, params } = buildWhere(userId, filters);
  return db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE ${where} ORDER BY spent_on DESC, id DESC LIMIT ${Math.min(limit, 500)}`, params);
}

function toCSV(rows: ExpenseRow[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote, and neutralise spreadsheet formula injection (=, +, -, @ at start of text)
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["id", "date", "amount", "currency", "amount_usd", "category", "merchant", "note"];
  const lines = rows.map((r) => [r.id, r.spent_on, r.amount, r.currency, r.amount_usd, r.category, r.merchant, r.note].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}

/** Execute one validated action. Throws ActionFailure with a user-readable message on failure. */
export async function executeAction(
  db: DB, userId: string, action: Action, ctx: { today: string }, deps: Deps = defaultDeps,
): Promise<{ message: string; data?: ResultData }> {
  switch (action.type) {
    case "add_expense": {
      const { rate } = await getRate(action.currency, "USD", deps);
      const usd = round2(action.amount * rate);
      const [row] = await db.query<ExpenseRow>(
        `INSERT INTO expenses (user_id, amount, currency, amount_usd, category, merchant, note, spent_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date) RETURNING ${EXPENSE_COLS}`,
        [userId, action.amount, action.currency, usd, action.category, action.merchant ?? null, action.note ?? null, action.date]);
      const conv = action.currency !== "USD" ? ` (≈ $${usd.toFixed(2)})` : "";
      return { message: `Added #${row.id}: ${action.amount.toFixed(2)} ${action.currency}${conv} · ${row.category}${row.merchant ? " · " + row.merchant : ""} on ${row.spent_on}`, data: { kind: "expense", expense: row } };
    }

    case "list_expenses": {
      const rows = await findExpenses(db, userId, action.filters, action.limit);
      const total = round2(rows.reduce((s, r) => s + r.amount_usd, 0));
      return { message: `Found ${rows.length} expense${rows.length === 1 ? "" : "s"} totalling $${total.toFixed(2)}`, data: { kind: "table", rows, total_usd: total } };
    }

    case "summarize_spending": {
      const rows = await grouped(db, userId, action.group_by, action.filters);
      const total = round2(rows.reduce((s, r) => s + r.total, 0));
      const top = rows[0] && action.group_by !== "month" && action.group_by !== "day" ? `; top: ${rows[0].label} $${rows[0].total.toFixed(2)}` : "";
      return { message: `Total $${total.toFixed(2)} across ${rows.length} ${action.group_by} group(s)${top}`, data: { kind: "summary", group_by: action.group_by, rows, total_usd: total } };
    }

    case "show_chart": {
      const rows = await grouped(db, userId, action.group_by, action.filters);
      if (!rows.length) throw new ActionFailure("No expenses match, so there is nothing to chart.");
      return { message: `Chart of spending by ${action.group_by} (${rows.length} points)`, data: { kind: "chart", chart: action.chart, group_by: action.group_by, points: rows.map((r) => ({ label: r.label, value: r.total })) } };
    }

    case "update_expense": {
      const existing = await db.query<ExpenseRow>(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id=$1 AND user_id=$2`, [action.id, userId]);
      if (!existing.length) throw new ActionFailure(`Expense #${action.id} does not exist.`);
      const cur = existing[0];
      const c = action.changes;
      const amount = c.amount ?? cur.amount;
      const currency = c.currency ?? cur.currency;
      const usd = c.amount !== undefined || c.currency !== undefined
        ? round2(amount * (await getRate(currency, "USD", deps)).rate) : cur.amount_usd;
      const [row] = await db.query<ExpenseRow>(
        `UPDATE expenses SET amount=$1, currency=$2, amount_usd=$3, category=$4, merchant=$5, note=$6, spent_on=$7::date
         WHERE id=$8 AND user_id=$9 RETURNING ${EXPENSE_COLS}`,
        [amount, currency, usd, c.category ?? cur.category,
         c.merchant !== undefined ? c.merchant : cur.merchant,
         c.note !== undefined ? c.note : cur.note, c.date ?? cur.spent_on, action.id, userId]);
      return { message: `Updated #${row.id}: ${Object.keys(c).join(", ")}`, data: { kind: "expense", expense: row } };
    }

    case "delete_expenses": {
      // By the time we get here, ids were resolved and shown to the user at confirmation time.
      const ids = action.ids ?? [];
      if (!ids.length) throw new ActionFailure("Nothing to delete.");
      const rows = await db.query<{ id: number }>(
        `DELETE FROM expenses WHERE user_id=$1 AND id = ANY($2::int[]) RETURNING id`, [userId, ids]);
      return { message: `Deleted ${rows.length} expense${rows.length === 1 ? "" : "s"}`, data: { kind: "deleted", count: rows.length, ids: rows.map((r) => r.id) } };
    }

    case "set_budget": {
      await db.query(
        `INSERT INTO budgets (user_id, category, monthly_limit) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, category) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
        [userId, action.category, action.monthly_limit]);
      return { message: `Budget set: ${action.category} $${action.monthly_limit.toFixed(2)}/month`, data: { kind: "budget_set", category: action.category, monthly_limit: action.monthly_limit } };
    }

    case "check_budget": {
      const month = action.month ?? ctx.today.slice(0, 7);
      const rows = await db.query<{ category: string; limit: number; spent: number }>(
        `SELECT b.category, b.monthly_limit::float8 AS limit,
                COALESCE((SELECT SUM(amount_usd) FROM expenses e WHERE e.user_id=b.user_id AND e.category=b.category
                          AND to_char(e.spent_on,'YYYY-MM') = $2), 0)::float8 AS spent
         FROM budgets b WHERE b.user_id=$1 ORDER BY b.category`, [userId, month]);
      if (!rows.length) throw new ActionFailure("No budgets are set yet. Try: \"set a $300 monthly budget for Food\".");
      const items = rows.map((r) => ({ category: r.category, limit: r.limit, spent: round2(r.spent), remaining: round2(r.limit - r.spent), pct: Math.round((r.spent / r.limit) * 100) }));
      const over = items.filter((i) => i.remaining < 0).map((i) => i.category);
      return { message: `Budget status for ${month}: ${over.length ? "over budget in " + over.join(", ") : "all within budget"}`, data: { kind: "budget", month, items } };
    }

    case "convert_currency": {
      const { rate, date } = await getRate(action.from, action.to, deps);
      const result = round2(action.amount * rate);
      return { message: `${action.amount} ${action.from} = ${result} ${action.to} (rate ${rate}, ${date})`, data: { kind: "conversion", amount: action.amount, from: action.from, to: action.to, result, rate, date } };
    }

    case "export_csv": {
      const rows = await findExpenses(db, userId, action.filters, 500);
      if (!rows.length) throw new ActionFailure("No expenses match, so there is nothing to export.");
      const filename = `${action.filename ?? `expenses-${ctx.today}`}.csv`;
      return { message: `Exported ${rows.length} rows to ${filename}`, data: { kind: "file", filename, mime: "text/csv", content: toCSV(rows), rows: rows.length } };
    }
  }
}
