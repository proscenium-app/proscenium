// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  cleanName,
  expirePatrons,
  githubName,
  level,
  MAX_EVENT,
  PATRONS,
  patrons,
  type PatronsEnv,
} from "../src/patrons";
const migration = await Bun.file(new URL("../migrations/0005_patrons.sql", import.meta.url)).text();
const SECRET = "a".repeat(64);
function sponsorship(
  action: string,
  o: {
    login?: string;
    name?: string;
    dollars?: number;
    oneTime?: boolean;
    privacy?: string;
    day?: string;
    sponsorable?: string;
  } = {},
) {
  return {
    action,
    sponsorship: {
      created_at: `${o.day ?? "2026-10-01"}T12:00:00+00:00`,
      privacy_level: o.privacy ?? "public",
      sponsorable: { login: o.sponsorable ?? "proscenium-app" },
      sponsor: {
        login: o.login ?? "ada",
        ...(o.name ? { name: o.name } : {}),
        html_url: "https://github.com/ada",
      },
      tier: {
        monthly_price_in_dollars: o.dollars ?? 10,
        is_one_time: o.oneTime ?? false,
        is_custom_amount: false,
      },
    },
  };
}
async function sign(body: string, secret = SECRET): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    "sha256=" +
    [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
function fixture(names: Record<string, string | null> = {}) {
  const db = new Database(":memory:");
  db.exec(migration);
  const stmt = (sql: string, args: (string | number | null)[] = []) => ({
    bind: (...a: (string | number | null)[]) => stmt(sql, a),
    async run() {
      const r = db.query(sql).run(...args);
      return { success: true, meta: { changes: r.changes } };
    },
    async all() {
      return { success: true, results: db.query(sql).all(...args) };
    },
  });
  const env: PatronsEnv = {
    DB: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database,
    PATRONS_ENABLED: "true",
    PATRONS_WEBHOOK_SECRET: SECRET,
  };
  let now = new Date("2026-10-02T00:00:00Z");
  const looked: string[] = [];
  const deps = {
    now: () => now,
    displayName: async (login: string) => {
      looked.push(login);
      return names[login] ?? null;
    },
  };
  const send = async (event: unknown, headers: Record<string, string> = {}) => {
    const body = JSON.stringify(event);
    return patrons(
      new Request(`${PATRONS}/v1/github`, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "sponsorship",
          "X-Hub-Signature-256": await sign(body),
          ...headers,
        },
      }),
      env,
      deps,
    );
  };
  const read = async () => {
    const r = await patrons(new Request(`${PATRONS}/v1/roll`), env, deps);
    expect(r.status).toBe(200);
    return JSON.parse(await r.text());
  };
  return {
    db,
    env,
    deps,
    send,
    read,
    looked,
    at: (d: string) => {
      now = new Date(d);
    },
  };
}
test("the house opens empty", async () => {
  expect(await fixture().read()).toEqual({
    version: 1,
    updated: "2026-10-02T00:00:00.000Z",
    benefactors: [],
    patrons: [],
    friends: [],
    private: 0,
  });
});
test("each level takes the tiers' prices, custom amounts included", () => {
  expect([1, 5, 9, 10, 24, 25, 500].map(level)).toEqual([
    "friends",
    "friends",
    "friends",
    "patrons",
    "patrons",
    "benefactors",
    "benefactors",
  ]);
});
test("public names by level, alphabetical; private sponsors counted, never named or stored", async () => {
  const f = fixture({ zed: "Zed Zimmer" });
  for (const e of [
    sponsorship("created", { login: "ada", name: "Ada Lovelace", dollars: 25 }),
    sponsorship("created", { login: "zed", dollars: 10 }),
    sponsorship("created", { login: "bea", name: "bea", dollars: 10 }),
    sponsorship("created", { login: "cy", dollars: 5 }),
    sponsorship("created", { login: "shy", name: "Shy Person", privacy: "private" }),
  ]) {
    expect((await f.send(e)).status).toBe(204);
  }
  const r = await f.read();
  expect(r).toMatchObject({
    benefactors: ["Ada Lovelace"],
    patrons: ["bea", "Zed Zimmer"],
    friends: ["cy"],
    private: 1,
  });
  expect(f.looked).toEqual(["zed", "cy"]);
  const stored = JSON.stringify(f.db.query("SELECT * FROM patrons").all());
  for (const login of ["ada", "zed", "shy", "Shy Person"])
    expect(stored).not.toContain(`"${login}"`);
  expect(stored).not.toContain("Shy");
});
test("a tier change moves a sponsor, going private hides them, and a cancellation removes them", async () => {
  const f = fixture();
  await f.send(sponsorship("created", { name: "Ada", dollars: 5 }));
  await f.send(sponsorship("tier_changed", { name: "Ada", dollars: 25 }));
  expect((await f.read()).benefactors).toEqual(["Ada"]);
  await f.send(sponsorship("pending_cancellation", { name: "Ada", dollars: 25 }));
  expect((await f.read()).benefactors).toEqual(["Ada"]);
  await f.send(sponsorship("edited", { name: "Ada", dollars: 25, privacy: "private" }));
  expect(await f.read()).toMatchObject({ benefactors: [], private: 1 });
  await f.send(sponsorship("cancelled", { dollars: 25, privacy: "private" }));
  expect(await f.read()).toMatchObject({ benefactors: [], private: 0 });
  expect(f.db.query("SELECT * FROM patrons").all()).toEqual([]);
});
test("a one-time gift stays in the program for a year, then leaves the table", async () => {
  const f = fixture();
  await f.send(
    sponsorship("created", { name: "Once", dollars: 50, oneTime: true, day: "2026-10-01" }),
  );
  f.at("2027-10-01T00:00:00Z");
  expect((await f.read()).benefactors).toEqual(["Once"]);
  f.at("2027-10-02T00:00:00Z");
  expect((await f.read()).benefactors).toEqual([]);
  await expirePatrons(f.env.DB, new Date("2027-10-02T00:00:00Z"));
  expect(f.db.query("SELECT * FROM patrons").all()).toEqual([]);
});
test("only a signed event for this listing is recorded", async () => {
  const f = fixture();
  const e = sponsorship("created", { name: "Mallory" });
  const body = JSON.stringify(e);
  const post = (headers: Record<string, string>, b = body) =>
    patrons(
      new Request(`${PATRONS}/v1/github`, {
        method: "POST",
        body: b,
        headers: { "X-GitHub-Event": "sponsorship", ...headers },
      }),
      f.env,
      f.deps,
    );
  expect((await post({})).status).toBe(401);
  expect((await post({ "X-Hub-Signature-256": await sign(body, "b".repeat(64)) })).status).toBe(
    401,
  );
  expect((await post({ "X-Hub-Signature-256": await sign(body) }, body + " ")).status).toBe(401);
  expect(
    (await f.send(sponsorship("created", { name: "Elsewhere", sponsorable: "someone-else" })))
      .status,
  ).toBe(204);
  expect(
    (await f.send({ zen: "Keep it logically awesome." }, { "X-GitHub-Event": "ping" })).status,
  ).toBe(204);
  expect((await f.send(sponsorship("created", { login: "bad login!" }))).status).toBe(204);
  expect(
    (await f.send(sponsorship("created", { name: "Ada" }), { "X-GitHub-Event": "issues" })).status,
  ).toBe(204);
  expect(await f.read()).toMatchObject({ benefactors: [], patrons: [], friends: [], private: 0 });
  const huge = "x".repeat(MAX_EVENT + 1);
  expect((await post({ "X-Hub-Signature-256": await sign(huge) }, huge)).status).toBe(413);
});
test("a switch, no secret, and nothing else on the host", async () => {
  const f = fixture();
  f.env.PATRONS_WEBHOOK_SECRET = undefined;
  expect((await f.send(sponsorship("created"))).status).toBe(503);
  f.env.PATRONS_WEBHOOK_SECRET = SECRET;
  f.env.PATRONS_ENABLED = "false";
  expect((await f.send(sponsorship("created"))).status).toBe(503);
  expect((await patrons(new Request(`${PATRONS}/v1/roll`), f.env, f.deps)).status).toBe(503);
  f.env.PATRONS_ENABLED = "true";
  for (const [path, method] of [
    ["/v1/roll?all=1", "GET"],
    ["/v1/roll", "POST"],
    ["/v1/github", "GET"],
    ["/admin", "GET"],
    ["/", "GET"],
  ]) {
    expect((await patrons(new Request(PATRONS + path, { method }), f.env, f.deps)).status).toBe(
      404,
    );
  }
  const r = await patrons(new Request(`${PATRONS}/v1/roll`), f.env, f.deps);
  expect(r.headers.get("Cache-Control")).toBe("public, max-age=300");
});
test("names are printable and bounded", async () => {
  expect(cleanName("  Ada\u202E  Lovelace\n")).toBe("Ada Lovelace");
  expect(cleanName("x".repeat(101))).toBeNull();
  expect(cleanName("\u200B")).toBeNull();
  const fetcher = (async (url: string) => {
    expect(url).toBe("https://api.github.com/users/ada");
    return new Response(JSON.stringify({ name: " Ada " }));
  }) as unknown as typeof fetch;
  expect(await githubName("ada", fetcher)).toBe("Ada");
  expect(
    await githubName(
      "ada",
      (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    ),
  ).toBeNull();
});
