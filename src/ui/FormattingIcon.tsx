// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type SymbolName = "bold" | "italic" | "underline";
let symbols: Promise<Partial<Record<SymbolName, string>>> | undefined;
const load = (): Promise<Partial<Record<SymbolName, string>>> =>
  (symbols ??= isTauri()
    ? invoke<Partial<Record<SymbolName, string>>>("formatting_symbols").catch(() => ({}))
    : Promise.resolve({}));

/** Native macOS SF Symbols, with a consistent vector fallback for other hosts. */
export function FormattingIcon({ name }: { name: SymbolName }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    void load().then((icons) => {
      if (live) setUrl(icons[name]);
    });
    return () => {
      live = false;
    };
  }, [name]);
  if (url)
    return (
      <span
        className="formatting-icon"
        aria-hidden="true"
        data-system-symbol={name}
        style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }}
      />
    );
  return (
    <svg
      className="formatting-icon"
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "bold" ? (
        <path d="M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6h5.5a3 3 0 0 1 0 6H6v-6Z" />
      ) : name === "italic" ? (
        <path d="M9 4h6M5 16h6M12 4 8 16" />
      ) : (
        <path d="M6 4v6a4 4 0 0 0 8 0V4M5 17h10" />
      )}
    </svg>
  );
}
