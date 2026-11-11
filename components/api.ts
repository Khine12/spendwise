"use client";
export function getUserId(): string {
  try {
    let id = localStorage.getItem("spendwise-user");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("spendwise-user", id); }
    return id;
  } catch {
    // storage blocked: fall back to a per-tab id
    const w = window as unknown as { __sw?: string };
    return (w.__sw ??= crypto.randomUUID());
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-user-id": getUserId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);
  return data as T;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
