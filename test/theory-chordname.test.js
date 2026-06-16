/* =====================================================================
 * theory-chordname.test.js — parser tests, written so a musician can eyeball them.
 *
 * Each row is  [ "what you type", "the notes it must spell" ].
 * Spelling is checked literally, so enharmonics must be RIGHT:
 *   Fm is  F A♭ C   (never F G♯ C)
 *
 * Accidental glyphs in the expected strings:
 *   ♯  sharp          ♭  flat
 *   x  double-sharp   ♭♭ double-flat
 *
 * Run with:  node --test
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../theory-chordname.js");

const spell = (sym) => T.spellChord(sym).join(" ");

/* ---- triads -------------------------------------------------------- */
const TRIADS = [
    ["C", "C E G"],
    ["Cm", "C E♭ G"],
    ["Fm", "F A♭ C"], // the canonical "spell it right" case
    ["D", "D F♯ A"],
    ["B♭", "B♭ D F"],
    ["Cdim", "C E♭ G♭"],
    ["Caug", "C E G♯"],
    ["F♯+", "F♯ A♯ Cx"], // augmented 5th of F♯ is C-double-sharp
    ["Csus4", "C F G"],
    ["Csus2", "C D G"],
    ["C5", "C G"],
];

/* ---- sevenths & friends ------------------------------------------- */
const SEVENTHS = [
    ["G7", "G B D F"], // the textbook dominant
    ["Cmaj7", "C E G B"],
    ["Am7", "A C E G"],
    ["Dm7", "D F A C"],
    ["A7", "A C♯ E G"],
    ["E7", "E G♯ B D"],
    ["B♭maj7", "B♭ D F A"],
    ["Cm7b5", "C E♭ G♭ B♭"], // half-diminished spelled with flats
    ["Eø", "E G B♭ D"],
    ["C@", "C D G♭ B♭"], // blackadder
    ["Bdim7", "B D F A♭"],
    ["Cdim7", "C E♭ G♭ B♭♭"], // diminished 7th really is a double-flat
];

/* ---- the two progressions from the brief --------------------------- */
const PROG1 = [
    ["Gm", "G B♭ D"],
    ["F♯+", "F♯ A♯ Cx"],
    ["B♭/F", "B♭ D F"], // bass checked separately below
    ["Eø", "E G B♭ D"],
];
const PROG2 = [
    ["Am7", "A C E G"],
    ["Dø(9,13)omit3", "D A♭ C E B"],
    ["G7(b9,13)omit5", "G B F A♭ E"],
    ["C", "C E G"],
];

function tableTest(name, rows) {
    test(name, () => {
        for (const [sym, expected] of rows) {
            assert.equal(spell(sym), expected, `${sym}  →  expected "${expected}", got "${spell(sym)}"`);
        }
    });
}

tableTest("triads spell correctly", TRIADS);
tableTest("sevenths & extensions spell correctly", SEVENTHS);
tableTest("progression 1: Gm → F♯+ → B♭/F → Eø", PROG1);
tableTest("progression 2: Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C", PROG2);

/* ---- slash chord keeps its bass ------------------------------------ */
test("slash chord exposes the bass note", () => {
    const c = T.parseChord("B♭/F");
    assert.equal(c.bass, "F");
    assert.deepEqual(
        c.notes.map((n) => n.name),
        ["B♭", "D", "F"],
    );
});

/* ---- ASCII and Unicode notations are interchangeable --------------- */
test("ASCII '#'/'b' match Unicode '♯'/'♭'", () => {
    assert.equal(spell("F#+"), spell("F♯+"));
    assert.equal(spell("Bb"), spell("B♭"));
    assert.equal(spell("C#m7b5"), spell("C♯m7♭5"));
    assert.equal(spell("Cdim7"), spell("C°7"));
    assert.equal(spell("Cm7b5"), spell("Cø"));
});

/* ---- pitch-class sets --------------------------------------------- */
test("pitch-class sets are correct (C=0 … B=11)", () => {
    assert.deepEqual(T.parseChord("G7").pcs, [7, 11, 2, 5]);
    assert.deepEqual(T.parseChord("C").pcs, [0, 4, 7]);
    // Dø(9,13)omit3 = D A♭ C E B = 2,8,0,4,11
    assert.deepEqual(T.parseChord("Dø(9,13)omit3").pcs, [2, 8, 0, 4, 11]);
});

/* ---- progressions parse end to end -------------------------------- */
test("a full progression string parses into the right number of chords", () => {
    const p = T.parseProgression("Gm → F♯+ → B♭/F → Eø");
    assert.equal(p.length, 4);
    assert.equal(p[1].notes.map((n) => n.name).join(" "), "F♯ A♯ Cx");

    const q = T.parseProgression("Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C");
    assert.equal(q.length, 4);
    // commas inside (9,13) must NOT split the chord apart
    assert.equal(q[1].notes.length, 5);
});

/* ---- garbage is rejected ------------------------------------------ */
test("nonsense symbols throw", () => {
    assert.throws(() => T.parseChord("H7"), /root/i);
    assert.throws(() => T.parseChord("Cbogus"), /Unknown chord/i);
    assert.throws(() => T.parseChord("Gqux9"), /Unknown chord/i);
});

/* =====================================================================
 * Line / spiral of fifths — the spelling slider
 * ===================================================================== */

/* ---- a 12-segment of the spiral, and sliding it ------------------- */
test("a length-12 window of the spiral of fifths, and a notch left", () => {
    // the worked example from the brief
    assert.deepEqual(T.windowFifths(-3), ["E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯"]);
    // shifting one notch toward the flat side
    assert.deepEqual(T.windowFifths(-4), ["A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"]);
});

test("the extremes are all-flat and all-sharp", () => {
    // every 12-window has the 7 naturals plus 5 accidental black keys
    assert.deepEqual(T.windowFifths(-6), ["G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B"]);
    assert.deepEqual(T.windowFifths(-1), ["F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯"]);
});

test("nameInWindow flips an enharmonic pair as the window slides", () => {
    // pitch class 6 is F♯ in a sharp window, G♭ in a flat one
    assert.equal(T.nameInWindow(6, -1), "F♯");
    assert.equal(T.nameInWindow(6, -6), "G♭");
    // the white keys never change
    assert.equal(T.nameInWindow(0, -6), "C");
    assert.equal(T.nameInWindow(0, -1), "C");
});

/* ---- auto-fitting the slider to a parsed chord -------------------- */
// spell a chord's pitch classes through the window auto-chosen for it
function viaWindow(sym) {
    const c = T.parseChord(sym);
    const start = T.bestFifthStart(c.notes);
    return c.pcs.map((pc) => T.nameInWindow(pc, start)).join(" ");
}

test("auto-fit reproduces the symbol's spelling for diatonic chords", () => {
    assert.equal(viaWindow("C"), "C E G");
    assert.equal(viaWindow("G7"), "G B D F");
    assert.equal(viaWindow("Fm"), "F A♭ C"); // leans flat, gets A♭ (not G♯)
    assert.equal(viaWindow("Cm"), "C E♭ G");
    assert.equal(viaWindow("Cmaj7"), "C E G B");
    assert.equal(viaWindow("B♭"), "B♭ D F");
    assert.equal(viaWindow("Eø"), "E G B♭ D");
    assert.equal(viaWindow("A7"), "A C♯ E G"); // leans sharp, gets C♯
    assert.equal(viaWindow("D"), "D F♯ A");
});

test("auto-fit leans the right way even when it cannot be exact", () => {
    // F♯+ wants a double-sharp (Cx) the slider cannot reach, but it should
    // still pick a sharp window so F♯ and A♯ are spelled with sharps
    const c = T.parseChord("F♯+");
    const start = T.bestFifthStart(c.notes);
    assert.equal(T.nameInWindow(6, start), "F♯");
    assert.equal(T.nameInWindow(10, start), "A♯");
});

test("bestFifthStart stays inside the offered slider range", () => {
    for (const sym of ["C", "F♯+", "Cdim7", "G♭7", "Am7", "E7", "Fm"]) {
        const start = T.bestFifthStart(T.parseChord(sym).notes);
        assert.ok(start >= T.FIFTH_MIN && start <= T.FIFTH_MAX, `${sym} -> ${start} out of range`);
    }
});


/* ---- describe(): naming a hand-built set with a tagged root ------- */
test("describe uses a tagged root and the chosen window", () => {
    // {F, A♭, C} with F tagged as root, flat window -> "Fm"
    assert.equal(T.describe([5, 8, 0], 5, -4), "Fm");
    // same notes, no root tag -> still recognises a minor triad somewhere
    assert.equal(T.describe([5, 8, 0]), "Fm");
    // a symmetric diminished seventh: the tagged root names the chord, and the
    // window decides how that root is spelled
    assert.equal(T.describe([0, 3, 6, 9], 3, -1), "D♯dim7"); // sharp window: pc3 = D♯
    assert.equal(T.describe([0, 3, 6, 9], 3, -6), "E♭dim7"); // flat window:  pc3 = E♭
});

/* ---- describe ⟷ parseChord round-trip ----------------------------- */
// the core contract: naming a set then re-parsing it yields the same notes
const sortSet = (a) => [...new Set(a)].sort((x, y) => x - y);

const ROUNDTRIP_SYMBOLS = [
    // triads & suspensions
    "C", "Cm", "Cdim", "Caug", "Csus2", "Csus4", "C5",
    // sixths & sevenths
    "C6", "Cm6", "C69", "C7", "CΔ7", "Cm7", "Cm7b5", "Eø", "Cdim7", "CmM7",
    // extensions
    "C9", "Cmaj9", "Cm9", "C11", "Cm11", "C13", "Cmaj13", "Cadd9",
    // altered dominants
    "C7b9", "C7#9", "C7#11", "C7b5", "Caug7", "G7(b9,13)omit5",
    // the awkward ones
    "F#+", "Dø(9,13)omit3", "Bbmaj7", "A7", "G13", "F#m7b5", "Abm",
    // slash chords (pc set includes the bass)
    "C/D", "E7/D", "Bb/F",
];

test("describe → parseChord round-trips the pitch-class set (named root)", () => {
    for (const sym of ROUNDTRIP_SYMBOLS) {
        const c = T.parseChord(sym);
        const name = T.describe(c.pcs, c.rootPc, null);
        const got = T.parseChord(name).pcs;
        assert.deepEqual(sortSet(got), sortSet(c.pcs), `${sym} → "${name}" → ${got}`);
    }
});

test("describe → parseChord round-trips with an auto-chosen root", () => {
    for (const sym of ROUNDTRIP_SYMBOLS) {
        const c = T.parseChord(sym);
        const name = T.describe(c.pcs, null, null);
        const got = T.parseChord(name).pcs;
        assert.deepEqual(sortSet(got), sortSet(c.pcs), `${sym} → "${name}" → ${got}`);
    }
});

// describe() must be injective. The strongest possible check: EVERY pitch-class
// set of 0..11 notes must round-trip (re-parse to the same set), for a tagged
// root and for an auto-chosen root — 4095 cases, the empty set ("N.C.") through
// every 11-note set. (The earlier version only built sets of 1..7 notes, so it
// never exhausted the chord grammar — which tops out near 10 distinct degrees per
// root — and missed sets that collapsed to a bare root.) Only the 12-note
// chromatic aggregate is excluded; it cannot be written as a chord symbol.
test("describe → parseChord round-trips EVERY pitch-class set of 0..11 notes", () => {
    let covered = 0;
    for (let mask = 0; mask < 4096; mask++) {
        const pcs = [];
        for (let pc = 0; pc < 12; pc++) if (mask & (1 << pc)) pcs.push(pc);
        if (pcs.length === 12) continue; // the chromatic aggregate is not a chord
        covered++;
        for (const root of [pcs[0] ?? null, null]) {
            const name = T.describe(pcs, root, null);
            const got = T.parseChord(name).pcs;
            assert.deepEqual(sortSet(got), sortSet(pcs), `set ${pcs} (root ${root}) → "${name}" → ${got}`);
        }
    }
    assert.equal(covered, 4095, "should cover 4095 sets (empty set through every 11-note set)");
});

// the empty set is "N.C." (no chord), and it round-trips
test("the empty pitch-class set is N.C.", () => {
    assert.equal(T.describe([], null, null), "N.C.");
    assert.deepEqual(T.parseChord("N.C.").pcs, []);
    // common ASCII spellings are all accepted
    for (const s of ["NC", "N.C", "n.c.", "N.C."]) assert.deepEqual(T.parseChord(s).pcs, []);
});

// the reported bug: an 11-note set was named "C", colliding with the C triad
test("a large hand-built set is not collapsed to a bare root", () => {
    const pcs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // C C♯ D E♭ E F F♯ G G♯ A B♭
    const name = T.describe(pcs, 0, -3);
    assert.notEqual(name, "C", "an 11-note set must not be named just 'C'");
    assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet(pcs), `"${name}"`);
});

// the only set that cannot be a chord symbol — handle it gracefully, and never
// collapse it to a triad (which would break injectivity against that triad)
test("the 12-note chromatic aggregate is handled without collapsing to a triad", () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const name = T.describe(all, 0, -3);
    assert.notEqual(name, "C");
    assert.doesNotThrow(() => T.parseChord(name), `"${name}" must still parse`);
});

// toggling a note off then on must not
// degrade the chip into an unparseable "C·D·E·…" string
test("toggling a note keeps the chip a real, re-parseable symbol", () => {
    const c = T.parseChord("Dø(9,13)omit3"); // D A♭ C E B, root D=2
    // simulate the ring editor: drop E (pc 4) then add it back, sorted order
    let pcs = c.pcs.filter((p) => p !== 4);
    pcs = [...pcs, 4].sort((a, b) => a - b);
    const name = T.describe(pcs, c.rootPc, -3);
    assert.ok(!name.includes("·"), `expected a real symbol, got "${name}"`);
    assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet(c.pcs), `"${name}"`);
});


// C7omit5 must not degrade into an ugly C(omit3,omit5,3,b7) 
// omit3 and 3 must not coexist
test("toggling a note does not cause omit3 and 3 to appear simultaneously", () => {
    const c = T.parseChord("C7omit5");
    const name = T.describe(c.pcs, c.rootPc, -3);
    assert.ok(!(name.includes("omit3") && name.includes(",3,")), `expected omit3 and 3 to NOT coexist, got "${name}"`);
    assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet(c.pcs), `"${name}"`);
});

// [2] a 7th is spelled through the base quality, never as a parenthesised tension
test("describe spells a 7th through the base, not as a tension", () => {
    assert.equal(T.describe([0, 7, 10], 0, -3), "C7(omit3)"); // C G B♭
    assert.equal(T.describe([0, 7, 11], 0, -3), "CΔ7(omit3)"); // C G B
    assert.equal(T.describe([0, 4, 10], 0, -3), "C7(omit5)"); // C E B♭
});

// [1] quartal symbols (q/q7/q10/q13) are reserved for purely quartal chords
test("describe never writes a quartal chord with a tension", () => {
    assert.equal(T.describe([7, 0, 5], 7, -3), "Gq7"); // a pure quartal chord still uses q7
    for (const pcs of [[0, 5, 10, 2], [0, 4, 5, 10], [0, 5, 10, 1], [0, 5, 11]]) {
        const name = T.describe(pcs, pcs[0], -3);
        assert.ok(!/q/.test(name), `quartal+tension leaked "q": ${JSON.stringify(pcs)} -> "${name}"`);
        assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet(pcs), `"${name}"`);
    }
});

// exception: with BOTH 7ths there is no convention, so just never write x6
test("describe avoids x6 when both 7ths are present, and round-trips", () => {
    const name = T.describe([0, 7, 10, 11], 0, -3); // C G B♭ B
    assert.ok(!name.includes("x6"), `expected no x6, got "${name}"`);
    assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet([0, 7, 10, 11]), `"${name}"`);
});

// a flatted 5th is an altered 5th, avoiding "omit5" + "#11" for the sake of simplicity
test("describe alters the 5th instead of omit5 + #11", () => {
    assert.equal(T.describe([5, 9, 11, 3], 5, -3), "F7(b5)"); // F A B E♭
    assert.equal(T.describe([0, 4, 6], 0, -3), "C(b5)"); // C E G♭
    for (const pcs of [[5, 9, 11, 3], [0, 4, 6], [0, 4, 6, 11], [9, 1, 3, 7]]) {
        const name = T.describe(pcs, pcs[0], -3);
        assert.ok(!(name.includes("omit5") && name.includes("#11")), `omit5 + #11 in "${name}"`);
        assert.deepEqual(sortSet(T.parseChord(name).pcs), sortSet(pcs), `"${name}"`);
    }
    // …but a genuine #11 over a present perfect 5th stays a #11
    assert.equal(T.describe([0, 4, 6, 7, 11], 0, -3), "CΔ7(#11)"); // C E G♭ G B
});