import type { ActionResult } from "@/lib/agent";
export type { ActionResult };

export type UIMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; reasoning?: string; results?: ActionResult[]; clarification?: boolean; error?: boolean };
