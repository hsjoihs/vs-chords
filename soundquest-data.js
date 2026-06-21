/* =====================================================================
 * soundquest-data.js — the SoundQuest chord-coloring ground truth.
 *
 * Transcribed verbatim from soundquest-coloring-reorganized.html: each entry is
 * [ relativeRomanSymbol, colorCategory ]. There is no rule-based algorithm — this
 * table IS the definition. The seven categories map to the --*-color CSS vars.
 *
 * Coloring is by PITCH-CLASS SET relative to the tonic (enharmonics ignored), so
 * buildSoundquestMap() resolves each Roman symbol to absolute pitch classes in
 * the key of C, reduces them mod 12, and keys a lookup by that set. Several
 * distinct symbols collapse onto the same pc-set under more than one category
 * (e.g. Vsus4 = Isus2); those chords carry multiple colors.
 *
 * Loadable as a browser global or a Node CommonJS module.
 * ===================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // fixed display order (also the order colors appear in a multi-color slash)
    const SQ_ORDER = ["tonic", "pseudotonic", "pseudotonic-minor", "subdominant", "subdominant-minor", "dominant", "dominant-minor"];

    // [ roman symbol, category ] — the ground truth
    const SOUNDQUEST = [
        // ---- Dm: dominant-minor ----
        ["♭VII/I", "dominant-minor"], ["♭VII", "dominant-minor"], ["♭VIIΔ7", "dominant-minor"],
        ["Vm/I", "dominant-minor"], ["Vm", "dominant-minor"], ["Vm11", "dominant-minor"],
        ["Vm7(11,-13)", "dominant-minor"], ["Vm7", "dominant-minor"], ["Vm9", "dominant-minor"],

        // ---- D: dominant ----
        ["♭II7", "dominant"], ["♭IIΔ7(+11,13)", "dominant"], ["♭IIΔ7(+9)", "dominant"], ["♭IIΔ7", "dominant"],
        ["♯Vdim7/VII", "dominant"], ["♯Vdim7", "dominant"],
        ["♭VI/♭VII", "dominant"],
        ["♭VII", "dominant"], ["♭VII7", "dominant"], ["♭VIIdim7", "dominant"],
        ["III", "dominant"], ["III5", "dominant"], ["III6/♯V", "dominant"], ["III7(-13)", "dominant"],
        ["III7(-9)/♯V", "dominant"], ["III7(-9)", "dominant"], ["III7(+9,-13)", "dominant"], ["III7(+9)", "dominant"],
        ["III7/♯V", "dominant"], ["III7", "dominant"], ["III7sus4", "dominant"], ["IIIaug/♭VII", "dominant"],
        ["IIIaug", "dominant"], ["IIIaug7", "dominant"], ["IIIm/V", "dominant"], ["IIIm/VII", "dominant"],
        ["IIIm", "dominant"], ["IIIm7", "dominant"], ["IIIm9", "dominant"], ["IIImΔ7", "dominant"],
        ["IIIø(9,omit3)", "dominant"], ["IIIø", "dominant"],
        /*["VIm/III", "dominant"], // want to force VIm to be read as tonic */
        ["IIm7/V", "dominant"], ["IV/V", "dominant"], ["IVmΔ7/V", "dominant"],
        ["V(11)", "dominant"], ["V/I", "dominant"], ["V/IV", "dominant"], ["V/VII", "dominant"], ["V", "dominant"],
        ["V5", "dominant"], ["V6", "dominant"], ["V7(-9)", "dominant"], ["V7", "dominant"], ["V7sus4(9)", "dominant"],
        ["V7sus4", "dominant"], ["V9sus4(-13)", "dominant"], ["V9sus4", "dominant"], ["Vaug", "dominant"],
        ["Vdim7", "dominant"], ["Vm7", "dominant"], ["Vø(9,omit3)", "dominant"], ["Vsus4", "dominant"],
        ["VΔ7(11,-13)", "dominant"], ["VΔ7", "dominant"],

        // ---- Pm: pseudotonic-minor ----
        ["♭III", "pseudotonic-minor"], ["♭IIIdim7", "pseudotonic-minor"], ["♭IIIΔ7(+11)", "pseudotonic-minor"],
        ["♭IIIΔ7", "pseudotonic-minor"],
        ["♭VIIm7", "pseudotonic-minor"], ["♭VIIΔ7", "pseudotonic-minor"],
        ["Im/♭III", "pseudotonic-minor"], ["Im", "pseudotonic-minor"], ["Im11/V", "pseudotonic-minor"],
        ["Im7", "pseudotonic-minor"], ["ImΔ7(9)", "pseudotonic-minor"], ["ImΔ7", "pseudotonic-minor"],

        // ---- P: pseudotonic ----
        ["♯Im7", "pseudotonic"],
        ["♯IV@", "pseudotonic"], ["♯IV7", "pseudotonic"], ["♯IVm", "pseudotonic"], ["♯IVm7(11)", "pseudotonic"],
        ["♯IVm7", "pseudotonic"], ["♯IVm9", "pseudotonic"], ["♯IVø7", "pseudotonic"],
        ["Iaug/♯IV", "pseudotonic"],

        // ---- Sm: subdominant-minor ----
        ["♭IIΔ7", "subdominant-minor"],
        ["♭VI/I", "subdominant-minor"], ["♭VI", "subdominant-minor"], ["♭VIm", "subdominant-minor"],
        ["♭VIΔ7(-5,13)", "subdominant-minor"], ["♭VIΔ7", "subdominant-minor"],
        ["IVm/I", "subdominant-minor"], ["IVm", "subdominant-minor"], ["IVm6", "subdominant-minor"],
        ["IVm7", "subdominant-minor"], ["IVm9", "subdominant-minor"], ["IVmΔ7(+11,13)", "subdominant-minor"],
        ["IVmΔ7", "subdominant-minor"],

        // ---- S: subdominant ----
        ["♭IIaug", "subdominant"], ["♭II@", "subdominant"],
        ["♭VIΔ7(+11,13)", "subdominant"],
        ["♯IIdim7", "subdominant"], ["♯IVdim7", "subdominant"], ["♯IVø", "subdominant"],
        ["♯Vdim7", "subdominant"],
        ["II/I", "subdominant"], ["II", "subdominant"], ["II69(omit5)", "subdominant"], ["II7/♯IV", "subdominant"],
        ["II7/I", "subdominant"], ["II7", "subdominant"], ["II9/♯IV", "subdominant"], ["II9", "subdominant"],
        ["IIm/IV", "subdominant"], ["IIm", "subdominant"], ["IIm6", "subdominant"], ["IIm7(9)", "subdominant"],
        ["IIm7/IV", "subdominant"], ["IIm7", "subdominant"], ["IIm9", "subdominant"], ["IImΔ7(+11)", "subdominant"],
        ["IIø", "subdominant"], ["IIΔ7", "subdominant"], ["IIΔ9", "subdominant"],
        ["VIm/II", "subdominant"],
        ["IV/I", "subdominant"], ["IV+Δ7/VII", "subdominant"], ["IV", "subdominant"], ["IV5", "subdominant"],
        ["IV6", "subdominant"], ["IV7(9,♯11)(omit3,omit5)", "subdominant"], ["IV7", "subdominant"],
        ["IV9(-5,omit3)", "subdominant"], ["IVΔ7(+11)", "subdominant"], ["IVΔ7/VI", "subdominant"],
        ["IVΔ7", "subdominant"], ["IVΔ9", "subdominant"],
        ["VII5", "subdominant"], ["VII7", "subdominant"], ["VIIdim", "subdominant"], ["VIIdim7", "subdominant"],
        ["VIIm7(11)", "subdominant"], ["VIIm7", "subdominant"], ["VIIm7omit5", "subdominant"],
        ["VIIø(9,omit3)", "subdominant"], ["VIIø", "subdominant"],

        // ---- T: tonic ----
        ["♭III9(+11,omit3,omit5)", "tonic"],
        ["♯IVm", "tonic"],
        ["♯Idim7", "tonic"], ["♯Iø", "tonic"], ["IIIø", "tonic"],
        ["♭VII/I", "tonic"],
        ["I(♭5)", "tonic"], ["I@", "tonic"], ["I/III", "tonic"], ["I/V", "tonic"], ["I", "tonic"], ["I5", "tonic"],
        ["I6", "tonic"], ["I7/♭VII", "tonic"], ["I7", "tonic"], ["I9", "tonic"], ["Iaug", "tonic"],
        ["IaugΔ7", "tonic"], ["Idim7", "tonic"], ["Isus2", "tonic"], ["Isus4", "tonic"], ["IΔ7", "tonic"],
        ["IΔ7sus4", "tonic"], ["IΔ9", "tonic"],
        ["V/VI", "tonic"],
        ["VI", "tonic"], ["VI5", "tonic"], ["VI7(-9)", "tonic"], ["VI7/♯I", "tonic"], ["VI7", "tonic"],
        ["VI9(♯11,omit3,omit5)", "tonic"], ["VIaug", "tonic"], ["VIaug7", "tonic"], ["VIdim7", "tonic"],
        /*["VIm(+5)", "tonic"], // want to force IV to be read as subdominant */
        ["VIm(9,13)", "tonic"], ["VIm/♯IV", "tonic"], ["VIm/♯V", "tonic"], ["VIm/I", "tonic"],
        ["VIm/V", "tonic"], ["VIm", "tonic"], ["VIm6", "tonic"], ["VIm7(11)omit5", "tonic"], ["VIm7", "tonic"],
        ["VIm9", "tonic"], ["VImΔ7(9,11)", "tonic"], ["VImΔ7", "tonic"], ["VIø", "tonic"], ["VIsus4", "tonic"],
        ["VIΔ7", "tonic"],
    ];

    const mod12 = (n) => ((n % 12) + 12) % 12;

    // Resolve every ground-truth symbol to its pitch-class set relative to the
    // tonic (I = 0), and key a lookup by that set → ordered list of categories.
    // `toAbsolute(roman, "C")` and `parseChord(absSym)` come from the theory layer.
    function buildSoundquestMap(toAbsolute, parseChord) {
        const sets = new Map(); // "p,q,r" -> Set(categories)
        for (const [sym, cat] of SOUNDQUEST) {
            const pcs = parseChord(toAbsolute(sym, "C")).pcs;
            const key = [...new Set(pcs.map(mod12))].sort((a, b) => a - b).join(",");
            if (!sets.has(key)) sets.set(key, new Set());
            sets.get(key).add(cat);
        }
        const map = new Map();
        for (const [key, set] of sets) map.set(key, SQ_ORDER.filter((c) => set.has(c)));
        return map;
    }

    // Like buildSoundquestMap, but keeps the actual symbols behind each category
    // (so the UI can explain *why* a chord is colored the way it is on hover):
    //   key -> [ { category, symbols:[…] }, … ]  in SQ_ORDER.
    function buildSoundquestDetail(toAbsolute, parseChord) {
        const sets = new Map(); // key -> Map(category -> [symbols])
        for (const [sym, cat] of SOUNDQUEST) {
            const pcs = parseChord(toAbsolute(sym, "C")).pcs;
            const key = [...new Set(pcs.map(mod12))].sort((a, b) => a - b).join(",");
            if (!sets.has(key)) sets.set(key, new Map());
            const byCat = sets.get(key);
            if (!byCat.has(cat)) byCat.set(cat, []);
            byCat.get(cat).push(sym);
        }
        const out = new Map();
        for (const [key, byCat] of sets) {
            out.set(key, SQ_ORDER.filter((c) => byCat.has(c)).map((c) => ({ category: c, symbols: byCat.get(c) })));
        }
        return out;
    }

    // the canonical lookup key for a chord's pitch classes relative to `tonicPc`
    function soundquestKey(pcs, tonicPc) {
        return [...new Set(pcs.map((p) => mod12(p - tonicPc)))].sort((a, b) => a - b).join(",");
    }

    return { SOUNDQUEST, SQ_ORDER, buildSoundquestMap, buildSoundquestDetail, soundquestKey };
});
