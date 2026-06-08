/* =====================================================================
 * theory.js — pure music-theory core (no DOM, no THREE).
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
                return 1;
            case "b":
            case "♭":
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

    /* ---- chord-quality dictionary ------------------------------------
     * Each quality is a map  degree -> semitones-above-root.
     * Degrees are diatonic step numbers (1,3,5,7,9,11,13...) so the speller
     * can pick the right letter; semitones fix the accidental.
     * Order matters: longer / more specific tokens are matched first.
     */
    const QUALITIES = [
        ["maj13", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14, 13: 21 }],
        ["maj9", { 1: 0, 3: 4, 5: 7, 7: 11, 9: 14 }],
        ["maj7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Maj7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["M7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Δ7", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["Δ", { 1: 0, 3: 4, 5: 7, 7: 11 }],
        ["maj", { 1: 0, 3: 4, 5: 7 }],

        ["mMaj7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
        ["mmaj7", { 1: 0, 3: 3, 5: 7, 7: 11 }],
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

        ["dim7", { 1: 0, 3: 3, 5: 6, 7: 9 }],
        ["dim", { 1: 0, 3: 3, 5: 6 }],
        ["°7", { 1: 0, 3: 3, 5: 6, 7: 9 }],
        ["°", { 1: 0, 3: 3, 5: 6 }],
        ["o7", { 1: 0, 3: 3, 5: 6, 7: 9 }],

        ["ø7", { 1: 0, 3: 3, 5: 6, 7: 10 }],
        ["ø", { 1: 0, 3: 3, 5: 6, 7: 10 }],

        ["aug7", { 1: 0, 3: 4, 5: 8, 7: 10 }],
        ["augmaj7", { 1: 0, 3: 4, 5: 8, 7: 11 }],
        ["aug", { 1: 0, 3: 4, 5: 8 }],
        ["+7", { 1: 0, 3: 4, 5: 8, 7: 10 }],
        ["+", { 1: 0, 3: 4, 5: 8 }],

        ["13", { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 13: 21 }],
        ["11", { 1: 0, 3: 4, 5: 7, 7: 10, 9: 14, 11: 17 }],
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
        ["-", { 1: 0, 3: 3, 5: 7 }],

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
    const ACC_IN = "(?:bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])";
    const NUM = "(?:13|11|9|7|6|5|4|3|2|1)";
    const MOD_RE = new RegExp(
        "(omit|no|drop)(" + NUM + ")" + // 1=omit-kind 2=deg
            "|(add)?(" + ACC_IN + ")?(" + NUM + ")", // 3=add 4=acc 5=deg
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
            } else {
                const deg = Number(m[5]);
                const semi = NAT[deg] + accValue(m[4]);
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
        const parts = String(text)
            .split(/\s*(?:→|⟶|➔|=>|->|—|–|>)\s*|\s+/)
            .map((x) => x.trim())
            .filter(Boolean);
        return parts.map((p) => parseChord(p));
    }

    /* ---- intervals & voice leading ------------------------------------ */
    // signed circular distance in semitones, range -6..+6 (+ = upward)
    function dirDistance(a, b) {
        let d = (b - a) % 12;
        if (d < 0) d += 12;
        if (d > 6) d -= 12;
        return d;
    }
    function absDistance(a, b) {
        return Math.abs(dirDistance(a, b));
    }

    // greedy nearest-note matching between two pc-sets (minimal total motion)
    function voiceLeading(A, B) {
        const moves = [];
        const usedA = new Array(A.length).fill(false);
        const usedB = new Array(B.length).fill(false);
        const pairs = [];
        for (let i = 0; i < A.length; i++)
            for (let j = 0; j < B.length; j++)
                pairs.push({ i, j, d: absDistance(A[i], B[j]) });
        pairs.sort((x, y) => x.d - y.d);
        for (const p of pairs) {
            if (usedA[p.i] || usedB[p.j]) continue;
            usedA[p.i] = usedB[p.j] = true;
            moves.push({ from: A[p.i], to: B[p.j], dist: dirDistance(A[p.i], B[p.j]) });
        }
        for (let i = 0; i < A.length; i++) {
            if (usedA[i]) continue;
            let best = 0,
                bd = 99;
            for (let j = 0; j < B.length; j++) {
                const d = absDistance(A[i], B[j]);
                if (d < bd) {
                    bd = d;
                    best = j;
                }
            }
            moves.push({ from: A[i], to: B[best], dist: dirDistance(A[i], B[best]) });
        }
        for (let j = 0; j < B.length; j++) {
            if (usedB[j]) continue;
            let best = 0,
                bd = 99;
            for (let i = 0; i < A.length; i++) {
                const d = absDistance(A[i], B[j]);
                if (d < bd) {
                    bd = d;
                    best = i;
                }
            }
            moves.push({ from: A[best], to: B[j], dist: dirDistance(A[best], B[j]), appear: true });
        }
        return moves;
    }

    function hasTritone(pcs) {
        for (let i = 0; i < pcs.length; i++)
            for (let j = i + 1; j < pcs.length; j++)
                if (absDistance(pcs[i], pcs[j]) === 6) return true;
        return false;
    }

    // chord quality keyed by the sorted set of intervals above the root
    const QUALITY_SUFFIX = {
        "0,4,7": "",
        "0,3,7": "m",
        "0,3,6": "dim",
        "0,4,8": "aug",
        "0,4,7,10": "7",
        "0,4,7,11": "maj7",
        "0,3,7,10": "m7",
        "0,3,6,10": "ø",
        "0,3,6,9": "dim7",
        "0,4,7,9": "6",
        "0,3,7,9": "m6",
        "0,5,7": "sus4",
        "0,2,7": "sus2",
        "0,7": "5",
    };

    // name a raw pitch-class set. When the root is known (the user tagged it
    // by right-clicking), spell the root through the chosen line-of-fifths
    // window and append the recognised quality; otherwise fall back to trying
    // each note as a root.
    function describe(pcs, rootPc, fifthStart) {
        if (pcs.length === 0) return "";
        if (rootPc != null) {
            const rel = pcs
                .map((p) => mod12(p - rootPc))
                .sort((a, b) => a - b);
            const suffix = QUALITY_SUFFIX[rel.join(",")];
            const rootName =
                fifthStart != null ? nameInWindow(rootPc, fifthStart) : NOTE_NAMES[rootPc];
            if (suffix !== undefined) return rootName + suffix;
        }
        const spell = (p) => (fifthStart != null ? nameInWindow(p, fifthStart) : NOTE_NAMES[p]);
        if (pcs.length < 2) return spell(pcs[0]);
        for (const r of pcs) {
            const rel = pcs.map((p) => mod12(p - r)).sort((a, b) => a - b);
            const suffix = QUALITY_SUFFIX[rel.join(",")];
            if (suffix !== undefined) return spell(r) + suffix;
        }
        return pcs.map(spell).join("·");
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

    return {
        NOTE_NAMES,
        parseNote,
        parseChord,
        spellChord,
        parseProgression,
        dirDistance,
        absDistance,
        voiceLeading,
        hasTritone,
        describe,
        formatNote,
        fifthName,
        windowFifths,
        windowSpelling,
        nameInWindow,
        bestFifthStart,
        FIFTH_MIN,
        FIFTH_MAX,
        FIFTH_NEUTRAL,
    };
});
