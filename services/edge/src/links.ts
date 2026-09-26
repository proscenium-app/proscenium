// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { GITHUB, released, response } from "./updates";
export const GO = "https://go.proscenium.ink";
export function links(request: Request, env: { LINKS_ENABLED: string; RELEASED_VERSIONS_JSON: string }): Response {
  const url = new URL(request.url);
  if (url.origin !== GO || request.method !== "GET" || url.search) return response(404);
  let destination: string | undefined;
  if (url.pathname === "/releases") destination = GITHUB;
  if (url.pathname === "/license") destination = "https://www.gnu.org/licenses/agpl-3.0.html";
  if (url.pathname === "/privacy") destination = "https://proscenium.ink/privacy";
  if (url.pathname === "/support") destination = "https://proscenium.ink/support";
  const version = /^\/releases\/v([^/]+)$/.exec(url.pathname)?.[1];
  try { if (version && released(env, version)) destination = `${GITHUB}/tag/v${version}`; } catch { return response(503); }
  if (!destination) return response(404);
  return env.LINKS_ENABLED === "true" ? response(302, null, { Location: destination, "Referrer-Policy": "no-referrer" }) : response(503);
}
