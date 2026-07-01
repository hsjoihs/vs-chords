/* =====================================================================
 * audio.js — octave-aware note names → frequency, and Web Audio playback.
 *
 * Unlike the rest of the app, the piano-roll mode needs actual pitches (with an
 * octave), so a chord here is an array of note names like "C4", "C#4", "B♭3".
 * The name → frequency helpers are pure and tested; playVoicing() is the only
 * browser-only part (it touches AudioContext, but never at load time).
 *
 * Loadable as a browser global or a Node CommonJS module.
 * ===================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    // multi-char accidentals must precede single ones so "Bbb3" reads a double flat
    const NOTE_RE = /^([A-Ga-g])(bb|♭♭|𝄫|##|x|𝄪|[#♯b♭])?(-?\d+)$/;

    // "C4" (middle C) = MIDI 60, "A4" = 69. Accepts # ♯ x 𝄪 (up), b ♭ bb ♭♭ 𝄫 (down).
    function noteToMidi(name) {
        const m = String(name).trim().match(NOTE_RE);
        if (!m) throw new Error("Bad note: " + name);
        let acc = 0;
        switch (m[2]) {
            case "#":
            case "♯":
                acc = 1;
                break;
            case "b":
            case "♭":
                acc = -1;
                break;
            case "##":
            case "x":
            case "𝄪":
                acc = 2;
                break;
            case "bb":
            case "♭♭":
            case "𝄫":
                acc = -2;
                break;
        }
        const octave = parseInt(m[3], 10);
        return (octave + 1) * 12 + LETTER_PC[m[1].toUpperCase()] + acc;
    }
    // equal temperament, A4 = 440 Hz
    function midiToFrequency(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }
    function noteToFrequency(name) {
        return midiToFrequency(noteToMidi(name));
    }

    /* ---- Web Audio playback (browser only) ---------------------------- */
    let audioCtx = null;
    function getCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    // Play a sequence of chords (each an array of note names) one after another,
    // as simple triangle-wave tones with a short attack/release envelope so they
    // don't click. Returns the end time (AudioContext seconds).
    function playVoicing(voicing, { chordDur = 0.9, noteGain = 0.13 } = {}) {
        const ctx = getCtx();
        if (ctx.state === "suspended") ctx.resume(); // browsers gate audio on a gesture
        const master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(ctx.destination);
        const attack = 0.012,
            release = 0.14;
        let t = ctx.currentTime + 0.06;
        for (const chord of voicing) {
            for (const name of chord) {
                const osc = ctx.createOscillator();
                osc.type = "triangle";
                osc.frequency.value = noteToFrequency(name);
                const g = ctx.createGain();
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(noteGain, t + attack);
                g.gain.setValueAtTime(noteGain, t + chordDur - release);
                g.gain.linearRampToValueAtTime(0, t + chordDur);
                osc.connect(g).connect(master);
                osc.start(t);
                osc.stop(t + chordDur + 0.02);
            }
            t += chordDur;
        }
        return t;
    }

    return { noteToMidi, midiToFrequency, noteToFrequency, playVoicing };
});
