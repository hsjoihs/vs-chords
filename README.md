# vs.Chords

A multi-purpose web app that helps you win the battle against chord progressions

It is intentionally packed with tons of features, not unlike an [IDE (Integrated development environment)](https://en.wikipedia.org/wiki/Integrated_development_environment).

## Features

### Text & Chord chips

Type a progression such as `G7 → C`, `Gm → F♯+ → B♭/F → Eø`, or
`Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C`, or edit each chord on its ring.
**↓ Render** turns the text into chord chips; **↑ To text** turns the chips back
into a progression string. The two are true inverses at the pitch-class level:
`parseChord(describe(notes))` always yields the notes you started with, so you
can edit a chip and convert back without it degrading into a note list. Whichever
direction has unsaved changes is highlighted: editing the text box lights up
**Render**, editing a chip lights up **To text**, and pressing either clears both.

The full scene — every chord, the toggles, and the camera angle — is mirrored
into the URL's query string as you work (via `history.replaceState`, so it never
clogs the back button). Copy the URL to share or bookmark an exact view.

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

### Chord cylinder

Draws a short chord progression on a 3‑D cylinder. One
octave wraps once around the cylinder. Each chord is a
ring of vertices joined by **every** interval, the chords stack upward in time,
and dashed lines between layers trace the motion.

The ring can be arranged **chromatically** or by the **circle of fifths** (a
toggle in the View panel — it sends every other vertex to its antipode). On the
circle of fifths a single ring step is a fifth rather than a semitone, so the
between-chord connections show motion by {none, a fifth, a whole tone}; a whole
tone is two steps either way. Interior intervals can be filtered into
**consonant** (m3, M3, P4) and **dissonant** (H, W, TT) groups.


## The parser

`theory-chordname.js` spells chords by interval quality, not by pitch class, so
enharmonics come out right:

- `Fm` → `F A♭ C` (never `F G♯ C`)
- `F♯+` → `F♯ A♯ Cx` (the augmented fifth above F♯ really is C‑double‑sharp)
- `Cdim7` → `C E♭ G♭ B♭♭` (a true diminished seventh)

Accidental glyphs in output: `♯` sharp, `♭` flat, `x` double‑sharp, `♭♭`
double‑flat. Input accepts ASCII or Unicode (`#`/`♯`, `b`/`♭`, `##`/`x`/`𝄪`,
`bb`/`𝄫`).

Supported: triads (`maj`, `m`, `dim`/`°`, `aug`/`+`, `sus2`, `sus4`, `5`),
sevenths (`7`, `maj7`/`Δ7`/`M7`, `m7`, `m7b5`/`ø`, `dim7`/`°7`, `mM7`/`mMaj7`, `aug7`),
sixths (`6`, `m6`, `6/9`), extensions (`9`, `11`, `13`, `maj9`, `m9`, …),
added tones and parenthetical tensions (`add9`, `(9,13)`, `(b9,13)`, `#11`, …),
omissions (`omit3`, `no5`, `drop9`), and slash chords (`B♭/F`).
