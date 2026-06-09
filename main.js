/* =====================================================================
 * main.js — rendering + UI for the chord cylinder.
 *
 * All music theory (parsing, spelling, intervals, voice leading) lives in
 * theory.js, which must be loaded BEFORE this file. It exposes these as
 * globals: parseChord, parseProgression, voiceLeading, absDistance,
 * hasTritone, describe, NOTE_NAMES.
 * ===================================================================== */

/* ====================== state ====================== */
// each chord: { symbol, pcs:[...], rootPc:Number|null, fifthStart:Number }
// fifthStart is the chord's spelling: which length-12 segment of the spiral of
// fifths is adopted as the circle of fifths (see theory.js).
let chords = [];

const PRESETS = [
    "G7 → C",
    "Dm7 → G7 → C",
    "Cmaj7 → A7 → Dm7 → G7",
    "C → Am → F → G",
    "Dm → E7/D → C/D → D7",
    "Cm7b5 → F7 → B♭maj7",
    "Gm → G♭+ → B♭/F → Eø",
    "Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C",
];

// build an editor chord from a parsed symbol, auto-choosing the spelling slider
function chordFromParsed(c) {
    return { symbol: c.symbol, pcs: c.pcs, rootPc: c.rootPc, fifthStart: bestFifthStart(c.notes) };
}

// name of a pitch class within a chord, via that chord's spelling window
function noteName(ch, pc) {
    return nameInWindow(pc, ch.fifthStart);
}

/* ====================== palette ======================
 * All scene colors live here under semantic names so the palette can be
 * swapped wholesale later. Values mirror the CSS custom properties in
 * style.css (--semitone, --whole, --p4p5, --tritone, --accent, --accent2);
 * keep the two in sync if you re-theme. 0x… are WebGL colors, "#…" are the
 * CSS strings used for the canvas text labels.
 */
const COLORS = {
    scene: {
        background: 0x0e1116,
        light: 0xffffff,
        shell: 0x223049,
        railEven: 0x2b3a52,
        railOdd: 0x1f2a3b,
        baseRing: 0x2b3444,
        chordRing: 0x1c2738,
    },
    vertex: 0xffd166,
    vertexEmissive: 0x3a2c00,
    // intervals drawn inside a chord, by interval class
    interval: {
        semitone: 0x5ad17a,
        wholeStep: 0xffb454,
        minor3rd: 0x7fc8ff,
        major3rd: 0xd8fe4c,
        p4p5: 0xc792ea,
        tritone: 0xff5d6c,
    },
    // connection lines between chords, by how far the note moves (<= whole tone)
    voiceLeading: {
        hold: 0x999999, // no change
        semitone: 0x5ad17a, // 1 semitone
        wholeTone: 0xffb454, // 2 semitones
    },
    heldPane: 0x999999, // 45° wire mesh emphasising a pair of held notes
    // canvas text labels (CSS color strings)
    label: {
        default: "#e6edf3",
        rail: "#5f6b7a",
        vertex: "#ffffff",
        chord: "#4ea1ff",
    },
};

/* ====================== three.js scene ====================== */
let renderer, scene, camera, group;
const R = 5; // cylinder radius
const LAYER = 4.2; // vertical gap between chords
let spin = false,
    showAll = true,
    showIntervalLabels = true,
    showConnections = true;

function initThree() {
    const stage = document.getElementById("stage");
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    stage.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.scene.background);
    camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.1, 200);
    scene.add(new THREE.AmbientLight(COLORS.scene.light, 0.85));
    const dl = new THREE.DirectionalLight(COLORS.scene.light, 0.6);
    dl.position.set(6, 10, 8);
    scene.add(dl);
    group = new THREE.Group();
    scene.add(group);
    setupControls();
    animate();
    addEventListener("resize", () => {
        renderer.setSize(stage.clientWidth, stage.clientHeight);
        camera.aspect = stage.clientWidth / stage.clientHeight;
        camera.updateProjectionMatrix();
    });
}

// ---- custom orbit controls (no external dep) ----
let camTheta = 0.7,
    camPhi = 1.15,
    camRad = 26,
    camTarget = new THREE.Vector3(0, 0, 0);
function applyCam() {
    const x = camRad * Math.sin(camPhi) * Math.sin(camTheta);
    const y = camRad * Math.cos(camPhi);
    const z = camRad * Math.sin(camPhi) * Math.cos(camTheta);
    camera.position.set(x + camTarget.x, y + camTarget.y, z + camTarget.z);
    camera.lookAt(camTarget);
}
function setupControls() {
    const el = renderer.domElement;
    let drag = null,
        px,
        py;
    el.addEventListener("mousedown", (e) => {
        drag = e.button;
        px = e.clientX;
        py = e.clientY;
        e.preventDefault();
    });
    addEventListener("mouseup", () => {
        if (drag !== null) scheduleUrlUpdate(); // persist the new camera angle
        drag = null;
    });
    addEventListener("mousemove", (e) => {
        if (drag === null) return;
        const dx = e.clientX - px,
            dy = e.clientY - py;
        px = e.clientX;
        py = e.clientY;
        if (drag === 0) {
            camTheta -= dx * 0.008;
            camPhi = Math.max(0.15, Math.min(Math.PI - 0.15, camPhi - dy * 0.008));
        } else if (drag === 2) {
            // pan
            const panX = -dx * 0.02,
                panY = dy * 0.02;
            const right = new THREE.Vector3().subVectors(camera.position, camTarget).cross(camera.up).normalize();
            camTarget.addScaledVector(right, panX);
            camTarget.y += panY;
        }
        applyCam();
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener(
        "wheel",
        (e) => {
            camRad = Math.max(8, Math.min(80, camRad + e.deltaY * 0.02));
            applyCam();
            scheduleUrlUpdate(); // persist the new zoom
            e.preventDefault();
        },
        { passive: false },
    );
}
function animate() {
    requestAnimationFrame(animate);
    if (spin) {
        camTheta += 0.0035;
        applyCam();
    }
    renderer.render(scene, camera);
}

function clearGroup() {
    while (group.children.length) group.remove(group.children[0]);
}

function pcAngle(pc) {
    return (-pc / 12) * Math.PI * 2 + Math.PI / 2; // C at +Z front, going clockwise
}
function pcPos(pc, y) {
    const a = pcAngle(pc);
    return new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a));
}

// Build a text sprite. The canvas is sized to the text so long chord symbols
// (e.g. "Dø(9,13)omit3") are not cropped; worldHeight sets the on-screen size
// and the sprite's width is derived from the measured text so it never squishes.
function makeLabel(text, color = COLORS.label.default, worldHeight = 1.6) {
    const fontPx = 60;
    const pad = 14;
    const c = document.createElement("canvas");
    let g = c.getContext("2d");
    g.font = `bold ${fontPx}px -apple-system,Arial`;
    const textW = Math.ceil(g.measureText(text).width);
    c.width = textW + pad * 2; // resizing the canvas clears it...
    c.height = fontPx + pad * 2;
    g = c.getContext("2d");
    g.font = `bold ${fontPx}px -apple-system,Arial`; // ...so set the font again
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(worldHeight * (c.width / c.height), worldHeight, 1);
    return sp;
}

function tube(p1, p2, color, radius) {
    const path = new THREE.LineCurve3(p1, p2);
    const geo = new THREE.TubeGeometry(path, 1, radius, 8, false);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

// dashed/dotted line from p0 to p1: `period` evenly spaced marks, each covering
// `onFrac` of its cell (small onFrac -> dots, larger -> dashes).
function dashLine(p0, p1, color, radius, period, onFrac) {
    for (let s = 0; s < period; s++) {
        const a = p0.clone().lerp(p1, s / period);
        const b = p0.clone().lerp(p1, (s + onFrac) / period);
        group.add(tube(a, b, color, radius));
    }
}

// Faint 45° cross-hatch filling the planar rectangle whose vertical sides are
// the held notes p and q (between heights y0 and y1). Used to emphasise that a
// pair of notes is held constant across two chords.
const HATCH_SPACING = 0.55; // world units between mesh lines
function hatchPane(p, q, y0, y1, color) {
    const P0 = pcPos(p, y0),
        Q0 = pcPos(q, y0);
    const W = P0.distanceTo(Q0); // pane width  (the interval, as a straight chord)
    const H = y1 - y0; // pane height (one layer)
    if (W < 1e-6) return;
    const dHat = new THREE.Vector3().subVectors(Q0, P0).normalize();
    const at = (s, t) => P0.clone().addScaledVector(dHat, s).add(new THREE.Vector3(0, t, 0));
    const pts = [];
    // "/" family: s - t = c
    for (let c = -H; c <= W; c += HATCH_SPACING) {
        const tLo = Math.max(0, -c),
            tHi = Math.min(H, W - c);
        if (tHi > tLo) pts.push(at(tLo + c, tLo), at(tHi + c, tHi));
    }
    // "\" family: s + t = c
    for (let c = 0; c <= W + H; c += HATCH_SPACING) {
        const tLo = Math.max(0, c - W),
            tHi = Math.min(H, c);
        if (tHi > tLo) pts.push(at(c - tLo, tLo), at(c - tHi, tHi));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color });
    group.add(new THREE.LineSegments(geo, mat));
}

function intervalColor(semi) {
    if (semi === 6) return COLORS.interval.tritone;
    if (semi === 5 || semi === 7) return COLORS.interval.p4p5;
    if (semi === 4 || semi === 8) return COLORS.interval.major3rd;
    if (semi === 3 || semi === 9) return COLORS.interval.minor3rd;
    if (semi === 2 || semi === 10) return COLORS.interval.wholeStep;
    if (semi === 1 || semi === 11) return COLORS.interval.semitone;
    return 0xff00ff; // should be unreachable
}

// short label for an interval class (counting the smaller of the two inversions)
function intervalLabel(semi) {
    if (semi === 6) return "TT"; // tritone
    if (semi === 5 || semi === 7) return "P4"; // perfect fourth / fifth
    if (semi === 4 || semi === 8) return "M3"; // major third / minor sixth
    if (semi === 3 || semi === 9) return "m3"; // minor third / major sixth
    if (semi === 2 || semi === 10) return "W"; // whole step
    if (semi === 1 || semi === 11) return "H"; // half step
    return "";
}

// numeric WebGL color -> CSS "#rrggbb" string (for canvas text + DOM legend)
function hexCss(n) {
    return "#" + n.toString(16).padStart(6, "0");
}

function build() {
    clearGroup();
    if (chords.length === 0) return;
    const totalH = (chords.length - 1) * LAYER;
    camTarget.set(0, totalH / 2, 0);
    if (camRad < 8) camRad = 26;
    applyCam();

    // faint cylinder shell + 12 guide rails
    const shellGeo = new THREE.CylinderGeometry(R, R, Math.max(totalH + 2, 3), 48, 1, true);
    const shell = new THREE.Mesh(
        shellGeo,
        new THREE.MeshBasicMaterial({ color: COLORS.scene.shell, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    shell.position.y = totalH / 2;
    group.add(shell);
    for (let pc = 0; pc < 12; pc++) {
        const a = pcAngle(pc);
        const x = R * Math.cos(a),
            z = R * Math.sin(a);
        const railColor = pc % 2 === 0 ? COLORS.scene.railEven : COLORS.scene.railOdd;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, -1, z),
            new THREE.Vector3(x, totalH + 1, z),
        ]);
        group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: railColor })));
        const lbl = makeLabel(NOTE_NAMES[pc], COLORS.label.rail, 1.0);
        lbl.position.set(x * 1.12, -1.6, z * 1.12);
        group.add(lbl);
    }
    // bottom ring outline
    const ringPts = [];
    for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(R * Math.cos(a), -1, R * Math.sin(a)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: COLORS.scene.baseRing })));

    // each chord layer
    chords.forEach((ch, idx) => {
        const y = idx * LAYER;
        const pcs = ch.pcs;
        // chord plane ring (thin)
        const rp = [];
        for (let i = 0; i <= 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            rp.push(new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a)));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rp), new THREE.LineBasicMaterial({ color: COLORS.scene.chordRing })));

        // interior intervals: complete graph among notes
        for (let i = 0; i < pcs.length; i++)
            for (let j = i + 1; j < pcs.length; j++) {
                const semi = absDistance(pcs[i], pcs[j]);
                const isTri = semi === 6;
                if (!showAll && !isTri) continue;
                const col = intervalColor(semi);
                const rad = isTri ? 0.075 : 0.038;
                const a = pcPos(pcs[i], y),
                    b = pcPos(pcs[j], y);
                group.add(tube(a, b, col, rad));
                if (showIntervalLabels) {
                    // interval name (H/W/m3/M3/P4/TT) at the segment midpoint
                    const lbl = makeLabel(intervalLabel(semi), hexCss(col), 0.95);
                    lbl.position.copy(a.clone().lerp(b, 0.5));
                    group.add(lbl);
                }
            }
        // vertices, labelled with the chord's own spelling
        pcs.forEach((pc) => {
            const p = pcPos(pc, y);
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 16, 16),
                new THREE.MeshStandardMaterial({ color: COLORS.vertex, emissive: COLORS.vertexEmissive, roughness: 0.4 }),
            );
            dot.position.copy(p);
            group.add(dot);
            const lbl = makeLabel(noteName(ch, pc), COLORS.label.vertex);
            lbl.position.copy(p).add(new THREE.Vector3(0, 0.55, 0));
            group.add(lbl);
        });
        // chord name label, floating outward (sized to its text, never cropped)
        const cname = makeLabel(ch.symbol, COLORS.label.chord, 2.4);
        cname.position.set(0, y, -R - 2.4);
        group.add(cname);
    });

    // connections between consecutive chords (toggleable): every pair of notes
    // within a whole tone, styled by how far the note moves
    if (showConnections) {
        for (let i = 0; i < chords.length - 1; i++) {
            const y0 = i * LAYER,
                y1 = (i + 1) * LAYER;
            const A = chords[i].pcs,
                B = chords[i + 1].pcs;
            voiceLeading(A, B).forEach((mv) => {
                const p0 = pcPos(mv.from, y0),
                    p1 = pcPos(mv.to, y1);
                const d = Math.abs(mv.dist);
                if (d === 0) {
                    // no change: thick sturdy solid line
                    group.add(tube(p0, p1, COLORS.voiceLeading.hold, 0.15));
                } else if (d === 1) {
                    // semitone: dense dotted line
                    dashLine(p0, p1, COLORS.voiceLeading.semitone, 0.086, 12, 0.5);
                } else {
                    // whole tone: dashed line
                    dashLine(p0, p1, COLORS.voiceLeading.wholeTone, 0.05, 9, 0.55);
                }
            });
            // each pair of notes held across both chords spans a rectangular
            // pane; emphasise it with a faint 45° wire mesh
            const held = A.filter((pc) => B.includes(pc));
            for (let m = 0; m < held.length; m++)
                for (let n = m + 1; n < held.length; n++) {
                    hatchPane(held[m], held[n], y0, y1, COLORS.heldPane);
                }
        }
    }
    renderAnalysis();
    updateButtons();
    scheduleUrlUpdate();
}

/* ====================== text ⟷ chips sync buttons ======================
 * "↓ Render" lights up (gains .primary) when the text box is ahead of the
 * chips; "↑ To text" lights up when the chips are ahead of the text. Pressing
 * either button re-syncs and clears both.
 */
let progEl, renderBtn, toTextBtn;
let textBaseline = "",
    chipsBaseline = "";
function chipsText() {
    return chords
        .map((c) => c.symbol)
        .filter(Boolean)
        .join(" → ");
}
function updateButtons() {
    if (!renderBtn) return;
    renderBtn.classList.toggle("primary", progEl.value !== textBaseline);
    toTextBtn.classList.toggle("primary", chipsText() !== chipsBaseline);
}
function syncBaselines() {
    if (!progEl) return;
    textBaseline = progEl.value;
    chipsBaseline = chipsText();
    updateButtons();
}

/* ====================== shareable URL state ======================
 * The whole scene (chords, toggles, camera) is mirrored into ?s=… using
 * history.replaceState, debounced, so links are shareable without flooding the
 * back button.
 */
let restoring = false;
let urlTimer = null;
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

function encodeState() {
    return {
        v: 1,
        c: chords.map((ch) => [ch.pcs, ch.rootPc, ch.fifthStart, ch.symbol]),
        t: [showAll, showIntervalLabels, showConnections, spin].map((b) => (b ? 1 : 0)),
        k: [round(camTheta, 3), round(camPhi, 3), round(camRad, 2), round(camTarget.x, 2), round(camTarget.y, 2), round(camTarget.z, 2)],
    };
}
function scheduleUrlUpdate() {
    if (restoring) return;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
        history.replaceState(null, "", "?s=" + encodeURIComponent(JSON.stringify(encodeState())));
    }, 300);
}
function restoreState() {
    const m = location.search.match(/[?&]s=([^&]+)/);
    if (!m) return false;
    let st;
    try {
        st = JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
        return false;
    }
    if (!st || !Array.isArray(st.c)) return false;
    restoring = true;
    try {
        chords = st.c.map(([pcs, rootPc, fifthStart, symbol]) => ({
            pcs: pcs.slice(),
            rootPc: rootPc == null ? null : rootPc,
            fifthStart,
            symbol,
        }));
        if (Array.isArray(st.t)) {
            [showAll, showIntervalLabels, showConnections, spin] = st.t.map(Boolean);
            document.getElementById("tShowAll").checked = showAll;
            document.getElementById("tIntervalLabels").checked = showIntervalLabels;
            document.getElementById("tConnections").checked = showConnections;
            document.getElementById("tSpin").checked = spin;
        }
        progEl.value = chipsText();
        renderChips();
        build(); // build() resets the camera, so restore it afterwards
        if (Array.isArray(st.k)) {
            [camTheta, camPhi, camRad, camTarget.x, camTarget.y, camTarget.z] = st.k;
            applyCam();
        }
        syncBaselines();
    } finally {
        restoring = false;
    }
    return true;
}

/* ====================== UI ====================== */
// re-name a hand-edited chord from its notes, tagged root and spelling window
function renameChord(ch) {
    ch.symbol = describe(ch.pcs, ch.rootPc, ch.fifthStart);
}

function renderChips() {
    const wrap = document.getElementById("chips");
    wrap.innerHTML = "";
    chords.forEach((ch, idx) => {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `
      <div class="hd"><div class="nm"></div><button class="del">✕</button></div>
      <details>
      <summary>Edit</summary>
      <div class="ring"></div>
      <div class="spec">
        <span>Prefer ♭</span>
        <input class="slider" type="range" min="${FIFTH_MIN}" max="${FIFTH_MAX}" step="1" value="${ch.fifthStart}">
        <span>Prefer ♯</span>
      </div>
      <div class="spechint">left-click: add/remove · right-click: tag root</div></details>`;
        const nm = chip.querySelector(".nm");
        const ring = chip.querySelector(".ring");
        const buttons = [];

        // refresh the chip's text + button labels/classes (cheap, keeps the
        // slider element alive so dragging it stays smooth)
        const refresh = () => {
            nm.innerHTML = `${ch.symbol || "chord " + (idx + 1)} <small>${ch.pcs
                .map((p) => noteName(ch, p))
                .join(" ")}</small>`;
            for (let pc = 0; pc < 12; pc++) {
                const b = buttons[pc];
                b.textContent = noteName(ch, pc);
                b.className = "pc" + (pc === ch.rootPc ? " root" : ch.pcs.includes(pc) ? " on" : "");
            }
        };

        for (let pc = 0; pc < 12; pc++) {
            const b = document.createElement("div");
            buttons[pc] = b;
            // left-click: toggle membership
            b.onclick = () => {
                if (ch.pcs.includes(pc)) {
                    ch.pcs = ch.pcs.filter((x) => x !== pc);
                    if (ch.rootPc === pc) ch.rootPc = null; // root must be a member
                } else {
                    ch.pcs = [...ch.pcs, pc].sort((a, b) => a - b);
                }
                renameChord(ch);
                refresh();
                build();
            };
            // right-click: tag (or untag) the root
            b.oncontextmenu = (e) => {
                e.preventDefault();
                if (ch.rootPc === pc) {
                    ch.rootPc = null;
                } else {
                    ch.rootPc = pc;
                    if (!ch.pcs.includes(pc)) ch.pcs = [...ch.pcs, pc].sort((a, b) => a - b);
                }
                renameChord(ch);
                refresh();
                build();
            };
            ring.appendChild(b);
        }

        // spelling slider: choose which 12-segment of the spiral of fifths to adopt
        chip.querySelector(".slider").oninput = (e) => {
            ch.fifthStart = Number(e.target.value);
            renameChord(ch);
            refresh(); // relabel buttons live, in place
            build();
        };
        chip.querySelector(".del").onclick = () => {
            chords.splice(idx, 1);
            renderChips();
            build();
        };

        wrap.appendChild(chip);
        refresh();
    });
}

function renderAnalysis() {
    const el = document.getElementById("analysis");
    if (chords.length < 2) {
        el.innerHTML = "<h3>Analysis</h3><div style='color:var(--muted)'>Add a second chord to see voice leading.</div>";
        return;
    }
    let html = "<h3>Connections</h3>";
    for (let i = 0; i < chords.length - 1; i++) {
        const A = chords[i],
            B = chords[i + 1];
        html += `<div style="margin:6px 0 4px;font-weight:600;color:var(--accent)">${A.symbol} → ${B.symbol}</div>`;
        voiceLeading(A.pcs, B.pcs).forEach((mv) => {
            const d = mv.dist;
            let tag, txt;
            if (d === 0) {
                tag = "hold";
                txt = "held";
            } else if (Math.abs(d) === 1) {
                tag = "semi";
                txt = (d > 0 ? "+" : "") + d + " st";
            } else {
                tag = "whole";
                txt = (d > 0 ? "+" : "") + d + " st";
            }
            const arrow = `${noteName(A, mv.from)}→${noteName(B, mv.to)}`;
            html += `<div class="mv"><b>${arrow}</b><span class="tag ${tag}">${txt}</span></div>`;
        });
        /*if (hasTritone(A.pcs) && !hasTritone(B.pcs)) {
            html += `<div class="hint">Tritone resolves: dissonance released.</div>`;
        }*/
    }
    el.innerHTML = html;
}

function doRender() {
    const err = document.getElementById("err");
    err.textContent = "";
    try {
        const parsed = parseProgression(document.getElementById("prog").value);
        if (parsed.length === 0) {
            err.textContent = "Enter at least one chord.";
            return;
        }
        chords = parsed.map(chordFromParsed);
        renderChips();
        build();
        syncBaselines(); // text and chips are now in sync → clear both buttons
    } catch (e) {
        err.textContent = e.message;
    }
}

function setupUI() {
    progEl = document.getElementById("prog");
    renderBtn = document.getElementById("render");
    toTextBtn = document.getElementById("toText");

    renderBtn.onclick = doRender;
    progEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doRender();
    });
    // editing the text box makes Render the suggested action
    progEl.addEventListener("input", updateButtons);
    // inverse of Render: turn the current chips back into a progression string.
    // Each chip's symbol is describe()-generated, so it re-parses to the same notes.
    toTextBtn.onclick = () => {
        progEl.value = chipsText();
        document.getElementById("err").textContent = "";
        syncBaselines(); // chips and text now match → clear both buttons
    };
    document.getElementById("add").onclick = () => {
        chords.push(chordFromParsed(parseChord("C")));
        renderChips();
        build();
    };
    document.getElementById("tShowAll").onchange = (e) => {
        showAll = e.target.checked;
        build();
    };
    document.getElementById("tIntervalLabels").onchange = (e) => {
        showIntervalLabels = e.target.checked;
        build();
    };
    document.getElementById("tConnections").onchange = (e) => {
        showConnections = e.target.checked;
        build();
    };
    document.getElementById("tSpin").onchange = (e) => {
        spin = e.target.checked;
        scheduleUrlUpdate();
    };
    const pr = document.getElementById("presets");
    PRESETS.forEach((p) => {
        const b = document.createElement("button");
        b.className = "preset";
        b.textContent = p;
        b.onclick = () => {
            document.getElementById("prog").value = p;
            doRender();
        };
        pr.appendChild(b);
    });
}

window.addEventListener("DOMContentLoaded", () => {
    initThree();
    setupUI();
    // restore a shared scene from ?s=…, else render the default progression
    if (!restoreState()) doRender();
});
// expose for debugging / browser-console verification
window.__cc = {
    parseChord,
    parseProgression,
    voiceLeading,
    absDistance,
    get chords() {
        return chords;
    },
};
