<h1 align="center">Interactive 2D Beam Solver</h1>

<p align="center">
  Shear force, bending moment, slope and deflection diagrams for beams —
  built by dragging supports and loads, solved live in the browser.
</p>

<p align="center">
  <a href="https://mojtaba-ja.github.io/interactive-2d-beam-solver/"><b>▶ Live demo</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/mojtaba-ja/interactive-2d-beam-solver/raw/main/dist/Interactive-2D-Beam-Solver.html"><b>⬇ Download single file</b></a>
</p>

<p align="center">
  <a href="https://github.com/mojtaba-ja/interactive-2d-beam-solver/actions/workflows/ci.yml"><img alt="tests" src="https://github.com/mojtaba-ja/interactive-2d-beam-solver/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-none-2a78d6">
  <img alt="backend" src="https://img.shields.io/badge/backend-none-2a78d6">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-83837c">
</p>

<p align="center">
  <img src="docs/screenshot.jpg" alt="A propped cantilever under a uniform load, with the shear force diagram below it" width="900">
</p>

---

Point a browser at a single HTML file and you get a full beam analysis workbench.
No install, no build step, no server, no dependencies — it also runs offline.

It is meant for a structural analysis course: everything it reports is something a
student is expected to be able to check by hand, and every diagram is exact rather
than a smoothed curve through sampled points.

## Features

- **Direct manipulation** — drag supports and loads along the beam, drag the round
  handles to set a distributed load's extent, double-click to drop a point load.
  Buttons add any support or load type to the structure.
- **A shared crosshair** across every diagram: hover anywhere and read `N`, `V`,
  `M`, `θ` and `v` at that station at once.
- **Determinate and indeterminate beams alike** — simple spans, cantilevers,
  overhangs, propped cantilevers, fixed-ended beams and continuous beams with any
  number of spans, all through the same solver.
- **Supports** — pin, roller, fixed, guided (slider), horizontal roller, vertical
  spring and rotational spring; any of them can be given a support settlement or an
  imposed rotation.
- **Internal releases** — an internal hinge (`M = 0`) or a shear release (`V = 0`)
  at any section, so Gerber beams work.
- **Loads** — concentrated force at any inclination, concentrated moment, uniform /
  triangular / trapezoidal line load, axial line load and distributed moment, in any
  combination.
- **Outputs** — reaction table, axial force, shear, bending moment, slope and
  deflection diagrams, the deflected shape drawn over the beam, max/min with their
  locations, the `L/δ` ratio, stations where `V = 0`, the degree of static
  indeterminacy and a global equilibrium check.
- **SI and US units**, switched at any time — the structure never changes, only what
  is displayed.
- 14 worked examples, undo/redo, snap-grid dragging, the tension-side moment
  convention, light and dark themes.
- **Export** — PNG of the drawing, CSV of every diagram, JSON of the model (and back
  in again), a link that carries the whole model in the URL, and a printable report.

## Getting started

Download [`dist/Interactive-2D-Beam-Solver.html`](dist/Interactive-2D-Beam-Solver.html)
and open it. That's the whole program — one file, 148 KB, works offline.

To run it from source instead:

```bash
git clone https://github.com/mojtaba-ja/interactive-2d-beam-solver.git
cd interactive-2d-beam-solver
open index.html          # or: python -m http.server
```

To rebuild the single-file bundle after editing the source:

```bash
node build.js
```

## Usage

| | |
|---|---|
| Drag an object | move it along the beam |
| Drag a round handle | change a distributed load's extent `a` or `b` |
| Hold <kbd>Alt</kbd> while dragging | bypass the snap grid |
| Double-click the drawing | drop a point load there |
| Click a diagram | move the section marker |
| <kbd>←</kbd> <kbd>→</kbd> | nudge the selection (with <kbd>Shift</kbd>, five steps) |
| <kbd>Delete</kbd> | remove the selection |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | undo / redo |
| <kbd>Esc</kbd> | deselect |
| <kbd>?</kbd> | help and sign conventions |

## Sign conventions

**Input** — a point load or line load is positive **downward**, a moment is positive
**clockwise**, a settlement is positive **downward**, and a load angle tilts the load
toward `+x` (90° is horizontal, to the right). Type a negative number for the
opposite direction.

**Output** — `V(x)` is the resultant of the **upward** forces to the left of the cut;
`M(x)` is positive when it **sags** (tension on the bottom fibre); `N(x)` is positive
in **tension**; `v(x)`, `θ(x)` and the reactions `Ry`, `M` are positive **upward** /
counter-clockwise. The moment diagram can be flipped to the "drawn on the tension
side" convention.

## Method

The beam is solved with the **direct stiffness method** using two-node,
six-degree-of-freedom Euler–Bernoulli elements. A node is placed at every support,
release, concentrated load and line-load boundary, so each element carries at most a
linearly varying distributed load; the consistent load vector is then exact and the
computed **nodal displacements are exact** for the governing differential equation.

- `N(x)`, `V(x)` and `M(x)` are obtained by **direct integration** of the applied
  loads together with the computed reactions — exact and independent of the mesh.
- `v(x)` and `θ(x)` come from the exact element solution
  `v = Hermite(v₁,θ₁,v₂,θ₂) + v_particular`, where `v_particular` solves
  `EI·v'''' = q − dm/dx` with clamped ends. It is the exact deflected shape, not an
  interpolation between sampled points.
- Internal releases split the corresponding degree of freedom at the node rather than
  using a penalty stiffness.
- Settlements enter as prescribed displacements; spring reactions fall out of the
  same residual `K₀d − F₀` as every other reaction.

**Assumptions**: linear elastic material, small displacements, prismatic beam
(constant `EI` over the span), bending only — shear deformation is neglected, which
is the standard Euler–Bernoulli assumption.

## Validation

```bash
node tests/solver.test.js      # or: npm test
```

**167 assertions over 28 cases**, checked against published closed-form solutions:
simple spans, cantilevers, overhangs, propped cantilevers, fixed-ended beams, two-
and three-span continuous beams, triangular and trapezoidal loads, end moments,
distributed moments, internal hinges, support settlement, elastic and rotational
springs, guided supports, and axial and inclined loads.

Beyond matching the textbook formulas, every case also verifies:

- **`EI·v''(x) = M(x)`** at interior stations — the deflected shape and the bending
  moment diagram are computed by completely independent routes and must agree;
- **global equilibrium** of the applied loads against the computed reactions;
- **superposition** — three loads applied together equal the sum of them applied
  separately, at every station;
- **mesh independence** — adding redundant nodes must not change any answer.

## Project structure

```
index.html            page structure
css/styles.css        styling, light and dark themes, print layout
js/units.js           SI and US unit systems, number formatting
js/solver.js          the analysis engine — no DOM, also runs under Node
js/render.js          SVG drawing of the beam scene and the diagrams
js/app.js             state, editing, interaction, results, import/export
tests/solver.test.js  validation suite
build.js              bundles everything into dist/ as a single file
```

The model is held in SI base units throughout (m, N, Pa, m², m⁴); switching between
the SI and US unit systems changes only what is displayed, never the structure.

## License

[MIT](LICENSE) © Mojtaba Jafarian Abyaneh
