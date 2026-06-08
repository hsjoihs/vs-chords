/* =====================================================================
 * theory.test.js — parser tests, written so a musician can eyeball them.
 *
 * Each row is  [ "what you type", "the notes it must spell" ].
 * Spelling is checked literally, so enharmonics must be RIGHT:
 *   Fm is  F A♭ C   (never F G♯ C)
 *   B°7 is C... etc.
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
const T = require("../theory.js");

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

/* ---- voice leading: the G7 → C tritone resolution ------------------ */
test("G7 → C resolves the tritone by two semitones, 4 st total", () => {
    const A = T.parseChord("G7").pcs; // 7 11 2 5  (G B D F)
    const B = T.parseChord("C").pcs; // 0 4 7     (C E G)
    const moves = T.voiceLeading(A, B);
    const total = moves.reduce((s, m) => s + Math.abs(m.dist), 0);
    assert.equal(total, 4);
    // B(11) → C(0) is +1 ; F(5) → E(4) is -1
    const byFrom = Object.fromEntries(moves.map((m) => [m.from, m.dist]));
    assert.equal(byFrom[11], 1, "B should rise a semitone to C");
    assert.equal(byFrom[5], -1, "F should fall a semitone to E");
    assert.equal(T.hasTritone(A), true);
    assert.equal(T.hasTritone(B), false);
});

/* ---- garbage is rejected ------------------------------------------ */
test("nonsense symbols throw", () => {
    assert.throws(() => T.parseChord("H7"), /root/i);
    assert.throws(() => T.parseChord("Cbogus"), /Unknown chord/i);
    assert.throws(() => T.parseChord("Gqux9"), /Unknown chord/i);
});
