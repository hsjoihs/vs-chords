## Running it

It is a static site — open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server   # then visit http://localhost:8000
```

## Project layout

| File         | Responsibility                                                        |
| ------------ | --------------------------------------------------------------------- |
| `theory-pitchclass.js` | Pure pitch-class (0–11) arithmetic: intervals, the chromatic/circle-of-fifths ring, voice-leading connections. |
| `theory-chordname.js`  | Chord symbols & note spelling: `parseChord`, `describe`, the line-of-fifths window. Builds on nothing else. |
| `theory-roman.js`      | Roman-numeral (relative) → absolute conversion, including the "curly-brace relative" progression syntax. Builds on `theory-chordname.js`. |
| `main.js`    | Rendering and UI (THREE.js scene, orbit controls, the chord chip).   |
| `style.css`  | Styling.                                                              |
| `index.html` | Wires it together (loads the three `theory-*.js` modules before `main.js`). |
| `test/`      | Parser tests for Node's built‑in runner (one file per theory module). |

The theory modules are independent except that `theory-roman.js` depends on
`theory-chordname.js`. The app uses all three: the progression input box accepts
"curly-brace relative" notation (e.g. `C {V7 → i=} Am`), which `theory-roman.js`
expands into absolute chords before the rest of the pipeline runs.


## Tests

```sh
node --test          # or: npm test
```

Tests live in `test/theory-*.test.js` and are written as plain tables so anyone
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
