// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  settleQuitDocuments,
  settleWorkspaceDocuments,
  type MaterialSettlement,
} from "./workspace-transition";

const empty = (): MaterialSettlement => ({ unsavedKeys: [], lostTitles: [], remaining: [] });

describe("workspace transition settlement", () => {
  it("waits for sheet writes before settling outline notes and the script", async () => {
    const order: string[] = [];
    let finish!: (value: MaterialSettlement) => void;
    const transition = settleWorkspaceDocuments({
      materials: () => {
        order.push("sheets");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      outline: {
        hasUnsaved: () => false,
        path: () => "Notes/Outline.md",
        settle: async () => {
          order.push("outline");
          return "landed";
        },
      },
      script: async () => {
        order.push("script");
        return { safe: true, message: null };
      },
    });
    await Promise.resolve();
    expect(order).toEqual(["sheets"]);
    finish(empty());
    expect((await transition).held).toEqual([]);
    expect(order).toEqual(["sheets", "outline", "script"]);
  });

  it("holds every document whose words reached neither disk nor preservation", async () => {
    const result = await settleWorkspaceDocuments({
      materials: async () => ({ ...empty(), unsavedKeys: ["sheet:mara"], lostTitles: ["Mara"] }),
      outline: {
        hasUnsaved: () => true,
        path: () => "Notes/Outline.md",
        settle: async () => "lost",
      },
      script: async () => ({ safe: false, title: "Draft", why: "not-kept", recovered: false }),
    });
    expect(result.held).toEqual(["Draft", "Mara", "Outline notes"]);
    expect([...result.unsavedKeys]).toEqual(["sheet:mara", "outline"]);
  });

  it("allows a script held in recovery to leave without hiding its preservation failure", async () => {
    const script = { safe: false, title: "Draft", why: "still-changing", recovered: true } as const;
    const result = await settleWorkspaceDocuments({
      materials: async () => empty(),
      outline: {
        hasUnsaved: () => false,
        path: () => "Notes/Outline.md",
        settle: async () => "landed",
      },
      script: async () => script,
    });
    expect(result.held).toEqual([]);
    expect(result.script).toBe(script);
  });

  it("keeps quit accounting distinct from clearing buffers, including an unwritable first outline", async () => {
    let quitting: boolean | undefined;
    const sheet = {
      key: "sheet:mara",
      kind: "document",
      title: "Mara",
      path: "Characters/Mara.md",
      inVersions: true,
    } as const;
    const saved = { ...empty(), remaining: [sheet] };
    const documents = await settleQuitDocuments({
      materials: async () => saved,
      outline: {
        hasUnsaved: () => true,
        path: () => "Notes/Outline.md",
        settle: async (quit) => {
          quitting = quit;
          return "lost";
        },
      },
    });
    expect(quitting).toBe(true);
    expect(saved.remaining).toEqual([sheet]);
    expect(documents).toEqual([
      sheet,
      {
        key: "outline",
        kind: "outline",
        title: "Outline notes",
        path: "Notes/Outline.md",
        inVersions: false,
      },
    ]);
  });

  it("quits a clean workspace without manufacturing an outline preservation task", async () => {
    let calls = 0;
    const result = await settleQuitDocuments({
      materials: async () => empty(),
      outline: {
        hasUnsaved: () => false,
        path: () => "Notes/Outline.md",
        settle: async () => {
          calls++;
          return "lost";
        },
      },
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });
});
