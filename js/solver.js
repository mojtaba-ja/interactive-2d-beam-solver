'use strict';
/* =====================================================================
   solver.js  -  Planar (2D) Euler-Bernoulli beam analysis engine
   ---------------------------------------------------------------------
   Method : direct stiffness method (matrix displacement method).
            Works for statically determinate AND indeterminate beams:
            cantilevers, simple spans, overhangs, propped cantilevers,
            fixed-fixed, continuous beams with any number of spans,
            elastic (spring) supports, support settlements and internal
            releases (hinges).

   Element: 2-node, 6-dof plane beam element (axial + Euler-Bernoulli
            bending).  Nodes are placed at every discontinuity, so every
            element carries at most a linearly varying distributed load
            -> the consistent (work-equivalent) load vector is exact and
            the computed nodal displacements are EXACT for the governing
            differential equation.

   Diagrams: N(x), V(x), M(x) are obtained by direct integration of the
            applied loads together with the computed reactions (exact and
            mesh independent).  Slope and deflection come from the exact
            element solution
               v(x) = Hermite(v1,t1,v2,t2) + v_particular(x)
            where v_particular is the clamped-clamped solution of
               EI v'''' = q(x) - dm/dx.

   SIGN CONVENTIONS
   ----------------
   Input (what the user types, "engineering" convention):
       point force  P  : positive DOWNWARD           [N]
       inclination ang : degrees, tilts the load toward +x
       moment       M  : positive CLOCKWISE          [N.m]
       line load    w  : positive DOWNWARD           [N/m]   (dir 'y')
                         positive to the RIGHT       [N/m]   (dir 'x')
       line moment  m  : positive CLOCKWISE          [N.m/m]
       settlement   dy : positive DOWNWARD           [m]

   Internal / output (math convention: x right, y up, z out of screen):
       Fy, Fx  : positive up / right
       Mz      : positive counter-clockwise
       v, theta: deflection positive UP, rotation positive CCW
       V(x)    : sum of the upward forces acting left of the cut
       M(x)    : SAGGING positive (tension on the bottom fibre)
       N(x)    : TENSION positive

   Everything inside the solver is in strict SI base units:
       m, N, Pa, m^2, m^4, N.m, rad
   ===================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BeamSolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------------------------------------------------------------- */
  /*  helpers                                                          */
  /* ---------------------------------------------------------------- */
  var EPS = 1e-9;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** Gauss elimination with partial pivoting.
   *  Returns {ok:true, x:[...]} or {ok:false, badCol:i} where badCol is
   *  the index of the dof that has no pivot (i.e. a mechanism). */
  function gaussSolve(K, F) {
    var n = F.length, i, j, r, c;
    if (n === 0) return { ok: true, x: [] };
    var M = new Array(n), scale = 0;
    for (i = 0; i < n; i++) {
      M[i] = K[i].slice();
      M[i].push(F[i]);
      for (j = 0; j < n; j++) scale = Math.max(scale, Math.abs(K[i][j]));
    }
    if (scale === 0) return { ok: false, badCol: 0 };
    for (c = 0; c < n; c++) {
      var piv = c, best = Math.abs(M[c][c]);
      for (r = c + 1; r < n; r++) {
        var vv = Math.abs(M[r][c]);
        if (vv > best) { best = vv; piv = r; }
      }
      if (best < scale * 1e-11) return { ok: false, badCol: c };
      if (piv !== c) { var t = M[piv]; M[piv] = M[c]; M[c] = t; }
      var dd = M[c][c];
      for (r = c + 1; r < n; r++) {
        var f = M[r][c] / dd;
        if (f === 0) continue;
        for (j = c; j <= n; j++) M[r][j] -= f * M[c][j];
      }
    }
    var x = new Array(n);
    for (i = 0; i < n; i++) x[i] = 0;
    for (r = n - 1; r >= 0; r--) {
      var s = M[r][n];
      for (j = r + 1; j < n; j++) s -= M[r][j] * x[j];
      x[r] = s / M[r][r];
    }
    return { ok: true, x: x };
  }

  /* ---------------------------------------------------------------- */
  /*  support catalogue                                                */
  /*  fixU / fixV / fixR : the rigid restraints the support provides   */
  /* ---------------------------------------------------------------- */
  var SUPPORTS = {
    pin:     { label: 'Pin',               fixU: true,  fixV: true,  fixR: false },
    roller:  { label: 'Roller',            fixU: false, fixV: true,  fixR: false },
    fixed:   { label: 'Fixed',             fixU: true,  fixV: true,  fixR: true  },
    guided:  { label: 'Guided (slider)',   fixU: true,  fixV: false, fixR: true  },
    hroller: { label: 'Horizontal roller', fixU: true,  fixV: false, fixR: false },
    spring:  { label: 'Vertical spring',   fixU: false, fixV: false, fixR: false },
    rspring: { label: 'Rotational spring', fixU: false, fixV: false, fixR: false }
  };

  /* ---------------------------------------------------------------- */
  /*  model normalisation                                              */
  /* ---------------------------------------------------------------- */
  function normalize(model) {
    var L = Math.max(+model.L || 0, 1e-6);
    var m = {
      L: L,
      E: +model.E, I: +model.I, A: +model.A || 1e-2,
      supports: [], releases: [], loads: []
    };
    (model.supports || []).forEach(function (s) {
      var type = SUPPORTS[s.type] ? s.type : 'pin';
      m.supports.push({
        id: s.id, type: type,
        x: clamp(+s.x || 0, 0, L),
        ky: +s.ky || 0,
        kr: +s.kr || 0,
        dy: +s.dy || 0,
        rz: +s.rz || 0,
        def: SUPPORTS[type]
      });
    });
    (model.releases || []).forEach(function (rl) {
      m.releases.push({ id: rl.id, x: clamp(+rl.x || 0, 0, L), type: rl.type || 'moment' });
    });
    (model.loads || []).forEach(function (ld) {
      var o = {};
      for (var k in ld) if (Object.prototype.hasOwnProperty.call(ld, k)) o[k] = ld[k];
      if (o.kind === 'udl' || o.kind === 'dmoment') {
        var a = clamp(+o.a || 0, 0, L);
        var b = clamp(o.b === undefined ? L : +o.b, 0, L);
        if (b < a) { var tt = a; a = b; b = tt; }
        o.a = a; o.b = b;
      } else {
        o.x = clamp(+o.x || 0, 0, L);
      }
      m.loads.push(o);
    });
    return m;
  }

  /* ---------------------------------------------------------------- */
  /*  user loads -> math-convention action lists                       */
  /* ---------------------------------------------------------------- */
  function buildActions(m) {
    var pointF = [];   // {x, fx, fy}   + right / + up
    var pointM = [];   // {x, mz}       + ccw
    var distY  = [];   // {a,b,q1,q2}   transverse, + up    [N/m]
    var distX  = [];   // {a,b,q1,q2}   axial,      + right [N/m]
    var distM  = [];   // {a,b,q1,q2}   + ccw               [N.m/m]

    m.loads.forEach(function (ld) {
      if (ld.disabled) return;
      if (ld.kind === 'point') {
        var P = +ld.P || 0;
        var ang = (+ld.angle || 0) * Math.PI / 180;
        pointF.push({ x: ld.x, fx: P * Math.sin(ang), fy: -P * Math.cos(ang), src: ld });
      } else if (ld.kind === 'moment') {
        pointM.push({ x: ld.x, mz: -(+ld.M || 0), src: ld });
      } else if (ld.kind === 'udl') {
        if (ld.b - ld.a < EPS) return;
        var w1 = +ld.w1 || 0;
        var w2 = (ld.w2 === undefined || ld.w2 === null || ld.w2 === '') ? w1 : +ld.w2;
        if ((ld.dir || 'y') === 'x') distX.push({ a: ld.a, b: ld.b, q1: w1, q2: w2, src: ld });
        else distY.push({ a: ld.a, b: ld.b, q1: -w1, q2: -w2, src: ld });
      } else if (ld.kind === 'dmoment') {
        if (ld.b - ld.a < EPS) return;
        var m1 = +ld.m1 || 0;
        var m2 = (ld.m2 === undefined || ld.m2 === null || ld.m2 === '') ? m1 : +ld.m2;
        distM.push({ a: ld.a, b: ld.b, q1: -m1, q2: -m2, src: ld });
      }
    });
    return { pointF: pointF, pointM: pointM, distY: distY, distX: distX, distM: distM };
  }

  /** value of a linearly varying distributed action at station x */
  function distVal(d, x) {
    if (d.b - d.a < EPS) return d.q1;
    return d.q1 + (d.q2 - d.q1) * (x - d.a) / (d.b - d.a);
  }

  /* ---------------------------------------------------------------- */
  /*  mesh: one node at every discontinuity                            */
  /* ---------------------------------------------------------------- */
  function buildNodes(m, act) {
    var xs = [0, m.L];
    m.supports.forEach(function (s) { xs.push(s.x); });
    m.releases.forEach(function (r) { xs.push(r.x); });
    act.pointF.forEach(function (p) { xs.push(p.x); });
    act.pointM.forEach(function (p) { xs.push(p.x); });
    [act.distY, act.distX, act.distM].forEach(function (list) {
      list.forEach(function (d) { xs.push(d.a); xs.push(d.b); });
    });
    xs.sort(function (a, b) { return a - b; });
    var snap = Math.max(m.L * 1e-9, 1e-9);
    var out = [];
    xs.forEach(function (x) {
      x = clamp(x, 0, m.L);
      if (out.length === 0 || x - out[out.length - 1] > snap) out.push(x);
    });
    if (out.length < 2) out.push(m.L);
    return out.map(function (x, i) { return { i: i, x: x }; });
  }

  function findNode(nodes, x) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var d = Math.abs(nodes[i].x - x);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- */
  /*  consistent (work-equivalent) element load vector                 */
  /*  dof order: [u1, v1, t1, u2, v2, t2]                              */
  /* ---------------------------------------------------------------- */
  function elementLoadVector(len, q1, q2, p1, p2, m1, m2) {
    var f = [0, 0, 0, 0, 0, 0];
    /* transverse line load, linear q1 -> q2 (+ up):  f_i = INT q N_i  */
    f[1] += len * (0.35 * q1 + 0.15 * q2);
    f[2] += len * len * (q1 / 20 + q2 / 30);
    f[4] += len * (0.15 * q1 + 0.35 * q2);
    f[5] += -len * len * (q1 / 30 + q2 / 20);
    /* axial line load, linear p1 -> p2 (+ right) */
    f[0] += len * (2 * p1 + p2) / 6;
    f[3] += len * (p1 + 2 * p2) / 6;
    /* distributed moment, linear m1 -> m2 (+ ccw):  f_i = INT m N_i'  */
    f[1] += -0.5 * (m1 + m2);
    f[2] += len * (m1 - m2) / 12;
    f[4] += 0.5 * (m1 + m2);
    f[5] += len * (m2 - m1) / 12;
    return f;
  }

  /* ================================================================= */
  /*  MAIN ANALYSIS                                                    */
  /* ================================================================= */
  function analyze(rawModel) {
    var warnings = [];
    var m = normalize(rawModel);
    var act = buildActions(m);
    var EI = m.E * m.I, EA = m.E * m.A;
    if (!(EI > 0)) return { ok: false, error: 'E and I must both be greater than zero.' };
    if (!(EA > 0)) return { ok: false, error: 'E and A must both be greater than zero.' };
    if (!m.supports.length) return { ok: false, error: 'The beam has no supports. Add at least one support.' };

    var nodes = buildNodes(m, act);
    var nn = nodes.length;
    var i, j;

    /* ---- dof numbering (releases duplicate the right-hand-side dof) -- */
    var ndof = 0;
    nodes.forEach(function (nd) {
      nd.u = ndof++; nd.v = ndof++; nd.t = ndof++;
      nd.u2 = nd.u; nd.v2 = nd.v; nd.t2 = nd.t;
      nd.releases = {};
    });
    m.releases.forEach(function (r) {
      var k = findNode(nodes, r.x);
      if (k === 0 || k === nn - 1) {
        warnings.push('A release placed at a beam end has no effect and was ignored.');
        return;
      }
      var nd = nodes[k];
      if (r.type === 'moment' && nd.t2 === nd.t) { nd.t2 = ndof++; nd.releases.moment = true; }
      if (r.type === 'shear' && nd.v2 === nd.v) { nd.v2 = ndof++; nd.releases.shear = true; }
      if (r.type === 'axial' && nd.u2 === nd.u) { nd.u2 = ndof++; nd.releases.axial = true; }
    });

    /* ---- elements ---- */
    var elems = [];
    for (var e = 0; e < nn - 1; e++) {
      var n1 = nodes[e], n2 = nodes[e + 1];
      var len = n2.x - n1.x;
      var xm = 0.5 * (n1.x + n2.x);
      var q1 = 0, q2 = 0, p1 = 0, p2 = 0, mm1 = 0, mm2 = 0;
      /* jshint loopfunc:true */
      (function (n1, n2, xm) {
        act.distY.forEach(function (d) {
          if (xm > d.a && xm < d.b) { q1 += distVal(d, n1.x); q2 += distVal(d, n2.x); }
        });
        act.distX.forEach(function (d) {
          if (xm > d.a && xm < d.b) { p1 += distVal(d, n1.x); p2 += distVal(d, n2.x); }
        });
        act.distM.forEach(function (d) {
          if (xm > d.a && xm < d.b) { mm1 += distVal(d, n1.x); mm2 += distVal(d, n2.x); }
        });
      })(n1, n2, xm);
      elems.push({
        i: e, n1: n1, n2: n2, len: len,
        q1: q1, q2: q2, p1: p1, p2: p2, m1: mm1, m2: mm2,
        dofs: [n1.u2, n1.v2, n1.t2, n2.u, n2.v, n2.t]
      });
    }

    /* ---- assemble the pure structure stiffness K0 and load vector F0 -- */
    var K0 = [], F0 = new Array(ndof);
    for (i = 0; i < ndof; i++) { F0[i] = 0; K0.push(new Array(ndof).fill(0)); }

    elems.forEach(function (el) {
      var L1 = el.len, L2 = L1 * L1, L3 = L2 * L1;
      var ea = EA / L1;
      var k = [
        [ea, 0, 0, -ea, 0, 0],
        [0, 12 * EI / L3, 6 * EI / L2, 0, -12 * EI / L3, 6 * EI / L2],
        [0, 6 * EI / L2, 4 * EI / L1, 0, -6 * EI / L2, 2 * EI / L1],
        [-ea, 0, 0, ea, 0, 0],
        [0, -12 * EI / L3, -6 * EI / L2, 0, 12 * EI / L3, -6 * EI / L2],
        [0, 6 * EI / L2, 2 * EI / L1, 0, -6 * EI / L2, 4 * EI / L1]
      ];
      el.k = k;
      el.f = elementLoadVector(L1, el.q1, el.q2, el.p1, el.p2, el.m1, el.m2);
      for (var a = 0; a < 6; a++) {
        F0[el.dofs[a]] += el.f[a];
        for (var b = 0; b < 6; b++) K0[el.dofs[a]][el.dofs[b]] += k[a][b];
      }
    });

    act.pointF.forEach(function (p) {
      var nd = nodes[findNode(nodes, p.x)];
      F0[nd.u] += p.fx; F0[nd.v] += p.fy;
    });
    act.pointM.forEach(function (p) {
      var nd = nodes[findNode(nodes, p.x)];
      F0[nd.t] += p.mz;
    });

    /* ---- supports: springs, restraints, prescribed displacements ----- */
    var K = K0.map(function (row) { return row.slice(); });
    var F = F0.slice();
    var prescribed = new Map();
    var supportInfo = [];

    m.supports.forEach(function (s) {
      var nd = nodes[findNode(nodes, s.x)];
      var info = { support: s, node: nd, dofU: nd.u, dofV: nd.v, dofR: nd.t };
      supportInfo.push(info);
      if (s.def.fixU) prescribed.set(nd.u, 0);
      if (s.def.fixV) prescribed.set(nd.v, -s.dy);
      if (s.def.fixR) prescribed.set(nd.t, -s.rz);
      if (!s.def.fixV && s.ky > 0) {
        K[nd.v][nd.v] += s.ky; F[nd.v] += s.ky * (-s.dy); info.spring = true;
      }
      if (!s.def.fixR && s.kr > 0) {
        K[nd.t][nd.t] += s.kr; F[nd.t] += s.kr * (-s.rz); info.rspring = true;
      }
    });

    /* ---- axial rigid-body mode: harmless when there is no axial load -- */
    var hasAxialRestraint = m.supports.some(function (s) { return s.def.fixU; });
    var hasAxialLoad = act.pointF.some(function (p) { return Math.abs(p.fx) > EPS; }) || act.distX.length > 0;
    if (!hasAxialRestraint) {
      if (hasAxialLoad) {
        warnings.push('No support restrains horizontal movement while horizontal loads are applied: the beam is unstable in the axial direction.');
      } else {
        prescribed.set(nodes[findNode(nodes, m.supports[0].x)].u, 0);
      }
    }

    /* ---- reduce and solve ---- */
    var free = [];
    for (i = 0; i < ndof; i++) if (!prescribed.has(i)) free.push(i);

    var Kf = free.map(function () { return new Array(free.length).fill(0); });
    var Ff = new Array(free.length).fill(0);
    for (var a2 = 0; a2 < free.length; a2++) {
      var da = free[a2];
      Ff[a2] = F[da];
      for (var b2 = 0; b2 < free.length; b2++) Kf[a2][b2] = K[da][free[b2]];
      prescribed.forEach(function (val, dp) { if (val !== 0) Ff[a2] -= K[da][dp] * val; });
    }

    var sol = gaussSolve(Kf, Ff);
    if (!sol.ok) {
      var bad = free[sol.badCol];
      var ndBad = null, what = 'degree of freedom';
      for (i = 0; i < nodes.length; i++) {
        var nd2 = nodes[i];
        if (bad === nd2.v || bad === nd2.v2) { ndBad = nd2; what = 'vertical translation'; break; }
        if (bad === nd2.t || bad === nd2.t2) { ndBad = nd2; what = 'rotation'; break; }
        if (bad === nd2.u || bad === nd2.u2) { ndBad = nd2; what = 'horizontal translation'; break; }
      }
      return {
        ok: false,
        error: 'The beam is unstable (it forms a mechanism): unrestrained ' + what +
          (ndBad ? ' at x = ' + ndBad.x.toFixed(3) + ' m' : '') +
          '. Add or change a support, or remove an internal release.'
      };
    }

    var d = new Array(ndof).fill(0);
    prescribed.forEach(function (val, dp) { d[dp] = val; });
    free.forEach(function (dofi, k) { d[dofi] = sol.x[k]; });

    /* ---- reactions:  r = K0 d - F0  (springs are not part of K0) ---- */
    var r = new Array(ndof).fill(0);
    for (i = 0; i < ndof; i++) {
      var s0 = -F0[i], row = K0[i];
      for (j = 0; j < ndof; j++) if (row[j] !== 0) s0 += row[j] * d[j];
      r[i] = s0;
    }

    var reactions = supportInfo.map(function (info) {
      return {
        support: info.support,
        type: info.support.type,
        x: info.node.x,
        Rx: r[info.dofU],
        Ry: r[info.dofV],
        Mz: r[info.dofR],
        dy: -d[info.dofV],
        rz: -d[info.dofR],
        isSpring: !!info.spring,
        isRSpring: !!info.rspring
      };
    });

    /* ---- action lists including the reactions (used by the diagrams) - */
    var allPF = act.pointF.slice();
    var allPM = act.pointM.slice();
    reactions.forEach(function (R) {
      if (Math.abs(R.Rx) > 0 || Math.abs(R.Ry) > 0) allPF.push({ x: R.x, fx: R.Rx, fy: R.Ry, reaction: true });
      if (Math.abs(R.Mz) > 0) allPM.push({ x: R.x, mz: R.Mz, reaction: true });
    });

    /* ================= internal forces by direct integration ========= */
    var xtol = Math.max(m.L * 1e-9, 1e-12);

    function includePoint(px, x, side) {
      if (px < x - xtol) return true;
      if (px > x + xtol) return false;
      return side > 0;
    }

    function shearAt(x, side) {
      var V = 0, i, p, dl, t, len, k;
      for (i = 0; i < allPF.length; i++) {
        p = allPF[i];
        if (includePoint(p.x, x, side)) V += p.fy;
      }
      for (i = 0; i < act.distY.length; i++) {
        dl = act.distY[i];
        if (x <= dl.a) continue;
        len = dl.b - dl.a;
        t = Math.min(x, dl.b) - dl.a;
        k = len > EPS ? (dl.q2 - dl.q1) / len : 0;
        V += dl.q1 * t + 0.5 * k * t * t;
      }
      return V;
    }

    function axialAt(x, side) {
      var S = 0, i, p, dl, t, len, k;
      for (i = 0; i < allPF.length; i++) {
        p = allPF[i];
        if (includePoint(p.x, x, side)) S += p.fx;
      }
      for (i = 0; i < act.distX.length; i++) {
        dl = act.distX[i];
        if (x <= dl.a) continue;
        len = dl.b - dl.a;
        t = Math.min(x, dl.b) - dl.a;
        k = len > EPS ? (dl.q2 - dl.q1) / len : 0;
        S += dl.q1 * t + 0.5 * k * t * t;
      }
      return -S;
    }

    function momentAt(x, side) {
      var M = 0, i, p, dl, t, len, k, X;
      for (i = 0; i < allPF.length; i++) {
        p = allPF[i];
        if (includePoint(p.x, x, side)) M += p.fy * (x - p.x);
      }
      for (i = 0; i < allPM.length; i++) {
        p = allPM[i];
        if (includePoint(p.x, x, side)) M -= p.mz;
      }
      for (i = 0; i < act.distY.length; i++) {
        dl = act.distY[i];
        if (x <= dl.a) continue;
        len = dl.b - dl.a;
        t = Math.min(x, dl.b) - dl.a;
        k = len > EPS ? (dl.q2 - dl.q1) / len : 0;
        X = x - dl.a;
        M += dl.q1 * X * t - dl.q1 * t * t / 2 + k * X * t * t / 2 - k * t * t * t / 3;
      }
      for (i = 0; i < act.distM.length; i++) {
        dl = act.distM[i];
        if (x <= dl.a) continue;
        len = dl.b - dl.a;
        t = Math.min(x, dl.b) - dl.a;
        k = len > EPS ? (dl.q2 - dl.q1) / len : 0;
        M -= (dl.q1 * t + 0.5 * k * t * t);
      }
      return M;
    }

    /* ============ deflection: exact element solution ================= */
    elems.forEach(function (el) {
      var len = el.len;
      var km = len > EPS ? (el.m2 - el.m1) / len : 0;
      var a = el.q1 - km;
      var bq = (el.q2 - km) - a;
      el.pa = a; el.pb = bq;
      var pL = (a * Math.pow(len, 4) / 24 + bq * Math.pow(len, 4) / 120) / EI;
      var pLd = (a * Math.pow(len, 3) / 6 + bq * Math.pow(len, 3) / 24) / EI;
      var A = -pL, B = -pLd;
      el.c2 = 3 * A / (len * len) - B / len;
      el.c3 = (-2 * A + B * len) / (len * len * len);
    });

    function elementAt(x) {
      var lo = 0, hi = elems.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (x > elems[mid].n2.x) lo = mid + 1; else hi = mid;
      }
      return elems[lo];
    }

    function deflAt(x, el) {
      el = el || elementAt(x);
      var len = el.len;
      var s = clamp(x - el.n1.x, 0, len);
      var xi = len > EPS ? s / len : 0;
      var v1 = d[el.dofs[1]], t1 = d[el.dofs[2]], v2 = d[el.dofs[4]], t2 = d[el.dofs[5]];
      var N1 = 1 - 3 * xi * xi + 2 * xi * xi * xi;
      var N2 = len * (xi - 2 * xi * xi + xi * xi * xi);
      var N3 = 3 * xi * xi - 2 * xi * xi * xi;
      var N4 = len * (-xi * xi + xi * xi * xi);
      var p = (el.pa * Math.pow(s, 4) / 24 + el.pb * Math.pow(s, 5) / (120 * len)) / EI;
      return N1 * v1 + N2 * t1 + N3 * v2 + N4 * t2 + p + el.c2 * s * s + el.c3 * s * s * s;
    }

    function slopeAt(x, el) {
      el = el || elementAt(x);
      var len = el.len;
      var s = clamp(x - el.n1.x, 0, len);
      var xi = len > EPS ? s / len : 0;
      var v1 = d[el.dofs[1]], t1 = d[el.dofs[2]], v2 = d[el.dofs[4]], t2 = d[el.dofs[5]];
      var dN1 = (-6 * xi + 6 * xi * xi) / len;
      var dN2 = 1 - 4 * xi + 3 * xi * xi;
      var dN3 = (6 * xi - 6 * xi * xi) / len;
      var dN4 = -2 * xi + 3 * xi * xi;
      var dp = (el.pa * Math.pow(s, 3) / 6 + el.pb * Math.pow(s, 4) / (24 * len)) / EI;
      return dN1 * v1 + dN2 * t1 + dN3 * v2 + dN4 * t2 + dp + 2 * el.c2 * s + 3 * el.c3 * s * s;
    }

    function axialDispAt(x, el) {
      el = el || elementAt(x);
      var len = el.len;
      var xi = len > EPS ? clamp(x - el.n1.x, 0, len) / len : 0;
      return (1 - xi) * d[el.dofs[0]] + xi * d[el.dofs[3]];
    }

    /* ---- intensity of the transverse line load (for the load diagram) */
    function loadIntensity(x, side) {
      var w = 0;
      act.distY.forEach(function (dl) {
        var inside = side < 0 ? (x > dl.a + xtol && x <= dl.b + xtol)
                              : (x >= dl.a - xtol && x < dl.b - xtol);
        if (inside) w += -distVal(dl, x);
      });
      return w;
    }

    /* ================= sampled series for plotting =================== */
    var targetPts = 1500;
    var series = { N: [], V: [], M: [], S: [], D: [] };

    function pushAll(x, side, el) {
      series.N.push({ x: x, y: axialAt(x, side) });
      series.V.push({ x: x, y: shearAt(x, side) });
      series.M.push({ x: x, y: momentAt(x, side) });
      series.S.push({ x: x, y: slopeAt(x, el) });
      series.D.push({ x: x, y: deflAt(x, el) });
    }

    series.N.push({ x: 0, y: 0 });
    series.V.push({ x: 0, y: 0 });
    series.M.push({ x: 0, y: 0 });

    elems.forEach(function (el) {
      var nseg = Math.max(10, Math.round(targetPts * el.len / m.L));
      for (var jj = 0; jj <= nseg; jj++) {
        var x = el.n1.x + el.len * jj / nseg;
        var side = (jj === 0) ? 1 : (jj === nseg ? -1 : 0);
        pushAll(clamp(x, el.n1.x, el.n2.x), side, el);
      }
    });

    series.N.push({ x: m.L, y: 0 });
    series.V.push({ x: m.L, y: 0 });
    series.M.push({ x: m.L, y: 0 });

    /* ================= extrema ======================================= */
    function extrema(arr) {
      if (!arr.length) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 }, absMax: { x: 0, y: 0 } };
      var mn = { x: arr[0].x, y: arr[0].y }, mx = { x: arr[0].x, y: arr[0].y };
      arr.forEach(function (p) {
        if (p.y < mn.y) mn = { x: p.x, y: p.y };
        if (p.y > mx.y) mx = { x: p.x, y: p.y };
      });
      return { min: mn, max: mx, absMax: Math.abs(mn.y) > Math.abs(mx.y) ? mn : mx };
    }

    var ext = {
      N: extrema(series.N), V: extrema(series.V), M: extrema(series.M),
      S: extrema(series.S), D: extrema(series.D)
    };

    /* ---- zero-shear stations (where the moment is stationary) ------- */
    var zeroShear = [];
    for (i = 1; i < series.V.length; i++) {
      var y0 = series.V[i - 1].y, y1 = series.V[i].y;
      if (y0 === 0 && y1 === 0) continue;
      if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
        var x0 = series.V[i - 1].x, x1 = series.V[i].x;
        if (Math.abs(x1 - x0) < xtol) continue;
        var xz = x0 + (x1 - x0) * (0 - y0) / (y1 - y0);
        zeroShear.push({ x: xz, M: momentAt(xz, 1) });
      }
    }

    /* ================= global equilibrium check ====================== */
    var sumFy = 0, sumFx = 0, sumM = 0;
    allPF.forEach(function (p) { sumFy += p.fy; sumFx += p.fx; sumM += p.fy * (-p.x); });
    allPM.forEach(function (p) { sumM += p.mz; });
    act.distY.forEach(function (dl) {
      var len = dl.b - dl.a, tot = 0.5 * (dl.q1 + dl.q2) * len;
      var denom = dl.q1 + dl.q2;
      var xc = Math.abs(denom) > EPS ? dl.a + len * (dl.q1 + 2 * dl.q2) / (3 * denom) : dl.a + len / 2;
      sumFy += tot; sumM += tot * (-xc);
    });
    act.distX.forEach(function (dl) { sumFx += 0.5 * (dl.q1 + dl.q2) * (dl.b - dl.a); });
    act.distM.forEach(function (dl) { sumM += 0.5 * (dl.q1 + dl.q2) * (dl.b - dl.a); });

    var refF = Math.max(1, Math.abs(ext.V.absMax.y));
    var refM = Math.max(1, Math.abs(ext.M.absMax.y));
    var equilibrium = {
      sumFy: sumFy, sumFx: sumFx, sumM: sumM,
      resV: shearAt(m.L, 1), resM: momentAt(m.L, 1),
      ok: Math.abs(sumFy) < 1e-6 * refF && Math.abs(sumFx) < 1e-6 * refF &&
          Math.abs(shearAt(m.L, 1)) < 1e-6 * refF && Math.abs(momentAt(m.L, 1)) < 1e-6 * refM
    };

    /* ================= static determinacy ============================ */
    var nRestraints = 0;
    m.supports.forEach(function (s) {
      if (s.def.fixU) nRestraints++;
      if (s.def.fixV) nRestraints++;
      if (s.def.fixR) nRestraints++;
      if (!s.def.fixV && s.ky > 0) nRestraints++;
      if (!s.def.fixR && s.kr > 0) nRestraints++;
    });
    var nReleases = m.releases.filter(function (rl) {
      var k = findNode(nodes, rl.x); return k > 0 && k < nn - 1;
    }).length;

    return {
      ok: true,
      model: m,
      nodes: nodes,
      elements: elems,
      ndof: ndof,
      displacements: d,
      reactions: reactions,
      series: series,
      extrema: ext,
      zeroShear: zeroShear,
      equilibrium: equilibrium,
      indeterminacy: nRestraints - 3 - nReleases,
      hasAxial: hasAxialLoad,
      warnings: warnings,
      shearAt: shearAt,
      momentAt: momentAt,
      axialAt: axialAt,
      slopeAt: function (x) { return slopeAt(x); },
      deflAt: function (x) { return deflAt(x); },
      axialDispAt: function (x) { return axialDispAt(x); },
      loadIntensityAt: loadIntensity,
      valuesAt: function (x) {
        x = clamp(x, 0, m.L);
        return {
          x: x,
          Vl: shearAt(x, -1), Vr: shearAt(x, 1),
          Ml: momentAt(x, -1), Mr: momentAt(x, 1),
          Nl: axialAt(x, -1), Nr: axialAt(x, 1),
          slope: slopeAt(x), defl: deflAt(x), w: loadIntensity(x, 1)
        };
      }
    };
  }

  return {
    analyze: analyze,
    SUPPORTS: SUPPORTS,
    _internal: { gaussSolve: gaussSolve, elementLoadVector: elementLoadVector }
  };
});
