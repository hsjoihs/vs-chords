/* =====================================================================
 * theory-chordname-khufrudamonotes.test.js
 *
 * Conformance with the chord suffixes parsable by o-to.khufrudamonotes.com,
 * listed in khufrudamonotes.txt as:
 *     <option value="1/0/0/1/0/0/0/1/0/0/0/0">m</option>
 * The value is a 12-slot bitmask of pitch classes above the root (slot i = a
 * note i semitones above the root); the text is the chord suffix. So "C" + the
 * suffix must parse to exactly the pitch classes the bitmask marks.
 * ===================================================================== */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../theory-chordname.js");

// parse khufrudamonotes.txt → [{ suffix, expected:[pcs] }]
const text = fs.readFileSync(path.join(__dirname, "..", "khufrudamonotes.txt"), "utf8");
const RE = /<option value="([^"]+)">([^<]*)<\/option>/g;
const cases = [];
for (let m; (m = RE.exec(text)); ) {
    const bits = m[1].split("/");
    const expected = bits.map((b, i) => (b === "1" ? i : -1)).filter((i) => i >= 0);
    cases.push({ suffix: m[2], expected });
}

test("khufrudamonotes.txt has the expected number of suffixes", () => {
    assert.ok(cases.length >= 170, `only found ${cases.length} suffixes`);
});

const sortSet = (a) => [...new Set(a)].sort((x, y) => x - y);

test("every khufrudamonotes suffix parses to its bitmask pitch classes (root C)", () => {
    const failures = [];
    for (const { suffix, expected } of cases) {
        const sym = "C" + suffix;
        let got;
        try {
            got = sortSet(T.parseChord(sym).pcs.map((p) => ((p % 12) + 12) % 12));
        } catch (e) {
            failures.push(`${JSON.stringify(sym)} threw: ${e.message}`);
            continue;
        }
        const want = sortSet(expected);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
            failures.push(`${JSON.stringify(sym)} → [${got}], expected [${want}]`);
        }
    }
    assert.equal(failures.length, 0, "\n" + failures.join("\n"));
});
