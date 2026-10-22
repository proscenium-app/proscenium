// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { GITHUB, releasedOn, response, type Source } from "./updates";
export const GO = "https://go.proscenium.ink";
/**
 * Where a beta's notes are: the Guide's What's new page, at the section that
 * lists the beta that is out (docs/engineering/services-and-feedback.md#SERV-281).
 * One address for every beta: the section is always the beta that is out.
 */
export const BETA_NOTES = "https://docs.proscenium.ink/whats-new#beta";
export async function links(
  request: Request,
  env: { LINKS_ENABLED: string; RELEASED_VERSIONS_JSON: string },
  source: Source,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== GO || request.method !== "GET" || url.search) return response(404);
  let destination: string | undefined;
  if (url.pathname === "/releases") destination = GITHUB;
  if (url.pathname === "/license") destination = "https://www.gnu.org/licenses/agpl-3.0.html";
  if (url.pathname === "/privacy") destination = "https://proscenium.ink/privacy";
  if (url.pathname === "/support") destination = "https://proscenium.ink/support";
  const version = /^\/releases\/v([^/]+)$/.exec(url.pathname)?.[1];
  try {
    // A release's page is GitHub's, which holds releases alone, so a published beta's notes are
    // the Guide's. An alpha has neither. A halted version keeps its notes.
    const channel = version ? await releasedOn(env, source, version, ["stable", "beta"]) : null;
    if (channel === "stable") destination = `${GITHUB}/tag/v${version}`;
    if (channel === "beta") destination = BETA_NOTES;
  } catch {
    return response(503);
  }
  if (!destination) return response(404);
  return env.LINKS_ENABLED === "true"
    ? response(302, null, { Location: destination, "Referrer-Policy": "no-referrer" })
    : response(503);
}
