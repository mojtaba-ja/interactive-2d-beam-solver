'use strict';
/* Verification suite for js/solver.js
   Every case is checked against a published closed-form solution.
   Run with:  node tests/solver.test.js                                   */

var S = require('../js/solver.js');

var passed = 0, failed = 0;
var currentCase = '';

function CASE(name) { currentCase = name; }

function near(actual, expected, tol, what) {
  var scale = Math.max(1, Math.abs(expected));
  var ok = Math.abs(actual - expected) <= (tol || 1e-6) * scale;
  if (ok) { passed++; }
  else {
    failed++;
    console.log('  FAIL  [' + currentCase + '] ' + what +
      '\n        expected ' + expected + '\n        got      ' + actual);
  }
  return ok;
}

function ok(cond, what) {
  if (cond) passed++;
  else { failed++; console.log('  FAIL  [' + currentCase + '] ' + what); }
}

function run(model) {
  var r = S.analyze(model);
  if (!r.ok) { failed++; console.log('  FAIL  [' + currentCase + '] solver error: ' + r.error); }
  return r;
}

/* Reaction of the support nearest to x */
function Rat(res, x) {
  var best = null, bd = Infinity;
  res.reactions.forEach(function (R) {
    var d = Math.abs(R.x - x);
    if (d < bd) { bd = d; best = R; }
  });
  return best;
}

/* Verify EI v'' == M(x) at a set of interior stations (independent check
   that the deflected shape and the bending moment diagram agree).       */
function checkCurvature(res, label) {
  var L = res.model.L, EI = res.model.E * res.model.I;
  var h = L / 5000, bad = 0, n = 0;
  var breaks = res.nodes.map(function (nd) { return nd.x; });
  for (var i = 1; i < 40; i++) {
    var x = L * i / 40;
    var tooClose = breaks.some(function (b) { return Math.abs(b - x) < 3 * h; });
    if (tooClose || x - 2 * h < 0 || x + 2 * h > L) continue;
    var v2 = (res.deflAt(x + h) - 2 * res.deflAt(x) + res.deflAt(x - h)) / (h * h);
    var M = res.momentAt(x, 0);
    var scale = Math.max(1e-9, Math.abs(M), Math.abs(res.extrema.M.absMax.y));
    n++;
    if (Math.abs(EI * v2 - M) > 1e-4 * scale) bad++;
  }
  ok(n > 0 && bad === 0, label + ': EI*v" equals M(x) at ' + n + ' stations (' + bad + ' mismatches)');
}

function checkEquilibrium(res, label) {
  ok(res.equilibrium.ok, label + ': global equilibrium satisfied');
}

/* ===================================================================== */
console.log('\n=== Beam solver verification ===\n');

var E = 200e9, I = 3e-4, A = 1e-2;   /* 200 GPa, 300e3 cm^4 */

/* --------------------------------------------------------------------- */
CASE('1. Simply supported + full UDL');
(function () {
  var L = 10, w = 12000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(Rat(res, 0).Ry, w * L / 2, 1e-9, 'R_A = wL/2');
  near(Rat(res, L).Ry, w * L / 2, 1e-9, 'R_B = wL/2');
  near(res.momentAt(L / 2, 0), w * L * L / 8, 1e-9, 'M_mid = wL^2/8');
  near(res.deflAt(L / 2), -5 * w * Math.pow(L, 4) / (384 * E * I), 1e-9, 'v_mid = -5wL^4/384EI');
  near(res.shearAt(0, 1), w * L / 2, 1e-9, 'V(0+) = wL/2');
  near(res.slopeAt(0), -w * L * L * L / (24 * E * I), 1e-9, 'theta_A = -wL^3/24EI');
  near(res.momentAt(0, 1), 0, 1e-9, 'M(0) = 0');
  ok(res.indeterminacy === 0, 'statically determinate');
  checkCurvature(res, 'case 1');
  checkEquilibrium(res, 'case 1');
})();

/* --------------------------------------------------------------------- */
CASE('2. Simply supported + central point load');
(function () {
  var L = 8, P = 50000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'point', x: L / 2, P: P }]
  });
  near(Rat(res, 0).Ry, P / 2, 1e-9, 'R_A = P/2');
  near(res.momentAt(L / 2, 0), P * L / 4, 1e-9, 'M_mid = PL/4');
  near(res.deflAt(L / 2), -P * Math.pow(L, 3) / (48 * E * I), 1e-9, 'v_mid = -PL^3/48EI');
  near(res.shearAt(L / 2, -1), P / 2, 1e-9, 'V just left of P = +P/2');
  near(res.shearAt(L / 2, 1), -P / 2, 1e-9, 'V just right of P = -P/2');
  checkEquilibrium(res, 'case 2');
})();

/* --------------------------------------------------------------------- */
CASE('3. Simply supported + off-centre point load');
(function () {
  var L = 9, P = 30000, a = 3, b = L - a;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'point', x: a, P: P }]
  });
  near(Rat(res, 0).Ry, P * b / L, 1e-9, 'R_A = Pb/L');
  near(Rat(res, L).Ry, P * a / L, 1e-9, 'R_B = Pa/L');
  near(res.momentAt(a, 0), P * a * b / L, 1e-9, 'M under load = Pab/L');
  /* deflection under the load:  -P a^2 b^2 / (3 L EI) */
  near(res.deflAt(a), -P * a * a * b * b / (3 * L * E * I), 1e-9, 'v under load');
  /* Maximum deflection lies in the LONGER segment.  With bb = the shorter
     distance from a support to the load, it is located a distance
     sqrt((L^2-bb^2)/3) from the support at the far end of the long segment. */
  var bb = Math.min(a, L - a);
  var far = Math.sqrt((L * L - bb * bb) / 3);
  var xm = (a >= L - a) ? far : L - far;
  near(res.deflAt(xm), -P * bb * Math.pow(L * L - bb * bb, 1.5) / (9 * Math.sqrt(3) * L * E * I), 1e-9, 'v_max = P b (L^2-b^2)^1.5 / (9 sqrt3 L EI)');
  near(res.extrema.D.absMax.y, res.deflAt(xm), 1e-5, 'sampled extremum matches the closed form');
  checkCurvature(res, 'case 3');
})();

/* --------------------------------------------------------------------- */
CASE('4. Cantilever (fixed left) + tip point load');
(function () {
  var L = 6, P = 20000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }],
    loads: [{ kind: 'point', x: L, P: P }]
  });
  near(Rat(res, 0).Ry, P, 1e-9, 'R = P (up)');
  near(Rat(res, 0).Mz, P * L, 1e-9, 'reaction moment = +PL (counter-clockwise)');
  near(res.momentAt(0, 1), -P * L, 1e-9, 'M(0) = -PL (hogging)');
  near(res.momentAt(L, -1), 0, 1e-9, 'M(L) = 0');
  near(res.deflAt(L), -P * Math.pow(L, 3) / (3 * E * I), 1e-9, 'v_tip = -PL^3/3EI');
  near(res.slopeAt(L), -P * L * L / (2 * E * I), 1e-9, 'theta_tip = -PL^2/2EI');
  checkCurvature(res, 'case 4');
  checkEquilibrium(res, 'case 4');
})();

/* --------------------------------------------------------------------- */
CASE('5. Cantilever + full UDL');
(function () {
  var L = 5, w = 9000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(res.momentAt(0, 1), -w * L * L / 2, 1e-9, 'M(0) = -wL^2/2');
  near(res.deflAt(L), -w * Math.pow(L, 4) / (8 * E * I), 1e-9, 'v_tip = -wL^4/8EI');
  near(res.slopeAt(L), -w * Math.pow(L, 3) / (6 * E * I), 1e-9, 'theta_tip = -wL^3/6EI');
  checkCurvature(res, 'case 5');
})();

/* --------------------------------------------------------------------- */
CASE('6. Cantilever + tip moment');
(function () {
  var L = 4, M0 = 15000;   /* clockwise */
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }],
    loads: [{ kind: 'moment', x: L, M: M0 }]
  });
  /* A CLOCKWISE couple at the free end rotates the tip clockwise, so the
     cantilever hogs and the tip moves DOWN: M(x) = -M0, v = -M0 x^2/2EI. */
  near(res.momentAt(L / 2, 0), -M0, 1e-9, 'M(x) = -M0 constant (hogging)');
  near(res.deflAt(L), -M0 * L * L / (2 * E * I), 1e-9, 'v_tip = -M0 L^2/2EI');
  near(res.slopeAt(L), -M0 * L / (E * I), 1e-9, 'theta_tip = -M0 L/EI (clockwise)');
  near(Rat(res, 0).Mz, M0, 1e-9, 'reaction moment = +M0 (counter-clockwise)');
  checkCurvature(res, 'case 6');
})();

/* --------------------------------------------------------------------- */
CASE('7. Propped cantilever (fixed + roller) + UDL');
(function () {
  var L = 10, w = 15000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(Rat(res, L).Ry, 3 * w * L / 8, 1e-9, 'R_prop = 3wL/8');
  near(Rat(res, 0).Ry, 5 * w * L / 8, 1e-9, 'R_fixed = 5wL/8');
  near(res.momentAt(0, 1), -w * L * L / 8, 1e-9, 'M_fixed = -wL^2/8');
  near(res.momentAt(5 * L / 8, 0), 9 * w * L * L / 128, 1e-9, 'M_max(+) = 9wL^2/128 at 5L/8');
  /* maximum deflection = wL^4/(185 EI) approx, exact 0.005416 wL^4/EI at x=0.5785L */
  near(Math.abs(res.extrema.D.absMax.y), 0.0054166667 * w * Math.pow(L, 4) / (E * I), 1e-4, 'v_max');
  ok(res.indeterminacy === 1, 'first degree indeterminate');
  checkCurvature(res, 'case 7');
  checkEquilibrium(res, 'case 7');
})();

/* --------------------------------------------------------------------- */
CASE('8. Fixed-fixed + UDL');
(function () {
  var L = 7, w = 20000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'fixed' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(res.momentAt(0, 1), -w * L * L / 12, 1e-9, 'M_end = -wL^2/12');
  near(res.momentAt(L / 2, 0), w * L * L / 24, 1e-9, 'M_mid = +wL^2/24');
  near(Rat(res, 0).Ry, w * L / 2, 1e-9, 'R = wL/2');
  near(res.deflAt(L / 2), -w * Math.pow(L, 4) / (384 * E * I), 1e-9, 'v_mid = -wL^4/384EI');
  ok(res.indeterminacy === 3, 'third degree indeterminate');
  checkCurvature(res, 'case 8');
})();

/* --------------------------------------------------------------------- */
CASE('9. Fixed-fixed + central point load');
(function () {
  var L = 6, P = 40000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'fixed' }],
    loads: [{ kind: 'point', x: L / 2, P: P }]
  });
  near(res.momentAt(0, 1), -P * L / 8, 1e-9, 'M_end = -PL/8');
  near(res.momentAt(L / 2, 0), P * L / 8, 1e-9, 'M_mid = +PL/8');
  near(res.deflAt(L / 2), -P * Math.pow(L, 3) / (192 * E * I), 1e-9, 'v_mid = -PL^3/192EI');
})();

/* --------------------------------------------------------------------- */
CASE('10. Two equal spans, continuous, UDL over both');
(function () {
  var Ls = 8, w = 10000, L = 2 * Ls;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: Ls, type: 'roller' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(res.momentAt(Ls, 0), -w * Ls * Ls / 8, 1e-9, 'M over centre support = -wL^2/8');
  near(Rat(res, 0).Ry, 3 * w * Ls / 8, 1e-9, 'R_end = 3wL/8');
  near(Rat(res, Ls).Ry, 10 * w * Ls / 8, 1e-9, 'R_centre = 10wL/8');
  near(res.momentAt(0.375 * Ls, 0), 9 * w * Ls * Ls / 128, 1e-9, 'M_span = 9wL^2/128 at 0.375L');
  near(res.deflAt(Ls), 0, 1e-9, 'no deflection over the centre support');
  ok(res.indeterminacy === 1, 'first degree indeterminate');
  checkCurvature(res, 'case 10');
  checkEquilibrium(res, 'case 10');
})();

/* --------------------------------------------------------------------- */
CASE('11. Three equal spans, continuous, UDL over all');
(function () {
  var Ls = 6, w = 12000, L = 3 * Ls;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: Ls, type: 'roller' },
               { x: 2 * Ls, type: 'roller' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(res.momentAt(Ls, 0), -0.1 * w * Ls * Ls, 1e-9, 'M at first interior support = -0.100 wL^2');
  near(Rat(res, 0).Ry, 0.4 * w * Ls, 1e-9, 'R_end = 0.400 wL');
  near(Rat(res, Ls).Ry, 1.1 * w * Ls, 1e-9, 'R_interior = 1.100 wL');
  near(res.momentAt(0.4 * Ls, 0), 0.08 * w * Ls * Ls, 1e-9, 'M_span1 = 0.080 wL^2');
  ok(res.indeterminacy === 2, 'second degree indeterminate');
  checkEquilibrium(res, 'case 11');
})();

/* --------------------------------------------------------------------- */
CASE('12. Simply supported + triangular load (0 -> w)');
(function () {
  var L = 9, w = 18000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: 0, w2: w }]
  });
  near(Rat(res, 0).Ry, w * L / 6, 1e-9, 'R_A = wL/6');
  near(Rat(res, L).Ry, w * L / 3, 1e-9, 'R_B = wL/3');
  var xm = L / Math.sqrt(3);
  near(res.momentAt(xm, 0), w * L * L / (9 * Math.sqrt(3)), 1e-9, 'M_max = wL^2/(9 sqrt3)');
  /* v_max = 0.00652 wL^4/EI at x = 0.5193 L */
  near(Math.abs(res.extrema.D.absMax.y), 0.006522 * w * Math.pow(L, 4) / (E * I), 1e-3, 'v_max');
  checkCurvature(res, 'case 12');
  checkEquilibrium(res, 'case 12');
})();

/* --------------------------------------------------------------------- */
CASE('13. Simply supported + trapezoidal partial load');
(function () {
  var L = 12, a = 3, b = 9, w1 = 5000, w2 = 15000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: a, b: b, w1: w1, w2: w2 }]
  });
  var W = 0.5 * (w1 + w2) * (b - a);
  var xc = a + (b - a) * (w1 + 2 * w2) / (3 * (w1 + w2));
  near(Rat(res, 0).Ry + Rat(res, L).Ry, W, 1e-9, 'sum R = total load');
  near(Rat(res, L).Ry, W * xc / L, 1e-9, 'R_B from moment equilibrium');
  near(res.momentAt(a, 0), Rat(res, 0).Ry * a, 1e-9, 'M(a) = R_A a');
  checkCurvature(res, 'case 13');
  checkEquilibrium(res, 'case 13');
})();

/* --------------------------------------------------------------------- */
CASE('14. Overhanging beam');
(function () {
  var L = 12, a = 9, P = 25000;      /* supports at 0 and a, load at the tip */
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: a, type: 'roller' }],
    loads: [{ kind: 'point', x: L, P: P }]
  });
  var c = L - a;
  near(Rat(res, 0).Ry, -P * c / a, 1e-9, 'R_A = -Pc/a (uplift)');
  near(Rat(res, a).Ry, P * (a + c) / a, 1e-9, 'R_B = P(a+c)/a');
  near(res.momentAt(a, 0), -P * c, 1e-9, 'M over B = -Pc');
  near(res.deflAt(L), -P * c * c * (a + c) / (3 * E * I), 1e-9, 'v_tip = -Pc^2(a+c)/3EI (downward)');
  checkEquilibrium(res, 'case 14');
})();

/* --------------------------------------------------------------------- */
CASE('15. Simply supported + end moment');
(function () {
  var L = 10, M0 = 40000;        /* clockwise, applied at x = 0 */
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'moment', x: 0, M: M0 }]
  });
  near(Rat(res, 0).Ry, -M0 / L, 1e-9, 'R_A = -M0/L');
  near(Rat(res, L).Ry, M0 / L, 1e-9, 'R_B = +M0/L');
  near(res.momentAt(0, 1), M0, 1e-9, 'M(0+) = M0');
  near(res.momentAt(L / 2, 0), M0 / 2, 1e-9, 'M(L/2) = M0/2');
  near(res.momentAt(L, -1), 0, 1e-9, 'M(L) = 0');
  checkCurvature(res, 'case 15');
  checkEquilibrium(res, 'case 15');
})();

/* --------------------------------------------------------------------- */
CASE('16. Uniform distributed moment on a simple span');
(function () {
  var L = 10, mm = 5000;   /* N.m per m, clockwise */
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'dmoment', a: 0, b: L, m1: mm, m2: mm }]
  });
  /* Statics: V = -m everywhere and M(x) = 0 everywhere. */
  near(res.shearAt(L / 2, 0), -mm, 1e-9, 'V = -m constant');
  near(res.momentAt(L / 3, 0), 0, 1e-9, 'M = 0 everywhere');
  near(res.momentAt(0.77 * L, 0), 0, 1e-9, 'M = 0 everywhere');
  near(Rat(res, 0).Ry, -mm, 1e-9, 'R_A = -m');
  near(Rat(res, L).Ry, mm, 1e-9, 'R_B = +m');
  ok(Math.abs(res.extrema.D.absMax.y) < 1e-12, 'no deflection (zero curvature)');
  checkEquilibrium(res, 'case 16');
})();

/* --------------------------------------------------------------------- */
CASE('17. Distributed moment equals a point moment in the limit');
(function () {
  var L = 10, Mtot = 30000, eps = 0.002;
  var ref = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'moment', x: 4, M: Mtot }]
  });
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'dmoment', a: 4 - eps / 2, b: 4 + eps / 2, m1: Mtot / eps, m2: Mtot / eps }]
  });
  near(res.momentAt(2, 0), ref.momentAt(2, 0), 1e-3, 'M(2) matches the point-moment model');
  near(res.momentAt(7, 0), ref.momentAt(7, 0), 1e-3, 'M(7) matches the point-moment model');
  near(res.deflAt(6), ref.deflAt(6), 1e-3, 'v(6) matches the point-moment model');
})();

/* --------------------------------------------------------------------- */
CASE('18. Internal hinge - Gerber beam');
(function () {
  /* Fixed at 0, hinge at 6, roller at 10.  Point load at 8. */
  var L = 10, P = 20000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'roller' }],
    releases: [{ x: 6, type: 'moment' }],
    loads: [{ kind: 'point', x: 8, P: P }]
  });
  near(res.momentAt(6, 0), 0, 1e-9, 'M = 0 at the hinge');
  /* The 6->10 part is a simply supported sub-beam on the hinge and the roller */
  near(Rat(res, L).Ry, P * 2 / 4, 1e-9, 'R_roller = P/2 (statics of the released span)');
  near(Rat(res, 0).Ry, P / 2, 1e-9, 'R_fixed = P/2');
  near(Rat(res, 0).Mz, (P / 2) * 6, 1e-9, 'reaction moment = +(P/2)*6 (ccw)');
  near(res.momentAt(0, 1), -(P / 2) * 6, 1e-9, 'M(0) = -(P/2)*6 (hogging)');
  ok(res.indeterminacy === 0, 'determinate once the hinge is counted');
  checkEquilibrium(res, 'case 18');
})();

/* --------------------------------------------------------------------- */
CASE('19. Support settlement');
(function () {
  var L = 8, delta = 0.02;   /* 20 mm settlement of the prop */
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'roller', dy: delta }]
  });
  near(Rat(res, L).Ry, -3 * E * I * delta / Math.pow(L, 3), 1e-9, 'R_prop = -3EI*delta/L^3');
  near(res.deflAt(L), -delta, 1e-9, 'v(L) = -delta');
  near(res.momentAt(0, 1), -3 * E * I * delta / (L * L), 1e-9, 'M_fixed = -3EI*delta/L^2 (hogging)');
  checkCurvature(res, 'case 19');
})();

/* --------------------------------------------------------------------- */
CASE('20. Elastic (spring) support');
(function () {
  var L = 6, P = 10000, k = 2e6;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'spring', ky: k }],
    loads: [{ kind: 'point', x: L, P: P }]
  });
  /* series springs: beam tip flexibility L^3/3EI, support flexibility 1/k */
  var fb = Math.pow(L, 3) / (3 * E * I), fs = 1 / k;
  var Rs = P * fb / (fb + fs);
  near(Rat(res, L).Ry, Rs, 1e-9, 'spring reaction from the flexibility balance');
  near(res.deflAt(L), -Rs / k, 1e-9, 'tip deflection = -R/k');
  /* A very stiff spring must reproduce the propped cantilever.  The load
     has to sit away from the prop, otherwise the prop simply takes it all. */
  var res2 = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'spring', ky: 1e14 }],
    loads: [{ kind: 'point', x: L / 2, P: P }]
  });
  near(res2.momentAt(0, 1), -3 * P * L / 16, 1e-6, 'stiff spring -> propped cantilever M_fixed = -3PL/16');
  near(res2.reactions[1].Ry, 5 * P / 16, 1e-6, 'stiff spring -> R_prop = 5P/16');
})();

/* --------------------------------------------------------------------- */
CASE('21. Guided support');
(function () {
  /* Fixed at 0, guided (slider) at L with a UDL: a propped case with
     zero rotation and free vertical movement at the right end.        */
  var L = 6, w = 10000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'fixed' }, { x: L, type: 'guided' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  near(Rat(res, 0).Ry, w * L, 1e-9, 'the fixed end carries the whole load');
  near(res.shearAt(L, -1), 0, 1e-9, 'V(L) = 0 at the slider');
  near(res.momentAt(0, 1), -w * L * L / 3, 1e-9, 'M_fixed = -wL^2/3');
  near(res.momentAt(L, -1), w * L * L / 6, 1e-9, 'M at the slider = +wL^2/6');
  near(res.slopeAt(L), 0, 1e-9, 'zero rotation at the slider');
  checkCurvature(res, 'case 21');
})();

/* --------------------------------------------------------------------- */
CASE('22. Rotational spring support');
(function () {
  var L = 8, w = 12000, kr = 4 * E * I / L;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin', kr: kr }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  /* Slope-deflection: M_A = -kr*theta_A, theta_A = -(wL^3/24EI) + M_A L/(3EI) */
  var t = -(w * L * L * L / (24 * E * I)) / (1 + kr * L / (3 * E * I));
  near(res.slopeAt(0), t, 1e-8, 'rotation at the elastic restraint');
  near(res.momentAt(0, 1), -kr * (-t), 1e-8, 'M(0) balances the spring moment');
  checkCurvature(res, 'case 22');
})();

/* --------------------------------------------------------------------- */
CASE('23. Axial force diagram');
(function () {
  var L = 10, H = 30000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'point', x: 6, P: H, angle: 90 }]   /* purely horizontal, to the right */
  });
  near(Rat(res, 0).Rx, -H, 1e-9, 'the pin takes the whole horizontal force');
  near(res.axialAt(3, 0), 0 + H, 1e-9, 'N = +H (tension) left of the load');
  near(res.axialAt(8, 0), 0, 1e-9, 'N = 0 right of the load');
})();

/* --------------------------------------------------------------------- */
CASE('24. Inclined point load');
(function () {
  var L = 10, P = 20000, ang = 30;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'point', x: 4, P: P, angle: ang }]
  });
  var Pv = P * Math.cos(ang * Math.PI / 180);
  near(Rat(res, 0).Ry, Pv * 6 / L, 1e-9, 'vertical reaction uses the vertical component');
  near(res.momentAt(4, 0), Pv * 4 * 6 / L, 1e-9, 'M under the load');
  checkEquilibrium(res, 'case 24');
})();

/* --------------------------------------------------------------------- */
CASE('25. Superposition of several load types');
(function () {
  var L = 12, E1 = 210e9, I1 = 8e-5;
  var base = {
    L: L, E: E1, I: I1, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: 7, type: 'roller' }, { x: L, type: 'roller' }]
  };
  function mk(loads) { var o = JSON.parse(JSON.stringify(base)); o.loads = loads; return run(o); }
  var l1 = { kind: 'point', x: 3, P: 24000 };
  var l2 = { kind: 'udl', a: 5, b: 11, w1: 4000, w2: 9000 };
  var l3 = { kind: 'moment', x: 9, M: 18000 };
  var a1 = mk([l1]), a2 = mk([l2]), a3 = mk([l3]), all = mk([l1, l2, l3]);
  for (var i = 1; i < 12; i++) {
    var x = L * i / 12;
    near(all.momentAt(x, 0), a1.momentAt(x, 0) + a2.momentAt(x, 0) + a3.momentAt(x, 0), 1e-8, 'M superposes at x=' + x.toFixed(1));
    near(all.deflAt(x), a1.deflAt(x) + a2.deflAt(x) + a3.deflAt(x), 1e-8, 'v superposes at x=' + x.toFixed(1));
  }
  checkCurvature(all, 'case 25');
  checkEquilibrium(all, 'case 25');
})();

/* --------------------------------------------------------------------- */
CASE('26. Mesh independence / node placement');
(function () {
  var L = 10, w = 8000;
  var plain = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w }]
  });
  /* adding a zero point load forces extra nodes; the answer must not change */
  var meshed = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: L, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: L, w1: w, w2: w },
            { kind: 'point', x: 1.3, P: 0 }, { kind: 'point', x: 7.77, P: 0 }]
  });
  near(meshed.deflAt(L / 2), plain.deflAt(L / 2), 1e-12, 'deflection unchanged by extra nodes');
  near(meshed.momentAt(3.1, 0), plain.momentAt(3.1, 0), 1e-12, 'moment unchanged by extra nodes');
})();

/* --------------------------------------------------------------------- */
CASE('27. Unstable configurations are reported');
(function () {
  var r1 = S.analyze({
    L: 10, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'roller' }],
    loads: [{ kind: 'udl', a: 0, b: 10, w1: 1000, w2: 1000 }]
  });
  ok(!r1.ok, 'single roller is detected as a mechanism');
  var r2 = S.analyze({
    L: 10, E: E, I: I, A: A, supports: [],
    loads: [{ kind: 'point', x: 5, P: 1000 }]
  });
  ok(!r2.ok, 'no supports is reported');
  var r3 = S.analyze({
    L: 10, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: 10, type: 'roller' }],
    releases: [{ x: 5, type: 'moment' }, { x: 6, type: 'moment' }],
    loads: [{ kind: 'point', x: 5.5, P: 1000 }]
  });
  ok(!r3.ok, 'two hinges in one span is detected as a mechanism');
})();

/* --------------------------------------------------------------------- */
CASE('28. Cantilever with an overhang UDL and a hinge (mixed)');
(function () {
  var L = 14, w = 6000, P = 12000;
  var res = run({
    L: L, E: E, I: I, A: A,
    supports: [{ x: 0, type: 'pin' }, { x: 6, type: 'roller' }, { x: 11, type: 'roller' }],
    releases: [{ x: 8.5, type: 'moment' }],
    loads: [{ kind: 'udl', a: 0, b: 6, w1: w, w2: w },
            { kind: 'point', x: L, P: P },
            { kind: 'moment', x: 3, M: 9000 }]
  });
  near(res.momentAt(8.5, 0), 0, 1e-8, 'M = 0 at the hinge');
  checkCurvature(res, 'case 28');
  checkEquilibrium(res, 'case 28');
  ok(res.indeterminacy === 0, 'determinate (3 restraints + 1 vertical - 1 release)' );
})();

/* ===================================================================== */
console.log('\n' + (failed === 0 ? 'ALL TESTS PASSED' : failed + ' CHECK(S) FAILED') +
  '  (' + passed + ' passed, ' + failed + ' failed)\n');
process.exit(failed === 0 ? 0 : 1);
