# vs.chords

Helps you win the battle against chord progressions

It is intentionally packed with features, not unlike an [IDE (Integrated development environment)](https://en.wikipedia.org/wiki/Integrated_development_environment): type a progression, see it spelled correctly, watch it on a 3-D cylinder, re-read it as Roman numerals in any key, transpose it, and color it by several theories of harmonic function — all from a single static page.

> Looking to hack on it? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Entering a progression

Type a progression such as `G7 → C`, `Gm → G♭+ → B♭/F → Eø`, or
`Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C` into the input box, pick one of the
presets, or build each chord by hand on its ring.

- **↓ Render** turns the text into chord chips.
- **↑ To text** turns the chips back into a progression string. Tick **Force "To text" to use ASCII only** to
  emit `maj`, `dim`, `m7b5`, `#`, `b`, `->` instead of `Δ`, `°`, `ø`, `♯`, `♭`, `→`.

Whichever side has unsaved changes lights up: editing the text box highlights
**Render**, editing a chip highlights **To text**, and pressing either clears both.

A small glyph keypad under the input inserts hard-to-type symbols (`♭ ♯ 𝄪 𝄫 ø ° Δ →`).

The whole scene — every chord, the toggles, the key, and the camera angle — is
mirrored into the URL as you work. Copy the URL to share or bookmark an exact view.

### Transpose

Each button (±semitone / ±fifth) in the **Transpose** row shifts the entire progression. 
In Roman-numeral mode the analysis key moves with it, so the numerals stay put.

### Chord chips

Each chip has twelve pitch-class buttons and a spelling slider:

- **Left-click** a button to add or remove that note.
- **Right-click** a button to tag it as the **root**. Parsing a chord symbol sets
  the root automatically.
- **Spelling slider** (_Prefer ♭_ ↔ _Prefer ♯_) chooses which contiguous
  length-12 segment of the spiral of fifths is adopted as the circle of fifths,
  fixing the spelling of all twelve notes. Sliding one notch toward the flat side
  turns, e.g., `E♭ B♭ F C G D A E B F♯ C♯ G♯` into `A♭ E♭ B♭ F C G D A E B F♯ C♯`.
  Typing a chord auto-sets the slider to the segment that best matches the
  symbol's implied enharmonics (so `Fm` shows `A♭`, not `G♯`).

## The chord cylinder

The progression is drawn on a 3-D cylinder. One octave wraps once around it; each
chord is a ring of vertices joined by **every** interval; chords stack downward in
time, and dashed spirals between layers trace the voice-leading.

- The ring can be arranged **chromatically** or by the **circle of fifths** (a
  toggle that sends every other vertex to its antipode). On the circle of fifths a
  single ring step is a fifth instead of a semitone.
- Between-chord motion is styled by distance: a held note is a solid bar, a
  semitone (or fifth) and a whole tone are dashed spirals with arrowheads, and a
  pair of held notes is emphasized with a faint cross-hatched pane.
- Interior intervals can be filtered into **consonant** (m3, M3, P4) and
  **dissonant** (H, W, TT) groups, with optional interval labels.
- The **View** panel adjusts cylinder length, the chord-name angle and distance,
  and auto-rotation. Drag to orbit, scroll to zoom, right-drag to pan.

## Coloring

Two independent coloring choices, both with a red-green-safe **accessible mode**:

### Colors to pitch classes

Colors the cylinder vertices, the tonnetz
cells, and the note names in the Connections panel:

- *the axis system* — by approximate harmonic function (tonic / subdominant /
  dominant), grouping the twelve pitch classes into three diminished-7th sets.
- *the circle of fifths* — a chroma wheel keyed to the circle of fifths
  (C = red-ish, advancing 30° per fifth), independent of the ring arrangement.

In accessible mode the chroma wheel is instead employed on a plane inside the 
[Oklab color space](https://en.wikipedia.org/wiki/Oklab_color_space)
spanned by lightness and the blue–yellow `b` axis of .

### Colors to chords

Tints the chord names in the panel and on the cylinder:

- *SoundQuest-based* — a relative-to-key lookup table (seven categories: tonic,
  pseudotonic ±minor, subdominant ±minor, dominant ±minor). A chord that belongs
  to several categories (e.g. `Vsus4` = `Isus2`) is drawn as a 140° slash, and
  **hovering** a chord name explains the coloring by listing the matching chords,
  e.g. `T: Idim7 / Pm: ♭IIIdim7 / S: ♯IVdim7`.
- *hsjoihs's [weird scheme](explain-hsjoihs-interpretation.html)* — an
  experimental crude approximation of functional harmony.

In accessible mode the seven SoundQuest categories collapse onto the three core
colors (tonic = pseudotonic = pseudotonic-minor, and likewise for dominant and
subdominant); the hover text then carries the finer distinction that the merged
colors drop.

## Roman-numeral mode

Tick **Show chords as Roman numerals** to read the progression relative to a key
(uppercase numerals with explicit qualities, leaning flat: `A♭7 → D♭` becomes
`V7 → I` in D♭, or `♭VI7 → ♭II` in C).

- **Re-analyze** — click a note on the key picker. The sounding
  chords do not move; only the labels (and the key) change. **Auto-detect**
  re-picks the key that contains the most chord tones.

The chosen key also seeds the tonnetz "tonic group," and zapping through presets
re-detects the key automatically.

## The parser

When rendering the chord chips and the cylinder, interval qualities are respected;
enharmonics come out right:

- `Fm` → `F A♭ C` (never `F G♯ C`)
- `F♯+` → `F♯ A♯ Cx` (the augmented fifth above F♯ really is C-double-sharp)
- `Cdim7` → `C E♭ G♭ B♭♭` (a true diminished seventh)

Accidental glyphs in output: `♯` sharp, `♭` flat, `x` double-sharp, `♭♭`
double-flat. Input accepts ASCII or Unicode (`#`/`♯`, `b`/`♭`, `##`/`x`/`𝄪`,
`bb`/`𝄫`), and `+`/`-` as sharp/flat inside tensions (`Δ7(+11,13)` = `M7(♯11,13)`).

Supported: triads (`maj`, `m`, `dim`/`°`, `aug`/`+`, `sus2`, `sus4`, `5`),
sevenths (`7`, `maj7`/`Δ7`/`M7`, `m7`, `m7b5`/`ø`, `dim7`/`°7`, `mM7`/`mΔ7`,
`aug7`, `augMaj7`), sixths (`6`, `m6`, `6/9`), extensions (`9`, `11`, `13`,
`Maj9`, `m9`, `mMaj13`, …), suspensions on any base (`Maj7sus4`, `13sus4`),
added tones and parenthetical tensions (`add9`, `(9,13)`, `(b9,13)`, `#11`, …),
omissions (`omit3`, `no5`, `drop9`), slash chords (`B♭/F`), the empty set
`N.C.`, and the quartal `q` family.

`° Δ ° o dim −` on their own are read as triads by default (add `7` for the
seventh chord); a checkbox switches to the convention where they are sevenths on
their own. `M`, `Maj`, `m`, `min` are always triads, and `ø` is always a
half-diminished seventh, under both conventions.
