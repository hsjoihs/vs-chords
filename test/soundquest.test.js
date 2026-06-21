/* =====================================================================
 * soundquest.test.js — the SoundQuest coloring data and its pc-set lookup.
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SQ = require("../soundquest-data.js");
const R = require("../theory-roman.js");
const C = require("../theory-chordname.js");

const MAP = SQ.buildSoundquestMap(R.chordToAbsolute, C.parseChord);
const catsOf = (relPcs) => MAP.get([...new Set(relPcs)].sort((a, b) => a - b).join(",")) || [];

test("every ground-truth symbol resolves to a non-empty pitch-class set", () => {
    for (const [sym] of SQ.SOUNDQUEST) {
        const pcs = C.parseChord(R.chordToAbsolute(sym, "C")).pcs;
        assert.ok(pcs && pcs.length > 0, `${sym} produced no pitch classes`);
    }
});

test("single-color lookups match the table", () => {
    // I = {0,4,7} → tonic; V7 = {7,11,2,5} → dominant; IVm = {5,8,0} → subdominant-minor
    assert.deepEqual(catsOf([0, 4, 7]), ["tonic"]);
    assert.deepEqual(catsOf([2, 5, 7, 11]), ["dominant"]); // V7 relative pcs (7,11,2,5)
    assert.deepEqual(catsOf([0, 5, 8]), ["subdominant-minor"]); // IVm
    assert.deepEqual(catsOf([2, 5, 9]), ["subdominant"]); // IIm = D F A
});

test("the multi-color chords carry every applicable category", () => {
    // the examples the user called out
    assert.deepEqual(catsOf([2, 5, 7, 10]), ["dominant", "dominant-minor"]); // Vm7
    assert.deepEqual(catsOf([0, 2, 7]), ["tonic", "dominant"]); // Vsus4 = Isus2
    // ♯IVø7 = ♯IVø = VIm6 → three colors
    assert.deepEqual(catsOf([0, 4, 6, 9]), ["tonic", "pseudotonic", "subdominant"]);
    // dim7 symmetry
    assert.deepEqual(catsOf([0, 3, 6, 9]), ["tonic", "pseudotonic-minor", "subdominant"]);
    // categories always come back in SQ_ORDER
    for (const cats of MAP.values()) {
        const ranks = cats.map((c) => SQ.SQ_ORDER.indexOf(c));
        assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `unordered: ${cats}`);
    }
});

test("Vsus4 and Isus2 really are the same pitch-class set", () => {
    const sus4 = C.parseChord(R.chordToAbsolute("Vsus4", "C")).pcs;
    const sus2 = C.parseChord(R.chordToAbsolute("Isus2", "C")).pcs;
    assert.deepEqual(
        [...new Set(sus4)].sort((a, b) => a - b),
        [...new Set(sus2)].sort((a, b) => a - b),
    );
});

test("buildSoundquestDetail keeps the contributing symbols per category", () => {
    const detail = SQ.buildSoundquestDetail(R.chordToAbsolute, C.parseChord);
    const dimD = detail.get("0,3,6,9"); // I°7 and its enharmonic equivalents
    // categories in SQ_ORDER, each with the symbols that produced them
    assert.deepEqual(dimD.map((d) => d.category), ["tonic", "pseudotonic-minor", "subdominant"]);
    const byCat = Object.fromEntries(dimD.map((d) => [d.category, d.symbols]));
    assert.ok(byCat["tonic"].includes("Idim7"));
    assert.ok(byCat["pseudotonic-minor"].includes("♭IIIdim7"));
    assert.ok(byCat["subdominant"].includes("♯IVdim7"));
    // detail categories agree with the plain map
    for (const [key, cats] of MAP) {
        assert.deepEqual(detail.get(key).map((d) => d.category), cats, key);
    }
});

test("soundquestKey reduces relative to the chosen tonic", () => {
    // a C-major triad in the key of C is {0,4,7}; in the key of G it's {5,9,0}→sorted
    assert.equal(SQ.soundquestKey([0, 4, 7], 0), "0,4,7");
    assert.equal(SQ.soundquestKey([0, 4, 7], 7), "0,5,9"); // (0-7,4-7,7-7) mod 12 = 5,9,0
});
