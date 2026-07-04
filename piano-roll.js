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

// the current voicing (with octaves), one entry per chord. Each carries its `root`
// (a pitch letter/accidental, no octave) plus the actual sounding `notes` (bass
// first, then ascending upper voices), so the piano roll can label every note by
// its degree (R, M3, m7, …) — information the octave-free ch.pcs lacks. It is
// produced by the statistical-mechanics sampler in voicing.js (see sampleVoicing).
let voicing = [];
let voicingS = 3.4, // width of the parabolic potential (note-heights)
    voicingT = 1, // temperature; the equilibrium note spread is S·√T
    voicingCenter = 66; // MIDI pitch the potential well is centred on (default F♯4)
// the temperature slider's log-scaled span (module-level so restoreState can invert it)
const VOICING_T_MIN = 0.1,
    VOICING_T_MAX = 1;
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
    // bassPc is the piano-roll-owned slash bass; it starts at the root (root
    // position) and is preserved across re-rolls (a future piano-roll interaction
    // will let the user move it, recording e.g. A7/E).
    return { symbol: c.symbol, pcs: c.pcs, rootPc: c.rootPc, bassPc: c.rootPc, fifthStart: bestFifthStart(c.notes) };
}

// name of a pitch class within a chord, via that chord's spelling window
function noteName(ch, pc) {
    return nameInWindow(pc, ch.fifthStart);
}

// spell a MIDI pitch whose pitch class is written `pcName` (letter+accidental, no
// octave), e.g. spellMidi("C", 60) → "C4", spellMidi("C#", 61) → "C#4"
function spellMidi(pcName, midi) {
    return pcName + (midi - noteToMidi(pcName + "0")) / 12;
}
// build a { root, notes } display chord from a parsed chord and a generated
// { bass, uppers } octave assignment (bass first, then ascending upper voices).
// The bass is spelled by its own pitch class (so a slash bass reads correctly),
// while `root` stays the naming root that the degree labels are measured against.
function spellVoicedChord(ch, gen) {
    const rootName = ch.rootPc != null ? noteName(ch, ch.rootPc) : ch.pcs.length ? noteName(ch, ch.pcs[0]) : "C";
    const notes = [];
    if (gen.bass != null) notes.push(spellMidi(noteName(ch, ((gen.bass % 12) + 12) % 12), gen.bass));
    for (const m of gen.uppers) notes.push(spellMidi(noteName(ch, ((m % 12) + 12) % 12), m));
    return { root: rootName, notes };
}
// sample a fresh voicing for the current progression at the current S and T,
// via the statistical-mechanics generator (voicing.js)
function sampleVoicing() {
    const nonEmpty = chords.filter((c) => c.pcs && c.pcs.length);
    const gen = generateVoicing(nonEmpty.map((c) => ({ pcs: c.pcs, bass: c.bassPc != null ? c.bassPc : c.rootPc })), { S: voicingS, T: voicingT, center: voicingCenter });
    let gi = 0;
    return chords.map((c) => (c.pcs && c.pcs.length ? spellVoicedChord(c, gen[gi++]) : { root: c.rootPc != null ? noteName(c, c.rootPc) : "C", notes: [] }));
}
// re-roll the voicing (a fresh random draw) and redraw everything
function regenerateVoicing() {
    voicing = sampleVoicing();
    refreshTransportUI();
    build();
}
// toggle whether a specific pitch (MIDI) sounds in chord `chordIdx`'s voicing: a
// manual override of the sampled octaves. The clicked chord tone is added (if it was
// a ghost slot) or removed (if it was sounding), and the new lowest note is recorded
// as the chord's bass (bassPc) — the slash. A later re-roll keeps that bass but
// re-samples everything else.
function toggleVoicedNote(chordIdx, midi) {
    const v = voicing[chordIdx],
        ch = chords[chordIdx];
    if (!v || !ch) return;
    if (v.notes.some((n) => noteToMidi(n) === midi)) {
        v.notes = v.notes.filter((n) => noteToMidi(n) !== midi); // was sounding → silence this octave
    } else {
        const pc = ((midi % 12) + 12) % 12; // was a ghost → sound this octave
        v.notes = [...v.notes, spellMidi(noteName(ch, pc), midi)].sort((a, b) => noteToMidi(a) - noteToMidi(b));
    }
    if (v.notes.length) ch.bassPc = ((noteToMidi(v.notes[0]) % 12) + 12) % 12; // the lowest note is the bass
    build(); // redraw the roll + the axis label (which now shows the slash), update the URL
}
// the temperature slider's log mapping and its inverse (0..1000 ↔ T)
function voicingTfromSlider(v) {
    return VOICING_T_MIN * Math.pow(VOICING_T_MAX / VOICING_T_MIN, v / 1000);
}
function voicingTtoSlider(T) {
    return Math.round((1000 * Math.log(T / VOICING_T_MIN)) / Math.log(VOICING_T_MAX / VOICING_T_MIN));
}
// mirror voicingS / voicingT / voicingCenter back onto their sliders (after a restore)
function refreshVoicingUI() {
    const sEl = document.getElementById("voicingS");
    if (sEl) sEl.value = voicingS;
    const tEl = document.getElementById("voicingT");
    if (tEl) tEl.value = voicingTtoSlider(voicingT);
    const cEl = document.getElementById("voicingCenter");
    if (cEl) cEl.value = voicingCenter;
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

// the slash-bass suffix for a piano-roll chord label, e.g. "/E" for A7/E (or "/III"
// in Roman mode: the bass is named as a scale degree, matching the numeral). Empty
// when the bass is the root (root position) or unset. The bass is a piano-roll
// concern, so this shows on the axis-system labels over the roll — never on the chips.
function slashSuffix(ch) {
    if (ch.bassPc == null || ch.bassPc === ch.rootPc) return "";
    const bassName = noteName(ch, ch.bassPc);
    return "/" + (relativeMode ? noteToDegree(bassName, majorKeyName(analysisTonic)) : bassName);
}

let lastAxisSig = null;
// re-render (only when the chord set / colouring actually changed) two things:
//   • the tonic-group shifter, which now lives in the Coloring lower box, and
//   • the coloured chord names, each centred over its column in the piano roll.
function refreshAxisSystem() {
    const el = document.getElementById("axis-system");
    const ctrl = document.getElementById("tonic-group-control");
    if (!el || !ctrl) return;
    const sig = JSON.stringify([tonicResidue, chordScheme, noteScheme, accessibleColors, relativeMode, analysisTonic, chords.map((c) => [c.symbol, c.pcs, c.bassPc])]);
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
        const left = rollBoxX(i) + ROLL.boxW / 2 + BELL_PAD; // column centre (the SVG is shifted right by BELL_PAD)
        html += `<div class="child-box" style="left:${left}px"><span class="chord-name ${cls}"${style}${titleAttr}>${escapeHtml(chordLabel(ch) + slashSuffix(ch))}</span></div>`;
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
// octave-complements do not: m2/m9 (1), tritone (6) but not M7 (11).
const HIGHLY_DISSONANT_GAPS = new Set([1, 6]);
const HIGHLY_DISSONANT_COLORS = {1: "var(--semitone)", 6: "var(--tritone)"};
const NOOCT_RE = /-?\d+$/; // trailing octave digits of a note name

// a Gaussian "register weight" bell drawn to the left of the C-labels: the
// equilibrium single-note distribution of the sampler, X = -BELL_AMP · e^(−Y²/2σ²)
// (X, Y, σ in note-height units), with the mean Y = 0 pinned to F♯4 and the X = 0
// baseline at x = BELL_BASE_X. Its width σ = S·√T tracks the potential width and
// temperature. Since the peak reaches BELL_AMP note-heights left of the baseline,
// the whole drawing (and the chord-name row above it) shifts right by BELL_PAD.
const BELL_AMP = 8,
    BELL_BASE_X = 6; // = the C-labels' x, so the bell's baseline meets them
const BELL_PAD = BELL_AMP * ROLL.rowH - BELL_BASE_X + 6; // px the view extends left of x=0

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

// one note box: solid when sounded, faint when a ghost slot. Both carry
// data-chord / data-midi and a full-row transparent hit target, so clicking one
// toggles that pitch in the voicing (see the delegated handler in setupUI).
function rollNoteSvg(x, note, ghost, chordIdx) {
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
    let g = `<g class="roll-slot${ghost ? " roll-ghost" : ""}" data-chord="${chordIdx}" data-midi="${note.midi}">`;
    // a full-row transparent rect makes the whole row easy to click; its fill + the
    // pointer-events that capture clicks are set in CSS (attributes are unreliable
    // for pointer-events). The painted box/text below are clickable too, as a fallback.
    g += `<rect class="roll-hit" x="${x}" y="${y - ROLL.rowH / 2}" width="${ROLL.boxW}" height="${ROLL.rowH}"/>`;
    g += `<rect x="${x}" y="${top}" width="${ROLL.boxW}" height="${ROLL.boxH}" rx="1.5" style="fill:${col}${ghost ? ";stroke:" + col : ""}" fill-opacity="${ghost ? 0.16 : 1}"${ghost ? ' stroke-opacity="0.45"' : ""}/>`;
    g += `<text x="${x + ROLL.boxW / 12}" y="${y}" fill="${nameFill}" fill-opacity="${ghost ? 0.5 : 1}" text-anchor="start" dominant-baseline="central">${escapeHtml(note.name)}</text>`;
    if (!ghost && showIntervalLabels) g += `<text x="${x + ROLL.boxW * 11 / 12}" y="${y}" fill="${degFill}" text-anchor="end" dominant-baseline="central">${escapeHtml(note.label)}</text>`;
    return g + "</g>";
}

// I-beam geometry: the stem sits just right of the note boxes; when a chord has
// several beams they stack rightwards so their caps don't collide.
const BEAM_STEM_GAP = 5, // stem x, measured right of the note-box right edge
    BEAM_CAP = 4, // half-length of the horizontal caps
    BEAM_STEP = 12; // extra x per additional beam in the same chord

// an I-beam (vertical stem + short caps) bracketing a dissonant pair, drawn with
// its stem at `bx` (already positioned in the gutter right of the boxes)
function rollIbeamSvg(bx, y1, y2, col) {
    return (
        `<line x1="${bx}" y1="${y1}" x2="${bx}" y2="${y2}" stroke="${col}" stroke-width="1.3"/>` +
        `<line x1="${bx - BEAM_CAP}" y1="${y1}" x2="${bx + BEAM_CAP}" y2="${y1}" stroke="${col}" stroke-width="1.3"/>` +
        `<line x1="${bx - BEAM_CAP}" y1="${y2}" x2="${bx + BEAM_CAP}" y2="${y2}" stroke="${col}" stroke-width="1.3"/>`
    );
}

// (re)build the SVG from the current `voicing` (redraw only — no re-sampling)
function renderPianoRoll() {
    const host = document.getElementById("piano-roll-grid");
    if (!host) return;
    const N = voicing.length;
    // per chord: the sounded notes plus the ghost slots (the same chord-tone pitch
    // classes, spelled identically, in the C2–C6 window's other octaves)
    const columns = voicing.map((chord) => {
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

    // dissonant-pair I-beams per chord, each assigned a stem x in the right gutter
    // (stacked rightwards when a chord has more than one)
    const beamsByChord = columns.map((c) => {
        if (!showDissonant) return []; // the "highly dissonant intervals" toggle hides the I-beams
        const notes = c.voiced,
            beams = [];
        for (let a = 0; a < notes.length; a++)
            for (let b = a + 1; b < notes.length; b++) {
                const gap = Math.abs(notes[a].midi - notes[b].midi); // take the absolute value before taking the mod, distinguishing M7 from m9
                if (HIGHLY_DISSONANT_GAPS.has(gap % 12))
                    beams.push({ lo: Math.min(notes[a].midi, notes[b].midi), hi: Math.max(notes[a].midi, notes[b].midi), col: HIGHLY_DISSONANT_COLORS[gap % 12] });
            }
        beams.forEach((beam, k) => (beam.stem = ROLL.boxW + BEAM_STEM_GAP + k * BEAM_STEP)); // x, relative to the box left
        return beams;
    });
    // where an arrow leaving chord i, from a note at `midi`, should start: normally
    // just right of the box, but shifted clear of any I-beam it would otherwise
    // cross (i.e. any beam whose C♯4–G4-style interval contains the note)
    function arrowStartX(i, midi) {
        const boxRight = rollBoxX(i) + ROLL.boxW;
        let x = boxRight + 2;
        for (const beam of beamsByChord[i])
            if (midi >= beam.lo && midi <= beam.hi) x = Math.max(x, rollBoxX(i) + beam.stem + BEAM_CAP + 2);
        return x;
    }

    const width = ROLL.padLeft + (N - 1) * ROLL.colW + ROLL.boxW + ROLL.gutter;
    const height = 2 * ROLL.padTop + (ROLL_MIDI_HI - ROLL_MIDI_LO + 1) * ROLL.rowH;
    // the viewBox is opened out to the left by BELL_PAD so the register bell fits
    const viewW = width + BELL_PAD;
    let s = `<svg id="piano-roll-svg" viewBox="${-BELL_PAD} 0 ${viewW} ${height}" width="${viewW}" height="${height}" font-size="9">`;

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

    // the register-weight bell to the left of the labels: X = -BELL_AMP·e^(−Y²/2σ²),
    // Y measured in note-heights up from the well centre, sampled down the pixel column
    const bellMeanY = rollPitchY(voicingCenter);
    const bellSigma = voicingS * Math.sqrt(voicingT); // equilibrium spread S·√T
    let bell = "";
    for (let py = 0; py <= height; py += 2) {
        const Y = (bellMeanY - py) / ROLL.rowH; // note-heights above the mean
        const X = -BELL_AMP * Math.exp(-(Y * Y) / (2 * bellSigma * bellSigma));
        bell += (py === 0 ? "M" : "L") + (BELL_BASE_X + X * ROLL.rowH).toFixed(2) + " " + py + " ";
    }
    s += `<path d="${bell.trim()}" fill="none" stroke="#9ecbff" stroke-opacity="0.75" stroke-width="1.2"/>`;

    // ghost slots underneath, then arrows, then the solid notes, then I-beams on top
    for (let i = 0; i < N; i++) for (const gh of columns[i].ghosts) s += rollNoteSvg(rollBoxX(i), gh, true, i);
    
    for (let i = 0; i < N - 1; i++) {
        const x1 = rollBoxX(i + 1);
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
                s += `<line x1="${arrowStartX(i, a.midi)}" y1="${rollPitchY(a.midi)}" x2="${x1 - 2}" y2="${rollPitchY(b.midi)}" stroke="${st.col}" stroke-width="${st.w}" stroke-opacity="0.9"${st.dash} marker-end="url(#roll-arrow-${st.kind})"/>`;
            }
    }
    for (let i = 0; i < N; i++) for (const v of columns[i].voiced) s += rollNoteSvg(rollBoxX(i), v, false, i);

    for (let i = 0; i < N; i++)
        for (const beam of beamsByChord[i]) s += rollIbeamSvg(rollBoxX(i) + beam.stem, rollPitchY(beam.hi), rollPitchY(beam.lo), beam.col);

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
        c: chords.map((ch) => [ch.pcs, ch.rootPc, ch.fifthStart, ch.symbol, ch.bassPc]),
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
        vs: voicingS, // voicing potential width
        vt: voicingT, // voicing temperature
        vc: voicingCenter, // voicing well centre (MIDI)
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
        chords = st.c.map(([pcs, rootPc, fifthStart, symbol, bassPc]) => ({
            pcs: pcs.slice(),
            rootPc: rootPc == null ? null : rootPc,
            bassPc: bassPc != null ? bassPc : rootPc == null ? null : rootPc, // the slash (older links: root position)
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
        if (st.vs != null) voicingS = st.vs;
        if (st.vt != null) voicingT = st.vt;
        if (st.vc != null) voicingCenter = st.vc;
        refreshVoicingUI(); // put the voicing sliders where the URL says
        progEl.value = chipsText();
        renderChips();
        regenerateVoicing(); // restored progression + params → sample a voicing
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
                regenerateVoicing(); // the chord's notes changed → re-sample the voicing
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
                // the naming root changed (degree labels + spelling), so re-sample —
                // but the bass slash (bassPc) is a piano-roll concern and is preserved
                regenerateVoicing();
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
            regenerateVoicing(); // a removed chord shortens the voicing
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
        regenerateVoicing(); // a new progression → sample a fresh voicing
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
    regenerateVoicing(); // transposed pitches → re-sample the voicing
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
    return voicing.length * chordDurSec();
}
function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}
// the chord index sounding at `positionSec` (0-based, clamped to the voicing)
function currentChordIndex() {
    return Math.max(0, Math.min(voicing.length - 1, Math.floor(positionSec / chordDurSec())));
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
        voicing.map((c) => c.notes),
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

    // click a note box (solid or ghost) in the piano roll to toggle it in/out of the
    // voicing. Delegated on the container, which survives each renderPianoRoll rebuild.
    document.getElementById("piano-roll-grid").addEventListener("click", (e) => {
        const g = e.target.closest("[data-chord]");
        if (g) toggleVoicedNote(Number(g.dataset.chord), Number(g.dataset.midi));
    });

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
        regenerateVoicing(); // an added chord extends the voicing
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
    // voicing controls: S (potential width) and the well centre are linear; T
    // (temperature) is log-scaled. Dragging redraws the bell live; releasing re-samples.
    const sEl = document.getElementById("voicingS");
    sEl.oninput = () => {
        voicingS = Number(sEl.value);
        renderPianoRoll(); // the bell widens live; voicing re-rolls on release
    };
    sEl.onchange = regenerateVoicing;
    voicingS = Number(sEl.value); // sync state to the slider's start
    const tEl = document.getElementById("voicingT");
    tEl.oninput = () => {
        voicingT = voicingTfromSlider(Number(tEl.value));
        renderPianoRoll();
    };
    tEl.onchange = regenerateVoicing;
    voicingT = voicingTfromSlider(Number(tEl.value)); // sync state to the slider's start
    const cEl = document.getElementById("voicingCenter");
    cEl.oninput = () => {
        voicingCenter = Number(cEl.value);
        renderPianoRoll(); // the bell slides up/down live
    };
    cEl.onchange = regenerateVoicing;
    voicingCenter = Number(cEl.value);
    document.getElementById("reroll").onclick = regenerateVoicing;

    // a bottom-bar button toggles its overlay panel (on click), or reveals it on a
    // 0.5 s hover; the panel's own hide button hides it.
    wirePanelToggle("tonnetz-and-coloring", "toggle-box-of-tonnetz-and-coloring");
    wirePanelToggle("key-degree", "toggle-box-of-key-degree");
    wirePanelToggle("tempo-metronome", "toggle-box-of-tempo-metronome");
    wirePanelToggle("voicing", "toggle-box-of-voicing");
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
