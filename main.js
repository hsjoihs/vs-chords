/* ====================== music theory ====================== */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NAME_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ROOT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// quality -> semitone offsets from root
const QUALITIES = [
    // order matters: try longer tokens first
    ["maj7#11", [0, 4, 7, 11, 18]], ["maj9", [0, 4, 7, 11, 14]], ["maj7", [0, 4, 7, 11]], ["maj", [0, 4, 7]],
    ["m7b5", [0, 3, 6, 10]], ["min7b5", [0, 3, 6, 10]], ["m7", [0, 3, 7, 10]], ["min7", [0, 3, 7, 10]],
    ["m9", [0, 3, 7, 10, 14]], ["m6", [0, 3, 7, 9]], ["min", [0, 3, 7]], ["mb5", [0, 3, 6]],
    ["dim7", [0, 3, 6, 9]], ["dim", [0, 3, 6]], ["aug7", [0, 4, 8, 10]], ["aug", [0, 4, 8]],
    ["7b9", [0, 4, 7, 10, 13]], ["7#9", [0, 4, 7, 10, 15]], ["7#11", [0, 4, 7, 10, 18]], ["7b5", [0, 4, 6, 10]],
    ["9", [0, 4, 7, 10, 14]], ["13", [0, 4, 7, 10, 21]], ["7", [0, 4, 7, 10]],
    ["6", [0, 4, 7, 9]], ["sus4", [0, 5, 7]], ["sus2", [0, 2, 7]], ["sus", [0, 5, 7]],
    ["add9", [0, 4, 7, 14]], ["5", [0, 7]],
    ["M7", [0, 4, 7, 11]], ["M", [0, 4, 7]],
    ["", [0, 4, 7]] // default major
];

function parseChord(sym) {
    let s = sym.trim();
    if (!s) return null;
    const m = s.match(/^([A-Ga-g])([#b♯♭]?)/);
    if (!m) throw new Error("Bad root: " + sym);
    let root = ROOT_PC[m[1].toUpperCase()];
    if (m[2] === "#" || m[2] === "♯") root += 1;
    if (m[2] === "b" || m[2] === "♭") root -= 1;
    root = ((root % 12) + 12) % 12;
    let rest = s.slice(m[0].length).replace(/\s/g, "");
    // handle leading 'm' (minor) carefully vs 'maj'
    let offsets = null;
    for (const [tok, offs] of QUALITIES) {
        if (tok === "") continue;
        if (rest === tok) { offsets = offs; break; }
    }
    if (offsets === null) {
        // try minor token 'm' / '-' prefix forms not covered
        if (rest === "m" || rest === "-" || rest === "min") offsets = [0, 3, 7];
        else if (rest === "" || rest === "maj" || rest === "M") offsets = [0, 4, 7];
        else throw new Error("Unknown chord: " + sym);
    }
    const pcs = offsets.map(o => ((root + o) % 12 + 12) % 12);
    // unique pitch classes, sorted by appearance
    const seen = new Set(); const uniq = [];
    for (const p of pcs) { if (!seen.has(p)) { seen.add(p); uniq.push(p); } }
    return { symbol: s, root, pcs: uniq };
}

function parseProgression(text) {
    const parts = text.split(/[\s,]*[→\-–>]+[\s,]*|\s+/).map(x => x.trim()).filter(Boolean);
    return parts.map(p => parseChord(p));
}

// circular semitone distance with direction (-6..+6), positive=upward(sharp)
function dirDistance(a, b) {
    let d = (b - a) % 12; if (d < 0) d += 12; if (d > 6) d -= 12; return d;
}
function absDistance(a, b) { const d = Math.abs(dirDistance(a, b)); return d; }

// match each voice of chord A to nearest note of chord B (greedy minimal movement)
function voiceLeading(A, B) {
    const moves = [];
    const usedB = new Array(B.length).fill(false);
    // sort A's notes by how "trapped" they are could be complex; greedy by smallest distance globally
    const pairs = [];
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++)
        pairs.push({ i, j, d: absDistance(A[i], B[j]) });
    pairs.sort((x, y) => x.d - y.d);
    const usedA = new Array(A.length).fill(false);
    for (const p of pairs) {
        if (usedA[p.i] || usedB[p.j]) continue;
        usedA[p.i] = true; usedB[p.j] = true;
        moves.push({ from: A[p.i], to: B[p.j], dist: dirDistance(A[p.i], B[p.j]) });
    }
    // any A note unmatched (A bigger): map to nearest B anyway
    for (let i = 0; i < A.length; i++) {
        if (usedA[i]) continue;
        let best = 0, bd = 99; for (let j = 0; j < B.length; j++) { const d = absDistance(A[i], B[j]); if (d < bd) { bd = d; best = j; } }
        moves.push({ from: A[i], to: B[best], dist: dirDistance(A[i], B[best]) });
    }
    // any B note unmatched (B bigger): something appears from nearest A
    for (let j = 0; j < B.length; j++) {
        if (usedB[j]) continue;
        let best = 0, bd = 99; for (let i = 0; i < A.length; i++) { const d = absDistance(A[i], B[j]); if (d < bd) { bd = d; best = i; } }
        moves.push({ from: A[best], to: B[j], dist: dirDistance(A[best], B[j]), appear: true });
    }
    return moves;
}

/* ====================== state ====================== */
let chords = []; // [{symbol, pcs:[...]}]

const PRESETS = [
    "G7 → C", "Dm7 → G7 → C", "Cmaj7 → A7 → Dm7 → G7",
    "C → Am → F → G", "Cm7b5 → F7 → Bbmaj7", "C → E7 → Am"
];

/* ====================== three.js scene ====================== */
let renderer, scene, camera, group;
const R = 5;            // cylinder radius
const LAYER = 4.2;      // vertical gap between chords
let spin = false, showAll = true;

function initThree() {
    const stage = document.getElementById('stage');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    stage.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);
    camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.1, 200);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(6, 10, 8); scene.add(dl);
    group = new THREE.Group(); scene.add(group);
    setupControls();
    animate();
    addEventListener('resize', () => {
        renderer.setSize(stage.clientWidth, stage.clientHeight);
        camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix();
    });
}

// ---- custom orbit controls (no external dep) ----
let camTheta = 0.7, camPhi = 1.15, camRad = 26, camTarget = new THREE.Vector3(0, 0, 0);
function applyCam() {
    const x = camRad * Math.sin(camPhi) * Math.sin(camTheta);
    const y = camRad * Math.cos(camPhi);
    const z = camRad * Math.sin(camPhi) * Math.cos(camTheta);
    camera.position.set(x + camTarget.x, y + camTarget.y, z + camTarget.z);
    camera.lookAt(camTarget);
}
function setupControls() {
    const el = renderer.domElement; let drag = null, px, py;
    el.addEventListener('mousedown', e => { drag = e.button; px = e.clientX; py = e.clientY; e.preventDefault(); });
    addEventListener('mouseup', () => drag = null);
    addEventListener('mousemove', e => {
        if (drag === null) return;
        const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
        if (drag === 0) { camTheta -= dx * 0.008; camPhi = Math.max(0.15, Math.min(Math.PI - 0.15, camPhi - dy * 0.008)); }
        else if (drag === 2) { // pan
            const panX = -dx * 0.02, panY = dy * 0.02;
            const right = new THREE.Vector3().subVectors(camera.position, camTarget).cross(camera.up).normalize();
            camTarget.addScaledVector(right, panX); camTarget.y += panY;
        }
        applyCam();
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { camRad = Math.max(8, Math.min(80, camRad + e.deltaY * 0.02)); applyCam(); e.preventDefault(); }, { passive: false });
}
function animate() {
    requestAnimationFrame(animate);
    if (spin) { camTheta += 0.0035; applyCam(); }
    renderer.render(scene, camera);
}

function clearGroup() { while (group.children.length) group.remove(group.children[0]); }

function pcAngle(pc) { return -pc / 12 * Math.PI * 2 + Math.PI / 2; } // C at +Z front, going clockwise
function pcPos(pc, y) { const a = pcAngle(pc); return new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a)); }

function makeLabel(text, color = "#e6edf3") {
    const c = document.createElement('canvas'); const s = 128; c.width = s; c.height = s;
    const g = c.getContext('2d'); g.font = "bold 64px -apple-system,Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = color; g.fillText(text, s / 2, s / 2 + 4);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.6, 1.6, 1); return sp;
}

function tube(p1, p2, color, radius) {
    const path = new THREE.LineCurve3(p1, p2);
    const geo = new THREE.TubeGeometry(path, 1, radius, 8, false);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

function intervalColor(semi) {
    if (semi === 6) return 0xff5d6c;       // tritone
    if (semi === 2 || semi === 10) return 0xffb454; // whole step (or its inversion)
    if (semi === 1 || semi === 11) return 0x5ad17a; // semitone
    return 0x7fc8ff;
}

function build() {
    clearGroup();
    if (chords.length === 0) return;
    const totalH = (chords.length - 1) * LAYER;
    camTarget.set(0, totalH / 2, 0);
    if (camRad < 8) camRad = 26; applyCam();

    // faint cylinder shell + 12 guide rails
    const shellGeo = new THREE.CylinderGeometry(R, R, Math.max(totalH + 2, 3), 48, 1, true);
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: 0x223049, transparent: true, opacity: 0.10, side: THREE.DoubleSide }));
    shell.position.y = totalH / 2; group.add(shell);
    for (let pc = 0; pc < 12; pc++) {
        const a = pcAngle(pc);
        const x = R * Math.cos(a), z = R * Math.sin(a);
        const railColor = (pc % 2 === 0) ? 0x2b3a52 : 0x1f2a3b;
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -1, z), new THREE.Vector3(x, totalH + 1, z)]);
        group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: railColor })));
        // base ring labels at bottom
        if (true) {
            const lbl = makeLabel(NOTE_NAMES[pc], "#5f6b7a"); lbl.scale.set(1.0, 1.0, 1);
            lbl.position.set(x * 1.12, -1.6, z * 1.12); group.add(lbl);
        }
    }
    // bottom ring outline
    const ringPts = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; ringPts.push(new THREE.Vector3(R * Math.cos(a), -1, R * Math.sin(a))); }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x2b3444 })));

    // each chord layer
    chords.forEach((ch, idx) => {
        const y = idx * LAYER;
        const pcs = ch.pcs;
        // chord plane ring (thin)
        const rp = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; rp.push(new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a))); }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rp), new THREE.LineBasicMaterial({ color: 0x1c2738 })));

        // interior intervals: complete graph among notes
        for (let i = 0; i < pcs.length; i++) for (let j = i + 1; j < pcs.length; j++) {
            const semi = absDistance(pcs[i], pcs[j]);
            const isTri = semi === 6;
            if (!showAll && !isTri && !(semi === 1 || semi === 2)) {/* still draw outline edges */ }
            const col = intervalColor(semi);
            const rad = isTri ? 0.075 : 0.038;
            group.add(tube(pcPos(pcs[i], y), pcPos(pcs[j], y), col, rad));
        }
        // vertices
        pcs.forEach(pc => {
            const p = pcPos(pc, y);
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16),
                new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x3a2c00, roughness: .4 }));
            dot.position.copy(p); group.add(dot);
            const lbl = makeLabel(NOTE_NAMES[pc], "#ffffff");
            lbl.position.copy(p).add(new THREE.Vector3(0, 0.55, 0)); group.add(lbl);
        });
        // chord name label, floating outward
        const cname = makeLabel(ch.symbol, "#4ea1ff");
        cname.scale.set(2.6, 2.6, 1);
        cname.position.set(0, y, -R - 2.4);
        group.add(cname);
    });

    // voice leading between consecutive chords (dashed-ish via thin segmented tubes)
    for (let i = 0; i < chords.length - 1; i++) {
        const y0 = i * LAYER, y1 = (i + 1) * LAYER;
        const moves = voiceLeading(chords[i].pcs, chords[i + 1].pcs);
        moves.forEach(mv => {
            const p0 = pcPos(mv.from, y0), p1 = pcPos(mv.to, y1);
            // segmented to look dashed
            const segs = 10;
            for (let s = 0; s < segs; s++) {
                if (s % 2 === 1) continue;
                const a = p0.clone().lerp(p1, s / segs), b = p0.clone().lerp(p1, (s + 1) / segs);
                group.add(tube(a, b, 0xc792ea, 0.03));
            }
        });
    }
    renderAnalysis();
}

/* ====================== UI ====================== */
function renderChips() {
    const wrap = document.getElementById('chips'); wrap.innerHTML = "";
    chords.forEach((ch, idx) => {
        const chip = document.createElement('div'); chip.className = "chip";
        const noteList = ch.pcs.map(p => NOTE_NAMES[p]).join(" ");
        chip.innerHTML = `<div class="hd"><div class="nm">${ch.symbol || "chord " + (idx + 1)} <small>${noteList}</small></div>
      <button class="del">✕</button></div><div class="ring"></div>`;
        const ring = chip.querySelector('.ring');
        for (let pc = 0; pc < 12; pc++) {
            const b = document.createElement('div'); b.className = "pc" + (ch.pcs.includes(pc) ? " on" : "");
            b.textContent = NOTE_NAMES[pc];
            b.onclick = () => {
                if (ch.pcs.includes(pc)) ch.pcs = ch.pcs.filter(x => x !== pc);
                else ch.pcs = [...ch.pcs, pc].sort((a, b) => a - b);
                ch.symbol = describe(ch.pcs); // re-name from the new pitch-class set
                renderChips(); build();
            };
            ring.appendChild(b);
        }
        chip.querySelector('.del').onclick = () => { chords.splice(idx, 1); renderChips(); build(); };
        wrap.appendChild(chip);
    });
}

// try to name a pc-set; fall back to note list
function describe(pcs) {
    if (pcs.length < 2) return pcs.map(p => NOTE_NAMES[p]).join("");
    for (let root of pcs) {
        const rel = pcs.map(p => ((p - root) % 12 + 12) % 12).sort((a, b) => a - b);
        const key = rel.join(",");
        const map = {
            "0,4,7": "", "0,3,7": "m", "0,3,6": "dim", "0,4,8": "aug",
            "0,4,7,10": "7", "0,4,7,11": "maj7", "0,3,7,10": "m7", "0,3,6,10": "m7b5",
            "0,3,6,9": "dim7", "0,4,7,9": "6", "0,3,7,9": "m6", "0,5,7": "sus4", "0,2,7": "sus2", "0,7": "5"
        };
        if (key in map) return NOTE_NAMES[root] + map[key];
    }
    return pcs.map(p => NOTE_NAMES[p]).join("·");
}

function renderAnalysis() {
    const el = document.getElementById('analysis');
    if (chords.length < 2) { el.innerHTML = "<h3>Analysis</h3><div style='color:var(--muted)'>Add a second chord to see voice leading.</div>"; return; }
    let html = "<h3>Voice leading</h3>";
    for (let i = 0; i < chords.length - 1; i++) {
        const A = chords[i], B = chords[i + 1];
        html += `<div style="margin:6px 0 4px;font-weight:600;color:var(--accent)">${A.symbol} → ${B.symbol}</div>`;
        const moves = voiceLeading(A.pcs, B.pcs);
        let total = 0;
        moves.forEach(mv => {
            const d = mv.dist; total += Math.abs(d);
            let tag = "hold", txt = "hold";
            if (Math.abs(d) === 1) { tag = "semi"; txt = (d > 0 ? "+" : "") + d + " st"; }
            else if (Math.abs(d) === 2) { tag = "whole"; txt = (d > 0 ? "+" : "") + d + " st"; }
            else if (d === 0) { tag = "hold"; txt = "—"; }
            else { tag = "leap"; txt = (d > 0 ? "+" : "") + d + " st"; }
            const arrow = `${NOTE_NAMES[mv.from]}→${NOTE_NAMES[mv.to]}`;
            html += `<div class="mv"><b>${arrow}</b><span class="tag ${tag}">${txt}</span></div>`;
        });
        html += `<div class="mv" style="margin-top:4px"><span style="color:var(--muted)">total motion</span><b>${total} st</b></div>`;
        // tritone note
        const triA = hasTritone(A.pcs), triB = hasTritone(B.pcs);
        if (triA && !triB) html += `<div class="hint">Tritone resolves: dissonance released.</div>`;
    }
    el.innerHTML = html;
}
function hasTritone(pcs) { for (let i = 0; i < pcs.length; i++)for (let j = i + 1; j < pcs.length; j++) if (absDistance(pcs[i], pcs[j]) === 6) return true; return false; }

function doRender() {
    const err = document.getElementById('err'); err.textContent = "";
    try {
        const parsed = parseProgression(document.getElementById('prog').value);
        if (parsed.length === 0) { err.textContent = "Enter at least one chord."; return; }
        chords = parsed.map(c => ({ symbol: c.symbol, pcs: c.pcs }));
        renderChips(); build();
    } catch (e) { err.textContent = e.message; }
}

function setupUI() {
    document.getElementById('render').onclick = doRender;
    document.getElementById('prog').addEventListener('keydown', e => { if (e.key === 'Enter') doRender(); });
    document.getElementById('add').onclick = () => { chords.push({ symbol: "C", pcs: [0, 4, 7] }); renderChips(); build(); };
    document.getElementById('tShowAll').onchange = e => { showAll = e.target.checked; build(); };
    document.getElementById('tSpin').onchange = e => { spin = e.target.checked; };
    const pr = document.getElementById('presets');
    PRESETS.forEach(p => {
        const b = document.createElement('button'); b.className = "preset"; b.textContent = p;
        b.onclick = () => { document.getElementById('prog').value = p; doRender(); }; pr.appendChild(b);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initThree(); setupUI(); doRender();
});
// expose for debugging/verification
window.__cc = { parseChord, parseProgression, voiceLeading, absDistance, get chords() { return chords; } };