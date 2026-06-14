/* =====================================================================
 * main.js — rendering + UI for the chord cylinder.
 *
 * All music theory lives in three modules that must be loaded BEFORE this file:
 *   theory-pitchclass.js
 *   theory-chordname.js
 *   theory-roman.js   (expands "{V7 → i=} Am"-style curly-brace relative input)
 * They attach their functions to the global scope.
 * ===================================================================== */

/* ====================== state ====================== */
// each chord: { symbol, pcs:[...], rootPc:Number|null, fifthStart:Number }
// fifthStart is the chord's spelling: which length-12 segment of the spiral of
// fifths is adopted as the circle of fifths (see theory-chordname.js).
let chords = [];

const PRESETS = [
    "G7 → C", "E7 → Am",
    "Dm7 → G7 → CMaj",
    "CM7 → A7 → Dm7 → G7",
    "C → Am → F → G",
    "Abdim7 → C6", "F6 C°7 C6",
    "Fm7 → B♭7 → C6",
    "{II7→V7→I=}E♭",
    "{V7 ♭III=} A♭",
    "D{=I V vi iii IV I IV V}",
    "F→{V7→i=}Dm→{V7→I=}B♭{=I→V}→{II7→V7→I=}F",
    "G - F#@ - F",
    "G7sus4→G7→C",
    "Dm → E7/D → C/D → D7",
    "Cm7b5 → F7 → B♭maj7",
    "Gm → G♭+ → B♭/F → E∅",
    "C - Caug - C - F#@ - BΔ7",
    "Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C",
    "EbΔ7 - Dm7 - CΔ7 - Bm7 - AΔ7 - G#m7 - GbΔ7 - Fm7 - EbΔ7"
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
 * style.css (--semitone, --whole, --p4p5, --tritone, --accent);
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
let renderer, scene, camera, group, nameGroup;
const R = 5; // cylinder radius
let LAYER = 4.2; // vertical gap between chords (stretch/compress the cylinder)
let spin = false,
    showConsonant = true, // m3, M3, P4/P5 interior intervals
    showDissonant = true, // H, W, TT interior intervals
    showIntervalLabels = true,
    showConnections = true,
    circleOfFifths = false; // arrange the ring by fifths instead of chromatically
// chord-name sprite placement (shared by every chord): azimuth + distance from axis
let nameAzDeg = 270, // 270° = the F♯ side, the original fixed position
    nameDist = R + 2.4,
    nameSpinOffset = 0; // accumulated counter-spin so names appear to hold still

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
    // chord-name sprites live in their own group
    nameGroup = new THREE.Group();
    scene.add(nameGroup);
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
const SPIN_SPEED = 0.0035; // radians/frame for auto-rotate
function animate() {
    requestAnimationFrame(animate);
    if (spin) {
        camTheta += SPIN_SPEED;
        applyCam();
    }
    if (nameGroup) nameGroup.rotation.y = 0;
    renderer.render(scene, camera);
}

function clearGroup() {
    while (group.children.length) group.remove(group.children[0]);
    while (nameGroup.children.length) nameGroup.remove(nameGroup.children[0]);
}

function pcAngle(pc) {
    // position around the ring depends on the arrangement (chromatic / fifths)
    return (-ringIndex(pc, circleOfFifths) / 12) * Math.PI * 2 + Math.PI / 2;
}
function pcPos(pc, y) {
    const a = pcAngle(pc);
    return new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a));
}

// hard-stop canvas gradient for a multi-function chord-name fill ("plus" splits
// vertically, "or" slashes diagonally — mirroring the axis-system panel)
function labelGradient(g, w, h, { colors, kind }) {
    const grad = kind === "or" ? g.createLinearGradient(0, 0, w, h) : g.createLinearGradient(0, h, 0, 0);
    const n = colors.length;
    colors.forEach((col, i) => {
        grad.addColorStop(i / n, col);
        grad.addColorStop((i + 1) / n, col);
    });
    return grad;
}

// Build a text sprite. The canvas is sized to the text so long chord symbols
// (e.g. "Dø(9,13)omit3") are not cropped; worldHeight sets the on-screen size
// and the sprite's width is derived from the measured text so it never squishes.
// `color` is a CSS color string, or a { colors, kind } gradient descriptor.
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
    g.fillStyle = typeof color === "string" ? color : labelGradient(g, c.width, c.height, color);
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

// A connection between two notes on adjacent layers, as a helix on the cylinder
// surface: the azimuth and height interpolate linearly while the radius stays R.
// φ moves by exactly `step` ring steps the short way (so single-step / whole-tone
// line clichés read as smooth spirals rather than chords through the interior).
function connCurve(fromPc, toPc, step, y0, y1) {
    const a0 = pcAngle(fromPc);
    const a1 = a0 - (step / 12) * Math.PI * 2; // signed: short way round the ring
    return (t) => {
        const a = a0 + (a1 - a0) * t;
        const y = y0 + (y1 - y0) * t;
        return new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a));
    };
}

// dashed/dotted spiral along a parametric curve fn:[0,1]->Vector3. `period`
// evenly spaced marks, each covering `onFrac` of its cell (small onFrac -> dots).
function dashSpiral(fn, color, radius, period, onFrac) {
    const sub = 3; // straight sub-segments per dash, so each dash follows the curve
    for (let s = 0; s < period; s++) {
        const tA = s / period,
            tB = (s + onFrac) / period;
        for (let k = 0; k < sub; k++) {
            group.add(tube(fn(tA + ((tB - tA) * k) / sub), fn(tA + ((tB - tA) * (k + 1)) / sub), color, radius));
        }
    }
}

// a small cone at the curve's midpoint, pointing along travel — an arrowhead
// that shows the progression advancing up the cylinder
function arrowCone(fn, color, {coneRadius, t}) {
    const mid = fn(t);
    const dir = new THREE.Vector3().subVectors(fn(0.54), fn(0.46)).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(coneRadius, 0.45, 12), new THREE.MeshBasicMaterial({ color }));
    cone.position.copy(mid);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(cone);
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

/* ====================== axis-system panel (harmonic function + tonnetz) ======================
 * A crude harmonic-function approximation (see theory-pitchclass.js): the chord
 * name is coloured by approximateChordFunction, and a small "dim tonnetz" grid
 * marks the chord tones. The grid has two interleaved sub-lattices (net1/net2);
 * we show whichever one keeps the chord tones connected.
 */
let tonicResidue = 0; // which pc % 3 residue is treated as the tonic (axis-system rotation)
let colorChords = false, // opt-in: tint chord names (panel + cylinder) by harmonic function
    colorVertices = false, // tint the 3D vertices by harmonic function
    accessibleColors = false; // use the red-green-avoiding --accessible-* palette
// the fixed 24-cell tonnetz layout (6 columns × 4 rows): { pc, net } per cell,
// matching axis-test.html. Horizontal neighbours are +4 (major third), the two
// nets form a checkerboard.
const TONNETZ = [
    { pc: 3, net: 1 }, { pc: 5, net: 2 }, { pc: 7, net: 1 }, { pc: 9, net: 2 }, { pc: 11, net: 1 }, { pc: 1, net: 2 },
    { pc: 10, net: 2 }, { pc: 0, net: 1 }, { pc: 2, net: 2 }, { pc: 4, net: 1 }, { pc: 6, net: 2 }, { pc: 8, net: 1 },
    { pc: 5, net: 1 }, { pc: 7, net: 2 }, { pc: 9, net: 1 }, { pc: 11, net: 2 }, { pc: 1, net: 1 }, { pc: 3, net: 2 },
    { pc: 0, net: 2 }, { pc: 2, net: 1 }, { pc: 4, net: 2 }, { pc: 6, net: 1 }, { pc: 8, net: 2 }, { pc: 10, net: 1 },
];

// number of connected components among a chord's cells within one net. Two cells
// are adjacent on this triangular lattice when they share a row two columns apart
// or sit one row and one column apart.
function netComponents(pcs, net) {
    const cells = [];
    TONNETZ.forEach((c, i) => {
        if (c.net === net && pcs.includes(c.pc)) cells.push({ row: (i / 6) | 0, col: i % 6 });
    });
    const adj = (a, b) => {
        const dr = Math.abs(a.row - b.row),
            dc = Math.abs(a.col - b.col);
        return (dr === 0 && dc === 2) || (dr === 1 && dc === 1);
    };
    const seen = new Array(cells.length).fill(false);
    let comps = 0;
    for (let i = 0; i < cells.length; i++) {
        if (seen[i]) continue;
        comps++;
        const stack = [i];
        seen[i] = true;
        while (stack.length) {
            const k = stack.pop();
            for (let j = 0; j < cells.length; j++) if (!seen[j] && adj(cells[k], cells[j])) (seen[j] = true), stack.push(j);
        }
    }
    return comps;
}

// pick the net that keeps the chord tones most connected (fewest components);
// ties go to net 1.
function chooseNet(pcs) {
    return netComponents(pcs, 1) <= netComponents(pcs, 2) ? 1 : 2;
}

const FUNC_ORDER = ["tonic", "subdominant", "dominant", "unjudgeable"];
// CSS-variable colors (auto-switch under body.accessible — see style.css)
const AXIS_COLOR = {
    tonic: "var(--tonic-color)",
    subdominant: "var(--subdominant-color)",
    dominant: "var(--dominant-color)",
    unjudgeable: "var(--muted)",
};
// concrete hex equivalents (canvas / THREE can't read CSS vars), normal + accessible
const AXIS_HEX_NORMAL = { tonic: "#49b656", subdominant: "#f1ab31", dominant: "#f15031", unjudgeable: "#9aa7b6" };
const AXIS_HEX_ACCESSIBLE = { tonic: "#4096ff", subdominant: "#f1ab31", dominant: "#5701e1", unjudgeable: "#9aa7b6" };
function axisHex(func) {
    return (accessibleColors ? AXIS_HEX_ACCESSIBLE : AXIS_HEX_NORMAL)[(func)];
}

// the fill for a chord's name, by its harmonic function: a solid color for a
// single function, or a { colors, kind } gradient for an "or"/"plus" — matching
// the axis-system panel. Falls back to white when unjudged.
function chordFunctionFill(ch) {
    const funcs = approximateChordFunction(pcFunctionCounts(ch.pcs, tonicResidue));
    if (funcs.length === 0) return "#ffffff";
    const isOr = funcs.length === 1 && funcs[0].includes("|");
    const uniq = [...new Set(funcs.flatMap((f) => f.split("|")))];
    if (uniq.length === 1) return axisHex(uniq[0]) || "#ffffff";
    return { colors: FUNC_ORDER.filter((f) => uniq.includes(f)).map((f) => axisHex(f)), kind: isOr ? "or" : "plus" };
}
// Map the judgments to a chord-name style. Each judgment is one element; an
// element "a|b" is a single *ambiguous* judgment ("or"), whereas several
// elements are an overlap of distinct judgments ("plus"). A single function is a
// solid colour; an "or" draws a 140° slash (suggesting the "/" glyph); a "plus"
// (or any other mix) splits horizontally (0°, suggesting stacked layers).
function axisNameAttrs(funcs) {
    if (funcs.length === 0) return { cls: "", style: "" };
    const isOr = funcs.length === 1 && funcs[0].includes("|");
    const isPlus = funcs.length > 1;
    const uniq = [...new Set(funcs.flatMap((f) => f.split("|")))];

    if (!isOr && !isPlus) {
        const f = (funcs[0]);
        if (AXIS_COLOR[f] && f !== "unjudgeable") return { cls: f, style: "" }; // single → solid
    }

    const cols = FUNC_ORDER.filter((f) => uniq.includes(f)).map((f) => AXIS_COLOR[f]);
    const n = cols.length;
    const stops = cols.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(", ");
    const angle = isOr ? 140 : 0; // "or" slashes, "plus" splits horizontally
    return { cls: "generic", style: ` style="background:linear-gradient(${angle}deg,${stops});color:#fff"` };
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let lastAxisSig = null;
// re-render the axis-system panel only when the chord set actually changed
function refreshAxisSystem() {
    const el = document.getElementById("axis-system");
    if (!el) return;
    const sig = JSON.stringify([tonicResidue, colorChords, chords.map((c) => [c.symbol, c.pcs])]);
    if (sig === lastAxisSig) return;
    lastAxisSig = sig;

    if (chords.length === 0) {
        el.innerHTML = "";
        return;
    }
    // shifter: which pc % 3 group is the tonic (rotates every colour & label)
    const tonicNotes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((p) => p % 3 === tonicResidue).map((p) => NOTE_NAMES[p]).join(" ");
    let html = "";
    html +=
        `<div class="axis-controls">tonic group: ` +
        `<button class="tonic-shift" id="tonicPrev" title="shift tonic group">◀</button>` +
        `<span class="tonic-group">${tonicNotes}</span>` +
        `<button class="tonic-shift" id="tonicNext" title="shift tonic group">▶</button></div>`;
    html += '<div class="axis-row">';
    for (const ch of chords) {
        // chord-name coloring (panel + cylinder) is opt-in — the nonstandard
        // interpretation; note/tonnetz coloring always stays on
        const funcs = approximateChordFunction(pcFunctionCounts(ch.pcs, tonicResidue));
        const { cls, style } = colorChords ? axisNameAttrs(funcs) : { cls: "", style: "" };
        const net = chooseNet(ch.pcs);
        let cells = "";
        for (const { pc, net: cellNet } of TONNETZ) {
            const belongs = ch.pcs.includes(pc) ? " belongs" : "";
            cells += `<button class="grid-cell net${cellNet} ${pcFunction(pc, tonicResidue)}${belongs}"><span class="grid-cell__label">${NOTE_NAMES[pc]}</span></button>`;
        }
        html += `<div class="child-box"><span class="chord-name ${cls}"${style}>${escapeHtml(ch.symbol)}</span>` + `<div class="grid show-net${net}">${cells}</div></div>`;
    }
    html += "</div>";
    el.innerHTML = html;
    const shiftTonic = (delta) => {
        tonicResidue = (tonicResidue + delta + 3) % 3;
        build(); // re-render the cylinder too (vertex / name colours follow the tonic group)
    };
    document.getElementById("tonicPrev").onclick = () => shiftTonic(-1);
    document.getElementById("tonicNext").onclick = () => shiftTonic(1);
}

function build() {
    clearGroup();
    refreshAxisSystem();
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
                const semi = absDistance(pcs[i], pcs[j]); // interval class 1..6
                // consonant = m3 / M3 / P4 (3,4,5); dissonant = H / W / TT (1,2,6)
                const consonant = semi === 3 || semi === 4 || semi === 5;
                if (consonant ? !showConsonant : !showDissonant) continue;
                const col = intervalColor(semi);
                const rad = consonant ? 0.038 : 0.075;
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
            let vColor = COLORS.vertex,
                vEmissive = COLORS.vertexEmissive;
            if (colorVertices) {
                vColor = new THREE.Color(axisHex(pcFunction(pc, tonicResidue)));
                vEmissive = vColor.clone().multiplyScalar(0.25);
            }
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 16, 16),
                new THREE.MeshStandardMaterial({ color: vColor, emissive: vEmissive, roughness: 0.4 }),
            );
            dot.position.copy(p);
            group.add(dot);
            const lbl = makeLabel(noteName(ch, pc), COLORS.label.vertex);
            lbl.position.copy(p).add(new THREE.Vector3(0, 0.55, 0));
            group.add(lbl);
        });
        // chord name label, at the adjustable azimuth/distance (in nameGroup so
        // it can be counter-spun); sized to its text, never cropped
        const az = (nameAzDeg * Math.PI) / 180;
        const cname = makeLabel(ch.symbol, colorChords ? chordFunctionFill(ch) : COLORS.label.chord, 2.4);
        cname.position.set(nameDist * Math.cos(az), y, nameDist * Math.sin(az));
        nameGroup.add(cname);
    });

    // connections between consecutive chords (toggleable): every pair of notes
    // within a whole tone, styled by how far the note moves
    if (showConnections) {
        for (let i = 0; i < chords.length - 1; i++) {
            const y0 = i * LAYER,
                y1 = (i + 1) * LAYER;
            const A = chords[i].pcs,
                B = chords[i + 1].pcs;
            voiceLeading(A, B, circleOfFifths).forEach((mv) => {
                const fn = connCurve(mv.from, mv.to, mv.step, y0, y1);
                const s = Math.abs(mv.step);
                if (s === 0) {
                    // no change: thick sturdy solid line
                    group.add(tube(fn(0), fn(1), COLORS.voiceLeading.hold, 0.15));
                    arrowCone(fn, COLORS.voiceLeading.hold, { coneRadius: 0.3, t: 0.6 });
                } else if (s === 1) {
                    // one ring step: a semitone (chromatic) or a fifth (circle of
                    // fifths) — colour it accordingly
                    const col = circleOfFifths ? COLORS.interval.p4p5 : COLORS.voiceLeading.semitone;
                    dashSpiral(fn, col, 0.086, 10, 0.4);
                    arrowCone(fn, col, { coneRadius: 0.17, t: 0.475 });
                } else {
                    // two ring steps: a whole tone in either arrangement
                    dashSpiral(fn, COLORS.voiceLeading.wholeTone, 0.05, 5, 0.55);
                    arrowCone(fn, COLORS.voiceLeading.wholeTone, { coneRadius: 0.17, t: 0.5 });
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
    
    // legend follows arrangement
    if (circleOfFifths) {
        document.getElementById("conn-single-step").innerHTML = `<td><u style="border-color:var(--p4p5);border-left-style:dotted"></u></td><td>fifth</td>`;
    } else {
        document.getElementById("conn-single-step").innerHTML = `<td><u style="border-color:var(--semitone);border-left-style:dotted"></u></td><td>semitone</td>`;
    }
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

// insert `text` at the caret of an input, then fire `input` so button state updates
function insertAtCursor(el, text) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    const pos = s + text.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event("input"));
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
        t: [showConsonant, showDissonant, showIntervalLabels, showConnections, spin, circleOfFifths, colorChords, colorVertices, accessibleColors].map((b) => (b ? 1 : 0)),
        k: [round(camTheta, 3), round(camPhi, 3), round(camRad, 2), round(camTarget.x, 2), round(camTarget.y, 2), round(camTarget.z, 2)],
        L: round(LAYER, 2),
        na: Math.round(nameAzDeg),
        nd: round(nameDist, 2),
        tr: tonicResidue,
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
            [showConsonant, showDissonant, showIntervalLabels, showConnections, spin, circleOfFifths, colorChords, colorVertices, accessibleColors] =
                st.t.map(Boolean);
            document.getElementById("tConsonant").checked = showConsonant;
            document.getElementById("tDissonant").checked = showDissonant;
            document.getElementById("tIntervalLabels").checked = showIntervalLabels;
            document.getElementById("tConnections").checked = showConnections;
            document.getElementById("tSpin").checked = spin;
            document.getElementById("tFifths").checked = circleOfFifths;
            document.getElementById("tColorNames").checked = colorChords;
            document.getElementById("tColorVertices").checked = colorVertices;
            document.getElementById("tAccessible").checked = accessibleColors;
            document.body.classList.toggle("accessible", accessibleColors);
        }
        if (st.L != null) LAYER = st.L;
        if (st.na != null) nameAzDeg = st.na;
        if (st.nd != null) nameDist = st.nd;
        if (st.tr != null) tonicResidue = st.tr;
        document.getElementById("layerSlider").value = LAYER;
        document.getElementById("nameAzimuth").value = nameAzDeg;
        document.getElementById("nameDistance").value = nameDist;
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
      <div class="hd"><div class="nm"></div><button class="del"><img src="close.svg" width="20" height="20" /></button></div>
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
            // this untags the root, so that a sane name is picked rather than trying to keep the root
            b.onclick = () => {
                if (ch.pcs.includes(pc)) {
                    ch.pcs = ch.pcs.filter((x) => x !== pc);
                    ch.rootPc = null;
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

let analysisIdx = 0; // which transition the analysis panel shows
function renderAnalysis() {
    const el = document.getElementById("analysis");
    if (chords.length < 2) {
        el.innerHTML = "<h3>Connections</h3><div style='color:var(--muted)'>Add a second chord to see the connections.</div>";
        return;
    }
    const nT = chords.length - 1;
    analysisIdx = Math.max(0, Math.min(analysisIdx, nT - 1)); // clamp if chords shrank

    // dropdown to pick a single transition (the whole list would be unwieldy)
    const options = chords.slice(0, nT).map((_, i) => `<option value="${i}"${i === analysisIdx ? " selected" : ""}>⟨${i + 1}⟩ ${chords[i].symbol} → ${chords[i + 1].symbol}</option>`)
        .join("");
    let html = `<h3>Connections</h3><select id="analysisSel" class="anaSel">${options}</select>`;

    const A = chords[analysisIdx],
        B = chords[analysisIdx + 1];
    voiceLeading(A.pcs, B.pcs, circleOfFifths).forEach((mv) => {
        const s = Math.abs(mv.step);
        let tag, txt;
        if (s === 0) {
            tag = "hold";
            txt = "held";
        } else if (s === 1) {
            tag = circleOfFifths ? "fifth" : "semi";
            txt = circleOfFifths ? (mv.step === 1 ? "P5" : "P4") : "H" + (mv.step === 1 ? "↑" : "↓");
        } else {
            tag = "whole";
            txt = "W"+ (mv.step === 2 ? "↑" : "↓");
        }
        const arrow = `${noteName(A, mv.from)}→${noteName(B, mv.to)}`;
        html += `<div class="mv"><b>${arrow}</b><span class="tag ${tag}">${txt}</span></div>`;
    });
    el.innerHTML = html;
    document.getElementById("analysisSel").onchange = (e) => {
        analysisIdx = Number(e.target.value);
        renderAnalysis();
    };
}

function doRender() {
    const err = document.getElementById("err");
    err.textContent = "";
    try {
        const raw = document.getElementById("prog").value;
        // resolve "curly-brace relative" notation (e.g. "{V7 → i=} Am") to absolute chords
        const text = raw.includes("{") ? progression.parseAndResolveCurlyBraceRelative(raw).join(" → ") : raw;
        const parsed = parseProgression(text);
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
    // mini keyboard: click to insert hard-to-type glyphs at the caret
    const handler = (btn) => {
        btn.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep the text box focused / caret intact
            insertAtCursor(progEl, btn.dataset.ins);
        });
    };
    document.querySelectorAll("#keypad .kp").forEach(handler);
    document.querySelectorAll("#keypad2 .kp").forEach(handler);
    document.querySelectorAll("#keypad3 .kp").forEach(handler);
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
    document.getElementById("tConsonant").onchange = (e) => {
        showConsonant = e.target.checked;
        build();
    };
    document.getElementById("tDissonant").onchange = (e) => {
        showDissonant = e.target.checked;
        build();
    };
    document.getElementById("tFifths").onchange = (e) => {
        circleOfFifths = e.target.checked;
        build();
    };
    document.getElementById("tColorNames").onchange = (e) => {
        colorChords = e.target.checked;
        build();
    };
    document.getElementById("tColorVertices").onchange = (e) => {
        colorVertices = e.target.checked;
        build();
    };
    document.getElementById("tAccessible").onchange = (e) => {
        accessibleColors = e.target.checked;
        document.body.classList.toggle("accessible", accessibleColors);
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
    document.getElementById("layerSlider").oninput = (e) => {
        LAYER = Number(e.target.value);
        build();
    };
    document.getElementById("nameAzimuth").oninput = (e) => {
        nameAzDeg = Number(e.target.value);
        build();
    };
    document.getElementById("nameDistance").oninput = (e) => {
        nameDist = Number(e.target.value);
        build();
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
