/* =====================================================================
 * voicing.js — a statistical-mechanics voicing generator (pure, node-testable).
 *
 * Octaves are assigned to chord tones by treating the choice as a physical
 * system in thermal equilibrium:
 *
 *   • A parabolic potential V(p) = (p − CENTER)² / (2 S²) pulls upper voices
 *     toward a central register (CENTER = F♯4). S is the *width of the potential*
 *     (a bigger S is a wider, gentler well); it is NOT the temperature.
 *   • The temperature T scales every energy: a placement's Boltzmann weight is
 *     exp(−E/T). The equilibrium single-note spread is therefore S·√T, so at
 *     T = 1 the well of width S produces a Gaussian of width S.
 *   • Dissonance penalties: two simultaneous voices a bare minor 2nd apart (1
 *     semitone) cost a little; a minor 9th or wider (13, 25, … ≡ 1 mod 12 and
 *     ≥ 13 — the classic "avoid notes") cost a lot. Both are waived when the
 *     chord's own pitch-class set already contains a tritone.
 *   • Voice leading: from the second chord on, a voice pays VL_LAMBDA per
 *     semitone it sits from the nearest voice of the previous chord, so smooth
 *     motion is energetically favoured.
 *
 * Octaves are chosen sequentially — one voice at a time, conditioned on the
 * voices already placed — so there is no combinatorial explosion. The bass line
 * is placed independently in its own low register.
 *
 * Loadable as a browser global or a Node CommonJS module.
 * ===================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const POT_CENTER = 66; // F♯4 — the upper-voice potential's minimum
    const UPPER_LO = 36, // C2 — candidate window for upper voices
        UPPER_HI = 84; // C6
    const BASS_CENTER = 40, // E2 — the bass's own (independent) potential minimum
        BASS_LO = 34, // B♭1 — a roughly one-octave bass window
        BASS_HI = 48; // C3
    const EPS_M2 = 8, // mild penalty: a bare minor 2nd (1 semitone)
        EPS_M9 = 13, // heavy penalty: a minor 9th or wider (avoid notes)
        VL_LAMBDA = 0.6; // voice-leading energy per semitone of motion

    // a small deterministic PRNG (mulberry32) so sampling is reproducible in tests
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const mod12 = (n) => ((n % 12) + 12) % 12;

    // does a pitch-class set contain a tritone (two pcs six semitones apart)?
    function hasTritone(pcs) {
        for (let i = 0; i < pcs.length; i++) for (let j = i + 1; j < pcs.length; j++) if (mod12(pcs[i] - pcs[j]) === 6) return true;
        return false;
    }

    // the parabolic potential energy of pitch p about `center`, width S
    function potential(p, center, S) {
        const d = p - center;
        return (d * d) / (2 * S * S);
    }

    // dissonance penalty between two simultaneous pitches d = |p1 − p2| apart: a
    // bare minor 2nd (1) is mild; a minor 9th or wider (13, 25, … ≡ 1 mod 12 and
    // ≥ 13) is heavy. Both vanish when the chord itself holds a tritone.
    function penalty(d, chordHasTritone) {
        if (chordHasTritone) return 0;
        if (d === 1) return EPS_M2;
        if (d >= 13 && mod12(d) === 1) return EPS_M9;
        return 0;
    }

    // sample an index from unnormalised Boltzmann weights exp(−E/T)
    function boltzmannPick(energies, T, rng) {
        const w = energies.map((E) => Math.exp(-E / T));
        let sum = 0;
        for (const x of w) sum += x;
        let r = rng() * sum;
        for (let i = 0; i < w.length; i++) {
            r -= w[i];
            if (r <= 0) return i;
        }
        return w.length - 1;
    }

    // the pitches of a pitch class that fall within [lo, hi]
    function octaveCandidates(pc, lo, hi) {
        const out = [];
        for (let p = mod12(pc); p <= hi; p += 12) if (p >= lo) out.push(p);
        return out;
    }

    // the distance from a pitch class's best (nearest-to-centre) octave to CENTER
    function bestDist(pc) {
        let best = Infinity;
        for (const p of octaveCandidates(pc, UPPER_LO, UPPER_HI)) best = Math.min(best, Math.abs(p - POT_CENTER));
        return best;
    }
    // Place the pitch classes whose octave is most decisive (nearest the well) first
    // and the ambiguous ones (e.g. a pc a tritone from CENTER, equidistant either
    // octave) last, so the latter can be settled by the already-placed neighbours.
    function placementOrder(pcs) {
        return pcs.slice().sort((a, b) => bestDist(a) - bestDist(b));
    }

    // place one upper voice (pitch class pc), given the already-placed upper pitches
    // of this chord and the previous chord's upper pitches (null for the first chord)
    function placeUpper(pc, placed, prevUppers, opts) {
        const cands = octaveCandidates(pc, UPPER_LO, UPPER_HI);
        const energies = cands.map((p) => {
            let E = potential(p, POT_CENTER, opts.S);
            for (const q of placed) E += penalty(Math.abs(p - q), opts.tritone);
            if (prevUppers && prevUppers.length) {
                let dmin = Infinity;
                for (const q of prevUppers) dmin = Math.min(dmin, Math.abs(p - q));
                E += VL_LAMBDA * dmin;
            }
            return E;
        });
        return cands[boltzmannPick(energies, opts.T, opts.rng)];
    }

    // place the bass (the root, doubled low) independently of the upper voices
    function placeBass(rootPc, opts) {
        const cands = octaveCandidates(rootPc, BASS_LO, BASS_HI);
        const energies = cands.map((p) => potential(p, BASS_CENTER, opts.S));
        return cands[boltzmannPick(energies, opts.T, opts.rng)];
    }

    // Generate a voicing for a progression. `chords` = [{ rootPc, pcs:[…] }].
    // Returns one { bass, uppers:[ascending midis] } per chord. Options: S (potential
    // width), T (temperature), and either rng (a () → [0,1) function) or seed.
    function generateVoicing(chords, options) {
        const opts = options || {};
        const S = opts.S != null ? opts.S : 3.4;
        const T = opts.T != null ? opts.T : 1;
        const rng = opts.rng || (opts.seed != null ? mulberry32(opts.seed) : Math.random);
        const out = [];
        let prevUppers = null;
        for (const ch of chords) {
            const tritone = hasTritone(ch.pcs);
            const placed = [];
            for (const pc of placementOrder(ch.pcs)) placed.push(placeUpper(pc, placed, prevUppers, { S, T, tritone, rng }));
            const uppers = placed.slice().sort((a, b) => a - b);
            const bass = ch.rootPc != null ? placeBass(ch.rootPc, { S, T, rng }) : null;
            out.push({ bass, uppers });
            prevUppers = uppers;
        }
        return out;
    }

    return {
        mulberry32,
        hasTritone,
        potential,
        penalty,
        boltzmannPick,
        octaveCandidates,
        placementOrder,
        placeUpper,
        placeBass,
        generateVoicing,
        POT_CENTER,
        BASS_CENTER,
        UPPER_LO,
        UPPER_HI,
        BASS_LO,
        BASS_HI,
        EPS_M2,
        EPS_M9,
        VL_LAMBDA,
    };
});
