/**
 * The action catalog: every operation the agent is allowed to perform.
 * The LLM can only ask for these; anything else is rejected.
 * Each schema is the validation gate between LLM output and execution.
 */
import { z } from "zod";

export const CATEGORIES = [
  "Food", "Groceries", "Transport", "Housing", "Utilities", "Entertainment",
  "Shopping", "Health", "Education", "Travel", "Subscriptions", "Other",
] as const;

const Category = z.enum(CATEGORIES);
const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");
const Currency = z.string().regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter code")
  .transform((s) => s.toUpperCase());
const Money = z.number().positive("amount must be positive").max(1_000_000, "amount too large");
const ShortText = z.string().trim().max(120);

export const Filters = z.object({
  category: Category.optional(),
  merchant: ShortText.optional(),
  from: ISODate.optional(),
  to: ISODate.optional(),
  min_amount: z.number().nonnegative().optional(),
  max_amount: z.number().positive().optional(),
  search: ShortText.optional(),
}).strict();
export type Filters = z.infer<typeof Filters>;

export const AddExpense = z.object({
  type: z.literal("add_expense"),
  amount: Money,
  currency: Currency.default("USD"),
  category: Category,
  merchant: ShortText.nullish(),
  note: z.string().trim().max(300).nullish(),
  date: ISODate,
}).strict();

export const ListExpenses = z.object({
  type: z.literal("list_expenses"),
  filters: Filters.default({}),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export const SummarizeSpending = z.object({
  type: z.literal("summarize_spending"),
  group_by: z.enum(["category", "month", "merchant", "day"]),
  filters: Filters.default({}),
}).strict();

export const UpdateExpense = z.object({
  type: z.literal("update_expense"),
  id: z.number().int().positive(),
  changes: z.object({
    amount: Money.optional(),
    currency: Currency.optional(),
    category: Category.optional(),
    merchant: ShortText.nullish(),
    note: z.string().trim().max(300).nullish(),
    date: ISODate.optional(),
  }).strict().refine((c) => Object.keys(c).length > 0, "changes cannot be empty"),
}).strict();

export const DeleteExpenses = z.object({
  type: z.literal("delete_expenses"),
  ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
  filters: Filters.optional(),
}).strict().refine((a) => a.ids || (a.filters && Object.keys(a.filters).length > 0),
  "delete needs ids or at least one filter (refusing to delete everything)");

export const SetBudget = z.object({
  type: z.literal("set_budget"),
  category: Category,
  monthly_limit: Money,
}).strict();

export const CheckBudget = z.object({
  type: z.literal("check_budget"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM").optional(),
}).strict();

export const ConvertCurrency = z.object({
  type: z.literal("convert_currency"),
  amount: Money,
  from: Currency,
  to: Currency,
}).strict();

export const ExportCsv = z.object({
  type: z.literal("export_csv"),
  filters: Filters.default({}),
  filename: z.string().regex(/^[\w\-]{1,60}$/, "filename may only use letters, numbers, - and _").optional(),
}).strict();

export const ShowChart = z.object({
  type: z.literal("show_chart"),
  group_by: z.enum(["category", "month", "day", "merchant"]),
  chart: z.enum(["bar", "pie", "line"]).default("bar"),
  filters: Filters.default({}),
}).strict();

export const ACTION_SCHEMAS = {
  add_expense: AddExpense,
  list_expenses: ListExpenses,
  summarize_spending: SummarizeSpending,
  update_expense: UpdateExpense,
  delete_expenses: DeleteExpenses,
  set_budget: SetBudget,
  check_budget: CheckBudget,
  convert_currency: ConvertCurrency,
  export_csv: ExportCsv,
  show_chart: ShowChart,
} as const;

export type ActionType = keyof typeof ACTION_SCHEMAS;
export type Action = { [K in ActionType]: z.infer<(typeof ACTION_SCHEMAS)[K]> }[ActionType];

/** Validate one raw action from the LLM. Returns a clean action or a readable error. */
export function validateAction(raw: unknown):
  { ok: true; action: Action } | { ok: false; type: string; error: string } {
  const type = (raw as { type?: unknown })?.type;
  if (typeof type !== "string" || !(type in ACTION_SCHEMAS)) {
    return { ok: false, type: String(type ?? "unknown"), error: `unknown action type "${String(type)}"` };
  }
  const parsed = ACTION_SCHEMAS[type as ActionType].safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || type}: ${i.message}`).join("; ");
    return { ok: false, type, error };
  }
  return { ok: true, action: parsed.data as Action };
}

/** Top-level shape the LLM must return. Actions are validated one by one afterwards. */
export const AgentPlan = z.object({
  reasoning: z.string().max(1500).default(""),
  needs_clarification: z.boolean().default(false),
  clarification_question: z.string().nullish(),
  actions: z.array(z.unknown()).max(8, "at most 8 actions per request").default([]),
  reply: z.string().max(1000).default(""),
});
export type AgentPlan = z.infer<typeof AgentPlan>;

/** Safety policy: which actions must be confirmed by the user before running. */
export const LARGE_AMOUNT_USD = 1000;
export function needsConfirmation(a: Action): string | null {
  if (a.type === "delete_expenses") return "Deleting expenses cannot be undone.";
  if (a.type === "add_expense" && a.currency === "USD" && a.amount >= LARGE_AMOUNT_USD)
    return `This is a large amount ($${a.amount.toFixed(2)}). Please confirm it is correct.`;
  if (a.type === "update_expense" && a.changes.amount && a.changes.amount >= LARGE_AMOUNT_USD)
    return `This sets a large amount ($${a.changes.amount.toFixed(2)}). Please confirm.`;
  return null;
}
