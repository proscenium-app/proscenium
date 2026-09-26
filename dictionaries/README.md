# dictionaries/

The word list the spell checker runs on (`src/spell/dictionary.ts`,
editor-ux.md §"Spell check"). Checked in rather than resolved from
`node_modules` at build time, for the same reason `formats/*.json` are: the
exact data the app ships is a reviewable file, and a build does not depend on a
version range re-resolving the same way twice.

| File      | What it is                                                     |
| --------- | -------------------------------------------------------------- |
| `en.dic`  | The words, with their affix flags (hunspell format).             |
| `en.aff`  | The affix rules those flags refer to — plurals, `-ing`, `-'s`.   |
| `LICENSE` | The upstream license (MIT AND BSD). Travels with the data.       |
| `en-GB.dic`, `en-GB.aff` | British English words and affix rules. |
| `LICENSE-en-GB` | British dictionary's upstream license. |

Source: the [`dictionary-en`](https://github.com/wooorm/dictionaries) package,
and `dictionary-en-gb` (pinned to 3.0.0), kept as devDependencies purely so the
copy is repeatable. To take newer versions:

```bash
bun update dictionary-en dictionary-en-gb && bun run dict:sync
```

The play language chooses American or British spelling. Other languages have
no bundled checker; they are never checked against American English by default.
`src/spell/stage-words.ts` adds theatre vocabulary to both dictionaries.
Add stage words there, not here: these files are upstream data and get
overwritten by the sync. Both dictionaries load locally and are cached
separately; no dictionary lookup leaves the app.
