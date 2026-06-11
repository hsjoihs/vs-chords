/* =====================================================================
 * theory-relative.js — Roman-numeral (relative) ⟶ absolute conversion.
 *
 * Builds on theory-absolute.js for correct enharmonic note spelling.
 *
 *   single.toAbsolute("IV", "D")     === "G"
 *   single.toAbsolute("♭III", "D♭")  === "F♭"
 *   chord.toAbsolute("V7", "D")      === "A7"
 *   chord.toAbsolute("iim7", "A")    === "Bm7"
 *   chord.toAbsolute("V+/IV", "C♯")  === "G♯+/F♯"   (slash bass is a degree too)
 *
 * A relative chord token is  [accidental] ROMAN [accidental] [quality] [/bass]:
 *   - the Roman numeral's number gives the scale degree (I..VII);
 *   - its case gives the triad quality (UPPER = major, lower = minor) — but an
 *     explicit quality suffix (m7, °7, Δ7, +, sus…) overrides the case;
 *   - accidentals before the numeral (or right after it) shift the degree;
 *   - a /XXX suffix names the bass as another relative degree.
 * ===================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api; // Node / tests
    } else {
        Object.assign(root, api); // browser
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // note-spelling primitives from the absolute layer
    const ABS = typeof require !== "undefined" ? require("./theory-absolute.js") : self;
    const parseNote = ABS.parseNote;
    const formatNote = ABS.formatNote;

    const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
    const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
    const MAJOR = [0, 2, 4, 5, 7, 9, 11]; // major-scale semitone of each degree
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
    const mod12 = (n) => ((n % 12) + 12) % 12;

    // number of semitone shifts encoded by a run of accidentals (♯/♭/x/bb)
    function accValue(s) {
        let v = 0;
        for (const ch of s || "") {
            if (ch === "♯" || ch === "#") v += 1;
            else if (ch === "♭" || ch === "b") v -= 1;
            else if (ch === "x" || ch === "𝄪") v += 2;
            else if (ch === "𝄫") v -= 2;
        }
        return v;
    }

    // spell scale degree `deg` (1..7, shifted by `accVal`) above `key`
    function degreeNote(accVal, deg, key) {
        const k = parseNote(key);
        const semis = MAJOR[deg - 1] + accVal;
        const letter = LETTERS[(LETTER_IDX[k.letter] + (deg - 1)) % 7];
        const targetPc = mod12(k.pc + semis);
        let acc = mod12(targetPc - LETTER_PC[letter]);
        if (acc > 6) acc -= 12; // nearest spelling (range -5..+6)
        return formatNote(letter, acc);
    }

    // split a relative token into degree accidentals, roman, quality, bass
    function parseRelative(tok) {
        let main = String(tok).trim();
        let bass = null;
        const slash = main.indexOf("/");
        if (slash >= 0) {
            bass = main.slice(slash + 1);
            main = main.slice(0, slash);
        }
        const m = main.match(/^([♭♯#b𝄪𝄫x]*)([IiVv]+)([♭♯#b𝄪𝄫x]*)(.*)$/);
        if (!m) throw new Error("Bad relative chord: " + tok);
        return { acc: m[1] + m[3], roman: m[2], quality: m[4], bass };
    }

    function degreeOf(roman) {
        const d = ROMAN[roman.toUpperCase()];
        if (!d) throw new Error("Bad roman numeral: " + roman);
        return d;
    }

    // does the quality suffix already state the chord's third (so the numeral's
    // upper/lower case should be ignored rather than adding another "m")?
    function qualityStatesThird(q) {
        return /^(maj|Maj|M|m|Δ|△|dim|°|aug|\+|sus|∅|ø)/.test(q);
    }

    // a single scale degree -> absolute note name
    function singleToAbsolute(degToken, key) {
        const { acc, roman } = parseRelative(degToken);
        return degreeNote(accValue(acc), degreeOf(roman), key);
    }

    // a relative chord -> absolute chord symbol
    function chordToAbsolute(tok, key) {
        const { acc, roman, quality, bass } = parseRelative(tok);
        const rootNote = degreeNote(accValue(acc), degreeOf(roman), key);
        const minor = /[a-z]/.test(roman[0]);

        let q;
        if (qualityStatesThird(quality)) {
            q = quality; // explicit quality wins; case is redundant
        } else {
            q = (minor ? "m" : "") + quality; // case sets the third, suffix extends
        }

        let out = rootNote + q;
        if (bass != null) {
            const b = parseRelative(bass);
            out += "/" + degreeNote(accValue(b.acc), degreeOf(b.roman), key);
        }
        return out;
    }

    return {
        single: { toAbsolute: singleToAbsolute },
        chord: { toAbsolute: chordToAbsolute },
        degreeNote,
        accValue,
    };
});
