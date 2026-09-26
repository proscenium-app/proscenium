# Maintaining these docs

[Engineering](README.md) › Documentation

## Structure

The main index leads to product areas, then features. Each area has a short
README that explains its scope and links directly to feature contracts.
Feature pages begin with a brief explanation and a route back to their area.
Requirements state the contract; Design explains its mechanism.

Keep the detail needed to change the app: behavior, data models, failure cases,
acceptance criteria and design rationale. The public repository carries that
same depth for contributors and their coding agents. Moving private operational
material out of the public tree must not remove the reasoning needed to build it.

Architecture and shared implementation references live in `docs/engineering/`.
The website's Guide owns writer-facing tutorials and is maintained separately.

`docs/site-privacy.md` retains its location and exact copy because the website
build reads it.

## Permanent ids

Requirements use `PREFIX-number`, for example `STOR-12`. The
[allocation register](requirement-register.md) reserves every number. Its
meaning never changes. Add the next unused id for a new obligation. Mark a
replaced obligation **Withdrawn**, keep its anchor and name its replacement.
Never renumber for presentation, delete an allocated id or reuse one.

`PREFIX-Dnumber` anchors identify retained sections, including schemas and
algorithms. They survive heading edits and moves. An existing prefix stays
attached when a section changes domain. Backlog and review findings retain
their original ids too.

## Citations and moves

Source comments and tests cite the repository-relative path and stable id:
`docs/app/keeping-work/storage-and-file-format.md#STOR-12`. Use a section id
when the whole section governs behavior. Name every target explicitly; no
bare section numbers, document nicknames or compressed id lists. Markdown links
use relative paths with the same anchors. Whole-document links may omit them.

When moving a document, update links, code citations and tooling that reads it.
Retain requirement meanings and anchors. Literal historical paths in records
describe their recorded checkout; clickable links still need to work today.

`bun run check:docs` checks references, permanent ids, the contract shape and
reachability from the main index. A document can be reached through an area
index; the front page does not list every file. Images must be
embedded in a reachable document. Source and document changes also keep the
repository's other applicable checks green.
