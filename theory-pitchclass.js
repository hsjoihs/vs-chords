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

    return {
        dirDistance,
        absDistance,
        ringIndex,
        ringStep,
        MAX_VOICE_STEP,
        voiceLeading,
        hasTritone,
    };
});
