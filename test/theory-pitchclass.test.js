/* =====================================================================
 * theory-pitchclass.test.js — ring arrangement & note-to-note connections.
 *
 * The voice-leading tests use parseChord (from theory-chordname) only to build
 * readable pitch-class fixtures from chord symbols; the behaviour under test is
 * all in theory-pitchclass.
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = { ...require("../theory-pitchclass.js"), ...require("../theory-chordname.js") };

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

/* ---- ring arrangement: chromatic vs circle of fifths --------------- */

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
