// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The same pre-image rule for open scripts and closed documents (docs/app/keeping-work/storage-and-file-format.md#STOR-119). */
export async function revertReviewedFile(args: {
  afterHash: string;
  before: string;
  read(): Promise<{ content: string; hash: string }>;
  pin(content: string): Promise<unknown>;
  /** A live buffer or workspace may change while the pre-image is saved. */
  stillReviewed(): boolean;
  write(content: string, expected: string): Promise<boolean>;
}): Promise<"saved" | "changed" | "unpreserved" | "refused"> {
  const current = await args.read();
  if (current.hash !== args.afterHash || !args.stillReviewed()) return "changed";
  try {
    await args.pin(current.content);
  } catch {
    return "unpreserved";
  }
  if (!args.stillReviewed()) return "changed";
  return await args.write(args.before, current.hash) ? "saved" : "refused";
}
