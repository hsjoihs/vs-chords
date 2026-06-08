# Cylindrical analysis of chord progressions

A small web app that draws a short chord progression on a 3‑D cylinder. One
octave wraps once around the cylinder (12 semitones = 360°). Each chord is a
ring of vertices joined by **every** interval, the chords stack upward in time,
and dashed lines between layers trace each voice's motion. The classic example,
`G7 → C`, shows the tritone B–F closing inward to the major third C–E — a
quadrilateral (with its diagonals: 4 vertices, 6 segments) collapsing to a
triangle.

## Running it

It is a static site — open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server   # then visit http://localhost:8000
```

Type a progression such as `G7 → C`, `Gm → F♯+ → B♭/F → Eø`, or
`Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C`, or edit each chord on its ring.

### Ring editor

Each chord chip has twelve pitch-class buttons and a spelling slider:

- **Left-click** a button to add or remove that note.
- **Right-click** a button to tag it as the **root** (highlighted green).
  Parsing a chord symbol sets the root automatically.
- **Spelling slider** (_Prefer ♭_ ↔ _Prefer ♯_): the position chooses which
  contiguous length-12 segment of the spiral of fifths is adopted as the circle
  of fifths, which fixes the spelling of all twelve notes. Sliding one notch
  toward the flat side turns, e.g., `E♭ B♭ F C G D A E B F♯ C♯ G♯` into
  `A♭ E♭ B♭ F C G D A E B F♯ C♯`. When you type a chord symbol, the slider is
  auto-set to the segment that best matches the symbol's implied enharmonics
  (so `Fm` lands on a flat segment and shows `A♭`, not `G♯`).

## Project layout

| File         | Responsibility                                                        |
| ------------ | --------------------------------------------------------------------- |
| `theory.js`  | Pure music theory — no DOM, no THREE. Parsing, **spelling**, intervals, voice leading. Loadable as a browser global _and_ a Node module. |
| `main.js`    | Rendering and UI (THREE.js scene, orbit controls, the ring editor).   |
| `style.css`  | Styling.                                                              |
| `index.html` | Wires the three together (loads `theory.js` before `main.js`).        |
| `test/`      | Parser tests for Node's built‑in runner.                              |


## The parser

`theory.js` spells chords by interval quality, not by pitch class, so
enharmonics come out right:

- `Fm` → `F A♭ C` (never `F G♯ C`)
- `F♯+` → `F♯ A♯ Cx` (the augmented fifth above F♯ really is C‑double‑sharp)
- `Cdim7` → `C E♭ G♭ B♭♭` (a true diminished seventh)

Accidental glyphs in output: `♯` sharp, `♭` flat, `x` double‑sharp, `♭♭`
double‑flat. Input accepts ASCII or Unicode (`#`/`♯`, `b`/`♭`, `##`/`x`/`𝄪`,
`bb`/`𝄫`).

Supported: triads (`maj`, `m`, `dim`/`°`, `aug`/`+`, `sus2`, `sus4`, `5`),
sevenths (`7`, `maj7`/`Δ`, `m7`, `m7b5`/`ø`, `dim7`/`°7`, `mMaj7`, `aug7`),
sixths (`6`, `m6`, `6/9`), extensions (`9`, `11`, `13`, `maj9`, `m9`, …),
added tones and parenthetical tensions (`add9`, `(9,13)`, `(b9,13)`, `#11`, …),
omissions (`omit3`, `no5`, `drop9`), and slash chords (`B♭/F`).

## Tests

```sh
node --test          # or: npm test
```

Tests live in `test/theory.test.js` and are written as plain tables so anyone
who knows music theory can verify them at a glance:

```js
["G7", "G B D F"],
["Fm", "F A♭ C"],
["F♯+", "F♯ A♯ Cx"],
```

No dependencies are required to run the tests — only Node ≥ 18.

## Enforcement

**Pre‑commit hook** (`.githooks/pre-commit`) runs the tests and blocks the
commit on failure. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

(`npm install` does this automatically via the `prepare` script.)

**GitHub Actions** (`.github/workflows/ci.yml`) runs the tests on every push and
pull request to `main`.

## Publishing to GitHub Pages

`.github/workflows/pages.yml` deploys the site after tests pass. In the repo,
go to **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
The site is plain static files at the repo root, so it works as‑is.

## Formatting

Prettier is provided as optional tooling (config in `.prettierrc.json`,
4‑space indent). It is **not** enforced by CI, so format whenever you like:

```sh
npm install     # installs Prettier (the only dev dependency)
npm run format  # apply  /  npm run format:check  to verify
```
