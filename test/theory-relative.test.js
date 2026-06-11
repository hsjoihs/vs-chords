"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../theory-relative.js");

test("convert degrees into chord name", () => {
    assert.deepEqual(
        T.single.toAbsolute("IV", "D"), "G"
    );

    assert.deepEqual(
        T.single.toAbsolute("♭III", "D♭"), "F♭"
    );
});

test("convert degrees into chord name", () => {
    assert.deepEqual(
        ["IV", "V", "I", "III7", "IV", "iv", "I", "II7", "♭VII", "♭VII7"]
            .map(rel => T.chord.toAbsolute(rel, "D")),
        ["G", "A", "D", "F♯7", "G", "Gm", "D", "E7", "C", "C7"]
    );

    assert.deepEqual(
        ["IΔ7", "VIm7", "IV♯m7(♭5)", "IVm6", "IIIm7", "♭IIIdim7", "IIm7", "V7"]
            .map(rel => T.chord.toAbsolute(rel, "E♭")),
        ["E♭Δ7", "Cm7", "Am7(♭5)", "A♭m6", "Gm7", "G♭dim7", "Fm7", "B♭7"]
    );

    assert.deepEqual(
        "IVM7 - V+/IV - IIIm7 - VI+(#9) - IIm7 - V+7 - I".split(" - ")
            .map(rel => T.chord.toAbsolute(rel, "C♯")),
        "F♯M7 G♯+/F♯ E♯m7 A♯+(#9) D♯m7 G♯+7 C♯".split(" ")
    );

    assert.deepEqual(
        "vi - IV - V - I - vi - IV - V - vi".split(" - ")
            .map(rel => T.chord.toAbsolute(rel, "B")),
        "G♯m → E → F♯ → B → G♯m → E → F♯ → G♯m".split(" → ")
    );

    assert.deepEqual(
        "IV - IV∅ - iii - vi - iim7 - V7 - VIsus4 - VI".split(" - ") /* allow redundant notation "iim7" = "IIm7" = "ii7" */
        .map(rel => T.chord.toAbsolute(rel, "A")),
        "D D∅ C♯m F♯m Bm7 E7 F♯sus4 F♯".split(" ")
    );

    assert.deepEqual(
        "IV♯△7/IV → V7 → I".split(" → ").map(rel => T.chord.toAbsolute(rel, "A")),
        "D♯△7/D E7 A".split(" ")
    );

    assert.deepEqual(
        "I - ♭IIMaj7 - ii7 - ♯ii°7 - iii7 - ♭III7 - ii7 - ♭II7".split(" - ").map(rel => T.chord.toAbsolute(rel, "C")),
        "C - D♭Maj7 - Dm7 - D♯°7 - Em7 - E♭7 - Dm7 - D♭7".split(" - ")
    );

});