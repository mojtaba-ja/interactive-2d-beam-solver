'use strict';
/* =====================================================================
   app.js - state, editing, interaction, results and file I/O.
   The model is held in SI base units at all times; the unit system only
   changes what is displayed.
   ===================================================================== */

(function () {

  var $ = function (id) { return document.getElementById(id); };
  var SUP = BeamSolver.SUPPORTS;

  /* ------------------------------------------------------------ state */
  var state = null;
  var result = null;
  var scene = null;
  var hist = { stack: [], idx: -1 };
  var dragging = null;
  var hoverX = null;
  var hoverY = null;

  function U() { return Units[state.units]; }
  function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------- default model */
  function emptyModel(unitsId) {
    var u = Units[unitsId || 'SI'];
    return {
      units: u.id,
      beam: { L: u.defaults.L * u.len.f, E: u.defaults.E, I: u.defaults.I, A: u.defaults.A },
      supports: [],
      releases: [],
      loads: [],
      selection: null,
      sectionX: null,
      opts: {
        showN: true, showV: true, showM: true, showS: false, showD: true,
        bmdDown: false, showReactions: true, showDeflected: true,
        snap: false, snapStep: u.defaults.snap * u.len.f, forceN: false
      }
    };
  }

  function starter(unitsId) {
    var m = emptyModel(unitsId), u = Units[m.units];
    var L = m.beam.L;
    m.supports.push({ id: uid(), type: 'pin', x: 0, ky: 0, kr: 0, dy: 0, rz: 0 });
    m.supports.push({ id: uid(), type: 'roller', x: L, ky: 0, kr: 0, dy: 0, rz: 0 });
    m.loads.push({ id: uid(), kind: 'udl', a: 0, b: L, w1: 20 * u.dist.f, w2: 20 * u.dist.f, dir: 'y' });
    m.loads.push({ id: uid(), kind: 'point', x: L * 0.35, P: 40 * u.force.f, angle: 0 });
    return m;
  }

  /* =================================================================== */
  /*  history                                                            */
  /* =================================================================== */
  function snapshot() {
    var s = clone(state);
    delete s.selection; delete s.sectionX;
    return s;
  }
  function pushHistory() {
    var s = snapshot();
    if (hist.idx >= 0 && JSON.stringify(hist.stack[hist.idx]) === JSON.stringify(s)) return;
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(s);
    if (hist.stack.length > 120) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    updateHistButtons();
  }
  function restore(i) {
    if (i < 0 || i >= hist.stack.length) return;
    hist.idx = i;
    var keepSel = state.selection, keepSec = state.sectionX;
    state = Object.assign(clone(hist.stack[i]), { selection: keepSel, sectionX: keepSec });
    if (state.selection && !findObj(state.selection.kind, state.selection.id)) state.selection = null;
    updateHistButtons();
    refresh(true);
  }
  function updateHistButtons() {
    $('btnUndo').disabled = hist.idx <= 0;
    $('btnRedo').disabled = hist.idx >= hist.stack.length - 1;
  }

  /* =================================================================== */
  /*  object helpers                                                     */
  /* =================================================================== */
  function listOf(kind) {
    return kind === 'support' ? state.supports : kind === 'load' ? state.loads : state.releases;
  }
  function findObj(kind, id) {
    var l = listOf(kind);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function select(kind, id) {
    state.selection = (kind && id) ? { kind: kind, id: id } : null;
    refresh();
    if (kind) $('selDetails').open = true;
  }
  function removeSelected() {
    if (!state.selection) return;
    var l = listOf(state.selection.kind);
    var i = l.findIndex(function (o) { return o.id === state.selection.id; });
    if (i < 0) return;
    l.splice(i, 1);
    state.selection = null;
    pushHistory();
    refresh();
  }

  /* =================================================================== */
  /*  compute + render                                                   */
  /* =================================================================== */
  function refresh(skipHistory) {
    result = BeamSolver.analyze({
      L: state.beam.L, E: state.beam.E, I: state.beam.I, A: state.beam.A,
      supports: state.supports, releases: state.releases, loads: state.loads
    });
    drawStage();
    buildSidebar();
    buildResults();
    buildMessages();
    save();
  }

  function drawStage() {
    var svg = $('stage');
    var wrap = svg.parentNode;
    var w = wrap.clientWidth || 900;
    scene = Render.draw({ svg: svg, state: state, result: result, units: U(), width: w });
    drawSectionMarker();
    if (hoverX !== null) showCrosshair(hoverX);
  }

  /* =================================================================== */
  /*  sidebar                                                            */
  /* =================================================================== */
  function elh(tag, attrs, parent) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(n);
    return n;
  }

  /** numeric field bound to an SI value through a unit slot */
  function numField(parent, label, slot, get, set, opt) {
    opt = opt || {};
    var row = elh('div', { class: 'field wide' }, parent);
    elh('label', { text: label }, row);
    var inp = elh('input', { type: 'number', step: opt.step || 'any', value: fmtInput(get() / slot.f) }, row);
    elh('span', { class: 'unit', text: slot.sym }, row);
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      if (!isFinite(v)) return;
      set(v * slot.f);
      refreshLive();
    });
    inp.addEventListener('change', function () { pushHistory(); refresh(); });
    return inp;
  }

  function fmtInput(v) {
    if (!isFinite(v)) return '';
    var r = Math.round(v * 1e9) / 1e9;
    return String(r);
  }

  /* only redraw the picture and results, do not rebuild the inputs */
  function refreshLive() {
    result = BeamSolver.analyze({
      L: state.beam.L, E: state.beam.E, I: state.beam.I, A: state.beam.A,
      supports: state.supports, releases: state.releases, loads: state.loads
    });
    drawStage();
    buildResults();
    buildMessages();
    save();
  }

  var MATERIALS = [
    { n: 'Structural steel', E: 200e9 },
    { n: 'Aluminium', E: 69e9 },
    { n: 'Concrete (normal weight)', E: 25e9 },
    { n: 'Timber (softwood)', E: 11e9 }
  ];

  function buildSidebar() {
    /* ---------------- beam ---------------- */
    var p = $('beamPanel'); p.innerHTML = '';
    var lenBase = null;
    var lenInp = numField(p, 'Length L', U().len, function () { return state.beam.L; }, function (v) {
      state.beam.L = Math.max(v, 1e-6);
      if (lenBase) applyScale(lenBase, state.beam.L / lenBase.L);
    });
    lenInp.addEventListener('focus', function () { lenBase = positionSnapshot(); });
    lenInp.addEventListener('blur', function () { lenBase = null; });
    numField(p, 'Modulus E', U().E, function () { return state.beam.E; }, function (v) { state.beam.E = Math.max(v, 1e-9); });
    numField(p, 'Inertia I', U().I, function () { return state.beam.I; }, function (v) { state.beam.I = Math.max(v, 1e-18); });
    numField(p, 'Area A', U().A, function () { return state.beam.A; }, function (v) { state.beam.A = Math.max(v, 1e-12); });

    var mrow = elh('div', { class: 'field wide' }, p);
    elh('label', { text: 'Material' }, mrow);
    var msel = elh('select', {}, mrow);
    elh('option', { value: '', text: 'custom E…' }, msel);
    MATERIALS.forEach(function (m, i) {
      var o = elh('option', { value: i, text: m.n + '  (' + fmt(m.E / U().E.f, 3) + ' ' + U().E.sym + ')' }, msel);
      if (Math.abs(m.E - state.beam.E) < 1e-6 * m.E) o.selected = true;
    });
    elh('span', { class: 'unit', text: '' }, mrow);
    msel.addEventListener('change', function () {
      if (msel.value === '') return;
      state.beam.E = MATERIALS[+msel.value].E;
      pushHistory(); refresh();
    });
    elh('p', { class: 'hint', html: 'EI = <b>' + fmt(state.beam.E * state.beam.I / (U().force.f * U().len.f * U().len.f), 4) +
      ' ' + U().force.sym + '&middot;' + U().len.sym + '&sup2;</b>. Scientific notation such as <code>2e8</code> is accepted.' }, p);

    /* ---------------- supports ---------------- */
    var sp = $('supPanel'); sp.innerHTML = '';
    var bar = elh('div', { class: 'addbar' }, sp);
    [['pin', 'Pin'], ['roller', 'Roller'], ['fixed', 'Fixed'], ['guided', 'Guided'],
     ['hroller', 'H-roller'], ['spring', 'Spring'], ['rspring', 'Rot. spring']].forEach(function (t) {
      elh('button', { class: 'btn small', text: '+ ' + t[1], onclick: function () { addSupport(t[0]); } }, bar);
    });
    var sl = elh('div', { class: 'olist' }, sp);
    if (!state.supports.length) elh('div', { class: 'empty', text: 'No supports yet - add one above.' }, sl);
    state.supports.slice().sort(byX).forEach(function (s) {
      objRow(sl, 'support', s, SUP[s.type].label, 'x = ' + fmt(s.x / U().len.f, 4) + ' ' + U().len.sym);
    });

    /* ---------------- loads ---------------- */
    var lp = $('loadPanel'); lp.innerHTML = '';
    var lbar = elh('div', { class: 'addbar' }, lp);
    elh('button', { class: 'btn small', text: '+ Point load', onclick: function () { addLoad('point'); } }, lbar);
    elh('button', { class: 'btn small', text: '+ Moment', onclick: function () { addLoad('moment'); } }, lbar);
    elh('button', { class: 'btn small', text: '+ Distributed', onclick: function () { addLoad('udl'); } }, lbar);
    elh('button', { class: 'btn small', text: '+ Triangular', onclick: function () { addLoad('tri'); } }, lbar);
    elh('button', { class: 'btn small', text: '+ Axial line load', onclick: function () { addLoad('axial'); } }, lbar);
    elh('button', { class: 'btn small', text: '+ Distributed moment', onclick: function () { addLoad('dmoment'); } }, lbar);
    var ll = elh('div', { class: 'olist' }, lp);
    if (!state.loads.length) elh('div', { class: 'empty', text: 'No loads yet.' }, ll);
    state.loads.slice().sort(byX).forEach(function (ld) {
      objRow(ll, 'load', ld, loadTitle(ld), loadSub(ld));
    });

    /* ---------------- releases ---------------- */
    var rp = $('relPanel'); rp.innerHTML = '';
    var rbar = elh('div', { class: 'addbar' }, rp);
    elh('button', { class: 'btn small', text: '+ Internal hinge', onclick: function () { addRelease('moment'); } }, rbar);
    elh('button', { class: 'btn small', text: '+ Shear release', onclick: function () { addRelease('shear'); } }, rbar);
    var rl = elh('div', { class: 'olist' }, rp);
    if (!state.releases.length) elh('div', { class: 'empty', text: 'None. A hinge forces M = 0 at that section.' }, rl);
    state.releases.slice().sort(byX).forEach(function (r) {
      objRow(rl, 'release', r, r.type === 'moment' ? 'Internal hinge' : 'Shear release',
        'x = ' + fmt(r.x / U().len.f, 4) + ' ' + U().len.sym);
    });

    buildSelection();
    buildDisplay();
    buildQuickTogs();
  }

  function byX(a, b) { return (a.x !== undefined ? a.x : a.a) - (b.x !== undefined ? b.x : b.a); }

  function loadTitle(ld) {
    if (ld.kind === 'point') return 'Point load';
    if (ld.kind === 'moment') return 'Moment';
    if (ld.kind === 'dmoment') return 'Distributed moment';
    if (ld.kind === 'udl') {
      if ((ld.dir || 'y') === 'x') return 'Axial line load';
      return (ld.w1 === ld.w2) ? 'Uniform load' : (ld.w1 === 0 || ld.w2 === 0 ? 'Triangular load' : 'Trapezoidal load');
    }
    return ld.kind;
  }
  function loadSub(ld) {
    var u = U();
    if (ld.kind === 'point') return fmt(ld.P / u.force.f, 4) + ' ' + u.force.sym + '  @ x = ' + fmt(ld.x / u.len.f, 4);
    if (ld.kind === 'moment') return fmt(ld.M / u.mom.f, 4) + ' ' + u.mom.sym + '  @ x = ' + fmt(ld.x / u.len.f, 4);
    if (ld.kind === 'dmoment') return fmt(ld.m1 / u.distM.f, 3) + '…' + fmt(ld.m2 / u.distM.f, 3) + ' ' + u.distM.sym;
    var s = u.dist;
    return fmt(ld.w1 / s.f, 3) + (ld.w1 === ld.w2 ? '' : '…' + fmt(ld.w2 / s.f, 3)) + ' ' + s.sym +
      '  [' + fmt(ld.a / u.len.f, 3) + ', ' + fmt(ld.b / u.len.f, 3) + ']';
  }

  function objRow(parent, kind, obj, title, sub) {
    var sel = state.selection && state.selection.kind === kind && state.selection.id === obj.id;
    var row = elh('div', { class: 'oitem' + (sel ? ' sel' : ''), onclick: function (e) {
      if (e.target.classList.contains('x')) return;
      select(kind, obj.id);
    } }, parent);
    var gl = elh('div', { class: 'glyph' }, row);
    gl.innerHTML = glyph(kind, obj);
    elh('div', { class: 'txt', html: '<b>' + title + '</b> <span class="dim">' + sub + '</span>' }, row);
    elh('button', { class: 'x', text: '×', title: 'Delete', onclick: function (e) {
      e.stopPropagation();
      var l = listOf(kind), i = l.indexOf(obj);
      if (i >= 0) l.splice(i, 1);
      if (sel) state.selection = null;
      pushHistory(); refresh();
    } }, row);
  }

  function glyph(kind, obj) {
    var s = 'width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"';
    if (kind === 'support') {
      if (obj.type === 'fixed') return '<svg ' + s + '><path d="M3 3v10M3 8h10"/></svg>';
      if (obj.type === 'roller') return '<svg ' + s + '><path d="M8 3l5 7H3z"/><circle cx="8" cy="13" r="1.6"/></svg>';
      if (obj.type === 'spring') return '<svg ' + s + '><path d="M8 2v2l-4 2 8 3-8 2 4 2v1"/></svg>';
      if (obj.type === 'rspring') return '<svg ' + s + '><path d="M8 8a2 2 0 1 1 2 2 4 4 0 1 1-4-4"/></svg>';
      if (obj.type === 'guided') return '<svg ' + s + '><path d="M3 5h10M3 11h10"/></svg>';
      if (obj.type === 'hroller') return '<svg ' + s + '><path d="M12 3v10"/><circle cx="7" cy="8" r="2"/></svg>';
      return '<svg ' + s + '><path d="M8 3l5 8H3z"/><path d="M2 13h12"/></svg>';
    }
    if (kind === 'release') return '<svg ' + s + '><circle cx="8" cy="8" r="3"/><path d="M1 8h4M11 8h4"/></svg>';
    if (obj.kind === 'moment' || obj.kind === 'dmoment')
      return '<svg ' + s + '><path d="M12 8a4 4 0 1 0-1.5 3.1"/><path d="M13 5l-1 3 3-.6"/></svg>';
    if (obj.kind === 'udl')
      return '<svg ' + s + '><path d="M2 3h12M4 3v6M8 3v6M12 3v6M2 12h12"/></svg>';
    return '<svg ' + s + '><path d="M8 2v9M5 8l3 3 3-3M2 14h12"/></svg>';
  }

  /* ------------------------------------------------- selected object */
  function buildSelection() {
    var p = $('selPanel'); p.innerHTML = '';
    if (!state.selection) {
      elh('p', { class: 'hint', text: 'Click an object in the drawing or in a list above to edit it. Drag it along the beam to move it, or type an exact position here. Hold Alt while dragging to ignore the snap grid if you have switched it on.' }, p);
      return;
    }
    var kind = state.selection.kind;
    var o = findObj(kind, state.selection.id);
    if (!o) { state.selection = null; return buildSelection(); }
    var u = U(), L = state.beam.L;

    var head = elh('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' }, p);
    elh('b', { text: kind === 'support' ? SUP[o.type].label + ' support' : kind === 'release' ? (o.type === 'moment' ? 'Internal hinge' : 'Shear release') : loadTitle(o) }, head);
    elh('span', { style: 'flex:1' }, head);
    elh('button', { class: 'btn small danger', text: 'Delete', onclick: removeSelected }, head);

    if (kind === 'support') {
      var trow = elh('div', { class: 'field wide' }, p);
      elh('label', { text: 'Type' }, trow);
      var sel = elh('select', {}, trow);
      Object.keys(SUP).forEach(function (t) {
        var op = elh('option', { value: t, text: SUP[t].label }, sel);
        if (t === o.type) op.selected = true;
      });
      elh('span', { class: 'unit', text: '' }, trow);
      sel.addEventListener('change', function () { o.type = sel.value; pushHistory(); refresh(); });

      numField(p, 'Position x', u.len, function () { return o.x; }, function (v) { o.x = clamp(v, 0, L); });
      numField(p, 'Settlement', u.small, function () { return o.dy || 0; }, function (v) { o.dy = v; });
      numField(p, 'Imposed rotation', u.slope, function () { return o.rz || 0; }, function (v) { o.rz = v; });
      if (o.type === 'spring' || !SUP[o.type].fixV)
        numField(p, 'Spring k', u.k, function () { return o.ky || 0; }, function (v) { o.ky = Math.max(0, v); });
      if (o.type === 'rspring' || !SUP[o.type].fixR)
        numField(p, 'Rot. spring kᵣ', u.kr, function () { return o.kr || 0; }, function (v) { o.kr = Math.max(0, v); });
      elh('p', { class: 'hint', text: restraintText(o) }, p);

    } else if (kind === 'release') {
      numField(p, 'Position x', u.len, function () { return o.x; }, function (v) { o.x = clamp(v, 0, L); });
      elh('p', { class: 'hint', text: o.type === 'moment'
        ? 'A hinge transmits shear and axial force but no bending moment: M = 0 at this section.'
        : 'A shear release transmits bending moment but no shear force: V = 0 at this section.' }, p);

    } else if (o.kind === 'point') {
      numField(p, 'Magnitude P', u.force, function () { return o.P; }, function (v) { o.P = v; });
      numField(p, 'Position x', u.len, function () { return o.x; }, function (v) { o.x = clamp(v, 0, L); });
      numField(p, 'Angle from vertical', { sym: '°', f: 1 }, function () { return o.angle || 0; }, function (v) { o.angle = v; });
      elh('p', { class: 'hint', text: 'Positive P acts downward. The angle tilts the load toward +x; 90° is a purely horizontal load.' }, p);

    } else if (o.kind === 'moment') {
      numField(p, 'Magnitude M', u.mom, function () { return o.M; }, function (v) { o.M = v; });
      numField(p, 'Position x', u.len, function () { return o.x; }, function (v) { o.x = clamp(v, 0, L); });
      elh('p', { class: 'hint', text: 'Positive M is clockwise.' }, p);

    } else if (o.kind === 'udl') {
      var isX = (o.dir || 'y') === 'x';
      var slot = isX ? u.dist : u.dist;
      numField(p, isX ? 'Intensity at a' : 'w at a', slot, function () { return o.w1; }, function (v) { o.w1 = v; });
      numField(p, isX ? 'Intensity at b' : 'w at b', slot, function () { return o.w2; }, function (v) { o.w2 = v; });
      numField(p, 'Start a', u.len, function () { return o.a; }, function (v) { o.a = clamp(v, 0, L); });
      numField(p, 'End b', u.len, function () { return o.b; }, function (v) { o.b = clamp(v, 0, L); });
      var drow = elh('div', { class: 'field wide' }, p);
      elh('label', { text: 'Direction' }, drow);
      var dsel = elh('select', {}, drow);
      [['y', 'Transverse (down +)'], ['x', 'Axial (right +)']].forEach(function (d) {
        var op = elh('option', { value: d[0], text: d[1] }, dsel);
        if (d[0] === (o.dir || 'y')) op.selected = true;
      });
      elh('span', { class: 'unit', text: '' }, drow);
      dsel.addEventListener('change', function () { o.dir = dsel.value; pushHistory(); refresh(); });
      var q = elh('div', { class: 'addbar', style: 'margin-top:8px' }, p);
      elh('button', { class: 'btn small', text: 'Span whole beam', onclick: function () { o.a = 0; o.b = L; pushHistory(); refresh(); } }, q);
      elh('button', { class: 'btn small', text: 'Make uniform', onclick: function () { o.w2 = o.w1; pushHistory(); refresh(); } }, q);
      var tot = 0.5 * (o.w1 + o.w2) * (o.b - o.a);
      elh('p', { class: 'hint', html: 'Resultant = <b>' + fmt(tot / u.force.f, 4) + ' ' + u.force.sym + '</b>' }, p);

    } else if (o.kind === 'dmoment') {
      numField(p, 'm at a', u.distM, function () { return o.m1; }, function (v) { o.m1 = v; });
      numField(p, 'm at b', u.distM, function () { return o.m2; }, function (v) { o.m2 = v; });
      numField(p, 'Start a', u.len, function () { return o.a; }, function (v) { o.a = clamp(v, 0, L); });
      numField(p, 'End b', u.len, function () { return o.b; }, function (v) { o.b = clamp(v, 0, L); });
      elh('p', { class: 'hint', text: 'Positive m is clockwise per unit length.' }, p);
    }
  }

  function restraintText(s) {
    var d = SUP[s.type], r = [];
    if (d.fixU) r.push('horizontal');
    if (d.fixV) r.push('vertical');
    if (d.fixR) r.push('rotation');
    if (!d.fixV && s.ky > 0) r.push('vertical spring');
    if (!d.fixR && s.kr > 0) r.push('rotational spring');
    return r.length ? 'Restrains: ' + r.join(', ') + '.' : 'This support currently restrains nothing - give it a spring stiffness.';
  }

  /* ------------------------------------------------- display options */
  function buildDisplay() {
    var p = $('dispPanel'); p.innerHTML = '';
    var o = state.opts;
    function check(label, key, cb) {
      var lab = elh('label', { class: 'tog', style: 'display:flex;margin:3px 0' }, p);
      var i = elh('input', { type: 'checkbox' }, lab);
      i.checked = !!o[key];
      elh('span', { text: label }, lab);
      i.addEventListener('change', function () { o[key] = i.checked; if (cb) cb(); refresh(); });
    }
    check('Bending moment drawn on the tension side (positive down)', 'bmdDown');
    check('Show reaction arrows on the beam', 'showReactions');
    check('Show the deflected shape on the beam', 'showDeflected');
    check('Always show the axial force diagram', 'forceN');
    check('Snap positions to a grid', 'snap');
    numField(p, 'Snap step', U().len, function () { return state.opts.snapStep; },
      function (v) { state.opts.snapStep = Math.max(v, 1e-6); });
    elh('p', { class: 'hint', text: 'Snapping is off by default, so objects drag freely. Tick it to make positions land on the step above - 0.01 keeps the numbers clean, 0.25 or 0.5 places things on round values. Hold Alt while dragging to bypass it; arrow keys nudge by one step, Shift by five.' }, p);
  }

  function buildQuickTogs() {
    var host = $('quickTogs'); host.innerHTML = '';
    [['showV', 'Shear V', '--c-shear'], ['showM', 'Moment M', '--c-moment'],
     ['showS', 'Slope θ', '--c-slope'], ['showD', 'Deflection v', '--c-defl'],
     ['showN', 'Axial N', '--c-axial']].forEach(function (t) {
      var lab = elh('label', { class: 'tog' }, host);
      var i = elh('input', { type: 'checkbox' }, lab);
      i.checked = !!state.opts[t[0]];
      var sw = elh('span', { class: 'sw' }, lab);
      sw.style.background = 'var(' + t[2] + ')';
      elh('span', { text: t[1] }, lab);
      i.addEventListener('change', function () { state.opts[t[0]] = i.checked; refresh(); });
    });
  }

  /* =================================================================== */
  /*  add / scale objects                                                */
  /* =================================================================== */
  function freeX() {
    /* a sensible spot for a new object: the middle of the largest gap */
    var xs = [0, state.beam.L];
    state.supports.forEach(function (s) { xs.push(s.x); });
    state.loads.forEach(function (l) { xs.push(l.x !== undefined ? l.x : (l.a + l.b) / 2); });
    xs.sort(function (a, b) { return a - b; });
    var best = state.beam.L / 2, gap = -1;
    for (var i = 0; i < xs.length - 1; i++) {
      if (xs[i + 1] - xs[i] > gap) { gap = xs[i + 1] - xs[i]; best = (xs[i] + xs[i + 1]) / 2; }
    }
    return snap(best);
  }
  function addSupport(type) {
    var x = state.supports.length === 0 ? 0 : (state.supports.length === 1 ? state.beam.L : freeX());
    var s = { id: uid(), type: type, x: x, ky: 0, kr: 0, dy: 0, rz: 0 };
    if (type === 'spring') s.ky = 1e7;
    if (type === 'rspring') s.kr = 1e7;
    state.supports.push(s);
    state.selection = { kind: 'support', id: s.id };
    pushHistory(); refresh();
  }
  function addLoad(what) {
    var u = U(), L = state.beam.L, ld;
    if (what === 'point') ld = { id: uid(), kind: 'point', x: freeX(), P: 25 * u.force.f, angle: 0 };
    else if (what === 'moment') ld = { id: uid(), kind: 'moment', x: freeX(), M: 20 * u.mom.f };
    else if (what === 'udl') ld = { id: uid(), kind: 'udl', a: 0, b: L, w1: 10 * u.dist.f, w2: 10 * u.dist.f, dir: 'y' };
    else if (what === 'tri') ld = { id: uid(), kind: 'udl', a: 0, b: L, w1: 0, w2: 15 * u.dist.f, dir: 'y' };
    else if (what === 'axial') ld = { id: uid(), kind: 'udl', a: 0, b: L, w1: 5 * u.dist.f, w2: 5 * u.dist.f, dir: 'x' };
    else ld = { id: uid(), kind: 'dmoment', a: L * 0.25, b: L * 0.75, m1: 5 * u.distM.f, m2: 5 * u.distM.f };
    state.loads.push(ld);
    state.selection = { kind: 'load', id: ld.id };
    pushHistory(); refresh();
  }
  function addRelease(type) {
    var r = { id: uid(), x: freeX(), type: type };
    state.releases.push(r);
    state.selection = { kind: 'release', id: r.id };
    pushHistory(); refresh();
  }
  /* Positions are scaled with the span from the values captured when the
     length field was focused, so intermediate keystrokes cannot lose them. */
  function positionSnapshot() {
    return {
      L: state.beam.L,
      sup: state.supports.map(function (s) { return s.x; }),
      rel: state.releases.map(function (r) { return r.x; }),
      loads: state.loads.map(function (l) { return { x: l.x, a: l.a, b: l.b }; })
    };
  }
  function applyScale(base, k) {
    if (!isFinite(k) || k <= 0) return;
    var L = state.beam.L;
    state.supports.forEach(function (s, i) { if (base.sup[i] !== undefined) s.x = clamp(base.sup[i] * k, 0, L); });
    state.releases.forEach(function (r, i) { if (base.rel[i] !== undefined) r.x = clamp(base.rel[i] * k, 0, L); });
    state.loads.forEach(function (l, i) {
      var b = base.loads[i]; if (!b) return;
      if (l.x !== undefined && b.x !== undefined) l.x = clamp(b.x * k, 0, L);
      if (l.a !== undefined && b.a !== undefined) { l.a = clamp(b.a * k, 0, L); l.b = clamp(b.b * k, 0, L); }
    });
  }
  function snap(x) {
    if (!state.opts.snap) return x;
    var s = state.opts.snapStep;
    if (!(s > 0)) return x;
    return clamp(Math.round(x / s) * s, 0, state.beam.L);
  }

  /* =================================================================== */
  /*  results                                                            */
  /* =================================================================== */
  function buildResults() {
    var u = U();
    var rb = $('reactBox'); rb.innerHTML = '';
    var sb = $('sumBox'); sb.innerHTML = '';
    var xb = $('sectionBox'); xb.innerHTML = '';

    if (!result || !result.ok) {
      elh('p', { class: 'empty', text: 'No results - fix the model first.' }, rb);
      elh('p', { class: 'empty', text: '–' }, sb);
      elh('p', { class: 'empty', text: '–' }, xb);
      return;
    }

    /* ---- reactions ---- */
    var scroller = elh('div', { style: 'overflow-x:auto' }, rb);
    var t = elh('table', { class: 'data' }, scroller);
    var th = elh('thead', {}, t), hr = elh('tr', {}, th);
    ['Support', 'x', 'Rx', 'Ry', 'M', 'δ'].forEach(function (h) { elh('th', { text: h }, hr); });
    var unitRow = elh('tr', {}, th);
    ['', u.len.sym, u.force.sym, u.force.sym, u.mom.sym, u.defl.sym].forEach(function (h) {
      elh('th', { text: h, style: 'font-weight:400;text-transform:none;letter-spacing:0;padding-top:0;color:var(--text-muted)' }, unitRow);
    });
    var tb = elh('tbody', {}, t);
    result.reactions.slice().sort(function (a, b) { return a.x - b.x; }).forEach(function (R) {
      var tr = elh('tr', { style: 'cursor:pointer', onclick: function () { select('support', R.support.id); } }, tb);
      elh('td', { text: SUP[R.type].label }, tr);
      elh('td', { class: 'num', text: fmt(R.x / u.len.f, 4) }, tr);
      elh('td', { class: 'num', text: Math.abs(R.Rx) < 1e-9 ? '–' : fmt(R.Rx / u.force.f, 4) }, tr);
      elh('td', { class: 'num', text: fmt(R.Ry / u.force.f, 4) }, tr);
      elh('td', { class: 'num', text: Math.abs(R.Mz) < 1e-9 ? '–' : fmt(R.Mz / u.mom.f, 4) }, tr);
      elh('td', { class: 'num', text: fmt(-R.dy / u.defl.f, 4) }, tr);
    });
    var tot = result.reactions.reduce(function (a, R) { return a + R.Ry; }, 0);
    elh('p', { class: 'hint', html: 'Ry is positive upward, M positive counter-clockwise, δ positive upward. ' +
      'Sum of vertical reactions = <b>' + fmt(tot / u.force.f, 4) + ' ' + u.force.sym + '</b>.' }, rb);

    /* ---- summary ---- */
    var e = result.extrema;
    var dl = elh('dl', { class: 'kv' }, sb);
    function kv(k, v) { elh('dt', { html: k }, dl); elh('dd', { html: v }, dl); }
    function at(p, slot) {
      return '<b>' + fmt(p.y / slot.f, 4) + '</b> ' + slot.sym +
        ' <span style="color:var(--text-muted);font-weight:400">at x = ' + fmt(p.x / u.len.f, 4) + ' ' + u.len.sym + '</span>';
    }
    kv('Max shear |V|', at(e.V.absMax, u.force));
    kv('Max positive moment', e.M.max.y > 1e-9 ? at(e.M.max, u.mom) : '<span style="color:var(--text-muted);font-weight:400">none (no sagging)</span>');
    kv('Max negative moment', e.M.min.y < -1e-9 ? at(e.M.min, u.mom) : '<span style="color:var(--text-muted);font-weight:400">none (no hogging)</span>');
    kv('Max deflection', at(e.D.absMax, u.defl));
    var dmax = Math.abs(e.D.absMax.y);
    kv('Span / deflection', dmax > 1e-15 ? 'L / ' + fmt(state.beam.L / dmax, 4) : '–');
    kv('Max slope', at(e.S.absMax, u.slope));
    if (result.hasAxial || state.opts.forceN) kv('Max axial |N|', at(e.N.absMax, u.force));

    var badges = elh('div', { class: 'chips', style: 'margin-top:10px' }, sb);
    var deg = result.indeterminacy;
    elh('span', { class: 'badge ' + (deg === 0 ? 'neutral' : 'neutral'),
      text: deg === 0 ? 'Statically determinate' : deg > 0 ? 'Statically indeterminate to degree ' + deg : 'Unstable / under-restrained (' + deg + ')' }, badges);
    elh('span', { class: 'badge ' + (result.equilibrium.ok ? 'good' : 'bad'),
      text: result.equilibrium.ok ? 'Equilibrium check passed' : 'Equilibrium check FAILED' }, badges);
    result.zeroShear.slice(0, 4).forEach(function (z) {
      elh('span', { class: 'badge neutral', text: 'V = 0 at x = ' + fmt(z.x / u.len.f, 4) + ' ' + u.len.sym }, badges);
    });

    /* ---- section values ---- */
    var L = state.beam.L;
    if (state.sectionX === null || state.sectionX === undefined) state.sectionX = L / 2;
    var row = elh('div', { class: 'field wide' }, xb);
    elh('label', { text: 'Section x' }, row);
    var inp = elh('input', { type: 'number', step: 'any', value: fmtInput(state.sectionX / u.len.f) }, row);
    elh('span', { class: 'unit', text: u.len.sym }, row);
    var rng = elh('input', { type: 'range', min: 0, max: 1000, value: Math.round(state.sectionX / L * 1000) }, xb);
    function setX(v) {
      state.sectionX = clamp(v, 0, L);
      inp.value = fmtInput(state.sectionX / u.len.f);
      rng.value = Math.round(state.sectionX / L * 1000);
      fillSectionTable();
      drawSectionMarker();
    }
    inp.addEventListener('input', function () { var v = parseFloat(inp.value); if (isFinite(v)) setX(v * u.len.f); });
    rng.addEventListener('input', function () { setX(+rng.value / 1000 * L); });

    var box = elh('div', {}, xb);
    function fillSectionTable() {
      box.innerHTML = '';
      var v = result.valuesAt(state.sectionX);
      var tt = elh('table', { class: 'data' }, box);
      var tbb = elh('tbody', {}, tt);
      function r2(label, a, b, slot) {
        var tr = elh('tr', {}, tbb);
        elh('td', { html: label }, tr);
        if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))) {
          elh('td', { class: 'num', text: fmt(a / slot.f, 4) + '  |  ' + fmt(b / slot.f, 4) }, tr);
        } else {
          elh('td', { class: 'num', text: fmt(a / slot.f, 4) }, tr);
        }
        elh('td', { text: slot.sym, style: 'color:var(--text-muted);text-align:left;width:1%' }, tr);
      }
      r2('Shear V', v.Vl, v.Vr, u.force);
      r2('Moment M', v.Ml, v.Mr, u.mom);
      if (result.hasAxial || state.opts.forceN) r2('Axial N', v.Nl, v.Nr, u.force);
      r2('Slope θ', v.slope, v.slope, u.slope);
      r2('Deflection v', v.defl, v.defl, u.defl);
      r2('Load intensity w', v.w, v.w, u.dist);
      elh('p', { class: 'hint', text: 'Where two numbers are shown they are the values just left and just right of the section.' }, box);
    }
    fillSectionTable();
  }

  function buildMessages() {
    var host = $('msgs'); host.innerHTML = '';
    if (!result) return;
    if (!result.ok) {
      elh('div', { class: 'note err', html: '<b>Cannot solve:</b> ' + result.error }, host);
      return;
    }
    (result.warnings || []).forEach(function (w) {
      elh('div', { class: 'note', text: w }, host);
    });
    if (!result.equilibrium.ok) {
      elh('div', { class: 'note err', text: 'Internal check: the computed reactions do not satisfy global equilibrium. Please report this model.' }, host);
    }
  }

  /* =================================================================== */
  /*  crosshair / hover                                                  */
  /* =================================================================== */
  function showCrosshair(x) {
    if (!scene || !result || !result.ok) return;
    var g = scene.cross;
    while (g.firstChild) g.removeChild(g.firstChild);
    g.setAttribute('visibility', 'visible');
    var px = scene.X(x);
    var top = scene.yBeam - 40;
    var bot = scene.panels.length ? scene.panels[scene.panels.length - 1].bottom : scene.sceneBottom;
    Render.el('line', { x1: px, y1: top, x2: px, y2: bot, stroke: cssv('--text-muted'),
      'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: .9 }, g);
    var surf = cssv('--surface-1');
    scene.panels.forEach(function (p) {
      var v = seriesValue(p.key, x);
      var py = p.Y(v);
      Render.el('circle', { cx: px, cy: py, r: 3.6, fill: p.color, stroke: surf, 'stroke-width': 1.6 }, g);
    });
    showTip(x, px, hoverY);
  }
  function hideCrosshair() {
    if (scene) scene.cross.setAttribute('visibility', 'hidden');
    $('tip').classList.remove('on');
  }
  function seriesValue(key, x) {
    if (key === 'V') return result.shearAt(x, 1);
    if (key === 'M') return result.momentAt(x, 1);
    if (key === 'N') return result.axialAt(x, 1);
    if (key === 'S') return result.slopeAt(x);
    return result.deflAt(x);
  }

  function showTip(x, px, clientY) {
    var u = U(), tip = $('tip');
    var v = result.valuesAt(x);
    var rows = '';
    function row(color, name, val, slot, val2) {
      var s = fmt(val / slot.f, 4);
      if (val2 !== undefined && Math.abs(val - val2) > 1e-9 * Math.max(1, Math.abs(val)))
        s = fmt(val2 / slot.f, 4) + ' | ' + s;
      rows += '<tr><td><span class="sw" style="background:' + color + '"></span>' + name +
        '</td><td>' + s + ' <span style="color:var(--text-muted);font-weight:400">' + slot.sym + '</span></td></tr>';
    }
    if (state.opts.showN && (result.hasAxial || state.opts.forceN)) row('var(--c-axial)', 'N', v.Nr, u.force, v.Nl);
    if (state.opts.showV) row('var(--c-shear)', 'V', v.Vr, u.force, v.Vl);
    if (state.opts.showM) row('var(--c-moment)', 'M', v.Mr, u.mom, v.Ml);
    if (state.opts.showS) row('var(--c-slope)', 'θ', v.slope, u.slope);
    if (state.opts.showD) row('var(--c-defl)', 'v', v.defl, u.defl);
    tip.innerHTML = '<div class="th">x = ' + fmt(x / u.len.f, 4) + ' ' + u.len.sym + '</div><table>' + rows + '</table>';
    tip.classList.add('on');
    var wrap = $('stage').parentNode;
    var rect = wrap.getBoundingClientRect();
    var sc = wrap.clientWidth / scene.width;
    var left = px * sc + 16;
    if (left + tip.offsetWidth > wrap.clientWidth - 6) left = px * sc - tip.offsetWidth - 16;
    tip.style.left = Math.max(4, left) + 'px';
    var top = 18;
    if (clientY !== null && clientY !== undefined) {
      top = clientY - rect.top + 14;
      top = Math.max(4, Math.min(top, wrap.clientHeight - tip.offsetHeight - 6));
    }
    tip.style.top = top + 'px';
  }

  function drawSectionMarker() {
    var svg = $('stage');
    var old = svg.querySelector('.sectionmark');
    if (old) old.remove();
    if (!scene || !result || !result.ok || state.sectionX === null || state.sectionX === undefined) return;
    var g = Render.el('g', { 'pointer-events': 'none', class: 'sectionmark' }, svg);
    var px = scene.X(state.sectionX);
    var bot = scene.panels.length ? scene.panels[scene.panels.length - 1].bottom : scene.sceneBottom;
    var acc = cssv('--accent');
    Render.el('line', { x1: px, y1: scene.yBeam - 30, x2: px, y2: bot,
      stroke: acc, 'stroke-width': 1.2, 'stroke-dasharray': '2 4', opacity: .85 }, g);
    Render.el('path', { d: 'M' + (px - 5) + ',' + (scene.yBeam - 34) + ' L' + (px + 5) + ',' + (scene.yBeam - 34) +
      ' L' + px + ',' + (scene.yBeam - 26) + ' Z', fill: acc }, g);
  }

  /* =================================================================== */
  /*  pointer interaction                                                */
  /* =================================================================== */
  function svgX(evt) {
    var svg = $('stage'), r = svg.getBoundingClientRect();
    return (evt.clientX - r.left) / r.width * scene.width;
  }
  function modelX(evt, useSnap) {
    var x = scene.invX(svgX(evt));
    return clamp(useSnap ? snap(x) : x, 0, state.beam.L);
  }

  function initStage() {
    var svg = $('stage');
    var lastTap = { t: -1e9, x: 0, y: 0 }, lastAdd = { t: -1e9, x: 0, y: 0 };

    /* Adding a point load is driven from pointerdown, not from `dblclick`:
       the first click re-renders the scene, so mousedown and mouseup land on
       different nodes and the browser never synthesises click/dblclick. */
    function addPointLoadAt(e) {
      /* the native dblclick, when it does arrive, repeats the gesture we have
         already served from pointerdown - same spot, a few ms later */
      if (e.timeStamp - lastAdd.t < 400 &&
          Math.abs(e.clientX - lastAdd.x) < 6 && Math.abs(e.clientY - lastAdd.y) < 6) return;
      lastAdd = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      var ld = { id: uid(), kind: 'point', x: modelX(e, true), P: 25 * U().force.f, angle: 0 };
      state.loads.push(ld);
      state.selection = { kind: 'load', id: ld.id };
      pushHistory(); refresh();
      toast('Point load added - double-click the beam to add more');
    }

    svg.addEventListener('pointerdown', function (e) {
      var t = e.target.closest ? e.target.closest('[data-kind]') : null;
      if (!t) {
        /* clicking empty space (or a diagram): move the section marker */
        var px0 = svgX(e);
        if (px0 >= scene.padL && px0 <= scene.padL + scene.plotW) {
          var ts0 = e.timeStamp;
          if (ts0 - lastTap.t < 450 &&
              Math.abs(e.clientX - lastTap.x) < 6 && Math.abs(e.clientY - lastTap.y) < 6) {
            lastTap.t = -1e9;
            addPointLoadAt(e);
            return;
          }
          lastTap = { t: ts0, x: e.clientX, y: e.clientY };
          state.sectionX = modelX(e, false);
          state.selection = null;
          refresh();
        }
        return;
      }
      var kind = t.getAttribute('data-kind');
      if (kind === 'beam') { state.selection = null; refresh(); return; }
      var id = t.getAttribute('data-id');
      var handle = t.getAttribute('data-handle') || 'body';
      var obj = findObj(kind, id);
      if (!obj) return;
      state.selection = { kind: kind, id: id };
      var raw0 = clamp(scene.invX(svgX(e)), 0, state.beam.L);
      dragging = {
        kind: kind, id: id, handle: handle,
        startX: raw0,
        offset: raw0 - (obj.x !== undefined ? obj.x : obj.a),
        orig: clone(obj), moved: false
      };
      svg.setPointerCapture(e.pointerId);
      refresh();
      e.preventDefault();
    });

    svg.addEventListener('pointermove', function (e) {
      if (dragging) {
        var obj = findObj(dragging.kind, dragging.id);
        if (!obj) return;
        var useSnap = !e.altKey;
        var L = state.beam.L;
        var raw = clamp(scene.invX(svgX(e)), 0, L);
        if (dragging.handle === 'a') {
          obj.a = clamp(Math.min(useSnap ? snap(raw) : raw, obj.b), 0, L);
        } else if (dragging.handle === 'b') {
          obj.b = clamp(Math.max(useSnap ? snap(raw) : raw, obj.a), 0, L);
        } else if (obj.a !== undefined) {
          var w = dragging.orig.b - dragging.orig.a;
          var na = raw - dragging.offset;
          if (useSnap) na = snap(na);
          na = clamp(na, 0, Math.max(0, L - w));
          obj.a = na; obj.b = Math.min(na + w, L);
        } else {
          var nx = raw - dragging.offset;
          obj.x = clamp(useSnap ? snap(nx) : nx, 0, L);
        }
        dragging.moved = true;
        refreshLive();
        buildSelection();
        return;
      }
      if (!scene) return;
      var px = svgX(e);
      if (px >= scene.padL - 2 && px <= scene.padL + scene.plotW + 2) {
        hoverX = clamp(scene.invX(px), 0, state.beam.L);
        hoverY = e.clientY;
        showCrosshair(hoverX);
      } else { hoverX = null; hoverY = null; hideCrosshair(); }
    });

    function endDrag(e) {
      if (dragging) {
        if (dragging.moved) { pushHistory(); refresh(); }
        dragging = null;
      }
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', function () { hoverX = null; hoverY = null; hideCrosshair(); });

    /* kept for the cases where the browser does deliver a dblclick;
       addPointLoadAt() de-duplicates against the pointerdown path */
    svg.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('[data-kind]')) return;
      var pxd = svgX(e);
      if (pxd < scene.padL || pxd > scene.padL + scene.plotW) return;
      addPointLoadAt(e);
    });
  }

  /* =================================================================== */
  /*  keyboard                                                           */
  /* =================================================================== */
  function initKeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); restore(hist.idx - 1); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); restore(hist.idx + 1); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Escape') { state.selection = null; refresh(); return; }
      if (e.key === '?' ) { showHelp(); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.selection) {
        var o = findObj(state.selection.kind, state.selection.id);
        if (!o) return;
        e.preventDefault();
        var d = (e.key === 'ArrowLeft' ? -1 : 1) * (state.opts.snapStep || state.beam.L / 100) * (e.shiftKey ? 5 : 1);
        if (o.x !== undefined) o.x = clamp(o.x + d, 0, state.beam.L);
        else {
          var w = o.b - o.a;
          o.a = clamp(o.a + d, 0, state.beam.L - w); o.b = o.a + w;
        }
        pushHistory(); refresh();
      }
    });
  }

  /* =================================================================== */
  /*  persistence and I/O                                                */
  /* =================================================================== */
  var SAVE_KEY = 'beamsolver.v1';

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); } catch (err) { /* ignore */ }
  }
  function load() {
    try {
      var h = location.hash.replace(/^#m=/, '');
      if (h && location.hash.indexOf('#m=') === 0) {
        var m = JSON.parse(decodeURIComponent(escape(atob(h.replace(/-/g, '+').replace(/_/g, '/')))));
        return sanitise(m);
      }
    } catch (err) { /* fall through */ }
    try {
      var s = localStorage.getItem(SAVE_KEY);
      if (s) return sanitise(JSON.parse(s));
    } catch (err2) { /* ignore */ }
    return null;
  }

  function sanitise(m) {
    if (!m || !m.beam) return null;
    var base = emptyModel(m.units === 'US' ? 'US' : 'SI');
    base.beam = {
      L: +m.beam.L || base.beam.L, E: +m.beam.E || base.beam.E,
      I: +m.beam.I || base.beam.I, A: +m.beam.A || base.beam.A
    };
    base.supports = (m.supports || []).map(function (s) {
      return { id: s.id || uid(), type: SUP[s.type] ? s.type : 'pin', x: +s.x || 0,
               ky: +s.ky || 0, kr: +s.kr || 0, dy: +s.dy || 0, rz: +s.rz || 0 };
    });
    base.releases = (m.releases || []).map(function (r) {
      return { id: r.id || uid(), x: +r.x || 0, type: r.type === 'shear' ? 'shear' : 'moment' };
    });
    base.loads = (m.loads || []).map(function (l) {
      var o = { id: l.id || uid(), kind: l.kind };
      if (l.kind === 'point') { o.x = +l.x || 0; o.P = +l.P || 0; o.angle = +l.angle || 0; }
      else if (l.kind === 'moment') { o.x = +l.x || 0; o.M = +l.M || 0; }
      else if (l.kind === 'udl') { o.a = +l.a || 0; o.b = +l.b || 0; o.w1 = +l.w1 || 0; o.w2 = (l.w2 === undefined ? +l.w1 : +l.w2) || 0; o.dir = l.dir === 'x' ? 'x' : 'y'; }
      else if (l.kind === 'dmoment') { o.a = +l.a || 0; o.b = +l.b || 0; o.m1 = +l.m1 || 0; o.m2 = (l.m2 === undefined ? +l.m1 : +l.m2) || 0; }
      else return null;
      return o;
    }).filter(Boolean);
    if (m.opts) for (var k in base.opts) if (m.opts[k] !== undefined) base.opts[k] = m.opts[k];
    return base;
  }

  function exportModel() {
    var m = snapshot();
    return {
      application: 'Interactive 2D Beam Solver',
      version: 1,
      note: 'All values are in SI base units: length m, force N, moment N.m, E Pa, I m^4, A m^2. ' +
            'Forces are positive downward, moments positive clockwise, settlements positive downward.',
      displayUnits: m.units,
      beam: m.beam,
      supports: m.supports,
      releases: m.releases,
      loads: m.loads,
      options: m.opts
    };
  }

  var NO_DOWNLOAD = (typeof window !== 'undefined' && window.__ARTIFACT__ === true);

  function download(name, mime, data) {
    if (NO_DOWNLOAD) {
      modal('Copy ' + name, function (b) {
        elh('p', { text: 'This embedded copy of the solver cannot save files directly. Select everything below and copy it into a file called "' + name + '".' }, b);
        var bar = elh('div', { class: 'addbar', style: 'margin:8px 0' }, b);
        var ta = elh('textarea', {}, b);
        ta.value = data;
        elh('button', { class: 'btn primary', text: 'Select all', onclick: function () { ta.focus(); ta.select(); } }, bar);
        elh('button', { class: 'btn', text: 'Copy to clipboard', onclick: function () {
          ta.select();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(data).then(function () { toast('Copied'); }, function () { toast('Press Ctrl+C to copy'); });
          } else { toast('Press Ctrl+C to copy'); }
        } }, bar);
        setTimeout(function () { ta.focus(); ta.select(); }, 50);
      });
      return;
    }
    var blob = new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function exportCSV() {
    if (!result || !result.ok) return toast('Nothing to export');
    var u = U(), L = state.beam.L, n = 500, out = [];
    out.push(['x [' + u.len.sym + ']', 'w [' + u.dist.sym + ']', 'N [' + u.force.sym + ']',
              'V [' + u.force.sym + ']', 'M [' + u.mom.sym + ']', 'slope [rad]', 'v [' + u.defl.sym + ']'].join(','));
    for (var i = 0; i <= n; i++) {
      var x = L * i / n;
      var v = result.valuesAt(x);
      out.push([x / u.len.f, v.w / u.dist.f, v.Nr / u.force.f, v.Vr / u.force.f,
                v.Mr / u.mom.f, v.slope, v.defl / u.defl.f]
        .map(function (q) { return (Math.round(q * 1e8) / 1e8); }).join(','));
    }
    download('beam-diagrams.csv', 'text/csv', out.join('\n'));
    toast('CSV downloaded');
  }

  function exportPNG() {
    if (NO_DOWNLOAD) {
      modal('Saving the drawing', function (b) {
        b.innerHTML = '<p>This embedded copy of the solver is not allowed to save image files. ' +
          'Two ways round it:</p><ul>' +
          '<li>Take a screenshot of the drawing (<code>Win+Shift+S</code> on Windows, ' +
          '<code>Cmd+Shift+4</code> on a Mac).</li>' +
          '<li>Use <b>Print</b> and choose "Save as PDF" - that keeps the diagrams sharp at any zoom, ' +
          'and includes the reaction and summary tables.</li></ul>' +
          '<p>The downloadable single-file version of this tool exports PNG directly.</p>';
      });
      return;
    }
    var svg = $('stage').cloneNode(true);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    /* resolve the few CSS variables used by the overlays */
    var map = { '--accent': null, '--text-muted': null, '--surface-1': null };
    for (var k in map) map[k] = getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    var xml = new XMLSerializer().serializeToString(svg);
    xml = xml.replace(/var\((--[a-z0-9-]+)\)/gi, function (m0, name) { return map[name] || '#888'; });
    var W = scene.width, H = scene.height, S = 2;
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = W * S; c.height = H * S;
      var ctx = c.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim() || '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) {
        var url = URL.createObjectURL(b);
        var a = document.createElement('a');
        a.href = url; a.download = 'beam-diagrams.png';
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        toast('PNG downloaded');
      });
    };
    img.onerror = function () { toast('Could not render the image'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  function shareLink() {
    var s = JSON.stringify(snapshot());
    var b64 = btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_');
    /* location.origin is "null" for file:// - build the base from href */
    var url = location.href.split('#')[0] + '#m=' + b64;
    try { history.replaceState(null, '', '#m=' + b64); } catch (e) { location.hash = 'm=' + b64; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied to the clipboard'); },
        function () { promptText('Shareable link', url); });
    } else promptText('Shareable link', url);
  }

  /* =================================================================== */
  /*  modals and toast                                                   */
  /* =================================================================== */
  function modal(title, build) {
    var back = elh('div', { class: 'modal-back', onclick: function (e) { if (e.target === back) close(); } }, $('modalHost'));
    var m = elh('div', { class: 'modal' }, back);
    var h = elh('header', {}, m);
    elh('h2', { text: title }, h);
    elh('span', { style: 'flex:1' }, h);
    elh('button', { class: 'btn small', text: 'Close', onclick: function () { close(); } }, h);
    var body = elh('div', { class: 'pad' }, m);
    function close() { back.remove(); }
    build(body, close);
    return close;
  }

  function promptText(title, text) {
    modal(title, function (b) {
      var ta = elh('textarea', {}, b);
      ta.value = text;
      ta.select();
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  function showHelp() {
    modal('How to use the beam solver', function (b) {
      b.innerHTML =
        '<h3>Building a model</h3>' +
        '<ul>' +
        '<li>Set the span, <code>E</code> and <code>I</code> in the <b>Beam</b> panel. The unit system is switched in the top bar; the model itself never changes, only the numbers you read.</li>' +
        '<li>Add supports and loads from the sidebar, then <b>drag</b> them along the beam. Distributed loads have round handles at each end for the extents <code>a</code> and <code>b</code>. Positions are continuous unless you switch the snap grid on in <b>Display options</b>; hold <b>Alt</b> to bypass it.</li>' +
        '<li><b>Double-click</b> an empty part of the drawing to drop a point load there. Click any object to edit its exact values in <b>Selected object</b>.</li>' +
        '<li>Arrow keys nudge the selection, <b>Delete</b> removes it, <b>Ctrl+Z</b> / <b>Ctrl+Y</b> undo and redo.</li>' +
        '</ul>' +
        '<h3>Supports</h3>' +
        '<ul>' +
        '<li><b>Pin</b> - vertical + horizontal restraint. <b>Roller</b> - vertical only. <b>Fixed</b> - all three.</li>' +
        '<li><b>Guided (slider)</b> - rotation and horizontal restrained, free to move vertically. <b>Horizontal roller</b> - horizontal only.</li>' +
        '<li><b>Vertical / rotational spring</b> - elastic supports; enter the stiffness. Any support can also be given a <b>settlement</b> or an <b>imposed rotation</b>.</li>' +
        '<li>An <b>internal hinge</b> forces <code>M = 0</code> at that section; a <b>shear release</b> forces <code>V = 0</code>.</li>' +
        '</ul>' +
        '<h3>Sign conventions</h3>' +
        '<ul>' +
        '<li><b>You type</b> loads positive <b>downward</b> and moments positive <b>clockwise</b> (settlements downward). A negative number flips it.</li>' +
        '<li><b>The diagrams</b> follow the textbook rule: positive <b>V</b> rotates the segment <b>clockwise</b>, positive <b>M</b> bends it <b>concave upward</b> (sagging, tension on the bottom fibre), <b>N</b> is tension, <b>&theta;</b> counter-clockwise, <b>v</b> and <b>Ry</b> upward.</li>' +
        '<li><b>Inside</b>, the solver uses <i>x</i> right, <i>y</i> up, counter-clockwise - so <code>dV/dx = q</code> and <code>dM/dx = V</code> hold with the load <i>q</i> positive upward, and the area under <i>V</i> is <code>&Delta;M</code>.</li>' +
        '<li>Tick <i>"Bending moment drawn on the tension side"</i> in <b>Display options</b> to plot the moment diagram downward for positive sagging, as many textbooks do.</li>' +
        '</ul>' +
        '<h3>What the solver does</h3>' +
        '<p>The beam is analysed with the <b>direct stiffness method</b> using two-node Euler&ndash;Bernoulli elements, with a node at every support, release, load and load boundary. That makes both determinate and indeterminate beams - continuous beams, propped and fixed-ended beams, elastic supports, settlements - exact for the governing differential equation. Shear, moment and axial force are then integrated directly from the applied loads and the computed reactions, so the diagrams are exact and independent of the mesh; the deflected shape is the exact element solution, not an interpolation.</p>' +
        '<p>Assumptions: linear elastic material, small displacements, prismatic beam (constant <code>EI</code>), bending only &mdash; shear deformation is neglected.</p>' +
        '<h3>Getting your work out</h3>' +
        '<ul>' +
        '<li><b>PNG</b> saves the drawing, <b>CSV</b> saves 501 sampled values of every diagram, <b>Export</b> writes the model as JSON and <b>Import</b> reads it back.</li>' +
        '<li><b>Link</b> copies a URL that reproduces the whole model, so it can be handed in or shared. <b>Print</b> produces a clean report of the drawing and the tables.</li>' +
        '</ul>';
    });
  }

  /* =================================================================== */
  /*  examples                                                           */
  /* =================================================================== */
  function pick(si, us) { return state.units === 'SI' ? si : us; }

  var EXAMPLES = [
    ['Simply supported - uniform load', function () {
      var u = U(), L = pick(8, 25) * u.len.f;
      return { L: L,
        sup: [['pin', 0], ['roller', L]],
        loads: [udl(0, L, pick(20, 1.5), pick(20, 1.5))] };
    }],
    ['Simply supported - central point load', function () {
      var u = U(), L = pick(8, 25) * u.len.f;
      return { L: L, sup: [['pin', 0], ['roller', L]], loads: [pt(L / 2, pick(50, 12))] };
    }],
    ['Simply supported - triangular load', function () {
      var u = U(), L = pick(9, 30) * u.len.f;
      return { L: L, sup: [['pin', 0], ['roller', L]], loads: [udl(0, L, 0, pick(24, 2))] };
    }],
    ['Cantilever - tip point load', function () {
      var L = pick(5, 16) * U().len.f;
      return { L: L, sup: [['fixed', 0]], loads: [pt(L, pick(20, 5))] };
    }],
    ['Cantilever - uniform load', function () {
      var L = pick(5, 16) * U().len.f;
      return { L: L, sup: [['fixed', 0]], loads: [udl(0, L, pick(15, 1.2), pick(15, 1.2))] };
    }],
    ['Overhanging beam', function () {
      var L = pick(12, 40) * U().len.f;
      return { L: L, sup: [['pin', 0], ['roller', L * 0.75]],
        loads: [udl(0, L * 0.75, pick(12, 1), pick(12, 1)), pt(L, pick(30, 8))] };
    }],
    ['Propped cantilever', function () {
      var L = pick(10, 32) * U().len.f;
      return { L: L, sup: [['fixed', 0], ['roller', L]], loads: [udl(0, L, pick(18, 1.4), pick(18, 1.4))] };
    }],
    ['Fixed-fixed beam', function () {
      var L = pick(8, 26) * U().len.f;
      return { L: L, sup: [['fixed', 0], ['fixed', L]], loads: [udl(0, L, pick(25, 2), pick(25, 2))] };
    }],
    ['Two-span continuous beam', function () {
      var L = pick(16, 50) * U().len.f;
      return { L: L, sup: [['pin', 0], ['roller', L / 2], ['roller', L]],
        loads: [udl(0, L, pick(15, 1.2), pick(15, 1.2))] };
    }],
    ['Three-span continuous beam', function () {
      var L = pick(18, 60) * U().len.f;
      return { L: L, sup: [['pin', 0], ['roller', L / 3], ['roller', 2 * L / 3], ['roller', L]],
        loads: [udl(0, L, pick(15, 1.2), pick(15, 1.2))] };
    }],
    ['Gerber beam (internal hinge)', function () {
      var L = pick(14, 45) * U().len.f;
      return { L: L, sup: [['fixed', 0], ['roller', L]], rel: [[L * 0.55, 'moment']],
        loads: [udl(0, L, pick(10, 0.8), pick(10, 0.8)), pt(L * 0.8, pick(25, 6))] };
    }],
    ['Support settlement', function () {
      var L = pick(12, 40) * U().len.f;
      return { L: L, sup: [['pin', 0], ['roller', L / 2, { dy: 0.02 }], ['roller', L]],
        loads: [udl(0, L, pick(12, 1), pick(12, 1))] };
    }],
    ['Elastic (spring) support', function () {
      var L = pick(10, 32) * U().len.f;
      return { L: L, sup: [['fixed', 0], ['spring', L, { ky: pick(2e6, 2e6) }]],
        loads: [udl(0, L, pick(15, 1.2), pick(15, 1.2))] };
    }],
    ['Mixed loading (moment + trapezoid)', function () {
      var L = pick(12, 40) * U().len.f;
      return { L: L, sup: [['pin', 0], ['roller', L * 0.6], ['roller', L]],
        loads: [udl(L * 0.1, L * 0.6, pick(8, 0.6), pick(20, 1.6)),
                mom(L * 0.8, pick(40, 12)), pt(L * 0.35, pick(30, 8))] };
    }]
  ];

  function pt(x, P) { return { id: uid(), kind: 'point', x: x, P: P * U().force.f, angle: 0 }; }
  function mom(x, M) { return { id: uid(), kind: 'moment', x: x, M: M * U().mom.f }; }
  function udl(a, b, w1, w2) { return { id: uid(), kind: 'udl', a: a, b: b, w1: w1 * U().dist.f, w2: w2 * U().dist.f, dir: 'y' }; }

  function applyExample(i) {
    var spec = EXAMPLES[i][1]();
    var keep = state.opts, units = state.units;
    state = emptyModel(units);
    state.opts = keep;
    state.beam.L = spec.L;
    (spec.sup || []).forEach(function (s) {
      var o = { id: uid(), type: s[0], x: s[1], ky: 0, kr: 0, dy: 0, rz: 0 };
      if (s[2]) for (var k in s[2]) o[k] = s[2][k];
      state.supports.push(o);
    });
    (spec.rel || []).forEach(function (r) { state.releases.push({ id: uid(), x: r[0], type: r[1] }); });
    state.loads = spec.loads || [];
    state.sectionX = spec.L / 2;
    hist = { stack: [], idx: -1 };
    pushHistory();
    refresh();
  }

  /* =================================================================== */
  /*  wiring                                                             */
  /* =================================================================== */
  function initTopbar() {
    /* units */
    Array.prototype.forEach.call($('unitSeg').children, function (b) {
      b.addEventListener('click', function () {
        state.units = b.getAttribute('data-u');
        state.opts.snapStep = U().defaults.snap * U().len.f;
        Array.prototype.forEach.call($('unitSeg').children, function (c) {
          c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
        });
        pushHistory(); refresh();
      });
    });

    var sel = $('exampleSel');
    EXAMPLES.forEach(function (e, i) { elh('option', { value: i, text: e[0] }, sel); });
    sel.addEventListener('change', function () {
      if (sel.value === '') return;
      applyExample(+sel.value);
      toast(EXAMPLES[+sel.value][0]);
      sel.value = '';
    });

    $('btnUndo').onclick = function () { restore(hist.idx - 1); };
    $('btnRedo').onclick = function () { restore(hist.idx + 1); };
    $('btnClear').onclick = function () {
      modal('Reset the model', function (b, close) {
        elh('p', { text: 'This clears every support, load and release and starts from an empty beam. The current model is lost unless you export it first.' }, b);
        var bar = elh('div', { class: 'addbar', style: 'margin-top:12px' }, b);
        elh('button', { class: 'btn danger', text: 'Clear everything', onclick: function () {
          var units = state.units;
          state = emptyModel(units);
          hist = { stack: [], idx: -1 };
          pushHistory(); refresh(); close();
          toast('Model cleared');
        } }, bar);
        elh('button', { class: 'btn', text: 'Keep my model', onclick: close }, bar);
      });
    };
    $('btnPng').onclick = exportPNG;
    $('btnCsv').onclick = exportCSV;
    $('btnJson').onclick = function () {
      download('beam-model.json', 'application/json', JSON.stringify(exportModel(), null, 2));
      toast('Model exported');
    };
    $('btnImport').onclick = function () {
      modal('Import a model', function (b, close) {
        elh('p', { text: 'Paste a JSON model exported from this tool, or choose a file.' }, b);
        var file = elh('input', { type: 'file', accept: '.json,application/json' }, b);
        var ta = elh('textarea', { placeholder: '{ "beam": { ... } }' }, b);
        var bar = elh('div', { class: 'addbar', style: 'margin-top:10px' }, b);
        var err = elh('div', { style: 'display:none' }, b);
        function fail(msg) {
          err.style.display = '';
          err.className = 'note err';
          err.textContent = 'Could not read that model: ' + msg;
        }
        function apply(text) {
          try {
            var m = sanitise(JSON.parse(text));
            if (!m) throw new Error('not a beam model');
            var units = m.units;
            state = m; state.selection = null; state.sectionX = m.beam.L / 2;
            Array.prototype.forEach.call($('unitSeg').children, function (c) {
              c.setAttribute('aria-pressed', c.getAttribute('data-u') === units ? 'true' : 'false');
            });
            hist = { stack: [], idx: -1 };
            pushHistory(); refresh(); close();
            toast('Model imported');
          } catch (e2) { fail(e2.message); }
        }
        file.addEventListener('change', function () {
          var f = file.files[0]; if (!f) return;
          var rd = new FileReader();
          rd.onload = function () { apply(String(rd.result)); };
          rd.readAsText(f);
        });
        elh('button', { class: 'btn primary', text: 'Import from the text box', onclick: function () { apply(ta.value); } }, bar);
      });
    };
    $('btnShare').onclick = shareLink;
    $('btnPrint').onclick = function () { window.print(); };
    $('btnHelp').onclick = showHelp;

    $('btnTheme').onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'light' ? 'dark' : cur === 'dark' ? '' : 'light';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('beamsolver.theme', next); } catch (e) {}
      toast('Theme: ' + (next || 'system'));
      drawStage();
    };
    try {
      var th = localStorage.getItem('beamsolver.theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
    } catch (e) {}
  }

  /* ------------------------------------------------------------ start */
  function boot() {
    state = load() || starter('SI');
    state.selection = null;
    state.sectionX = state.beam.L / 2;
    Array.prototype.forEach.call($('unitSeg').children, function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-u') === state.units ? 'true' : 'false');
    });
    initTopbar();
    initStage();
    initKeys();
    pushHistory();
    refresh();

    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { drawStage(); }, 120);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', drawStage);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
