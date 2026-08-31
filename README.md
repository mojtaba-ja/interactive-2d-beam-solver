# Interactive 2D Beam Solver

An interactive web tool for structural analysis courses. Build a beam by dragging
supports and loads, and read the **shear force**, **bending moment**, **slope**,
**deflection** and **axial force** diagrams update live, together with the support
reactions and the values at any section.

It runs entirely in the browser — no server, no build step, no dependencies.

```
open index.html          # double-click it, or
python -m http.server    # then browse to http://localhost:8000
```

---

## What it can analyse

**Supports** — pin, roller, fixed, guided (slider), horizontal roller, vertical
spring and rotational spring. Any support may also be given a **settlement** or an
**imposed rotation**, and any released direction may carry an elastic spring.

**Internal releases** — an internal hinge (M = 0) or a shear release (V = 0) at any
section, so Gerber/cantilever-suspended-span beams work.

**Loads** — concentrated force (vertical or inclined at any angle), concentrated
moment, uniform / triangular / trapezoidal line load, axial (horizontal) line load,
and distributed moment. Any number of them, overlapping or not.

Because the solver uses the direct stiffness method, both **statically determinate
and indeterminate** beams are handled the same way: simple spans, cantilevers,
overhangs, propped cantilevers, fixed-ended beams, and continuous beams with any
number of spans.

## What it gives back

| Output | Notes |
|---|---|
| Support reactions | Rx, Ry, M and the support displacement |
| Axial force N(x) | shown automatically when axial loads are present |
| Shear force V(x) | with the discontinuities at point loads drawn as true jumps |
| Bending moment M(x) | optionally plotted on the tension side |
| Slope θ(x) | |
| Deflection v(x) | plus the deflected shape drawn over the beam, and the L/δ ratio |
| Values at a section | V, M, N left and right of any cut, slope, deflection, load intensity |
| Checks | static determinacy, degree of indeterminacy, global equilibrium, stations where V = 0 |

Everything can be exported: **PNG** of the drawing, **CSV** of 501 sampled values of
every diagram, **JSON** of the model (and back in again), a **shareable link** that
carries the whole model in the URL, and a clean **printed report**.

---

## Sign conventions

**Input** (what you type)

| Quantity | Positive means |
|---|---|
| Point load `P`, line load `w` | downward |
| Point moment `M`, line moment `m` | clockwise |
| Load angle | tilts the load toward +x (90° is horizontal, to the right) |
| Settlement | downward |

Type a negative number for the opposite direction.

**Output** (what is drawn and tabulated)

| Quantity | Convention |
|---|---|
| `V(x)` | resultant of the **upward** forces to the left of the cut |
| `M(x)` | positive when it **sags** — tension on the bottom fibre |
| `N(x)` | positive in **tension** |
| `v(x)`, `θ(x)` | positive **upward** / counter-clockwise |
| Reactions `Ry`, `M` | positive **upward** / counter-clockwise |

The moment diagram can be flipped to the "drawn on the tension side" convention in
**Display options**.

## Method and assumptions

The beam is solved with the **direct stiffness method** (matrix displacement
method) using two-node, six-degree-of-freedom Euler–Bernoulli elements. A node is
placed at every support, release, concentrated load and line-load boundary, so each
element carries at most a linearly varying distributed load; the consistent
(work-equivalent) load vector is then exact and the computed **nodal displacements
are exact** for the governing differential equation.

* `N(x)`, `V(x)` and `M(x)` are obtained by **direct integration** of the applied
  loads together with the computed reactions — exact and independent of the mesh.
* `v(x)` and `θ(x)` come from the exact element solution
  `v = Hermite(v₁,θ₁,v₂,θ₂) + v_particular`, where `v_particular` solves
  `EI v'''' = q − dm/dx` with clamped ends. It is the exact deflected shape, not an
  interpolation of sampled points.
* Internal releases are handled by splitting the corresponding degree of freedom at
  the node, not by a penalty.
* Support settlements enter as prescribed displacements; springs are added to the
  stiffness matrix, and their reaction comes out of the same residual `K₀d − F₀` as
  every other reaction.

Assumptions: linear elastic material, small displacements, prismatic beam (constant
`EI` over the span), bending only — **shear deformation is neglected**, which is the
standard Euler–Bernoulli assumption taught in a first structural analysis course.

## Verification

`tests/solver.test.js` checks the engine against published closed-form solutions —
167 assertions over 28 cases:

```
node tests/solver.test.js
```

It covers simple spans, cantilevers, overhangs, propped cantilevers, fixed-ended
beams, two- and three-span continuous beams, triangular and trapezoidal loads, end
moments, distributed moments, internal hinges, support settlement, elastic and
rotational springs, guided supports, axial and inclined loads. Beyond the textbook
formulas it also verifies, for every case:

* **`EI·v''(x) = M(x)`** at interior stations — the deflected shape and the bending
  moment diagram are computed by independent routes and must agree;
* **global equilibrium** of the applied loads and the computed reactions;
* **superposition** — three loads applied together equal the sum of them applied
  separately at every station;
* **mesh independence** — adding redundant nodes must not change any answer.

## Keyboard and mouse

| | |
|---|---|
| Drag an object | move it along the beam |
| Drag a round handle | change a distributed load's extent `a` or `b` |
| Hold **Alt** while dragging | bypass the snap grid |
| **Double-click** the drawing | drop a point load there |
| Click a diagram | move the section marker |
| **← →** | nudge the selection (with **Shift**, five steps) |
| **Delete** | remove the selection |
| **Ctrl+Z / Ctrl+Y** | undo / redo |
| **Esc** | deselect |
| **?** | help |

## Files

```
index.html          page structure
css/styles.css      styling, light and dark themes, print layout
js/units.js         SI and US unit systems, number formatting
js/solver.js        the analysis engine (no DOM - also runs under Node)
js/render.js        SVG drawing of the beam scene and the diagrams
js/app.js           state, editing, interaction, results, import/export
tests/solver.test.js verification suite
```

The model is held in SI base units at all times (m, N, Pa, m², m⁴); switching between
the SI and US unit systems only changes what is displayed, never the structure.
