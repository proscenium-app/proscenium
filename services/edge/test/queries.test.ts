// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
const db = new Database(":memory:");
for (const name of ["0001_updates.sql", "0002_feedback.sql", "0003_usage.sql", "0004_feedback_list.sql"]) db.exec(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text());
const queries = new Map<string,string>();
for(const name of ["update-use","downloads","feature-share","daily-volume","feedback-counts","feedback-receipts","feedback-list"]) queries.set(name,await Bun.file(new URL(`../queries/${name}.sql`,import.meta.url)).text());
function query(name:string,...params:string[]):Record<string,unknown>[] { return db.query(queries.get(name)!).all(...params) as Record<string,unknown>[]; }
test("the scheduled jobs' queries respect UTC boundaries and denominators; zero is different from unavailable",()=>{
  db.run("INSERT INTO usage_counts VALUES ('2026-09-17','1.0.0','darwin','aarch64','15.6','developer-id','app_launched','{}',10)");
  db.run(`INSERT INTO usage_counts VALUES ('2026-09-17','1.0.0','darwin','aarch64','15.6','developer-id','surface_shown','{"surface":"board"}',4)`);
  db.run("INSERT INTO usage_counts VALUES ('2026-09-17','1.0.0','darwin','aarch64','15.6','app-store','format_saved','{}',2)");
  db.run("INSERT INTO usage_counts VALUES ('2026-09-18','1.0.0','darwin','aarch64','15.6','developer-id','app_launched','{}',100)");
  db.run("INSERT INTO update_counts VALUES ('2026-09-17','check','darwin','aarch64','1.0.0','15.6',12)");
  db.run("INSERT INTO update_counts VALUES ('2026-09-17','download','','','1.0.0','',3)");
  const rows=query("feature-share","2026-09-17","2026-09-18");
  expect(rows.find(r=>r.event==="surface_shown")).toEqual({channel:"developer-id",event:"surface_shown",props:'{"surface":"board"}',actions:4,launches:10,actions_per_100_launches:40});
  expect(rows.find(r=>r.channel==="app-store")?.actions_per_100_launches).toBeNull();
  expect(query("update-use","2026-09-17","2026-09-18")[0].checks).toBe(12);
  expect(query("downloads","2026-09-17","2026-09-18")[0].download_requests).toBe(3);
});
test("feedback counts and receipts hold no words; the private list pages completed days without repeating a cursor",()=>{
  db.run("INSERT INTO feedback_messages VALUES ('a','Private words','writer@example.org','Details','2026-09-17')");
  db.run("INSERT INTO feedback_messages VALUES ('b','More words',NULL,NULL,'2026-09-17')");
  db.run("INSERT INTO feedback_messages VALUES ('c','Arrived today',NULL,NULL,'2026-09-18')");
  expect(query("feedback-counts","2026-09-17","2026-09-18")).toEqual([{day:"2026-09-17",messages:2}]);
  const receipts=query("feedback-receipts","2026-09-17","2026-09-19");
  expect(receipts).toEqual([
    {day:"2026-09-17",id:"a",characters:13,with_email:1,with_details:1},
    {day:"2026-09-17",id:"b",characters:10,with_email:0,with_details:0},
    {day:"2026-09-18",id:"c",characters:13,with_email:0,with_details:0},
  ]);
  expect(JSON.stringify(receipts)).not.toMatch(/words|writer@|Details|Arrived/);
  expect(query("feedback-list","","","2026-09-18")).toEqual([
    {id:"a",received_day:"2026-09-17",message:"Private words",email:"writer@example.org",details:"Details"},
    {id:"b",received_day:"2026-09-17",message:"More words",email:null,details:null},
  ]);
  expect(query("feedback-list","2026-09-17","a","2026-09-18").map(r=>r.id)).toEqual(["b"]);
  expect(query("feedback-list","2026-09-17","b","2026-09-18")).toHaveLength(0);
  expect(query("feedback-list","2026-09-17","b","2026-09-19").map(r=>r.id)).toEqual(["c"]);
  expect(query("daily-volume","2026-09-17","2026-09-18").find(r=>r.metric==="feedback")?.total).toBe(2);
  db.exec("PRAGMA query_only = ON");
  for(const [name,sql] of queries) expect(()=>db.query(sql).all(...(name==="feedback-list"?["","","2026-09-18"]:["2026-09-17","2026-09-18"]))).not.toThrow();
});
