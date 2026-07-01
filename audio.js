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

    /* ---- tempo (logarithmic slider) ----------------------------------
     * The tempo slider is log-scaled: a slider fraction f ∈ [0, 1] maps to
     *   bpm = MIN · (MAX / MIN)^f
     * so equal slider movement is an equal *ratio* of tempo (which reads evenly),
     * spanning TEMPO_MIN_BPM … TEMPO_MAX_BPM. fractionFromBpm is its inverse.
     */
    const TEMPO_MIN_BPM = 60;
    const TEMPO_MAX_BPM = 240;
    function bpmFromFraction(f) {
        return TEMPO_MIN_BPM * Math.pow(TEMPO_MAX_BPM / TEMPO_MIN_BPM, f);
    }
    function fractionFromBpm(bpm) {
        return Math.log(bpm / TEMPO_MIN_BPM) / Math.log(TEMPO_MAX_BPM / TEMPO_MIN_BPM);
    }

    /* ---- metronome accent pattern ------------------------------------
     * The beat accents for a meter's numerator, "strong" / "weak", one per beat.
     * A compound meter (numerator a multiple of 3 greater than 3 — 6, 9, 12, …) is
     * felt in groups of three, each group starting strong; every other meter is
     * simple, with only the downbeat strong. So 4/4 → S w w w, 6/8 → S w w S w w.
     * (The denominator affects notation, not this grouping.)
     */
    function metronomePattern(numerator) {
        const n = Math.max(1, Math.floor(numerator));
        const compound = n > 3 && n % 3 === 0;
        const out = [];
        for (let i = 0; i < n; i++) out.push((compound ? i % 3 === 0 : i === 0) ? "strong" : "weak");
        return out;
    }

    /* ---- Web Audio playback (browser only) ---------------------------- */
    let audioCtx = null;
    function getCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }
    // one playback at a time: track the live oscillators + master so it can be
    // stopped, and fire onEnd exactly once (whether it finishes or is stopped).
    let activeNodes = [];
    let activeMaster = null;
    let endTimer = null;
    let onEndCb = null;
    let playing = false;

    function isPlaying() {
        return playing;
    }
    // reset state and fire onEnd once (shared by natural end and stopPlayback)
    function finishPlayback() {
        if (endTimer) clearTimeout(endTimer);
        endTimer = null;
        activeNodes = [];
        activeMaster = null;
        playing = false;
        const cb = onEndCb;
        onEndCb = null;
        if (cb) cb();
    }
    // stop playback now, fading the master out over a few ms to avoid a click.
    function stopPlayback() {
        if (!playing) return;
        const ctx = audioCtx;
        if (ctx && activeMaster) {
            const now = ctx.currentTime;
            try {
                activeMaster.gain.cancelScheduledValues(now);
                activeMaster.gain.setValueAtTime(activeMaster.gain.value, now);
                activeMaster.gain.linearRampToValueAtTime(0, now + 0.03);
            } catch (e) {
                /* node already gone */
            }
            for (const n of activeNodes) {
                try {
                    n.stop(now + 0.05);
                } catch (e) {
                    /* already stopped */
                }
            }
        }
        finishPlayback();
    }

    // a short metronome click at time `t`: a higher, louder blip on strong beats.
    // Returns the oscillator so the caller can track it for stopping.
    function metronomeClick(ctx, dest, t, strong) {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = strong ? 1760 : 1245;
        const g = ctx.createGain();
        const dur = 0.045;
        const peak = strong ? 0.5 : 0.26;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(dest);
        osc.start(t);
        osc.stop(t + dur + 0.01);
        return osc;
    }

    // Play a sequence of chords (each an array of note names) one after another, as
    // triangle-wave tones with a short attack/release envelope so they don't click.
    // Each chord lasts `beatsPerChord` beats at `bpm`; if `metronome`, a click sounds
    // on every beat, accented by `meterNumerator`. Only one playback runs at a time;
    // `onEnd` fires when it finishes or is stopped. Returns the end time (ctx seconds).
    function playVoicing(voicing, { bpm = 120, beatsPerChord = 4, metronome = true, meterNumerator = 4, noteGain = 0.13, onEnd = null } = {}) {
        stopPlayback(); // never overlap two playbacks
        const ctx = getCtx();
        if (ctx.state === "suspended") ctx.resume(); // browsers gate audio on a gesture
        const beatSec = 60 / bpm;
        const chordDur = beatsPerChord * beatSec;
        const master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(ctx.destination);
        activeMaster = master;
        activeNodes = [];
        onEndCb = onEnd;
        playing = true;
        const attack = 0.012,
            release = 0.14;
        const start = ctx.currentTime + 0.06;
        let t = start;
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
                activeNodes.push(osc);
            }
            t += chordDur;
        }
        if (metronome) {
            const pattern = metronomePattern(meterNumerator);
            const totalBeats = voicing.length * beatsPerChord;
            for (let i = 0; i < totalBeats; i++) {
                activeNodes.push(metronomeClick(ctx, master, start + i * beatSec, pattern[i % pattern.length] === "strong"));
            }
        }
        // revert to the idle state a moment after the last sound finishes
        endTimer = setTimeout(finishPlayback, Math.max(0, t - ctx.currentTime) * 1000 + 120);
        return t;
    }

    return {
        noteToMidi,
        midiToFrequency,
        noteToFrequency,
        playVoicing,
        stopPlayback,
        isPlaying,
        TEMPO_MIN_BPM,
        TEMPO_MAX_BPM,
        bpmFromFraction,
        fractionFromBpm,
        metronomePattern,
    };
});
