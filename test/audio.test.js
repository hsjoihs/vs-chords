/* =====================================================================
 * audio.test.js — note-name → MIDI / frequency conversion.
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../audio.js");

test("noteToMidi places middle C at 60 and A4 at 69", () => {
    assert.equal(A.noteToMidi("C4"), 60);
    assert.equal(A.noteToMidi("A4"), 69);
    assert.equal(A.noteToMidi("C-1"), 0); // the bottom of the MIDI range
});

test("noteToMidi handles the demo voicing", () => {
    const got = {};
    for (const n of ["C2", "C4", "E4", "G4", "B4", "A2", "C#4", "A4", "D2", "F4", "G2"]) got[n] = A.noteToMidi(n);
    assert.deepEqual(got, {
        C2: 36, C4: 60, E4: 64, G4: 67, B4: 71,
        A2: 45, "C#4": 61, A4: 69, D2: 38, F4: 65, G2: 43,
    });
});

test("noteToMidi handles every accidental spelling", () => {
    assert.equal(A.noteToMidi("C#4"), 61);
    assert.equal(A.noteToMidi("C♯4"), 61);
    assert.equal(A.noteToMidi("D♭4"), 61);
    assert.equal(A.noteToMidi("Db4"), 61);
    assert.equal(A.noteToMidi("Cx4"), 62); // C double-sharp
    assert.equal(A.noteToMidi("C##4"), 62);
    assert.equal(A.noteToMidi("Dbb4"), 60); // D double-flat = C
    assert.equal(A.noteToMidi("E♯3"), A.noteToMidi("F3"));
    assert.throws(() => A.noteToMidi("H4"), /Bad note/);
    assert.throws(() => A.noteToMidi("C"), /Bad note/); // needs an octave
});

test("midiToFrequency / noteToFrequency use A4 = 440 Hz equal temperament", () => {
    assert.equal(A.midiToFrequency(69), 440);
    assert.ok(Math.abs(A.noteToFrequency("A4") - 440) < 1e-9);
    assert.ok(Math.abs(A.noteToFrequency("C4") - 261.625565) < 1e-4); // middle C
    assert.ok(Math.abs(A.noteToFrequency("A5") - 880) < 1e-9); // an octave up doubles
    assert.ok(Math.abs(A.noteToFrequency("A3") - 220) < 1e-9); // an octave down halves
});
