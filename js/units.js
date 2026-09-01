'use strict';
/* =====================================================================
   units.js - unit systems and number formatting.
   The model is always stored in SI base units (m, N, Pa, m^2, m^4).
   Every entry here is  value_SI = value_shown * f.
   ===================================================================== */

var KIP = 4448.2216152605;      /* N       */
var FT = 0.3048;                /* m       */
var IN = 0.0254;                /* m       */
var KSI = 6894757.2931783;      /* Pa      */

var Units = {

  SI: {
    id: 'SI',
    name: 'SI',
    note: 'kN, m',
    len:   { sym: 'm',        f: 1,        dec: 3 },
    force: { sym: 'kN',       f: 1e3,      dec: 3 },
    mom:   { sym: 'kN·m', f: 1e3,     dec: 3 },
    dist:  { sym: 'kN/m',     f: 1e3,      dec: 3 },
    distM: { sym: 'kN·m/m', f: 1e3,   dec: 3 },
    E:     { sym: 'GPa',      f: 1e9,      dec: 4 },
    I:     { sym: 'mm⁴', f: 1e-12,    dec: 4 },
    A:     { sym: 'mm²', f: 1e-6,     dec: 4 },
    defl:  { sym: 'mm',       f: 1e-3,     dec: 4 },
    small: { sym: 'mm',       f: 1e-3,     dec: 4 },
    k:     { sym: 'kN/m',     f: 1e3,      dec: 4 },
    kr:    { sym: 'kN·m/rad', f: 1e3, dec: 4 },
    slope: { sym: 'rad',      f: 1,        dec: 5 },
    defaults: { L: 8, E: 200e9, I: 2.0e-4, A: 8.0e-3, snap: 0.01 }
  },

  US: {
    id: 'US',
    name: 'US',
    note: 'kip, ft',
    len:   { sym: 'ft',        f: FT,          dec: 3 },
    force: { sym: 'kip',       f: KIP,         dec: 3 },
    mom:   { sym: 'kip·ft', f: KIP * FT,  dec: 3 },
    dist:  { sym: 'kip/ft',    f: KIP / FT,    dec: 3 },
    distM: { sym: 'kip·ft/ft', f: KIP * FT / FT, dec: 3 },
    E:     { sym: 'ksi',       f: KSI,         dec: 4 },
    I:     { sym: 'in⁴',  f: Math.pow(IN, 4), dec: 4 },
    A:     { sym: 'in²',  f: IN * IN,     dec: 4 },
    defl:  { sym: 'in',        f: IN,          dec: 4 },
    small: { sym: 'in',        f: IN,          dec: 4 },
    k:     { sym: 'kip/in',    f: KIP / IN,    dec: 4 },
    kr:    { sym: 'kip·ft/rad', f: KIP * FT, dec: 4 },
    slope: { sym: 'rad',       f: 1,           dec: 5 },
    defaults: { L: 25, E: 29000 * KSI, I: 5.0e-4, A: 1.2e-2, snap: 0.01 }
  }
};

/* value in SI  ->  number shown to the user */
function toUser(si, u) { return si / u.f; }
/* number typed by the user -> value in SI */
function toSI(val, u) { return val * u.f; }

/* --------------------------------------------------------------------
   Formatting: significant-figure based, never scientific unless it has
   to be, thin thousands separators, and a real minus sign is avoided so
   the text stays copy-paste friendly.
   -------------------------------------------------------------------- */
function fmt(v, sig) {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  sig = sig || 4;
  var a = Math.abs(v);
  if (a < 1e-12) return '0';
  if (a >= 1e7 || a < 1e-4) return v.toExponential(Math.max(2, sig - 2));
  var digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  digits = Math.min(digits, 8);
  var s = v.toFixed(digits);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  /* thousands separators for the integer part */
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

/* format an SI value in the given unit slot, with the symbol */
function fmtU(si, u, sig) { return fmt(si / u.f, sig) + ' ' + u.sym; }

/* short numeric-only version (for diagram labels) */
function fmtN(si, u, sig) { return fmt(si / u.f, sig || 3); }

if (typeof module === 'object' && module.exports) {
  module.exports = { Units: Units, toUser: toUser, toSI: toSI, fmt: fmt, fmtU: fmtU, fmtN: fmtN };
}
