/* =====================================================================
 * voicing.test.js — the statistical-mechanics voicing generator.
 * Seeded sampling makes every case here deterministic and reproducible.
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../voicing.js");

// the demo progression CM7 → A7 → Dm7 → G7 as { rootPc, pcs }
const PROG = [
    { rootPc: 0, pcs: [0, 4, 7, 11] }, // CM7  C E G B
    { rootPc: 9, pcs: [9, 1, 4, 7] }, // A7   A C# E G
    { rootPc: 2, pcs: [2, 5, 9, 0] }, // Dm7  D F A C
    { rootPc: 7, pcs: [7, 11, 2, 5] }, // G7   G B D F
];
// the target voicing (bass + ascending upper midis)
const DEMO = [
    { bass: 36, uppers: [60, 64, 67, 71] },
    { bass: 45, uppers: [61, 64, 67, 69] },
    { bass: 38, uppers: [60, 62, 65, 69] },
    { bass: 43, uppers: [62, 65, 67, 71] },
];
const eqChord = (a, b) => a.bass === b.bass && a.uppers.length === b.uppers.length && a.uppers.every((x, i) => x === b.uppers[i]);
const eqVoicing = (v) => v.every((c, i) => eqChord(c, DEMO[i]));

test("hasTritone: only dominant-type chords (A7, G7) hold a tritone", () => {
    assert.equal(V.hasTritone([0, 4, 7, 11]), false); // CM7
    assert.equal(V.hasTritone([9, 1, 4, 7]), true); // A7  (C#–G)
    assert.equal(V.hasTritone([2, 5, 9, 0]), false); // Dm7
    assert.equal(V.hasTritone([7, 11, 2, 5]), true); // G7  (F–B)
});

test("penalty: minor 2nd mild, minor 9th-and-wider heavy, major 7th free", () => {
    assert.equal(V.penalty(1, false), V.EPS_M2); // bare minor 2nd
    assert.equal(V.penalty(13, false), V.EPS_M9); // minor 9th (avoid note)
    assert.equal(V.penalty(25, false), V.EPS_M9); // minor 16th — still an avoid note
    assert.equal(V.penalty(11, false), 0); // major 7th — the mellow one
    assert.equal(V.penalty(2, false), 0); // whole tone
    assert.equal(V.penalty(12, false), 0); // octave
    assert.ok(V.EPS_M9 > V.EPS_M2); // "heavily" outweighs "somewhat"
});

test("penalty: a tritone in the chord lifts both penalties", () => {
    assert.equal(V.penalty(1, true), 0);
    assert.equal(V.penalty(13, true), 0);
});

test("potential is a parabola with its minimum at the centre", () => {
    assert.equal(V.potential(66, 66, 3.4), 0);
    assert.equal(V.potential(60, 66, 3.4), V.potential(72, 66, 3.4)); // symmetric
    assert.ok(V.potential(60, 66, 3.4) < V.potential(48, 66, 3.4)); // steeper further out
});

test("octaveCandidates lists a pitch class's octaves inside the window", () => {
    assert.deepEqual(V.octaveCandidates(0, 36, 84), [36, 48, 60, 72, 84]); // every C, C2..C6
    assert.deepEqual(V.octaveCandidates(6, 36, 84), [42, 54, 66, 78]); // F#2..F#5
});

test("placementOrder settles the well-centred voices first, the ambiguous ones last", () => {
    // for CM7 the distances-to-F#4 are G:1, E:2, B:5, C:6 → C (a tritone from the
    // centre, equidistant either octave) is placed last
    assert.deepEqual(V.placementOrder([0, 4, 7, 11]), [7, 4, 11, 0]);
});

test("boltzmannPick collapses onto the lowest energy as T → 0", () => {
    const idx = V.boltzmannPick([2, 0, 3], 1e-6, () => 0.999);
    assert.equal(idx, 1); // the minimum-energy state, whatever the random draw
});

test("generateVoicing is deterministic for a given seed", () => {
    const a = V.generateVoicing(PROG, { S: 3.4, T: 1, seed: 12345 });
    const b = V.generateVoicing(PROG, { S: 3.4, T: 1, seed: 12345 });
    assert.deepEqual(a, b);
    assert.equal(a.length, 4);
    assert.equal(a[0].uppers.length, 4); // four chord tones up top
});

test("the demo voicing is the modal outcome at S=3.4, T=1", () => {
    const N = 4000;
    let demo = 0;
    const freq = new Map();
    for (let s = 0; s < N; s++) {
        const v = V.generateVoicing(PROG, { S: 3.4, T: 1, seed: s });
        if (eqVoicing(v)) demo++;
        const key = v.map((c) => c.bass + ":" + c.uppers.join(",")).join("|");
        freq.set(key, (freq.get(key) || 0) + 1);
    }
    const topCount = Math.max(...freq.values());
    assert.ok(demo / N > 0.12, `demo prob ${(demo / N).toFixed(3)} should exceed 0.12`);
    assert.equal(demo, topCount, "the demo voicing should be the single most frequent outcome");
});

test("lowering the temperature freezes the system onto the demo voicing", () => {
    const N = 2000;
    let demo = 0;
    for (let s = 0; s < N; s++) if (eqVoicing(V.generateVoicing(PROG, { S: 3.4, T: 0.3, seed: s }))) demo++;
    assert.ok(demo / N > 0.5, `at T=0.3 demo prob ${(demo / N).toFixed(3)} should exceed 0.5`);
});
