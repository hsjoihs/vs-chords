/* =====================================================================
 * theory-pitchclass.js — pure pitch-class (integer 0–11) operations.
 *
 * No note names, no spelling: just the arithmetic of pitch classes around the
 * octave — intervals, the chromatic vs circle-of-fifths ring, and the
 * note-to-note connections drawn between consecutive chords.
 *
 * Loadable both as a browser global (attached to window) and as a Node
 * CommonJS module (require).
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

    /* ---- intervals ---------------------------------------------------- */
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

    /* ---- the ring: chromatic vs circle of fifths ---------------------- */
    // Largest distance (in ring steps) still drawn as a connection between chords.
    const MAX_VOICE_STEP = 2; // two steps = a whole tone in either arrangement

    // Where a pitch class sits around the ring. Chromatic: pc itself. Circle of
    // fifths: 7·pc mod 12 — which sends every other vertex to its antipode, so a
    // single ring step is a fifth instead of a semitone.
    function ringIndex(pc, fifths) {
        const p = ((pc % 12) + 12) % 12;
        return fifths ? (7 * p) % 12 : p;
    }
    // signed number of ring steps from a to b, in [-6, 6]
    function ringStep(a, b, fifths) {
        let d = (ringIndex(b, fifths) - ringIndex(a, fifths)) % 12;
        if (d < 0) d += 12;
        if (d > 6) d -= 12;
        return d;
    }

    /* ---- connections between two chords ------------------------------- */
    // Connect every note of A to every note of B within MAX_VOICE_STEP ring
    // steps. One step is a semitone (chromatic) or a fifth (circle of fifths);
    // two steps is a whole tone in either arrangement. Letting one note fan out
    // to several neighbours reads better for non-choral / pop motion: e.g. on the
    // chromatic ring A7 → Dm7 draws C♯→C and C♯→D, plus E→D, E→F, G→F, G→A.
    // Each move is { from, to, step, dist }, step signed in -2..+2.
    //
    // HOWEVER, when (say) D and E are held across both chords we only want D→D
    // and E→E; drawing D→E and E→D as well is just visual noise.
    function voiceLeading(A, B, fifths) {
        const moves = [];
        for (const a of A) {
            for (const b of B) {
                const step = ringStep(a, b, fifths);
                if (Math.abs(step) <= MAX_VOICE_STEP) {
                    if (A.includes(b) && B.includes(a) && step !== 0) continue;
                    moves.push({ from: a, to: b, step, dist: dirDistance(a, b) });
                }
            }
        }
        return moves;
    }

    function hasTritone(pcs) {
        for (let i = 0; i < pcs.length; i++)
            for (let j = i + 1; j < pcs.length; j++)
                if (absDistance(pcs[i], pcs[j]) === 6) return true;
        return false;
    }

    /* ---- crude harmonic-function approximation ------------------------
     * The 12 pitch classes split into three diminished-7th groups by pc % 3.
     * `tonicResidue` chooses which residue is the tonic (default 0); the other
     * two follow the cyclic order tonic → dominant → subdominant. With the
     * default:
     *   tonic       = {0,3,6,9}   dominant = {1,4,7,10}   subdominant = {2,5,8,11}
     * The whole axis system is rotationally symmetric, so any choice "works".
     */
    const PC_FUNCTIONS = ["tonic", "dominant", "subdominant"];
    function pcFunction(pc, tonicResidue = 0) {
        return PC_FUNCTIONS[((((pc - tonicResidue) % 3) + 3) % 3)];
    }
    function pcFunctionCounts(pcs, tonicResidue = 0) {
        let t_count = 0,
            d_count = 0,
            s_count = 0;
        for (const p of pcs) {
            const f = pcFunction(p, tonicResidue);
            if (f === "tonic") t_count++;
            else if (f === "dominant") d_count++;
            else s_count++;
        }
        return { t_count, d_count, s_count };
    }

    // Returns the approximate harmonic function(s) as an array of *judgments*.
    // Each element is one judgment; an ambiguous judgment (a single decomposition
    // that could be one of two functions) is written "a|b". So separate array
    // elements are an overlap of distinct judgments ("plus"), while one "a|b"
    // element is a single ambiguous judgment ("or"). The labels are drawn from
    // "tonic", "pseudotonic", "subdominant", "dominant", "unjudgeable".
    function approximateChordFunction({ t_count, d_count, s_count }) {
        // chord's function cannot be judged when there are only two notes
        if (t_count + d_count + s_count <= 2) return [];

        if (t_count > 0 && d_count > 0 && s_count > 0) {
            // take each pair, judge, and then combine the results
            const merged = [
                ...approximateChordFunction({ t_count, d_count, s_count: 0 }),
                ...approximateChordFunction({ t_count, d_count: 0, s_count }),
                ...approximateChordFunction({ t_count: 0, d_count, s_count }),
            ];
            if (merged.includes("unjudgeable")) {
                return ["unjudgeable"];
            } else return merged;
        }

        if (s_count === 0) {
            if (t_count + d_count === 3) {
                switch (t_count) {
                    case 3: /* a diminished triad built from the tonic-colored note */
                        return ["subdominant|pseudotonic"];
                    case 2: /* probably a minor chord built from the tonic-colored note */
                        return ["tonic"];
                    case 1: /* probably a Major chord built from the tonic-colored note */
                        return ["tonic"];
                    case 0: /* a diminished triad built from the dominant-colored note */
                        return ["pseudotonic|dominant"];
                }
            } else if (t_count + d_count === 4) {
                switch (t_count) {
                    case 4: /* a diminished seventh chord built from the tonic-colored note */
                        return ["subdominant"];
                    case 3: /* probably a half-diminished chord built from the tonic-colored note */
                        return ["subdominant|pseudotonic"];
                    case 2: /* probably a minor seventh chord built from the tonic-colored note */
                        return ["tonic"];
                    case 1: /* probably a dominant seventh chord built from the tonic-colored note */
                        return ["pseudotonic"];
                    case 0: /* a diminished seventh chord built from the dominant-colored note */
                        return ["pseudotonic"];
                }
            } else {
                // such a chord's function are too sensitive to the choice of roots &
                // tensions that we lack enough information to judge it
                return ["unjudgeable"];
            }
        } else {
            /* use symmetry */
            // map a whole judgment, preserving "|" (an ambiguous judgment stays one)
            const mapJudgment = (a, m) => a.split("|").map((x) => m[x]).join("|");
            if (t_count === 0) {
                const rotated = approximateChordFunction({ t_count: d_count, d_count: s_count, s_count: 0 });
                return rotated.map((a) =>
                    mapJudgment(a, {
                        unjudgeable: "unjudgeable",
                        pseudotonic: "dominant",
                        tonic: "dominant",
                        subdominant: "pseudotonic",
                        dominant: "subdominant",
                    }),
                );
            } else if (d_count === 0) {
                const rotated = approximateChordFunction({ d_count: t_count, t_count: s_count, s_count: 0 });
                return rotated.map((a) =>
                    mapJudgment(a, {
                        unjudgeable: "unjudgeable",
                        pseudotonic: "subdominant",
                        tonic: "subdominant",
                        subdominant: "dominant",
                        dominant: "pseudotonic",
                    }),
                );
            }
        }
    }

    return {
        dirDistance,
        absDistance,
        ringIndex,
        ringStep,
        MAX_VOICE_STEP,
        voiceLeading,
        hasTritone,
        pcFunction,
        pcFunctionCounts,
        approximateChordFunction,
    };
});
