// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// WebKit's accessibility tree of the page under test, read through its own Web
// Inspector (docs/app/preferences-and-help/accessibility.md#A11Y-16). This is
// the body of an async function that src-tauri/src/selftest.rs (`selftest_ax`)
// runs in the inspector's frontend page, with `selector` defined before it: the
// element whose subtree is wanted, or "body".
//
// `DOM.getAccessibilityPropertiesForNode` answers from WebKit's
// AccessibilityObject in the page's own web content process, the object its
// NSAccessibility wrapper hands VoiceOver: the role and name WebKit computed,
// the states, the live region, and its accessibility children. Nothing here
// needs a grant: the inspector is the app's own, connected in-process, in a
// self-test build only.
const D = WI.mainTarget.DOMAgent;
const doc = await D.getDocument();
const { nodeId: start } = await D.querySelector(doc.root.nodeId, selector);
if (!start) return JSON.stringify({ error: `nothing matches ${selector}` });

// A toast is timing, not the surface, and its words went through the
// announcer: its subtree is left out, as smoke leaves it out.
const { nodeIds: toasts = [] } = await D.querySelectorAll(doc.root.nodeId, ".toast").catch(() => ({}));
const skip = new Set(toasts);

const decoder = new DOMParser();
const SKIP = new Set(["exists", "label", "role", "nodeId", "childNodeIds", "parentNodeId", "ignored", "ignoredByDefault", "mouseEventNodeId", "focused", "hidden"]);

async function node(id, wantText) {
  if (skip.has(id)) return null;
  const { properties: p } = await D.getAccessibilityPropertiesForNode(id).catch(() => ({ properties: null }));
  if (!p || !p.exists) return null;
  const spoken = p.liveRegionStatus && p.liveRegionStatus !== "off";
  const within = wantText || spoken || p.role === "textbox" || p.role === "searchfield";
  const out = { role: p.role ?? "", label: p.label ?? "" };
  if (p.ignored) out.ignored = true;
  const states = Object.fromEntries(Object.entries(p).filter(([k, v]) => !SKIP.has(k) && v !== false && v !== undefined));
  if (Object.keys(states).length) out.states = states;
  if (p.role === "text" && within) {
    const { outerHTML } = await D.getOuterHTML(id).catch(() => ({ outerHTML: "" }));
    out.text = decoder.parseFromString(`<body>${outerHTML}`, "text/html").body.textContent;
  }
  const children = (await Promise.all((p.childNodeIds ?? []).map((c) => node(c, within)))).filter(Boolean);
  if (children.length) out.children = children;
  return out;
}

return JSON.stringify({ tree: await node(start, false) });
