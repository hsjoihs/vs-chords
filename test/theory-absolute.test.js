/* =====================================================================
 * theory-absolute.test.js — parser tests, written so a musician can eyeball them.
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
const T = require("../theory-absolute.js");

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

/* ---- connections: every pair within a whole tone ------------------- */
// collect the moves as an order-independent set of "from→to" pitch-class pairs
function connections(symA, symB) {
    return new Set(T.voiceLeading(T.parseChord(symA).pcs, T.parseChord(symB).pcs).map((m) => `${m.from}-${m.to}`));
}

test("A7 → Dm7 fans each note out to every neighbour within a whole tone", () => {
    // A=9 C♯=1 E=4 G=7 ;  D=2 F=5 A=9 C=0
    // expected: A→A, C♯→C, C♯→D, E→D, E→F, G→F, G→A
    const got = connections("A7", "Dm7");
    const want = new Set(["9-9", "1-0", "1-2", "4-2", "4-5", "7-5", "7-9"]);
    assert.deepEqual(got, want);
});

test("every drawn connection moves by at most a whole tone", () => {
    for (const [a, b] of [
        ["G7", "C"],
        ["Cmaj7", "A7"],
        ["Dm7", "G7"],
        ["Am7", "Dm7"],
    ]) {
        for (const m of T.voiceLeading(T.parseChord(a).pcs, T.parseChord(b).pcs)) {
            assert.ok(Math.abs(m.dist) <= T.MAX_VOICE_STEP, `${a}→${b}: ${m.from}->${m.to} = ${m.dist}`);
        }
    }
});

test("G7 → C still shows the tritone resolving by semitones", () => {
    const A = T.parseChord("G7").pcs; // G B D F
    const B = T.parseChord("C").pcs; // C E G
    const conn = connections("G7", "C");
    assert.ok(conn.has("11-0"), "B → C (+1 semitone)");
    assert.ok(conn.has("5-4"), "F → E (-1 semitone)");
    assert.equal(T.hasTritone(A), true);
    assert.equal(T.hasTritone(B), false);
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

/* =====================================================================
 * Ring arrangement: chromatic vs circle of fifths
 * ===================================================================== */

test("circle of fifths sends every other vertex to its antipode", () => {
    for (let pc = 0; pc < 12; pc++) {
        assert.equal(T.ringIndex(pc, false), pc); // chromatic = identity
        if (pc % 2 === 0) {
            assert.equal(T.ringIndex(pc, true), pc); // even pcs stay put
        } else {
            assert.equal(T.ringIndex(pc, true), (pc + 6) % 12); // odd pcs -> antipode
        }
    }
});

test("a step is a semitone chromatically but a fifth in circle-of-fifths mode", () => {
    // C(0)→G(7): one step on the circle of fifths, five steps chromatically
    assert.equal(Math.abs(T.ringStep(0, 7, true)), 1);
    assert.equal(T.ringStep(0, 7, false), -5);
    // a whole tone is two steps in BOTH arrangements
    assert.equal(Math.abs(T.ringStep(0, 2, true)), 2);
    assert.equal(Math.abs(T.ringStep(0, 2, false)), 2);
    // a chromatic semitone is one step chromatically, five in fifths (so not connected)
    assert.equal(Math.abs(T.ringStep(0, 1, false)), 1);
    assert.equal(Math.abs(T.ringStep(0, 1, true)), 5);
});

test("voiceLeading connects fifths (not semitones) in circle-of-fifths mode", () => {
    const key = (m) => `${m.from}-${m.to}`;
    const fifths = new Set(T.voiceLeading([0], [7, 2, 1], true).map(key));
    assert.ok(fifths.has("0-7"), "a fifth is one step → connected");
    assert.ok(fifths.has("0-2"), "a whole tone is two steps → connected");
    assert.ok(!fifths.has("0-1"), "a semitone is five steps → not connected");

    const chrom = new Set(T.voiceLeading([0], [7, 2, 1], false).map(key));
    assert.ok(chrom.has("0-1"), "a semitone is one step chromatically → connected");
    assert.ok(chrom.has("0-2"), "a whole tone → connected");
    assert.ok(!chrom.has("0-7"), "a fifth is five steps chromatically → not connected");
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

test("describe → parseChord round-trips arbitrary pitch-class sets", () => {
    // deterministic LCG so failures are reproducible
    let seed = 0x2545f4914f6cdd1d % 2147483647;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let iter = 0; iter < 500; iter++) {
        const size = 1 + Math.floor(rand() * 7); // 1..7 notes
        const set = new Set();
        while (set.size < size) set.add(Math.floor(rand() * 12));
        const pcs = [...set];
        for (const root of [pcs[0], null]) {
            const name = T.describe(pcs, root, null);
            const got = T.parseChord(name).pcs;
            assert.deepEqual(sortSet(got), sortSet(pcs), `set ${pcs} (root ${root}) → "${name}" → ${got}`);
        }
    }
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