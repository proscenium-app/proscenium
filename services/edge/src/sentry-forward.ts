// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Raw TLS avoids the visitor-address headers Cloudflare can add to fetch subrequests. */
export interface Connection {
  readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>; close(): Promise<void>;
}
export type Connect = (address: { hostname: string; port: number }, options: { secureTransport: "on" }) => Connection;
const encoder = new TextEncoder();
function destination(dsn: string): { host: string; project: string; key: string } {
  const url = new URL(dsn);
  if (url.protocol !== "https:" || url.port || url.password || url.search || url.hash
    || !/^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/.test(url.hostname)
    || !/^[a-f0-9]{32}$/.test(url.username) || !/^\/[1-9]\d{0,19}$/.test(url.pathname)) throw new Error("Invalid forwarding configuration");
  return { host: url.hostname, project: url.pathname.slice(1), key: url.username };
}
export async function forward(bytes: Uint8Array, dsn: string, connect: Connect): Promise<number> {
  const target = destination(dsn);
  const socket = connect({ hostname: target.host, port: 443 }, { secureTransport: "on" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = (async () => {
    await socket.opened;
    const writer = socket.writable.getWriter();
    // Complete header set. No Request object or visitor metadata reaches here.
    const head = `POST /api/${target.project}/envelope/ HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/x-sentry-envelope\r\nContent-Length: ${bytes.byteLength}\r\nX-Sentry-Auth: Sentry sentry_version=7,sentry_key=${target.key}\r\nConnection: close\r\n\r\n`;
    await writer.write(encoder.encode(head)); await writer.write(bytes); writer.releaseLock();
    const reader = socket.readable.getReader(); let header = "";
    try {
      while (!header.includes("\r\n\r\n")) {
        const chunk = await reader.read(); if (chunk.done) throw new Error("Incomplete upstream receipt");
        header += new TextDecoder().decode(chunk.value);
        if (header.length > 16 * 1024) throw new Error("Oversize upstream receipt");
      }
      const status = /^HTTP\/1\.[01] ([1-5]\d\d) [^\r\n]*\r\n/.exec(header)?.[1];
      if (!status || Number(status) < 200) throw new Error("Invalid upstream receipt");
      return Number(status);
    } finally { reader.releaseLock(); }
  })();
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void socket.close().catch(() => {}); reject(new Error("Forwarding timed out")); }, 8000);
    })]);
  } finally { clearTimeout(timer); await socket.close().catch(() => {}); }
}
