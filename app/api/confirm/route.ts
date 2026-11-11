import { getDB } from "@/lib/db";
import { resolvePending } from "@/lib/agent";
import { badRequest, getUserId, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = getUserId(req);
  if (!userId) return badRequest("Missing or invalid user id.");
  const body = await req.json().catch(() => ({}));
  const { pendingId, decision } = body as { pendingId?: string; decision?: string };
  if (typeof pendingId !== "string" || (decision !== "confirm" && decision !== "cancel")) return badRequest("Need pendingId and decision.");
  const result = await resolvePending({ db: await getDB(), userId, pendingId, decision });
  return json(result);
}
