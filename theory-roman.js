/* =====================================================================
 * theory-roman.js — Roman-numeral (relative) ⟶ absolute conversion.
 *
 * Builds on theory-chordname.js for correct enharmonic note spelling.
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
    const ABS = typeof require !== "undefined" ? require("./theory-chordname.js") : self;
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

    // does the quality suffix already fix the chord's third — or, for quartal (q…),
    // dispense with a third entirely — so the numeral's upper/lower case must not add
    // another "m"? (The "q" here is the quartal marker.)
    function qualityStatesThird(q) {
        return /^(maj|Maj|M|m|Δ|△|dim|°|aug|\+|sus|∅|ø|q)/.test(q);
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

    /* ---- absolute → relative (the inverse of chordToAbsolute) ---------
     * Name an absolute chord as a Roman numeral in `key`. Follows the community
     * convention: the numeral is ALWAYS uppercase and the chord's quality rides
     * along as an explicit suffix (so a minor chord on the 6th degree is "VIm",
     * never "vi"); The
     * key is given relative to its major scale regardless of the song's mode — a
     * minor-key tonic chord is analysed in the relative major, e.g. Am in C = VIm.
     */
    const ROMAN_BY_OFFSET = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
    function noteToDegree(noteName, key) {
        return ROMAN_BY_OFFSET[mod12(parseNote(noteName).pc - parseNote(key).pc)];
    }
    // absolute chord symbol -> Roman-numeral symbol in `key` (a note name)
    function chordToRelative(absSym, key) {
        const s = String(absSym).trim();
        if (!s || /^n\.?c\.?$/i.test(s)) return s; // N.C. / empty: pass through
        const slash = s.split("/");
        const main = slash[0];
        const rm = main.match(/^([A-Ga-g])(bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])?/);
        if (!rm) return s;
        const rootName = rm[1].toUpperCase() + (rm[2] || "");
        let out = noteToDegree(rootName, key) + main.slice(rm[0].length);
        if (slash.length === 2) out += "/" + noteToDegree(slash[1].trim(), key);
        return out;
    }

    /* ---- "curly-brace relative" progression -------------------------
     * A progression of absolute chords, where a brace group splices in chords
     * written relative to one of the absolute chords. The "=" marks where the
     * absolute chord sits in the relative run:
     *   {V7 → i=} Am   the anchor i = Am fixes the key (A minor), so V7 → E7 is
     *                  emitted before Am.
     *   F {=I V}       the anchor I = F fixes the key (F major), so V → C is
     *                  emitted*after F.
     * Grammar (EBNF convention: https://www.w3.org/TR/xml/ ) is given as follows.
     * Note that "{", "}" and "=" must be replaced with " { ", " } " and " = " beforehand.
     *
     * ```
     * progression ::= whitespace* chords (separator chords)* whitespace* 
     * separator ::= whitespace* ("->"|[-→]) whitespace* | whitespace+
     * chords ::= relative_prefix? whitespace* absolute_chord whitespace* relative_suffix?
     * relative_prefix ::= "{" whitespace* relative_chord (separator relative_chord)* whitespace* "=" whitespace* "}"
     * relative_suffix ::= "{" whitespace* "=" whitespace* relative_chord (separator relative_chord)* whitespace* "}"
     * ```
     */
    const mod7 = (n) => ((n % 7) + 7) % 7;

    // the key whose `relToken` degree lands on `absoluteChord`'s root
    function keyFromAnchor(relToken, absoluteChord) {
        const { acc, roman } = parseRelative(relToken);
        const d = degreeOf(roman);
        const rootName = ABS.parseChord(absoluteChord).root; // e.g. "Am" -> "A"
        const ar = parseNote(rootName);
        const keyLetter = LETTERS[mod7(LETTER_IDX[ar.letter] - (d - 1))];
        const keyPc = mod12(ar.pc - MAJOR[d - 1] - accValue(acc));
        let keyAcc = mod12(keyPc - LETTER_PC[keyLetter]);
        if (keyAcc > 6) keyAcc -= 12;
        return formatNote(keyLetter, keyAcc);
    }

    function tokenizeCurly(input) {
        return String(input)
            .replace(/\{/g, " { ")
            .replace(/\}/g, " } ")
            .replace(/=/g, " = ")
            .split(/\s*(?:->|[-→])\s*|\s+/) // separators: -> , - , → , or whitespace
            .filter(Boolean);
    }

    // the diatonic triads of a major key, for the numeric shorthand 1..7
    const DIATONIC = { 1: "I", 2: "IIm", 3: "IIIm", 4: "IV", 5: "V", 6: "VIm", 7: "VIIdim" };

    // expand one token inside a key{…} group into relative-chord symbols. A run of
    // digits 1–7 is the self-delimiting shorthand (each digit a diatonic triad, so
    // "4536" → IV V IIIm VIm); anything else is taken as a Roman numeral verbatim.
    function expandRelToken(tok) {
        if (/^[1-7]+$/.test(tok)) return tok.split("").map((d) => DIATONIC[d]);
        return [tok];
    }

    // consume a "{ … }" run from `tokens` starting at the "{" index `i`; returns
    // [innerTokens, indexAfterClosingBrace]
    function readBrace(tokens, i) {
        const inner = [];
        i++; // skip "{"
        while (i < tokens.length && tokens[i] !== "}") inner.push(tokens[i++]);
        if (tokens[i] !== "}") throw new Error("Unbalanced '{' in progression");
        return [inner, i + 1];
    }

    // group tokens into brace groups ({kind:"prefix"|"suffix", rels}), explicit-key
    // groups ({kind:"keygroup", key, rels}), and bare absolute chords ({kind:"chord", value})
    function groupCurly(tokens) {
        const items = [];
        let i = 0;
        while (i < tokens.length) {
            const t = tokens[i];
            if (/^key[A-Ga-g]/.test(t)) {
                // explicit key: keyG#{ IV V iii vi }  — every chord is relative to
                // that key, no "=" anchor, and the numeric shorthand is allowed
                const key = t.slice(3);
                i++;
                if (tokens[i] !== "{") throw new Error("'key" + key + "' must be followed by '{…}'");
                let inner;
                [inner, i] = readBrace(tokens, i);
                if (inner.includes("=")) throw new Error("a key" + key + "{…} group must not contain '='");
                items.push({ kind: "keygroup", key, rels: inner });
            } else if (t === "{") {
                let inner;
                [inner, i] = readBrace(tokens, i);
                const eq = inner.indexOf("=");
                if (eq === -1) throw new Error("Brace group needs '=': {" + inner.join(" ") + "}");
                if (eq === inner.length - 1) items.push({ kind: "prefix", rels: inner.slice(0, eq) });
                else if (eq === 0) items.push({ kind: "suffix", rels: inner.slice(1) });
                else throw new Error("'=' must be at the start or end of a brace group");
            } else if (t === "}" || t === "=") {
                throw new Error("Unexpected '" + t + "' in progression");
            } else {
                items.push({ kind: "chord", value: t });
                i++;
            }
        }
        return items;
    }

    // resolve "C {V7 → i=} Am …" to ["C","E7","Am", …]
    function parseAndResolveCurlyBraceRelative(input) {
        const items = groupCurly(tokenizeCurly(input));
        const out = [];
        let i = 0;
        while (i < items.length) {
            // an explicit key{…} group stands alone (no anchoring absolute chord)
            if (items[i].kind === "keygroup") {
                const g = items[i++];
                for (const tok of g.rels) for (const rel of expandRelToken(tok)) out.push(chordToAbsolute(rel, g.key));
                continue;
            }
            let prefix = null;
            let suffix = null;
            if (items[i] && items[i].kind === "prefix") prefix = items[i++];
            if (!items[i] || items[i].kind !== "chord") {
                throw new Error("Expected an absolute chord" + (prefix ? " after a {…=} group" : ""));
            }
            const absolute = items[i++].value;
            if (items[i] && items[i].kind === "suffix") suffix = items[i++];

            if (prefix) {
                const rels = prefix.rels; // [r1 … rN], rN is the anchor (= absolute)
                const key = keyFromAnchor(rels[rels.length - 1], absolute);
                for (const r of rels.slice(0, -1)) out.push(chordToAbsolute(r, key));
            }
            out.push(absolute);
            if (suffix) {
                const rels = suffix.rels; // [r1 … rN], r1 is the anchor (= absolute)
                const key = keyFromAnchor(rels[0], absolute);
                for (const r of rels.slice(1)) out.push(chordToAbsolute(r, key));
            }
        }
        return out;
    }

    return {
        single: { toAbsolute: singleToAbsolute },
        chord: { toAbsolute: chordToAbsolute, toRelative: chordToRelative },
        chordToAbsolute,
        chordToRelative,
        progression: { parseAndResolveCurlyBraceRelative },
        degreeNote,
        noteToDegree,
        accValue,
    };
});
