/* =====================================================================
 * main.js — rendering + UI for everything.
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
    "A → N.C. → E7 → A",
    "G - F#@ - F",
    "G7sus4→G7→C",
    "Dm → E7/D → C/D → D7",
    "Cm7b5 → F7 → B♭maj7",
    "Gm → G♭+ → B♭/F → E∅",
    "C - Caug - C - F#@ - BΔ7",
    "Am7 → Dø(9,13)omit3 → G7(b9,13)omit5 → C",
    "EbΔ7 - Dm7 - CΔ7 - Bm7 - AΔ7 - G#m7 - GbΔ7 - Fm7 - EbΔ7"
];

const PRESETS_WITH_RELATIVE_DEGREES = [
    "{II7→V7→I=}E♭",
    "{V7 ♭III=} A♭",
    "D{=I V vi iii IV I IV V}",
    "keyG#{IV V iii vi}",
    "keyEb{4536251}",
    "keyF{6-4-5-1}",
    "F→{V7→i=}Dm→{V7→I=}B♭{=I→V}→{II7→V7→I=}F",
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
    showLabelsOnIntervalSegment = true,
    showConnections = true,
    circleOfFifths = false, // arrange the ring by fifths instead of chromatically
    tetradShorthand = false; // false = bare Δ/°/dim/− are triads; true = bare Δ/°/dim/− are tetrads
// chord-name sprite placement (shared by every chord): azimuth + distance from axis
let nameAzDeg = 270, // 270° = the F♯ side, the original fixed position
    nameDist = R + 2.4,
    nameSpinOffset = 0; // accumulated counter-spin so names appear to hold still

function initThree() {
    const viewport = document.getElementById("viewport");
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    layoutViewport(); // size the render rectangle before the renderer reads it
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.scene.background);
    camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 200);
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
    addEventListener("resize", layoutViewport);
    // The overlay boxes grow/shrink with their content (e.g. the tonnetz gains a
    // column per chord), so re-fit the render rectangle whenever any of them — or
    // the stage — changes size.
    if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => layoutViewport());
        ro.observe(document.getElementById("stage"));
        document.querySelectorAll("#stage .overlay-box").forEach((b) => ro.observe(b));
    }
}

// Fit the #viewport to the largest central rectangle of #stage that the overlay
// boxes don't cover. Each box must be carved out by ONE of four full-width/height
// strips (left / right / top / bottom); carving any single strip fully removes the
// box, so the rectangle can never overlap one. We choose the strips to maximize the
// final rectangle's AREA rather than greedily picking the thinnest strip per box —
// the greedy rule wastes width on a corner box (e.g. #edit-view) whose bottom is
// already carved by its neighbours, so carving its bottom too is free. With only a
// handful of boxes we can brute-force all 4ⁿ assignments.
function layoutViewport() {
    const stage = document.getElementById("stage");
    const viewport = document.getElementById("viewport");
    if (!stage || !viewport) return;
    const sr = stage.getBoundingClientRect();
    const M = 8; // breathing room between the render area and the boxes
    const boxes = [];
    stage.querySelectorAll(".overlay-box").forEach((box) => {
        if (box.offsetParent === null) return; // skip hidden boxes
        const r = box.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        boxes.push({ x0: r.left - sr.left, x1: r.right - sr.left, y0: r.top - sr.top, y1: r.bottom - sr.top });
    });
    let left = 0,
        top = 0,
        right = sr.width,
        bottom = sr.height;
    if (boxes.length && boxes.length <= 8) {
        // brute force: for each box, side 0=left 1=right 2=top 3=bottom
        let bestArea = -1;
        for (let mask = 0; mask < 4 ** boxes.length; mask++) {
            let L = 0,
                T = 0,
                R = sr.width,
                B = sr.height,
                m = mask;
            for (const b of boxes) {
                const side = m & 3;
                m >>= 2;
                if (side === 0) L = Math.max(L, b.x1);
                else if (side === 1) R = Math.min(R, b.x0);
                else if (side === 2) T = Math.max(T, b.y1);
                else B = Math.min(B, b.y0);
            }
            const area = Math.max(0, R - L) * Math.max(0, B - T);
            if (area > bestArea) (bestArea = area), (left = L), (top = T), (right = R), (bottom = B);
        }
    } else {
        // fallback for an unexpected number of boxes: greedily carve the thinnest strip
        for (const b of boxes) {
            const cands = [
                { s: 0, t: b.x1 },
                { s: 1, t: sr.width - b.x0 },
                { s: 2, t: b.y1 },
                { s: 3, t: sr.height - b.y0 },
            ];
            const p = cands.reduce((a, c) => (c.t < a.t ? c : a));
            if (p.s === 0) left = Math.max(left, b.x1);
            else if (p.s === 1) right = Math.min(right, b.x0);
            else if (p.s === 2) top = Math.max(top, b.y1);
            else bottom = Math.min(bottom, b.y0);
        }
    }
    // the bottom bar (a sibling of #stage, overlapping its lower edge) isn't an
    // .overlay-box, so reserve its height explicitly — matters when every lower
    // box is hidden and nothing else carves the bottom
    const bar = document.getElementById("bottom-bar");
    if (bar) {
        const barTop = bar.getBoundingClientRect().top - sr.top;
        if (barTop < bottom) bottom = barTop;
    }
    left += M;
    top += M;
    right -= M;
    bottom -= M;
    // never collapse to nothing if the boxes are huge on a small window
    const w = Math.max(120, right - left);
    const h = Math.max(120, bottom - top);
    viewport.style.left = left + "px";
    viewport.style.top = top + "px";
    viewport.style.right = "auto";
    viewport.style.bottom = "auto";
    viewport.style.width = w + "px";
    viewport.style.height = h + "px";
    if (renderer && camera) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
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
// that shows the progression advancing down the cylinder
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
    const H = Math.abs(y1 - y0); // pane height (one layer)
    const vy = Math.sign(y1 - y0) || 1; // which way the layer runs vertically
    if (W < 1e-6) return;
    const dHat = new THREE.Vector3().subVectors(Q0, P0).normalize();
    const at = (s, t) => P0.clone().addScaledVector(dHat, s).add(new THREE.Vector3(0, vy * t, 0));
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
// how chord names are tinted: "none", "hsjoihs" (the axis-system interpretation),
// or "soundquest" (the relative-to-tonic lookup table in soundquest-data.js)
let chordScheme = "none",
    // how to color the notes (cylinder vertices, tonnetz cells, connections box):
    //   "none"   — no function/chroma tint
    //   "axis"   — by harmonic function (tonic / subdominant / dominant)
    //   "fifths" — by a circle-of-fifths chroma wheel (independent of #tFifths)
    noteScheme = "axis",
    accessibleColors = false; // use the red-green-avoiding --accessible-* palette
// Roman-numeral (relative) display: show chords as scale-degree numerals in a key.
let relativeMode = false, // false = absolute chord names, true = Roman numerals
    analysisTonic = 0, // which pitch class is degree I (the analysis key)
    tonicUserSet = false; // has the user pinned a tonic, vs. the auto default?
// label for a chord: an absolute symbol, or a Roman numeral in the analysis key.
// (Possibility 1 "re-analyze" just changes analysisTonic; the sounding pitches —
// ch.pcs — never move, so only this label changes.)
function chordLabel(ch) {
    return relativeMode ? chordToRelative(ch.symbol, majorKeyName(analysisTonic)) : ch.symbol;
}
// the fixed 24-cell doubled-tonnetz layout (6 columns × 4 rows): { pc, net } per cell,
// matching axis-test.html. Horizontal neighbours in each net are +4 (major third), the two
// nets form a checkerboard.
const DOUBLED_TONNETZ = [
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
    DOUBLED_TONNETZ.forEach((c, i) => {
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

/* ---- SoundQuest chord coloring ----
 * A relative-to-tonic lookup (soundquest-data.js): a chord's pitch classes,
 * reduced relative to the analysis tonic, map to one or more color categories.
 * Several categories on one chord (e.g. Vm7 = dominant + dominant-minor) draw as
 * a 140° slash, like the axis-system "or".
 */
const SOUNDQUEST_DETAIL = buildSoundquestDetail(chordToAbsolute, parseChord);
const CAT_CSS = {
    tonic: "var(--tonic-color)",
    pseudotonic: "var(--pseudotonic-color)",
    "pseudotonic-minor": "var(--pseudotonic-minor-color)",
    subdominant: "var(--subdominant-color)",
    "subdominant-minor": "var(--subdominant-minor-color)",
    dominant: "var(--dominant-color)",
    "dominant-minor": "var(--dominant-minor-color)",
};
const CAT_HEX = {
    tonic: "#49b656",
    pseudotonic: "#2CB28C",
    "pseudotonic-minor": "#5A6958",
    subdominant: "#f1ab31",
    "subdominant-minor": "#987f43",
    dominant: "#f15031",
    "dominant-minor": "#C2380A",
};
const CAT_ABBR = {
    tonic: "T",
    pseudotonic: "P",
    "pseudotonic-minor": "Pm",
    subdominant: "S",
    "subdominant-minor": "Sm",
    dominant: "D",
    "dominant-minor": "Dm",
};
// In accessible mode the seven categories collapse onto the three core functions
// (the red–green-safe palette only distinguishes T / S / D); the hover tooltip
// then carries the finer T/P/Pm · S/Sm · D/Dm distinction in text instead.
const ACCESSIBLE_GROUP = {
    tonic: "tonic",
    pseudotonic: "tonic",
    "pseudotonic-minor": "tonic",
    subdominant: "subdominant",
    "subdominant-minor": "subdominant",
    dominant: "dominant",
    "dominant-minor": "dominant",
};
// reduce a chord's categories to the color keys actually drawn: the seven
// categories normally, or the three merged groups (de-duplicated) when accessible
function displayCats(cats) {
    if (!accessibleColors) return cats;
    const seen = new Set();
    const out = [];
    for (const c of cats) {
        const g = ACCESSIBLE_GROUP[c];
        if (!seen.has(g)) (seen.add(g), out.push(g));
    }
    return out;
}
function catCss(key) {
    return CAT_CSS[key]; // body.accessible remaps the three core --*-color vars
}
function catHex(key) {
    return accessibleColors ? AXIS_HEX_ACCESSIBLE[key] : CAT_HEX[key];
}
// the SoundQuest detail (ordered [{category, symbols}]) for a chord, relative to
// the current analysis tonic
function sqDetail(ch) {
    if (!ch.pcs.length) return [];
    return SOUNDQUEST_DETAIL.get(soundquestKey(ch.pcs, analysisTonic)) || [];
}
function sqCategories(ch) {
    return sqDetail(ch).map((d) => d.category);
}
// hover text explaining the coloring: one line per category, "ABBR: sym, sym…"
function sqTooltip(ch) {
    return sqDetail(ch).map((d) => `${CAT_ABBR[d.category]}: ${d.symbols.join(", ")}`).join("\n");
}
// cylinder-sprite fill (hex, or a { colors, kind:"or" } slash gradient)
function sqFill(ch) {
    const cats = displayCats(sqCategories(ch));
    if (cats.length === 0) return "#ffffff";
    if (cats.length === 1) return catHex(cats[0]);
    return { colors: cats.map(catHex), kind: "or" };
}
// panel chip {cls, style}: solid for one category, 140° slash for several
function sqNameAttrs(ch) {
    const cats = displayCats(sqCategories(ch));
    if (cats.length === 0) return { cls: "", style: "" };
    if (cats.length === 1) return { cls: "generic", style: ` style="background:${catCss(cats[0])};color:#fff"` };
    const stops = cats.map((c, i) => `${catCss(c)} ${(i / cats.length) * 100}% ${((i + 1) / cats.length) * 100}%`).join(", ");
    return { cls: "generic", style: ` style="background:linear-gradient(140deg,${stops});color:#fff"` };
}

/* ---- circle-of-fifths chroma wheel ----
 * Mirrors the `.note` rules in musical-colors.css so the canvas/THREE vertices
 * match the CSS-painted tonnetz cells and connection chips exactly. The hue index
 * n advances by a fifth (so C=0, G=1, D=2, …), giving 30° hue steps, and is
 * deliberately independent of the #tFifths ring arrangement.
 */
function fifthsIndex(pc) {
    return ((7 * (((pc % 12) + 12) % 12)) % 12 + 12) % 12; // (7·pc) mod 12
}
// oklab → "#rrggbb" (sRGB). THREE r128 can't parse oklab/oklch, so convert here.
function oklabToHex(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const lin2srgb = (c) => {
        c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        return Math.max(0, Math.min(255, Math.round(c * 255)));
    };
    const r = lin2srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = lin2srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const bb = lin2srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return "#" + [r, g, bb].map((v) => v.toString(16).padStart(2, "0")).join("");
}
// the chroma-wheel color for a pitch class, honoring the accessible variant
function fifthsHex(pc) {
    const theta = (fifthsIndex(pc) * 30 * Math.PI) / 180;
    return accessibleColors
        ? oklabToHex(0.675 + 0.18 * Math.cos(theta), 0, 0.13 * Math.sin(theta)) // red-green-safe loop
        : oklabToHex(0.7, 0.12 * Math.cos(theta), 0.12 * Math.sin(theta)); // oklch(70% 0.12 θ)
}
// the color (CSS "#rrggbb") for a single note under the active scheme, or null for "none"
function noteHex(pc) {
    if (noteScheme === "fifths") return fifthsHex(pc);
    if (noteScheme === "axis") return axisHex(pcFunction(pc, tonicResidue));
    return null;
}
// HTML for a colored note name in the connections box, matching the active scheme
function noteChip(name, pc) {
    const esc = escapeHtml(name);
    if (noteScheme === "axis") return `<span class="note-chip fn-${pcFunction(pc, tonicResidue)}">${esc}</span>`;
    if (noteScheme === "fifths") return `<span class="note-chip note-text" style="--n:${fifthsIndex(pc)}">${esc}</span>`;
    return `<span class="note-chip">${esc}</span>`;
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

// dispatch chord-name coloring on the active scheme -------------------
// cylinder-sprite fill (a CSS color string or { colors, kind } gradient)
function chordNameFill(ch) {
    if (chordScheme === "hsjoihs") return chordFunctionFill(ch);
    if (chordScheme === "soundquest") return sqFill(ch);
    return COLORS.label.chord;
}
// axis-panel chip attributes ({ cls, style })
function chordNameAttrs(ch) {
    if (chordScheme === "hsjoihs") return axisNameAttrs(approximateChordFunction(pcFunctionCounts(ch.pcs, tonicResidue)));
    if (chordScheme === "soundquest") return sqNameAttrs(ch);
    return { cls: "", style: "" };
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let lastAxisSig = null;
// re-render the axis-system panel only when the chord set actually changed
function refreshAxisSystem() {
    const el = document.getElementById("axis-system");
    if (!el) return;
    const sig = JSON.stringify([tonicResidue, chordScheme, noteScheme, accessibleColors, relativeMode, analysisTonic, chords.map((c) => [c.symbol, c.pcs])]);
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
        // chord-name coloring (panel + cylinder) follows the selected scheme;
        // note/tonnetz coloring is independent and always stays on
        const { cls, style } = chordNameAttrs(ch);
        // explain SoundQuest coloring on hover (also surfaces the fine T/P/Pm…
        // distinction that the accessible 3-color merge hides)
        const titleAttr = chordScheme === "soundquest" ? ` title="${escapeHtml(sqTooltip(ch))}"` : "";
        const net = chooseNet(ch.pcs);
        let cells = "";
        for (const { pc, net: cellNet } of DOUBLED_TONNETZ) {
            const belongs = ch.pcs.includes(pc) ? " belongs" : "";
            // both scheme classes are present; CSS picks one via the grid's scheme-* class
            // C/F/G get the brightest accessible fifths-wheel fills, so they're flagged
            // to switch their label to black text when highlighted (see style.css)
            const bright = pc === 0 || pc === 5 || pc === 7 ? " bright-cfg" : "";
            cells += `<button class="grid-cell net${cellNet} ${pcFunction(pc, tonicResidue)}${belongs}${bright}" style="--n:${fifthsIndex(pc)}"><span class="grid-cell__label">${NOTE_NAMES[pc]}</span></button>`;
        }
        html += `<div class="child-box"><span class="chord-name ${cls}"${style}${titleAttr}>${escapeHtml(chordLabel(ch))}</span>` + `<div class="grid show-net${net} scheme-${noteScheme}">${cells}</div></div>`;
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
    camTarget.set(0, -totalH / 2, 0);
    if (camRad < 8) camRad = 26;
    applyCam();

    // faint cylinder shell + 12 guide rails
    const shellGeo = new THREE.CylinderGeometry(R, R, Math.max(totalH + 2, 3), 48, 1, true);
    const shell = new THREE.Mesh(
        shellGeo,
        new THREE.MeshBasicMaterial({ color: COLORS.scene.shell, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    shell.position.y = -totalH / 2;
    group.add(shell);
    for (let pc = 0; pc < 12; pc++) {
        const a = pcAngle(pc);
        const x = R * Math.cos(a),
            z = R * Math.sin(a);
        const railColor = pc % 2 === 0 ? COLORS.scene.railEven : COLORS.scene.railOdd;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 1, z),
            new THREE.Vector3(x, -(totalH + 1), z),
        ]);
        group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: railColor })));
        const lbl = makeLabel(NOTE_NAMES[pc], COLORS.label.rail, 1.0);
        lbl.position.set(x * 1.12, 1.6, z * 1.12);
        group.add(lbl);
    }
    // starting ring outline (the top rim, where the progression begins)
    const ringPts = [];
    for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(R * Math.cos(a), 1, R * Math.sin(a)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: COLORS.scene.baseRing })));

    // each chord layer (later chords sit lower — time runs down the cylinder)
    chords.forEach((ch, idx) => {
        const y = -idx * LAYER;
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
                if (showLabelsOnIntervalSegment) {
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
            const hex = noteHex(pc);
            if (hex) {
                vColor = new THREE.Color(hex);
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
        const cname = makeLabel(chordLabel(ch), chordNameFill(ch), 2.4);
        cname.position.set(nameDist * Math.cos(az), y, nameDist * Math.sin(az));
        nameGroup.add(cname);
    });

    // connections between consecutive chords (toggleable): every pair of notes
    // within a whole tone, styled by how far the note moves
    if (showConnections) {
        for (let i = 0; i < chords.length - 1; i++) {
            const y0 = -i * LAYER,
                y1 = -(i + 1) * LAYER;
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
// transliterate a progression string to ASCII the parser still accepts, for the
// "Force To-text to ASCII" option (Δ/△→maj, °→dim, ø/∅→m7b5, ♯→#, ♭→b, →→->)
function toAsciiProgression(s) {
    return s
        .replace(/[ø∅]7?/g, "m7b5") // ø already implies the 7th; drop a redundant "7"
        .replace(/[Δ△]/g, "Maj")
        .replace(/°/g, "dim")
        .replace(/𝄪/g, "x")
        .replace(/𝄫/g, "bb")
        .replace(/♯/g, "#")
        .replace(/♭/g, "b")
        .replace(/→/g, "->");
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
        t: [showConsonant, showDissonant, showLabelsOnIntervalSegment, showConnections, spin, circleOfFifths, accessibleColors].map((b) => (b ? 1 : 0)),
        ns: noteScheme,
        cs: chordScheme,
        cv2: tetradShorthand,
        k: [round(camTheta, 3), round(camPhi, 3), round(camRad, 2), round(camTarget.x, 2), round(camTarget.y, 2), round(camTarget.z, 2)],
        L: round(LAYER, 2),
        na: Math.round(nameAzDeg),
        nd: round(nameDist, 2),
        tr: tonicResidue,
        rm: relativeMode,
        at: analysisTonic,
        ap: tonicUserSet,
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
            [showConsonant, showDissonant, showLabelsOnIntervalSegment, showConnections, spin, circleOfFifths, accessibleColors] =
                st.t.map(Boolean);
            document.getElementById("tConsonant").checked = showConsonant;
            document.getElementById("tDissonant").checked = showDissonant;
            document.getElementById("tLabelsOnIntervalSegment").checked = showLabelsOnIntervalSegment;
            document.getElementById("tConnections").checked = showConnections;
            document.getElementById("tSpin").checked = spin;
            document.getElementById("tFifths").checked = circleOfFifths;
            document.getElementById("tAccessible").checked = accessibleColors;
            document.body.classList.toggle("accessible", accessibleColors);
        }
        if (typeof st.cs === "string") chordScheme = st.cs;
        const csRadio = document.querySelector(`input[name="chordScheme"][value="${chordScheme}"]`);
        if (csRadio) csRadio.checked = true;
        tetradShorthand = !!st.cv2;
        setTetradShorthand(tetradShorthand);
        document.getElementById("tTetrad").checked = tetradShorthand;
        if (typeof st.ns === "string") noteScheme = st.ns;
        const nsRadio = document.querySelector(`input[name="noteScheme"][value="${noteScheme}"]`);
        if (nsRadio) nsRadio.checked = true;
        if (st.L != null) LAYER = st.L;
        if (st.na != null) nameAzDeg = st.na;
        if (st.nd != null) nameDist = st.nd;
        if (st.tr != null) tonicResidue = st.tr;
        relativeMode = !!st.rm;
        tonicUserSet = !!st.ap;
        analysisTonic = st.at != null ? st.at : bestMajorTonic(chords.map((c) => c.pcs));
        document.getElementById("tRoman").checked = relativeMode;
        document.getElementById("key-picker").hidden = !relativeMode;
        refreshKeyUI();
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
      <div class="hd"><div class="nm"></div><button class="del"><img src="image/icons/close.svg" width="20" height="20" /></button></div>
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
            nm.innerHTML = `${chordLabel(ch) || "chord " + (idx + 1)} <small>${ch.pcs
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
    const options = chords.slice(0, nT).map((_, i) => `<option value="${i}"${i === analysisIdx ? " selected" : ""}>⟨${i + 1}⟩ ${chordLabel(chords[i])} → ⟨${i + 2}⟩ ${chordLabel(chords[i + 1])}</option>`)
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
        const arrow = `${noteChip(noteName(A, mv.from), mv.from)}→${noteChip(noteName(B, mv.to), mv.to)}`;
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
        maybeAutoTonic(); // follow the new progression (Roman mode or SoundQuest)
        renderChips();
        build();
        syncBaselines(); // text and chips are now in sync → clear both buttons
    } catch (e) {
        err.textContent = e.message;
    }
}

// Transpose the whole progression by `deltaFifths` line-of-fifths steps
// (±1 = a perfect fifth, ±7 = a chromatic semitone). It edits the chords in
// place — respelling, renaming, refreshing the chips/text/cylinder — and the
// new pitch classes ride along into the shareable URL via the chord encoding.
function transposeBy(deltaFifths) {
    if (!chords.length) return;
    const out = transposeProgression(chords.map((c) => c.symbol), deltaFifths);
    chords = out.map((s) => chordFromParsed(parseChord(s)));
    // a real transposition moves the analysis key by the same interval, so the
    // Roman numerals stay put — that's exactly what distinguishes it (Possibility
    // 2) from re-analyzing in a new key (Possibility 1).
    analysisTonic = (((analysisTonic + 7 * deltaFifths) % 12) + 12) % 12;
    tonicResidue = (((tonicResidue + 7 * deltaFifths) % 3) + 3) % 3; // ride the group along
    refreshKeyUI();
    progEl.value = chipsText();
    renderChips();
    build();
    syncBaselines(); // text and chips now agree → clear the Render/To-text prompts
}

// recompute the auto default tonic from the current chords
function refreshDefaultTonic() {
    analysisTonic = bestMajorTonic(chords.map((c) => c.pcs));
    syncTonicGroup(); // snap the axis-system tonic group to the detected key
    refreshKeyUI(); // …and keep the Roman-numerals tab's key readout in step
}
// snap the axis-system "tonic group" (pc % 3 residue) to the analysis key. The
// user may still nudge it with the ◀▶ buttons afterwards; choosing a key just
// re-seeds it.
function syncTonicGroup() {
    tonicResidue = ((analysisTonic % 3) + 3) % 3;
}
// the analysis tonic matters whenever we show Roman numerals OR color chords with
// the (relative) SoundQuest scheme — auto-detect it unless the user pinned a key
function maybeAutoTonic() {
    if (!tonicUserSet && (relativeMode || chordScheme === "soundquest")) refreshDefaultTonic();
}
// reflect the current analysis key in the key-name readout and the tonic grid
function refreshKeyUI() {
    const nameEl = document.getElementById("key-name");
    if (nameEl) nameEl.textContent = majorKeyName(analysisTonic);
    const auto = document.getElementById("autoKey");
    // highlight the auto button while the key is auto-detected (not user-pinned)
    if (auto) auto.classList.toggle("primary", !tonicUserSet);
    renderTonicGrid();
}
// the 4×6 key picker: clicking a note re-analyzes in that key (P1)
function renderTonicGrid() {
    const grid = document.getElementById("tonic-grid");
    if (!grid) return;
    grid.innerHTML = "";
    DOUBLED_TONNETZ.forEach(({ pc }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tcell" + (pc === analysisTonic ? " cur" : "");
        b.textContent = majorKeyName(pc);
        b.onclick = () => {
            analysisTonic = pc;
            tonicUserSet = true; // pin it; auto-default no longer overrides
            syncTonicGroup(); // re-seed the axis-system tonic group from the chosen key
            refreshKeyUI();
            renderChips(); // chip Roman labels depend on the key
            build();
            scheduleUrlUpdate();
        };
        grid.appendChild(b);
    });
}

// Wire a bottom-bar toggler to show/hide an overlay panel: click toggles it,
// hovering for 0.5 s reveals it, and the panel's own ".hide" button hides it.
function wirePanelToggle(panelId, togglerId) {
    const panel = document.getElementById(panelId);
    const toggler = document.getElementById(togglerId);
    if (!panel || !toggler) return;
    let hoverTimer = null;
    const cancelHover = () => {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    };
    const setShown = (on) => {
        cancelHover(); // an explicit show/hide wins over any queued hover-reveal
        panel.style.display = on ? "" : "none";
        layoutViewport(); // re-fit the 3-D render area around the panel
    };
    toggler.addEventListener("click", () => setShown(panel.style.display === "none"));
    toggler.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(() => setShown(true), 500);
    });
    toggler.addEventListener("mouseleave", cancelHover);
    const hideBtn = panel.querySelector(".hide");
    if (hideBtn) hideBtn.addEventListener("click", () => setShown(false));
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
        const text = chipsText();
        progEl.value = document.getElementById("tForceAscii").checked ? toAsciiProgression(text) : text;
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
    document.querySelectorAll("#transpose [data-tf]").forEach((b) => {
        b.onclick = () => transposeBy(Number(b.dataset.tf));
    });
    document.getElementById("tRoman").onchange = (e) => {
        relativeMode = e.target.checked;
        document.getElementById("key-picker").hidden = !relativeMode;
        maybeAutoTonic();
        refreshKeyUI();
        renderChips(); // chip headers switch between absolute names and Roman numerals
        build();
    };
    document.getElementById("autoKey").onclick = () => {
        tonicUserSet = false; // un-pin → follow the auto-detected key again
        refreshDefaultTonic();
        refreshKeyUI();
        renderChips(); // chip Roman labels depend on the key
        build();
        scheduleUrlUpdate();
    };
    renderTonicGrid(); // populate the key picker once (it stays hidden until Roman mode)
    document.getElementById("tTetrad").onchange = (e) => {
        tetradShorthand = e.target.checked;
        setTetradShorthand(tetradShorthand);
        doRender(); // re-parse the text box under the newly selected convention
    };
    // chord-coloring scheme radios: "hsjoihs" (axis system), "soundquest" (the
    // relative lookup table), or "none". SoundQuest needs an analysis tonic, so
    // selecting it auto-detects one (unless the user has pinned a key).
    document.querySelectorAll('input[name="chordScheme"]').forEach((r) => {
        r.onchange = (e) => {
            if (!e.target.checked) return;
            chordScheme = e.target.value;
            const before = analysisTonic;
            maybeAutoTonic();
            if (analysisTonic !== before) renderChips(); // Roman labels track the key
            build();
        };
    });
    document.querySelectorAll('input[name="noteScheme"]').forEach((r) => {
        r.onchange = (e) => {
            if (!e.target.checked) return;
            noteScheme = e.target.value;
            build();
        };
    });
    document.getElementById("tAccessible").onchange = (e) => {
        accessibleColors = e.target.checked;
        document.body.classList.toggle("accessible", accessibleColors);
        build();
    };
    document.getElementById("tLabelsOnIntervalSegment").onchange = (e) => {
        showLabelsOnIntervalSegment = e.target.checked;
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
    // A bottom-bar button toggles its overlay panel (on click), or reveals it on a
    // 0.5 s hover; the panel's own hide button hides it. layoutViewport() re-fits
    // the 3-D render area around the panel appearing/disappearing.
    wirePanelToggle("tonnetz-and-coloring", "toggle-box-of-tonnetz-and-coloring");
    wirePanelToggle("edit-view", "toggle-box-of-edit-view");
    wirePanelToggle("key-degree", "toggle-box-of-key-degree");
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
            tonicUserSet = false; // zapping through presets → drop any pinned key, re-detect
            doRender();
        };
        pr.appendChild(b);
    });

    const pr_rel = document.getElementById("presets-relative");
    PRESETS_WITH_RELATIVE_DEGREES.forEach((p) => {
        const b = document.createElement("button");
        b.className = "preset";
        b.textContent = p;
        b.onclick = () => {
            document.getElementById("prog").value = p;
            tonicUserSet = false; // zapping through presets → drop any pinned key, re-detect
            doRender();
        };
        pr_rel.appendChild(b);
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
