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
// Chords here carry actual pitches, unlike the octave-free ch.pcs elsewhere.
const DEMO_VOICING = [
    ["C2", "C4", "E4", "G4", "B4"], // CM7
    ["A2", "C#4", "E4", "G4", "A4"], // A7
    ["D2", "C4", "D4", "F4", "A4"], // Dm7
    ["G2", "D4", "F4", "G4", "B4"], // G7
];
let bpm = 120; // playback tempo (one chord per bar line); driven by the log tempo slider
let metronomeOn = true; // click on every beat during playback
let meterNum = 4, // time-signature numerator — drives the metronome accent grouping
    meterDen = 4; // denominator (for the reading/notation; the click rate is bpm)

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
    showConnections = true,
    circleOfFifths = false; // chords are read on a chromatic ring here

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

// the circle-of-fifths hue index of a pitch class (C=0, G=1, D=2, …), keyed to
// the `.note` CSS rules in musical-colors.css so the tonnetz cells and connection
// chips match; deliberately independent of any ring arrangement.
function fifthsIndex(pc) {
    return ((7 * (((pc % 12) + 12) % 12)) % 12 + 12) % 12; // (7·pc) mod 12
}
// HTML for a colored note name in the connections box, matching the active scheme
function noteChip(name, pc) {
    const esc = escapeHtml(name);
    if (noteScheme === "axis") return `<span class="note-chip fn-${pcFunction(pc, tonicResidue)}">${esc}</span>`;
    if (noteScheme === "fifths") return `<span class="note-chip note-text" style="--n:${fifthsIndex(pc)}">${esc}</span>`;
    return `<span class="note-chip">${esc}</span>`;
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
// re-render the axis-system panel only when the chord set actually changed
function refreshAxisSystem() {
    const el = document.getElementById("axis-system");
    if (!el) return;
    const sig = JSON.stringify([tonicResidue, chordScheme, noteScheme, accessibleColors, relativeMode, analysisTonic, chords.map((c) => [c.symbol, c.pcs])]);
    if (sig === lastAxisSig) return;
    lastAxisSig = sig;

    if (chords.length === 0) {
        el.innerHTML = "";
        return;
    }
    // shifter: which pc % 3 group is the tonic (rotates every colour & label)
    const tonicNotes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((p) => p % 3 === tonicResidue).map((p) => NOTE_NAMES[p]).join(" ");
    let html = "";
    html +=
        `<div class="axis-controls">tonic group: ` +
        `<button class="tonic-shift" id="tonicPrev" title="shift tonic group">◀</button>` +
        `<span class="tonic-group">${tonicNotes}</span>` +
        `<button class="tonic-shift" id="tonicNext" title="shift tonic group">▶</button></div>`;
    html += '<div class="axis-row">';
    for (const ch of chords) {
        // only the colored chord name — the per-chord tonnetz grid is omitted here
        // because it, like the cylinder, overgeneralizes by octave equivalence
        const { cls, style } = chordNameAttrs(ch);
        // explain SoundQuest coloring on hover (also surfaces the fine T/P/Pm…
        // distinction that the accessible 3-color merge hides)
        const titleAttr = chordScheme === "soundquest" ? ` title="${escapeHtml(sqTooltip(ch))}"` : "";
        html += `<div class="child-box"><span class="chord-name ${cls}"${style}${titleAttr}>${escapeHtml(chordLabel(ch))}</span></div>`;
    }
    html += "</div>";
    el.innerHTML = html;
    const shiftTonic = (delta) => {
        tonicResidue = (tonicResidue + delta + 3) % 3;
        build(); // re-render the panels (colours follow the tonic group)
    };
    document.getElementById("tonicPrev").onclick = () => shiftTonic(-1);
    document.getElementById("tonicNext").onclick = () => shiftTonic(1);
}

// refresh the DOM views (the axis-system panel + the connections list) after any
// change to the chords, coloring, or key.
function build() {
    refreshAxisSystem();
    renderAnalysis();
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

let analysisIdx = 0; // which transition the analysis panel shows
function renderAnalysis() {
    const el = document.getElementById("analysis");
    if (chords.length < 2) {
        el.innerHTML = "<h3>Connections</h3><div style='color:var(--muted)'>Add a second chord to see the connections.</div>";
        return;
    }
    const nT = chords.length - 1;
    analysisIdx = Math.max(0, Math.min(analysisIdx, nT - 1)); // clamp if chords shrank

    // dropdown to pick a single transition (the whole list would be unwieldy)
    const options = chords.slice(0, nT).map((_, i) => `<option value="${i}"${i === analysisIdx ? " selected" : ""}>⟨${i + 1}⟩ ${chordLabel(chords[i])} → ⟨${i + 2}⟩ ${chordLabel(chords[i + 1])}</option>`)
        .join("");
    let html = `<h3>Connections</h3><select id="analysisSel" class="anaSel">${options}</select>`;

    const A = chords[analysisIdx],
        B = chords[analysisIdx + 1];
    voiceLeading(A.pcs, B.pcs, circleOfFifths).forEach((mv) => {
        const s = Math.abs(mv.step);
        let tag, txt;
        if (s === 0) {
            tag = "hold";
            txt = "held";
        } else if (s === 1) {
            tag = circleOfFifths ? "fifth" : "semi";
            txt = circleOfFifths ? (mv.step === 1 ? "P5" : "P4") : "H" + (mv.step === 1 ? "↑" : "↓");
        } else {
            tag = "whole";
            txt = "W"+ (mv.step === 2 ? "↑" : "↓");
        }
        const arrow = `${noteChip(noteName(A, mv.from), mv.from)}→${noteChip(noteName(B, mv.to), mv.to)}`;
        html += `<div class="mv"><b>${arrow}</b><span class="tag ${tag}">${txt}</span></div>`;
    });
    el.innerHTML = html;
    document.getElementById("analysisSel").onchange = (e) => {
        analysisIdx = Number(e.target.value);
        renderAnalysis();
    };
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

function setupUI() {
    progEl = document.getElementById("prog");

    const playBtn = document.getElementById("play");
    playBtn.onclick = () => {
        if (isPlaying()) {
            stopPlayback(); // its onEnd resets the label to "▶ Play"
            return;
        }
        playBtn.textContent = "⏸ Pause";
        playVoicing(DEMO_VOICING, {
            bpm,
            beatsPerChord: meterNum,
            metronome: metronomeOn,
            meterNumerator: meterNum,
            onEnd: () => (playBtn.textContent = "▶ Play"),
        });
    };
    document.getElementById("tempo").oninput = (e) => {
        bpm = bpmFromFraction(Number(e.target.value) / 1000);
        document.getElementById("tempo-val").textContent = Math.round(bpm) + " BPM";
        scheduleUrlUpdate();
    };
    refreshTempoUI();
    document.getElementById("tMetronome").onchange = (e) => {
        metronomeOn = e.target.checked;
        scheduleUrlUpdate();
    };
    document.getElementById("meterNum").oninput = (e) => {
        meterNum = Math.max(1, Math.floor(Number(e.target.value) || 4));
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
