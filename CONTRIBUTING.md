# Contributing

## Use of coding agents

As of 2026-06-23, the project is ≥ 85% written by Claude Cowork (Opus 4.8). Hence pull requests containing AI-generated code are totally welcome.

## Running it

It is a static site with **no build step** — open `index.html` in a browser, or
serve the folder:

```sh
python3 -m http.server   # then visit http://localhost:8000
```

Every browser dependency is a plain `<script>`/`<link>` in `index.html` (THREE.js
from a CDN, the local theory modules, and the data table). The theory modules are
UMD: the same files run in the browser (attached to the global scope) and under
Node (via `require`), so the test suite exercises exactly the code the page runs.

## Project layout

| File | Responsibility |
| ---- | -------------- |
| `theory-pitchclass.js` | Pure pitch-class (0–11) arithmetic: intervals, the chromatic / circle-of-fifths ring, voice-leading connections, the default-key heuristic (`bestMajorTonic`). Depends on nothing. |
| `theory-chordname.js` | Chord symbols & note spelling: `parseChord`, `describe` (its inverse), the line-of-fifths spelling window, transposition (`transposeProgression`), key spelling (`majorKeyName`), and the bare-symbol convention (`setTetradShorthand`). Depends on nothing. |
| `theory-roman.js` | Relative ↔ absolute conversion: `chordToAbsolute`, `chordToRelative`, and the "curly-brace relative" progression syntax. Builds on `theory-chordname.js`. |
| `soundquest-data.js` | The SoundQuest coloring ground truth (Roman symbol → category), and the builders that resolve it to a pitch-class-set → category lookup. |
| `main.js` | Rendering and UI: the THREE.js scene and orbit controls, the chord chips, the coloring schemes, Roman-numeral mode, the tonnetz / axis-system panel, transpose, and URL state. |
| `style.css`, `musical-colors.css` | Styling; the latter holds the color custom properties and the accessible palette. |
| `index.html` | Wires it together (loads the theory modules and `soundquest-data.js` before `main.js`). |
| `test/` | Tests for Node's built-in runner — see below. |

`main.js` is the only file that touches the DOM/THREE; all music theory lives in
the (DOM-free, individually testable) `theory-*.js` and `soundquest-data.js`.

## Tests

```sh
node --test          # or: npm test
```

Tests live in `test/` and need no dependencies — only Node ≥ 18.

| File | Covers |
| ---- | ------ |
| `theory-pitchclass.test.js` | Ring arrangement, voice-leading, harmonic-function grouping, `bestMajorTonic`. |
| `theory-chordname.test.js` | Spelling, `describe` ↔ `parseChord` round-trips (exhaustive over **all** 0–11-note sets, both conventions), `N.C.`, transposition, the tetrad convention. |
| `theory-roman.test.js` | Roman → absolute, absolute → Roman, round-trips, curly-brace relative. |
| `soundquest.test.js` | The SoundQuest table parses, its pc-set lookup, and the multi-color chords. |
| `theory-chordname-khufrudamonotes.test.js` | Conformance with the suffixes parsable by o-to.khufrudamonotes.com (`khufrudamonotes.txt`), each checked against its pitch-class bitmask. |

Many tests are written as plain tables so anyone who knows music theory can verify
them at a glance:

```js
["G7", "G B D F"],
["Fm", "F A♭ C"],
["F♯+", "F♯ A♯ Cx"],
```

When you change spelling, parsing, or the coloring data, run the suite — the
round-trip and conformance tests are the safety net for the theory layer.

Tests of great importance include `parseChord(describe(notes))` always yielding
  the notes you started with (so you can edit a chip and convert back).

## Enforcement

**Pre-commit hook** (`.githooks/pre-commit`) runs the tests and a syntax check,
and blocks the commit on failure. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

(`npm install` does this automatically via the `prepare` script.)

**GitHub Actions** (`.github/workflows/ci.yml`) runs the tests on every push and
pull request to `main`.

## Publishing to GitHub Pages

`.github/workflows/pages.yml` deploys the site after tests pass. In the repo, go
to **Settings → Pages → Build and deployment → Source: "GitHub Actions"**. The
site is plain static files at the repo root, so it works as-is.

## Formatting

Prettier is provided as optional tooling (config in `.prettierrc.json`, 4-space
indent). It is **not** enforced by CI, so format whenever you like:

```sh
npm install     # installs Prettier (the only dev dependency)
npm run format  # apply  /  npm run format:check  to verify
```

## A few conventions worth knowing

- **Spelling is line-of-fifths based.** A chord carries a `fifthStart` window that
  fixes how its pitch classes are spelled; `bestFifthStart` auto-fits it. Prefer
  working in pitch classes and spelling at the edges.
- **`describe` must stay injective.** It round-trips every representable set; the
  exhaustive test enforces this. If you touch quality tokens or the fallback, keep
  it green.
- **Coloring data is ground truth, not rules.** `soundquest-data.js` is
  transcribed from a reference; coloring is by pitch-class set relative to the
  tonic (enharmonics merged), so several symbols can share one color cell.
- Commits are expected to pass the hook.
