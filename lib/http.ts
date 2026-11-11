import { NextResponse } from "next/server";

/** Each browser gets an anonymous id (stored in localStorage) so testers don't see each other's data. */
export function getUserId(req: Request): string | null {
  const id = req.headers.get("x-user-id") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const badRequest = (error: string) => json({ error }, 400);

/** Simple per-user sliding-window rate limit to protect the API key on a public deployment. */
const hits = new Map<string, number[]>();
export function rateLimited(userId: string, limit = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > limit;
}
