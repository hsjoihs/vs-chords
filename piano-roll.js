/* =====================================================================
 * piano-roll.js — DOM UI for the piano-roll mode.
 *
 * Everything requiring the voicing / octave information should live in piano-roll, 
 * not in the chord cylinder. 
 *
 * All music theory lives in three modules that must be loaded BEFORE this file:
 *   theory-pitchclass.js
 *   theory-chordname.js
 *   theory-roman.js   (expands "{V7 → i=} Am"-style curly-brace relative input)
 * They attach their functions to the global scope.
 * ===================================================================== */

/* ====================== state ====================== */
// each chord: { symbol, pcs:[...], rootPc:Number|null, fifthStart:Number }
// fifthStart is the chord's spelling: which length-12 segment of the spiral of
// fifths is adopted as the circle of fifths (see theory-chordname.js).
let chords = [];

// a fixed voicing (with octaves) for the demo progression CM7 → A7 → Dm7 → G7.
// Each chord carries its `root` (a pitch letter/accidental, no octave) plus the
// actual sounding `notes`, so the piano roll can label every note by its degree
// (R, M3, m7, …) above that root — information the octave-free ch.pcs lacks.
const DEMO_VOICING = [
    { root: "C", notes: ["C2", "C4", "E4", "G4", "B4"] }, // CM7
    { root: "A", notes: ["A2", "C#4", "E4", "G4", "A4"] }, // A7
    { root: "D", notes: ["D2", "C4", "D4", "F4", "A4"] }, // Dm7
    { root: "G", notes: ["G2", "D4", "F4", "G4", "B4"] }, // G7
];
let bpm = 120; // playback tempo (one chord per bar line); driven by the log tempo slider
let metronomeOn = true; // click on every beat during playback
let meterNum = 4, // time-signature numerator — drives the metronome accent grouping
    meterDen = 4; // denominator (for the reading/notation; the click rate is bpm)
// transport / seek state
let positionSec = 0, // the retained cursor position (seconds into the piece)
    seeking = false, // is the user dragging the seek bar?
    posRaf = null, // requestAnimationFrame handle for the cursor loop
    playBpm = bpm, // bpm / meter snapshotted at play start, so the piece length
    playMeter = meterNum; //   stays consistent with the already-scheduled audio

// build an editor chord from a parsed symbol, auto-choosing the spelling slider
function chordFromParsed(c) {
    return { symbol: c.symbol, pcs: c.pcs, rootPc: c.rootPc, fifthStart: bestFifthStart(c.notes) };
}

// name of a pitch class within a chord, via that chord's spelling window
function noteName(ch, pc) {
    return nameInWindow(pc, ch.fifthStart);
}

/* ====================== view state ====================== */
let showConsonant = true, // m3, M3, P4/P5 interior intervals
    showDissonant = true, // H, W, TT interior intervals
    showIntervalLabels = true,
    showConnections = true;

/* ====================== axis-system panel (harmonic function + tonnetz) ======================
 * A crude harmonic-function approximation (see theory-pitchclass.js): the chord
 * name is coloured by approximateChordFunction, and a small "dim tonnetz" grid
 * marks the chord tones. The grid has two interleaved sub-lattices (net1/net2);
 * we show whichever one keeps the chord tones connected.
 */
let tonicResidue = 0; // which pc % 3 residue is treated as the tonic (axis-system rotation)
// how chord names are tinted: "none", "hsjoihs" (the axis-system interpretation),
// or "soundquest" (the relative-to-tonic lookup table in soundquest-data.js)
let chordScheme = "none",
    // how to color the notes (tonnetz cells, connections box):
    //   "none"   — no function/chroma tint
    //   "axis"   — by harmonic function (tonic / subdominant / dominant)
    //   "fifths" — by a circle-of-fifths chroma wheel
    noteScheme = "axis",
    accessibleColors = false; // use the red-green-avoiding --accessible-* palette
// Roman-numeral (relative) display: show chords as scale-degree numerals in a key.
let relativeMode = false, // false = absolute chord names, true = Roman numerals
    analysisTonic = 0, // which pitch class is degree I (the analysis key)
    tonicUserSet = false; // has the user pinned a tonic, vs. the auto default?
// label for a chord: an absolute symbol, or a Roman numeral in the analysis key.
// (Possibility 1 "re-analyze" just changes analysisTonic; the sounding pitches —
// ch.pcs — never move, so only this label changes.)
function chordLabel(ch) {
    return relativeMode ? chordToRelative(ch.symbol, majorKeyName(analysisTonic)) : ch.symbol;
}
// the 24-cell layout the key picker lays its notes out on (6 columns × 4 rows).
const DOUBLED_TONNETZ = [
    { pc: 3 }, { pc: 5 }, { pc: 7 }, { pc: 9 }, { pc: 11 }, { pc: 1 },
    { pc: 10 }, { pc: 0 }, { pc: 2 }, { pc: 4 }, { pc: 6 }, { pc: 8 },
    { pc: 5 }, { pc: 7 }, { pc: 9 }, { pc: 11 }, { pc: 1 }, { pc: 3 },
    { pc: 0 }, { pc: 2 }, { pc: 4 }, { pc: 6 }, { pc: 8 }, { pc: 10 },
];

const FUNC_ORDER = ["tonic", "subdominant", "dominant", "unjudgeable"];
// CSS-variable colors (auto-switch under body.accessible — see style.css)
const AXIS_COLOR = {
    tonic: "var(--tonic-color)",
    subdominant: "var(--subdominant-color)",
    dominant: "var(--dominant-color)",
    unjudgeable: "var(--muted)",
};

/* ---- SoundQuest chord coloring ----
 * A relative-to-tonic lookup (soundquest-data.js): a chord's pitch classes,
 * reduced relative to the analysis tonic, map to one or more color categories.
 * Several categories on one chord (e.g. Vm7 = dominant + dominant-minor) draw as
 * a 140° slash, like the axis-system "or".
 */
const SOUNDQUEST_DETAIL = buildSoundquestDetail(chordToAbsolute, parseChord);
const CAT_CSS = {
    tonic: "var(--tonic-color)",
    pseudotonic: "var(--pseudotonic-color)",
    "pseudotonic-minor": "var(--pseudotonic-minor-color)",
    subdominant: "var(--subdominant-color)",
    "subdominant-minor": "var(--subdominant-minor-color)",
    dominant: "var(--dominant-color)",
    "dominant-minor": "var(--dominant-minor-color)",
};
const CAT_ABBR = {
    tonic: "T",
    pseudotonic: "P",
    "pseudotonic-minor": "Pm",
    subdominant: "S",
    "subdominant-minor": "Sm",
    dominant: "D",
    "dominant-minor": "Dm",
};
// In accessible mode the seven categories collapse onto the three core functions
// (the red–green-safe palette only distinguishes T / S / D); the hover tooltip
// then carries the finer T/P/Pm · S/Sm · D/Dm distinction in text instead.
const ACCESSIBLE_GROUP = {
    tonic: "tonic",
    pseudotonic: "tonic",
    "pseudotonic-minor": "tonic",
    subdominant: "subdominant",
    "subdominant-minor": "subdominant",
    dominant: "dominant",
    "dominant-minor": "dominant",
};
// reduce a chord's categories to the color keys actually drawn: the seven
// categories normally, or the three merged groups (de-duplicated) when accessible
function displayCats(cats) {
    if (!accessibleColors) return cats;
    const seen = new Set();
    const out = [];
    for (const c of cats) {
        const g = ACCESSIBLE_GROUP[c];
        if (!seen.has(g)) (seen.add(g), out.push(g));
    }
    return out;
}
function catCss(key) {
    return CAT_CSS[key]; // body.accessible remaps the three core --*-color vars
}
// the SoundQuest detail (ordered [{category, symbols}]) for a chord, relative to
// the current analysis tonic
function sqDetail(ch) {
    if (!ch.pcs.length) return [];
    return SOUNDQUEST_DETAIL.get(soundquestKey(ch.pcs, analysisTonic)) || [];
}
function sqCategories(ch) {
    return sqDetail(ch).map((d) => d.category);
}
// hover text explaining the coloring: one line per category, "ABBR: sym, sym…"
function sqTooltip(ch) {
    return sqDetail(ch).map((d) => `${CAT_ABBR[d.category]}: ${d.symbols.join(", ")}`).join("\n");
}
// panel chip {cls, style}: solid for one category, 140° slash for several
function sqNameAttrs(ch) {
    const cats = displayCats(sqCategories(ch));
    if (cats.length === 0) return { cls: "", style: "" };
    if (cats.length === 1) return { cls: "generic", style: ` style="background:${catCss(cats[0])};color:#fff"` };
    const stops = cats.map((c, i) => `${catCss(c)} ${(i / cats.length) * 100}% ${((i + 1) / cats.length) * 100}%`).join(", ");
    return { cls: "generic", style: ` style="background:linear-gradient(140deg,${stops});color:#fff"` };
}

// Map the judgments to a chord-name style. Each judgment is one element; an
// element "a|b" is a single *ambiguous* judgment ("or"), whereas several
// elements are an overlap of distinct judgments ("plus"). A single function is a
// solid colour; an "or" draws a 140° slash (suggesting the "/" glyph); a "plus"
// (or any other mix) splits horizontally (0°, suggesting stacked layers).
function axisNameAttrs(funcs) {
    if (funcs.length === 0) return { cls: "", style: "" };
    const isOr = funcs.length === 1 && funcs[0].includes("|");
    const isPlus = funcs.length > 1;
    const uniq = [...new Set(funcs.flatMap((f) => f.split("|")))];

    if (!isOr && !isPlus) {
        const f = (funcs[0]);
        if (AXIS_COLOR[f] && f !== "unjudgeable") return { cls: f, style: "" }; // single → solid
    }

    const cols = FUNC_ORDER.filter((f) => uniq.includes(f)).map((f) => AXIS_COLOR[f]);
    const n = cols.length;
    const stops = cols.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(", ");
    const angle = isOr ? 140 : 0; // "or" slashes, "plus" splits horizontally
    return { cls: "generic", style: ` style="background:linear-gradient(${angle}deg,${stops});color:#fff"` };
}

// axis-panel chip attributes ({ cls, style }) for a chord under the active scheme
function chordNameAttrs(ch) {
    if (chordScheme === "hsjoihs") return axisNameAttrs(approximateChordFunction(pcFunctionCounts(ch.pcs, tonicResidue)));
    if (chordScheme === "soundquest") return sqNameAttrs(ch);
    return { cls: "", style: "" };
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let lastAxisSig = null;
// re-render (only when the chord set / colouring actually changed) two things:
//   • the tonic-group shifter, which now lives in the Coloring lower box, and
//   • the coloured chord names, each centred over its column in the piano roll.
function refreshAxisSystem() {
    const el = document.getElementById("axis-system");
    const ctrl = document.getElementById("tonic-group-control");
    if (!el || !ctrl) return;
    const sig = JSON.stringify([tonicResidue, chordScheme, noteScheme, accessibleColors, relativeMode, analysisTonic, chords.map((c) => [c.symbol, c.pcs])]);
    if (sig === lastAxisSig) return;
    lastAxisSig = sig;

    if (chords.length === 0) {
        el.innerHTML = "";
        ctrl.innerHTML = "";
        return;
    }

    // the shifter: which pc % 3 group is heard as the tonic (it rotates every
    // axis-system colour and label). It belongs with the colouring controls.
    const tonicNotes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((p) => p % 3 === tonicResidue).map((p) => NOTE_NAMES[p]).join(" ");
    ctrl.innerHTML =
        `tonic group: ` +
        `<button class="tonic-shift" id="tonicPrev" title="shift tonic group">◀</button>` +
        `<span class="tonic-group">${tonicNotes}</span>` +
        `<button class="tonic-shift" id="tonicNext" title="shift tonic group">▶</button>`;
    const shiftTonic = (delta) => {
        tonicResidue = (tonicResidue + delta + 3) % 3;
        build(); // re-render the panels (colours follow the tonic group)
    };
    document.getElementById("tonicPrev").onclick = () => shiftTonic(-1);
    document.getElementById("tonicNext").onclick = () => shiftTonic(1);

    // the coloured chord names, each box centred on its piano-roll column so it
    // sits directly above the notes it labels (only the name — no tonnetz grid,
    // which like the cylinder would overgeneralize by octave equivalence)
    let html = "";
    chords.forEach((ch, i) => {
        const { cls, style } = chordNameAttrs(ch);
        // explain SoundQuest coloring on hover (also surfaces the fine T/P/Pm…
        // distinction that the accessible 3-color merge hides)
        const titleAttr = chordScheme === "soundquest" ? ` title="${escapeHtml(sqTooltip(ch))}"` : "";
        const left = rollBoxX(i) + ROLL.boxW / 2; // centre of column i
        html += `<div class="child-box" style="left:${left}px"><span class="chord-name ${cls}"${style}${titleAttr}>${escapeHtml(chordLabel(ch))}</span></div>`;
    });
    el.innerHTML = html;
}

/* ====================== piano roll (SVG) ======================
 * The piano roll is one SVG: pitch on the y-axis (C2 at the bottom, C6 at the
 * top, one row per semitone), chords laid out left→right on the x-axis.
 *
 *   • Each sounded note is a solid box carrying its name and its degree above the
 *     chord root (R, M3, m7, …). Every other octave of a chord tone within the
 *     C2–C6 window is drawn faintly — ghost slots where an alternative voicing
 *     could be toggled in (the click-to-toggle interaction is a later pass).
 *   • Between adjacent chords a coloured arrow marks each voice that moves by at
 *     most a whole tone — held (grey), semitone (green), whole tone (orange).
 *     The cylinder is unwrapped here, so closeness is by real pitch: B4→C♯4 is a
 *     ten-semitone leap (no arrow), not the whole tone it looks like on the ring.
 *   • Within a chord a red I-beam brackets each harshly dissonant pair — a minor
 *     2nd (1), a tritone (6) or a minor 9th (13) — but not the mellow major 7th (11).
 *
 * Nothing is hard-coded: the rows, the pitch span and every label follow the voicing.
 */

// major/perfect size (semitones) of each diatonic degree, indexed 0..6 = unison..7th
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const PERFECT_DEGREES = new Set([0, 3, 4]); // unison / 4th / 5th take P (not M/m)
const LETTER_ORDER = "CDEFGAB";

// pitch class (0..11) of a note name; the octave is optional ("C", "A♭", "C#4")
function pitchClassOf(name) {
    return ((noteToMidi(/-?\d/.test(name) ? name : name + "0") % 12) + 12) % 12;
}

// degree of `note` above chord root `root`, e.g. ("C","E4")→"M3", ("A","G4")→"m7".
// The letter distance fixes the degree number and the semitone gap fixes the
// quality, so enharmonic spelling is honoured (D→F reads m3, not ♯2).
function degreeAboveRoot(root, note) {
    const step = (LETTER_ORDER.indexOf(note[0].toUpperCase()) - LETTER_ORDER.indexOf(root[0].toUpperCase()) + 7) % 7;
    if (step === 0 && pitchClassOf(note) === pitchClassOf(root)) return "R"; // the root itself
    let diff = (((pitchClassOf(note) - pitchClassOf(root)) % 12) + 12) % 12 - DIATONIC_SEMITONES[step];
    diff = (((diff + 6) % 12) + 12) % 12 - 6; // fold into −6..+5 (sharp side positive)
    let quality;
    if (PERFECT_DEGREES.has(step)) quality = diff === 0 ? "P" : diff > 0 ? "A".repeat(diff) : "d".repeat(-diff);
    else quality = diff === 0 ? "M" : diff === -1 ? "m" : diff > 0 ? "A".repeat(diff) : "d".repeat(-diff - 1);
    return quality + (step + 1);
}

// the C2–C6 window shown on the pitch axis, and the geometry of the drawing
const ROLL_MIDI_LO = 36, // C2
    ROLL_MIDI_HI = 84; // C6
const ROLL = { rowH: 10, boxW: 46, boxH: 8, padTop: 8, padLeft: 56, colW: 122, gutter: 24 };
// absolute semitone gaps that clash like a minor second yet whose consonant
// octave-complements do not: m2 (1), tritone (6), m9 (13) — note 11 (M7) is absent.
const DISSONANT_GAPS = new Set([1, 6, 13]);
const DISSONANT_COLORS = {1: "var(--semitone)", 6: "var(--tritone)", 13: "var(--semitone)"}
const NOOCT_RE = /-?\d+$/; // trailing octave digits of a note name

// y of a pitch's row centre (higher pitch → smaller y) and x of a chord's box column
function rollPitchY(midi) {
    return ROLL.padTop + (ROLL_MIDI_HI - midi) * ROLL.rowH + ROLL.rowH / 2;
}
function rollBoxX(i) {
    return ROLL.padLeft + i * ROLL.colW;
}

// the circle-of-fifths hue index of a pitch class (C=0, G=1, D=2, …): (7·pc) mod 12
function fifthsIndex(pc) {
    return (((7 * (((pc % 12) + 12) % 12)) % 12) + 12) % 12;
}
// the fill colour of a note box, following the "colour pitch classes by" scheme:
//   axis   → the harmonic-function colours (which the accessible CSS vars remap),
//   fifths → the hue wheel (red-green-safe oklab in accessible mode),
//   none   → the neutral teal. Matches the tonnetz/note colouring elsewhere.
function rollNoteFill(midi) {
    const pc = ((midi % 12) + 12) % 12;
    if (noteScheme === "axis") return `var(--${pcFunction(pc, tonicResidue)}-color)`;
    if (noteScheme === "fifths") {
        const theta = fifthsIndex(pc) * 30; // degrees around the wheel
        return accessibleColors
            ? `oklab(calc(67.5% + 18% * cos(${theta}deg)) 0 calc(0.13 * sin(${theta}deg)))`
            : `oklch(70% 0.12 ${theta}deg)`;
    }
    return "#005242"; // "nothing": the app's neutral teal
}

// one note box: solid when sounded, faint when a ghost slot; ghosts carry data-*
// so a later pass can turn them into clickable voicing toggles.
function rollNoteSvg(x, note, ghost) {
    const y = rollPitchY(note.midi);
    const top = y - ROLL.boxH / 2;
    const col = rollNoteFill(note.midi); // set via inline style so var()/oklch parse
    const pc = ((note.midi % 12) + 12) % 12;
    // the axis/fifths fills are calibrated (like main.js) for pure-white text, so
    // on a coloured box both the name and the degree go white — grey would blend
    // into e.g. the tonic green. The exception: the brightest accessible fifths
    // fills, C/F/G ("bright-cfg" in main.js), need black to stay readable. Faint
    // ghost boxes are mostly dark background, so they keep light text.
    const coloured = noteScheme !== "none";
    const blackText = noteScheme === "fifths" && accessibleColors && (pc === 0 || pc === 5 || pc === 7);
    const nameFill = ghost ? "#bfeee0" : blackText ? "#000" : coloured ? "#fff" : "#eafff8";
    const degFill = blackText ? "#000" : coloured ? "#fff" : "#9fb8b0";
    let g = ghost ? `<g class="roll-ghost" data-midi="${note.midi}">` : "<g>";
    g += `<rect x="${x}" y="${top}" width="${ROLL.boxW}" height="${ROLL.boxH}" rx="1.5" style="fill:${col}${ghost ? ";stroke:" + col : ""}" fill-opacity="${ghost ? 0.16 : 1}"${ghost ? ' stroke-opacity="0.45"' : ""}/>`;
    g += `<text x="${x + ROLL.boxW / 12}" y="${y}" fill="${nameFill}" fill-opacity="${ghost ? 0.5 : 1}" text-anchor="start" dominant-baseline="central">${escapeHtml(note.name)}</text>`;
    if (!ghost) g += `<text x="${x + ROLL.boxW * 11 / 12}" y="${y}" fill="${degFill}" text-anchor="end" dominant-baseline="central">${escapeHtml(note.label)}</text>`;
    return g + "</g>";
}

// an I-beam (vertical stem + short caps) bracketing a dissonant pair, in the
// gutter just right of the chord's boxes
function rollIbeamSvg(x, y1, y2, col) {
    const bx = x + ROLL.boxW / 2,
        cap = 5;
    return (
        `<line x1="${bx}" y1="${y1}" x2="${bx}" y2="${y2}" stroke="${col}" stroke-width="1.3"/>` +
        `<line x1="${bx - cap}" y1="${y1}" x2="${bx + cap}" y2="${y1}" stroke="${col}" stroke-width="1.3"/>` +
        `<line x1="${bx - cap}" y1="${y2}" x2="${bx + cap}" y2="${y2}" stroke="${col}" stroke-width="1.3"/>`
    );
}

// (re)build the SVG from DEMO_VOICING; the voicing is fixed, so this runs once.
function renderPianoRoll() {
    const host = document.getElementById("piano-roll-grid");
    if (!host) return;
    const N = DEMO_VOICING.length;
    // per chord: the sounded notes plus the ghost slots (the same chord-tone pitch
    // classes, spelled identically, in the C2–C6 window's other octaves)
    const columns = DEMO_VOICING.map((chord) => {
        const voiced = chord.notes.map((name) => ({ midi: noteToMidi(name), name, label: degreeAboveRoot(chord.root, name) }));
        const voicedMidi = new Set(voiced.map((v) => v.midi));
        const spellings = [...new Set(chord.notes.map((n) => n.replace(NOOCT_RE, "")))]; // letter+accidental
        const ghosts = [];
        for (const s of spellings)
            for (let oct = 0; oct <= 8; oct++) {
                const name = s + oct,
                    midi = noteToMidi(name);
                if (midi < ROLL_MIDI_LO || midi > ROLL_MIDI_HI || voicedMidi.has(midi)) continue;
                ghosts.push({ midi, name, label: degreeAboveRoot(chord.root, name) });
            }
        return { voiced, ghosts };
    });

    const width = ROLL.padLeft + (N - 1) * ROLL.colW + ROLL.boxW + ROLL.gutter;
    const height = 2 * ROLL.padTop + (ROLL_MIDI_HI - ROLL_MIDI_LO + 1) * ROLL.rowH;
    let s = `<svg id="piano-roll-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-size="9">`;

    // one arrowhead marker per motion colour. markerUnits="userSpaceOnUse" keeps
    // every head the same absolute size — otherwise the default (strokeWidth) would
    // blow up the head on the thick held line.
    s += "<defs>";
    for (const [id, col] of [
        ["held", "#999"],
        ["semitone", "var(--semitone)"],
        ["whole", "var(--whole)"],
    ])
        s += `<marker id="roll-arrow-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`;
    s += "</defs>";

    // faint octave gridlines + a pitch label at each C
    for (let midi = ROLL_MIDI_LO; midi <= ROLL_MIDI_HI; midi += 12) {
        const y = rollPitchY(midi);
        s += `<line x1="${ROLL.padLeft - 8}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="#fff" stroke-opacity="0.06"/>`;
        s += `<text x="6" y="${y}" fill="#fff" fill-opacity="0.4" dominant-baseline="central">C${midi / 12 - 1}</text>`;
    }

    // ghost slots underneath, then arrows, then the solid notes, then I-beams on top
    for (let i = 0; i < N; i++) for (const gh of columns[i].ghosts) s += rollNoteSvg(rollBoxX(i), gh, true);
    
    for (let i = 0; i < N - 1; i++) {
        const x0 = rollBoxX(i) + ROLL.boxW,
            x1 = rollBoxX(i + 1);
        for (const a of columns[i].voiced)
            for (const b of columns[i + 1].voiced) {
                const d = Math.abs(a.midi - b.midi);
                if (d > 2) continue; // only held / semitone / whole-tone steps get an arrow
                // match the cylinder / legend: held = thick solid, whole tone =
                // dashed, semitone = dotted (a round-capped fine dash reads as dots)
                const st =
                    d === 0
                        ? { kind: "held", col: "#999", w: 2.6, dash: "" }
                        : d === 1
                          ? { kind: "semitone", col: "var(--semitone)", w: 1.5, dash: ' stroke-dasharray="0.1 3" stroke-linecap="round"' }
                          : { kind: "whole", col: "var(--whole)", w: 1.5, dash: ' stroke-dasharray="5 3"' };
                s += `<line x1="${x0 + 2}" y1="${rollPitchY(a.midi)}" x2="${x1 - 2}" y2="${rollPitchY(b.midi)}" stroke="${st.col}" stroke-width="${st.w}" stroke-opacity="0.9"${st.dash} marker-end="url(#roll-arrow-${st.kind})"/>`;
            }
    }
    for (let i = 0; i < N; i++) for (const v of columns[i].voiced) s += rollNoteSvg(rollBoxX(i), v, false);

    for (let i = 0; i < N; i++) {
        const notes = columns[i].voiced;
        for (let a = 0; a < notes.length; a++)
            for (let b = a + 1; b < notes.length; b++) {
                const gap = Math.abs(notes[a].midi - notes[b].midi);
                if (DISSONANT_GAPS.has(gap))
                    s += rollIbeamSvg(rollBoxX(i), rollPitchY(notes[a].midi), rollPitchY(notes[b].midi), DISSONANT_COLORS[gap]);
            }
    }

    host.innerHTML = s + "</svg>";
}

// refresh the DOM views (the chord-name row + colouring controls, and the piano
// roll — whose note colours follow the scheme) after any change to the chords,
// coloring, or key.
function build() {
    refreshAxisSystem();
    renderPianoRoll();
    scheduleUrlUpdate();
}

/* ====================== chord text ====================== */
let progEl;
// the current progression as a text string (the chips joined)
function chipsText() {
    return chords
        .map((c) => c.symbol)
        .filter(Boolean)
        .join(" → ");
}

/* ====================== shareable URL state ======================
 * The scene (chords, toggles, key) is mirrored into ?s=… using
 * history.replaceState, debounced, so links are shareable.
 */
let restoring = false;
let urlTimer = null;

function encodeState() {
    return {
        v: 1,
        c: chords.map((ch) => [ch.pcs, ch.rootPc, ch.fifthStart, ch.symbol]),
        t: [showConsonant, showDissonant, showIntervalLabels, showConnections, accessibleColors].map((b) => (b ? 1 : 0)),
        ns: noteScheme,
        cs: chordScheme,
        bp: Math.round(bpm),
        mt: metronomeOn ? 1 : 0,
        mn: meterNum,
        md: meterDen,
        tr: tonicResidue,
        rm: relativeMode,
        at: analysisTonic,
        ap: tonicUserSet,
    };
}
function scheduleUrlUpdate() {
    if (restoring) return;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
        history.replaceState(null, "", "?s=" + encodeURIComponent(JSON.stringify(encodeState())));
    }, 300);
}
function restoreState() {
    const m = location.search.match(/[?&]s=([^&]+)/);
    if (!m) return false;
    let st;
    try {
        st = JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
        return false;
    }
    if (!st || !Array.isArray(st.c)) return false;
    restoring = true;
    try {
        chords = st.c.map(([pcs, rootPc, fifthStart, symbol]) => ({
            pcs: pcs.slice(),
            rootPc: rootPc == null ? null : rootPc,
            fifthStart,
            symbol,
        }));
        if (Array.isArray(st.t)) {
            [showConsonant, showDissonant, showIntervalLabels, showConnections, accessibleColors] = st.t.map(Boolean);
            document.getElementById("tConsonant").checked = showConsonant;
            document.getElementById("tDissonant").checked = showDissonant;
            document.getElementById("tIntervalLabels").checked = showIntervalLabels;
            document.getElementById("tConnections").checked = showConnections;
            document.getElementById("tAccessible").checked = accessibleColors;
            document.body.classList.toggle("accessible", accessibleColors);
        }
        if (typeof st.cs === "string") chordScheme = st.cs;
        const csRadio = document.querySelector(`input[name="chordScheme"][value="${chordScheme}"]`);
        if (csRadio) csRadio.checked = true;
        if (typeof st.ns === "string") noteScheme = st.ns;
        const nsRadio = document.querySelector(`input[name="noteScheme"][value="${noteScheme}"]`);
        if (nsRadio) nsRadio.checked = true;
        if (st.bp != null) bpm = st.bp;
        refreshTempoUI();
        if (st.mt != null) metronomeOn = !!st.mt;
        if (st.mn != null) meterNum = st.mn;
        if (st.md != null) meterDen = st.md;
        document.getElementById("tMetronome").checked = metronomeOn;
        document.getElementById("meterNum").value = meterNum;
        document.getElementById("meterDen").value = meterDen;
        refreshTransportUI(); // seek total depends on bpm/meter
        if (st.tr != null) tonicResidue = st.tr;
        relativeMode = !!st.rm;
        tonicUserSet = !!st.ap;
        analysisTonic = st.at != null ? st.at : bestMajorTonic(chords.map((c) => c.pcs));
        document.getElementById("tRoman").checked = relativeMode;
        document.getElementById("key-picker").hidden = !relativeMode;
        refreshKeyUI();
        progEl.value = chipsText();
        renderChips();
        build();
    } finally {
        restoring = false;
    }
    return true;
}

/* ====================== UI ====================== */
// re-name a hand-edited chord from its notes, tagged root and spelling window
function renameChord(ch) {
    ch.symbol = describe(ch.pcs, ch.rootPc, ch.fifthStart);
}

function renderChips() {
    const wrap = document.getElementById("chips");
    wrap.innerHTML = "";
    chords.forEach((ch, idx) => {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `
      <div class="hd"><div class="nm"></div><button class="del"><img src="image/icons/close.svg" width="20" height="20" /></button></div>
      <details>
      <summary>Edit</summary>
      <div class="ring"></div>
      <div class="spec">
        <span>Prefer ♭</span>
        <input class="slider" type="range" min="${FIFTH_MIN}" max="${FIFTH_MAX}" step="1" value="${ch.fifthStart}">
        <span>Prefer ♯</span>
      </div>
      <div class="spechint">left-click: add/remove · right-click: tag root</div></details>`;
        const nm = chip.querySelector(".nm");
        const ring = chip.querySelector(".ring");
        const buttons = [];

        // refresh the chip's text + button labels/classes (cheap, keeps the
        // slider element alive so dragging it stays smooth)
        const refresh = () => {
            nm.innerHTML = `${chordLabel(ch) || "chord " + (idx + 1)} <small>${ch.pcs
                .map((p) => noteName(ch, p))
                .join(" ")}</small>`;
            for (let pc = 0; pc < 12; pc++) {
                const b = buttons[pc];
                b.textContent = noteName(ch, pc);
                b.className = "pc" + (pc === ch.rootPc ? " root" : ch.pcs.includes(pc) ? " on" : "");
            }
        };

        for (let pc = 0; pc < 12; pc++) {
            const b = document.createElement("div");
            buttons[pc] = b;
            // left-click: toggle membership
            // this untags the root, so that a sane name is picked rather than trying to keep the root
            b.onclick = () => {
                if (ch.pcs.includes(pc)) {
                    ch.pcs = ch.pcs.filter((x) => x !== pc);
                    ch.rootPc = null;
                } else {
                    ch.pcs = [...ch.pcs, pc].sort((a, b) => a - b);
                }
                renameChord(ch);
                refresh();
                build();
            };
            // right-click: tag (or untag) the root
            b.oncontextmenu = (e) => {
                e.preventDefault();
                if (ch.rootPc === pc) {
                    ch.rootPc = null;
                } else {
                    ch.rootPc = pc;
                    if (!ch.pcs.includes(pc)) ch.pcs = [...ch.pcs, pc].sort((a, b) => a - b);
                }
                renameChord(ch);
                refresh();
                build();
            };
            ring.appendChild(b);
        }

        // spelling slider: choose which 12-segment of the spiral of fifths to adopt
        chip.querySelector(".slider").oninput = (e) => {
            ch.fifthStart = Number(e.target.value);
            renameChord(ch);
            refresh(); // relabel buttons live, in place
            build();
        };
        chip.querySelector(".del").onclick = () => {
            chords.splice(idx, 1);
            renderChips();
            build();
        };

        wrap.appendChild(chip);
        refresh();
    });
}

function doRender() {
    const err = document.getElementById("err");
    err.textContent = "";
    try {
        const raw = document.getElementById("prog").value;
        // resolve "curly-brace relative" notation (e.g. "{V7 → i=} Am") to absolute chords
        const text = raw.includes("{") ? progression.parseAndResolveCurlyBraceRelative(raw).join(" → ") : raw;
        const parsed = parseProgression(text);
        if (parsed.length === 0) {
            err.textContent = "Enter at least one chord.";
            return;
        }
        chords = parsed.map(chordFromParsed);
        maybeAutoTonic(); // follow the new progression (Roman mode or SoundQuest)
        renderChips();
        build();
    } catch (e) {
        err.textContent = e.message;
    }
}

// Transpose the whole progression by `deltaFifths` line-of-fifths steps
// (±1 = a perfect fifth, ±7 = a chromatic semitone). It edits the chords in
// place — respelling, renaming, refreshing the chips — and the new pitch classes
// ride along into the shareable URL via the chord encoding.
function transposeBy(deltaFifths) {
    if (!chords.length) return;
    const out = transposeProgression(chords.map((c) => c.symbol), deltaFifths);
    chords = out.map((s) => chordFromParsed(parseChord(s)));
    // a real transposition moves the analysis key by the same interval, so the
    // Roman numerals stay put — that's exactly what distinguishes it (Possibility
    // 2) from re-analyzing in a new key (Possibility 1).
    analysisTonic = (((analysisTonic + 7 * deltaFifths) % 12) + 12) % 12;
    tonicResidue = (((tonicResidue + 7 * deltaFifths) % 3) + 3) % 3; // ride the group along
    refreshKeyUI();
    progEl.value = chipsText();
    renderChips();
    build();
}

// recompute the auto default tonic from the current chords
function refreshDefaultTonic() {
    analysisTonic = bestMajorTonic(chords.map((c) => c.pcs));
    syncTonicGroup(); // snap the axis-system tonic group to the detected key
    refreshKeyUI(); // …and keep the Roman-numerals tab's key readout in step
}
// snap the axis-system "tonic group" (pc % 3 residue) to the analysis key. The
// user may still nudge it with the ◀▶ buttons afterwards; choosing a key just
// re-seeds it.
function syncTonicGroup() {
    tonicResidue = ((analysisTonic % 3) + 3) % 3;
}
// the analysis tonic matters whenever we show Roman numerals OR color chords with
// the (relative) SoundQuest scheme — auto-detect it unless the user pinned a key
function maybeAutoTonic() {
    if (!tonicUserSet && (relativeMode || chordScheme === "soundquest")) refreshDefaultTonic();
}
// reflect the current analysis key in the key-name readout and the tonic grid
function refreshKeyUI() {
    const nameEl = document.getElementById("key-name");
    if (nameEl) nameEl.textContent = majorKeyName(analysisTonic);
    const auto = document.getElementById("autoKey");
    // highlight the auto button while the key is auto-detected (not user-pinned)
    if (auto) auto.classList.toggle("primary", !tonicUserSet);
    renderTonicGrid();
}
// the 4×6 key picker: clicking a note re-analyzes in that key (P1)
function renderTonicGrid() {
    const grid = document.getElementById("tonic-grid");
    if (!grid) return;
    grid.innerHTML = "";
    DOUBLED_TONNETZ.forEach(({ pc }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tcell" + (pc === analysisTonic ? " cur" : "");
        b.textContent = majorKeyName(pc);
        b.onclick = () => {
            analysisTonic = pc;
            tonicUserSet = true; // pin it; auto-default no longer overrides
            syncTonicGroup(); // re-seed the axis-system tonic group from the chosen key
            refreshKeyUI();
            renderChips(); // chip Roman labels depend on the key
            build();
            scheduleUrlUpdate();
        };
        grid.appendChild(b);
    });
}

// Wire a bottom-bar toggler to show/hide an overlay panel: click toggles it,
// hovering for 0.5 s reveals it, and the panel's own ".hide" button hides it.
function wirePanelToggle(panelId, togglerId) {
    const panel = document.getElementById(panelId);
    const toggler = document.getElementById(togglerId);
    if (!panel || !toggler) return;
    let hoverTimer = null;
    const cancelHover = () => {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    };
    const setShown = (on) => {
        cancelHover(); // an explicit show/hide wins over any queued hover-reveal
        panel.style.display = on ? "" : "none";
    };
    toggler.addEventListener("click", () => setShown(panel.style.display === "none"));
    toggler.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(() => setShown(true), 500);
    });
    toggler.addEventListener("mouseleave", cancelHover);
    const hideBtn = panel.querySelector(".hide");
    if (hideBtn) hideBtn.addEventListener("click", () => setShown(false));
}

// reflect the current tempo (bpm) onto the log slider position and the readout
function refreshTempoUI() {
    const tempo = document.getElementById("tempo");
    const tempoVal = document.getElementById("tempo-val");
    if (tempo) tempo.value = Math.round(fractionFromBpm(bpm) * 1000);
    if (tempoVal) tempoVal.textContent = Math.round(bpm) + " BPM";
}

/* ---- transport (play / pause / stop / seek cursor) ---- */
// while playing, the piece length is frozen to the snapshot so the seek cursor
// stays consistent with the audio already scheduled; otherwise it tracks bpm/meter.
function chordDurSec() {
    return (isPlaying() ? playMeter : meterNum) * (60 / (isPlaying() ? playBpm : bpm));
}
function pieceTotalSec() {
    return DEMO_VOICING.length * chordDurSec();
}
function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}
// the chord index sounding at `positionSec` (0-based, clamped to the voicing)
function currentChordIndex() {
    return Math.max(0, Math.min(DEMO_VOICING.length - 1, Math.floor(positionSec / chordDurSec())));
}
// tint the currently-sounding chip and chord-name box; idx < 0 clears
function highlightChord(idx) {
    document.querySelectorAll("#chips .chip").forEach((el, i) => el.classList.toggle("playing", i === idx));
    document.querySelectorAll("#axis-system .child-box").forEach((el, i) => el.classList.toggle("playing", i === idx));
}
// mirror positionSec onto the seek slider (unless the user is dragging it) and the
// mm:ss readouts
function refreshTransportUI() {
    const total = pieceTotalSec();
    const seek = document.getElementById("seek");
    if (seek) {
        seek.max = total.toFixed(2);
        if (!seeking) seek.value = Math.min(positionSec, total);
    }
    const cur = document.getElementById("current-position");
    const tot = document.getElementById("total-length");
    if (cur) cur.textContent = fmtTime(positionSec);
    if (tot) tot.textContent = fmtTime(total);
}
function stopPositionLoop() {
    if (posRaf) cancelAnimationFrame(posRaf);
    posRaf = null;
}
function positionLoop() {
    if (seeking) {
        posRaf = requestAnimationFrame(positionLoop); // the drag owns the cursor; stay dormant
        return;
    }
    const pos = playbackPosition();
    if (pos == null) {
        posRaf = null;
        return; // playback ended; onEnd handles the reset
    }
    positionSec = Math.min(pos, pieceTotalSec());
    refreshTransportUI();
    highlightChord(currentChordIndex());
    posRaf = requestAnimationFrame(positionLoop);
}
// start playback from `offset` seconds; drive the cursor loop and Pause label
function playFrom(offset) {
    playBpm = bpm;
    playMeter = meterNum;
    positionSec = offset;
    playVoicing(
        DEMO_VOICING.map((c) => c.notes),
        {
            bpm,
            beatsPerChord: meterNum,
            metronome: metronomeOn,
            meterNumerator: meterNum,
            offset,
            onEnd: (reason) => {
                document.getElementById("play").textContent = "▶ Play";
                stopPositionLoop();
                if (reason === "ended") {
                    positionSec = 0; // natural end → cursor back to start
                    refreshTransportUI();
                    highlightChord(-1);
                }
            },
        },
    );
    document.getElementById("play").textContent = "⏸ Pause";
    stopPositionLoop();
    posRaf = requestAnimationFrame(positionLoop);
}

function setupUI() {
    progEl = document.getElementById("prog");

    document.getElementById("play").onclick = () => {
        if (isPlaying()) {
            // Pause: capture where we are, stop the sound, keep the cursor
            positionSec = Math.min(playbackPosition() ?? positionSec, pieceTotalSec());
            stopPlayback(); // onEnd("stopped") → label "▶ Play", cursor kept
            return;
        }
        if (positionSec >= pieceTotalSec() - 1e-3) positionSec = 0; // at the end → restart
        playFrom(positionSec);
    };
    document.getElementById("stop").onclick = () => {
        stopPlayback(); // no-op if idle
        positionSec = 0; // Stop: cursor back to the start
        document.getElementById("play").textContent = "▶ Play";
        refreshTransportUI();
        highlightChord(-1);
    };
    const seek = document.getElementById("seek");
    seek.oninput = () => {
        seeking = true;
        positionSec = Math.min(Number(seek.value), pieceTotalSec());
        document.getElementById("current-position").textContent = fmtTime(positionSec);
        highlightChord(currentChordIndex()); // preview which chord we're scrubbing to
    };
    seek.onchange = () => {
        seeking = false;
        playFrom(positionSec); // releasing the seek bar starts audio from there
    };
    document.getElementById("tempo").oninput = (e) => {
        bpm = bpmFromFraction(Number(e.target.value) / 1000);
        document.getElementById("tempo-val").textContent = Math.round(bpm) + " BPM";
        refreshTransportUI();
        scheduleUrlUpdate();
    };
    refreshTempoUI();
    refreshTransportUI();
    document.getElementById("tMetronome").onchange = (e) => {
        metronomeOn = e.target.checked;
        scheduleUrlUpdate();
    };
    document.getElementById("meterNum").oninput = (e) => {
        meterNum = Math.max(1, Math.floor(Number(e.target.value) || 4));
        refreshTransportUI();
        scheduleUrlUpdate();
    };
    document.getElementById("meterDen").onchange = (e) => {
        meterDen = Number(e.target.value);
        scheduleUrlUpdate();
    };
    document.getElementById("add").onclick = () => {
        chords.push(chordFromParsed(parseChord("C")));
        renderChips();
        build();
    };
    document.getElementById("tConsonant").onchange = (e) => {
        showConsonant = e.target.checked;
        build();
    };
    document.getElementById("tDissonant").onchange = (e) => {
        showDissonant = e.target.checked;
        build();
    };
    document.querySelectorAll("#transpose [data-tf]").forEach((b) => {
        b.onclick = () => transposeBy(Number(b.dataset.tf));
    });
    document.getElementById("tRoman").onchange = (e) => {
        relativeMode = e.target.checked;
        document.getElementById("key-picker").hidden = !relativeMode;
        maybeAutoTonic();
        refreshKeyUI();
        renderChips(); // chip headers switch between absolute names and Roman numerals
        build();
    };
    document.getElementById("autoKey").onclick = () => {
        tonicUserSet = false; // un-pin → follow the auto-detected key again
        refreshDefaultTonic();
        refreshKeyUI();
        renderChips(); // chip Roman labels depend on the key
        build();
        scheduleUrlUpdate();
    };
    renderTonicGrid(); // populate the key picker once (it stays hidden until Roman mode)
    // chord-coloring scheme radios: "hsjoihs" (axis system), "soundquest" (the
    // relative lookup table), or "none". SoundQuest needs an analysis tonic, so
    // selecting it auto-detects one (unless the user has pinned a key).
    document.querySelectorAll('input[name="chordScheme"]').forEach((r) => {
        r.onchange = (e) => {
            if (!e.target.checked) return;
            chordScheme = e.target.value;
            const before = analysisTonic;
            maybeAutoTonic();
            if (analysisTonic !== before) renderChips(); // Roman labels track the key
            build();
        };
    });
    document.querySelectorAll('input[name="noteScheme"]').forEach((r) => {
        r.onchange = (e) => {
            if (!e.target.checked) return;
            noteScheme = e.target.value;
            build();
        };
    });
    document.getElementById("tAccessible").onchange = (e) => {
        accessibleColors = e.target.checked;
        document.body.classList.toggle("accessible", accessibleColors);
        build();
    };
    document.getElementById("tIntervalLabels").onchange = (e) => {
        showIntervalLabels = e.target.checked;
        build();
    };
    document.getElementById("tConnections").onchange = (e) => {
        showConnections = e.target.checked;
        build();
    };
    // a bottom-bar button toggles its overlay panel (on click), or reveals it on a
    // 0.5 s hover; the panel's own hide button hides it.
    wirePanelToggle("tonnetz-and-coloring", "toggle-box-of-tonnetz-and-coloring");
    wirePanelToggle("key-degree", "toggle-box-of-key-degree");
    wirePanelToggle("tempo-metronome", "toggle-box-of-tempo-metronome");
}

window.addEventListener("DOMContentLoaded", () => {
    setupUI();
    // restore a shared scene from ?s=…, else render the default progression
    if (!restoreState()) doRender();
});
// expose for debugging / browser-console verification
window.__cc = {
    parseChord,
    parseProgression,
    voiceLeading,
    absDistance,
    get chords() {
        return chords;
    },
};
