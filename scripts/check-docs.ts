// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Documentation references are paths with real anchors, never mutable section numbers. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, basename, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export function anchors(markdown: string): Set<string> {
  const ids = new Set<string>();
  const used = new Map<string, number>();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of line.matchAll(/<a\s+id="([^"]+)"\s*><\/a>/g)) ids.add(m[1]);
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const slug = heading[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const n = used.get(slug) ?? 0;
    ids.add(n ? `${slug}-${n}` : slug); used.set(slug, n + 1);
  }
  return ids;
}

export function checkReference(root: string, source: string, reference: string): string | undefined {
  const [file, ...fragments] = reference.split('#');
  const fragment = fragments.join('#');
  const target = !file ? resolve(root, source) : file.startsWith('docs/') || /^(?:DESIGN|PRODUCT|RELEASING|CONTRIBUTING|AGENTS|CLAUDE|CHANGELOG|CLA|SECURITY|TRADEMARK)\.md$/.test(file) || file.startsWith('formats/')
    ? resolve(root, file) : resolve(root, dirname(source), file);
  if (!existsSync(target) || !statSync(target).isFile()) return `missing document ${file}`;
  if (fragment) {
    let id: string;
    try { id = decodeURIComponent(fragment); } catch { return `malformed anchor ${reference}`; }
    if (!anchors(readFileSync(target, 'utf8')).has(id)) return `missing anchor ${reference}`;
  }
}

/** Check every allocated number, including explicit withdrawals in records. */
export function missingAllocatedIds(register: string, definitions: Set<string>): string[] {
  const missing: string[] = [];
  for (const row of register.matchAll(/^\| ([A-Z][A-Z0-9]*) \| (\d+) \| (\d+) \|(?: <!-- private -->)?$/gm)) {
    for (let n = Number(row[2]); n <= Number(row[3]); n++) {
      const id = `${row[1]}-${n}`;
      if (!definitions.has(id)) missing.push(`allocated id ${id} was removed; retain a withdrawal anchor`);
    }
  }
  return missing;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Follow the reading hierarchy; a page need not be listed on the front page. */
export function reachableDocumentation(documents: ReadonlyMap<string, string>): Set<string> {
  const reached = new Set<string>();
  const pending = ['docs/README.md'];
  while (pending.length) {
    const path = pending.pop()!;
    if (reached.has(path) || !documents.has(path)) continue;
    reached.add(path);
    let fenced = false;
    for (const line of documents.get(path)!.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      for (const match of line.matchAll(/\]\(([^\s)]+)\)/g)) {
        const file = match[1].split('#')[0];
        if (!file || /^(?:[a-z]+:|~\/|\/)/i.test(file)) continue;
        const target = posix.normalize(file.startsWith('docs/') ? file : posix.join(posix.dirname(path), file));
        if (target.startsWith('docs/') && documents.has(target)) pending.push(target);
      }
    }
  }
  return reached;
}

function files(): string[] {
  return [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: ROOT, encoding: 'utf8'}).split('\0').filter(Boolean))]
    .filter(p => existsSync(resolve(ROOT, p)) && statSync(resolve(ROOT, p)).isFile());
}

export function checkTree(): string[] {
  const failures: string[] = [];
  const paths = files();
  const ids = new Map<string, string>();
  const allDefinitions = new Set<string>();
  const basenames = new Set(paths.filter(p => p.startsWith('docs/') && p.endsWith('.md')).map(p => basename(p)));
  let references = 0;
  for (const path of paths) {
    if (!/^(src\/|src-tauri\/src\/|scripts\/|services\/|\.github\/)|\.md$/.test(path)) continue;
    // Records quote historical paths and claims. Literal historical paths are
    // evidence, while clickable Markdown links must still reach their targets.
    if (path === 'scripts/check-docs.test.ts') continue;
    const bytes = readFileSync(resolve(ROOT, path));
    if (bytes.includes(0)) continue;
    const content = bytes.toString();
    if (path.endsWith('.md')) for (const id of anchors(content)) allDefinitions.add(id);
    if (path.startsWith('docs/backstage/records/') || path === 'docs/engineering/withdrawn-requirements.md') {
      for (const [i, line] of content.split('\n').entries()) {
        for (const m of line.matchAll(/\]\(([^\s)]+\.md(?:#[^\s)]+)?|#[^\s)]+)\)/g)) {
          if (/^(https?:|~\/)/.test(m[1])) continue;
          references++;
          const problem = checkReference(ROOT, path, m[1]);
          if (problem) failures.push(`${path}:${i + 1}: ${problem}`);
        }
      }
      continue;
    }
    const source = /^(src\/|src-tauri\/src\/|scripts\/|services\/|\.github\/)/.test(path);
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const fail = (message: string) => failures.push(`${path}:${i + 1}: ${message}`);
      if (source && path !== 'scripts/check-docs.ts' && /§/.test(line) && !/AGPL|[Ll]icense|app.store permission|ISO 32000|CSS 2.1/.test(line)) fail('section-number citation; use docs/<domain>.md#<stable-id>');
      if (source && path !== 'scripts/check-docs.ts' && /\bI[1-8]\b|\blaunch-plan (?:human|rule|Wave)/.test(line)) fail('shorthand citation; use the full document path and stable id');
      const refs = new Set<string>();
      for (const m of line.matchAll(/\b(?:docs\/[A-Za-z0-9_./-]+|DESIGN|PRODUCT|RELEASING|CONTRIBUTING|AGENTS|CLAUDE|CHANGELOG|CLA|SECURITY|TRADEMARK|formats\/README)\.md(?:#[A-Za-z0-9_%#./–—-]+)?/g)) refs.add(m[0].replace(/[.,;–—]+$/, ''));
      if (source && !path.endsWith('.md') && path !== 'scripts/check-docs.ts') {
        for (const m of line.matchAll(/(?<![\w./-])([a-z][a-z0-9-]+\.md)(?:#[\w.-]+)?/g)) {
          if (basenames.has(m[1])) fail(`bare document ${m[1]}; use its repository-relative path`);
        }
        const prose = line.replace(/docs\/[\w./-]+\.md#[\w-]+/g, '');
        if (!prose.includes('<a id=') && /\b(?:A[1-8]-\d{2}|(?:STOR|PRIV|EDIT|COMM|WORK|FMT|SET|IMPT|PLAT|SERV|UI|A11Y|PROD|TUT|REL|BKL|CICD)-(?:D)?\d+)\b/.test(prose)) fail('bare id citation; include the document path');
      }
      if (path.endsWith('.md')) {
        for (const m of line.matchAll(/\]\(([^\s)]+\.md(?:#[^\s)]+)?)\)/g)) if (!/^(https?:|~\/)/.test(m[1])) refs.add(m[1]);
        for (const m of line.matchAll(/\]\((#[^\s)]+)\)/g)) refs.add(m[1]);
      }
      for (const ref of refs) {
        references++;
        const problem = checkReference(ROOT, path, ref);
        if (problem) fail(problem);
      }
      if (path.endsWith('.md')) {
        for (const m of line.matchAll(/<a\s+id="([A-Z][A-Z0-9]*-(?:D)?\d+[a-z]?)"\s*><\/a>/g)) {
          const prior = ids.get(m[1]);
          if (prior) fail(`duplicate stable id ${m[1]} (also ${prior})`);
          ids.set(m[1], `${path}:${i + 1}`);
        }
      }
    });
  }
  const register = resolve(ROOT, 'docs/engineering/requirement-register.md');
  if (existsSync(register)) failures.push(...missingAllocatedIds(readFileSync(register, 'utf8'), allDefinitions));
  else failures.push('missing requirement allocation register');
  const withdrawals = resolve(ROOT, 'docs/engineering/withdrawn-requirements.md');
  if (existsSync(withdrawals)) for (const id of anchors(readFileSync(withdrawals, 'utf8'))) {
    if (ids.has(id)) failures.push(`${ids.get(id)}: withdrawn id ${id} cannot be reused`);
  }
  // Feature and engineering contracts keep their shape at every folder depth.
  // Indexes, maintenance guides and allocation records have their own purpose.
  const referencePages = new Set(['docs/engineering/documentation.md', 'docs/engineering/requirement-register.md', 'docs/engineering/withdrawn-requirements.md']);
  for (const path of paths.filter(p => p.endsWith('.md') && basename(p) !== 'README.md' && !referencePages.has(p)
    && (/^docs\/(app|engineering)\//.test(p) || (p.startsWith('docs/backstage/') && ['ci-cd-and-update-tracks.md', 'mac-mini-development.md'].includes(basename(p)))))) {
    const content = readFileSync(resolve(ROOT, path), 'utf8');
    const headings = [...content.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    if (headings.join('|') !== 'Requirements|Design') failures.push(`${path}: expected Requirements above Design as the only level-two headings`);
  }
  // An image without a Markdown embedding, or a non-Markdown working paper,
  // does not belong in the documentation tree.
  const markdown = paths.filter(p => p.startsWith('docs/') && p.endsWith('.md'));
  const embedded = new Set<string>();
  for (const path of markdown) for (const m of readFileSync(resolve(ROOT, path), 'utf8').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!/^https?:/.test(m[1])) embedded.add(relative(ROOT, resolve(ROOT, dirname(path), m[1])));
  }
  for (const path of paths.filter(p => p.startsWith('docs/') && !p.endsWith('.md'))) {
    if (!/\.(?:png|jpe?g|svg|webp)$/.test(path)) failures.push(`${path}: documentation must be Markdown`);
    else if (!embedded.has(path)) failures.push(`${path}: image is not embedded by a Markdown document`);
  }
  const documentation = new Map(paths.filter(p => p.startsWith('docs/')).map(p => [p, p.endsWith('.md') ? readFileSync(resolve(ROOT, p), 'utf8') : '']));
  if (!documentation.has('docs/README.md')) failures.push('missing documentation index');
  else {
    const reachable = reachableDocumentation(documentation);
    for (const path of documentation.keys()) if (!reachable.has(path)) failures.push(`${path}: not reachable from docs/README.md`);
  }
  // Repository paths in the agent guide are checked separately from examples
  // of live-vault data, external folders and generated build outputs.
  const agent = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf8');
  for (const m of agent.matchAll(/\b(?:docs|src|src-tauri|scripts|formats|dictionaries|sample-vault|plugins)\/[A-Za-z0-9_./*-]+/g)) {
    const p = m[0].replace(/[.,;:)]+$/, '');
    const base = p.includes('*') ? p.slice(0, p.indexOf('*')) : p;
    if (!existsSync(resolve(ROOT, base))) failures.push(`AGENTS.md: missing repository path ${p}`);
  }
  for (const m of agent.matchAll(/\b[A-Z][A-Z_-]+\.md\b/g)) if (!existsSync(resolve(ROOT, m[0]))) failures.push(`AGENTS.md: missing repository path ${m[0]}`);
  console.log(`check:docs: ${references} references, ${ids.size} stable ids`);
  return failures;
}

if (import.meta.main) {
  const failures = checkTree();
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('check:docs: all documentation references resolve');
}
