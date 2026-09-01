'use strict';
/* =====================================================================
   render.js - draws the whole drawing area (beam scene + diagrams) into
   a single SVG so that every panel shares one x axis and one crosshair.

   Render.draw(opts) returns a small "scene map" that app.js uses for
   hit-testing, dragging and the hover read-out.
   ===================================================================== */

var Render = (function () {

  var NS = 'http://www.w3.org/2000/svg';

  /* --- tiny DOM helpers ------------------------------------------- */
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* --- geometry constants ----------------------------------------- */
  var PAD_L = 66, PAD_R = 30;
  var SCENE_LOAD = 154;      /* room above the beam for the loads      */
  var UDL_MAX = 62;          /* tallest a line-load block can be        */
  var SCENE_BEAM = 14;       /* beam thickness                          */
  var SCENE_SUP  = 72;       /* room below the beam for the supports    */
  var SCENE_DIM  = 42;       /* dimension chain                         */
  var PANEL_H    = 138;      /* plot height of one diagram              */
  var PANEL_TITLE = 22;
  var PANEL_GAP  = 10;

  /* ================================================================= */
  function draw(o) {
    var svg = o.svg, st = o.state, res = o.result, U = o.units;
    var W = Math.max(560, o.width);
    var L = st.beam.L;
    var plotW = W - PAD_L - PAD_R;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var ink = css('--text-primary'), ink2 = css('--text-secondary'), ink3 = css('--text-muted');
    var grid = css('--grid'), gridS = css('--grid-strong');
    var beamInk = css('--beam-ink'), supInk = css('--support-ink');
    var loadCol = css('--c-load'), surf = css('--surface-1');
    var accent = css('--accent');

    var COLORS = {
      N: css('--c-axial'), V: css('--c-shear'), M: css('--c-moment'),
      S: css('--c-slope'), D: css('--c-defl')
    };

    function X(x) { return PAD_L + (L > 0 ? x / L : 0) * plotW; }
    function invX(px) { return (px - PAD_L) / plotW * L; }

    /* ---------------- defs ---------------- */
    var defs = el('defs', null, svg);
    (function () {
      var p = el('pattern', { id: 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse',
                              patternTransform: 'rotate(45)' }, defs);
      el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: supInk, 'stroke-width': 1.1, opacity: .75 }, p);

      function marker(id, color, scale) {
        var mk = el('marker', {
          id: id, viewBox: '0 0 10 10', refX: 9.5, refY: 5,
          markerWidth: 6 * (scale || 1), markerHeight: 6 * (scale || 1),
          orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse'
        }, defs);
        el('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: color }, mk);
      }
      marker('ah-load', loadCol, 1.7);
      marker('ah-react', accent, 1.5);
      marker('ah-dim', ink3, 1.1);
    })();

    /* Behind everything: a transparent rect that catches clicks on empty
       space (used to move the section marker) and never blocks objects.  */
    var capture = el('rect', { x: 0, y: 0, width: W, height: 4000, fill: 'transparent', class: 'capture' }, svg);

    /* =============================================================== */
    /*  SCENE                                                          */
    /* =============================================================== */
    var sceneTop = 4;
    var yBeam = sceneTop + SCENE_LOAD;                 /* beam centreline */
    var sceneBottom = yBeam + SCENE_SUP + SCENE_DIM;
    var scene = el('g', { class: 'scene' }, svg);

    /* subtle vertical guides at every support / release / load station */
    var stations = [];
    st.supports.forEach(function (s) { stations.push(s.x); });
    st.releases.forEach(function (r) { stations.push(r.x); });
    stations.push(0, L);

    /* ---- distributed loads (drawn first, behind everything) ---- */
    var maxW = 0, maxP = 0, maxM = 0, maxDM = 0;
    st.loads.forEach(function (ld) {
      if (ld.kind === 'udl') maxW = Math.max(maxW, Math.abs(ld.w1), Math.abs(ld.w2));
      else if (ld.kind === 'point') maxP = Math.max(maxP, Math.abs(ld.P));
      else if (ld.kind === 'moment') maxM = Math.max(maxM, Math.abs(ld.M));
      else if (ld.kind === 'dmoment') maxDM = Math.max(maxDM, Math.abs(ld.m1), Math.abs(ld.m2));
    });
    function hOf(v, mx, hi, lo) {
      if (!mx) return hi;
      var t = Math.abs(v) / mx;
      return lo + (hi - lo) * Math.sqrt(t);
    }

    var selKind = st.selection ? st.selection.kind : null;
    var selId = st.selection ? st.selection.id : null;
    function isSel(kind, id) { return selKind === kind && selId === id; }

    /* ---------- UDL / trapezoidal loads ---------- */
    st.loads.forEach(function (ld) {
      if (ld.kind !== 'udl') return;
      var g = el('g', {
        class: 'grabbable', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': 'body'
      }, scene);
      var xa = X(ld.a), xb = X(ld.b);
      var vertical = (ld.dir || 'y') === 'y';
      var h1 = hOf(ld.w1, maxW, 62, 12), h2 = hOf(ld.w2, maxW, 62, 12);
      var s1 = ld.w1 >= 0 ? -1 : 1, s2 = ld.w2 >= 0 ? -1 : 1;
      var y1 = yBeam + s1 * (h1 + SCENE_BEAM / 2), y2 = yBeam + s2 * (h2 + SCENE_BEAM / 2);
      var yb1 = yBeam + s1 * SCENE_BEAM / 2, yb2 = yBeam + s2 * SCENE_BEAM / 2;

      if (vertical) {
        el('path', {
          d: 'M' + xa + ',' + yb1 + ' L' + xa + ',' + y1 + ' L' + xb + ',' + y2 + ' L' + xb + ',' + yb2 + ' Z',
          fill: loadCol, 'fill-opacity': .16, stroke: 'none'
        }, g);
        el('line', { x1: xa, y1: y1, x2: xb, y2: y2, stroke: loadCol, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
        /* arrows */
        var n = Math.max(2, Math.min(14, Math.round((xb - xa) / 26)));
        for (var i = 0; i <= n; i++) {
          var t = i / n, xx = xa + (xb - xa) * t;
          var yy = y1 + (y2 - y1) * t;
          var yend = yBeam + (ld.w1 + (ld.w2 - ld.w1) * t >= 0 ? -1 : 1) * SCENE_BEAM / 2;
          if (Math.abs(yy - yend) < 8) continue;
          el('line', {
            x1: xx, y1: yy, x2: xx, y2: yend,
            stroke: loadCol, 'stroke-width': 1.3, 'marker-end': 'url(#ah-load)', opacity: .95
          }, g);
        }
      } else {
        /* horizontal (axial) line load: its own lane above the UDL block */
        var yy0 = yBeam - SCENE_BEAM / 2 - UDL_MAX - 22;
        el('line', { x1: xa, y1: yy0, x2: xb, y2: yy0, stroke: loadCol, 'stroke-width': 2 }, g);
        var m = Math.max(2, Math.min(12, Math.round((xb - xa) / 30)));
        for (var j = 0; j <= m; j++) {
          var xx2 = xa + (xb - xa) * j / m;
          var dirp = (ld.w1 + (ld.w2 - ld.w1) * (j / m)) >= 0 ? 1 : -1;
          var x2a = clampPx(xx2 - 9 * dirp, xa, xb), x2b = clampPx(xx2 + 9 * dirp, xa, xb);
          if (Math.abs(x2b - x2a) < 3) continue;
          el('line', {
            x1: x2a, y1: yy0, x2: x2b, y2: yy0,
            stroke: loadCol, 'stroke-width': 1.3, 'marker-end': 'url(#ah-load)'
          }, g);
        }
        txt(g, (xa + xb) / 2, yy0 - 8,
          (ld.w1 === ld.w2 ? fmtN(ld.w1, U.dist) : fmtN(ld.w1, U.dist) + ' \u2192 ' + fmtN(ld.w2, U.dist)) + ' ' + U.dist.sym,
          { 'text-anchor': 'middle', 'font-size': 12.5, fill: loadCol, 'font-weight': 600 });
      }

      /* drag handles for a and b */
      [['a', xa, y1], ['b', xb, y2]].forEach(function (h) {
        el('circle', {
          cx: h[1], cy: h[2], r: 5.5, fill: surf, stroke: loadCol, 'stroke-width': 1.8,
          class: 'hit', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': h[0]
        }, g);
      });

      var lbl = (ld.w1 === ld.w2)
        ? fmtN(ld.w1, U.dist) + ' ' + U.dist.sym
        : fmtN(ld.w1, U.dist) + ' → ' + fmtN(ld.w2, U.dist) + ' ' + U.dist.sym;
      txt(g, (xa + xb) / 2, Math.min(y1, y2) - 7, lbl,
        { 'text-anchor': 'middle', 'font-size': 12.5, fill: loadCol, 'font-weight': 600 });

      if (isSel('load', ld.id)) {
        el('rect', {
          x: Math.min(xa, xb) - 6, y: Math.min(y1, y2) - 20,
          width: Math.abs(xb - xa) + 12, height: Math.abs(yBeam - Math.min(y1, y2)) + 26,
          fill: 'none', stroke: accent, 'stroke-width': 1.4, 'stroke-dasharray': '4 3', rx: 5
        }, g);
      }
    });

    /* ---------- distributed moments ---------- */
    st.loads.forEach(function (ld) {
      if (ld.kind !== 'dmoment') return;
      var g = el('g', { class: 'grabbable', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': 'body' }, scene);
      var xa = X(ld.a), xb = X(ld.b);
      var yy = yBeam - SCENE_BEAM / 2 - UDL_MAX - 52;
      el('line', { x1: xa, y1: yy, x2: xb, y2: yy, stroke: loadCol, 'stroke-width': 1.6, 'stroke-dasharray': '3 3' }, g);
      var n = Math.max(2, Math.min(10, Math.round((xb - xa) / 34)));
      for (var i = 0; i <= n; i++) {
        var xx = xa + (xb - xa) * i / n;
        var val = ld.m1 + (ld.m2 - ld.m1) * (i / n);
        arcArrow(g, xx, yy, 9, val >= 0, loadCol, 1.4);
      }
      [['a', xa], ['b', xb]].forEach(function (h) {
        el('circle', { cx: h[1], cy: yy, r: 5.5, fill: surf, stroke: loadCol, 'stroke-width': 1.8,
          class: 'hit', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': h[0] }, g);
      });
      txt(g, (xa + xb) / 2, yy - 16,
        (ld.m1 === ld.m2 ? fmtN(ld.m1, U.distM) : fmtN(ld.m1, U.distM) + ' → ' + fmtN(ld.m2, U.distM)) + ' ' + U.distM.sym,
        { 'text-anchor': 'middle', 'font-size': 12.5, fill: loadCol, 'font-weight': 600 });
    });

    /* ---------- the beam itself ---------- */
    var beamG = el('g', { 'data-kind': 'beam' }, scene);
    el('rect', {
      x: X(0), y: yBeam - SCENE_BEAM / 2, width: plotW, height: SCENE_BEAM,
      rx: 2.5, fill: beamInk, 'fill-opacity': .92
    }, beamG);

    /* ---------- deflected shape overlay ---------- */
    if (res && res.ok && st.opts.showDeflected) {
      var dmax = Math.abs(res.extrema.D.absMax.y) || 1;
      var amp = 26;
      var pts = [];
      res.series.D.forEach(function (p) {
        pts.push(X(p.x) + ',' + (yBeam - p.y / dmax * amp));
      });
      if (pts.length) {
        el('polyline', {
          points: pts.join(' '), fill: 'none', stroke: COLORS.D,
          'stroke-width': 2, 'stroke-linejoin': 'round', opacity: .95, 'stroke-dasharray': '5 3'
        }, beamG);
      }
    }

    /* ---------- internal releases ---------- */
    st.releases.forEach(function (r) {
      var g = el('g', { class: 'grabbable', 'data-kind': 'release', 'data-id': r.id, 'data-handle': 'body' }, scene);
      var x = X(r.x);
      if (r.type === 'moment') {
        el('circle', { cx: x, cy: yBeam, r: 5.6, fill: surf, stroke: beamInk, 'stroke-width': 2 }, g);
      } else if (r.type === 'shear') {
        el('rect', { x: x - 3.5, y: yBeam - SCENE_BEAM / 2 - 3, width: 7, height: SCENE_BEAM + 6,
                     fill: surf, stroke: beamInk, 'stroke-width': 1.8, rx: 1.5 }, g);
      } else {
        el('line', { x1: x, y1: yBeam - 10, x2: x, y2: yBeam + 10, stroke: beamInk, 'stroke-width': 2 }, g);
      }
      if (isSel('release', r.id)) {
        el('circle', { cx: x, cy: yBeam, r: 10, fill: 'none', stroke: accent, 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }, g);
      }
    });

    /* ---------- supports ---------- */
    st.supports.forEach(function (s) {
      var g = el('g', { class: 'grabbable', 'data-kind': 'support', 'data-id': s.id, 'data-handle': 'body' }, scene);
      var atEnd = s.x <= L * 1e-9 ? -1 : (s.x >= L * (1 - 1e-9) ? 1 : 0);
      drawSupport(g, X(s.x), yBeam + SCENE_BEAM / 2, s, supInk, surf, ink3, atEnd, SCENE_BEAM);
      if (isSel('support', s.id)) {
        el('rect', { x: X(s.x) - 20, y: yBeam + SCENE_BEAM / 2 - 2, width: 40, height: 44,
                     fill: 'none', stroke: accent, 'stroke-width': 1.4, 'stroke-dasharray': '4 3', rx: 5 }, g);
      }
      /* settlement marker */
      if (s.dy) {
        el('line', { x1: X(s.x) + 17, y1: yBeam + 12, x2: X(s.x) + 17, y2: yBeam + 30,
                     stroke: css('--warn'), 'stroke-width': 1.4, 'marker-end': 'url(#ah-dim)' }, g);
        txt(g, X(s.x) + 21, yBeam + 26, fmtN(s.dy, U.small) + U.small.sym,
          { 'font-size': 11.5, fill: css('--warn') });
      }
    });

    /* ---------- concentrated loads and moments ---------- */
    st.loads.forEach(function (ld) {
      if (ld.kind === 'point') {
        var g = el('g', { class: 'grabbable', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': 'body' }, scene);
        var x = X(ld.x);
        var h = hOf(ld.P, maxP, 66, 26);
        var ang = (ld.angle || 0) * Math.PI / 180;
        var down = ld.P >= 0;
        /* tip sits just off the beam, tail is up (or down for uplift) */
        var tipY = yBeam - (down ? SCENE_BEAM / 2 + 1 : -SCENE_BEAM / 2 - 1);
        var dx = Math.sin(ang) * h, dy = Math.cos(ang) * h;
        var tailX = x - (down ? dx : -dx), tailY = tipY - (down ? dy : -dy);
        el('line', {
          x1: tailX, y1: tailY, x2: x, y2: tipY,
          stroke: loadCol, 'stroke-width': 2.2, 'marker-end': 'url(#ah-load)', 'stroke-linecap': 'round'
        }, g);
        el('circle', { cx: tailX, cy: tailY, r: 8, fill: 'transparent', class: 'grabbable',
                       'data-kind': 'load', 'data-id': ld.id, 'data-handle': 'body' }, g);
        txt(g, tailX, tailY - 7, fmtN(Math.abs(ld.P), U.force) + ' ' + U.force.sym,
          { 'text-anchor': 'middle', 'font-size': 12.5, fill: loadCol, 'font-weight': 600 });
        if (isSel('load', ld.id)) {
          el('circle', { cx: x, cy: tipY, r: 7, fill: 'none', stroke: accent, 'stroke-width': 1.5 }, g);
        }
      } else if (ld.kind === 'moment') {
        var g2 = el('g', { class: 'grabbable', 'data-kind': 'load', 'data-id': ld.id, 'data-handle': 'body' }, scene);
        var x2 = X(ld.x);
        var r2 = hOf(ld.M, maxM, 21, 12);
        arcArrow(g2, x2, yBeam, r2, ld.M >= 0, loadCol, 2.2);
        el('circle', { cx: x2, cy: yBeam, r: r2 + 4, fill: 'transparent' }, g2);
        txt(g2, x2, yBeam - r2 - 10, fmtN(Math.abs(ld.M), U.mom) + ' ' + U.mom.sym,
          { 'text-anchor': 'middle', 'font-size': 12.5, fill: loadCol, 'font-weight': 600 });
        if (isSel('load', ld.id)) {
          el('circle', { cx: x2, cy: yBeam, r: r2 + 7, fill: 'none', stroke: accent,
                         'stroke-width': 1.4, 'stroke-dasharray': '3 3' }, g2);
        }
      }
    });

    /* ---------- reaction arrows ---------- */
    if (res && res.ok && st.opts.showReactions) {
      res.reactions.forEach(function (R) {
        var x = X(R.x), g = el('g', { 'pointer-events': 'none' }, scene);
        var y0 = yBeam + SCENE_BEAM / 2 + 44;
        var side = R.x > L / 2 ? -1 : 1;      /* push the labels inboard */
        if (Math.abs(R.Ry) > 1e-9) {
          var up = R.Ry > 0;
          el('line', {
            x1: x, y1: up ? y0 : y0 - 24, x2: x, y2: up ? y0 - 24 : y0,
            stroke: accent, 'stroke-width': 2, 'marker-end': 'url(#ah-react)'
          }, g);
          txt(g, x, y0 + 12, fmtN(Math.abs(R.Ry), U.force) + ' ' + U.force.sym,
            { 'text-anchor': 'middle', 'font-size': 12, fill: accent, 'font-weight': 600 });
        }
        if (Math.abs(R.Mz) > 1e-9) {
          var mx = x + side * 34;
          arcArrow(g, mx, yBeam + SCENE_BEAM / 2 + 20, 10, R.Mz < 0, accent, 1.7);
          txt(g, mx, yBeam + SCENE_BEAM / 2 + 42, fmtN(Math.abs(R.Mz), U.mom) + ' ' + U.mom.sym,
            { 'text-anchor': 'middle', 'font-size': 12, fill: accent, 'font-weight': 600 });
        }
        if (Math.abs(R.Rx) > 1e-9) {
          var right = R.Rx > 0;
          var yx = yBeam + SCENE_BEAM / 2 + 6;
          el('line', {
            x1: right ? x - 28 : x + 28, y1: yx, x2: x, y2: yx,
            stroke: accent, 'stroke-width': 2, 'marker-end': 'url(#ah-react)'
          }, g);
          txt(g, x - side * 32, yx - 4, fmtN(Math.abs(R.Rx), U.force) + ' ' + U.force.sym,
            { 'text-anchor': 'middle', 'font-size': 12, fill: accent, 'font-weight': 600 });
        }
      });
    }

    /* ---------- dimension chain ---------- */
    (function () {
      var g = el('g', { 'pointer-events': 'none' }, scene);
      var yd = yBeam + SCENE_SUP + 8;
      var xs = [0];
      st.supports.forEach(function (s) { xs.push(s.x); });
      st.releases.forEach(function (s) { xs.push(s.x); });
      xs.push(L);
      xs = xs.filter(function (v, i, a) { return a.findIndex(function (b) { return Math.abs(b - v) < L * 1e-6; }) === i; })
             .sort(function (a, b) { return a - b; });
      xs.forEach(function (x) {
        el('line', { x1: X(x), y1: yBeam + SCENE_BEAM / 2, x2: X(x), y2: yd + 5,
                     stroke: ink3, 'stroke-width': .8, 'stroke-dasharray': '2 3', opacity: .7 }, g);
      });
      for (var i = 0; i < xs.length - 1; i++) {
        var x1 = X(xs[i]), x2 = X(xs[i + 1]);
        if (x2 - x1 < 4) continue;
        el('line', { x1: x1, y1: yd, x2: x2, y2: yd, stroke: ink3, 'stroke-width': .9,
                     'marker-start': 'url(#ah-dim)', 'marker-end': 'url(#ah-dim)' }, g);
        if (x2 - x1 > 34) {
          txt(g, (x1 + x2) / 2, yd - 4, fmtN(xs[i + 1] - xs[i], U.len),
            { 'text-anchor': 'middle', 'font-size': 11.5, fill: ink3 });
        }
      }
      /* overall length */
      var yo = yd + 20;
      el('line', { x1: X(0), y1: yo, x2: X(L), y2: yo, stroke: ink2, 'stroke-width': 1,
                   'marker-start': 'url(#ah-dim)', 'marker-end': 'url(#ah-dim)' }, g);
      txt(g, (X(0) + X(L)) / 2, yo - 4, 'L = ' + fmtN(L, U.len) + ' ' + U.len.sym,
        { 'text-anchor': 'middle', 'font-size': 12, fill: ink2, 'font-weight': 600 });
    })();

    /* =============================================================== */
    /*  DIAGRAM PANELS                                                 */
    /* =============================================================== */
    var panels = [];
    var order = [
      { key: 'N', label: 'Axial force', sym: 'N', unit: U.force, on: st.opts.showN },
      { key: 'V', label: 'Shear force', sym: 'V', unit: U.force, on: st.opts.showV },
      { key: 'M', label: 'Bending moment', sym: 'M', unit: U.mom, on: st.opts.showM },
      { key: 'S', label: 'Slope', sym: 'θ', unit: U.slope, on: st.opts.showS },
      { key: 'D', label: 'Deflection', sym: 'v', unit: U.defl, on: st.opts.showD }
    ];

    var y = sceneBottom + 6;
    if (res && res.ok) {
      order.forEach(function (p) {
        if (!p.on) return;
        if (p.key === 'N' && !res.hasAxial && !st.opts.forceN) return;
        var info = drawPanel(svg, {
          key: p.key, label: p.label, sym: p.sym, unit: p.unit,
          data: res.series[p.key], color: COLORS[p.key],
          top: y, height: PANEL_H, X: X, L: L, plotW: plotW, padL: PAD_L,
          ink: ink, ink2: ink2, ink3: ink3, grid: grid, gridS: gridS, surf: surf,
          flip: (p.key === 'M' && st.opts.bmdDown),
          stations: stations, res: res, opts: st.opts
        });
        panels.push(info);
        y = info.bottom + PANEL_GAP;
      });
    }

    /* ---- shared x-axis ruler under the last panel ---- */
    if (panels.length) {
      var ruler = el('g', { 'pointer-events': 'none' }, svg);
      var yr = y - PANEL_GAP + 3;
      el('line', { x1: PAD_L, y1: yr, x2: PAD_L + plotW, y2: yr, stroke: gridS, 'stroke-width': 1 }, ruler);
      var nTick = Math.max(2, Math.min(20, Math.round(plotW / 76)));
      var step = niceStep(L / nTick);
      for (var xt = 0; xt <= L + 1e-9; xt += step) {
        var pxr = X(Math.min(xt, L));
        el('line', { x1: pxr, y1: yr, x2: pxr, y2: yr + 4, stroke: gridS, 'stroke-width': 1 }, ruler);
        txt(ruler, pxr, yr + 14, fmtN(xt, U.len, 4), { 'font-size': 11.5, fill: ink3, 'text-anchor': 'middle' });
      }
      txt(ruler, PAD_L + plotW, yr + 26, 'x  [' + U.len.sym + ']',
        { 'font-size': 11.5, fill: ink3, 'text-anchor': 'end' });
      y = yr + 30;
    }

    var H = Math.max(y + 6, sceneBottom + 20);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    /* a literal stack (not a CSS variable) so PNG export keeps the type */
    svg.setAttribute('font-family',
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif');

    capture.setAttribute('height', H);

    var cross = el('g', { class: 'crosshair', 'pointer-events': 'none', visibility: 'hidden' }, svg);

    return {
      width: W, height: H, X: X, invX: invX,
      padL: PAD_L, padR: PAD_R, plotW: plotW,
      yBeam: yBeam, sceneBottom: sceneBottom,
      panels: panels, cross: cross, capture: capture, colors: COLORS
    };
  }

  /* ================================================================= */
  /*  one diagram panel                                                */
  /* ================================================================= */
  function drawPanel(svg, o) {
    var g = el('g', { class: 'panel-' + o.key }, svg);
    var top = o.top, plotTop = top + PANEL_TITLE, plotH = o.height;
    var bottom = plotTop + plotH;

    /* Value range, always including zero.  Only the side that actually
       carries data is padded, so a one-sided diagram uses its full height. */
    var lo = 0, hi = 0;
    o.data.forEach(function (p) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; });
    if (hi - lo < 1e-14) { hi = 1; lo = -1; }
    var span = hi - lo;
    lo -= span * (lo < -1e-12 ? 0.15 : 0.04);
    hi += span * (hi > 1e-12 ? 0.15 : 0.04);

    /* flip = -1 plots positive values downwards (moment on the tension side) */
    var flip = o.flip ? -1 : 1;
    var plo = flip > 0 ? lo : -hi;          /* plotted-space bottom */
    var phi = flip > 0 ? hi : -lo;          /* plotted-space top    */

    function Y(v) { return bottom - ((v * flip) - plo) / (phi - plo) * plotH; }

    var y0 = Y(0);
    var topValue = flip > 0 ? hi : lo;      /* real value drawn at the top */
    var botValue = flip > 0 ? lo : hi;

    /* ---- frame ---- */
    el('rect', { x: o.padL, y: plotTop, width: o.plotW, height: plotH,
                 fill: 'none', stroke: o.grid, 'stroke-width': 1 }, g);

    /* vertical guides at the supports */
    o.stations.forEach(function (x) {
      el('line', { x1: o.X(x), y1: plotTop, x2: o.X(x), y2: bottom,
                   stroke: o.grid, 'stroke-width': 1 }, g);
    });

    /* ---- filled area + curve ---- */
    var d = '', dl = '';
    o.data.forEach(function (p, i) {
      var px = o.X(p.x), py = Y(p.y);
      d += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2);
      dl += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2);
    });
    if (o.data.length) {
      var last = o.data[o.data.length - 1], first = o.data[0];
      d += 'L' + o.X(last.x).toFixed(2) + ',' + y0.toFixed(2) +
           'L' + o.X(first.x).toFixed(2) + ',' + y0.toFixed(2) + 'Z';
      el('path', { d: d, fill: o.color, 'fill-opacity': .17, stroke: 'none' }, g);
      el('path', { d: dl, fill: 'none', stroke: o.color, 'stroke-width': 2,
                   'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    }

    /* ---- zero axis ---- */
    el('line', { x1: o.padL, y1: y0, x2: o.padL + o.plotW, y2: y0,
                 stroke: o.ink3, 'stroke-width': 1.1, opacity: .85 }, g);

    /* ---- title ---- */
    var title = el('g', null, g);
    el('rect', { x: o.padL, y: top + 2, width: 9, height: 9, rx: 2.5, fill: o.color }, title);
    txt(title, o.padL + 14, top + 11, o.label + '  ' + o.sym,
      { 'font-size': 13.5, 'font-weight': 650, fill: o.ink });
    txt(title, o.padL + o.plotW, top + 11, '[' + o.unit.sym + ']',
      { 'font-size': 12.5, fill: o.ink3, 'text-anchor': 'end' });

    /* ---- axis value labels ---- */
    txt(g, o.padL - 7, plotTop + 9, fmtN(topValue, o.unit, 3),
      { 'font-size': 11.5, fill: o.ink3, 'text-anchor': 'end' });
    txt(g, o.padL - 7, bottom - 2, fmtN(botValue, o.unit, 3),
      { 'font-size': 11.5, fill: o.ink3, 'text-anchor': 'end' });
    /* the zero label is dropped when it would collide with an end label */
    if (y0 - plotTop > 15 && bottom - y0 > 15) {
      txt(g, o.padL - 7, y0 + 3.5, '0', { 'font-size': 11.5, fill: o.ink3, 'text-anchor': 'end' });
    }

    /* ---- extreme value annotations (direct labels, never every point) -- */
    function annotate(pt) {
      if (Math.abs(pt.y) < 1e-12) return;
      var px = o.X(pt.x), py = Y(pt.y);
      var above = py <= y0;
      el('circle', { cx: px, cy: py, r: 3.4, fill: o.color, stroke: o.surf, 'stroke-width': 1.6 }, g);
      var anchor = px > o.padL + o.plotW - 62 ? 'end' : (px < o.padL + 62 ? 'start' : 'middle');
      var t = txt(g, px, above ? py - 7 : py + 14, fmtN(pt.y, o.unit, 4),
        { 'font-size': 12.5, 'font-weight': 650, fill: o.ink, 'text-anchor': anchor });
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('stroke', o.surf);
      t.setAttribute('stroke-width', '3.5');
    }
    var ex = { min: null, max: null };
    o.data.forEach(function (p) {
      if (!ex.min || p.y < ex.min.y) ex.min = p;
      if (!ex.max || p.y > ex.max.y) ex.max = p;
    });
    if (ex.max) annotate(ex.max);
    if (ex.min && Math.abs(ex.min.y - (ex.max ? ex.max.y : 0)) > 1e-12) annotate(ex.min);

    return {
      key: o.key, color: o.color, unit: o.unit,
      top: top, plotTop: plotTop, bottom: bottom, y0: y0,
      Y: Y, lo: lo, hi: hi, flip: flip
    };
  }

  /* ================================================================= */
  /*  support symbols                                                  */
  /* ================================================================= */
  function drawSupport(g, x, yTop, s, ink, surf, muted, atEnd, beamH) {
    var t = s.type;
    var TRI = 13, HT = 17;
    atEnd = atEnd || 0;
    beamH = beamH || 14;

    function ground(w, yy) {
      el('line', { x1: x - w, y1: yy, x2: x + w, y2: yy, stroke: ink, 'stroke-width': 1.6 }, g);
      el('rect', { x: x - w, y: yy, width: 2 * w, height: 7, fill: 'url(#hatch)', stroke: 'none' }, g);
    }
    function tri() {
      el('path', { d: 'M' + x + ',' + yTop + ' L' + (x - TRI) + ',' + (yTop + HT) + ' L' + (x + TRI) + ',' + (yTop + HT) + ' Z',
                   fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
    }
    function wall(side) {
      /* vertical hatched wall for a fixed / horizontal-roller end */
      var w = 8, h = 26;
      el('line', { x1: x, y1: yTop - 14 - h / 2, x2: x, y2: yTop + h / 2 + 2, stroke: ink, 'stroke-width': 2 }, g);
      el('rect', { x: side > 0 ? x : x - w, y: yTop - 14 - h / 2, width: w, height: h + 16,
                   fill: 'url(#hatch)', stroke: 'none' }, g);
    }

    if (t === 'pin') { tri(); ground(TRI + 4, yTop + HT); }
    else if (t === 'roller') {
      tri();
      el('circle', { cx: x - 6, cy: yTop + HT + 4, r: 4, fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g);
      el('circle', { cx: x + 6, cy: yTop + HT + 4, r: 4, fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g);
      ground(TRI + 4, yTop + HT + 8);
    }
    else if (t === 'fixed') {
      if (atEnd) {
        /* classic hatched wall at the end of the beam */
        var hh = 26, yc = yTop - beamH / 2;
        el('line', { x1: x, y1: yc - hh, x2: x, y2: yc + hh, stroke: ink, 'stroke-width': 2.2 }, g);
        el('rect', { x: atEnd < 0 ? x - 9 : x, y: yc - hh, width: 9, height: 2 * hh, fill: 'url(#hatch)' }, g);
      } else {
        /* interior fixed support: hatched block under the beam */
        el('rect', { x: x - 15, y: yTop, width: 30, height: 8, fill: 'none', stroke: ink, 'stroke-width': 1.6 }, g);
        el('line', { x1: x - 15, y1: yTop + 8, x2: x + 15, y2: yTop + 8, stroke: ink, 'stroke-width': 1.8 }, g);
        el('rect', { x: x - 15, y: yTop + 8, width: 30, height: 8, fill: 'url(#hatch)' }, g);
      }
    }
    else if (t === 'guided') {
      el('rect', { x: x - 15, y: yTop + 3, width: 30, height: 4, fill: 'none', stroke: ink, 'stroke-width': 1.6 }, g);
      el('circle', { cx: x - 7, cy: yTop + 12, r: 4, fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g);
      el('circle', { cx: x + 7, cy: yTop + 12, r: 4, fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g);
      ground(17, yTop + 16);
    }
    else if (t === 'hroller') {
      el('circle', { cx: x, cy: yTop + 8, r: 5, fill: 'none', stroke: ink, 'stroke-width': 1.6 }, g);
      el('line', { x1: x - 12, y1: yTop + 15, x2: x + 12, y2: yTop + 15, stroke: ink, 'stroke-width': 1.6 }, g);
      ground(14, yTop + 15);
    }
    else if (t === 'spring') {
      var y1 = yTop + 2, y2 = yTop + 30, n = 5, w = 8, dstr = 'M' + x + ',' + y1;
      for (var i = 0; i < n; i++) {
        dstr += ' L' + (x + (i % 2 ? -w : w)) + ',' + (y1 + (y2 - y1) * (i + .5) / n);
      }
      dstr += ' L' + x + ',' + y2;
      el('path', { d: dstr, fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, g);
      ground(13, y2);
    }
    else if (t === 'rspring') {
      var sp = '', R0 = 2.2, turns = 2.6;
      for (var a = 0; a <= turns * Math.PI * 2; a += 0.22) {
        var rr = R0 + a * 1.25;
        var px = x + rr * Math.cos(a), py = yTop + 14 + rr * Math.sin(a);
        sp += (a === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2);
      }
      el('path', { d: sp, fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g);
      ground(15, yTop + 30);
    }

    /* generous invisible hit area */
    el('rect', { x: x - 18, y: yTop - 8, width: 36, height: 46, fill: 'transparent' }, g);
  }

  function clampPx(v, a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* a "nice" axis step (1, 2, 2.5 or 5 times a power of ten) */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    var mm = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return mm * p;
  }

  /* circular arrow: cw = clockwise */
  function arcArrow(g, cx, cy, r, cw, color, w) {
    var a0 = cw ? -140 : -40, a1 = cw ? 120 : 220;
    function pt(deg) {
      var a = deg * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    var p0 = pt(a0), p1 = pt(a1);
    var large = 1, sweep = cw ? 1 : 0;
    el('path', {
      d: 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
         ' A' + r + ',' + r + ' 0 ' + large + ' ' + sweep + ' ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2),
      fill: 'none', stroke: color, 'stroke-width': w || 2,
      'marker-end': 'url(#ah-load)', 'stroke-linecap': 'round'
    }, g);
  }

  /* ---- number helper bound to the loaded Units module ---- */
  function fmtN(si, u, sig) {
    return (typeof window !== 'undefined' && window.fmt ? window.fmt : fmtLocal)(si / u.f, sig || 4);
  }
  function fmtLocal(v, sig) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v);
    if (a < 1e-12) return '0';
    if (a >= 1e7 || a < 1e-4) return v.toExponential(2);
    var digits = Math.max(0, (sig || 3) - 1 - Math.floor(Math.log10(a)));
    var s = v.toFixed(Math.min(digits, 8));
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  return { draw: draw, el: el, txt: txt, drawSupport: drawSupport, arcArrow: arcArrow };
})();
