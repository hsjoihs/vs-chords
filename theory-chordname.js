/* =====================================================================
 * theory-chordname.js — chord symbols and note spelling.
 *
 * Parsing chord symbols into spelled notes / pitch classes (parseChord),
 * naming a pitch-class set back into a symbol (describe), and the line-of-fifths
 * spelling window. Everything here is about *names* — the integer-only ring and
 * voice-leading arithmetic lives in theory-pitchclass.js.
 *
 * Loadable both as a browser global (attached to window) and as a Node
 * CommonJS module (require), so the exact same code the web page runs is
 * what the test-suite checks.
 *
 * The parser does *spelling*, not just pitch classes: every chord tone is
 * placed on its correct letter (stacked thirds) and given the accidental
 * that makes the interval the right quality. That is why Fm comes out as
 * F A♭ C (never F G♯ C) and an F♯ augmented triad comes out as F♯ A♯ Cx
 * (the augmented fifth above F♯ really is C-double-sharp).
 *
 * Accidental glyphs used in OUTPUT:
 *     ♯  sharp        ♭  flat
 *     x  double-sharp ♭♭ double-flat
 * INPUT accepts ASCII and Unicode equivalents: # ♯, b ♭, ## x 𝄪, bb ♭♭ 𝄫.
 * ===================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api; // Node / tests
    } else {
        Object.assign(root, api); // browser: expose as globals on window
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /* ---- note alphabet ------------------------------------------------ */
    const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
    const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

    // chromatic axis labels for the 12 cylinder rails / pc fallbacks
    const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

    const mod12 = (n) => ((n % 12) + 12) % 12;
    const mod7 = (n) => ((n % 7) + 7) % 7;

    /* ---- accidentals -------------------------------------------------- */
    // input glyph -> integer offset
    function accValue(g) {
        switch (g) {
            case undefined:
            case "":
                return 0;
            case "#":
            case "♯":
            case "+":
                return 1;
            case "b":
            case "♭":
            case "-":
                return -1;
            case "##":
            case "x":
            case "𝄪":
                return 2;
            case "bb":
            case "♭♭":
            case "𝄫":
                return -2;
            default:
                throw new Error("Bad accidental: " + g);
        }
    }
    // integer offset -> canonical output glyph
    function accGlyph(n) {
        if (n === 0) return "";
        if (n === 1) return "♯";
        if (n === -1) return "♭";
        if (n === 2) return "x";
        if (n === -2) return "♭♭";
        // extreme triple accidentals: fall back to repetition
        return n > 0 ? "♯".repeat(n) : "♭".repeat(-n);
    }

    /* ---- bare-symbol convention --------------------------------------
     * The symbols Δ △ ° o dim − are read two ways in the wild:
     *   Convention 1 (default): on their own they are TRIADS; add "7" for the
     *       seventh chord (Δ7, °7, dim7, −7).
     *   Convention 2: on their own they are already SEVENTH chords, and a
     *       trailing "7" is a no-op.
     * (M, Maj, m, min are always triads, and ø is always a half-diminished 7th,
     * under both conventions.) The three swappable formulas below are referenced
     * by the bare entries in QUALITIES, and setTetradShorthand() rewrites them in
     * place — so both parseChord and describe follow the active convention.
     */
    let tetradShorthand = false; // false = Convention 1, true = Convention 2
    const BARE_MAJ = { 1: 0, 3: 4, 5: 7 }; // Δ △
    const BARE_DIM = { 1: 0, 3: 3, 5: 6 }; // ° o dim
    const BARE_MIN = { 1: 0, 3: 3, 5: 7 }; // −
    function setTetradShorthand(on) {
        tetradShorthand = !!on;
        const reset = (obj, src) => {
            for (const k of Object.keys(obj)) delete obj[k];
            Object.assign(obj, src);
        };
        if (tetradShorthand) {
            reset(BARE_MAJ, { 1: 0, 3: 4, 5: 7, 7: 11 }); // maj7
            reset(BARE_DIM, { 1: 0, 3: 3, 5: 6, 7: 9 }); // dim7
            reset(BARE_MIN, { 1: 0, 3: 3, 5: 7, 7: 10 }); // min7
        } else {
            reset(BARE_MAJ, { 1: 0, 3: 4, 5: 7 }); // major triad
            reset(BARE_DIM, { 1: 0, 3: 3, 5: 6 }); // diminished triad
            reset(BARE_MIN, { 1: 0, 3: 3, 5: 7 }); // minor triad
        }
    }

    /* ---- chord-quality dictionary ------------------------------------
     * Each quality is a map  degree -> semitones-above-root.
     * Degrees are diatonic step numbers (1,3,5,7,9,11,13...) so the speller
     * can pick the right letter; semitones fix the accidental.
     * Order matters: longer / more specific tokens are matched first.
     */
    const QUALITIES = [
        ["maj13", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 11: 17, 13: 21 }],
        ["maj9", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14 }],
        ["maj7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Maj13", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 11: 17, 13: 21 }],
        ["Maj11", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 11: 17 }],
        ["Maj9", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14 }],
        ["Maj7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["M7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Δ7sus4", { 1: 0, 4: 5, 5: 7, 7: 11 }], // major-7th suspended
        ["△7sus4", { 1: 0, 4: 5, 5: 7, 7: 11 }],
        ["Δ9", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14 }], // = maj9 (keeps the major 7th)
        ["△9", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14 }],
        ["Δ7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Δ", BARE_MAJ], // triad (Conv.1) or maj7 (Conv.2)
        ["△7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["△", BARE_MAJ],
        ["maj", { 1: 0, 3: 4, 5: 7 }],
        ["Maj", { 1: 0, 3: 4, 5: 7 }],

        ["mMaj13", { 1: 0, 3: 3, 5: 7, 7: 11, 9: 14, 11: 17, 13: 21 }],
        ["mMaj11", { 1: 0, 3: 3, 5: 7, 7: 11, 9: 14, 11: 17 }],
        ["mMaj9", { 1: 0, 3: 3, 5: 7, 7: 11, 9: 14 }],
        ["mM7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
        ["mMaj7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
        ["mmaj7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
        ["mΔ7", { 1: 0, 3: 3, 5: 7, 7: 11 }], // minor-major 7th
        ["m△7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
        ["m13", { 1: 0, 3: 3, 5: 7, 7: 10, 9: 14, 11: 17, 13: 21 }],
        ["m11", { 1: 0, 3: 3, 5: 7, 7: 10, 9: 14, 11: 17 }],
        ["m9", { 1: 0, 3: 3, 5: 7, 7: 10, 9: 14 }],
        ["m7b5", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["m7♭5", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["min7b5", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["m7", { 1: 0, 3: 3, 5: 7, 7: 10 }],
        ["min7", { 1: 0, 3: 3, 5: 7, 7: 10 }],
        ["m6", { 1: 0, 3: 3, 5: 7, 6: 9 }],
        ["madd9", { 1: 0, 3: 3, 5: 7, 9: 14 }],
        ["min", { 1: 0, 3: 3, 5: 7 }],
        ["m", { 1: 0, 3: 3, 5: 7 }],

        // diminished
        ["dim7", { 1: 0, 3: 3, 5: 6, 7: 9 }],
        ["dim", BARE_DIM], // triad (Conv.1) or dim7 (Conv.2)
        ["°7", { 1: 0, 3: 3, 5: 6, 7: 9 }],
        ["°M7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°Δ7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°Δ", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°△7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°△", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°Maj7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["°maj7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        
        ["o7", { 1: 0, 3: 3, 5: 6, 7: 9 }],
        ["oM7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["oΔ7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["oΔ", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["o△7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["o△", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["oMaj7", { 1: 0, 3: 3, 5: 6, 7: 11 }],
        ["omaj7", { 1: 0, 3: 3, 5: 6, 7: 11 }],

        ["°", BARE_DIM],
        ["o", BARE_DIM],

        ["ø7", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["ø", { 1: 0, 3: 3, 5: 6, 7: 10 }],

        ["∅7", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["∅", { 1: 0, 3: 3, 5: 6, 7: 10 }],

        ["@", { 1: 0, 2: 2, 5: 6, 7: 10 }], // blackadder

        ["aug7", { 1: 0, 3: 4, 5: 8, 7: 10 }],
        ["augMaj9", { 1: 0, 3: 4, 5: 8, 7: 11, 9: 14 }],
        ["augMaj7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["augmaj7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["augΔ7", { 1: 0, 3: 4, 5: 8, 7: 11 }], // augmented major-7th
        ["aug△7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["aug9", { 1: 0, 3: 4, 5: 8, 7: 10, 9: 14 }],
        ["aug", { 1: 0, 3: 4, 5: 8 }],
        ["+Δ7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["+M7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["+Maj7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["+maj7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["+△7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["+7", { 1: 0, 3: 4, 5: 8, 7: 10 }],
        ["+", { 1: 0, 3: 4, 5: 8 }],

        ["13", { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 11: 17, 13: 21 }],
        ["11", { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 11: 17 }],
        ["9sus4", { 1: 0, 4: 5, 5: 7, 7: 10, 9: 14 }], // dominant-9th suspended
        ["9", { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14 }],
        ["7sus4", { 1: 0, 4: 5, 5: 7, 7: 10 }],
        ["7sus2", { 1: 0, 2: 2, 5: 7, 7: 10 }],
        ["7sus", { 1: 0, 4: 5, 5: 7, 7: 10 }],
        ["7", { 1: 0, 3: 4, 5: 7, 7: 10 }],

        ["6/9", { 1: 0, 3: 4, 5: 7, 6: 9, 9: 14 }],
        ["69", { 1: 0, 3: 4, 5: 7, 6: 9, 9: 14 }],
        ["6", { 1: 0, 3: 4, 5: 7, 6: 9 }],

        ["sus4", { 1: 0, 4: 5, 5: 7 }],
        ["sus2", { 1: 0, 2: 2, 5: 7 }],
        ["sus", { 1: 0, 4: 5, 5: 7 }],

        ["add9", { 1: 0, 3: 4, 5: 7, 9: 14 }],
        ["add11", { 1: 0, 3: 4, 5: 7, 11: 17 }],
        ["add13", { 1: 0, 3: 4, 5: 7, 13: 21 }],

        ["5", { 1: 0, 5: 7 }],

        ["-7", { 1: 0, 3: 3, 5: 7, 7: 10 }],
        ["-", BARE_MIN], // minor triad (Conv.1) or minor 7th (Conv.2)

        // quartal — pure perfect-4th stacks (q / q7 / … / q19) and mode-flavoured
        // stacks where some 4ths turn augmented (qIon7, qLyd10, qAeo16, …). Each is
        // an atomic quality: no tensions or modifications are ever added (see QUARTAL).
        // The mode-prefixed names contain letters (I in qIon, A in qAeo, V in nothing
        // yet) that must NOT be mistaken for note names or Roman numerals — those live
        // only in the quality suffix, after the root/numeral has already been consumed.
        ["qLyd4", { 1: 0, 4: 6 }],
        ["qIon7", { 1: 0, 4: 5, 7: 11 }],
        ["qLyd7", { 1: 0, 4: 6, 7: 11 }],
        ["qIon10", { 1: 0, 4: 5, 7: 11, 10: 16 }],
        ["qLyd10", { 1: 0, 4: 6, 7: 11, 10: 16 }],
        ["qMix10", { 1: 0, 4: 5, 7: 10, 10: 16 }],
        ["qDblTri10", { 1: 0, 4: 6, 7: 11, 10: 17 }],
        ["qIon13", { 1: 0, 4: 5, 7: 11, 10: 16, 13: 21 }],
        ["qDor13", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 21 }],
        ["qLyd13", { 1: 0, 4: 6, 7: 11, 10: 16, 13: 21 }],
        ["qMix13", { 1: 0, 4: 5, 7: 10, 10: 16, 13: 21 }],
        ["qIon16", { 1: 0, 4: 5, 7: 11, 10: 16, 13: 21, 16: 26 }],
        ["qDor16", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 21, 16: 26 }],
        ["qLyd16", { 1: 0, 4: 6, 7: 11, 10: 16, 13: 21, 16: 26 }],
        ["qMix16", { 1: 0, 4: 5, 7: 10, 10: 16, 13: 21, 16: 26 }],
        ["qAeo16", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 20, 16: 26 }],
        ["qIon19", { 1: 0, 4: 5, 7: 11, 10: 16, 13: 21, 16: 26, 19: 31 }],
        ["qDor19", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 21, 16: 26, 19: 31 }],
        ["qPhr19", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 20, 16: 25, 19: 31 }],
        ["qLyd19", { 1: 0, 4: 6, 7: 11, 10: 16, 13: 21, 16: 26, 19: 31 }],
        ["qMix19", { 1: 0, 4: 5, 7: 10, 10: 16, 13: 21, 16: 26, 19: 31 }],
        ["qAeo19", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 20, 16: 26, 19: 31 }],
        ["q16", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 20, 16: 25 }],
        ["q19", { 1: 0, 4: 5, 7: 10, 10: 15, 13: 20, 16: 25, 19: 30 }],
        ["q7", {1: 0, 4: 5, 7: 10 }],
        ["q10", {1: 0, 4: 5, 7: 10, 10: 15 }],
        ["q13", {1: 0, 4: 5, 7: 10, 10: 15, 13: 20 }],
        ["q", { 1: 0, 4: 5 }],

        ["", { 1: 0, 3: 4, 5: 7 }], // bare major — must stay last
    ];

    // natural (diatonic) semitone for each degree, used by alterations/tensions
    const NAT = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

    /* ---- low-level note parsing / spelling ---------------------------- */
    const NOTE_RE = /^([A-Ga-g])(bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])?$/;

    // "F#", "B♭", "Cx" -> { letter, acc, pc }
    function parseNote(tok) {
        const m = String(tok).trim().match(NOTE_RE);
        if (!m) throw new Error("Bad note: " + tok);
        const letter = m[1].toUpperCase();
        const acc = accValue(m[2]);
        return { letter, acc, pc: mod12(LETTER_PC[letter] + acc) };
    }

    function formatNote(letter, acc) {
        return letter + accGlyph(acc);
    }

    // spell a chord tone `deg` steps (diatonically) above a root, landing on
    // the pitch class `rootPc + semi`.
    function spellTone(rootLetterIdx, rootPc, deg, semi) {
        const letter = LETTERS[mod7(rootLetterIdx + (deg - 1))];
        const targetPc = mod12(rootPc + semi);
        let acc = mod12(targetPc - LETTER_PC[letter]);
        if (acc > 6) acc -= 12; // choose the nearest spelling (range -5..+6)
        return { name: formatNote(letter, acc), pc: targetPc, deg };
    }

    /* ---- modifier grammar --------------------------------------------
     * Handles  omit3 / no5 / drop9 , added tensions  9 11 13 ,
     * and alterations  b5 #5 b9 #9 #11 b13 …  (with or without "add").
     */
    const ACC_IN = "(?:bb|♭♭|𝄫|##|x|𝄪|[#♯b♭+-])";
    const NUM = "(?:13|11|9|7|6|5|4|3|2|1)";
    const MOD_RE = new RegExp(
        "(omit|no|drop)(" + NUM + ")" + // 1=omit-kind 2=deg
            "|(sus)([24])?" + // 3=sus 4=2/4 (suspend: drop the 3rd, add the 2nd/4th)
            "|(add)?(" + ACC_IN + ")?(" + NUM + ")", // 5=add 6=acc 7=deg
        "g",
    );

    function applyModifiers(map, modString, original) {
        const str = modString.replace(/[()\s,]/g, "");
        if (str === "") return;
        MOD_RE.lastIndex = 0;
        let cursor = 0;
        let m;
        while ((m = MOD_RE.exec(str)) !== null) {
            if (m.index !== cursor) {
                throw new Error("Unknown chord: " + original);
            }
            cursor = MOD_RE.lastIndex;
            if (m[1]) {
                // omit / no / drop
                delete map[Number(m[2])];
            } else if (m[3]) {
                // suspend: remove the 3rd, add the 4th (default) or 2nd
                delete map[3];
                if (m[4] === "2") map[2] = 2;
                else map[4] = 5;
            } else {
                const deg = Number(m[7]);
                const semi = NAT[deg] + accValue(m[6]);
                map[deg] = semi; // add a tension, or alter an existing degree
            }
        }
        if (cursor !== str.length) {
            throw new Error("Unknown chord: " + original);
        }
    }

    /* ---- the main entry point ----------------------------------------- */
    // parseChord("G7")  ->
    //   { symbol, root:"G", rootPc:7, bass:null,
    //     notes:[{name:"G",pc:7,deg:1}, …], pcs:[7,11,2,5] }
    function parseChord(sym) {
        const symbol = String(sym).trim();
        if (!symbol) return null;

        // "N.C." (no chord / tacet) — the empty pitch-class set. Accept the common
        // ASCII spellings (NC, N.C, N.C.) case-insensitively.
        if (/^n\.?c\.?$/i.test(symbol)) {
            return { symbol, root: null, rootPc: null, bass: null, bassPc: null, notes: [], pcs: [] };
        }

        // optional slash bass
        let main = symbol;
        let bass = null;
        const slash = symbol.split("/");
        if (slash.length === 2) {
            main = slash[0].trim();
            bass = parseNote(slash[1]);
        } else if (slash.length > 2) {
            throw new Error("Bad chord: " + symbol);
        }

        // root
        const rm = main.match(/^([A-Ga-g])(bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])?/);
        if (!rm) throw new Error("Bad root: " + symbol);
        const rootLetter = rm[1].toUpperCase();
        const rootAcc = accValue(rm[2]);
        const rootPc = mod12(LETTER_PC[rootLetter] + rootAcc);
        const rootName = formatNote(rootLetter, rootAcc);

        // quality (longest token first), remainder = modifiers
        let q = main.slice(rm[0].length).replace(/\s/g, "");
        let base = null;
        let rest = null;
        for (const [tok, formula] of QUALITIES) {
            if (q.startsWith(tok)) {
                base = formula;
                rest = q.slice(tok.length);
                break;
            }
        }
        if (base === null) throw new Error("Unknown chord: " + symbol);

        const map = Object.assign({}, base);
        applyModifiers(map, rest, symbol);

        // spell every surviving degree, low to high
        const degs = Object.keys(map)
            .map(Number)
            .sort((a, b) => a - b);
        const rootLetterIdx = LETTER_IDX[rootLetter];
        const notes = degs.map((deg) => spellTone(rootLetterIdx, rootPc, deg, map[deg]));

        // pitch-class set (unique, root-first ordering preserved)
        const pcs = [];
        const seen = new Set();
        for (const n of notes) {
            if (!seen.has(n.pc)) {
                seen.add(n.pc);
                pcs.push(n.pc);
            }
        }
        if (bass && !seen.has(bass.pc)) {
            seen.add(bass.pc);
            pcs.push(bass.pc);
        }

        return {
            symbol,
            root: rootName,
            rootPc,
            bass: bass ? formatNote(bass.letter, bass.acc) : null,
            bassPc: bass ? bass.pc : null,
            notes,
            pcs,
        };
    }

    // convenience: just the spelled note names, e.g. ["G","B","D","F"]
    function spellChord(sym) {
        const c = parseChord(sym);
        return c ? c.notes.map((n) => n.name) : [];
    }

    function parseProgression(text) {
        // split on arrows / dashes-as-arrows / whitespace, but NOT bare "-"
        // (so "C-7" minor still works) and NOT commas inside "(9,13)".
        // However, we *do* allow bare "-" if both sides are delimited by a whitespace.
        const parts = String(text)
            .split(/\s*(?:→|⟶|➔|=>|->|—|–|>|\s-\s)\s*|\s+/)
            .map((x) => x.trim())
            .filter(Boolean);
        return parts.map((p) => parseChord(p));
    }

    /* ---- naming a pitch-class set (inverse of parseChord) -------------
     * describe() round-trips: parseChord(describe(pcs, root, …)).pcs is the same
     * pitch-class set as `pcs`. It (1) finds the richest chord quality from the
     * parser's own QUALITIES table whose notes are all present, then expresses
     * the remaining notes as parenthesised tensions; or (2) if no quality fits,
     * falls back to a major triad with the 3rd and 5th omitted and every note
     * added explicitly. Both forms re-parse to the original set, so the chord
     * chips and the text box stay in sync.
     */

    // accidental offset -> the glyph parseChord accepts as an add/alter prefix
    const ADD_ACC = { "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "x" };
    // a chord degree's natural pitch class (NAT, reduced mod 12)
    const DEG_PC = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 2, 11: 5, 13: 9 };
    const ADD_DEGS = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13];
    // preferred (degree, accidental) spellings for each interval above the root
    const ADD_CAND = {
        0: [[1, 0]],
        1: [[9, -1], [2, -1]],
        2: [[9, 0], [2, 0]],
        3: [[9, 1], [3, -1], [2, 1]],
        4: [[3, 0], [11, -1], [4, -1]],
        5: [[11, 0], [4, 0]],
        6: [[5, -1], [11, 1], [4, 1]], // prefer ♭5 (when the 5th's slot is free) over #11
        7: [[5, 0]],
        8: [[13, -1], [5, 1], [6, -1]],
        9: [[13, 0], [6, 0]],
        10: [[7, -1], [13, 1], [6, 1]],
        11: [[7, 0], [6, 2]],
    };

    const formulaIntervals = (formula) => new Set(Object.values(formula).map((s) => mod12(s)));

    // canonical name preference: lower rank = nicer token on a size tie, so we
    // get "dim7" not "°7", "Δ7" not "M7"/"Maj7", "ø" not "m7b5", "7sus4" not "7sus".
    const NAME_PREF = [
        "", "m", "dim", "aug", "sus2", "sus4", "5",        
        "6", "m6", "69",
        "7", "Δ7", "m7", "ø", "@", "dim7", "mM7", "aug7", "oM7",
        "9", "maj9", "m9", "add9",
        "11", "m11", "13", "maj13", "m13", "7sus4", "7sus2", "q", "q7"
    ];
    const nameRank = (token) => {
        const i = NAME_PREF.indexOf(token);
        return i >= 0 ? i : 1000 + token.length;
    };

    // Assign each interval (a pitch class above the root, never 0) to a distinct
    // chord degree with an accidental in [-2,+2], avoiding `forbidden` degrees.
    // `noDeg7` keeps 7ths (♭7 / maj7) out of the tensions — they belong in the
    // base quality. (6,+2) = "x6" is never produced. Uses backtracking so it
    // always finds an assignment when one exists. Returns Map(interval -> [deg,
    // acc]) or null if the notes cannot all be placed.
    function assignDegrees(intervals, forbidden, noDeg7) {
        const allow = (d, a) => !forbidden.has(d) && !(d === 6 && a === 2) && !(noDeg7 && d === 7);
        const cand = intervals.map((v) => {
            const list = [];
            const seen = new Set();
            for (const [d, a] of ADD_CAND[v] || []) {
                if (allow(d, a)) {
                    list.push([d, a]);
                    seen.add(d);
                }
            }
            for (const d of ADD_DEGS) {
                if (seen.has(d)) continue;
                let a = mod12(v - DEG_PC[d]);
                if (a > 6) a -= 12;
                if (a >= -2 && a <= 2 && allow(d, a)) list.push([d, a]);
            }
            return { v, list };
        });
        cand.sort((x, y) => x.list.length - y.list.length); // most-constrained first
        const used = new Set();
        const result = new Map();
        const bt = (i) => {
            if (i === cand.length) return true;
            for (const [d, a] of cand[i].list) {
                if (used.has(d)) continue;
                used.add(d);
                result.set(cand[i].v, [d, a]);
                if (bt(i + 1)) return true;
                used.delete(d);
                result.delete(cand[i].v);
            }
            return false;
        };
        return bt(0) ? result : null;
    }

    const tokensFor = (assignment) =>
        [...assignment.keys()]
            .sort((a, b) => a - b)
            .map((v) => {
                const [d, a] = assignment.get(v);
                return ADD_ACC[a] + d;
            });

    const QUARTAL = new Set([
        "q", "q7", "q10", "q13", "q16", "q19",
        "qLyd4", "qIon7", "qLyd7",
        "qIon10", "qLyd10", "qMix10", "qDblTri10",
        "qIon13", "qDor13", "qLyd13", "qMix13",
        "qIon16", "qDor16", "qLyd16", "qMix16", "qAeo16",
        "qIon19", "qDor19", "qPhr19", "qLyd19", "qMix19", "qAeo19",
    ]);
    // the degree in a quality's formula that produces pitch class `v`
    function degreeOfInterval(formula, v) {
        for (const d of Object.keys(formula)) if (mod12(formula[d]) === v) return Number(d);
        return null;
    }

    // Build a chord symbol for `pcs` using `r` as the root, or null if the set
    // cannot be spelled from that root. Considers every quality as a base: notes
    // it has but the chord lacks become "omitN", notes the chord has but it lacks
    // become parenthesised tensions. The best name uses the fewest such edits,
    // then the most canonical base. Three rules shape the result:
    //   [1] quartal names (q / q7 / q10 / q13) are reserved for purely quartal
    //       chords — never "Gq(#9)";
    //   [2] a 7th (♭7 or maj7) is spelled through the base, never as a tension —
    //       so {C,G,B♭} is "C7(omit3)", not "C5(b7)";
    //   [exception] when BOTH 7ths are present there is no convention, so one is
    //       unavoidably a tension; we just never write "x6".
    function buildFromRoot(pcs, r, rootName) {
        const T = new Set(pcs.map((p) => mod12(p - r)));
        const bothSevenths = T.has(10) && T.has(11);
        let best = null;
        for (const [token, formula] of QUALITIES) {
            if (token.includes("/")) continue; // "6/9" would look like a slash chord
            const Qset = formulaIntervals(formula);
            const Qdegs = new Set(Object.keys(formula).map(Number));
            const adds = [...T].filter((v) => !Qset.has(v));
            const omits = [...Qset].filter((v) => !T.has(v));
            const omitDegs = omits.map((v) => degreeOfInterval(formula, v));
            if (QUARTAL.has(token) && (adds.length || omits.length)) continue; // [1]
            if (!bothSevenths && (adds.includes(10) || adds.includes(11))) continue; // [2]
            // An add may reuse a degree the base is omitting, turning omit+tension
            // into a single *alter*: a missing 5th hosting a ♭5 gives "7(b5)", instead of
            // "7(omit5,#11)".
            const forbidden = new Set([...Qdegs].filter((d) => !omitDegs.includes(d)));
            const asn = assignDegrees(adds, forbidden, !bothSevenths);
            if (!asn) continue;
            const usedDegs = new Set([...asn.values()].map(([d]) => d));
            const omitToks = omitDegs
                .filter((d) => !usedDegs.has(d)) // a reused degree is altered, not omitted
                .map((d) => "omit" + d)
                .sort();
            const inner = [...omitToks, ...tokensFor(asn)].join(",");
            const str = rootName + token + (inner ? "(" + inner + ")" : "");
            const cur = { str, mods: omitToks.length + asn.size, rank: nameRank(token), len: str.length };
            if (
                !best ||
                cur.mods < best.mods ||
                (cur.mods === best.mods && cur.rank < best.rank) ||
                (cur.mods === best.mods && cur.rank === best.rank && cur.len < best.len)
            ) {
                best = cur;
            }
        }
        return best ? best.str : null;
    }

    // does `name` parse back to exactly the pitch-class set `wantSorted`?
    // (the round-trip contract every describe() result must satisfy)
    function namesPcs(name, wantSorted) {
        if (!name) return false;
        let c;
        try {
            c = parseChord(name);
        } catch (e) {
            return false;
        }
        if (!c) return false;
        const got = [...new Set(c.pcs)].sort((a, b) => a - b);
        if (got.length !== wantSorted.length) return false;
        for (let i = 0; i < got.length; i++) if (got[i] !== wantSorted[i]) return false;
        return true;
    }

    // Last-resort namer: the root plus *every* other note spelled as an explicit
    // tension, with the major triad's 3rd/5th omitted when absent. A 7th may be a
    // tension here — this is the fallback, so correctness outranks legibility.
    // Returns null when the notes cannot all be placed on distinct degrees from
    // this root (the grammar tops out near 10 distinct pitch classes per root).
    function explicitFromRoot(pcs, r, rootName) {
        const T = new Set(pcs.map((p) => mod12(p - r)));
        if (!T.has(0)) return null; // the root must itself be a chord tone
        const baseHas3 = T.has(4),
            baseHas5 = T.has(7);
        // the bare-major base "" already supplies 1/3/5; express the rest as tensions
        const toAssign = [...T]
            .filter((v) => v !== 0 && !(v === 4 && baseHas3) && !(v === 7 && baseHas5))
            .sort((a, b) => a - b);
        const forbidden = new Set([1]); // degree 1 is the root
        if (baseHas3) forbidden.add(3); // keep the base's own 3rd / 5th
        if (baseHas5) forbidden.add(5);
        const asn = assignDegrees(toAssign, forbidden, false);
        if (!asn) return null;
        const omit = [];
        if (!baseHas3) omit.push("omit3");
        if (!baseHas5) omit.push("omit5");
        const inner = [...omit, ...tokensFor(asn)].join(",");
        return rootName + (inner ? "(" + inner + ")" : "");
    }

    // A guaranteed round-tripping name for sets no clean quality name fits. Try
    // the explicit form from every root; then, for sets too large for one root
    // (up to 11 notes), peel one note off as a slash bass. The 12-note chromatic
    // aggregate is the only set that cannot be written as a chord symbol — there
    // we drop a single note (documented best effort) rather than emit a bare root.
    function fallbackName(pcs, preferredRoot, spell) {
        const want = [...new Set(pcs)].sort((a, b) => a - b);
        const roots = preferredRoot != null ? [preferredRoot, ...want.filter((p) => p !== preferredRoot)] : want;
        // 1. the whole set from a single root
        for (const r of roots) {
            const name = explicitFromRoot(want, r, spell(r));
            if (namesPcs(name, want)) return name;
        }
        // 2. one note becomes the slash bass, the remainder named from a root
        for (const b of want) {
            const sub = want.filter((p) => p !== b);
            for (const r of roots) {
                if (!sub.includes(r)) continue;
                const main = explicitFromRoot(sub, r, spell(r));
                const name = main && main + "/" + spell(b);
                if (namesPcs(name, want)) return name;
            }
        }
        // 3. only the full chromatic aggregate reaches here; name 11 of its 12
        //    notes (body + slash bass) so the label stays distinctive
        for (const drop of want) {
            const rest = want.filter((p) => p !== drop);
            for (const b of rest) {
                const sub = rest.filter((p) => p !== b);
                for (const r of sub) {
                    const main = explicitFromRoot(sub, r, spell(r));
                    if (main) return main + "/" + spell(b);
                }
            }
        }
        return spell(want[0]);
    }

    function describe(pcs, rootPc, fifthStart) {
        if (!pcs || pcs.length === 0) return "N.C."; // no chord (the empty set)
        const spell = (p) => (fifthStart != null ? nameInWindow(p, fifthStart) : NOTE_NAMES[p]);
        const want = [...new Set(pcs)].sort((a, b) => a - b);

        // honour a tagged root if the set can be spelled from it
        if (rootPc != null) {
            const res = buildFromRoot(pcs, rootPc, spell(rootPc));
            if (namesPcs(res, want)) return res;
        }
        // otherwise pick the root giving the nicest spellable name (prefer a
        // real quality over the omit-fallback, then the shorter string)
        // but we want to prioritize m7 over 6:
        // to solve this in an ad-hoc way, the score is adjusted.
        let best = null;
        for (const cand of pcs) {
            const res = buildFromRoot(pcs, cand, spell(cand));
            if (!namesPcs(res, want)) continue; // never accept a name that loses notes
            const adjust =
                res.includes("m7") ? -0.6 : /* promote */
                res.includes("6") ? 0.6 : /* demote */
                res.includes("@(") ? 3.6 : /* demote blackadder with a tension; preferable to spell with aug7 */
                res.includes("sus4") ? -0.6 : /* promote sus4 over sus2 */
                res.includes("q") ? 2 : /* demote; especially suppress q10 stronger than 7sus4 */
                0;
            const score = [res.includes("omit3,omit5") ? 1 : 0, res.length + adjust];
            if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
                best = { res, score };
            }
        }
        if (best) return best.res;
        // no clean quality name fits — fall back to a guaranteed round-tripping form
        return fallbackName(pcs, rootPc, spell);
    }

    /* ---- line / spiral of fifths -------------------------------------
     * The Pythagorean spiral of fifths is the infinite chain
     *   … F♭ C♭ G♭ D♭ A♭ E♭ B♭ F C G D A E B F♯ C♯ G♯ D♯ A♯ E♯ B♯ …
     * Index 0 is C; +1 is a fifth up (G), -1 a fifth down (F). Adopting a
     * contiguous length-12 segment as the circle of fifths fixes one spelling
     * for every pitch class. Sliding the segment toward the flat end adds
     * flats, toward the sharp end adds sharps.
     */
    const FIFTH_LETTERS = ["F", "C", "G", "D", "A", "E", "B"];
    // range of segment start positions offered by the UI slider 
    // -8 <= index <= 1 would be the range where it needs no double accidentals: ♭ side reaches F♭/C♭, ♯ side E♯/B♯
    // However, since dim7 and aug frequently appear in reality, we should be a little more lenient with double accidentals
    const FIFTH_MIN = -13;
    const FIFTH_MAX = 6;
    const FIFTH_NEUTRAL = -3; // tie-break preference: a balanced, central segment

    // name at spiral position i, e.g. fifthName(0)="C", fifthName(6)="F♯"
    function fifthName(i) {
        return formatNote(FIFTH_LETTERS[mod7(i + 1)], Math.floor((i + 1) / 7));
    }

    // the segment [start .. start+11] in fifth order (what the slider selects),
    // e.g. windowFifths(-3) = ["E♭","B♭","F","C","G","D","A","E","B","F♯","C♯","G♯"]
    function windowFifths(start) {
        const out = [];
        for (let i = start; i < start + 12; i++) out.push(fifthName(i));
        return out;
    }

    // the same segment as a pitch-class -> name lookup (index 0..11)
    function windowSpelling(start) {
        const names = new Array(12);
        for (let i = start; i < start + 12; i++) names[mod12(7 * i)] = fifthName(i);
        return names;
    }

    function nameInWindow(pc, start) {
        return fifthName(mateFifthIndex(pc, start));
    }

    // The note name of the major key on pitch class `pc`, spelled with the fewest
    // accidentals (e.g. pc 1 → "D♭" not "C♯"); ties lean flat. Used to label the
    // analysis key in Roman-numeral mode.
    function majorKeyName(pc) {
        const i = mod12(7 * pc); // the sharp-side line-of-fifths index for this pc
        const alt = i - 12; // its flat-side enharmonic
        return fifthName(Math.abs(alt) <= Math.abs(i) ? alt : i);
    }

    // the unique spiral index in [start, start+11] whose pitch class is pc
    function mateFifthIndex(pc, start) {
        // 7*i ≡ pc (mod 12)  ⇒  i ≡ 7*pc (mod 12)  (7 is its own inverse mod 12)
        let i = mod12(7 * pc);
        while (i < start) i += 12;
        while (i > start + 11) i -= 12;
        return i;
    }

    function accidentalLoad(name) {
        let n = 0;
        for (const ch of name) {
            if (ch === "♯" || ch === "♭") n += 1;
            else if (ch === "x") n += 2;
        }
        return n;
    }

    // pick the slider position whose spelling best matches a set of spelled
    // notes (typically the notes a chord symbol implies). Ties are broken
    // toward simpler, more central segments.
    function bestFifthStart(notes) {
        let best = FIFTH_NEUTRAL;
        let bestScore = -1,
            bestLoad = Infinity,
            bestDist = Infinity;
        for (let start = FIFTH_MIN; start <= FIFTH_MAX; start++) {
            const w = windowSpelling(start);
            let score = 0;
            for (const n of notes) if (w[n.pc] === n.name) score++;
            const load = w.reduce((s, nm) => s + accidentalLoad(nm), 0);
            const dist = Math.abs(start - FIFTH_NEUTRAL);
            if (
                score > bestScore ||
                (score === bestScore &&
                    (load < bestLoad || (load === bestLoad && dist < bestDist)))
            ) {
                best = start;
                bestScore = score;
                bestLoad = load;
                bestDist = dist;
            }
        }
        return best;
    }

    /* ---- transposition ------------------------------------------------
     * Transpose a chord SYMBOL by a signed number of steps on the line of
     * fifths (perfect 5th up = +1; chromatic semitone up = +7). Only the root
     * and any slash bass are respelled — the quality and modifiers are
     * root-relative, so they ride along unchanged ("Cmaj7" → "Gmaj7").
     */
    // line-of-fifths index of a spelled note (inverse of fifthName)
    function noteFifthIndex(letter, acc) {
        return 7 * acc + FIFTH_LETTERS.indexOf(letter) - 1;
    }
    function transposeSpelledNote(letter, acc, df) {
        return fifthName(noteFifthIndex(letter, acc) + df);
    }
    function transposeSymbolByFifths(symbol, df) {
        const s = String(symbol).trim();
        if (!s || /^n\.?c\.?$/i.test(s)) return s; // N.C. / empty: nothing to move
        const slash = s.split("/");
        const main = slash[0];
        const rm = main.match(/^([A-Ga-g])(bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])?/);
        if (!rm) return s;
        let out = transposeSpelledNote(rm[1].toUpperCase(), accValue(rm[2]), df) + main.slice(rm[0].length);
        if (slash.length === 2) {
            const bm = slash[1].trim().match(NOTE_RE);
            out += "/" + (bm ? transposeSpelledNote(bm[1].toUpperCase(), accValue(bm[2]), df) : slash[1].trim());
        }
        return out;
    }

    // Transpose a whole progression by `deltaFifths`, then auto-minimize spelling:
    // choose the global enharmonic octave (a ±12-fifth shift, applied uniformly so
    // the progression stays internally consistent) with the fewest accidentals
    // overall. Returns the array of transposed symbols.
    function transposeProgression(symbols, deltaFifths) {
        let best = null;
        for (let m = -2; m <= 2; m++) {
            const df = deltaFifths + 12 * m;
            const out = symbols.map((s) => transposeSymbolByFifths(s, df));
            let load = 0,
                ok = true;
            for (const s of out) {
                let c = null;
                try {
                    c = parseChord(s);
                } catch (e) {
                    ok = false;
                    break;
                }
                if (c) for (const n of c.notes) load += accidentalLoad(n.name);
            }
            if (!ok) continue;
            const score = [load, Math.abs(m)];
            if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
                best = { out, score };
            }
        }
        // fall back to the raw shift if every normalization failed to parse
        return best ? best.out : symbols.map((s) => transposeSymbolByFifths(s, deltaFifths));
    }

    return {
        NOTE_NAMES,
        parseNote,
        parseChord,
        spellChord,
        parseProgression,
        describe,
        setTetradShorthand,
        transposeSymbolByFifths,
        transposeProgression,
        formatNote,
        fifthName,
        windowFifths,
        windowSpelling,
        nameInWindow,
        majorKeyName,
        bestFifthStart,
        FIFTH_MIN,
        FIFTH_MAX,
        FIFTH_NEUTRAL,
    };
});
