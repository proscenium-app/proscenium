// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { boundedBytes, json, response } from "./updates";
/** The program: who sponsors Proscenium, by level (docs/engineering/services-and-feedback.md#SERV-D105). */
export const PATRONS = "https://patrons.proscenium.ink";
export const SPONSORABLE = "proscenium-app";
export const MAX_EVENT = 64 * 1024;
/** GitHub's webhook for the listing is the only writer: no token, and nothing is fetched to fill the roll but a sponsor's public name. */
export interface PatronsEnv {
  DB: D1Database;
  PATRONS_ENABLED: string;
  PATRONS_WEBHOOK_SECRET?: string;
}
export interface PatronsDependencies {
  now: () => Date;
  displayName: (login: string) => Promise<string | null>;
}
export interface Roll {
  version: 1;
  updated: string;
  benefactors: string[];
  patrons: string[];
  friends: string[];
  private: number;
}
export type Level = "benefactors" | "patrons" | "friends";
/** The tiers' prices decide the level, so a custom amount sits with the tier it reaches: $25 Benefactor, $10 Patron, below that Friend of the House. */
export function level(monthlyDollars: number): Level {
  return monthlyDollars >= 25 ? "benefactors" : monthlyDollars >= 10 ? "patrons" : "friends";
}
/** A printable name: no controls, no directionality tricks, trimmed, at most 100 characters. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return name && [...name].length <= 100 ? name : null;
}
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Sponsors are keyed by a digest of their login, so a private sponsor's name is never stored at all. */
async function key(login: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`github:${login.toLowerCase()}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signed(secret: string, bytes: Uint8Array, header: string | null): Promise<boolean> {
  const hex = /^sha256=([0-9a-f]{64})$/.exec(header ?? "")?.[1];
  if (!hex) return false;
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    k,
    Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16)),
    bytes,
  );
}
interface Event {
  action: string;
  login: string;
  name: string | null;
  dollars: number;
  oneTime: boolean;
  public: boolean;
  day: string;
}
/** The fields of a `sponsorship` event the roll needs, or null for one it ignores. */
export function parseEvent(value: unknown): Event | null {
  const v = value as { action?: unknown; sponsorship?: Record<string, any> } | null;
  const s = v?.sponsorship;
  if (!s || typeof v?.action !== "string" || s.sponsorable?.login !== SPONSORABLE) return null;
  const login = s.sponsor?.login,
    dollars = s.tier?.monthly_price_in_dollars;
  if (
    typeof login !== "string" ||
    !LOGIN.test(login) ||
    !Number.isInteger(dollars) ||
    dollars < 0 ||
    dollars > 12_000
  )
    return null;
  const day =
    typeof s.created_at === "string" && /^\d{4}-\d\d-\d\d/.test(s.created_at)
      ? s.created_at.slice(0, 10)
      : null;
  if (!day || !["public", "private"].includes(s.privacy_level)) return null;
  return {
    action: v!.action as string,
    login,
    name: cleanName(s.sponsor?.name),
    dollars,
    oneTime: s.tier?.is_one_time === true,
    public: s.privacy_level === "public",
    day,
  };
}
export async function patrons(
  request: Request,
  env: PatronsEnv,
  deps: PatronsDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== PATRONS || url.search) return response(404);
  if (url.pathname === "/v1/roll" && request.method === "GET") {
    if (env.PATRONS_ENABLED !== "true") return response(503);
    try {
      const r = response(200, JSON.stringify(await roll(env.DB, deps.now())), {
        "Content-Type": "application/json",
      });
      r.headers.set("Cache-Control", "public, max-age=300"); // the only cacheable answer here: public names, five minutes stale at most
      return r;
    } catch {
      return response(503);
    }
  }
  if (url.pathname !== "/v1/github" || request.method !== "POST") return response(404);
  if (env.PATRONS_ENABLED !== "true" || !env.PATRONS_WEBHOOK_SECRET) return response(503);
  let bytes: Uint8Array;
  try {
    bytes = await boundedBytes(new Response(request.body, { headers: request.headers }), MAX_EVENT);
  } catch {
    return response(413);
  }
  if (
    !(await signed(env.PATRONS_WEBHOOK_SECRET, bytes, request.headers.get("X-Hub-Signature-256")))
  )
    return response(401);
  const kind = request.headers.get("X-GitHub-Event");
  if (kind === "ping") return response(204);
  if (kind !== "sponsorship") return response(204);
  let event: Event | null;
  try {
    event = parseEvent(
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
    );
  } catch {
    return json(400, { reason: "Invalid event." });
  }
  if (!event) return response(204);
  try {
    await record(env.DB, event, deps);
    return response(204);
  } catch {
    return response(503);
  }
}
/** created, tier_changed and edited set the row; cancelled removes it. The pending_ actions change nothing until they take effect. */
async function record(db: D1Database, e: Event, deps: PatronsDependencies): Promise<void> {
  const k = await key(e.login);
  if (e.action === "cancelled") {
    await db.prepare("DELETE FROM patrons WHERE sponsor = ?").bind(k).run();
    return;
  }
  if (!["created", "tier_changed", "edited"].includes(e.action)) return;
  const name = e.public
    ? (e.name ?? (await deps.displayName(e.login).catch(() => null)) ?? e.login)
    : null;
  await db
    .prepare(`INSERT INTO patrons (sponsor, name, monthly_dollars, one_time, since) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sponsor) DO UPDATE SET name = excluded.name, monthly_dollars = excluded.monthly_dollars, one_time = excluded.one_time,
    since = CASE WHEN excluded.one_time = 1 THEN excluded.since ELSE patrons.since END`)
    .bind(k, name, e.dollars, e.oneTime ? 1 : 0, e.day)
    .run();
}
function yearBefore(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
/** Public names by level, alphabetical; private sponsors only counted. A one-time gift stays a year. */
export async function roll(db: D1Database, now: Date): Promise<Roll> {
  const rows = (
    await db
      .prepare("SELECT name, monthly_dollars FROM patrons WHERE one_time = 0 OR since >= ?")
      .bind(yearBefore(now))
      .all<{ name: string | null; monthly_dollars: number }>()
  ).results;
  const out: Roll = {
    version: 1,
    updated: now.toISOString(),
    benefactors: [],
    patrons: [],
    friends: [],
    private: 0,
  };
  for (const r of rows)
    r.name === null ? out.private++ : out[level(r.monthly_dollars)].push(r.name);
  for (const l of ["benefactors", "patrons", "friends"] as const)
    out[l].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  return out;
}
export async function expirePatrons(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare("DELETE FROM patrons WHERE one_time = 1 AND since < ?")
    .bind(yearBefore(now))
    .run();
}
/** A public sponsor's display name from their public GitHub profile, when the event did not carry one. */
export async function githubName(
  login: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const r = await fetcher(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "proscenium-patrons" },
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) return null;
  return cleanName(((await r.json()) as { name?: unknown }).name);
}
